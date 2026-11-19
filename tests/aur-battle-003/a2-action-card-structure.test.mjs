import test from "node:test";
import assert from "node:assert/strict";
import { renderHomeActionCard } from "../../scripts/render/render-battle-console.js";

// Limited structural parser for markup emitted by renderHomeActionCard().
// It is not a general HTML parser; it tracks element stack and direct parents.
function parseControlledMarkup(html) {
  const root = { tag: "#root", parent: null, attrs: "", children: [] };
  const stack = [root];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g;
  let match;
  while ((match = tagPattern.exec(html))) {
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<!") ) continue;
    if (/^<\//.test(token)) {
      const closing = /^<\/([A-Za-z][A-Za-z0-9:-]*)/.exec(token)?.[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === closing) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const opening = /^<([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/.exec(token);
    if (!opening) continue;
    const tag = opening[1].toLowerCase();
    const attrs = opening[2];
    const node = { tag, parent: stack.at(-1), attrs, children: [] };
    stack.at(-1).children.push(node);
    const selfClosing = /\/\s*>$/.test(token);
    if (!voidTags.has(tag) && !selfClosing) stack.push(node);
  }
  return root;
}

function attributeValue(node, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`).exec(node.attrs);
  return match ? (match[1] ?? match[2]) : null;
}

function findNodes(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children) findNodes(child, predicate, found);
  return found;
}

function validateButtonStructure(html) {
  const result = {
    hasButton: false,
    hasIcon: false,
    hasContent: false,
    hasMeta: false,
    iconIsDirectChild: false,
    contentIsDirectChild: false,
    metaIsDirectChild: false,
    metaNotInContent: false,
    reasonInContent: false,
    reasonNotInMeta: false,
    disabledOnButton: false,
    errors: [],
  };
  const tree = parseControlledMarkup(html);
  const [button] = findNodes(tree, (node) => node.tag === "button");
  if (!button) {
    result.errors.push("No button element found");
    return result;
  }
  result.hasButton = true;
  result.disabledOnButton = /(?:^|\s)disabled(?:\s|=|$)/.test(attributeValue(button, "disabled") === "" ? " disabled" : ` ${button.attrs}`);

  const direct = button.children;
  const findClassDirect = (className) => direct.find((node) => attributeValue(node, "class")?.split(/\s+/).includes(className));
  const icon = findClassDirect("battle-home-action__icon");
  const content = findClassDirect("battle-home-action__content");
  const meta = findClassDirect("battle-home-action__meta");
  const allMeta = findNodes(button, (node) =>
    attributeValue(node, "class")?.split(/\s+/).includes("battle-home-action__meta")
  );

  result.hasIcon = Boolean(icon);
  result.iconIsDirectChild = Boolean(icon);
  result.hasContent = Boolean(content);
  result.contentIsDirectChild = Boolean(content);
  result.hasMeta = allMeta.length > 0;
  result.metaIsDirectChild = Boolean(meta);
  result.metaNotInContent = Boolean(meta) && meta.parent === button &&
    !(content && findNodes(content, (node) => node === meta).length);

  if (icon && icon.parent !== button) result.errors.push("Icon is not a direct button child");
  if (content && content.parent !== button) result.errors.push("Content is not a direct button child");
  if (meta && meta.parent !== button) result.errors.push("Meta is not a direct button child");
  if (!meta) result.errors.push("No meta span found");
  if (!content) result.errors.push("No content span found");
  if (content && findNodes(content, (node) =>
    attributeValue(node, "class")?.split(/\s+/).includes("battle-home-action__meta")
  ).length) result.errors.push("Meta is nested inside content");
  if (!meta && allMeta.length) result.errors.push("Meta is not a direct button child");

  if (content) {
    const reasonNodes = findNodes(content, (node) =>
      attributeValue(node, "class")?.split(/\s+/).includes("battle-home-action__reason")
    );
    result.reasonInContent = reasonNodes.length > 0;
  }
  if (meta) {
    const reasonNodes = findNodes(meta, (node) =>
      attributeValue(node, "class")?.split(/\s+/).includes("battle-home-action__reason")
    );
    result.reasonNotInMeta = reasonNodes.length === 0;
  } else {
    result.reasonNotInMeta = true;
  }
  return result;
}

test("A2: Home action card has correct DOM structure with meta as direct button child", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Атака",
    description: "Основное действие",
    actionType: "Действие",
    cost: "",
    hook: 'data-action="open-normal-attack"',
    disabled: false,
    reason: "",
    prominent: false,
  });
  
  const structure = validateButtonStructure(html);
  
  assert.ok(structure.hasButton, "Button element missing");
  assert.ok(structure.hasIcon, "Icon span missing");
  assert.ok(structure.hasContent, "Content span missing");
  assert.ok(structure.hasMeta, "Meta span missing");
  
  assert.ok(structure.iconIsDirectChild, "Icon should be direct child of button");
  assert.ok(structure.contentIsDirectChild, "Content should be direct child of button");
  assert.ok(structure.metaIsDirectChild, "Meta should be direct child of button");
  
  assert.ok(structure.metaNotInContent, "Meta must not be nested inside content");
  assert.deepEqual(structure.errors, [], `Structure errors: ${structure.errors.join(", ")}`);
});

test("A2: Home action card meta appears after content in HTML", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Атака",
    description: "Основное действие",
    actionType: "Действие",
    cost: "5 ци",
    hook: "",
    disabled: false,
    reason: "",
    prominent: false,
  });
  
  // Find positions
  const iconPos = html.indexOf("battle-home-action__icon");
  const contentPos = html.indexOf("battle-home-action__content");
  const metaPos = html.indexOf("battle-home-action__meta");
  
  assert.ok(iconPos >= 0 && contentPos >= 0 && metaPos >= 0, "All elements must exist");
  assert.ok(iconPos < contentPos && contentPos < metaPos, "HTML order should be icon -> content -> meta");
});

test("A2: Home action card meta contains actionType and cost text", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Атака",
    description: "Основное действие",
    actionType: "Действие",
    cost: "2 уровня",
    hook: "",
    disabled: false,
    reason: "",
    prominent: false,
  });
  
  // Extract meta section
  const metaStart = html.indexOf('<span class="battle-home-action__meta"');
  const metaEnd = html.indexOf("</span>", metaStart);
  const metaSection = html.slice(metaStart, metaEnd);
  
  assert.ok(metaSection.includes("Действие"), "Meta should contain actionType");
  assert.ok(metaSection.includes("2 уровня"), "Meta should contain cost");
});

test("A2: Home action card meta empty text when no cost provided", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Атака",
    description: "Основное действие",
    actionType: "Действие",
    cost: "",
    hook: "",
    disabled: false,
    reason: "",
    prominent: false,
  });
  
  // Extract meta section
  const metaStart = html.indexOf('<span class="battle-home-action__meta"');
  const metaEnd = html.indexOf("</span>", metaStart);
  const metaSection = html.slice(metaStart, metaEnd);
  
  assert.ok(metaSection.includes("Действие"));
  // Cost should not appear when empty
  assert.ok(!metaSection.includes("<small></small>") || metaSection.trim().endsWith("Действие</span>"));
});

test("A2: Primary action card structure is maintained", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Основная атака",
    description: "Первый удар",
    actionType: "Действие",
    cost: "",
    hook: 'data-action="primary"',
    disabled: false,
    reason: "",
    prominent: true,
  });
  
  const structure = validateButtonStructure(html);
  
  assert.ok(html.includes("battle-home-action--primary"));
  
  // All elements still present and correctly positioned
  assert.ok(structure.hasIcon && structure.hasContent && structure.hasMeta);
  assert.ok(structure.iconIsDirectChild);
  assert.ok(structure.contentIsDirectChild);
  assert.ok(structure.metaIsDirectChild);
  assert.ok(structure.metaNotInContent);
});

test("A2: Disabled action card structure preserved", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Недоступная атака",
    description: "Невозможно использовать",
    actionType: "Действие",
    cost: "",
    hook: "",
    disabled: true,
    reason: "Израсходовано действие",
    prominent: false,
  });
  
  const structure = validateButtonStructure(html);
  
  assert.ok(html.includes('disabled'));
  assert.ok(html.includes("Израсходовано действие"));
  
  // Structure intact even when disabled
  assert.ok(structure.hasIcon && structure.hasContent && structure.hasMeta);
  assert.ok(structure.metaIsDirectChild, "Meta must be direct button child even when disabled");
  assert.ok(structure.metaNotInContent);
});

test("A2: Reason text appears in content, not in meta", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Атака",
    description: "Основное действие",
    actionType: "Действие",
    cost: "",
    hook: "",
    disabled: false,
    reason: "Израсходовано действие",
    prominent: false,
  });
  
  // Reason text should appear somewhere
  assert.ok(html.includes("Израсходовано действие"), "Reason text should appear in HTML");
  
  // But NOT in meta section
  const metaStart = html.indexOf('<span class="battle-home-action__meta"');
  const metaEnd = html.indexOf("</span>", metaStart);
  const metaSection = html.slice(metaStart, metaEnd);
  
  assert.ok(!metaSection.includes("Израсходовано действие"), "Reason must not be in meta");
});

test("A2: Multiple action cards maintain structure independence", () => {
  const cards = [
    {
      icon: "attack",
      title: "Атака",
      description: "Первая",
      actionType: "Действие",
      cost: "",
      hook: 'data-action="attack-1"',
      disabled: false,
      reason: "",
      prominent: true,
    },
    {
      icon: "roll",
      title: "Бросок",
      description: "Вторая",
      actionType: "Действие",
      cost: "",
      hook: 'data-action="roll"',
      disabled: false,
      reason: "",
      prominent: false,
    },
  ].map(renderHomeActionCard);
  
  // Parse each card's structure independently
  cards.forEach((card, idx) => {
    const structure = validateButtonStructure(card);
    
    // Each card must have correct structure
    assert.ok(structure.hasIcon && structure.hasContent && structure.hasMeta, `Card ${idx} missing elements`);
    assert.ok(structure.iconIsDirectChild, `Card ${idx}: icon not direct child`);
    assert.ok(structure.contentIsDirectChild, `Card ${idx}: content not direct child`);
    assert.ok(structure.metaIsDirectChild, `Card ${idx}: meta not direct child`);
    assert.ok(structure.metaNotInContent, `Card ${idx}: meta should not be in content`);
  });
});

test("A2: NEGATIVE FIXTURE - old nested meta structure must fail validation", () => {
  // This is the OLD BUGGY structure where meta is nested inside content
  const badHtml = `<button type="button" class="battle-home-action">
    <span class="battle-home-action__icon"><svg></svg></span>
    <span class="battle-home-action__content">
      <strong>Атака</strong>
      <span>Описание</span>
      <span class="battle-home-action__meta">Действие</span>
    </span>
  </button>`;
  
  const structure = validateButtonStructure(badHtml);
  
  // The validator should detect the error
  assert.ok(structure.hasMeta, "Meta should exist");
  assert.ok(structure.hasContent, "Content should exist");
  
  // But meta is nested inside content - this violates grid requirements
  assert.ok(!structure.metaNotInContent, 
    "NEGATIVE: Nested meta should fail - structure.metaNotInContent should be false");
  assert.ok(structure.errors.includes("Meta is nested inside content"),
    "NEGATIVE: Should detect meta nesting error");
});

test("A2: NEGATIVE FIXTURE - meta in div.wrapper is not a direct button child", () => {
  const badHtml = `<button type="button" class="battle-home-action">
    <span class="battle-home-action__icon"><svg><path d="M0 0"/></svg></span>
    <span class="battle-home-action__content">
      <strong>Атака</strong><span>Описание</span>
    </span>
    <div class="wrapper">
      <span class="battle-home-action__meta">Действие</span>
    </div>
  </button>`;
  const structure = validateButtonStructure(badHtml);
  assert.ok(!structure.metaIsDirectChild);
  assert.ok(structure.errors.includes("Meta is not a direct button child"));
});

test("A2: NEGATIVE FIXTURES - content and icon may not be wrapped", () => {
  for (const [name, badHtml] of [
    ["content", `<button class="battle-home-action"><span class="battle-home-action__icon"></span><div><span class="battle-home-action__content"><strong>Атака</strong></span></div><span class="battle-home-action__meta">Действие</span></button>`],
    ["icon", `<button class="battle-home-action"><div><span class="battle-home-action__icon"></span></div><span class="battle-home-action__content"><strong>Атака</strong></span><span class="battle-home-action__meta">Действие</span></button>`],
  ]) {
    const structure = validateButtonStructure(badHtml);
    if (name === "content") assert.ok(!structure.contentIsDirectChild);
    if (name === "icon") assert.ok(!structure.iconIsDirectChild);
  }
});

test("A2: production card keeps hooks, disabled state, reason and primary/cost semantics", () => {
  const html = renderHomeActionCard({
    icon: "attack",
    title: "Основная атака",
    description: "Первый удар",
    actionType: "Действие",
    cost: "2 ци",
    hook: 'data-action="open-normal-attack"',
    disabled: true,
    reason: "Израсходовано действие",
    prominent: true,
  });
  const structure = validateButtonStructure(html);
  assert.ok(structure.iconIsDirectChild);
  assert.ok(structure.contentIsDirectChild);
  assert.ok(structure.metaIsDirectChild);
  assert.ok(structure.metaNotInContent);
  assert.equal(structure.disabledOnButton, true);
  assert.equal(structure.reasonInContent, true);
  assert.equal(structure.reasonNotInMeta, true);
  assert.match(html, /battle-home-action--primary/);
  assert.match(html, /data-action="open-normal-attack"/);
  assert.match(html, /class="battle-home-action__meta">Действие<small>2 ци<\/small><\/span>/);
  assert.deepEqual(structure.errors, []);
});
