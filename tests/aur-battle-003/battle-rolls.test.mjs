import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { CHARACTER_DESCRIPTORS } from "../../scripts/characters.js";
import { mergeCharacterState } from "../../scripts/storage.js";
import {
  beginOwnTurn,
  correctInitiative,
  endBattle,
  endOwnTurn,
  pauseBattle,
  resumeBattle,
  startBattle,
} from "../../scripts/battle/transitions.js";
import { getSaraRollBreakdown } from "../../scripts/rolls/providers/sara.js";
import { calculateCharacterRoll } from "../../scripts/rolls/calculations.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { renderSaraCombatPanel } from "../../scripts/render/render-techniques.js";
import {
  amendCharacterRoll,
  correctCharacterRollOutcome,
  recordCharacterRoll,
  resolveCharacterRollConsequence,
} from "../../scripts/rolls/commands.js";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import {
  recordAttackDamage,
  recordAttackOutcome,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";

const cloneSara = () => structuredClone(sara);

test("battle initiative uses current Dexterity and keeps the scene in waiting", () => {
  const character = cloneSara();
  character.ui.turn.actionUsed = true;
  character.ui.turn.bonusActionUsed = true;
  character.ui.turn.reactionUsed = true;
  character.combat.ki.current = 5;

  assert.equal(startBattle(character, { rawD20: "" }).ok, false);
  const started = startBattle(character, { rawD20: "14" }, { id: "battle-test" });
  assert.equal(started.ok, true);
  assert.equal(started.initiative.total, 19);
  assert.deepEqual(started.initiative.sources, [
    { id: "dexterity", label: "Ловкость", value: 5 },
  ]);
  assert.equal(character.battleConsole.current.phase, "waiting");
  assert.equal(character.ui.turn.actionUsed, true);
  assert.equal(character.combat.ki.current, 5);
  assert.equal(beginOwnTurn(character, { id: "turn-test" }).ok, true);
  assert.equal(character.ui.turn.actionUsed, false);
  assert.equal(character.ui.turn.bonusActionUsed, false);
  assert.equal(character.ui.turn.reactionUsed, false);
  assert.equal(character.combat.ki.current, 5);
  assert.equal(beginOwnTurn(character).ok, false);
});

test("battle pause, resume, correction, and end do not restore resources", () => {
  const character = cloneSara();
  character.combat.ki.current = 4;
  startBattle(character, { rawD20: "14" }, { id: "battle-test" });
  assert.equal(correctInitiative(character, { rawD20: "10" }).initiative.total, 15);
  beginOwnTurn(character, { id: "turn-test" });
  character.ui.turn.reactionUsed = true;
  assert.equal(pauseBattle(character).ok, true);
  assert.equal(character.battleConsole.current.phaseBeforePause, "own-turn");
  assert.equal(resumeBattle(character).ok, true);
  assert.equal(character.battleConsole.current.phase, "own-turn");
  assert.equal(endOwnTurn(character).ok, true);
  assert.equal(character.ui.turn.reactionUsed, true);
  assert.equal(character.battleConsole.current.phase, "waiting");
  assert.equal(endBattle(character).ok, true);
  assert.equal(character.battleConsole.current, null);
  assert.equal(character.battleConsole.history.at(-1).endedReason, "manual");
  assert.equal(character.combat.ki.current, 4);
});

test("general checks and saves use provider breakdowns and strict physical dice", () => {
  const character = cloneSara();
  const athletics = getSaraRollBreakdown(character, "ability-check", "athletics");
  const roll = calculateCharacterRoll({
    kind: "ability-check",
    rollMode: "advantage",
    firstD20: "8",
    secondD20: "16",
    dc: "18",
    advantageReason: "Высокая точка обзора",
  }, athletics);
  assert.equal(roll.ok, true);
  assert.equal(roll.rawD20Rolls.length, 2);
  assert.equal(roll.chosenD20, 16);
  assert.equal(roll.dcResult, roll.total >= 18);
  assert.equal(calculateCharacterRoll({
    kind: "saving-throw",
    rollMode: "normal",
    firstD20: "",
  }, getSaraRollBreakdown(character, "saving-throw", "wisdom")).ok, false);
  assert.equal(calculateCharacterRoll({
    kind: "saving-throw",
    rollMode: "normal",
    firstD20: "12",
    spellSaveSource: true,
  }, getSaraRollBreakdown(character, "saving-throw", "wisdom")).ok, false);
});

test("optional battle and roll metadata merge without a schema-version bump", () => {
  const descriptor = CHARACTER_DESCRIPTORS["sara-velaris"];
  const persisted = cloneSara();
  delete persisted.battleConsole;
  delete persisted.characterRolls;
  const merged = mergeCharacterState(descriptor.defaults, persisted);
  assert.equal(merged.schemaVersion, 1);
  assert.equal(merged.battleConsole, undefined);
  assert.equal(merged.characterRolls, undefined);
});

test("Mantle and Indomitable Spirit amendments pay Ki and update only the recorded roll", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const startingKi = getState().combat.ki.current;
  const persuasion = recordCharacterRoll({
    kind: "ability-check", id: "persuasion", rollMode: "normal", firstD20: "3", dc: "15",
  });
  assert.equal(persuasion.status, "applied");
  const mantle = amendCharacterRoll(persuasion.record.id, "ll-monk:mantle-of-courtesy");
  assert.equal(mantle.status, "applied");
  assert.equal(mantle.record.chosenD20, 12);
  assert.equal(mantle.record.total, 12 + mantle.record.totalModifier);
  assert.equal(mantle.record.appliedAmendments.length, 1);
  assert.equal(getState().combat.ki.current, startingKi - 1);

  const athletics = recordCharacterRoll({
    kind: "ability-check", id: "athletics", rollMode: "normal", firstD20: "5",
  });
  const priorTotal = athletics.record.total;
  const spirit = amendCharacterRoll(athletics.record.id, "ll-monk:indomitable-spirit");
  assert.equal(spirit.status, "applied");
  assert.equal(spirit.record.total, priorTotal + 4);
  assert.equal(getState().combat.ki.current, startingKi - 2);
});

test("attack damage uses the profile snapshot from the recorded physical attack", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const started = startAttackSequence(getSessionContext(), {
    kind: "attack-action",
    sequenceId: "snapshot-sequence",
  }, "snapshot-start");
  assert.equal(started.status, "applied");
  const attack = recordAttackOutcome(
    getSessionContext(),
    "snapshot-sequence",
    "snapshot-attack",
    {
      kind: "attack-action",
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "10",
      targetArmorClass: "10",
    },
    "snapshot-attempt",
  );
  assert.equal(attack.status, "applied");
  const recordedAttack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  assert.equal(recordedAttack.attackTotal, 20);
  assert.equal(recordedAttack.critical, false);
  updateState((draft) => {
    draft.abilities.dexterity = 18;
    return draft;
  });
  const damage = recordAttackDamage(
    getSessionContext(),
    "snapshot-sequence",
    "snapshot-attack",
    ["3"],
    "snapshot-damage",
  );
  assert.equal(damage.status, "applied");
  assert.equal(
    getState().monk.combatAssistant.activeSequences[0]
      .resolvedAttacks[0].damageTotalBeforeTargetModifiers,
    9,
  );
});

test("Flurry is unavailable while waiting and atomically pays before its attacks", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const kiBefore = getState().combat.ki.current;
  assert.equal(executeBattleCommand("start-battle", { rawD20: "14" }).status, "applied");
  assert.notEqual(startAttackSequence(getSessionContext(), {
    kind: "flurry", sequenceId: "waiting-flurry", confirmed: true,
  }, "waiting-flurry-op").status, "applied");
  assert.equal(getState().combat.ki.current, kiBefore);

  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  const flurry = startAttackSequence(getSessionContext(), {
    kind: "flurry", sequenceId: "turn-flurry", confirmed: true,
  }, "turn-flurry-op");
  assert.equal(flurry.status, "applied");
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
  assert.equal(getState().ui.turn.actionUsed, false);
  const miss = recordAttackOutcome(
    getSessionContext(),
    "turn-flurry",
    "turn-flurry:1",
    { kind: "flurry", profileId: "unarmed", rollMode: "normal", firstD20: "1" },
    "turn-flurry-attack",
  );
  assert.equal(miss.status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].hitResult, "miss");
  assert.equal(executeBattleCommand("end-own-turn").status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0].status, "abandoned");
  assert.equal(getState().combat.ki.current, kiBefore - 1);
});

test("turn-based attack launch controls are absent while the battle is waiting", () => {
  const character = cloneSara();
  startBattle(character, { rawD20: "14" }, { id: "render-battle" });
  character.monk.combatAssistant = {
    activeSequences: [{ resolvedAttacks: [{ damageStatus: "awaiting-damage" }] }],
    pendingApplications: [{ targetOutcome: "unknown" }],
    recentlyCompletedSummaries: [{ kind: "regeneration", dieResult: 4, usefulHealing: 3 }],
  };
  assert.match(renderBattleConsole(character), /Бой: незавершённые события · 2/);
  character.monk.combatAssistant.activeSequences = [];
  let markup = renderSaraCombatPanel(character, getDerivedStats(character));
  assert.doesNotMatch(markup, /data-attack-form-open=/);
  assert.match(markup, /Обычную атаку и бонусный удар можно начать только в свой ход/);
  assert.match(markup, /Недавние события/);
  assert.match(markup, /полезное лечение 3 HP/);

  beginOwnTurn(character, { id: "render-turn" });
  markup = renderSaraCombatPanel(character, getDerivedStats(character));
  assert.match(markup, /data-attack-form-open=/);
});

test("Dexterity-save Evasion consequence is explicit and corrections do not recalculate HP", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const hpBefore = getState().combat.hp.current;
  const tempBefore = getState().combat.hp.temp;
  const recorded = recordCharacterRoll({
    kind: "saving-throw",
    id: "dexterity",
    rollMode: "normal",
    firstD20: "1",
    dc: "30",
    incomingDamage: "17",
    consequenceProfile: "save-half",
  });
  assert.equal(recorded.status, "applied");
  assert.equal(recorded.record.evasionEligible, true);
  assert.equal(recorded.record.dcResult, false);
  const resolved = resolveCharacterRollConsequence(recorded.record.id, "apply-to-character");
  assert.equal(resolved.status, "applied");
  assert.equal(resolved.record.consequence.calculatedDamage, 8);
  const hpAfter = getState().combat.hp.current;
  const tempAfter = getState().combat.hp.temp;
  assert.ok(hpAfter <= hpBefore);
  assert.ok(tempAfter <= tempBefore);
  assert.equal(
    hpBefore + tempBefore - (hpAfter + tempAfter),
    8,
  );
  const corrected = correctCharacterRollOutcome(recorded.record.id, "success");
  assert.equal(corrected.status, "applied");
  assert.equal(corrected.record.dcResult, true);
  assert.equal(corrected.record.consequence.calculatedDamage, 8);
  assert.equal(getState().combat.hp.current, hpAfter);
  assert.equal(getState().combat.hp.temp, tempAfter);
});
