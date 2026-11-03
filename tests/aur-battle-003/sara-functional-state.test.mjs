import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { getCharacterDescriptor } from "../../scripts/characters.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { changeQuantity } from "../../scripts/sara-functional.js";
import { changeSaraItemQuantity } from "../../scripts/actions/sara-functional.js";
import {
  commitFunctionalSessionOperation,
  getSessionContext,
  getState,
  openCharacterSession,
  retryPersistedState,
} from "../../scripts/state.js";
import { loadCharacterState } from "../../scripts/storage.js";

function installStorage(t, { failWrites = false } = {}) {
  const values = new Map();
  const previousWindow = globalThis.window;
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (failWrites) throw new Error("storage unavailable");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
  globalThis.window = { localStorage: storage };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return { storage, values };
}

test("missing Sara is initialized with full derived resources and canonical starter inventory", (t) => {
  installStorage(t);
  const opened = openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const state = opened.state;
  const derived = getDerivedStats(state);

  assert.equal(opened.status, "missing");
  assert.equal(state.combat.hp.current, derived.maxHitPoints);
  assert.equal(state.combat.hp.temp, 0);
  assert.equal(state.combat.ki.current, derived.monk.kiMaximum);
  assert.equal(state.combat.practiced.current, derived.monk.practicedMaximum);
  assert.equal(state.combat.hitDice.remaining, state.profile.level);
  assert.equal(state.inventory.items.length, 22);
  assert.equal(state.inventory.currency.gp, 15);
  assert.equal(state.inventory.items.find((item) => item.id === "darts").quantity, 20);
  assert.equal(state.inventory.items.find((item) => item.id === "club").equipped, false);
  assert.equal(state.battleConsole.current, null);
  assert.equal(state.monk.replacementEntitlements.length, 0);
});

test("existing Sara is adopted before merge without resetting spent resources or custom details", (t) => {
  installStorage(t);
  const saved = structuredClone(sara);
  saved.combat.hp.current = 7;
  saved.combat.ki.current = 2;
  saved.inventory.items[0].notes = "Пользовательская запись";
  const opened = openCharacterSession("sara-velaris", () => ({
    status: "loaded",
    state: saved,
    migrations: [],
  }));

  assert.equal(opened.status, "loaded");
  assert.ok(opened.migrations.includes("sara-starter-manifest"));
  assert.equal(opened.state.combat.hp.current, 7);
  assert.equal(opened.state.combat.ki.current, 2);
  assert.equal(opened.state.inventory.items.find((item) => item.id === "amulet-of-health").notes,
    "Пользовательская запись");
  assert.equal(opened.state.inventory.items.length, 22);
  assert.equal(opened.state.inventory.currency.gp, 15);
  assert.equal(opened.state.monk.ordinaryTechniqueIds.length, saved.monk.ordinaryTechniqueIds.length);
});

test("functional quantity receipts replay without mutation and reject payload reuse", (t) => {
  installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const item = getState().inventory.items.find((entry) => entry.id === "darts");
  const id = "quantity-darts-1";
  const first = commitFunctionalSessionOperation(
    getSessionContext(),
    id,
    (state) => changeQuantity(state, { id, itemId: item.id, mode: "delta", value: 3 }),
    { metadata: { kind: "functional-quantity" } },
  );
  assert.equal(first.status, "applied");
  assert.equal(getState().inventory.items.find((entry) => entry.id === item.id).quantity, 23);

  const replay = commitFunctionalSessionOperation(
    getSessionContext(),
    id,
    (state) => changeQuantity(state, { id, itemId: item.id, mode: "delta", value: 3 }),
  );
  assert.equal(replay.status, "replayed");
  assert.equal(getState().inventory.items.find((entry) => entry.id === item.id).quantity, 23);

  const conflict = commitFunctionalSessionOperation(
    getSessionContext(),
    id,
    (state) => changeQuantity(state, { id, itemId: item.id, mode: "delta", value: 4 }),
  );
  assert.equal(conflict.status, "rejected");
  assert.match(conflict.reason, /different request/i);
  assert.equal(getState().inventory.items.find((entry) => entry.id === item.id).quantity, 23);
});

test("inventory quantity adapter commits a guarded Sara quantity operation", (t) => {
  installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const result = changeSaraItemQuantity(getSessionContext(), {
    id: "inventory-darts-plus-one",
    itemId: "darts",
    mode: "delta",
    value: 1,
  });
  assert.equal(result.status, "applied");
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 21);
  assert.equal(getState().monk.functionalRuntime.operations["inventory-darts-plus-one"].kind,
    "quantity");
});

test("owner validation precedes durable receipt replay", (t) => {
  installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const oldOwner = getSessionContext();
  const id = "quantity-owner-check";
  const first = commitFunctionalSessionOperation(oldOwner, id, (state) =>
    changeQuantity(state, { id, itemId: "darts", mode: "delta", value: 1 }));
  assert.equal(first.status, "applied");

  openCharacterSession("aurelia", () => ({ status: "missing" }));
  const staleReplay = commitFunctionalSessionOperation(oldOwner, id, (state) =>
    changeQuantity(state, { id, itemId: "darts", mode: "delta", value: 1 }));
  assert.equal(staleReplay.status, "rejected");
  assert.equal(staleReplay.reason, "stale-session");
  assert.equal(getState().profile.id, "aurelia");
});

test("applied-unsaved quantity change is retried as a save, not repeated gameplay", (t) => {
  installStorage(t, { failWrites: true });
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const id = "quantity-unsaved";
  const result = commitFunctionalSessionOperation(getSessionContext(), id, (state) =>
    changeQuantity(state, { id, itemId: "darts", mode: "delta", value: -1 }));
  assert.equal(result.status, "applied");
  assert.equal(result.persistence.ok, false);
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 19);

  globalThis.window.localStorage.setItem = () => {};
  assert.equal(retryPersistedState().ok, true);
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 19);
});

test("raw optional extensions with unsupported versions are rejected by storage loading", (t) => {
  const { storage, values } = installStorage(t);
  const descriptor = getCharacterDescriptor("sara-velaris");
  const invalid = structuredClone(sara);
  invalid.monk.functionalRuntime = { version: 2, operations: {}, rest: null };
  values.set(descriptor.storageKey, JSON.stringify(invalid));
  const loaded = loadCharacterState(descriptor, { storage });
  assert.equal(loaded.status, "invalid");
  assert.match(loaded.reason, /Unsupported functionalRuntime version/i);
});
