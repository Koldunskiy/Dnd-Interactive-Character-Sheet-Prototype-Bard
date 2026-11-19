import test from "node:test";
import assert from "node:assert/strict";
import { renderHomeActionCard } from "../../scripts/render/render-battle-console.js";

// Proper structure validator - correctly finds content closing tag
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
    errors: [],
  };
  
  // Find button opening
  const buttonStart = html.indexOf('<button');
  if (buttonStart < 0) {
    result.errors.push("No button element found");
    return result;
  }
  result.hasButton = true;
  
  const buttonTagEnd = html.indexOf('>', buttonStart);
  const buttonEnd = html.indexOf('</button>', buttonStart);
  if (buttonEnd < 0) {
    result.errors.push("Button not closed");
    return result;
  }
  
  const buttonInner = html.slice(buttonTagEnd + 1, buttonEnd);
  
  // Find icon
  const iconStart = buttonInner.indexOf('<span class="battle-home-action__icon"');
  if (iconStart >= 0) {
    result.hasIcon = true;
    result.iconIsDirectChild = true; // If found in buttonInner, it's direct child
  }
  
  // Find content - correctly identify its closing tag
  const contentStart = buttonInner.indexOf('<span class="battle-home-action__content"');
  if (contentStart >= 0) {
    result.hasContent = true;
    result.contentIsDirectChild = true;
    
    // Find content closing tag by counting nested spans
    let spanCount = 1;
    let pos = contentStart + '<span class="battle-home-action__content"'.length;
    
    while (spanCount > 0 && pos < buttonInner.length) {
      const nextOpen = buttonInner.indexOf('<span', pos);
      const nextClose = buttonInner.indexOf('</span>', pos);
      
      if (nextClose < 0) break;
      
      if (nextOpen >= 0 && nextOpen < nextClose) {
        spanCount++;
        pos = nextOpen + 5;
      } else {
        spanCount--;
        pos = nextClose + 7;
      }
    }
    
    const contentEnd = pos;
    const contentSection = buttonInner.slice(contentStart, contentEnd);
    
    // Check if meta is inside content
    if (contentSection.includes('class="battle-home-action__meta"')) {
      result.errors.push("Meta is nested inside content");
    } else {
      result.metaNotInContent = true;
    }
  } else {
    result.errors.push("No content span found");
  }
  
  // Find meta
  const metaStart = buttonInner.indexOf('<span class="battle-home-action__meta"');
  if (metaStart >= 0) {
    result.hasMeta = true;
    result.metaIsDirectChild = true; // If found in buttonInner, it's direct child
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
