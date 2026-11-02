// Página pública donde el cliente saca su turno.
(async function () {
  const U = window.Utils;
  const S = window.Store;
  const $ = (s) => document.querySelector(s);
  const el = U.el;

  const state = { settings: null, busy: [], service: null, day: null, time: null };

  function setPressed(container, btn) {
    container.querySelectorAll(".opt").forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", "true");
  }

  function daysRange() {
    const today = new Date();
    const n = Math.max(1, Number(state.settings.daysAhead) || 14);
    return Array.from({ length: n }, (_, i) => U.dateKey(U.addDays(today, i)));
  }

  async function loadBusy() {
    const days = daysRange();
    state.busy = await S.getBusy(days[0], days[days.length - 1]);
  }

  function renderServices() {
    const box = $("#services");
    box.replaceChildren(...state.settings.services.map((svc) => {
      const btn = el("button", {
        class: "opt", type: "button", "aria-pressed": "false",
        onclick: () => {
          state.service = svc;
          state.day = null;
          state.time = null;
          setPressed(box, btn);
          renderDays();
          $("#step-day").hidden = false;
          $("#step-time").hidden = true;
          $("#step-form").hidden = true;
          $("#step-day").scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      },
        el("strong", {}, svc.name),
        el("span", { class: "meta" }, svc.duration + " min" + (svc.price ? " · " + U.money(svc.price) : ""))
      );
      return btn;
    }));
    if (!state.settings.services.length) {
      box.replaceChildren(el("p", { class: "empty" }, "Todavía no hay servicios cargados."));
    }
  }

  function renderDays() {
    const box = $("#days");
    const now = new Date();
    box.replaceChildren(...daysRange().map((day) => {
      const d = U.parseDay(day);
      const free = U.availableSlots(state.settings, day, state.service.duration, state.busy, now);
      const btn = el("button", {
        class: "opt day", type: "button", "aria-pressed": "false",
        disabled: free.length === 0,
        title: free.length ? free.length + " horarios libres" : "Sin horarios",
        onclick: () => {
          state.day = day;
          state.time = null;
          setPressed(box, btn);
          renderTimes();
          $("#step-time").hidden = false;
          $("#step-form").hidden = true;
          $("#step-time").scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      },
        el("span", { class: "dow" }, U.DAY_SHORT[d.getDay()]),
        el("span", { class: "num" }, d.getDate())
      );
      return btn;
    }));
  }

  function renderTimes() {
    const box = $("#times");
    const free = U.availableSlots(state.settings, state.day, state.service.duration, state.busy, new Date());
    if (!free.length) {
      box.replaceChildren(el("p", { class: "empty" }, "No quedan horarios libres este día."));
      return;
    }
    box.replaceChildren(...free.map((t) => {
      const btn = el("button", {
        class: "opt time", type: "button", "aria-pressed": "false",
        onclick: () => {
          state.time = t;
          setPressed(box, btn);
          $("#summary").textContent = state.service.name + " · " + U.formatDayLong(state.day) + " a las " + t + " hs";
          $("#step-form").hidden = false;
          $("#step-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
          $("#name").focus({ preventScroll: true });
        }
      }, t);
      return btn;
    }));
  }

  function showError(msg) {
    const p = $("#form-error");
    p.textContent = msg;
    p.hidden = !msg;
  }

  $("#booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#name").value.trim();
    const phone = $("#phone").value.trim();
    if (name.length < 2) return showError("Escribí tu nombre.");
    if (phone.replace(/\D/g, "").length < 8) return showError("Escribí un número de WhatsApp válido.");
    showError("");

    const btn = $("#submit");
    btn.disabled = true;
    btn.textContent = "Reservando…";
    try {
      await S.createBooking({
        day: state.day, time: state.time, duration: state.service.duration,
        service: state.service.name, name, phone
      });
      showDone(name);
    } catch (err) {
      if (String(err.message).includes("ocupado")) {
        showError("Ese horario se acaba de ocupar. Elegí otro, por favor.");
        await loadBusy();
        renderDays();
        renderTimes();
        $("#step-form").hidden = true;
      } else {
        showError("No se pudo reservar. Probá de nuevo en un momento.");
        console.error(err);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Confirmar turno";
    }
  });

  function showDone(name) {
    const s = state.settings;
    const when = U.formatDayLong(state.day) + " a las " + state.time + " hs";
    $("#done-text").textContent = state.service.name + " · " + when;
    const wa = $("#done-wa");
    if (s.whatsapp) {
      wa.href = U.waLink(s.whatsapp,
        "Hola! Soy " + name + ", reservé un turno para " + state.service.name + " el " + when + ".");
      wa.hidden = false;
    } else {
      wa.hidden = true;
    }
    $("#flow").hidden = true;
    $("#done").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#again").addEventListener("click", async () => {
    $("#booking-form").reset();
    $("#done").hidden = true;
    $("#flow").hidden = false;
    ["#step-day", "#step-time", "#step-form"].forEach((s) => ($(s).hidden = true));
    state.service = state.day = state.time = null;
    await loadBusy();
    renderServices();
  });

  try {
    state.settings = await S.getSettings();
    $("#biz-name").textContent = state.settings.businessName;
    $("#biz-address").textContent = state.settings.address || "Reservá tu turno online";
    document.title = "Turnos · " + state.settings.businessName;
    $("#demo-banner").hidden = S.isRemote;
    await loadBusy();
    renderServices();
  } catch (err) {
    console.error(err);
    $("#services").replaceChildren(el("p", { class: "error" }, "No se pudo cargar la agenda. Recargá la página."));
  }
})();
