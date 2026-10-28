import test from "node:test";
import assert from "node:assert/strict";

class MiniNode {
  constructor(nodeType, ownerDocument, tagName = "") {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.parentNode = null;
    this._childNodes = [];
    this._text = "";
    this._innerHTML = "";
    this.innerHTMLWrites = 0;
    this.id = "";
    this.className = "";
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.value = "";
  }

  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }

  get childNodes() {
    return this._childNodes;
  }

  get children() {
    return this._childNodes.filter((node) => node.nodeType === 1);
  }

  get firstChild() {
    return this._childNodes[0] ?? null;
  }

  append(...nodes) {
    for (const node of nodes) this.insertBefore(node, null);
  }

  appendChild(node) {
    this.insertBefore(node, null);
    return node;
  }

  insertBefore(node, referenceNode) {
    if (node === referenceNode) return node;
    if (node.parentNode) {
      const oldIndex = node.parentNode._childNodes.indexOf(node);
      if (oldIndex >= 0) node.parentNode._childNodes.splice(oldIndex, 1);
    }
    node.parentNode = this;
    const index = referenceNode == null ? -1 : this._childNodes.indexOf(referenceNode);
    if (referenceNode != null && index < 0) throw new Error("Reference node is not a child.");
    if (index < 0) this._childNodes.push(node);
    else this._childNodes.splice(index, 0, node);
    return node;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode._childNodes.indexOf(this);
    if (index >= 0) this.parentNode._childNodes.splice(index, 1);
    this.parentNode = null;
  }

  replaceChildren(...nodes) {
    for (const child of this._childNodes) child.parentNode = null;
    this._childNodes = [];
    this._text = "";
    this.append(...nodes);
  }

  set textContent(value) {
    this.replaceChildren();
    this._text = String(value ?? "");
  }

  get textContent() {
    return this._text + this._childNodes.map((node) => node.textContent).join("");
  }

  set innerHTML(value) {
    this.innerHTMLWrites += 1;
    this._innerHTML = String(value ?? "");
    this.replaceChildren();

    if (this.id === "lorePanel") {
      const heading = this.ownerDocument.createElement("h2");
      heading.textContent = "Лор";
      const cards = this.ownerDocument.createElement("div");
      cards.id = "loreCardsRoot";
      cards.className = "cards-grid";
      const mount = this.ownerDocument.createElement("div");
      mount.id = "loreNotesMount";
      this.append(heading, cards, mount);
    } else if (this.id === "loreNotesRoot") {
      const heading = this.ownerDocument.createElement("div");
      heading.className = "section-heading-row";
      const title = this.ownerDocument.createElement("h2");
      title.className = "section-title";
      title.textContent = "Заметки";
      const add = this.ownerDocument.createElement("button");
      add.dataset.noteAdd = "";
      heading.append(title, add);

      const issue = this.ownerDocument.createElement("p");
      issue.className = "lore-notes-issue";
      const contents = [heading, issue];
      if (this._innerHTML.includes("lore-notes-empty")) {
        const empty = this.ownerDocument.createElement("p");
        empty.className = "lore-notes-empty";
        empty.textContent = "Заметок пока нет";
        contents.push(empty);
      }
      const cards = this.ownerDocument.createElement("div");
      cards.className = "lore-note-cards";
      contents.push(cards);
      this.append(...contents);
    } else if (this.id === "loreCardsRoot") {
      const expressions = this._innerHTML.matchAll(/<details\b([^>]*)>/g);
      for (const [, attributes] of expressions) {
        const details = this.ownerDocument.createElement("details");
        const disclosure = attributes.match(/data-profile-disclosure="([^"]*)"/);
        if (disclosure) details.dataset.profileDisclosure = disclosure[1];
        details.open = /\bopen\b/.test(attributes);
        this.append(details);
      }
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    } else if (name === "id") this.id = stringValue;
    else if (name === "class") this.className = stringValue;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, parts)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

function matchesSimpleSelector(node, selector) {
  const tag = selector.match(/^[a-zA-Z][\w-]*/)?.[0];
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const [, id] of selector.matchAll(/#([\w-]+)/g)) {
    if (node.id !== id) return false;
  }
  for (const [, className] of selector.matchAll(/\.([\w-]+)/g)) {
    if (!node.className.split(/\s+/).includes(className)) return false;
  }
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of selector.matchAll(
    /\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g,
  )) {
    const value = name.startsWith("data-")
      ? node.dataset[name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())]
      : name === "id"
        ? node.id || null
        : name === "class"
          ? node.className || null
          : node.getAttribute(name);
    if (value == null) return false;
    const expected = doubleQuoted ?? singleQuoted ?? unquoted;
    if (expected != null && String(value) !== expected) return false;
  }
  return true;
}

function matchesSelector(node, parts) {
  if (!matchesSimpleSelector(node, parts.at(-1))) return false;
  let ancestor = node.parentElement;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) {
      ancestor = ancestor.parentElement;
    }
    if (!ancestor) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

class MiniDocument extends MiniNode {
  constructor() {
    super(9, null, "#document");
    this.ownerDocument = this;
    this.activeElement = null;
  }

  createElement(tagName) {
    return new MiniNode(1, this, tagName);
  }

  createTextNode(value) {
    const node = new MiniNode(3, this, "#text");
    node._text = String(value ?? "");
    return node;
  }

  getElementById(id) {
    return this.querySelector("#" + id);
  }
}

test("R1: lore notes precede history and keep editor nodes, empty state, and issue state", async () => {
  globalThis.document = new MiniDocument();
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: true }),
  };
  const panel = document.createElement("section");
  panel.id = "lorePanel";
  document.append(panel);
  const { renderLorePanel, setLoreNoteExpanded } = await import("../../scripts/render/render-lore.js");
  const state = { lore: { noteEntries: [] } };

  renderLorePanel(state);
  const notesRoot = document.getElementById("loreNotesRoot");
  const notesMount = document.getElementById("loreNotesMount");
  const cardsRoot = document.getElementById("loreCardsRoot");
  assert.ok(notesRoot);
  assert.ok(cardsRoot);
  assert.ok(notesMount);
  assert.ok(notesRoot.querySelector(".lore-notes-empty"));
  assert.equal(notesRoot.querySelector(".lore-notes-empty").textContent, "Заметок пока нет");
  assert.equal(notesRoot.querySelector(".lore-notes-empty").hidden, false);
  assert.equal(notesRoot.querySelector("[data-note-add]").disabled, false);

  notesRoot.querySelector(".lore-notes-empty").remove();
  renderLorePanel(state);
  assert.equal(document.getElementById("loreNotesRoot"), notesRoot);
  assert.equal(notesRoot.querySelector(".lore-notes-empty").hidden, false);

  state.lore.noteEntries = [{ id: "n1", title: "Имя", text: "Запись" }];
  renderLorePanel(state);
  const card = notesRoot.querySelector("[data-note-id]");
  const titleInput = card.querySelector('[data-note-field="title"]');
  const textInput = card.querySelector('[data-note-field="text"]');
  setLoreNoteExpanded("n1", true);
  panel.insertBefore(cardsRoot, notesMount);
  renderLorePanel(state);

  const documentOrder = [];
  const collectOrder = (node) => {
    for (const child of node.children) {
      documentOrder.push(child);
      collectOrder(child);
    }
  };
  collectOrder(panel);
  assert.ok(documentOrder.indexOf(notesRoot) < documentOrder.indexOf(cardsRoot));
  assert.equal(document.getElementById("loreNotesRoot"), notesRoot);
  assert.equal(notesRoot.querySelector("[data-note-id]"), card);
  assert.equal(card.querySelector('[data-note-field="title"]'), titleInput);
  assert.equal(card.querySelector('[data-note-field="text"]'), textInput);
  assert.equal(card.querySelector(".lore-note-editor").hidden, false);
  assert.equal(card.querySelector("[data-note-toggle]").getAttribute("aria-expanded"), "true");
  assert.equal(panel.innerHTMLWrites, 0);

  const malformedEntries = "malformed";
  state.lore.noteEntries = malformedEntries;
  renderLorePanel(state);
  assert.equal(state.lore.noteEntries, malformedEntries);
  assert.equal(notesRoot.querySelector("[data-note-id]"), card);
  assert.equal(notesRoot.querySelector(".lore-notes-issue").hidden, false);
  assert.notEqual(notesRoot.querySelector(".lore-notes-issue").textContent, "");
  assert.equal(notesRoot.querySelector(".lore-notes-empty").hidden, true);
  assert.equal(notesRoot.querySelector("[data-note-add]").disabled, true);

  state.lore.noteEntries = [];
  renderLorePanel(state);
  assert.equal(notesRoot.querySelector(".lore-notes-empty").hidden, false);
  assert.equal(notesRoot.querySelector("[data-note-add]").disabled, false);

  const ids = document.querySelectorAll("[id]").map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
});
