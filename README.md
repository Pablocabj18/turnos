# Turnos online para peluquerías

Sistema simple de reservas: el cliente elige servicio, día y horario libre; el peluquero ve sus turnos y configura su agenda desde un panel.

- `index.html`: página pública de reservas (el link que se comparte con los clientes).
- `admin.html`: panel del peluquero (turnos, turnos fijos, horarios, pausas, servicios y precios).
- `supabase/schema.sql`: base de datos.

Funciona 100% en GitHub Pages (sin servidor propio) y la base de datos es **gratis** con el plan free de Supabase.

## Turnos fijos

En el panel, pestaña **Turnos fijos**, se cargan los clientes que vienen siempre el mismo día y hora: todas las semanas, cada 2 semanas o cada 4 semanas. Ese horario queda ocupado automáticamente. Si un día no viene, en **Turnos** se toca **Liberar este día** y queda libre sólo esa fecha.

## Modo demo

Sin configurar nada, la app funciona en **modo demo**: los datos se guardan en el navegador donde se usan. Sirve para probar y mostrarlo, pero los turnos que saca un cliente desde su celular **no** le llegan al peluquero. Para eso hay que conectar Supabase.

## Conectar la base de datos (Supabase, gratis)

1. Creá una cuenta en <https://supabase.com> y un proyecto nuevo.
2. En el proyecto, andá a **SQL Editor → New query**, pegá el contenido de `supabase/schema.sql` y tocá **Run**.
3. Creá el usuario del peluquero: **Authentication → Users → Add user** (email y contraseña).
4. En **SQL Editor**, agregá su UUID a la tabla de administradores:
   `insert into app_admins (user_id) values ('UUID-DEL-USUARIO');`
   El UUID aparece en **Authentication → Users**. Repetí el paso sólo para administradores adicionales.
5. Desactivá los registros públicos: **Authentication → Sign In / Providers → Allow new users to sign up = OFF**.
6. En **Project Settings → API** copiá la *Project URL* y la *anon public key* y pegalas en `js/config.js`.
7. Subí los cambios. Entrá a `admin.html` con el email y contraseña del usuario agregado a `app_admins`.

La *anon key* es pública por diseño; la seguridad la dan las reglas del `schema.sql`: los visitantes sólo pueden ver horarios ocupados (sin nombres ni teléfonos) y crear turnos. Las reservas se vuelven a validar en la base de datos. Sólo los UUID incluidos en `app_admins` pueden administrar datos.

## Publicar en GitHub Pages

Repositorio → **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**.
La página queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## Próximos pasos posibles

- Bot de WhatsApp (API oficial de Meta) que responda con los horarios libres.
- Recordatorios automáticos el día anterior.
- Varias peluquerías en la misma app (para cobrar suscripción mensual).
- Varios profesionales por local, carga manual de turnos y bloqueo de días (vacaciones).
