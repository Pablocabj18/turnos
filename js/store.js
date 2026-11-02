// Capa de datos: usa Supabase si está configurado, si no guarda en el navegador (modo demo).
(function () {
  const cfg = window.APP_CONFIG || {};

  const DEFAULT_SETTINGS = {
    businessName: "Mi Peluquería",
    address: "",
    whatsapp: "",
    slotMinutes: 30,
    daysAhead: 14,
    services: [
      { id: "corte", name: "Corte", duration: 30, price: 8000 },
      { id: "corte-barba", name: "Corte + barba", duration: 45, price: 11000 },
      { id: "color", name: "Color", duration: 90, price: 25000 }
    ],
    // Clave = día de la semana (0 = domingo). null = cerrado.
    hours: {
      "0": null,
      "1": { start: "09:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
      "2": { start: "09:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
      "3": { start: "09:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
      "4": { start: "09:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
      "5": { start: "09:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" },
      "6": { start: "09:00", end: "14:00", breakStart: "", breakEnd: "" }
    }
  };

  function withDefaults(data) {
    const s = Object.assign({}, DEFAULT_SETTINGS, data || {});
    s.hours = Object.assign({}, DEFAULT_SETTINGS.hours, (data && data.hours) || {});
    return s;
  }

  function overlaps(a, b) {
    const at = Utils.toMin(a.time), bt = Utils.toMin(b.time);
    return a.day === b.day && at < bt + b.duration && at + a.duration > bt;
  }

  // ---------- Modo demo (localStorage) ----------
  const LS_SETTINGS = "turnos.settings";
  const LS_BOOKINGS = "turnos.bookings";

  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      throw new Error("No se pudo guardar en este navegador.");
    }
  }

  const localStore = {
    isRemote: false,
    async getSettings() { return withDefaults(lsGet(LS_SETTINGS, null)); },
    async saveSettings(s) { lsSet(LS_SETTINGS, s); },
    async getBusy(from, to) {
      return lsGet(LS_BOOKINGS, [])
        .filter((b) => b.status === "confirmed" && b.day >= from && b.day <= to);
    },
    async createBooking(b) {
      const all = lsGet(LS_BOOKINGS, []);
      if (all.some((x) => x.status === "confirmed" && overlaps(b, x))) throw new Error("ocupado");
      const booking = Object.assign({ id: String(Date.now()), status: "confirmed" }, b);
      all.push(booking);
      lsSet(LS_BOOKINGS, all);
      return booking.id;
    },
    async listBookings(from) {
      return lsGet(LS_BOOKINGS, [])
        .filter((b) => b.status === "confirmed" && b.day >= from)
        .sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
    },
    async cancelBooking(id) {
      const all = lsGet(LS_BOOKINGS, []);
      const b = all.find((x) => x.id === id);
      if (b) b.status = "cancelled";
      lsSet(LS_BOOKINGS, all);
    },
    async getSession() { return { local: true }; },
    async signIn() {},
    async signOut() {}
  };

  // ---------- Supabase ----------
  function makeRemoteStore() {
    const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const check = ({ data, error }) => {
      if (error) throw new Error(error.message);
      return data;
    };
    const normalize = (r) => ({
      id: r.id, day: r.day, time: String(r.start_time).slice(0, 5), duration: r.duration,
      service: r.service, name: r.name, phone: r.phone, status: r.status
    });

    return {
      isRemote: true,
      async getSettings() {
        const row = check(await db.from("settings").select("data").eq("id", 1).maybeSingle());
        return withDefaults(row && row.data);
      },
      async saveSettings(s) {
        check(await db.from("settings").upsert({ id: 1, data: s }));
      },
      async getBusy(from, to) {
        const rows = check(await db.rpc("get_busy", { d_from: from, d_to: to }));
        return rows.map((r) => ({ day: r.day, time: r.start_time, duration: r.duration }));
      },
      async createBooking(b) {
        return check(await db.rpc("create_booking", {
          p_day: b.day, p_time: b.time, p_duration: b.duration,
          p_service: b.service, p_name: b.name, p_phone: b.phone
        }));
      },
      async listBookings(from) {
        const rows = check(await db.from("bookings").select("*")
          .eq("status", "confirmed").gte("day", from)
          .order("day").order("start_time"));
        return rows.map(normalize);
      },
      async cancelBooking(id) {
        check(await db.from("bookings").update({ status: "cancelled" }).eq("id", id));
      },
      async getSession() {
        return check(await db.auth.getSession()).session;
      },
      async signIn(email, password) {
        check(await db.auth.signInWithPassword({ email, password }));
      },
      async signOut() {
        await db.auth.signOut();
      }
    };
  }

  const useRemote = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase;
  window.Store = useRemote ? makeRemoteStore() : localStore;
})();
