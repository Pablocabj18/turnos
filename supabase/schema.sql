-- Esquema de la base de datos para Supabase.
-- Pegá todo este archivo en Supabase → SQL Editor → New query → Run.

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  start_time time not null,
  duration int not null check (duration between 5 and 480),
  service text not null,
  name text not null,
  phone text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists bookings_day_idx on bookings (day) where status = 'confirmed';

-- Turnos fijos: el mismo cliente, el mismo día y hora, cada 1, 2 o 4 semanas.
-- dow: día de la semana, 0 = domingo. skips: fechas puntuales que se liberaron.
create table if not exists fixed_bookings (
  id uuid primary key default gen_random_uuid(),
  dow smallint not null check (dow between 0 and 6),
  every smallint not null default 1 check (every in (1, 2, 4)),
  start_time time not null,
  duration int not null check (duration between 5 and 480),
  service text not null,
  name text not null,
  phone text not null,
  since date not null default current_date,
  until date,
  skips date[] not null default '{}',
  created_at timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- Seguridad: los clientes (anónimos) NO pueden leer los datos de otros clientes.
-- Sólo el peluquero logueado ve y modifica todo.
alter table settings enable row level security;
alter table bookings enable row level security;

drop policy if exists "settings: lectura pública" on settings;
create policy "settings: lectura pública" on settings
  for select using (true);

drop policy if exists "settings: el admin edita" on settings;
create policy "settings: el admin edita" on settings
  for all to authenticated using (true) with check (true);

drop policy if exists "bookings: el admin gestiona" on bookings;
create policy "bookings: el admin gestiona" on bookings
  for all to authenticated using (true) with check (true);

alter table fixed_bookings enable row level security;
drop policy if exists "fijos: el admin gestiona" on fixed_bookings;
create policy "fijos: el admin gestiona" on fixed_bookings
  for all to authenticated using (true) with check (true);

-- ¿El turno fijo f cae el día d?
create or replace function fixed_on(f fixed_bookings, d date)
returns boolean
language sql immutable
as $$
  select f.dow = extract(dow from d)::int
     and d >= f.since
     and (f.until is null or d <= f.until)
     and not (d = any (f.skips))
     and ((d - f.since) / 7) % f.every = 0;
$$;

-- Horarios ocupados (sin nombres ni teléfonos) para la página pública.
-- Incluye los turnos sueltos y los fijos.
create or replace function get_busy(d_from date, d_to date)
returns table (day date, start_time text, duration int)
language sql security definer set search_path = public
as $$
  select b.day, to_char(b.start_time, 'HH24:MI'), b.duration
  from bookings b
  where b.status = 'confirmed' and b.day between d_from and d_to
  union all
  select d::date, to_char(f.start_time, 'HH24:MI'), f.duration
  from generate_series(d_from::timestamp, least(d_to, d_from + 120)::timestamp, interval '1 day') d
  join fixed_bookings f on fixed_on(f, d::date);
$$;

-- Crear un turno verificando que el horario siga libre.
create or replace function create_booking(
  p_day date, p_time time, p_duration int,
  p_service text, p_name text, p_phone text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_day < current_date or p_day > current_date + 90 then
    raise exception 'fecha_invalida';
  end if;
  if p_duration not between 5 and 480
     or length(trim(p_name)) not between 2 and 80
     or length(p_phone) not between 8 and 30
     or length(p_service) > 60 then
    raise exception 'datos_invalidos';
  end if;

  -- Evita que dos personas reserven el mismo horario al mismo tiempo.
  perform pg_advisory_xact_lock(hashtext(p_day::text));

  if exists (
    select 1 from bookings b
    where b.status = 'confirmed' and b.day = p_day
      and b.start_time < p_time + make_interval(mins => p_duration)
      and b.start_time + make_interval(mins => b.duration) > p_time
  ) then
    raise exception 'ocupado';
  end if;

  if exists (
    select 1 from fixed_bookings f
    where fixed_on(f, p_day)
      and f.start_time < p_time + make_interval(mins => p_duration)
      and f.start_time + make_interval(mins => f.duration) > p_time
  ) then
    raise exception 'ocupado';
  end if;

  insert into bookings (day, start_time, duration, service, name, phone)
  values (p_day, p_time, p_duration, trim(p_service), trim(p_name), trim(p_phone))
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function get_busy(date, date) from public;
revoke all on function create_booking(date, time, int, text, text, text) from public;
grant execute on function get_busy(date, date) to anon, authenticated;
grant execute on function create_booking(date, time, int, text, text, text) to anon, authenticated;
