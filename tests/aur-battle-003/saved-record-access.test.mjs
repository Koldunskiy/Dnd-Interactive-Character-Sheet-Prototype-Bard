import test from "node:test";
import assert from "node:assert/strict";
import { getSavedPlayerRecords } from "../../scripts/battle/player-hub.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { getSessionContext } from "../../scripts/state.js";
import {
  bindBattleConsole,
  updateBattleConsole,
} from "../../scripts/render/render-battle-console.js";
import {
  disposeWorkspaceOwner,
  getActiveWorkspaceSession,
  getWorkspaceSessionForTests,
  openNormalAttack,
  openSaraBattleCommand,
} from "../../scripts/workspace/controller.js";
import {
  beginSeekingStrike,
  closeAttackSequence,
  recordAttackOutcome,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";
import { getState, openCharacterSession, updateState } from "../../scripts/state.js";
import {
  fireWorkspaceAction,
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";
import {
  beginOwnTurn,
  endBattle,
  endOwnTurn,
  startBattle,
} from "../../scripts/battle/transitions.js";

class BoundElement {
  constructor(root, region = null, dataset = {}) {
    this.root = root;
    this.region = region;
    this.dataset = dataset;
    this.disabled = false;
    this.isConnected = true;
  }
  closest(selector) {
    const keys = [...selector.matchAll(/data-([a-z0-9-]+)/g)]
      .map((match) => match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
    return keys.some((key) => Object.hasOwn(this.dataset, key)) ? this : null;
  }
}

class BoundRegion {
  constructor(root) {
    this.root = root;
    this.controls = [];
    this._innerHTML = "";
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(markup) {
    for (const control of this.controls) control.isConnected = false;
    this.controls = [];
    this._innerHTML = markup;
    for (const match of markup.matchAll(/<button\b([^>]*)>/g)) {
      const dataset = {};
      for (const attr of match[1].matchAll(/\b(data-[\w-]+)="([^"]*)"/g)) {
        dataset[attr[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
          attr[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      }
      const control = new BoundElement(this.root, this, dataset);
      control.disabled = /\sdisabled(?:\s|$)/.test(match[1]);
      this.controls.push(control);
    }
  }
  contains(element) { return this.controls.includes(element); }
  querySelectorAll() { return []; }
}

class BoundShell extends BoundElement {
  constructor(root) {
    super(root);
    this.regions = new Map([
      "[data-sara-hud-heading]", "[data-sara-home-hud]", "[data-sara-budget]",
      "[data-sara-navigation]", "[data-sara-pending-work]", "[data-sara-turn-controls]",
      "[data-sara-phase-content]", "[data-sara-idle-content]", "[data-sara-task-region]",
      "[data-combat-workspace-root]", "[data-sara-hud]",
    ].map((selector) => [selector, new BoundRegion(root)]));
    this.dataset = {};
  }
  querySelector(selector) {
    if (selector === ".sara-combat-shell") return this;
    return this.regions.get(selector) ?? null;
  }
  contains(element) { return [...this.regions.values()].some((region) => region.contains(element)); }
}

class BoundRoot extends BoundElement {
  constructor() {
    super(null);
    this.root = this;
    this.shell = new BoundShell(this);
    this.dataset = {};
    this.listeners = new Map();
    this.status = { textContent: "" };
  }
  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }
  querySelector(selector) {
    if (selector === ".sara-combat-shell") return this.shell;
    if (selector === "[data-battle-status]") return this.status;
    return null;
  }
  contains(element) { return this.shell.contains(element); }
  fireClick(control) {
    for (const handler of this.listeners.get("click") ?? []) handler({ target: control });
  }
}

function clickControl(root, key, value) {
  const control = [...root.shell.regions.values()].flatMap((region) => region.controls)
    .find((entry) => entry.dataset[key] === value);
  assert.ok(control?.isConnected, `Expected connected rendered ${key}=${value} control`);
  assert.equal(control.disabled, false);
  root.fireClick(control);
  return control;
}

function makeBoundConsole() {
  globalThis.Element = BoundElement;
  const root = new BoundRoot();
  bindBattleConsole(root);
  updateBattleConsole(root, getState());
  return root;
}

function seedTwoPendingHits() {
  const first = recordAttackOutcome(getSessionContext(), "sequence-one", "attack-one", {
    kind: "attack-action", profileId: "unarmed", rollMode: "normal",
    firstD20: "12", dmHitResult: "hit",
  }, "record-attack-one");
  assert.equal(first.status, "applied");
  assert.equal(closeAttackSequence(getSessionContext(), "sequence-one", "close-sequence-one").status,
    "applied");
  const second = recordAttackOutcome(getSessionContext(), "sequence-two", "attack-two", {
    kind: "attack-action", profileId: "unarmed", rollMode: "normal",
    firstD20: "12", dmHitResult: "hit", confirmSeparateAction: true,
  }, "record-attack-two");
  assert.equal(second.status, "applied");
}

test("saved records are a read-only projection of completed and incomplete canonical records", () => {
  const character = {
    profile: { id: "sara-velaris" },
    monk: { combatAssistant: {
      activeSequences: [
        { id: "seq-complete", kind: "attack-action", status: "complete", maximumAttacks: 1,
          resolvedAttacks: [{ id: "attack-complete", slotNumber: 1, hitResult: "hit",
            damageStatus: "recorded", damageTotalBeforeTargetModifiers: 7 }] },
        { id: "seq-pending", kind: "attack-action", status: "closed", maximumAttacks: 2,
          resolvedAttacks: [{ id: "attack-pending", slotNumber: 1, hitResult: "hit",
            damageStatus: "awaiting-damage", attackBonusSnapshot: 10 }] },
      ],
      pendingApplications: [{ id: "app-exact", parentAttackId: "attack-complete",
        techniqueId: "gentling-touch", dc: 15, targetOutcome: "unknown" }],
    } },
    characterRolls: { records: [{ id: "roll-exact", kind: "ability-check",
      label: "Проверка", total: 14, outcome: "success",
      consequence: { status: "pending" } }] },
  };
  const original = structuredClone(character);
  const projection = getSavedPlayerRecords(character);
  assert.deepEqual(projection.sequences.map((entry) => entry.sequenceId),
    ["seq-complete", "seq-pending"]);
  assert.equal(character.monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].damageTotalBeforeTargetModifiers, 7);
  assert.equal(projection.sequences[0].attacks[0].recordedDamage, 7);
  assert.equal(projection.sequences[1].attacks[0].damageStatus, "awaiting-damage");
  assert.equal(projection.applications[0].applicationId, "app-exact");
  assert.equal(projection.applications[0].targetOutcome, "unknown");
  assert.equal(projection.rolls[0].rollId, "roll-exact");
  assert.equal(projection.rolls[0].consequencePending, true);
  assert.deepEqual(character, original);
});

test("history renderer has an empty state and no queue language", () => {
  const markup = renderBattleConsole({ profile: { id: "sara-velaris" } }, {
    panel: "saved-records",
    ownerKey: '["sara",1]',
  });
  assert.match(markup, /Сохранённых записей нет\./);
  assert.doesNotMatch(markup, /Требует внимания|Обязательные последствия|Черновики|Нет ожидающих задач/);
});

test("projection and history render preserve state revision and Map-backed storage", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = globalThis.window.localStorage.values;
    const storageBefore = new Map(storage);
    const context = getSessionContext();
    getSavedPlayerRecords(getState());
    renderBattleConsole(getState(), {
      panel: "saved-records",
      ownerKey: JSON.stringify([context.characterId, context.sessionGeneration]),
    });
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(storage, storageBefore);
  } finally {
    unsubscribe();
  }
});

test("history renderer preserves completed summaries and emits exact escaped record addresses", () => {
  const character = {
    profile: { id: "sara-velaris" },
    monk: { combatAssistant: {
      activeSequences: [{ id: 'seq"<x>', kind: "attack-action", status: "closed",
        maximumAttacks: 1, resolvedAttacks: [{ id: "attack-2", slotNumber: 1,
          hitResult: "hit", damageStatus: "awaiting-damage" }] }],
      pendingApplications: [{ id: "app-2", techniqueId: "technique", dc: 15,
        targetOutcome: "success" }],
    } },
    characterRolls: { records: [{ id: "roll-2", label: "Проверка", total: 18,
      consequence: { status: "applied" } }] },
  };
  const markup = renderBattleConsole(character, {
    panel: "saved-records",
    ownerKey: '["sara",3]',
  });
  assert.match(markup, /data-saved-damage-sequence="seq&quot;&lt;x&gt;"/);
  assert.match(markup, /data-saved-damage-attack="attack-2"/);
  assert.match(markup, /data-record-character="sara"/);
  assert.match(markup, /data-record-generation="3"/);
  assert.match(markup, /attack-action · closed/);
  assert.match(markup, /app-2|technique/);
  assert.match(markup, /Проверка/);
  assert.doesNotMatch(markup, /data-saved-application="app-2"/);
  assert.doesNotMatch(markup, /data-saved-roll="roll-2"/);
  const readOnlyMarkup = renderBattleConsole(character, { panel: "saved-records" });
  assert.match(readOnlyMarkup, /Сохранённые записи/);
  assert.doesNotMatch(readOnlyMarkup, /data-saved-damage-sequence=/);
});

test("canonical recorded damage, Gentling, closed sequences, and resolved Seeking render once per sequence", () => {
  const character = {
    profile: { id: "sara-velaris" },
    monk: { combatAssistant: { activeSequences: [
      { id: "mixed", kind: "attack-action", status: "complete", maximumAttacks: 4,
        resolvedAttacks: [
          { id: "recorded", slotNumber: 1, hitResult: "hit", damageStatus: "recorded",
            damageTotalBeforeTargetModifiers: 17 },
          { id: "miss", slotNumber: 2, hitResult: "miss", damageStatus: "not-applicable",
            damageTotalBeforeTargetModifiers: null },
          { id: "outside", slotNumber: 3, hitResult: "hit", damageStatus: "recorded-outside-app",
            damageTotalBeforeTargetModifiers: null },
          { id: "seeking-resolved", slotNumber: 4, hitResult: "hit", attackTotal: 21,
            critical: false, damageStatus: "not-applicable", rawD20Rolls: [12], chosenD20: 12,
            seekingAmendments: [{ paidOperationId: "invocation-1", id: "invocation-1",
              status: "resolved", kiPaid: 1, original: { rawD20Rolls: [2] },
              resolutionOperationId: "resolution-1",
              replacement: { rawD20Rolls: [12], chosenD20: 12, attackTotal: 21,
                hitResult: "hit", critical: false } }] },
        ],
        replacementResults: [{ id: "gentling-1", operationId: "gentling-1",
          kind: "gentling-touch", slotNumber: 5, sum: 20, targetHp: 25,
          thresholdMet: false, cost: 1, dice: 5, sides: 8 }],
      },
      { id: "gentling-only", kind: "attack-action", status: "complete", maximumAttacks: 2,
        resolvedAttacks: [], replacementResults: [{ id: "gentling-2", kind: "gentling-touch",
          slotNumber: 1, sum: 24, targetHp: 22, thresholdMet: true, cost: 2, dice: 6, sides: 8 }] },
      { id: "closed-empty", kind: "attack-action", status: "closed", maximumAttacks: 1,
        resolvedAttacks: [], replacementResults: [] },
    ] } },
  };
  for (const sequence of character.monk.combatAssistant.activeSequences) {
    for (const result of sequence.replacementResults) {
      if (result.kind === "gentling-touch") {
        assert.equal(typeof result.sum, "number");
        assert.equal(typeof result.thresholdMet, "boolean");
      }
    }
    for (const attack of sequence.resolvedAttacks) {
      if (attack.damageStatus === "recorded") {
        assert.equal(typeof attack.damageTotalBeforeTargetModifiers, "number");
      }
    }
  }
  const projection = getSavedPlayerRecords(character);
  assert.equal(projection.sequences.length, 3);
  assert.equal(projection.sequences[0].attacks[0].recordedDamage, 17);
  assert.equal(projection.sequences[0].replacementResults[0].sum, 20);
  assert.equal(projection.sequences[0].replacementResults[0].thresholdMet, false);
  assert.equal(projection.sequences[0].attacks[3].seeking[0].result.attackTotal, 21);
  const roundTrip = getSavedPlayerRecords(JSON.parse(JSON.stringify(character)));
  assert.deepEqual(roundTrip.sequences.map((entry) => [
    entry.sequenceId, entry.status, entry.attacks.map((attack) =>
      attack.seeking.map((invocation) => [invocation.amendmentId, invocation.status, invocation.kiPaid])),
  ]), projection.sequences.map((entry) => [
    entry.sequenceId, entry.status, entry.attacks.map((attack) =>
      attack.seeking.map((invocation) => [invocation.amendmentId, invocation.status, invocation.kiPaid])),
  ]));
  const markup = renderBattleConsole(character, {
    panel: "saved-records",
    ownerKey: '["sara",3]',
  });
  assert.match(markup, /урон 17/);
  assert.match(markup, /промах/);
  assert.match(markup, /урон учтён вне приложения/);
  assert.match(markup, /data-record-sequence-id="gentling-only"/);
  assert.match(markup, /data-record-sequence-id="closed-empty"/);
  assert.match(markup, /сумма 21 · hit/);
  assert.equal((markup.match(/class="saved-record"/g) ?? []).length, 3);
  assert.doesNotMatch(markup, /undefined|thresholdReached|damageTotal="/);
});

test("production delegated controls navigate tools/history/back and open the exact second pending attack", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    seedTwoPendingHits();
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    assert.match(root.shell.regions.get("[data-sara-phase-content]").innerHTML, /Сохранённые записи/);
    clickControl(root, "battleMenu", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    clickControl(root, "savedDamageSequence", "sequence-two");
    assert.equal(getWorkspaceSessionForTests().sequenceId, "sequence-two");
    assert.equal(getWorkspaceSessionForTests().attackId, "attack-two");
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("connected historical damage uses the recorded profile after battle end without another slot or payment", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    updateState((state) => {
      startBattle(state, { rawD20: "10" }, { id: "historical-access-battle" });
      assert.equal(beginOwnTurn(state, { id: "historical-access-turn" }).ok, true);
      return state;
    });
    const sequenceId = "historical-access-sequence";
    const attackId = "historical-access-hit";
    assert.equal(recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
      kind: "attack-action", profileId: "unarmed", rollMode: "normal",
      firstD20: "12", dmHitResult: "hit",
    }, "historical-access-record-hit").status, "applied");
    const sequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId);
    const attack = sequence.resolvedAttacks.find((entry) => entry.id === attackId);
    const savedProfile = structuredClone(attack.profileSnapshot);
    assert.ok(savedProfile);
    assert.equal(typeof savedProfile.damageModifier, "number");
    const usedSlots = sequence.resolvedAttacks.length + (sequence.replacementResults?.length ?? 0);
    const kiBefore = getState().combat.ki.current;
    const ammoBefore = getState().inventory.items.find((entry) => entry.id === "darts").quantity;
    updateState((state) => {
      endBattle(state);
      state.abilities.dexterity = 10;
      state.abilities.strength = 18;
      return state;
    });
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    clickControl(root, "savedDamageSequence", sequenceId);
    assert.equal(getWorkspaceSessionForTests().sequenceId, sequenceId);
    assert.equal(getWorkspaceSessionForTests().attackId, attackId);
    assert.equal(getWorkspaceSessionForTests().historicalOnly, true);
    assert.equal(getWorkspaceSessionForTests().capabilities.canRecordAttack, false);
    dialog.forms.damage = new FixtureForm("damage", { damage1: "4" });
    fireWorkspaceInput(dialog, "damage1", "4");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const savedAttack = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId).resolvedAttacks
      .find((entry) => entry.id === attackId);
    assert.equal(savedAttack.damageModifierSnapshot, savedProfile.damageModifier);
    assert.equal(savedAttack.damageTotalBeforeTargetModifiers, 4 + savedProfile.damageModifier);
    const updatedSequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId);
    assert.equal(updatedSequence.resolvedAttacks.length +
      (updatedSequence.replacementResults?.length ?? 0), usedSlots);
    assert.equal(getState().combat.ki.current, kiBefore);
    assert.equal(getState().inventory.items.find((entry) => entry.id === "darts").quantity, ammoBefore);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("production handler rejects a connected old-generation control without opening a new workspace", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    seedTwoPendingHits();
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const oldControl = [...root.shell.regions.values()].flatMap((region) => region.controls)
      .find((entry) => entry.dataset.savedDamageSequence === "sequence-two");
    assert.ok(oldControl?.isConnected);
    const oldGeneration = getSessionContext().sessionGeneration;
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    assert.notEqual(getSessionContext().sessionGeneration, oldGeneration);
    root.fireClick(oldControl);
    assert.equal(getWorkspaceSessionForTests(), null);
    assert.match(root.status.textContent, /Запись устарела/);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("production handler rejects a connected control whose exact attack has disappeared", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    seedTwoPendingHits();
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const staleAttackControl = [...root.shell.regions.values()].flatMap((region) => region.controls)
      .find((entry) => entry.dataset.savedDamageAttack === "attack-two");
    assert.ok(staleAttackControl?.isConnected);
    updateState((state) => {
      state.monk.combatAssistant.activeSequences
        .find((entry) => entry.id === "sequence-two").resolvedAttacks = [];
      return state;
    });
    root.fireClick(staleAttackControl);
    assert.equal(getWorkspaceSessionForTests(), null);
    assert.match(root.status.textContent, /больше не ожидает записи урона/);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("production application and roll controls route by exact ID and recheck pending eligibility", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    updateState((state) => {
      state.monk.combatAssistant.pendingApplications = [
        { id: "application-one", techniqueId: "technique-one", dc: 14, targetOutcome: "unknown" },
        { id: "application-two", techniqueId: "technique-two", dc: 16, targetOutcome: "unknown" },
      ];
      state.characterRolls ??= { records: [] };
      state.characterRolls.records.push({
        id: "roll-two", kind: "saving-throw", label: "Проверка точного броска",
        total: 15, rawD20Rolls: [12], totalModifier: 3, chosenD20: 12,
        rollMode: "normal", consequenceProfile: "damage",
        consequence: { status: "pending" },
      });
      return state;
    });
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    clickControl(root, "savedApplication", "application-two");
    assert.equal(getWorkspaceSessionForTests().scenarioId, "pending-save:application-two");
    assert.equal(getState().monk.combatAssistant.pendingApplications[1].targetOutcome, "unknown");
    disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "saved-record-test-next-route");

    updateState((state) => {
      state.monk.combatAssistant.pendingApplications[1].targetOutcome = "success";
      return state;
    });
    const terminalAppControl = [...root.shell.regions.values()].flatMap((region) => region.controls)
      .find((entry) => entry.dataset.savedApplication === "application-two");
    assert.ok(terminalAppControl?.isConnected);
    root.fireClick(terminalAppControl);
    assert.equal(getWorkspaceSessionForTests(), null);

    const freshRoot = makeBoundConsole();
    clickControl(freshRoot, "battleSceneAction", "tools");
    clickControl(freshRoot, "battleSceneAction", "saved-records");
    clickControl(freshRoot, "savedRoll", "roll-two");
    assert.equal(getWorkspaceSessionForTests().scenarioId, "pending-roll:roll-two");
    disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "saved-record-test-terminal-roll");
    updateState((state) => {
      state.characterRolls.records[0].consequence.status = "applied";
      return state;
    });
    const terminalRollControl = [...freshRoot.shell.regions.values()].flatMap((region) => region.controls)
      .find((entry) => entry.dataset.savedRoll === "roll-two");
    assert.ok(terminalRollControl?.isConnected);
    freshRoot.fireClick(terminalRollControl);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("external history routing preserves a dirty workspace input and rejects read-only history workspaces", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    seedTwoPendingHits();
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const historicalControl = [...root.shell.regions.values()].flatMap((region) => region.controls)
      .find((entry) => entry.dataset.savedDamageSequence === "sequence-two");
    assert.ok(historicalControl?.isConnected);
    const dirtyOpened = openSaraBattleCommand("character-roll");
    assert.equal(dirtyOpened.ok, true);
    fireWorkspaceInput(dialog, "firstD20", "14");
    const dirtySessionId = getWorkspaceSessionForTests().workspaceSessionId;
    const savedInput = structuredClone(getWorkspaceSessionForTests().rawInputsByStep);
    root.fireClick(historicalControl);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, dirtySessionId);
    assert.deepEqual(getWorkspaceSessionForTests().rawInputsByStep, savedInput);
    assert.match(root.status.textContent, /завершите или отмените текущий ввод/);

    disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "saved-record-readonly-setup");
    const opened = openNormalAttack({
      sequenceId: "sequence-two",
      attackId: "attack-two",
      mode: "historical-damage",
    });
    assert.equal(opened.ok, true);
    assert.equal(getWorkspaceSessionForTests().readOnly, true);
    root.fireClick(historicalControl);
    assert.equal(getWorkspaceSessionForTests().sequenceId, "sequence-two");
    assert.match(root.status.textContent, /проверьте результат текущего действия/);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("external history routing preserves applied-unsaved recovery and its retry control", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const setItem = globalThis.window.localStorage.setItem;
  try {
    seedTwoPendingHits();
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const historicalControl = [...root.shell.regions.values()].flatMap((region) => region.controls)
      .find((entry) => entry.dataset.savedDamageSequence === "sequence-two");
    assert.ok(historicalControl?.isConnected);
    assert.equal(openSaraBattleCommand("character-roll").ok, true);
    dialog.forms.command = new FixtureForm("command", {
      kind: "ability-check",
      id: "athletics",
      rollMode: "normal",
      firstD20: "12",
      secondD20: "",
      dc: "16",
      incomingDamage: "",
      consequenceProfile: "none",
      spellSaveSource: false,
      advantageReason: "",
      disadvantageReason: "",
    });
    globalThis.window.localStorage.setItem = () => {
      throw new Error("injected persistence failure for saved-history guard");
    };
    fireWorkspaceAction(dialog, "record-roll", { rollOutcome: "success" });
    globalThis.window.localStorage.setItem = setItem;
    const workspaceId = getWorkspaceSessionForTests().workspaceSessionId;
    assert.equal(getActiveWorkspaceSession().appliedUnsaved, true);
    root.fireClick(historicalControl);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, workspaceId);
    assert.equal(getActiveWorkspaceSession().appliedUnsaved, true);
    assert.match(dialog.footer.innerHTML, /data-workspace-action="retry-save"/);
  } finally {
    globalThis.window.localStorage.setItem = setItem;
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("paid Seeking uses the exact rendered invocation, preserves payment, and rejects a stale invocation", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    updateState((state) => {
      state.profile.level = 6;
      state.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
      return state;
    });
    const sequenceId = "seeking-history-parent";
    const attackId = "seeking-history-miss";
    assert.equal(startAttackSequence(getSessionContext(), {
      kind: "attack-action", sequenceId,
    }, "start-seeking-parent").status, "applied");
    assert.equal(recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
      kind: "attack-action", profileId: "unarmed", rollMode: "normal",
      firstD20: "2", secondD20: "", targetArmorClass: "30",
    }, "record-seeking-miss").status, "applied");
    assert.equal(beginSeekingStrike(getSessionContext(), sequenceId, attackId,
      "pay-seeking-invocation").status, "applied");
    const kiAfterPayment = getState().combat.ki.current;
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const seekingControl = clickControl(root, "savedSeekingAmendment", "pay-seeking-invocation");
    assert.equal(getWorkspaceSessionForTests().seekingTask.amendmentId, "pay-seeking-invocation");
    assert.equal(getState().combat.ki.current, kiAfterPayment);
    disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "saved-record-stale-seeking");
    updateState((state) => {
      const attack = state.monk.combatAssistant.activeSequences
        .find((entry) => entry.id === sequenceId).resolvedAttacks
        .find((entry) => entry.id === attackId);
      attack.seekingAmendments = [{
        id: "new-invocation",
        paidOperationId: "new-invocation",
        parent: { actionId: sequenceId, attackId },
        status: "awaiting-replacement",
        kiPaid: 1,
        original: { rawD20Rolls: [2], rollMode: "normal", chosenD20: 2,
          attackTotal: attack.attackTotal, hitResult: "miss", critical: false },
      }];
      attack.seekingAmendment = null;
      return state;
    });
    const kiBeforeStaleClick = getState().combat.ki.current;
    root.fireClick(seekingControl);
    assert.equal(getWorkspaceSessionForTests(), null);
    assert.equal(getState().combat.ki.current, kiBeforeStaleClick);
    assert.match(root.status.textContent, /изменилась или противоречива/);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("conflicting Seeking history is local and does not block another exact record", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    seedTwoPendingHits();
    updateState((state) => {
      const attack = state.monk.combatAssistant.activeSequences
        .find((entry) => entry.id === "sequence-one").resolvedAttacks[0];
      attack.seekingAmendments = [
        { id: "duplicate", paidOperationId: "duplicate", status: "awaiting-replacement",
          kiPaid: 1, original: { rawD20Rolls: [2] } },
        { id: "duplicate", paidOperationId: "duplicate", status: "awaiting-replacement",
          kiPaid: 1, original: { rawD20Rolls: [2] } },
      ];
      attack.seekingAmendment = null;
      return state;
    });
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const markup = root.shell.regions.get("[data-sara-phase-content]").innerHTML;
    assert.match(markup, /История Seeking противоречива/);
    assert.doesNotMatch(markup, /data-saved-seeking-sequence="sequence-one"/);
    const beforeOpen = structuredClone(getState());
    clickControl(root, "savedDamageSequence", "sequence-two");
    assert.equal(getWorkspaceSessionForTests().sequenceId, "sequence-two");
    assert.deepEqual(getState(), beforeOpen);
    assert.equal(getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === "sequence-one").resolvedAttacks[0]
      .seekingAmendments.length, 2);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});

test("current sequence remainder opens exactly; an expired remainder cannot be reopened", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    updateState((state) => {
      startBattle(state, { rawD20: "10" }, { id: "saved-record-battle" });
      assert.equal(beginOwnTurn(state, { id: "saved-record-turn" }).ok, true);
      return state;
    });
    assert.equal(startAttackSequence(getSessionContext(), {
      kind: "attack-action", sequenceId: "current-remainder",
    }, "start-current-remainder").status, "applied");
    const root = makeBoundConsole();
    clickControl(root, "battleSceneAction", "tools");
    clickControl(root, "battleSceneAction", "saved-records");
    const remainder = clickControl(root, "savedSequence", "current-remainder");
    assert.equal(getWorkspaceSessionForTests().sequenceId, "current-remainder");
    disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "saved-record-expire-remainder");
    endOwnTurn(getState());
    root.fireClick(remainder);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    const active = getWorkspaceSessionForTests();
    if (active) disposeWorkspaceOwner(active.owner, "saved-record-test-cleanup");
    unsubscribe();
  }
});
