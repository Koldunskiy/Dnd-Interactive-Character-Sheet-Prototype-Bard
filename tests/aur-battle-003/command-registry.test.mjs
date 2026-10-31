import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import {
  BATTLE_CATEGORIES,
  getSaraBattleCommandRegistry,
  projectSaraBattleCategories,
  selectBattleCategory,
} from "../../scripts/battle/command-registry.js";

test("battle categories are transient projections and share Step of the Wind identity", () => {
  const state = structuredClone(sara);
  const before = JSON.stringify(state);
  assert.deepEqual(BATTLE_CATEGORIES.map(({ label }) => label), [
    "Действие", "Бонусное", "Движение", "Реакции",
  ]);
  const registry = getSaraBattleCommandRegistry(state);
  const step = registry.find((entry) => entry.id === "step-of-the-wind");
  assert.ok(step);
  assert.deepEqual(step.navigationGroups, ["bonus", "movement"]);
  assert.equal(step.activationBudget, "bonus-action");
  assert.ok(step.resourceCost.endsWith(MONK_TECHNIQUE_BY_ID.get("ll-monk:step-of-the-wind").payment));
  assert.match(step.resourceCost, /^Бонусное действие · 0/);

  selectBattleCategory(state.profile.id, "bonus");
  const bonusProjection = projectSaraBattleCategories(state, "bonus");
  selectBattleCategory(state.profile.id, "movement");
  const movementProjection = projectSaraBattleCategories(state, "movement");
  assert.equal(bonusProjection.commands.find((entry) => entry.id === step.id).id, step.id);
  assert.equal(movementProjection.commands.find((entry) => entry.id === step.id).id, step.id);
  assert.equal(JSON.stringify(state), before);
});

test("unavailable commands include Russian reasons for spent budgets and missing selections", () => {
  const state = structuredClone(sara);
  state.ui.turn.bonusActionUsed = true;
  state.monk.ordinaryTechniqueIds = state.monk.ordinaryTechniqueIds
    .filter((id) => id !== "ll-monk:step-of-the-wind");
  for (const [slot, id] of Object.entries(state.monk.signatureTechniqueSlots ?? {})) {
    if (id === "ll-monk:step-of-the-wind") delete state.monk.signatureTechniqueSlots[slot];
  }
  const commands = getSaraBattleCommandRegistry(state);
  const flurry = commands.find((entry) => entry.id === "flurry");
  const wind = commands.find((entry) => entry.id === "step-of-the-wind");
  assert.equal(flurry.availability.enabled, false);
  assert.match(flurry.availability.reasonRu, /уже использовано/);
  assert.equal(wind.availability.enabled, false);
  assert.match(wind.availability.reasonRu, /Техника не выбрана/);
  assert.match(commands.find((entry) => entry.id === "normal-attack").resourceCost, /^Действие · \d+ уда/);
});
