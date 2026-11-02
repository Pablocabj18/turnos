// Funciones de ayuda compartidas entre la página de reservas y el panel.
(function () {
  const pad = (n) => String(n).padStart(2, "0");

  const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function toMin(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function fromMin(min) {
    return pad(Math.floor(min / 60)) + ":" + pad(min % 60);
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function parseDay(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function formatDayLong(s) {
    const d = parseDay(s);
    return DAY_NAMES[d.getDay()] + " " + d.getDate() + " de " + MONTHS[d.getMonth()];
  }

  function money(n) {
    if (n === null || n === undefined || n === "" || isNaN(n)) return "";
    return "$" + Number(n).toLocaleString("es-AR");
  }

  function waLink(phone, text) {
    const digits = String(phone || "").replace(/\D/g, "");
    return "https://wa.me/" + digits + "?text=" + encodeURIComponent(text);
  }

  // Crea un elemento DOM sin usar innerHTML (evita inyectar HTML con datos del usuario).
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Horarios libres de un día para un servicio de `duration` minutos.
  function availableSlots(settings, day, duration, busy, now) {
    const d = parseDay(day);
    const h = settings.hours[String(d.getDay())];
    if (!h || !h.start || !h.end) return [];

    const start = toMin(h.start);
    const end = toMin(h.end);
    const hasBreak = h.breakStart && h.breakEnd;
    const bs = hasBreak ? toMin(h.breakStart) : 0;
    const be = hasBreak ? toMin(h.breakEnd) : 0;
    const step = Number(settings.slotMinutes) || 30;
    const isToday = day === dateKey(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const dayBusy = busy.filter((b) => b.day === day);

    const out = [];
    for (let t = start; t + duration <= end; t += step) {
      if (isToday && t <= nowMin) continue;
      if (hasBreak && t < be && t + duration > bs) continue;
      const clash = dayBusy.some((b) => {
        const bt = toMin(b.time);
        return t < bt + b.duration && t + duration > bt;
      });
      if (!clash) out.push(fromMin(t));
    }
    return out;
  }

  window.Utils = {
    pad, toMin, fromMin, dateKey, parseDay, addDays, formatDayLong, money, waLink, el,
    availableSlots, DAY_NAMES, DAY_SHORT
  };
})();
