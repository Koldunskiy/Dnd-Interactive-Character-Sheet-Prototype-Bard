import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext, openCharacterSession } from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  initActionWorkspace,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";

class FixtureNode {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.dataset = {};
    this.listeners = new Map();
    this.isConnected = true;
    this.style = { setProperty() {} };
  }
  appendChild(node) { node.parentElement = this; }
  addEventListener(type, fn) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(fn);
    this.listeners.set(type, listeners);
  }
  fire(type, event) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  contains(node) { return node?.parentElement === this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  getBoundingClientRect() { return { top: 0 }; }
}

class FixtureForm {
  constructor(values) {
    this.elements = Object.entries(values).map(([name, value]) => ({
      name, value, checked: false, type: name.includes("D20") ? "number" : "text",
    }));
  }
}

class FixtureDialog extends FixtureNode {
  constructor() {
    super();
    this.open = false;
    this.header = new FixtureNode();
    this.body = new FixtureNode();
    this.footer = new FixtureNode();
    this.status = new FixtureNode();
    this.heading = new FixtureNode();
    this.forms = {};
  }
  querySelector(selector) {
    if (selector === "[data-workspace-header]") return this.header;
    if (selector === "[data-workspace-body]") return this.body;
    if (selector === "[data-workspace-footer]") return this.footer;
    if (selector === "[data-workspace-status]") return this.status;
    if (selector === "[data-workspace-title]" || selector === "#workspaceDialogTitle") return this.heading;
    if (selector === '[data-workspace-form="attack"]') return this.forms.attack ?? null;
    return null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  toggleAttribute() {}
}

function installFixture() {
  const dialog = new FixtureDialog();
  globalThis.HTMLDialogElement = FixtureDialog;
  globalThis.Element = FixtureNode;
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  globalThis.window = {
    visualViewport: { height: 800, offsetTop: 0, addEventListener() {} },
    addEventListener() {}, scrollTo() {}, scrollBy() {}, confirm: () => true,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  globalThis.document = {
    body: { style: {} },
    getElementById: (id) => id === "actionWorkspaceRoot" ? dialog : null,
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent() {},
  };
  return dialog;
}

function clickRendered(dialog, action) {
  const control = `data-workspace-action="${action}"`;
  assert.ok(dialog.footer.innerHTML.includes(control), `rendered footer lacks ${action}`);
  const button = {
    dataset: { workspaceAction: action, workspaceAttackId: getWorkspaceSessionForTests()?.attackId },
    isConnected: true,
    disabled: false,
    parentElement: dialog,
    closest(selector) { return selector === "[data-workspace-action]" ? this : null; },
  };
  assert.equal(button.isConnected, true);
  assert.equal(button.disabled, false);
  dialog.fire("click", { target: button });
}

test("new normal hit remains free until damage, and draft cancellation changes no game state", () => {
  const dialog = installFixture();
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  assert.equal(initActionWorkspace(), true);
  const opened = openNormalAttack();
  assert.equal(opened.ok, true);
  const revision = getSessionContext().stateRevision;
  const beforeSequenceCount = getState().monk?.combatAssistant?.activeSequences?.length ?? 0;
  dialog.forms.attack = new FixtureForm({
    profileId: "unarmed", rollMode: "normal", firstD20: "10",
    secondD20: "", confirmSeparateAction: false,
  });
  clickRendered(dialog, "attack-hit");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(getState().ui.turn.actionUsed, false);
  assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, beforeSequenceCount);
  assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
  clickRendered(dialog, "cancel-attack-draft");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(getState().ui.turn.actionUsed, false);
  assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, beforeSequenceCount);
  assert.equal(getWorkspaceSessionForTests(), null);
});
