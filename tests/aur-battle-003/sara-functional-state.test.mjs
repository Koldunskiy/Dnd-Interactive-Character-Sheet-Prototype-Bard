import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { getCharacterDescriptor } from "../../scripts/characters.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { adoptStarter, changeQuantity, previewPotion } from "../../scripts/sara-functional.js";
import {
  changeSaraItemQuantity,
  useSaraPotion,
} from "../../scripts/actions/sara-functional.js";
import {
  commitFunctionalSessionOperation,
  getSessionContext,
  getState,
  openCharacterSession,
  retryPersistedState,
  updateState,
  updateFunctionalSessionState,
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

test("functional apply and replay expose the same outcome, and failed candidates roll back", (t) => {
  installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const intent = { id: "quantity-outcome", kind: "quantity", payload: {
    itemId: "darts", mode: "delta", value: 2,
  } };
  const first = updateFunctionalSessionState(getSessionContext(), intent, (draft) => {
    const item = draft.inventory.items.find((entry) => entry.id === "darts");
    const before = item.quantity;
    item.quantity += 2;
    return { itemId: item.id, before, after: item.quantity };
  });
  assert.equal(first.status, "applied");
  assert.deepEqual(first.outcome, { itemId: "darts", before: 20, after: 22 });

  const replay = updateFunctionalSessionState(getSessionContext(), intent, () => {
    throw new Error("receipt replay must not execute mutation");
  });
  assert.equal(replay.status, "replayed");
  assert.deepEqual(replay.outcome, first.outcome);
  assert.equal(getState().inventory.items.find((entry) => entry.id === "darts").quantity, 22);

  const beforeRevision = getSessionContext().stateRevision;
  const rejected = commitFunctionalSessionOperation(getSessionContext(), "candidate-throws",
    (candidate) => {
      candidate.inventory.items.find((entry) => entry.id === "darts").quantity = 0;
      throw new Error("candidate failed");
    });
  assert.equal(rejected.status, "rejected");
  assert.equal(getSessionContext().stateRevision, beforeRevision);
  assert.equal(getState().inventory.items.find((entry) => entry.id === "darts").quantity, 22);
  assert.equal(Object.hasOwn(getState().monk.functionalRuntime.operations, "candidate-throws"), false);
});

test("durable quantity receipt reloads and replays without another stock change", (t) => {
  const { storage } = installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const request = { id: "durable-dart-stock", itemId: "darts", mode: "delta", value: 1 };
  const first = changeSaraItemQuantity(getSessionContext(), request);
  assert.equal(first.status, "applied");
  assert.equal(first.persistence.ok, true);
  const saved = storage.getItem(getCharacterDescriptor("sara-velaris").storageKey);
  assert.ok(saved);

  const reloaded = openCharacterSession("sara-velaris");
  assert.equal(reloaded.status, "loaded");
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 21);
  const replay = changeSaraItemQuantity(getSessionContext(), request);
  assert.equal(replay.status, "replayed");
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 21);
});

test("potion route applies the matching bottle, reports outcome, and replays safely", (t) => {
  installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.combat.hp.current = 1;
    draft.inventory.items.find((item) => item.id === "healing-potion").quantity = 1;
    return draft;
  });
  const request = {
    id: "potion-route-use-1",
    potionId: "healing-potion",
    itemId: "healing-potion",
    target: "self",
    sum: "7",
  };
  const before = getState().combat.hp.current;
  const applied = useSaraPotion(getSessionContext(), request);
  assert.equal(applied.status, "applied");
  assert.equal(applied.outcome.sum, 7);
  assert.equal(applied.outcome.healing, 9);
  assert.equal(getState().combat.hp.current, before + 9);
  assert.equal(getState().inventory.items.find((item) => item.id === "healing-potion").quantity, 0);

  const replay = useSaraPotion(getSessionContext(), request);
  assert.equal(replay.status, "replayed");
  assert.deepEqual(replay.outcome, applied.outcome);
  assert.equal(getState().combat.hp.current, before + 9);
});

test("potion binding cannot redirect a potion to darts and deleted stock is not refilled", (t) => {
  installStorage(t);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const corrupted = structuredClone(getState());
  corrupted.inventory.starterManifest.bindings["greater-healing-potion"] = "darts";
  assert.throws(() => previewPotion(corrupted, {
    potionId: "greater-healing-potion",
    itemId: "darts",
    target: "self",
    sum: 10,
  }, getDerivedStats));
  assert.throws(() => adoptStarter(corrupted), /Conflicting starter bindings/i);

  const deleted = structuredClone(getState());
  deleted.inventory.items = deleted.inventory.items.filter((item) => item.id !== "healing-potion");
  const adoption = adoptStarter(deleted);
  assert.equal(adoption.changed, false);
  assert.equal(adoption.state.inventory.items.some((item) => item.id === "healing-potion"), false);
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
