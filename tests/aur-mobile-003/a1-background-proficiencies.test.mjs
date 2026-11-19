import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { character as aurelia } from "../../data/character.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { renderBackgroundDetails, renderProfile } from "../../scripts/render/render-profile.js";

function extractBackground(html) {
  const opening = html.indexOf('data-sara-key="profile-background"');
  if (opening < 0) return "";
  const sectionStart = html.lastIndexOf("<section", opening);
  let depth = 0;
  let cursor = sectionStart;
  while (cursor >= 0) {
    const nextOpen = html.indexOf("<section", cursor);
    const nextClose = html.indexOf("</section>", cursor);
    if (nextClose < 0) return html.slice(sectionStart);
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      cursor = nextOpen + 8;
    } else {
      depth--;
      cursor = nextClose + 9;
      if (depth === 0) return html.slice(sectionStart, cursor);
    }
  }
  return html.slice(sectionStart);
}

test("A1: Aurelia proficiencies render correctly with ready Russian strings", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  const html = renderBackgroundDetails(bgDetails);
  
  // Should have background section
  assert.ok(html.includes('data-sara-key="profile-background"'), 
    "Background section should exist");
  
  // Check proficiency headers and values
  assert.ok(html.includes("Владение навыками:"),
    "Background should have skills header");
  assert.ok(html.includes("Владение инструментами:"),
    "Background should have tools header");
  
  // Check all Aurelia proficiencies are present
  assert.ok(html.includes("Акробатика"),
    "Background should contain Акробатика");
  assert.ok(html.includes("Выступление"),
    "Background should contain Выступление");
  assert.ok(html.includes("Набор для грима"),
    "Background should contain Набор для грима");
  assert.ok(html.includes("Музыкальный инструмент"),
    "Background should contain Музыкальный инструмент");
});

test("A1: Sara proficiencies render localized via renderBackgroundDetails", () => {
  const bgDetails = structuredClone(sara.backgroundDetails);
  const html = renderBackgroundDetails(bgDetails);
  const section = extractBackground(html);

  assert.match(section, /Владение навыками: Обман, Скрытность\./);
  assert.match(section, /Владение инструментами: Воровские инструменты, Игральные карты\./);
  for (const id of ["deception", "stealth", "thieves-tools", "playing-cards"]) {
    assert.ok(!section.includes(id), `Raw technical ID ${id} must not appear in visible background text`);
  }
});

test("A1: Empty proficiencies do not create output via renderBackgroundDetails", () => {
  for (const proficiencies of [
    { skills: [], tools: [] },
    { skills: null, tools: null },
    { skills: undefined, tools: undefined },
  ]) {
    const bgDetails = structuredClone(aurelia.backgroundDetails);
    bgDetails.proficiencies = proficiencies;
    const section = extractBackground(renderBackgroundDetails(bgDetails));
    assert.doesNotMatch(section, /Владение навыками:/);
    assert.doesNotMatch(section, /Владение инструментами:/);
  }
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  delete bgDetails.proficiencies;
  const section = extractBackground(renderBackgroundDetails(bgDetails));
  assert.doesNotMatch(section, /Владение навыками:/);
  assert.doesNotMatch(section, /Владение инструментами:/);
  assert.doesNotMatch(section, /\[object Object\]|undefined|null/);
});

test("A1: Proficiencies with structured entries render correctly via renderBackgroundDetails", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  bgDetails.proficiencies = {
    skills: ["Акробатика", { name: "Уникальный навык" }],
    tools: ["Набор для грима"]
  };
  
  const html = renderBackgroundDetails(bgDetails);
  
  // Both string and structured entry should appear
  assert.ok(html.includes("Акробатика"),
    "String skill should render");
  assert.ok(html.includes("Уникальный навык"),
    "Structured skill name should render");
});

test("A1: HTML escaping in proficiencies via renderBackgroundDetails", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  bgDetails.proficiencies.skills = [
    "Навык с <script>alert('xss')</script>",
    { name: "<img src=x onerror=alert(1)> Навык" },
  ];
  const html = renderBackgroundDetails(bgDetails);
  const section = extractBackground(html);
  assert.doesNotMatch(section, /<script\b|<img\b/);
  assert.match(section, /Навык с &lt;script&gt;alert\(&#039;xss&#039;\)&lt;\/script&gt;/);
  assert.match(section, /&lt;img src=x onerror=alert\(1\)&gt; Навык/);
});

test("A1: Null/undefined proficiencies handled without errors via renderBackgroundDetails", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  
  // Test null
  bgDetails.proficiencies.skills = null;
  bgDetails.proficiencies.tools = null;
  let html = renderBackgroundDetails(bgDetails);
  assert.ok(typeof html === "string", "Should not throw on null proficiencies");
  
  // Test undefined
  bgDetails.proficiencies = undefined;
  html = renderBackgroundDetails(bgDetails);
  assert.ok(typeof html === "string", "Should not throw on undefined proficiencies");
  
  // Test missing object
  bgDetails.proficiencies = {};
  html = renderBackgroundDetails(bgDetails);
  assert.ok(typeof html === "string", "Should not throw on empty proficiencies");
});

test("A1: Mixed skills/tools data - ID lookups and ready strings together", () => {
  const bgDetails = {
    name: "Простолюдин",
    feature: null,
    proficiencies: {
      skills: ["Акробатика", "stealth"], // Mix: ready string + ID that needs lookup
      tools: ["Набор для грима", "thieves-tools"] // Mix: ready string + ID
    },
    persona: {}
  };
  
  const html = renderBackgroundDetails(bgDetails);
  
  // Ready strings should appear
  assert.ok(html.includes("Акробатика"), "Ready skill string should appear");
  assert.ok(html.includes("Набор для грима"), "Ready tool string should appear");
  
  const section = extractBackground(html);
  assert.match(section, /Владение навыками: Акробатика, Скрытность\./);
  assert.match(section, /Владение инструментами: Набор для грима, Воровские инструменты\./);
  assert.doesNotMatch(section, /\bstealth\b|\bthieves-tools\b/);
});

test("A1: Switching Aurelia -> Sara -> Aurelia renders only the active background proficiencies", () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: () => ({ dataset: { characterId: "aurelia" } }),
  };
  globalThis.window = {
    matchMedia: () => ({ matches: true, addEventListener() {} }),
  };
  try {
    const root = { innerHTML: "" };
    renderProfile(root, structuredClone(aurelia), getDerivedStats(aurelia));
    let section = extractBackground(root.innerHTML);
    assert.match(section, /Акробатика/);
    assert.match(section, /Выступление/);
    assert.doesNotMatch(section, /Скрытность|Воровские инструменты/);

    renderProfile(root, structuredClone(sara), getDerivedStats(sara));
    section = extractBackground(root.innerHTML);
    assert.match(section, /Обман, Скрытность/);
    assert.match(section, /Воровские инструменты, Игральные карты/);
    assert.doesNotMatch(section, /Акробатика|Выступление|Набор для грима|Музыкальный инструмент/);

    renderProfile(root, structuredClone(aurelia), getDerivedStats(aurelia));
    section = extractBackground(root.innerHTML);
    assert.match(section, /Акробатика/);
    assert.match(section, /Выступление/);
    assert.doesNotMatch(section, /Скрытность|Воровские инструменты/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("A1: Mutation check - renderBackgroundDetails does not modify input", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  const before = structuredClone(bgDetails);
  
  renderBackgroundDetails(bgDetails);
  
  assert.deepEqual(bgDetails, before,
    "renderBackgroundDetails should not mutate input");
});

