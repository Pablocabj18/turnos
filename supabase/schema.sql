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

-- Administradores permitidos. Cargá el UUID del peluquero desde
-- Authentication → Users después de aplicar este esquema.
create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table app_admins enable row level security;

-- Días completos en los que el negocio no recibe reservas.
create table if not exists blocked_dates (
  day date primary key,
  reason text not null default '' check (length(reason) <= 120),
  created_at timestamptz not null default now()
);
alter table blocked_dates enable row level security;

create or replace function is_app_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from app_admins where user_id = auth.uid()); $$;

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
  for all to authenticated using (is_app_admin()) with check (is_app_admin());

drop policy if exists "bookings: el admin gestiona" on bookings;
create policy "bookings: el admin gestiona" on bookings
  for all to authenticated using (is_app_admin()) with check (is_app_admin());

alter table fixed_bookings enable row level security;
drop policy if exists "fijos: el admin gestiona" on fixed_bookings;
create policy "fijos: el admin gestiona" on fixed_bookings
  for all to authenticated using (is_app_admin()) with check (is_app_admin());

drop policy if exists "bloqueos: el admin gestiona" on blocked_dates;
create policy "bloqueos: el admin gestiona" on blocked_dates
  for all to authenticated using (is_app_admin()) with check (is_app_admin());

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
  join fixed_bookings f on fixed_on(f, d::date)
  union all
  select x.day, '00:00', 1440 from blocked_dates x
  where x.day between d_from and least(d_to, d_from + 120);
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
  cfg jsonb;
  svc jsonb;
  hours jsonb;
  opening time;
  closing time;
  pause_start time;
  pause_end time;
  configured_slot int;
  configured_days int;
begin
  select data into cfg from settings where id = 1;
  if cfg is null then raise exception 'agenda_no_configurada'; end if;
  configured_days := least(60, greatest(1, coalesce((cfg->>'daysAhead')::int, 14)));
  if p_day < current_date or p_day > current_date + configured_days then
    raise exception 'fecha_invalida';
  end if;
  if p_duration not between 5 and 480
     or length(trim(p_name)) not between 2 and 80
     or length(trim(p_phone)) not between 8 and 30
     or length(trim(p_service)) not between 1 and 60 then
    raise exception 'datos_invalidos';
  end if;

  select service into svc
  from jsonb_array_elements(coalesce(cfg->'services', '[]'::jsonb)) as configured_services(service)
  where service->>'name' = trim(p_service) and (service->>'duration')::int = p_duration
  limit 1;
  if svc is null then raise exception 'servicio_invalido'; end if;
  hours := cfg->'hours'->((extract(dow from p_day)::int)::text);
  if hours is null or hours = 'null'::jsonb then raise exception 'dia_cerrado'; end if;
  opening := (hours->>'start')::time;
  closing := (hours->>'end')::time;
  if opening is null or closing is null or p_time < opening
     or p_time + make_interval(mins => p_duration) > closing then
    raise exception 'fuera_de_horario';
  end if;
  pause_start := nullif(hours->>'breakStart', '')::time;
  pause_end := nullif(hours->>'breakEnd', '')::time;
  if pause_start is not null and pause_end is not null
     and p_time < pause_end and p_time + make_interval(mins => p_duration) > pause_start then
    raise exception 'durante_pausa';
  end if;
  configured_slot := greatest(5, coalesce((cfg->>'slotMinutes')::int, 30));
  if p_time <> date_trunc('minute', p_time)::time
     or mod(extract(epoch from (p_time - opening))::int / 60, configured_slot) <> 0 then
    raise exception 'horario_invalido';
  end if;
  -- La misma cerradura coordina reservas con altas/cambios de turnos fijos.
  perform pg_advisory_xact_lock(781214);
  if exists (select 1 from blocked_dates where day = p_day) then raise exception 'dia_bloqueado'; end if;

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

-- Evita que un turno fijo nuevo o editado choque con reservas o fijos existentes.
create or replace function prevent_fixed_conflicts()
returns trigger language plpgsql set search_path = public
as $$
declare
  check_day date;
begin
  perform pg_advisory_xact_lock(781214);
  for check_day in select d::date from generate_series(
    greatest(new.since, current_date)::timestamp,
    least(coalesce(new.until, greatest(greatest(new.since, current_date) + 27, current_date + 60)),
      greatest(greatest(new.since, current_date) + 27, current_date + 60))::timestamp,
    interval '1 day') d
  loop
    if fixed_on(new, check_day) and (
      exists (select 1 from blocked_dates x where x.day = check_day)
      or
      exists (select 1 from bookings b where b.status = 'confirmed' and b.day = check_day
        and b.start_time < new.start_time + make_interval(mins => new.duration)
        and b.start_time + make_interval(mins => b.duration) > new.start_time)
      or exists (select 1 from fixed_bookings f where f.id <> coalesce(new.id, gen_random_uuid())
        and fixed_on(f, check_day)
        and f.start_time < new.start_time + make_interval(mins => new.duration)
        and f.start_time + make_interval(mins => f.duration) > new.start_time)
    ) then raise exception 'turno_fijo_ocupado'; end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists fixed_bookings_no_conflicts on fixed_bookings;
create trigger fixed_bookings_no_conflicts before insert or update on fixed_bookings
for each row execute function prevent_fixed_conflicts();

create or replace function prevent_blocked_date_conflicts()
returns trigger language plpgsql set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(781214);
  if exists (select 1 from bookings b where b.day = new.day and b.status = 'confirmed')
     or exists (select 1 from fixed_bookings f where fixed_on(f, new.day)) then
    raise exception 'fecha_con_turnos';
  end if;
  return new;
end;
$$;

drop trigger if exists blocked_dates_no_appointments on blocked_dates;
create trigger blocked_dates_no_appointments before insert or update on blocked_dates
for each row execute function prevent_blocked_date_conflicts();

revoke all on function get_busy(date, date) from public;
revoke all on function create_booking(date, time, int, text, text, text) from public;
revoke all on function is_app_admin() from public;
grant execute on function is_app_admin() to authenticated;
grant execute on function get_busy(date, date) to anon, authenticated;
grant execute on function create_booking(date, time, int, text, text, text) to anon, authenticated;
