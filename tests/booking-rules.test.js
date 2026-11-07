const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function createStore() {
  const values = new Map();
  const window = { APP_CONFIG: {} };
  const context = {
    window,
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    console,
    Date,
    Math,
    JSON,
    Node: class Node {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js/utils.js"), "utf8"), context, { filename: "js/utils.js" });
  context.Utils = window.Utils;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js/store.js"), "utf8"), context, { filename: "js/store.js" });
  return window.Store;
}

function settings() {
  const hours = Object.fromEntries(Array.from({ length: 7 }, (_, dow) => [String(dow), {
    start: "09:00", end: "17:00", breakStart: "13:00", breakEnd: "14:00"
  }]));
  return { daysAhead: 30, slotMinutes: 30, services: [{ name: "Corte", duration: 60 }], hours };
}

function futureDay(offset = 2) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("acepta reservas con servicio y horario configurados", () => {
  assert.doesNotThrow(() => createStore().validateBooking(settings(), {
    day: futureDay(), time: "10:00", duration: 60, service: "Corte"
  }));
});

test("rechaza reservas fuera del horario o durante la pausa", () => {
  const store = createStore();
  assert.throws(() => store.validateBooking(settings(), {
    day: futureDay(), time: "16:30", duration: 60, service: "Corte"
  }), /fuera_de_horario/);
  assert.throws(() => store.validateBooking(settings(), {
    day: futureDay(), time: "13:00", duration: 60, service: "Corte"
  }), /durante_pausa/);
});

test("rechaza horarios fuera de la grilla y servicios alterados", () => {
  const store = createStore();
  assert.throws(() => store.validateBooking(settings(), {
    day: futureDay(), time: "10:15", duration: 60, service: "Corte"
  }), /horario_invalido/);
  assert.throws(() => store.validateBooking(settings(), {
    day: futureDay(), time: "10:00", duration: 30, service: "Corte"
  }), /servicio_invalido/);
});
