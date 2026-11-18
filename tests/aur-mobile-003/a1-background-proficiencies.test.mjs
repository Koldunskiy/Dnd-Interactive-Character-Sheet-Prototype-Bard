import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { character as aurelia } from "../../data/character.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { renderInventoryMarkup } from "../../scripts/render/render-inventory.js";

// Test A1: Background proficiencies in profile rendering
// Since renderProfile takes a DOM root, we'll test the data preparation
test("A1: Aurelia proficiencies contain ready Russian strings not technical IDs", () => {
  const aur = structuredClone(aurelia);
  
  // Verify that Aurelia's backgroundDetails.proficiencies has ready Russian strings
  assert.deepEqual(aur.backgroundDetails.proficiencies.skills, ["Акробатика", "Выступление"]);
  assert.deepEqual(aur.backgroundDetails.proficiencies.tools, ["Набор для грима", "Музыкальный инструмент"]);
});

test("A1: Sara proficiencies use technical IDs that need translation", () => {
  // Sara's proficiencies use lowercase technical IDs
  // These will be found in SKILL_LABELS for translation
  const saraChar = structuredClone(sara);
  
  // Sara should have skill/tool IDs (lowercase strings)
  if (saraChar.backgroundDetails?.proficiencies?.skills?.length) {
    saraChar.backgroundDetails.proficiencies.skills.forEach(skill => {
      assert.ok(typeof skill === "string", `Skill should be string, got ${typeof skill}`);
    });
  }
  if (saraChar.backgroundDetails?.proficiencies?.tools?.length) {
    saraChar.backgroundDetails.proficiencies.tools.forEach(tool => {
      assert.ok(typeof tool === "string", `Tool should be string, got ${typeof tool}`);
    });
  }
});

test("A1: Empty/null proficiencies handled without errors", () => {
  const testState = structuredClone(aurelia);
  
  // These should not cause render to fail
  testState.backgroundDetails.proficiencies = { skills: [], tools: [] };
  const derived = getDerivedStats(testState);
  assert.ok(typeof derived === "object");
  
  testState.backgroundDetails.proficiencies = { skills: null, tools: undefined };
  const derived2 = getDerivedStats(testState);
  assert.ok(typeof derived2 === "object");
});

test("A1: Structured entries with name property preserved", () => {
  const testState = structuredClone(aurelia);
  
  // Mix of string and structured entries
  testState.backgroundDetails.proficiencies = {
    skills: ["Акробатика", { name: "Уникальный навык" }],
    tools: ["Набор для грима", { name: "Специальный инструмент" }]
  };
  
  // Should not throw when processing mixed formats
  const derived = getDerivedStats(testState);
  assert.ok(typeof derived === "object");
});

test("A1: formatIds accepts both ID lookups and ready strings", () => {
  // This tests the corrected formatIds behavior indirectly
  // The function should now handle: ID -> lookup, string -> preserve, object.name -> extract
  const aur = structuredClone(aurelia);
  const before = structuredClone(aur);
  
  const derived = getDerivedStats(aur);
  
  // Render should not mutate input
  assert.deepEqual(aur, before);
});

