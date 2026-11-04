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
      if (globalThis.document?.activeElement &&
          this.childNodes.some((child) => child.contains(globalThis.document.activeElement))) {
        globalThis.document.activeElement = this.dataset.fixtureBody ? this : null;
      }
      for (const child of this.childNodes) child.parentElement = null;
      this.childNodes = [];
    }
    this._innerHTML = markup;
    if (this.dataset.fixtureBody && this.childNodes.length === 0) {
      for (const match of markup.matchAll(/<input\b([^>]*)>/g)) {
        const name = match[1].match(/\bname="([^"]*)"/)?.[1];
        if (!name) continue;
        const value = match[1].match(/\bvalue="([^"]*)"/)?.[1] ?? "";
        const input = new FixtureInput(name, value);
        input.dataset.workspaceField = name;
        this.appendChild(input);
      }
      for (const [attribute, selector] of [
        ["data-incoming-stage", "stage"],
        ["data-incoming-reply-damage", "damage"],
        ["data-incoming-reply-hit-controls", "hit-controls"],
        ["data-incoming-preview", "preview"],
      ]) {
        const match = markup.match(new RegExp(`<[^>]+${attribute}(?:="([^"]*)")?[^>]*>([\\s\\S]*?)<\\/[^>]+>`));
        if (match) {
          const region = new FixtureNode();
          region.dataset.fixtureRegion = selector;
          region.dataset.incomingStage = match[1] ?? "";
          region.innerHTML = match[2];
          this.appendChild(region);
        }
      }
      if (this.dataset.fixtureControls) {
        for (const match of markup.matchAll(/<button\b([^>]*)>/g)) {
          const action = match[1].match(/\bdata-workspace-action="([^"]*)"/)?.[1];
          if (!action) continue;
          const button = new FixtureNode();
          button.dataset.workspaceAction = action;
          button.disabled = /\bdisabled\b/.test(match[1]);
          this.appendChild(button);
        }
      }
    } else if (this.dataset.fixtureRegion && this.parentElement) {
      const marker = this.dataset.fixtureRegion === "damage" ? "data-incoming-reply-damage"
        : this.dataset.fixtureRegion === "hit-controls" ? "data-incoming-reply-hit-controls"
          : this.dataset.fixtureRegion === "preview" ? "data-incoming-preview" : null;
      if (marker) {
        const expression = new RegExp(`(<div[^>]*${marker}[^>]*>)[\\s\\S]*?(<\\/div>)`);
        this.parentElement._innerHTML = this.parentElement._innerHTML.replace(
          expression, `$1${markup}$2`,
        );
        if (marker === "data-incoming-reply-damage") {
          for (const child of [...this.parentElement.childNodes]) {
            if (child.name === "replyDamage1" || child.name === "replyDamage2") {
              this.parentElement.removeChild(child);
            }
          }
          for (const match of markup.matchAll(/<input\b([^>]*)>/g)) {
            const name = match[1].match(/\bname="([^"]*)"/)?.[1];
            if (!name) continue;
            const value = match[1].match(/\bvalue="([^"]*)"/)?.[1] ?? "";
            const input = new FixtureInput(name, value);
            input.dataset.workspaceField = name;
            this.parentElement.appendChild(input);
          }
        }
      }
    } else if (this.dataset.fixtureControls && this.childNodes.length === 0) {
      for (const match of markup.matchAll(/<button\b([^>]*)>/g)) {
        const action = match[1].match(/\bdata-workspace-action="([^"]*)"/)?.[1];
        if (!action) continue;
        const button = new FixtureNode();
        button.dataset.workspaceAction = action;
        button.disabled = /\bdisabled\b/.test(match[1]);
        this.appendChild(button);
      }
    }
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
    if (globalThis.document?.activeElement === node) globalThis.document.activeElement = null;
    node.parentElement = null;
  }

  contains(node) {
    if (!node) return false;
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  querySelector(selector) {
    const name = selector.match(/name="([^"]+)"/)?.[1];
    if (name) return this.childNodes.find((node) => node.name === name) ?? null;
    const action = selector.match(/data-workspace-action="([^"]+)"/)?.[1];
    if (action) return this.childNodes.find((node) => node.dataset.workspaceAction === action) ?? null;
    const markers = {
      "[data-incoming-stage]": "stage",
      "[data-incoming-reply-damage]": "damage",
      "[data-incoming-reply-hit-controls]": "hit-controls",
      "[data-incoming-preview]": "preview",
    };
    const marker = markers[selector];
    return marker
      ? this.childNodes.find((node) => node.dataset.fixtureRegion === marker) ?? null
      : null;
  }
  closest(selector) {
    if (selector === "[data-workspace-form]" && this.dataset.workspaceForm) return this;
    if (selector === "[data-workspace-field]" && this.dataset.workspaceField) return this;
    if (selector === "[data-workspace-action]" && this.dataset.workspaceAction) return this;
    return null;
  }
  matches(selector) {
    return selector === 'input[type="number"]' && this.type === "number";
  }
  focus() { globalThis.document.activeElement = this; }
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
    this.header.dataset.fixtureControls = true;
    this.body = new FixtureNode();
    this.body.dataset.fixtureBody = true;
    this.body.dataset.fixtureControls = true;
    this.footer = new FixtureNode();
    this.footer.dataset.fixtureControls = true;
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
    return nodes[selector] ?? this.body.querySelector(selector);
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
    return this.embeddedHost &&
      ["[data-combat-workspace-root]", "[data-sara-task-dock]"].includes(selector);
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
  dialog.documentRoot = true;
  dialog.contains = FixtureNode.prototype.contains;
  dialog.showModalCount = 0;
  dialog.closeCount = 0;
  fallbackDialog.open = false;
  dialog.showModal = function showModal() {
    this.showModalCount += 1;
    this.open = true;
  };
  const invoker = reusableInvoker ??= new FixtureNode();
  const taskHud = new FixtureNode();
  const taskSceneControls = new FixtureNode();
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
  dialog.appendChild(taskHud);
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
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = {
    activeElement: null,
    body: { style: {} },
    documentElement: {
      attributes: new Set(),
      setAttribute(name) { this.attributes.add(name); },
      removeAttribute(name) { this.attributes.delete(name); },
      hasAttribute(name) { return this.attributes.has(name); },
    },
    getElementById(id) {
      if (id === "actionWorkspaceRoot") return fallbackDialog;
      if (id === "characterRollsRoot") return rollRoot;
      return null;
    },
    querySelector(selector) {
      if (selector === ".page") {
        return { dataset: { characterId: embeddedHost ? "sara-velaris" : "aurelia" } };
      }
      if (selector === "[data-sara-task-dock][data-combat-workspace-root]") {
        return embeddedHost ? dialog : null;
      }
      if (selector === "[data-sara-task-dock] [data-sara-task-hud]") return taskHud;
      if (selector === "[data-sara-task-scene-controls]") return taskSceneControls;
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
  return { dialog, invoker, taskHud, taskSceneControls, unsubscribe };
}

function assertWorkspaceHostInitialized() {
  if (!initActionWorkspace()) throw new Error("Workspace host did not initialize.");
}

export { FixtureForm };

export function fireWorkspaceAction(dialog, action, data = {}) {
  const selector = `[data-workspace-action="${action}"]`;
  const button = dialog.body.querySelector(selector) ?? dialog.footer.querySelector(selector) ?? {
    dataset: { workspaceAction: action },
    closest(match) { return match === "[data-workspace-action]" ? this : null; },
  };
  Object.assign(button.dataset, {
    workspaceAttackId: ["attack-hit", "attack-miss"].includes(action)
      ? getWorkspaceSessionForTests()?.attackId : undefined,
    ...data,
  });
  if (!button.parentElement) button.parentElement = dialog.body;
  globalThis.document.activeElement = button;
  dialog.fire("click", { target: button });
}

export function fireWorkspaceActionStrict(dialog, action, { apply = false, ...data } = {}) {
  const selector = `[data-workspace-action="${action}"]`;
  const button = dialog.header.querySelector(selector) ??
    dialog.body.querySelector(selector) ?? dialog.footer.querySelector(selector);
  if (!button || !button.isConnected) {
    throw new Error(`Expected connected rendered workspace control: ${action}`);
  }
  if (apply && button.disabled !== false) {
    throw new Error(`Expected enabled rendered apply control: ${action}`);
  }
  Object.assign(button.dataset, {
    workspaceAttackId: ["attack-hit", "attack-miss"].includes(action)
      ? getWorkspaceSessionForTests()?.attackId : undefined,
    ...data,
  });
  globalThis.document.activeElement = button;
  dialog.fire("click", { target: button });
}

export function fireWorkspaceInput(dialog, name, value, type = "number") {
  const form = Object.values(dialog.forms).find((candidate) =>
    candidate?.elements?.some((entry) => entry.name === name));
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
