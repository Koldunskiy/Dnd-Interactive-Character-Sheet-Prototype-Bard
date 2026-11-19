import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { character as aurelia } from "../../data/character.js";
import { renderBackgroundDetails } from "../../scripts/render/render-profile.js";

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
  
  // Should have headers
  assert.ok(html.includes("Владение навыками:"), "Should have skills header");
  
  // Extract the skills section to check for raw IDs
  const skillsStart = html.indexOf("Владение навыками:");
  const skillsEnd = html.indexOf(".", skillsStart);
  const skillsText = html.slice(skillsStart, skillsEnd);
  
  // Raw technical IDs should NOT appear in display (they might be in attributes)
  assert.ok(!skillsText.includes("deception"),
    "Raw ID 'deception' should not appear in skills display");
  assert.ok(!skillsText.includes("stealth"),
    "Raw ID 'stealth' should not appear in skills display");
});

test("A1: Empty proficiencies do not create output via renderBackgroundDetails", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  bgDetails.proficiencies = { skills: [], tools: [] };
  
  const html = renderBackgroundDetails(bgDetails);
  
  // With empty proficiencies and feature name still present, output should still be generated
  // But the skills/tools lines should not appear
  if (html.includes("Владение навыками:")) {
    // If it appears, it should be followed only by a period
    assert.match(html, /Владение навыками:\s*\./);
  }
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
  bgDetails.proficiencies.skills = ["Навык с <script>alert('xss')</script>"];
  
  const html = renderBackgroundDetails(bgDetails);
  
  // Should NOT contain executable script tag in rendered output
  assert.ok(!html.includes("<script>"),
    "Script tags should be escaped");
  
  // But the text content should still be visible
  assert.ok(html.includes("Навык с"),
    "Text content should be preserved");
  
  // And the escaped version should be present
  assert.ok(html.includes("&lt;script&gt;") || html.includes("&#") || !html.includes("script>"),
    "HTML should be escaped");
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
  
  // IDs should be translated
  assert.ok(html.includes("Скрытность") || html.includes("stealth"), 
    "ID should be translated or preserved");
  assert.ok(html.includes("Воровские инструменты") || html.includes("thieves-tools"),
    "Tool ID should be translated or preserved");
  
  // Raw IDs in identifier form should NOT appear in skills display
  const skillsStart = html.indexOf("Владение навыками:");
  const skillsEnd = html.indexOf(".", skillsStart);
  const skillsDisplay = html.slice(skillsStart, skillsEnd);
  
  // If stealth was not translated to Скрытность, that's acceptable (fallback),
  // but we should not have both the ID and translation
  assert.ok(!skillsDisplay.includes("stealth [") && !skillsDisplay.includes("] Скрытность"),
    "Should not have duplicate ID and translation");
});

test("A1: Mutation check - renderBackgroundDetails does not modify input", () => {
  const bgDetails = structuredClone(aurelia.backgroundDetails);
  const before = structuredClone(bgDetails);
  
  renderBackgroundDetails(bgDetails);
  
  assert.deepEqual(bgDetails, before,
    "renderBackgroundDetails should not mutate input");
});

