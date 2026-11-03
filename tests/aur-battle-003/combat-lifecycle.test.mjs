import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { beginOwnTurn, endBattle, endOwnTurn, resumeBattle, startBattle } from "../../scripts/battle/transitions.js";
import {
  bindBattleConsole,
  renderBattleConsole,
  updateBattleConsole,
} from "../../scripts/render/render-battle-console.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  getState,
  getSessionContext,
  openCharacterSession,
  retryPersistedState,
} from "../../scripts/state.js";
import {
  recordAttackDamage,
  recordAttackOutcome,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";

class FixtureElement {
  constructor(region = null) {
    this.dataset = {};
    this.ownerRegion = region;
    this.isConnected = true;
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  closest(selector) {
    if (selector === "[data-battle-command]" && this.dataset.battleCommand) return this;
    if (selector === "[data-battle-end-turn]" && this.dataset.battleEndTurn === "true") return this;
    return null;
  }
  focus() { globalThis.document.activeElement = this; }
}

class FixtureRegion extends FixtureElement {
  constructor() {
    super();
    this.hidden = false;
    this._innerHTML = "";
    this.className = "";
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(markup) {
    if (this._innerHTML !== markup && document.activeElement?.ownerRegion === this) {
      document.activeElement.isConnected = false;
    }
    this._innerHTML = markup;
  }
  contains(element) { return element?.ownerRegion === this; }
  querySelectorAll() { return []; }
}

class FixtureShell extends FixtureElement {
  constructor() {
    super();
    this.regions = new Map([
      [".sara-combat-shell", this],
      ["[data-sara-hud]", new FixtureRegion()],
      ["[data-sara-budget]", new FixtureRegion()],
      ["[data-sara-navigation]", new FixtureRegion()],
      ["[data-sara-pending-work]", new FixtureRegion()],
      ["[data-sara-turn-controls]", new FixtureRegion()],
      ["[data-sara-phase-content]", new FixtureRegion()],
      ["[data-sara-idle-content]", new FixtureRegion()],
      ["[data-sara-task-region]", new FixtureRegion()],
      ["[data-combat-workspace-root]", new FixtureRegion()],
      ["#battleConsoleTitle", new FixtureElement()],
    ]);
  }
  querySelector(selector) { return this.regions.get(selector) ?? null; }
}

class FixtureRoot extends FixtureElement {
  constructor() {
    super();
    this.shell = new FixtureShell();
    this.dataset.battleConsoleBound = "";
  }
  querySelector(selector) {
    if (selector === ".sara-combat-shell") return this.shell;
    if (selector === "[data-battle-status]") return this.shell.querySelector("[data-sara-turn-controls]");
    return null;
  }
  contains() { return true; }
  fire(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FixtureForm extends FixtureElement {
  constructor(region, value) {
    super(region);
    this.dataset.battleForm = "start";
    this.elements = { rawD20: { value } };
  }
}

function installBrowserFixture() {
  const memory = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  };
  globalThis.document = {
    activeElement: null,
    querySelector: () => null,
  };
  globalThis.Element = FixtureElement;
  globalThis.HTMLFormElement = FixtureForm;
}

function openSara() {
  installBrowserFixture();
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
}

function createConsole() {
  const root = new FixtureRoot();
  updateBattleConsole(root, getState());
  bindBattleConsole(root);
  return root;
}

function fireCommand(root, command, regionSelector) {
  const element = new FixtureElement(root.shell.querySelector(regionSelector));
  element.dataset.battleCommand = command;
  document.activeElement = element;
  root.fire("click", { target: element });
  return element;
}

test("focused initiative submit immediately replaces outside controls through the whole battle cycle", () => {
  openSara();
  const root = createConsole();
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const input = new FixtureElement(phase);
  const form = new FixtureForm(phase, "14");
  document.activeElement = input;
  root.fire("submit", { target: form, preventDefault() {} });

  assert.equal(getState().battleConsole.current.phase, "waiting");
  assert.doesNotMatch(phase.innerHTML, /data-battle-form="start"/);
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="begin-own-turn"/);
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="end-battle"/);

  fireCommand(root, "begin-own-turn", "[data-sara-turn-controls]");
  assert.equal(getState().battleConsole.current.phase, "own-turn");
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-end-turn/);
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="end-battle"/);

  const endTurn = new FixtureElement(root.shell.querySelector("[data-sara-turn-controls]"));
  endTurn.dataset.battleEndTurn = "true";
  document.activeElement = endTurn;
  root.fire("click", { target: endTurn });
  assert.equal(getState().battleConsole.current.phase, "waiting");
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="begin-own-turn"/);

  fireCommand(root, "end-battle", "[data-sara-turn-controls]");
  assert.equal(getState().battleConsole.current, null);
  assert.match(phase.innerHTML, /data-battle-form="start"/);
});

test("focused submit button and direct end-battle during own turn transition immediately", () => {
  openSara();
  const root = createConsole();
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const submitButton = new FixtureElement(phase);
  document.activeElement = submitButton;
  root.fire("submit", {
    target: new FixtureForm(phase, "12"),
    preventDefault() {},
  });
  assert.equal(getState().battleConsole.current.phase, "waiting");
  fireCommand(root, "begin-own-turn", "[data-sara-turn-controls]");

  getState().monk.combatAssistant = { activeSequences: [{
    id: "pending-sequence",
    kind: "attack-action",
    status: "open",
    maximumAttacks: 1,
    resolvedAttacks: [{ id: "pending-hit", damageStatus: "awaiting-damage" }],
  }] };
  fireCommand(root, "end-battle", "[data-sara-turn-controls]");
  assert.equal(getState().battleConsole.current, null);
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].damageStatus, "awaiting-damage");
  assert.match(phase.innerHTML, /data-battle-form="start"/);
});

test("Warrior's Spirit recovery is one per eligible new turn and uses the derived cap", () => {
  const character = structuredClone(sara);
  character.combat.ki.current = 5;
  const maximum = getDerivedStats(character).monk.kiMaximum;
  assert.ok(maximum > 5);
  startBattle(character, { rawD20: "10" }, { id: "recovery-battle" });
  assert.equal(character.combat.ki.current, 5);
  assert.equal(beginOwnTurn(character, { id: "recovery-turn" }).ok, true);
  assert.equal(character.combat.ki.current, 6);
  assert.equal(beginOwnTurn(character).ok, false);
  assert.equal(character.combat.ki.current, 6);
  character.combat.ki.current = maximum;
  endOwnTurn(character);
  beginOwnTurn(character, { id: "recovery-turn-2" });
  assert.equal(character.combat.ki.current, maximum);

  const lowerLevel = structuredClone(sara);
  lowerLevel.profile.level = 10;
  lowerLevel.combat.ki.current = 5;
  startBattle(lowerLevel, { rawD20: "10" }, { id: "lower-level-battle" });
  beginOwnTurn(lowerLevel, { id: "lower-level-turn" });
  assert.equal(lowerLevel.combat.ki.current, 5);
});

test("render and legacy resume do not repeat turn recovery; ending preserves recorded obligations", () => {
  const character = structuredClone(sara);
  character.combat.ki.current = 5;
  startBattle(character, { rawD20: "10" }, { id: "legacy-battle" });
  beginOwnTurn(character, { id: "legacy-turn" });
  const kiAfterStart = character.combat.ki.current;
  character.monk.combatAssistant = { activeSequences: [{
    id: "legacy-sequence",
    status: "open",
    resolvedAttacks: [{ id: "legacy-hit", damageStatus: "awaiting-damage" }],
  }] };
  character.battleConsole.current.phaseBeforePause = "own-turn";
  character.battleConsole.current.phase = "paused";
  character.ui.turn.actionUsed = true;
  character.ui.turn.bonusActionUsed = true;
  character.ui.turn.reactionUsed = true;
  assert.equal(resumeBattle(character).ok, true);
  assert.equal(character.combat.ki.current, kiAfterStart);
  globalThis.document ??= { querySelector: () => null };
  renderBattleConsole(character);
  renderBattleConsole(character);
  assert.equal(character.combat.ki.current, kiAfterStart);
  assert.equal(beginOwnTurn(character).ok, false);
  assert.equal(character.battleConsole.current.ownTurnNumber, 1);
  assert.equal(character.ui.turn.actionUsed, true);
  assert.equal(character.ui.turn.bonusActionUsed, true);
  assert.equal(character.ui.turn.reactionUsed, true);
  endBattle(character);
  assert.equal(character.battleConsole.history.at(-1).phase, "ended");
  assert.equal(character.monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].damageStatus, "awaiting-damage");
  assert.equal(character.combat.ki.current, kiAfterStart);
});

test("duplicate transition requests do not create turns, archives, or repeated recovery", () => {
  openSara();
  const kiBefore = getState().combat.ki.current;
  assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
  const battleId = getState().battleConsole.current.id;
  assert.equal(executeBattleCommand("start-battle", { rawD20: "20" }).status, "rejected");
  assert.equal(getState().battleConsole.current.id, battleId);

  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  const recoveredKi = getState().combat.ki.current;
  assert.equal(recoveredKi, Math.min(kiBefore + 1, getDerivedStats(getState()).monk.kiMaximum));
  assert.equal(executeBattleCommand("begin-own-turn").status, "rejected");
  assert.equal(getState().battleConsole.current.ownTurnNumber, 1);
  assert.equal(getState().combat.ki.current, recoveredKi);

  assert.equal(executeBattleCommand("end-own-turn").status, "applied");
  assert.equal(executeBattleCommand("end-own-turn").status, "rejected");
  assert.equal(executeBattleCommand("end-battle").status, "applied");
  assert.equal(executeBattleCommand("end-battle").status, "rejected");
  assert.equal(getState().battleConsole.history.filter((entry) => entry.id === battleId).length, 1);
});

test("recorded hit survives end-turn and end-battle, then historical damage resolves once", () => {
  openSara();
  executeBattleCommand("start-battle", { rawD20: "10" });
  executeBattleCommand("begin-own-turn");
  const sequence = startAttackSequence(
    getSessionContext(),
    { kind: "attack-action", sequenceId: "lifecycle-hit" },
    "lifecycle-hit-start",
  );
  assert.equal(sequence.status, "applied");
  const attack = recordAttackOutcome(
    getSessionContext(),
    "lifecycle-hit",
    "lifecycle-hit:1",
    {
      kind: "attack-action",
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "10",
      targetArmorClass: "10",
    },
    "lifecycle-hit-roll",
  );
  assert.equal(attack.status, "applied");
  const sequenceId = getState().monk.combatAssistant.activeSequences[0].id;
  const attackId = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].id;
  assert.equal(executeBattleCommand("end-own-turn").status, "applied");
  assert.equal(executeBattleCommand("end-battle").status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].damageStatus, "awaiting-damage");
  assert.equal(recordAttackDamage(
    getSessionContext(),
    sequenceId,
    attackId,
    ["3"],
    "lifecycle-damage",
  ).status, "applied");
  assert.notEqual(recordAttackDamage(
    getSessionContext(),
    sequenceId,
    attackId,
    ["3"],
    "lifecycle-damage-repeat",
  ).status, "applied");
});

test("failed persistence leaves the new phase visible and retry does not repeat transition", () => {
  openSara();
  const root = createConsole();
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("fixture persistence failure"); };
  const result = executeBattleCommand("start-battle", { rawD20: "10" });
  assert.equal(result.status, "applied");
  assert.equal(result.persistence.ok, false);
  updateBattleConsole(root, getState());
  assert.equal(getState().battleConsole.current.phase, "waiting");
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="begin-own-turn"/);

  window.localStorage.setItem = originalSetItem;
  assert.equal(retryPersistedState().ok, true);
  assert.equal(getState().battleConsole.current.phase, "waiting");
  assert.equal(getState().battleConsole.history.length, 0);
});

test("legacy paused contexts remain resumable or safely endable without a normal pause control", () => {
  const character = structuredClone(sara);
  startBattle(character, { rawD20: "10" }, { id: "paused-render-battle" });
  character.battleConsole.current.phase = "paused";
  character.battleConsole.current.phaseBeforePause = "waiting";
  let markup = renderBattleConsole(character);
  assert.match(markup, /data-battle-command="resume-battle"/);
  assert.match(markup, /data-battle-command="end-battle"/);
  assert.doesNotMatch(markup, /data-battle-command="pause-battle"/);

  character.battleConsole.current.phaseBeforePause = "unknown";
  markup = renderBattleConsole(character);
  assert.match(markup, /контекст приостановленной сцены повреждён/i);
  assert.match(markup, /data-battle-command="end-battle"/);
  assert.doesNotMatch(markup, /data-battle-command="resume-battle"/);

  const waiting = structuredClone(sara);
  startBattle(waiting, { rawD20: "10" }, { id: "paused-waiting-battle" });
  waiting.battleConsole.current.phaseBeforePause = "waiting";
  waiting.battleConsole.current.phase = "paused";
  const turnNumber = waiting.battleConsole.current.ownTurnNumber;
  assert.equal(resumeBattle(waiting).ok, true);
  assert.equal(waiting.battleConsole.current.phase, "waiting");
  assert.equal(waiting.battleConsole.current.ownTurnNumber, turnNumber);
});

test("same-context focused update defers, then phase change discards stale queued markup", async () => {
  openSara();
  const root = createConsole();
  const start = new FixtureElement(root.shell.querySelector("[data-sara-phase-content]"));
  startBattle(getState(), { rawD20: "10" }, { id: "context-battle" });
  updateBattleConsole(root, getState());
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const oldMarkup = phase.innerHTML;
  const activeInput = new FixtureElement(phase);
  activeInput.value = "11";
  document.activeElement = activeInput;
  getState().battleConsole.current.initiative.rawD20 = 11;
  updateBattleConsole(root, getState());
  assert.equal(phase.innerHTML, oldMarkup);
  assert.equal(document.activeElement, activeInput);
  assert.equal(activeInput.value, "11");

  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  updateBattleConsole(root, getState());
  assert.equal(document.activeElement, root.shell.querySelector("#battleConsoleTitle"));
  document.activeElement = null;
  root.fire("focusout", { target: start });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(phase.innerHTML, /battle-menu-panel/);
  assert.doesNotMatch(phase.innerHTML, /Инициатива:/);
  assert.equal(root.shell.dataset.playerScenePhase, "own-turn");
});
