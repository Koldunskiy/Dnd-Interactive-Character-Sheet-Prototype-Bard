import {
  getWorkspaceSessionForTests,
  initActionWorkspace,
  reconcileWorkspaceAfterStateChange,
} from "../../scripts/workspace/controller.js";
import { openCharacterSession, subscribe } from "../../scripts/state.js";

class FixtureNode {
  constructor() {
    this.dataset = {};
    this.listeners = new Map();
    this.innerHTML = "";
    this.textContent = "";
    this.scrollTop = 0;
    this.style = { setProperty() {} };
    this.isConnected = true;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  fire(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  contains() { return true; }
  closest(selector) {
    if (selector === "[data-workspace-form]" && this.dataset.workspaceForm) return this;
    return null;
  }
  focus() {}
  querySelectorAll() { return []; }
  setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = value; }
  getBoundingClientRect() { return { top: 200 }; }
}

class FixtureForm extends FixtureNode {
  constructor(kind, values) {
    super();
    this.dataset.workspaceForm = kind;
    this.elements = Object.entries(values).map(([name, value]) => ({
      name,
      type: typeof value === "boolean" ? "checkbox" :
        name.startsWith("damage") || name.includes("D20") ? "number" : "text",
      checked: value === true,
      value: typeof value === "boolean" ? "" : value,
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
    this.hp = new FixtureNode();
    this.ki = new FixtureNode();
    this.preview = new FixtureNode();
    this.damagePreview = new FixtureNode();
    this.attackTotal = new FixtureNode();
    this.attackFormula = new FixtureNode();
    this.attackStatus = new FixtureNode();
    this.attackValidation = new FixtureNode();
    this.damageTotal = new FixtureNode();
    this.damageFormula = new FixtureNode();
    this.secondD20 = new FixtureNode();
    this.secondD20.hidden = true;
    this.secondD20Input = { required: false };
    this.secondD20.querySelector = (selector) =>
      selector === 'input[name="secondD20"]' ? this.secondD20Input : null;
    this.forms = {};
  }

  querySelector(selector) {
    const nodes = {
      "[data-workspace-header]": this.header,
      "[data-workspace-body]": this.body,
      "[data-workspace-footer]": this.footer,
      "[data-workspace-status]": this.status,
      "[data-workspace-title]": this.heading,
      '[data-workspace-form="attack"]': this.forms.attack,
      '[data-workspace-form="damage"]': this.forms.damage,
      '[data-workspace-form="strike"]': this.forms.strike,
      '[data-workspace-form="command"]': this.forms.command,
      '[data-workspace-form="missile-return"]': this.forms.missileReturn,
      '[data-workspace-form="roll-followup"]': this.forms.rollFollowup,
      "[data-workspace-hp]": this.hp,
      "[data-workspace-ki]": this.ki,
      "[data-workspace-preview]": this.preview,
      "[data-workspace-damage-preview]": this.damagePreview,
      "[data-attack-total]": this.attackTotal,
      "[data-attack-formula]": this.attackFormula,
      "[data-attack-status]": this.attackStatus,
      "[data-attack-validation]": this.attackValidation,
      "[data-damage-total]": this.damageTotal,
      "[data-damage-formula]": this.damageFormula,
      "[data-workspace-second-d20]": this.secondD20,
    };
    return nodes[selector] ?? null;
  }

  showModal() { this.open = true; }
  close() { this.open = false; }
  toggleAttribute() {}
}

export function installWorkspaceFixture() {
  const dialog = new FixtureDialog();
  const invoker = new FixtureNode();
  invoker.dataset.workspaceInvoker = "normal-attack";
  const rollRoot = { hidden: true };
  globalThis.HTMLDialogElement = FixtureDialog;
  globalThis.Element = FixtureNode;
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  globalThis.window = {
    scrollY: 300,
    visualViewport: { height: 780, offsetTop: 0, addEventListener() {} },
    addEventListener() {},
    scrollTo() {},
    scrollBy() {},
    confirm: () => true,
    localStorage: {
      values: new Map(),
      getItem(key) { return this.values.get(key) ?? null; },
      setItem(key, value) { this.values.set(key, value); },
      removeItem(key) { this.values.delete(key); },
    },
  };
  globalThis.document = {
    body: { style: {} },
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
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const unsubscribe = subscribe((state, metadata) =>
    reconcileWorkspaceAfterStateChange(state, metadata));
  assertWorkspaceHostInitialized();
  return { dialog, invoker, unsubscribe };
}

function assertWorkspaceHostInitialized() {
  if (!initActionWorkspace()) throw new Error("Workspace host did not initialize.");
}

export { FixtureForm };

export function fireWorkspaceAction(dialog, action) {
  const button = {
    dataset: {
      workspaceAction: action,
      workspaceAttackId: ["attack-hit", "attack-miss"].includes(action)
        ? getWorkspaceSessionForTests()?.attackId : undefined,
    },
    closest(selector) { return selector === "[data-workspace-action]" ? this : null; },
  };
  dialog.fire("click", { target: button });
}

export function fireWorkspaceInput(dialog, name, value, type = "number") {
  const form = dialog.forms.attack ?? dialog.forms.damage ?? dialog.forms.strike;
  const control = form?.elements?.find((entry) => entry.name === name);
  if (control) {
    if (type === "checkbox") control.checked = value === true;
    else control.value = value;
  }
  const field = {
    name,
    value,
    type,
    checked: false,
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  dialog.fire("input", { target: field });
}
