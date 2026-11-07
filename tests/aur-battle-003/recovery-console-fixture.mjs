class Control extends EventTarget {
  constructor(root, dataset, disabled) {
    super();
    this.root = root;
    this.dataset = dataset;
    this.disabled = disabled;
    this.isConnected = true;
  }
  closest(selector) {
    if (selector.includes("[data-workspace-recovery]") &&
        Object.hasOwn(this.dataset, "workspaceRecovery")) return this;
    return null;
  }
}

class Region {
  constructor(root) {
    this.root = root;
    this.hidden = false;
    this.className = "";
    this.controls = [];
    this._innerHTML = "";
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(markup) {
    this.controls.forEach((control) => { control.isConnected = false; });
    this._innerHTML = markup;
    this.controls = [...markup.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => {
      const dataset = {};
      for (const [, key, value] of attrs.matchAll(/\b(data-[\w-]+)="([^"]*)"/g)) {
        dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      }
      return new Control(this.root, dataset, /\sdisabled(?:\s|$)/.test(attrs));
    });
  }
  querySelectorAll() { return []; }
  contains(control) { return this.controls.includes(control); }
}

class Shell {
  constructor(root) {
    this.dataset = {};
    this.regions = new Map([
      "[data-sara-hud-heading]", "[data-sara-home-hud]", "[data-sara-budget]",
      "[data-sara-navigation]", "[data-sara-pending-work]", "[data-sara-turn-controls]",
      "[data-sara-phase-content]", "[data-sara-idle-content]", "[data-sara-task-region]",
      "[data-combat-workspace-root]", "[data-sara-hud]",
    ].map((selector) => [selector, new Region(root)]));
  }
  querySelector(selector) {
    return selector === ".sara-combat-shell" ? this : this.regions.get(selector) ?? null;
  }
  contains(control) { return [...this.regions.values()].some((region) => region.contains(control)); }
}

export class RecoveryConsoleRoot extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.shell = new Shell(this);
    this.status = { textContent: "" };
  }
  querySelector(selector) {
    if (selector === ".sara-combat-shell") return this.shell;
    if (selector === "[data-battle-status]") return this.status;
    return null;
  }
  contains(control) { return this.shell.contains(control); }
  click(control) {
    for (const listener of this.listeners ?? []) listener({ target: control });
  }
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (type === "click") (this.listeners ??= []).push(listener);
  }
}

export { Control };
