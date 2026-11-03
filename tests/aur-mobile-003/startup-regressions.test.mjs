import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const bootstrapScript = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import vm from "node:vm";
  import { fileURLToPath, pathToFileURL } from "node:url";
  import { webcrypto } from "node:crypto";

  class FixtureNode {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.nodeType = 1;
      this.dataset = {};
      this.children = [];
      this.hidden = false;
      this.attributes = [];
      this.listeners = new Map();
      this.textContent = "";
      this.className = "";
      this.classList = {
        toggle: () => false,
        add: () => {},
        remove: () => {},
        contains: () => false,
      };
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    setAttribute() {}
    removeAttribute() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }

  const memory = new Map();
  const localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  const page = new FixtureNode("main");
  const picker = new FixtureNode("section");
  picker.hidden = true;
  const status = new FixtureNode("p");
  const choices = new FixtureNode("div");
  const byId = new Map([
    ["characterPicker", picker],
    ["characterPickerStatus", status],
    ["characterChoices", choices],
  ]);
  const document = {
    visibilityState: "visible",
    documentElement: new FixtureNode("html"),
    body: new FixtureNode("body"),
    addEventListener() {},
    dispatchEvent() {},
    querySelector: (selector) => selector === ".page" ? page : null,
    querySelectorAll: () => [],
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tagName) => new FixtureNode(tagName),
  };
  const window = {
    localStorage,
    addEventListener() {},
    confirm: () => false,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const context = vm.createContext({
    window, document, console, crypto: webcrypto, URL, structuredClone,
    HTMLElement: FixtureNode, Element: FixtureNode,
    HTMLDialogElement: class HTMLDialogElement extends FixtureNode {},
    HTMLInputElement: class HTMLInputElement extends FixtureNode {},
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    requestAnimationFrame: () => 1,
    fetch: () => { throw new Error("Unexpected external access: fetch"); },
    XMLHttpRequest: class { constructor() { throw new Error("Unexpected external access: XMLHttpRequest"); } },
  });
  const modules = new Map();
  async function loadModule(fileUrl) {
    const url = new URL(fileUrl).href;
    if (!modules.has(url)) {
      modules.set(url, (async () => {
        const source = await fs.readFile(fileURLToPath(url), "utf8");
        return new vm.SourceTextModule(source, { context, identifier: url });
      })());
    }
    return modules.get(url);
  }
  const root = process.cwd();
  const entryUrl = pathToFileURL(path.resolve(root, "scripts/app.js"));
  const entry = await loadModule(entryUrl.href);
  await entry.link(async (specifier, referencingModule) => {
    if (!specifier.startsWith(".")) throw new Error("Unexpected non-relative import: " + specifier);
    const target = new URL(specifier, referencingModule.identifier);
    const relative = path.relative(root, fileURLToPath(target));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Module import escapes repository root: " + target.href);
    }
    return loadModule(target.href);
  });
  await entry.evaluate();
  if (page.dataset.screen !== "characters") throw new Error("Picker screen was not selected");
  if (picker.hidden) throw new Error("Character picker remained hidden");
  if (choices.children.length < 2) throw new Error("Character choices were not created");
  if (page.dataset.taskOpen === "true") throw new Error("Initial task dock was falsely open");
  console.log("Isolated app bootstrap reached the character picker.");
`;

test("actual app bootstrap shows picker with empty in-memory preferences", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-vm-modules",
    "--input-type=module",
    "-e",
    bootstrapScript,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `Isolated bootstrap failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /Isolated app bootstrap reached the character picker\./);
});

test("service menu remains a closed details subtree before later page regions", async () => {
  const html = await fs.readFile(path.join(repositoryRoot, "index.html"), "utf8");
  const tokens = html.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g);
  const stack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr"]);
  let serviceMenu = null;
  let saveStatusParent = null;
  for (const match of tokens) {
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    const closing = /^<\//.test(token);
    const tag = token.match(/^<\/?([A-Za-z][\w:-]*)/)[1].toLowerCase();
    if (closing) {
      const opened = stack.pop();
      assert.equal(opened?.tag, tag, `Unexpected closing tag </${tag}>`);
      if (opened?.serviceMenu) serviceMenu = { ...opened, closed: true };
      continue;
    }
    const parent = stack.at(-1) ?? null;
    if (tag === "details" && /class=["'][^"']*\bservice-menu\b/.test(token)) {
      serviceMenu = { tag, parent: parent?.tag ?? null, controls: new Set(), closed: false };
    }
    if (serviceMenu && !serviceMenu.closed &&
        /data-(?:app-action|action)=|data-theme-preference\b/.test(token)) {
      serviceMenu.controls.add(token.match(/data-(?:app-action|action)=|data-theme-preference\b/)[0]);
    }
    if (/\bid=["']saraSaveStatus["']/.test(token)) {
      saveStatusParent = parent?.tag ?? null;
    }
    if (!voidTags.has(tag) && !/\/>$/.test(token)) {
      stack.push({
        tag,
        serviceMenu: tag === "details" && /class=["'][^"']*\bservice-menu\b/.test(token),
        controls: tag === "details" && /class=["'][^"']*\bservice-menu\b/.test(token)
          ? serviceMenu.controls : null,
      });
    }
  }
  assert.ok(serviceMenu?.closed, "service menu details element was not properly closed");
  assert.equal(serviceMenu.tag, "details");
  assert.deepEqual([...serviceMenu.controls].sort(), [
    "data-action=", "data-app-action=", "data-theme-preference",
  ]);
  assert.equal(saveStatusParent, "div", "later page content was nested inside the menu");
});
