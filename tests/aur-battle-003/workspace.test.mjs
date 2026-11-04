import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext, openCharacterSession, subscribe } from "../../scripts/state.js";
import { sara } from "../../data/sara.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { beginOwnTurn, startBattle } from "../../scripts/battle/transitions.js";
import { bindBattleConsole } from "../../scripts/render/render-battle-console.js";
import {
  getWorkspaceSessionForTests,
  initActionWorkspace,
  minimizeWorkspace,
  openNormalAttack,
  prepareWorkspaceCharacterTransition,
  reconcileWorkspaceAfterStateChange,
  resumeWorkspace,
  disposeWorkspaceOwner,
} from "../../scripts/workspace/controller.js";

class FakeNode {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.scrollTop = 0;
    this.style = { setProperty() {} };
    this.dataset = {};
    this.listeners = new Map();
    this.isConnected = true;
    this.parentElement = null;
    this.childNodes = [];
  }
  appendChild(node) {
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  fire(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  focus() {}
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { top: 210 }; }
  querySelector() { return null; }
}

class FakeForm extends FakeNode {
  constructor(kind, values) {
    super();
    this.dataset = { workspaceForm: kind };
    this.elements = Object.entries(values).map(([name, value]) => ({
      name,
      type: typeof value === "boolean" ? "checkbox" : name.includes("D20") || name.startsWith("damage") ||
        name === "targetArmorClass" ? "number" : "text",
      checked: value === true,
      value: typeof value === "boolean" ? "" : value,
    }));
  }
}

class FakeDialog extends FakeNode {
  constructor() {
    super();
    this.open = false;
    this.header = new FakeNode();
    this.body = new FakeNode();
    this.footer = new FakeNode();
    this.status = new FakeNode();
    this.heading = new FakeNode();
    this.hp = new FakeNode();
    this.ki = new FakeNode();
    this.preview = new FakeNode();
    this.attackTotal = new FakeNode();
    this.attackFormula = new FakeNode();
    this.attackStatus = new FakeNode();
    this.attackValidation = new FakeNode();
    this.damageTotal = new FakeNode();
    this.damageFormula = new FakeNode();
    this.damagePreview = new FakeNode();
    this.secondD20 = new FakeNode();
    this.secondD20.hidden = true;
    this.secondD20Input = { required: false };
    this.secondD20.querySelector = (selector) =>
      selector === 'input[name="secondD20"]' ? this.secondD20Input : null;
    this.forms = {};
    for (const node of [this.header, this.body, this.footer, this.status]) {
      this.appendChild(node);
    }
  }
  querySelector(selector) {
    if (selector === "[data-workspace-header]") return this.header;
    if (selector === "[data-workspace-body]") return this.body;
    if (selector === "[data-workspace-footer]") return this.footer;
    if (selector === "[data-workspace-status]") return this.status;
    if (selector === "[data-workspace-title]" || selector === "#workspaceDialogTitle") return this.heading;
    if (selector === '[data-workspace-form="attack"]') return this.forms.attack ?? null;
    if (selector === '[data-workspace-form="damage"]') return this.forms.damage ?? null;
    if (selector === "[data-workspace-hp]") return this.hp;
    if (selector === "[data-workspace-ki]") return this.ki;
    if (selector === "[data-workspace-preview]") return this.preview;
    if (selector === "[data-attack-total]") return this.attackTotal;
    if (selector === "[data-attack-formula]") return this.attackFormula;
    if (selector === "[data-attack-status]") return this.attackStatus;
    if (selector === "[data-attack-validation]") return this.attackValidation;
    if (selector === "[data-damage-total]") return this.damageTotal;
    if (selector === "[data-damage-formula]") return this.damageFormula;
    if (selector === "[data-workspace-damage-preview]") return this.damagePreview;
    if (selector === "[data-workspace-second-d20]") return this.secondD20;
    if (selector === 'input[name="secondD20"]') return this.secondD20Input;
    return null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  toggleAttribute() {}
}

function installDomFixture() {
  const dialog = new FakeDialog();
  const rollRoot = { hidden: true };
  const invoker = new FakeNode();
  invoker.dataset.workspaceInvoker = "normal-attack";
  const bodyStyle = {};
  globalThis.HTMLDialogElement = FakeDialog;
  globalThis.Element = FakeNode;
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  globalThis.window = {
    scrollY: 430,
    visualViewport: { height: 780, offsetTop: 0, addEventListener() {} },
    addEventListener() {},
    scrollTo() {},
    scrollBy() {},
    localStorage: {
      values: new Map(),
      getItem(key) { return this.values.get(key) ?? null; },
      setItem(key, value) {
        if (globalThis.workspaceStorageFailures) throw new Error("isolated workspace storage failure");
        this.values.set(key, value);
      },
      removeItem(key) { this.values.delete(key); },
    },
    confirm: () => true,
  };
  globalThis.document = {
    body: { style: bodyStyle },
    getElementById(id) {
      if (id === "actionWorkspaceRoot") return dialog;
      if (id === "characterRollsRoot") return rollRoot;
      return null;
    },
    querySelector(selector) {
      if (selector === "#actionWorkspaceRoot [data-workspace-hp]") return dialog.hp;
      if (selector === "#actionWorkspaceRoot [data-workspace-ki]") return dialog.ki;
      if (selector === "#actionWorkspaceRoot [data-workspace-preview]") return dialog.preview;
      if (selector === "#actionWorkspaceRoot [data-workspace-damage-preview]") return dialog.damagePreview;
      if (selector === "#actionWorkspaceRoot [data-attack-total]") return dialog.attackTotal;
      if (selector === "#actionWorkspaceRoot [data-attack-formula]") return dialog.attackFormula;
      if (selector === "#actionWorkspaceRoot [data-attack-status]") return dialog.attackStatus;
      if (selector === "#actionWorkspaceRoot [data-attack-validation]") return dialog.attackValidation;
      if (selector === "#actionWorkspaceRoot [data-damage-total]") return dialog.damageTotal;
      if (selector === "#actionWorkspaceRoot [data-damage-formula]") return dialog.damageFormula;
      return null;
    },
    querySelectorAll() { return [invoker]; },
    dispatchEvent() {},
  };
  return { dialog, invoker, bodyStyle };
}

function fireAction(dialog, action) {
  const button = {
    dataset: {
      workspaceAction: action,
      workspaceAttackId: ["attack-hit", "attack-miss"].includes(action)
        ? getWorkspaceSessionForTests()?.attackId : undefined,
    },
    closest(selector) { return selector === "[data-workspace-action]" ? this : null; },
  };
  button.parentElement = dialog;
  dialog.fire("click", { target: button });
}

test("production normal attack workspace records one action, snapshot damage and a fresh second attack", () => {
  const { dialog, invoker, bodyStyle } = installDomFixture();
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const unsubscribe = subscribe((state, metadata) =>
    reconcileWorkspaceAfterStateChange(state, metadata));
  assert.equal(initActionWorkspace(), true);

  const initialRevision = getSessionContext().stateRevision;
  const battleFixture = structuredClone(sara);
  startBattle(battleFixture, { rawD20: "10" }, { id: "workspace-battle" });
  beginOwnTurn(battleFixture, { id: "workspace-turn" });
  const renderedConsole = renderBattleConsole(battleFixture);
  assert.match(renderedConsole, /data-battle-command-open="normal-attack"/);
  const consoleRoot = new FakeNode();
  const consoleStatus = new FakeNode();
  consoleRoot.querySelector = (selector) =>
    selector === "[data-battle-status]" ? consoleStatus : null;
  bindBattleConsole(consoleRoot);
  const attackShortcut = new FakeNode();
  attackShortcut.parentElement = consoleRoot;
  attackShortcut.dataset.battleCommandOpen = "normal-attack";
  attackShortcut.closest = (selector) =>
    selector === "[data-battle-command-open]" ? attackShortcut : null;
  consoleRoot.fire("click", { target: attackShortcut });
  const opened = {
    ok: dialog.open,
    sessionId: getWorkspaceSessionForTests()?.workspaceSessionId,
  };
  assert.equal(opened.ok, true);
  assert.equal(getSessionContext().stateRevision, initialRevision);
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  assert.equal(getState().ui.turn.actionUsed, false);

  const attackMarkupBeforeModeChange = dialog.body.innerHTML;
  const modeSelect = {
    name: "rollMode", type: "select", value: "advantage",
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  modeSelect.parentElement = dialog;
  dialog.fire("change", { target: modeSelect });
  assert.equal(dialog.body.innerHTML, attackMarkupBeforeModeChange);
  assert.equal(dialog.secondD20.hidden, false);
  assert.equal(dialog.secondD20Input.required, true);
  modeSelect.value = "normal";
  dialog.fire("change", { target: modeSelect });
  assert.equal(dialog.body.innerHTML, attackMarkupBeforeModeChange);
  assert.equal(dialog.secondD20.hidden, true);
  assert.equal(dialog.secondD20Input.required, false);

  const previewInput = {
    name: "firstD20", type: "number", value: "10",
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  previewInput.parentElement = dialog;
  dialog.fire("input", { target: previewInput });
  assert.equal(getSessionContext().stateRevision, initialRevision);
  assert.match(dialog.attackStatus.textContent, /К20 10/);
  const confirmTransition = window.confirm;
  window.confirm = () => false;
  const cancelledTransition = prepareWorkspaceCharacterTransition("aurelia");
  window.confirm = confirmTransition;
  assert.equal(cancelledTransition.ok, false);
  assert.equal(dialog.open, true);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, opened.sessionId);

  minimizeWorkspace();
  const minimized = getWorkspaceSessionForTests();
  assert.equal(dialog.open, false);
  assert.equal(minimized.rawInputsByStep[minimized.currentStepKey].firstD20, "10");
  assert.match(renderBattleConsole(getState()), /data-workspace-resume=/);
  const invalidTarget = openNormalAttack({ sequenceId: "another-normal-sequence" });
  assert.equal(invalidTarget.ok, false);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, opened.sessionId);
  assert.equal(dialog.open, false);
  assert.equal(resumeWorkspace(opened.sessionId).ok, true);
  fireAction(dialog, "close");
  assert.equal(getWorkspaceSessionForTests().currentStep, "confirm-close");
  fireAction(dialog, "stay");
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");

  dialog.forms.attack = new FakeForm("attack", {
    kind: "attack-action", profileId: "unarmed", targetLabel: "Старая цель",
    rollMode: "advantage", firstD20: "10", secondD20: "15",
    targetArmorClass: "99", dmHitResult: "miss", confirmSeparateAction: false,
  });
  fireAction(dialog, "attack-hit");
  assert.equal(getState().monk.combatAssistant.activeSequences.some((item) =>
    item.id === getWorkspaceSessionForTests().sequenceId), false);
  assert.equal(getState().ui.turn.actionUsed, false);
  assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
  assert.match(dialog.footer.innerHTML, /Отмена текущего удара/);
  dialog.forms.damage = new FakeForm("damage", { damage1: "3" });
  globalThis.workspaceStorageFailures = true;
  fireAction(dialog, "submit-damage");
  globalThis.workspaceStorageFailures = false;
  const sequence = getState().monk.combatAssistant.activeSequences.find((item) =>
    item.id === getWorkspaceSessionForTests().sequenceId);
  const firstAttack = sequence.resolvedAttacks[0];
  assert.equal(sequence.kind, "attack-action");
  assert.equal(sequence.maximumAttacks, 2);
  assert.equal(firstAttack.chosenD20, 15);
  assert.equal(firstAttack.hitResult, "hit");
  assert.equal(firstAttack.hitResolutionSource, "dm");
  assert.equal(firstAttack.optionalTargetLabel, "");
  assert.equal(firstAttack.damageStatus, "recorded");
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  assert.equal(firstAttack.damageRolls[0], 3);
  assert.doesNotMatch(dialog.body.innerHTML, /data-sara-damage-submit/);
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].damageTotalBeforeTargetModifiers,
  3 + firstAttack.profileSnapshot.damageModifier);
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
  assert.doesNotMatch(dialog.footer.innerHTML, /data-workspace-action="next-attack"/);
  const appliedRevision = getSessionContext().stateRevision;
  globalThis.workspaceStorageFailures = true;
  const failedTransition = prepareWorkspaceCharacterTransition("aurelia");
  globalThis.workspaceStorageFailures = false;
  assert.equal(failedTransition.ok, false);
  assert.equal(dialog.open, true);
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
  fireAction(dialog, "next-attack");
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  fireAction(dialog, "retry-save");
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
  assert.equal(getSessionContext().stateRevision, appliedRevision);
  const currentContinuation = openNormalAttack({ sequenceId: sequence.id, mode: "current" });
  assert.equal(currentContinuation.ok, true);
  assert.equal(getWorkspaceSessionForTests().historicalOnly, false);
  fireAction(dialog, "next-attack");
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");

  const sequenceId = sequence.id;
  minimizeWorkspace();
  disposeWorkspaceOwner(getSessionContext(), "test-reload");
  const reopened = openNormalAttack({ sequenceId });
  assert.equal(reopened.ok, true);
  assert.equal(getWorkspaceSessionForTests().sequenceId, sequenceId);
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  const secondId = getWorkspaceSessionForTests().attackId;
  assert.notEqual(secondId, firstAttack.id);
  assert.deepEqual(getWorkspaceSessionForTests().rawInputsByStep[
    getWorkspaceSessionForTests().currentStepKey], {});
  const secondRoll = {
    name: "firstD20", type: "number", value: "13",
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  secondRoll.parentElement = dialog;
  dialog.fire("input", { target: secondRoll });
  const secondDraftKey = getWorkspaceSessionForTests().currentStepKey;
  const resolvedBeforeResume = getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks.length;
  minimizeWorkspace();
  assert.equal(resumeWorkspace(reopened.sessionId).ok, true);
  assert.equal(getWorkspaceSessionForTests().attackId, secondId);
  assert.equal(getWorkspaceSessionForTests().currentStepKey, secondDraftKey);
  assert.equal(getWorkspaceSessionForTests().rawInputsByStep[secondDraftKey].firstD20, "13");
  assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks.length,
    resolvedBeforeResume);

  dialog.forms.attack = new FakeForm("attack", {
    kind: "attack-action", profileId: "unarmed", targetLabel: "",
    rollMode: "normal", firstD20: "20", secondD20: "",
    confirmSeparateAction: false,
  });
  fireAction(dialog, "attack-hit");
  const completed = getState().monk.combatAssistant.activeSequences[0];
  assert.equal(completed.status, "open");
  assert.equal(completed.resolvedAttacks.length, 1);
  assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
  assert.match(dialog.body.innerHTML, /damage2/);
  dialog.forms.damage = new FakeForm("damage", { damage1: "3", damage2: "8" });
  fireAction(dialog, "submit-damage");
  const finalSequence = getState().monk.combatAssistant.activeSequences.find((item) =>
    item.id === sequenceId);
  assert.equal(finalSequence.resolvedAttacks[1].hitResult, "hit");
  assert.equal(finalSequence.resolvedAttacks[1].critical, true);
  assert.equal(finalSequence.resolvedAttacks[1].damageStatus, "recorded");
  assert.equal(finalSequence.resolvedAttacks[1].damageTotalBeforeTargetModifiers,
    3 + 8 + finalSequence.resolvedAttacks[1].profileSnapshot.damageModifier);
  assert.equal(finalSequence.status, "complete");

  fireAction(dialog, "close");
  fireAction(dialog, "confirm-close");
  openNormalAttack();
  dialog.forms.attack = new FakeForm("attack", {
    kind: "attack-action", profileId: "unarmed", targetLabel: "",
    rollMode: "normal", firstD20: "1", secondD20: "",
    confirmSeparateAction: true,
  });
  fireAction(dialog, "attack-miss");
  const additionalSequenceId = getWorkspaceSessionForTests().sequenceId;
  assert.equal(getState().monk.combatAssistant.activeSequences.find((item) =>
    item.id === additionalSequenceId).status, "open");
  fireAction(dialog, "close");
  assert.match(dialog.footer.innerHTML, /data-workspace-action="close-attack-remainder"/);
  assert.equal(getState().monk.combatAssistant.activeSequences.find((item) =>
    item.id === additionalSequenceId).status, "open");
  globalThis.workspaceStorageFailures = true;
  fireAction(dialog, "close-attack-remainder");
  globalThis.workspaceStorageFailures = false;
  assert.equal(getState().monk.combatAssistant.activeSequences.find((item) =>
    item.id === additionalSequenceId).status, "abandoned");
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
  assert.equal(dialog.open, true);
  fireAction(dialog, "retry-save");
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
  fireAction(dialog, "confirm-close");
  assert.equal(getWorkspaceSessionForTests(), null);

  assert.equal(bodyStyle.position, undefined);
  unsubscribe();
  disposeWorkspaceOwner(getSessionContext(), "test-cleanup");
  assert.equal(bodyStyle.position, undefined);
});
