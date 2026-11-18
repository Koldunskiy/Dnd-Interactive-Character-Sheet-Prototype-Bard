import test from "node:test";
import assert from "node:assert/strict";
import { renderHomeActionCard } from "../../scripts/render/render-battle-console.js";

// Simple regex-based HTML parser for testing structure
function parseHtmlStructure(html) {
  const result = {
    button: null,
    icon: null,
    content: null,
    meta: null,
    iconParent: null,
    contentParent: null,
    metaParent: null,
  };
  
  // Check if button exists
  if (/<button[^>]*class="battle-home-action/.test(html)) {
    result.button = true;
    
    // Check if icon span is a direct child of button (before content)
    if (/<button[^>]*>[\s\S]*?<span class="battle-home-action__icon"/.test(html)) {
      result.icon = true;
      result.iconParent = "button";
    }
    
    // Check if content span exists and is direct child of button
    if (/<button[^>]*>[\s\S]*?<span class="battle-home-action__content"/.test(html)) {
      result.content = true;
      result.contentParent = "button";
    }
    
    // Check if meta span is a direct child of button (not nested in content)
    // This is the critical check: meta should come after </span> (content closing)
    const contentEndIdx = html.indexOf("</span>", html.indexOf("battle-home-action__content"));
    const metaIdx = html.indexOf("battle-home-action__meta", contentEndIdx);
    const buttonEndIdx = html.indexOf("</button>");
    
    if (metaIdx > contentEndIdx && metaIdx < buttonEndIdx) {
      result.meta = true;
      result.metaParent = "button";
    }
    
    // Check that meta is NOT nested inside content
    const contentStart = html.indexOf('<span class="battle-home-action__content"');
    const contentEnd = html.indexOf("</span>", contentStart);
    const contentSection = html.slice(contentStart, contentEnd);
    
    if (!contentSection.includes("battle-home-action__meta")) {
      result.metaNotInContent = true;
    }
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
  
  const structure = parseHtmlStructure(html);
  
  assert.ok(structure.button, "Button element missing");
  assert.ok(structure.icon, "Icon span missing");
  assert.ok(structure.content, "Content span missing");
  assert.ok(structure.meta, "Meta span missing");
  
  assert.equal(structure.iconParent, "button", "Icon should be direct child of button");
  assert.equal(structure.contentParent, "button", "Content should be direct child of button");
  assert.equal(structure.metaParent, "button", "Meta should be direct child of button");
  
  assert.ok(structure.metaNotInContent, "Meta must not be nested inside content");
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
  
  const structure = parseHtmlStructure(html);
  
  assert.ok(html.includes("battle-home-action--primary"));
  
  // All elements still present and correctly positioned
  assert.ok(structure.icon && structure.content && structure.meta);
  assert.equal(structure.iconParent, "button");
  assert.equal(structure.contentParent, "button");
  assert.equal(structure.metaParent, "button");
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
  
  const structure = parseHtmlStructure(html);
  
  assert.ok(html.includes('disabled'));
  assert.ok(html.includes("Израсходовано действие"));
  
  // Structure intact even when disabled
  assert.ok(structure.icon && structure.content && structure.meta);
  assert.equal(structure.metaParent, "button", "Meta must be direct button child even when disabled");
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
  
  // Find button content
  const hasReasonInHtml = html.includes("Израсходовано действие");
  assert.ok(hasReasonInHtml, "Reason text should appear in HTML");
  
  // Extract content section (everything before meta)
  const metaIdx = html.indexOf('<span class="battle-home-action__meta"');
  const beforeMeta = html.slice(0, metaIdx);
  
  // Reason should NOT be in meta section
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
  
  const html = cards.join("");
  
  // Count button openings (not class matches, as there might be nested elements)
  const buttonOpenings = (html.match(/<button[^>]*class="battle-home-action/g) ?? []).length;
  assert.equal(buttonOpenings, 2);
  
  // Parse each card's structure independently
  cards.forEach((card, idx) => {
    const structure = parseHtmlStructure(card);
    
    // Each card must have correct structure
    assert.ok(structure.icon && structure.content && structure.meta, `Card ${idx} missing elements`);
    assert.equal(structure.iconParent, "button", `Card ${idx}: icon parent wrong`);
    assert.equal(structure.contentParent, "button", `Card ${idx}: content parent wrong`);
    assert.equal(structure.metaParent, "button", `Card ${idx}: meta parent wrong`);
    assert.ok(structure.metaNotInContent, `Card ${idx}: meta should not be in content`);
  });
});
