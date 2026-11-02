// Panel del peluquero: ver turnos y configurar horarios y servicios.
(async function () {
  const U = window.Utils;
  const S = window.Store;
  const $ = (s) => document.querySelector(s);
  const el = U.el;
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  let settings = null;

  function toast(msg) {
    const t = el("div", { class: "toast", role: "status" }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ---------- Login ----------
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-error");
    err.hidden = true;
    try {
      await S.signIn($("#email").value.trim(), $("#password").value);
      await showApp();
    } catch (ex) {
      err.textContent = "Email o contraseña incorrectos.";
      err.hidden = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    await S.signOut();
    location.reload();
  });

  // ---------- Pestañas ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      $("#tab-bookings").hidden = tab.dataset.tab !== "bookings";
      $("#tab-settings").hidden = tab.dataset.tab !== "settings";
    });
  });

  // ---------- Turnos ----------
  async function renderBookings() {
    const box = $("#bookings");
    let list;
    try {
      list = await S.listBookings(U.dateKey(new Date()));
    } catch (ex) {
      box.replaceChildren(el("p", { class: "error" }, "No se pudieron cargar los turnos."));
      return;
    }
    if (!list.length) {
      box.replaceChildren(el("p", { class: "empty" }, "No hay turnos próximos."));
      return;
    }

    const groups = {};
    list.forEach((b) => (groups[b.day] = groups[b.day] || []).push(b));

    box.replaceChildren(...Object.entries(groups).map(([day, items]) =>
      el("div", { class: "day-group" },
        el("h3", {}, U.formatDayLong(day) + " · " + items.length + (items.length === 1 ? " turno" : " turnos")),
        items.map((b) => el("div", { class: "booking" },
          el("span", { class: "when" }, b.time),
          el("div", { class: "who" },
            el("strong", {}, b.name),
            el("div", { class: "meta" }, b.service + " · " + b.duration + " min · " + b.phone)
          ),
          el("div", { class: "acts" },
            el("a", {
              class: "btn ghost sm", target: "_blank", rel: "noopener",
              href: U.waLink(b.phone, "Hola " + b.name + "! Te recuerdo tu turno en " + settings.businessName +
                " el " + U.formatDayLong(b.day) + " a las " + b.time + " hs. ¡Te esperamos!")
            }, "Recordar"),
            el("button", {
              class: "btn danger sm", type: "button",
              onclick: async () => {
                if (!confirm("¿Cancelar el turno de " + b.name + " (" + b.time + ")?")) return;
                await S.cancelBooking(b.id);
                toast("Turno cancelado");
                renderBookings();
              }
            }, "Cancelar")
          )
        ))
      )
    ));
  }

  $("#refresh").addEventListener("click", renderBookings);

  // ---------- Configuración ----------
  function renderHours() {
    $("#hours").replaceChildren(...WEEK_ORDER.map((dow) => {
      const h = settings.hours[String(dow)];
      const open = !!h;
      const v = h || { start: "09:00", end: "18:00", breakStart: "", breakEnd: "" };
      const timeInput = (field, value) =>
        el("input", { type: "time", "data-field": field, value: value || "", step: "300" });

      const row = el("div", { class: "hours-row" + (open ? "" : " closed"), "data-dow": dow },
        el("label", { class: "check-label" },
          el("input", {
            type: "checkbox", checked: open, "data-field": "open",
            onchange: (e) => row.classList.toggle("closed", !e.target.checked)
          }),
          U.DAY_NAMES[dow]
        ),
        el("div", { class: "times-in" },
          timeInput("start", v.start), "a", timeInput("end", v.end),
          el("span", { class: "muted small" }, "· pausa"),
          timeInput("breakStart", v.breakStart), "a", timeInput("breakEnd", v.breakEnd)
        )
      );
      return row;
    }));
  }

  function serviceRow(svc) {
    const row = el("div", { class: "service-row", "data-id": svc.id },
      el("input", { type: "text", "data-field": "name", value: svc.name, maxlength: "40", "aria-label": "Nombre del servicio" }),
      el("input", { type: "number", "data-field": "duration", value: String(svc.duration), min: "5", max: "480", step: "5", "aria-label": "Duración en minutos" }),
      el("input", { type: "number", "data-field": "price", value: svc.price != null ? String(svc.price) : "", min: "0", "aria-label": "Precio" }),
      el("button", { class: "btn danger sm", type: "button", onclick: () => row.remove(), "aria-label": "Quitar servicio" }, "✕")
    );
    return row;
  }

  function renderSettings() {
    $("#s-name").value = settings.businessName;
    $("#s-address").value = settings.address || "";
    $("#s-wa").value = settings.whatsapp || "";
    $("#s-slot").value = String(settings.slotMinutes);
    $("#s-days").value = String(settings.daysAhead);
    renderHours();
    $("#services").replaceChildren(...settings.services.map(serviceRow));
  }

  $("#add-service").addEventListener("click", () => {
    const row = serviceRow({ id: "s" + Date.now(), name: "", duration: 30, price: "" });
    $("#services").append(row);
    row.querySelector("input").focus();
  });

  function collectSettings() {
    const hours = {};
    document.querySelectorAll(".hours-row").forEach((row) => {
      const get = (f) => row.querySelector(`[data-field="${f}"]`);
      if (!get("open").checked) {
        hours[row.dataset.dow] = null;
        return;
      }
      const h = {
        start: get("start").value, end: get("end").value,
        breakStart: get("breakStart").value, breakEnd: get("breakEnd").value
      };
      const day = U.DAY_NAMES[row.dataset.dow];
      if (!h.start || !h.end || h.start >= h.end) throw new Error(day + ": el horario de cierre tiene que ser después del de apertura.");
      if ((h.breakStart && !h.breakEnd) || (!h.breakStart && h.breakEnd) || (h.breakStart && h.breakStart >= h.breakEnd)) {
        throw new Error(day + ": completá bien la pausa o dejala vacía.");
      }
      hours[row.dataset.dow] = h;
    });

    const services = [...document.querySelectorAll(".service-row[data-id]")].map((row) => {
      const get = (f) => row.querySelector(`[data-field="${f}"]`).value;
      const price = get("price");
      return {
        id: row.dataset.id,
        name: get("name").trim(),
        duration: Math.min(480, Math.max(5, Number(get("duration")) || 30)),
        price: price === "" ? null : Number(price)
      };
    }).filter((s) => s.name);
    if (!services.length) throw new Error("Cargá al menos un servicio.");

    const name = $("#s-name").value.trim();
    if (!name) throw new Error("Poné el nombre de tu negocio.");

    return {
      businessName: name,
      address: $("#s-address").value.trim(),
      whatsapp: $("#s-wa").value.replace(/\D/g, ""),
      slotMinutes: Number($("#s-slot").value),
      daysAhead: Math.min(60, Math.max(1, Number($("#s-days").value) || 14)),
      services,
      hours
    };
  }

  $("#tab-settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#save-error");
    err.hidden = true;
    const btn = $("#save");
    btn.disabled = true;
    try {
      const next = collectSettings();
      await S.saveSettings(next);
      settings = next;
      $("#title").textContent = settings.businessName;
      toast("Cambios guardados");
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Inicio ----------
  $("#copy-link").addEventListener("click", async () => {
    const input = $("#public-link");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (ex) {
      input.select();
      document.execCommand("copy");
    }
    toast("Link copiado");
  });

  async function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#logout").hidden = !S.isRemote;
    $("#mode").textContent = S.isRemote ? "Conectado a la base de datos" : "Modo demo · datos guardados en este navegador";
    $("#public-link").value = new URL("index.html", location.href).href;
    settings = await S.getSettings();
    $("#title").textContent = settings.businessName;
    renderSettings();
    await renderBookings();
  }

  const session = await S.getSession().catch(() => null);
  if (session) await showApp();
  else $("#login").hidden = false;
})();
