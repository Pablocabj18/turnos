// Panel del peluquero: ver turnos y configurar horarios y servicios.
(async function () {
  const U = window.Utils;
  const S = window.Store;
  const $ = (s) => document.querySelector(s);
  const el = U.el;
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  // "los lunes", "los sábados": sólo sábado y domingo cambian en plural.
  const dayPlural = (dow) => U.DAY_NAMES[dow] + (dow === 0 || dow === 6 ? "s" : "");
  const EVERY_TEXT = { 1: "Todas las semanas", 2: "Cada 2 semanas", 4: "Cada 4 semanas" };

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
      $("#tab-fixed").hidden = tab.dataset.tab !== "fixed";
      $("#tab-settings").hidden = tab.dataset.tab !== "settings";
      if (tab.dataset.tab === "fixed") prepareFixedForm();
    });
  });

  // ---------- Turnos ----------
  function bookingActions(b) {
    const remind = el("a", {
      class: "btn ghost sm", target: "_blank", rel: "noopener",
      href: U.waLink(b.phone, "Hola " + b.name + "! Te recuerdo tu turno en " + settings.businessName +
        " el " + U.formatDayLong(b.day) + " a las " + b.time + " hs. ¡Te esperamos!")
    }, "Recordar");

    if (b.fixed) {
      return [remind, el("button", {
        class: "btn danger sm", type: "button",
        onclick: async () => {
          if (!confirm("¿Liberar el turno fijo de " + b.name + " sólo el " + U.formatDayLong(b.day) + "? Los demás siguen reservados.")) return;
          await S.skipFixed(b.fixedId, b.day);
          toast("Turno liberado ese día");
          renderBookings();
        }
      }, "Liberar este día")];
    }
    return [remind, el("button", {
      class: "btn danger sm", type: "button",
      onclick: async () => {
        if (!confirm("¿Cancelar el turno de " + b.name + " (" + b.time + ")?")) return;
        await S.cancelBooking(b.id);
        toast("Turno cancelado");
        renderBookings();
      }
    }, "Cancelar")];
  }

  async function renderBookings() {
    const box = $("#bookings");
    let list;
    try {
      const today = new Date();
      list = await S.listBookings(U.dateKey(today), U.dateKey(U.addDays(today, Number(settings.daysAhead) || 14)));
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
            el("strong", {}, b.name, b.fixed && el("span", { class: "tag" }, "Fijo")),
            el("div", { class: "meta" }, b.service + " · " + b.duration + " min · " + b.phone)
          ),
          el("div", { class: "acts" }, bookingActions(b))
        ))
      )
    ));
  }

  $("#refresh").addEventListener("click", renderBookings);

  // ---------- Turnos fijos ----------
  let fixedList = [];

  function nextDateFor(dow) {
    const t = new Date();
    return U.dateKey(U.addDays(t, (dow - t.getDay() + 7) % 7));
  }

  const timesClash = (a, b) =>
    U.toMin(a.time) < U.toMin(b.time) + Number(b.duration) && U.toMin(a.time) + Number(a.duration) > U.toMin(b.time);

  function fixedClash(f) {
    return fixedList.find((x) => x.id !== f.id && Number(x.dow) === Number(f.dow) &&
      (!x.until || x.until >= f.since) && timesClash(f, x));
  }

  function selectedService() {
    return settings.services.find((s) => s.id === $("#f-service").value);
  }

  function refreshFixedTimes() {
    const dow = Number($("#f-dow").value);
    const svc = selectedService();
    const sel = $("#f-time");
    if (!svc) {
      sel.replaceChildren();
      return;
    }
    // new Date(0) para no descartar horarios "pasados" de hoy: el turno se repite.
    const since = $("#f-since").value || nextDateFor(dow);
    const times = U.availableSlots(settings, nextDateFor(dow), Number(svc.duration), [], new Date(0))
      .filter((t) => !fixedClash({ dow, time: t, duration: svc.duration, since }));
    sel.replaceChildren(...(times.length
      ? times.map((t) => el("option", { value: t }, t))
      : [el("option", { value: "" }, "Sin horarios libres ese día")]));
  }

  function renderFixed() {
    const box = $("#fixed-list");
    if (!fixedList.length) {
      box.replaceChildren(el("p", { class: "empty" }, "Todavía no hay turnos fijos."));
      return;
    }
    box.replaceChildren(...WEEK_ORDER.map((dow) => {
      const items = fixedList.filter((f) => Number(f.dow) === dow).sort((a, b) => a.time.localeCompare(b.time));
      if (!items.length) return null;
      return el("div", { class: "day-group" },
        el("h3", {}, dayPlural(dow)),
        items.map((f) => el("div", { class: "booking" },
          el("span", { class: "when" }, f.time),
          el("div", { class: "who" },
            el("strong", {}, f.name),
            el("div", { class: "meta" }, f.service + " · " + EVERY_TEXT[f.every || 1].toLowerCase() + " · " + f.phone +
              " · desde el " + U.formatDayLong(f.since).toLowerCase())
          ),
          el("div", { class: "acts" },
            el("button", {
              class: "btn danger sm", type: "button",
              onclick: async () => {
                if (!confirm("¿Dar de baja el turno fijo de " + f.name + " (" + dayPlural(dow).toLowerCase() + " " + f.time + ")?")) return;
                await S.deleteFixed(f.id);
                toast("Turno fijo dado de baja");
                await loadFixed();
                renderBookings();
              }
            }, "Dar de baja")
          )
        ))
      );
    }).filter(Boolean));
  }

  async function loadFixed() {
    fixedList = await S.listFixed();
    renderFixed();
    refreshFixedTimes();
  }

  function prepareFixedForm() {
    if (!$("#f-dow").options.length) {
      $("#f-dow").replaceChildren(...WEEK_ORDER.map((d) => el("option", { value: String(d) }, dayPlural(d).toLowerCase())));
      $("#f-dow").value = String(new Date().getDay());
    }
    const current = $("#f-service").value;
    $("#f-service").replaceChildren(...settings.services.map((s) => el("option", { value: s.id }, s.name + " · " + s.duration + " min")));
    if (current) $("#f-service").value = current;
    if (!$("#f-since").value) $("#f-since").value = nextDateFor(Number($("#f-dow").value));
    loadFixed();
  }

  $("#f-dow").addEventListener("change", () => {
    $("#f-since").value = nextDateFor(Number($("#f-dow").value));
    refreshFixedTimes();
  });
  $("#f-service").addEventListener("change", refreshFixedTimes);
  $("#f-since").addEventListener("change", refreshFixedTimes);

  $("#fixed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#fixed-error");
    err.hidden = true;
    try {
      const dow = Number($("#f-dow").value);
      const svc = selectedService();
      const time = $("#f-time").value;
      const since = $("#f-since").value;
      const every = Number($("#f-every").value) || 1;
      const name = $("#f-name").value.trim();
      const phone = $("#f-phone").value.trim();
      if (!svc || !time) throw new Error("Elegí el servicio y un horario libre.");
      if (!since) throw new Error("Elegí desde qué fecha empieza.");
      if (U.parseDay(since).getDay() !== dow) throw new Error("La fecha de inicio tiene que caer " + U.DAY_NAMES[dow].toLowerCase() + ".");
      if (name.length < 2) throw new Error("Escribí el nombre.");
      if (phone.replace(/\D/g, "").length < 8) throw new Error("Escribí un teléfono válido.");

      const f = { dow, every, time, duration: Number(svc.duration), service: svc.name, name, phone, since, until: "", skips: [] };
      if (fixedClash(f)) throw new Error("Ya hay otro turno fijo ese día a esa hora.");

      // Turnos sueltos ya sacados en los días donde caería este fijo.
      const ahead = await S.listBookings(since, U.dateKey(U.addDays(U.parseDay(since), 90)));
      const blocked = ahead.filter((b) => !b.fixed && S.fixedOccurs(f, b.day) && timesClash(f, b));
      if (blocked.length) {
        throw new Error("Choca con turnos ya sacados: " +
          blocked.slice(0, 3).map((b) => U.formatDayLong(b.day) + " " + b.time + " (" + b.name + ")").join(", ") +
          ". Cancelalos o elegí otra fecha de inicio.");
      }

      await S.saveFixed(f);
      $("#f-name").value = "";
      $("#f-phone").value = "";
      toast("Turno fijo guardado");
      await loadFixed();
      renderBookings();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

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
