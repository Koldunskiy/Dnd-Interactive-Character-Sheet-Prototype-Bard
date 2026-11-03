import {
  disposeWorkspaceOwner,
  getWorkspaceSessionForTests,
  initActionWorkspace,
  reconcileWorkspaceAfterStateChange,
} from "../../scripts/workspace/controller.js";
import { openCharacterSession, subscribe } from "../../scripts/state.js";

export class FixtureNode {
  constructor() {
    this.dataset = {};
    this.listeners = new Map();
    this.parentElement = null;
    this.childNodes = [];
    this._innerHTML = "";
    this.textContent = "";
    this.scrollTop = 0;
    this._rootConnected = true;
    this.style = {
      values: new Map(),
      setProperty(name, value) { this.values.set(name, value); },
      getPropertyValue(name) { return this.values.get(name) ?? ""; },
    };
  }

  get isConnected() { return this._rootConnected; }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(markup) {
    if (this._innerHTML !== markup) {
      for (const child of this.childNodes) child.parentElement = null;
      this.childNodes = [];
    }
    this._innerHTML = markup;
  }

  fire(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  appendChild(node) {
    node.parentElement?.removeChild?.(node);
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentElement = null;
  }

  contains(node) {
    if (!node) return false;
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
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
  constructor(kind, values, schema = {}) {
    super();
    this.dataset.workspaceForm = kind;
    this.schema = schema;
    this.elements = Object.entries(values).map(([name, value]) => ({
      name,
      type: typeof value === "boolean" ? "checkbox" :
        schema[name]?.type ?? (name.startsWith("damage") || name.includes("D20") ? "number" : "text"),
      checked: value === true,
      value: typeof value === "boolean" ? "" : value,
    }));
  }

  checkValidity() {
    return this.elements.every((field) => {
      const rule = this.schema[field.name] ?? {};
      if (rule.required && (field.type === "checkbox" ? !field.checked : !String(field.value).trim())) {
        return false;
      }
      if (field.type === "number" && String(field.value).trim()) {
        const value = Number(field.value);
        if (!Number.isInteger(value) ||
            rule.min != null && value < rule.min ||
            rule.max != null && value > rule.max) return false;
      }
      return true;
    });
  }

  reportValidity() { return this.checkValidity(); }
}

class FixtureDialog extends FixtureNode {
  constructor() {
    super();
    this.open = false;
    this.header = new FixtureNode();
    this.body = new FixtureNode();
    this.footer = new FixtureNode();
    this.status = new FixtureNode();
    this.error = new FixtureNode();
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
    this.appendChild(this.header);
    this.appendChild(this.body);
    this.appendChild(this.footer);
    this.appendChild(this.status);
    this.appendChild(this.error);
    this.secondD20 = new FixtureNode();
    this.hitDieHealing = new FixtureNode();
    this.hitDieHpAfter = new FixtureNode();
    this.cantrip2 = new FixtureNode();
    this.restReplacementSubchoices = new FixtureNode();
    this.secondD20.hidden = true;
    this.secondD20Input = { required: false };
    this.secondD20.querySelector = (selector) =>
      selector === 'input[name="secondD20"]' ? this.secondD20Input : null;
    this.forms = {};
    this.showModalCount = 0;
    this.closeCount = 0;
    this.embeddedHost = false;
  }

  querySelector(selector) {
    const nodes = {
      "[data-workspace-header]": this.header,
      "[data-workspace-body]": this.body,
      "[data-workspace-footer]": this.footer,
      "[data-workspace-status]": this.status,
      "[data-workspace-error]": this.error,
      "[data-workspace-title]": this.heading,
      '[data-workspace-form="attack"]': this.forms.attack,
      '[data-workspace-form="damage"]': this.forms.damage,
      '[data-workspace-form="strike"]': this.forms.strike,
      '[data-workspace-form="command"]': this.forms.command,
      '[data-workspace-form="missile-return"]': this.forms.missileReturn,
      '[data-workspace-form="seeking"]': this.forms.seeking,
      '[data-workspace-form="gentling"]': this.forms.gentling,
      '[data-workspace-form="roll-followup"]': this.forms.rollFollowup,
      '[data-workspace-form="roll-consequence"]': this.forms.rollConsequence,
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
      "[data-hit-die-healing]": this.hitDieHealing,
      "[data-hit-die-hp-after]": this.hitDieHpAfter,
      '[data-workspace-field="cantrip2"]': this.cantrip2,
      "[data-rest-replacement-subchoices]": this.restReplacementSubchoices,
    };
    return nodes[selector] ?? null;
  }

  fire(type, event) {
    if (type === "submit" && Object.values(this.forms).includes(event.target)) {
      event.target.parentElement = this.body;
    }
    super.fire(type, event);
  }

  showModal() { this.open = true; }
  close() { this.open = false; this.closeCount += 1; }
  matches(selector) {
    return selector === "[data-combat-workspace-root]" && this.embeddedHost;
  }
  toggleAttribute() {}
}

export class FixtureInput extends FixtureNode {
  constructor(name, value = "") {
    super();
    this.name = name;
    this.value = value;
    this.type = "number";
  }

  get isConnected() {
    for (let current = this.parentElement; current; current = current.parentElement) {
      if (current.documentRoot === true) return true;
    }
    return false;
  }

  focus() {
    globalThis.document.activeElement = this;
  }
}

let reusableDialog = null;
let reusableInvoker = null;

export function installWorkspaceFixture({ embeddedHost = false } = {}) {
  const dialog = reusableDialog ??= new FixtureDialog();
  const fallbackDialog = embeddedHost ? new FixtureDialog() : dialog;
  dialog.embeddedHost = embeddedHost;
  dialog.contains = FixtureNode.prototype.contains;
  dialog.showModalCount = 0;
  dialog.closeCount = 0;
  fallbackDialog.open = false;
  dialog.showModal = function showModal() {
    this.showModalCount += 1;
    this.open = true;
  };
  const invoker = reusableInvoker ??= new FixtureNode();
  const taskHud = {
    innerHTML: "",
    querySelectorAll: () => [],
  };
  dialog.open = false;
  dialog.forms = {};
  dialog.childNodes = [];
  dialog.header.parentElement = null;
  dialog.body.parentElement = null;
  dialog.footer.parentElement = null;
  dialog.status.parentElement = null;
  dialog.error.parentElement = null;
  for (const node of [dialog.header, dialog.body, dialog.footer, dialog.status, dialog.error]) {
    dialog.appendChild(node);
  }
  for (const node of [dialog.header, dialog.body, dialog.footer, dialog.status]) {
    node.innerHTML = "";
    node.textContent = "";
    node.scrollTop = 0;
  }
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
    activeElement: null,
    body: { style: {} },
    getElementById(id) {
      if (id === "actionWorkspaceRoot") return fallbackDialog;
      if (id === "characterRollsRoot") return rollRoot;
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-sara-task-dock] [data-sara-task-hud]") return taskHud;
      if (selector === '[data-panel="melee"].is-active' && embeddedHost) {
        return {
          querySelector: (innerSelector) =>
            innerSelector === "[data-combat-workspace-root]" ? dialog : null,
        };
      }
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
  const previousSession = getWorkspaceSessionForTests();
  if (previousSession) disposeWorkspaceOwner(previousSession.owner, "session-changed");
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const unsubscribe = subscribe((state, metadata) =>
    reconcileWorkspaceAfterStateChange(state, metadata));
  assertWorkspaceHostInitialized();
  return { dialog, invoker, taskHud, unsubscribe };
}

function assertWorkspaceHostInitialized() {
  if (!initActionWorkspace()) throw new Error("Workspace host did not initialize.");
}

export { FixtureForm };

export function fireWorkspaceAction(dialog, action, data = {}) {
  const button = {
    dataset: {
      workspaceAction: action,
      workspaceAttackId: ["attack-hit", "attack-miss"].includes(action)
        ? getWorkspaceSessionForTests()?.attackId : undefined,
      ...data,
    },
    closest(selector) { return selector === "[data-workspace-action]" ? this : null; },
  };
  button.parentElement = dialog;
  dialog.fire("click", { target: button });
}

export function fireWorkspaceInput(dialog, name, value, type = "number") {
  const form = dialog.forms.attack ?? dialog.forms.damage ?? dialog.forms.strike ??
    dialog.forms.command ?? dialog.forms.missileReturn ?? dialog.forms.seeking ??
    dialog.forms.gentling;
  const control = form?.elements?.find((entry) => entry.name === name);
  if (control) {
    if (type === "checkbox") control.checked = value === true;
    else control.value = value;
  }
  const field = {
    name,
    value,
    type,
    checked: type === "checkbox" && value === true,
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  field.parentElement = dialog.body;
  dialog.fire("input", { target: field });
}
