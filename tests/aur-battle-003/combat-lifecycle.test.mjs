import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { beginOwnTurn, endBattle, endOwnTurn, resumeBattle, startBattle } from "../../scripts/battle/transitions.js";
import {
  battleContextKey,
  bindBattleConsole,
  clearBattleConsolePresentation,
  renderBattleConsole,
  updateBattleConsole,
} from "../../scripts/render/render-battle-console.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { getSaraInitiativeSnapshot } from "../../scripts/battle/providers/sara.js";
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
    if (selector === "[data-battle-scene-action]" && this.dataset.battleSceneAction) return this;
    if (selector === "[data-battle-menu]" && this.dataset.battleMenu) return this;
    if (selector === "[data-battle-navigate]" && this.dataset.battleNavigate) return this;
    if (selector === "[data-initiative-entry]" && this.dataset.initiativeEntry) return this;
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
      ["[data-sara-hud-heading]", new FixtureRegion()],
      ["[data-sara-home-hud]", new FixtureRegion()],
      ["[data-sara-budget]", new FixtureRegion()],
      ["[data-sara-navigation]", new FixtureRegion()],
      ["[data-sara-pending-work]", new FixtureRegion()],
      ["[data-sara-turn-controls]", new FixtureRegion()],
      ["[data-sara-phase-content]", new FixtureRegion()],
      ["[data-initiative-total]", new FixtureElement()],
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
    if (selector === "[data-initiative-total]") return this.shell.querySelector(selector);
    return null;
  }
  contains() { return true; }
  fire(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FixtureForm extends FixtureElement {
  constructor(region, value, owner, sceneKey) {
    super(region);
    this.dataset.battleForm = "start";
    this.dataset.owner = JSON.stringify([owner.characterId, owner.sessionGeneration]);
    this.dataset.scene = sceneKey;
    this.elements = { rawD20: { value } };
  }
}

function installBrowserFixture() {
  const memory = new Map();
  globalThis.window = {
    confirm: () => true,
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  };
  globalThis.document = {
    activeElement: null,
    querySelector: () => null,
    dispatchEvent: () => true,
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

function openInitiativeForm(root, phase, value) {
  const action = new FixtureElement(phase);
  action.dataset.battleSceneAction = "initiative";
  root.fire("click", { target: action });
  const context = getSessionContext();
  const owner = {
    characterId: context.characterId,
    sessionGeneration: context.sessionGeneration,
  };
  return new FixtureForm(phase, value, owner, battleContextKey(getState()));
}

test("initiative preparation and cancel leave game state unchanged", () => {
  openSara();
  const root = createConsole();
  const before = JSON.stringify(getState());
  const openButton = new FixtureElement(root.shell.querySelector("[data-sara-turn-controls]"));
  openButton.dataset.battleSceneAction = "initiative";
  document.activeElement = openButton;
  root.fire("click", { target: openButton });
  assert.match(root.shell.querySelector("[data-sara-phase-content]").innerHTML,
    /data-battle-form="start"/);
  assert.equal(JSON.stringify(getState()), before);

  const cancel = new FixtureElement(root.shell.querySelector("[data-sara-phase-content]"));
  cancel.dataset.battleMenu = "home";
  root.fire("click", { target: cancel });
  assert.doesNotMatch(root.shell.querySelector("[data-sara-phase-content]").innerHTML,
    /data-battle-form="start"/);
  assert.equal(JSON.stringify(getState()), before);
});

test("incoming-event selector closes through the delegated home route", () => {
  openSara();
  assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
  const root = createConsole();
  const incoming = new FixtureElement(root.shell.querySelector("[data-sara-phase-content]"));
  incoming.dataset.battleMenu = "incoming";
  root.fire("click", { target: incoming });
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  assert.match(phase.innerHTML, /class="battle-incoming-events"/);
  assert.match(phase.innerHTML, /data-battle-menu="home">Назад/);

  const close = new FixtureElement(phase);
  close.dataset.battleMenu = "home";
  root.fire("click", { target: close });
  assert.doesNotMatch(phase.innerHTML, /class="battle-incoming-events"/);
});

test("initiative keyboard presentation cleanup removes viewport listeners and inline styles", () => {
  openSara();
  const root = createConsole();
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    notify() { this.callback([]); }
  };
  const panel = { hidden: false };
  root.parentElement = panel;
  const listeners = new Map([["resize", new Set()], ["scroll", new Set()]]);
  globalThis.visualViewport = {
    height: 420,
    offsetTop: 24,
    addEventListener(type, listener) { listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type).delete(listener); },
  };
  const styles = new Map();
  const form = {
    dataset: {},
    style: {
      set position(value) { styles.set("position", value); },
      set top(value) { styles.set("top", value); },
      set left(value) { styles.set("left", value); },
      set right(value) { styles.set("right", value); },
      set height(value) { styles.set("height", value); },
      set zIndex(value) { styles.set("z-index", value); },
      removeProperty(name) { styles.delete(name); },
    },
  };
  const input = new FixtureElement();
  form.closest = (selector) => selector === "[hidden]" && panel.hidden ? panel : null;
  input.closest = (selector) => selector === "form" ? form
    : selector === "[data-initiative-entry]" ? input : null;
  root.fire("focusin", { target: input });
  assert.equal(form.dataset.initiativePresentation, "true");
  assert.equal(root.shell.dataset.initiativePresenting, "true");
  assert.equal(listeners.get("resize").size, 1);
  assert.equal(listeners.get("scroll").size, 1);
  assert.equal(styles.get("position"), "fixed");

  assert.ok(observers.some((observer) => observer.target === panel &&
    observer.options.attributes && observer.options.attributeFilter.includes("hidden")));
  panel.hidden = true;
  observers.at(-1).notify();
  assert.equal(form.dataset.initiativePresentation, undefined);
  assert.equal(root.shell.dataset.initiativePresenting, undefined);
  assert.equal(listeners.get("resize").size, 0);
  assert.equal(listeners.get("scroll").size, 0);
  assert.equal(styles.size, 0);
  delete globalThis.visualViewport;
  delete globalThis.MutationObserver;
});

test("empty, fractional, and out-of-range initiative inputs never start a battle", () => {
  for (const rawD20 of ["", "12.5", "0", "21"]) {
    openSara();
    const root = createConsole();
    const before = JSON.stringify(getState());
    const form = openInitiativeForm(root, root.shell.querySelector("[data-sara-phase-content]"), rawD20);
    root.fire("submit", { target: form, preventDefault() {} });
    assert.equal(getState().battleConsole.current, null);
    assert.equal(JSON.stringify(getState()), before);
    assert.match(root.shell.querySelector("[data-sara-phase-content]").innerHTML,
      /Введите целое число от 1 до 20/);
  }
});

test("invalid initiative draft remains editable and a corrected die previews and submits", () => {
  openSara();
  const root = createConsole();
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const invalidForm = openInitiativeForm(root, phase, "21");
  const invalidInput = new FixtureElement(phase);
  invalidInput.dataset.initiativeEntry = "true";
  invalidInput.dataset.modifier = "4";
  invalidInput.value = "21";
  root.fire("input", { target: invalidInput });
  root.fire("submit", { target: invalidForm, preventDefault() {} });
  assert.match(phase.innerHTML, /value="21"/);
  assert.match(phase.innerHTML, /Введите целое число от 1 до 20/);

  const correctedInput = new FixtureElement(phase);
  correctedInput.dataset.initiativeEntry = "true";
  const initiative = getSaraInitiativeSnapshot(getState());
  correctedInput.dataset.modifier = String(
    initiative.sources.reduce((total, source) => total + source.value, 0),
  );
  correctedInput.value = "16";
  root.fire("input", { target: correctedInput });
  assert.equal(root.shell.querySelector("[data-initiative-total]").textContent,
    String(16 + Number(correctedInput.dataset.modifier)));
  const correctedForm = openInitiativeForm(root, phase, "16");
  root.fire("submit", { target: correctedForm, preventDefault() {} });
  assert.equal(getState().battleConsole.current.initiative.total,
    16 + Number(correctedInput.dataset.modifier));
});

test("stale initiative forms cannot start a battle after owner or scene changes", () => {
  openSara();
  let root = createConsole();
  let phase = root.shell.querySelector("[data-sara-phase-content]");
  let form = openInitiativeForm(root, phase, "12");
  openCharacterSession("aurelia", () => ({ status: "missing" }));
  let before = JSON.stringify(getState());
  root.fire("submit", { target: form, preventDefault() {} });
  assert.equal(JSON.stringify(getState()), before);
  assert.equal(getState().battleConsole?.current ?? null, null);

  openSara();
  root = createConsole();
  phase = root.shell.querySelector("[data-sara-phase-content]");
  form = openInitiativeForm(root, phase, "12");
  assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
  before = JSON.stringify(getState());
  root.fire("submit", { target: form, preventDefault() {} });
  assert.equal(JSON.stringify(getState()), before);
});

test("stale correction form cannot update a replacement battle identity", () => {
  openSara();
  assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
  const root = createConsole();
  const correction = new FixtureElement(root.shell.querySelector("[data-sara-turn-controls]"));
  correction.dataset.battleSceneAction = "correct-initiative";
  root.fire("click", { target: correction });
  const form = new FixtureForm(
    root.shell.querySelector("[data-sara-phase-content]"),
    "12",
    (() => {
      const { characterId, sessionGeneration } = getSessionContext();
      return { characterId, sessionGeneration };
    })(),
    battleContextKey(getState()),
  );
  form.dataset.battleForm = "correct-initiative";
  form.dataset.battleId = getState().battleConsole.current.id;
  getState().battleConsole.current.id = "replacement-battle";
  const before = JSON.stringify(getState());
  root.fire("submit", { target: form, preventDefault() {} });
  assert.equal(JSON.stringify(getState()), before);
  assert.equal(getState().battleConsole.current.initiative.rawD20, 10);
});

test("own-turn correction hides its competing footer and cancel or success restores it", () => {
  openSara();
  assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  const root = createConsole();
  const openCorrection = () => {
    const button = new FixtureElement(root.shell.querySelector("[data-sara-turn-controls]"));
    button.dataset.battleSceneAction = "correct-initiative";
    root.fire("click", { target: button });
  };
  openCorrection();
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  assert.match(phase.innerHTML, /data-battle-form="correct-initiative"/);
  assert.doesNotMatch(phase.innerHTML, /data-battle-command="end-own-turn"/);

  const cancel = new FixtureElement(phase);
  cancel.dataset.battleMenu = "home";
  root.fire("click", { target: cancel });
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="end-own-turn"/);

  openCorrection();
  const { characterId, sessionGeneration } = getSessionContext();
  const form = new FixtureForm(
    phase,
    "12",
    { characterId, sessionGeneration },
    battleContextKey(getState()),
  );
  form.dataset.battleForm = "correct-initiative";
  form.dataset.battleId = getState().battleConsole.current.id;
  root.fire("submit", { target: form, preventDefault() {} });
  assert.equal(getState().battleConsole.current.initiative.rawD20, 12);
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="end-own-turn"/);
});

test("repeated bind replaces navigation callback without duplicating listeners", () => {
  openSara();
  const root = createConsole();
  let oldCalls = 0;
  let newCalls = 0;
  bindBattleConsole(root, { onNavigate: () => { oldCalls += 1; } });
  bindBattleConsole(root, { onNavigate: () => { newCalls += 1; } });
  const button = new FixtureElement(root.shell.querySelector("[data-sara-phase-content]"));
  button.dataset.battleNavigate = "inventory";
  root.fire("click", { target: button });
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
  const techniques = new FixtureElement(root.shell.querySelector("[data-sara-phase-content]"));
  techniques.dataset.battleNavigate = "techniques";
  root.fire("click", { target: techniques });
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 2);
});

test("focused initiative submit immediately replaces outside controls through the whole battle cycle", () => {
  openSara();
  const root = createConsole();
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const form = openInitiativeForm(root, phase, "14");
  const input = new FixtureElement(phase);
  document.activeElement = input;
  root.fire("submit", { target: form, preventDefault() {} });

  assert.equal(getState().battleConsole.current.phase, "waiting");
  assert.doesNotMatch(phase.innerHTML, /data-battle-form="start"/);
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="begin-own-turn"/);
  assert.match(root.shell.querySelector("[data-sara-hud-heading]").innerHTML,
    /data-sara-end-battle/);

  fireCommand(root, "begin-own-turn", "[data-sara-turn-controls]");
  assert.equal(getState().battleConsole.current.phase, "own-turn");
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="end-own-turn"/);

  fireCommand(root, "end-own-turn", "[data-sara-turn-controls]");
  assert.equal(getState().battleConsole.current.phase, "waiting");
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-command="begin-own-turn"/);

  fireCommand(root, "end-battle", "[data-sara-turn-controls]");
  assert.equal(getState().battleConsole.current, null);
  assert.doesNotMatch(phase.innerHTML, /data-battle-form="start"/);
  assert.match(root.shell.querySelector("[data-sara-turn-controls]").innerHTML,
    /data-battle-scene-action="initiative"/);
});

test("focused submit button and direct end-battle during own turn transition immediately", () => {
  openSara();
  const root = createConsole();
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const submitButton = new FixtureElement(phase);
  document.activeElement = submitButton;
  root.fire("submit", {
    target: openInitiativeForm(root, phase, "12"),
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
  assert.doesNotMatch(phase.innerHTML, /data-battle-form="start"/);
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
  let markup = renderBattleConsole(character, { panel: "home", ownerKey: '["sara-velaris",1]' });
  assert.match(markup, /data-battle-command="resume-battle"/);
  assert.match(markup, /data-sara-end-battle/);
  assert.doesNotMatch(markup, /data-battle-command="pause-battle"/);

  character.battleConsole.current.phaseBeforePause = "unknown";
  markup = renderBattleConsole(character, { panel: "home", ownerKey: '["sara-velaris",1]' });
  assert.match(markup, /контекст приостановленной сцены повреждён/i);
  assert.match(markup, /data-sara-end-battle/);
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
  const phase = root.shell.querySelector("[data-sara-phase-content]");
  const oldMarkup = phase.innerHTML;
  const activeInput = new FixtureElement(phase);
  activeInput.value = "11";
  document.activeElement = activeInput;
  updateBattleConsole(root, getState());
  assert.equal(phase.innerHTML, oldMarkup);
  assert.equal(document.activeElement, activeInput);

  startBattle(getState(), { rawD20: "10" }, { id: "context-battle" });
  updateBattleConsole(root, getState());
  assert.match(phase.innerHTML, /По мне атакуют/);
  assert.notEqual(document.activeElement, activeInput);
  const battleInput = new FixtureElement(phase);
  battleInput.value = "11";
  document.activeElement = battleInput;
  getState().battleConsole.current.initiative.rawD20 = 11;
  updateBattleConsole(root, getState());
  assert.match(phase.innerHTML, /По мне атакуют/);
  assert.equal(document.activeElement, battleInput);
  assert.equal(battleInput.value, "11");

  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  updateBattleConsole(root, getState());
  assert.equal(document.activeElement, root.shell.querySelector("#battleConsoleTitle"));
  document.activeElement = null;
  root.fire("focusout", { target: start });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(phase.innerHTML, /Атаковать/);
  assert.doesNotMatch(phase.innerHTML, /battle-menu-panel/);
  assert.doesNotMatch(phase.innerHTML, /Инициатива:/);
  assert.equal(root.shell.dataset.playerScenePhase, "own-turn");
});

test("initial battle markup records its render context before the first update", () => {
  const initial = structuredClone(sara);
  const markup = renderBattleConsole(initial);
  assert.ok(markup.includes(
    'data-battle-render-context="[null,&quot;outside&quot;,null]"',
  ));
  assert.equal(battleContextKey(initial), JSON.stringify([null, "outside", null]));
});
