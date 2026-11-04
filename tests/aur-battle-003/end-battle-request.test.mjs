import test from "node:test";
import assert from "node:assert/strict";
import { openCharacterSession, getState, getSessionContext, subscribe, retryPersistedState } from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { requestEndBattle } from "../../scripts/workspace/controller.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";

function setup() {
  const storage = new Map();
  globalThis.window = { confirm: () => true, localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  } };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  globalThis.document = { dispatchEvent() {}, querySelector() { return null; } };
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  executeBattleCommand("start-battle", { rawD20: "10" });
  return { storage, owner: getSessionContext() };
}

function end(owner, confirm = () => true, battleId = getState().battleConsole.current.id) {
  return requestEndBattle({ owner, battleId }, { confirm });
}

test("waiting and own-turn requests end only the active battle", () => {
  const { owner } = setup();
  const id = getState().battleConsole.current.id;
  assert.equal(end(owner).status, "applied");
  assert.equal(getState().battleConsole.current, null);
  assert.equal(getState().battleConsole.history.filter((entry) => entry.id === id).length, 1);
  setup();
  const currentOwner = getSessionContext();
  executeBattleCommand("begin-own-turn");
  assert.equal(end(currentOwner).status, "applied");
  setup();
  const pausedOwner = getSessionContext();
  const current = getState().battleConsole.current;
  current.phase = "paused";
  assert.equal(end(pausedOwner).status, "applied");
});

test("persistence failure applies the end once and leaves state available for retry", () => {
  const { owner, storage } = setup();
  window.localStorage.setItem = () => { throw new Error("fixture storage failure"); };
  const result = end(owner);
  assert.equal(result.status, "applied");
  assert.equal(result.persistence.ok, false);
  assert.equal(getState().battleConsole.current, null);
  assert.equal(getState().battleConsole.history.filter((entry) => entry.phase === "ended").length, 1);
  window.localStorage.setItem = (key, value) => storage.set(key, String(value));
  assert.equal(retryPersistedState().ok, true);
  assert.equal(getState().battleConsole.history.filter((entry) => entry.phase === "ended").length, 1);
});

test("subscriber exception after commit is recognized from archive evidence without repeating end", () => {
  const { owner } = setup();
  const unsubscribe = subscribe((_state, metadata) => {
    if (metadata?.kind === "battle-command" && metadata.command === "end-battle") {
      throw new Error("fixture subscriber failure after commit");
    }
  });
  const result = end(owner);
  unsubscribe();
  assert.equal(result.status, "applied");
  assert.equal(result.persistenceUnconfirmed, true);
  assert.equal(getState().battleConsole.current, null);
  assert.equal(getState().battleConsole.history.filter((entry) => entry.phase === "ended").length, 1);
});

test("cancel leaves state and Map-backed storage unchanged", () => {
  const { owner, storage } = setup();
  const before = structuredClone(getState());
  const saved = new Map(storage);
  assert.equal(end(owner, () => false).status, "cancelled");
  assert.deepEqual(getState(), before);
  assert.deepEqual(storage, saved);
});

test("stale owner and stale battle id are rejected", () => {
  const { owner } = setup();
  assert.equal(end({ ...owner, sessionGeneration: owner.sessionGeneration - 1 }).status, "rejected");
  const initialId = getState().battleConsole.current.id;
  executeBattleCommand("end-battle");
  executeBattleCommand("start-battle", { rawD20: "11" });
  const active = getState().battleConsole.current;
  assert.notEqual(active.id, initialId);
  assert.equal(end(owner, () => true, initialId).status, "rejected");
  assert.equal(getState().battleConsole.current.id, active.id);
});

test("interactive rendering requires an explicit matching owner and presents a non-submit button", () => {
  const { owner } = setup();
  const state = getState();
  const outside = structuredClone(state);
  outside.battleConsole.current = null;
  assert.doesNotMatch(renderBattleConsole(outside, { panel: "home", ownerKey: JSON.stringify([owner.characterId, owner.sessionGeneration]) }), /data-sara-end-battle/);
  const markup = renderBattleConsole(state, {
    panel: "initiative-correct",
    ownerKey: JSON.stringify([owner.characterId, owner.sessionGeneration]),
  });
  assert.match(markup, /<button type="button" data-sara-end-battle/);
  assert.match(markup, /data-battle-id=/);
  assert.match(markup, /data-battle-owner=/);
});
