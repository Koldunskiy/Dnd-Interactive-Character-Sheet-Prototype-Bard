import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { character as aurelia } from "../../data/character.js";
import { sara } from "../../data/sara.js";
import { SARA_LORE } from "../../data/sara-lore.js";
import { MONK_TECHNIQUES } from "../../data/monk-techniques.js";
import { MONK_RACIAL_SPELLS } from "../../data/monk-support-spells.js";
import { CHARACTER_DESCRIPTORS } from "../../scripts/characters.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  loadCharacterState,
  saveCharacterState
} from "../../scripts/storage.js";
import {
  createTechniqueDraft,
  validateTechniqueDraft,
  applyTechniqueDraft
} from "../../scripts/technique-editor.js";
import { getTechniqueCollections } from "../../scripts/selectors/techniques.js";
import {
  applyMonkTechnique,
  castSaraRacialSpell,
  completeAwakenThirdEyeMeditation,
  continueDeflectMissile,
  endAwakenThirdEye,
  executeMonkTechnique
} from "../../scripts/actions/monk.js";
import { createActionHandlers } from "../../scripts/actions.js";

const persisted = new Map();
let confirmAnswers = [];
globalThis.window = {
  localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
    removeItem: (key) => persisted.delete(key)
  },
  confirm: () => confirmAnswers.shift() ?? false
};

const stateModule = await import("../../scripts/state.js");
const {
  openCharacterSession,
  getState,
  getSessionContext,
  updateSessionState,
  readAppPreferences,
  saveAppPreferences
} = stateModule;
const cloneSara = () => structuredClone(sara);

test("registry and Sara defaults use separate identities, ruleset, and resource state", () => {
  assert.deepEqual(CHARACTER_DESCRIPTORS.aurelia.tabs, [
    "profile", "melee", "spells", "inventory", "lore", "spell-library"
  ]);
  assert.deepEqual(CHARACTER_DESCRIPTORS["sara-velaris"].tabs, [
    "profile", "melee", "techniques", "inventory", "lore"
  ]);
  assert.equal(CHARACTER_DESCRIPTORS.aurelia.storageKey, "aurelia-character-sheet:v2");
  assert.equal(CHARACTER_DESCRIPTORS["sara-velaris"].storageKey, "character-sheet:sara-velaris:v1");
  assert.equal(sara.profile.id, "sara-velaris");
  assert.equal(sara.profile.rulesetId, "laserllama-alternate-monk-open-hand-snapshot-2026-10-29");
  assert.deepEqual(sara.abilities, {
    strength: 8, dexterity: 20, constitution: 14,
    intelligence: 8, wisdom: 18, charisma: 12
  });
  assert.equal(sara.combat.hp.current, 124);
  assert.equal(sara.combat.ki.current, 16);
  assert.equal(sara.combat.practiced.current, 4);
  assert.equal(sara.inventory.items.length, 2);
  assert.equal(sara.inventory.items[0].id, "amulet-of-health");
  assert.equal(sara.inventory.items[0].attuned, true);
  assert.equal(sara.inventory.items[1].id, "insignia-of-claws");
  assert.equal(sara.ui.abilitiesEditable, true);
});

test("Alternate Monk derived values respect the amulet and do not inherit Bard rules", () => {
  const derived = getDerivedStats(sara);
  assert.equal(derived.proficiencyBonus, 4);
  assert.equal(derived.monk.martialDie, "d10");
  assert.equal(derived.maxHitPoints, 124);
  assert.equal(derived.armorClass, 19);
  assert.equal(derived.monk.kiMaximum, 16);
  assert.equal(derived.monk.practicedMaximum, 4);
  assert.equal(derived.monk.techniqueSaveDc, 16);
  assert.equal(derived.unarmedAttackBonus, 10);
  assert.equal(derived.unarmedDamage, "1d10 +6 дробящего");
  assert.equal(derived.passivePerception, 14);
  assert.equal(derived.passiveInsight, 18);
  assert.equal(derived.passiveInvestigation, 9);
  assert.equal(derived.hasJackOfAllTrades, false);
  assert.equal(derived.bardicInspiration, null);

  const withoutAmulet = cloneSara();
  withoutAmulet.inventory.items[0].attuned = false;
  assert.equal(getDerivedStats(withoutAmulet).maxHitPoints, 100);

  const withShield = cloneSara();
  withShield.combat.shieldBonus = 2;
  assert.equal(getDerivedStats(withShield).armorClass, 17);
  assert.equal(getDerivedStats(withShield).martialArtsAvailable, false);

  const adept = cloneSara();
  adept.monk.ordinaryTechniqueIds.push("ll-monk:warrior-adept");
  adept.monk.techniqueChoices["ll-monk:warrior-adept"] = {
    styleId: "ll-style:featherweight-fighting"
  };
  const adeptDerived = getDerivedStats(adept);
  assert.equal(adeptDerived.unarmoredMovementBonus, 30);
  assert.equal(adeptDerived.unarmedDamage, "1d10 +7 дробящего");

  const highLevel = cloneSara();
  highLevel.profile.level = 13;
  highLevel.abilities.constitution = 14;
  highLevel.inventory.items[0].attuned = false;
  assert.equal(getDerivedStats(highLevel).savingThrows.constitution, 7);
});

test("technique catalog is complete, unique, and preserves Sara's agreed selections", () => {
  assert.equal(MONK_TECHNIQUES.length, 45);
  assert.equal(new Set(MONK_TECHNIQUES.map((entry) => entry.id)).size, 45);
  assert.equal(MONK_TECHNIQUES.filter((entry) => entry.sourceId === "laserllama-core").length, 26);
  assert.equal(MONK_TECHNIQUES.filter((entry) => entry.sourceId === "laserllama-expanded").length, 19);
  assert.equal(sara.monk.ordinaryTechniqueIds.length, 7);
  assert.deepEqual(sara.monk.signatureTechniqueSlots, {
    "open-hand:3": "ll-monk:empowered-strike",
    "open-hand:5": "ll-monk:stunning-strike",
    "open-hand:9": "ll-monk:indomitable-spirit"
  });
  for (const excluded of [
    "ll-monk:aura-sight", "ll-monk:heavenly-step", "ll-monk:patient-defense",
    "ll-monk:slow-fall", "ll-monk:gentling-touch"
  ]) {
    assert.equal(
      [...sara.monk.ordinaryTechniqueIds, ...Object.values(sara.monk.signatureTechniqueSlots)].includes(excluded),
      false
    );
  }
  assert.equal(getTechniqueCollections(sara, { filter: "all" }).length, 45);
  assert.equal(MONK_RACIAL_SPELLS.length, 3);
  assert.equal(MONK_RACIAL_SPELLS.find((spell) => spell.id === "suggestion-2014").concentration, true);
});

test("Sara lore includes the full master biography, open questions, hooks, and character summary", () => {
  assert.equal(SARA_LORE.sections.length, 17);
  assert.deepEqual(SARA_LORE.sections.map(({ title }) => title), [
    "1. Основные сведения", "2. Дом Веларис", "3. Работа на дом",
    "4. Люди, которым она доверяла", "5. Дело об исчезнувших людях",
    "6. Подстава и осуждение", "7. Эдрен Вааль", "8. Обучение",
    "9. Видения", "10. Брешь в Сером Затворе", "11. Побег", "12. Сигил",
    "13. Новые союзники и дальнейшая жизнь", "14. Сара сейчас",
    "15. Открытые вопросы для мастера", "16. Возможные зацепки личного квеста",
    "17. Кратко для листа персонажа"
  ]);
  assert.match(SARA_LORE.sections[4].text, /Связь этих сделок с культом Векны/);
  assert.match(SARA_LORE.sections[8].text, /не установленный для игрока факт/);
  assert.match(SARA_LORE.sections[9].text, /не обладала собственной способностью создавать межпланарные проходы/);
  assert.match(SARA_LORE.sections[14].text, /Следующее намеренно не является известной Саре истиной/);
  assert.match(SARA_LORE.sections[15].text, /не обязательная цепочка/);
  assert.match(SARA_LORE.sections[16].text, /не зная, была ли помощь в побеге подарком/);
});

test("typed storage isolates keys and rejects malformed, mismatched, and future Sara records", () => {
  const saraDescriptor = CHARACTER_DESCRIPTORS["sara-velaris"];
  const aureliaDescriptor = CHARACTER_DESCRIPTORS.aurelia;
  assert.equal(loadCharacterState(saraDescriptor).status, "missing");

  persisted.set(saraDescriptor.storageKey, "{");
  assert.equal(loadCharacterState(saraDescriptor).status, "invalid");
  persisted.set(saraDescriptor.storageKey, JSON.stringify(aurelia));
  assert.match(loadCharacterState(saraDescriptor).reason, /ID does not match/);

  const future = cloneSara();
  future.schemaVersion = 2;
  persisted.set(saraDescriptor.storageKey, JSON.stringify(future));
  assert.match(loadCharacterState(saraDescriptor).reason, /Unsupported character schema/);

  const unknownRules = cloneSara();
  unknownRules.profile.rulesetId = "future-ruleset";
  persisted.set(saraDescriptor.storageKey, JSON.stringify(unknownRules));
  assert.match(loadCharacterState(saraDescriptor).reason, /Unsupported character ruleset/);

  persisted.delete(saraDescriptor.storageKey);
  const oldAurelia = structuredClone(aurelia);
  delete oldAurelia.schemaVersion;
  persisted.set(aureliaDescriptor.storageKey, JSON.stringify(oldAurelia));
  assert.deepEqual(loadCharacterState(aureliaDescriptor).migrations, [
    "legacy-aurelia-schema", "lore-notes"
  ]);
  assert.equal(loadCharacterState(saraDescriptor).status, "missing");

  const blockedStorage = { getItem() { throw new Error("storage blocked"); } };
  assert.equal(loadCharacterState(saraDescriptor, { storage: blockedStorage }).status, "unavailable");
  assert.equal(saveCharacterState(aurelia, saraDescriptor).ok, false);
});

test("app preferences have a separate validated store and report unavailable storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  assert.equal(readAppPreferences(storage).status, "missing");
  assert.equal(saveAppPreferences({
    lastCharacterId: "sara-velaris",
    lastTab: { "sara-velaris": "techniques" }
  }, storage).ok, true);
  assert.equal(readAppPreferences(storage).preferences.lastCharacterId, "sara-velaris");
  values.set("character-sheet:app:v1", "{");
  assert.equal(readAppPreferences(storage).status, "invalid");

  const blockedStorage = { getItem() { throw new Error("storage blocked"); } };
  assert.equal(readAppPreferences(blockedStorage).status, "unavailable");

  const currentStorage = globalThis.window.localStorage;
  Object.defineProperty(globalThis.window, "localStorage", {
    configurable: true,
    get() { throw new Error("storage property blocked"); }
  });
  assert.equal(readAppPreferences().status, "unavailable");
  Object.defineProperty(globalThis.window, "localStorage", {
    configurable: true,
    value: currentStorage
  });
});

test("Sara sessions are revision-guarded, generation-bound, and clamp item-driven HP without healing", () => {
  persisted.clear();
  const aureliaRecord = structuredClone(aurelia);
  persisted.set(CHARACTER_DESCRIPTORS.aurelia.storageKey, JSON.stringify(aureliaRecord));
  const opened = openCharacterSession("sara-velaris");
  assert.equal(opened.status, "missing");
  assert.equal(persisted.has(CHARACTER_DESCRIPTORS["sara-velaris"].storageKey), false);
  const originalContext = getSessionContext();
  const changed = updateSessionState(originalContext, (draft) => {
    draft.inventory.items[0].attuned = false;
    return draft;
  });
  assert.equal(changed.status, "applied");
  assert.equal(getState().combat.hp.current, 100);
  assert.equal(persisted.has(CHARACTER_DESCRIPTORS.aurelia.storageKey), true);

  const beforeReattune = getSessionContext();
  updateSessionState(beforeReattune, (draft) => {
    draft.inventory.items[0].attuned = true;
    return draft;
  });
  assert.equal(getState().combat.hp.current, 100);
  assert.equal(getDerivedStats(getState()).maxHitPoints, 124);

  const staleContext = getSessionContext();
  assert.equal(openCharacterSession("sara-velaris").status, "loaded");
  assert.equal(updateSessionState(staleContext, () => { throw new Error("must not run"); }).status, "rejected");
  const currentContext = getSessionContext();
  const unchangedRevision = currentContext.stateRevision;
  assert.equal(updateSessionState(currentContext, () => false).status, "unchanged");
  assert.equal(getSessionContext().stateRevision, unchangedRevision);
  const thrownOperation = updateSessionState(currentContext, () => { throw new Error("invalid action"); });
  assert.equal(thrownOperation.status, "rejected");
  assert.equal(thrownOperation.reason, "invalid action");
});

test("technique draft requires its entitlement, exact replacement, and an unchanged session revision", () => {
  const state = cloneSara();
  const event = {
    id: "rest:event-1", type: "rest", consumed: false, createdAtLevel: 12
  };
  state.monk.replacementEntitlements = [event];
  state.monk.ordinaryReplacementCredit = 1;
  const context = { characterId: "sara-velaris", sessionGeneration: 4, stateRevision: 7 };
  const draft = createTechniqueDraft(state, context, event);
  draft.ordinaryTechniqueIds = draft.ordinaryTechniqueIds
    .filter((id) => id !== "ll-monk:crippling-strike");
  draft.ordinaryTechniqueIds.push("ll-monk:arresting-strike");
  assert.deepEqual(validateTechniqueDraft(state, draft, context), []);
  const applied = applyTechniqueDraft(state, draft, context);
  assert.equal(applied.status, "applied");
  assert.equal(applied.state.monk.replacementEntitlements[0].consumed, true);
  assert.equal(applied.state.monk.ordinaryTechniqueIds.includes("ll-monk:arresting-strike"), true);

  const forgedEvent = structuredClone(draft);
  forgedEvent.entitlementEvent.type = "level-up";
  forgedEvent.entitlementEvent.level = 13;
  assert.match(validateTechniqueDraft(state, forgedEvent, context).join(" "), /Право на замену отсутствует/);

  const stale = { ...context, stateRevision: 8 };
  assert.match(validateTechniqueDraft(state, draft, stale)[0], /Сессия или ревизия изменилась/);
  const illegal = structuredClone(draft);
  illegal.signatureTechniqueSlots["open-hand:3"] = "ll-monk:stunning-strike";
  assert.match(validateTechniqueDraft(state, illegal, context).join(" "), /Отдых разрешает ровно одну обычную замену/);

  const progression = cloneSara();
  progression.profile.level = 13;
  progression.monk.replacementEntitlements = [{
    id: "level:13:event",
    type: "level-up",
    level: 13,
    consumed: false
  }];
  const levelContext = { ...context, stateRevision: 9 };
  const levelDraft = createTechniqueDraft(
    progression, levelContext, progression.monk.replacementEntitlements[0]
  );
  levelDraft.ordinaryTechniqueIds.push("ll-monk:arresting-strike");
  assert.deepEqual(validateTechniqueDraft(progression, levelDraft, levelContext), []);
  const levelApplied = applyTechniqueDraft(progression, levelDraft, levelContext);
  assert.equal(levelApplied.state.monk.processedLevel, 13);
});

test("Mystic Regeneration validates physical die input and atomically spends Ki and action", () => {
  const state = cloneSara();
  state.combat.hp.current = 100;
  const invalid = applyMonkTechnique(state, "ll-monk:mystic-regeneration", {
    confirmed: true, dieResult: 11
  });
  assert.equal(invalid.ok, false);
  assert.equal(state.combat.ki.current, 16);
  assert.equal(state.ui.turn.actionUsed, false);

  const applied = applyMonkTechnique(state, "ll-monk:mystic-regeneration", {
    confirmed: true, dieResult: 10
  });
  assert.equal(applied.ok, true);
  assert.equal(state.combat.hp.current, 114);
  assert.equal(state.combat.ki.current, 14);
  assert.equal(state.ui.turn.actionUsed, true);
});

test("variable-cost techniques validate inputs and spend the exact Ki amount", () => {
  const selected = (id, level = 20) => {
    const state = cloneSara();
    state.profile.level = level;
    state.monk.ordinaryTechniqueIds.push(id);
    return state;
  };

  const gentling = selected("ll-monk:gentling-touch");
  const gentleResult = applyMonkTechnique(gentling, "ll-monk:gentling-touch", {
    confirmed: true, extraKi: 4, targetCurrentHp: 12
  });
  assert.equal(gentleResult.ok, true);
  assert.equal(gentleResult.result.knockoutThreshold, 9);
  assert.equal(gentleResult.result.damageDice, "9d12");
  assert.equal(gentling.combat.ki.current, 11);

  const noKi = selected("ll-monk:gale-rush");
  noKi.combat.ki.current = 0;
  const before = structuredClone(noKi);
  const rejected = applyMonkTechnique(noKi, "ll-monk:gale-rush", {
    confirmed: true, kiCost: 1
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /Недостаточно ци/);
  assert.deepEqual(noKi, before);

  const gale = selected("ll-monk:gale-rush");
  const galeResult = applyMonkTechnique(gale, "ll-monk:gale-rush", {
    confirmed: true, kiCost: 3
  });
  assert.equal(galeResult.result.movementFeet, 30);
  assert.equal(galeResult.result.damageDice, "3d12");
  assert.equal(gale.combat.ki.current, 13);

  const tremor = selected("ll-monk:tremor-strike");
  const tremorResult = applyMonkTechnique(tremor, "ll-monk:tremor-strike", {
    confirmed: true, kiCost: 2
  });
  assert.equal(tremorResult.result.damageDice, "2d12");
  assert.equal(tremor.combat.ki.current, 14);

  const conjure = selected("ll-monk:conjure-previous-life", 13);
  conjure.combat.concentration = "existing-effect";
  const blockedReplacement = applyMonkTechnique(conjure, "ll-monk:conjure-previous-life", {
    confirmed: true, transferredKi: 2
  });
  assert.equal(blockedReplacement.ok, false);
  assert.equal(conjure.combat.ki.current, 16);
  const conjureResult = applyMonkTechnique(conjure, "ll-monk:conjure-previous-life", {
    confirmed: true,
    transferredKi: 2,
    replaceConcentration: true,
    expectedConcentration: "existing-effect"
  });
  assert.equal(conjureResult.ok, true);
  assert.equal(conjureResult.result.kiTransferred, 2);
  assert.equal(conjure.combat.ki.current, 9);
  assert.equal(conjure.combat.concentration, "ll-monk:conjure-previous-life");

  const emptyBody = selected("ll-monk:empty-body", 18);
  const emptyBodyResult = applyMonkTechnique(emptyBody, "ll-monk:empty-body", {
    confirmed: true, mode: "astral-projection"
  });
  assert.equal(emptyBodyResult.ok, true);
  assert.equal(emptyBody.combat.ki.current, 8);
});

test("Awaken the Third Eye charges once, requires manual completion, and clamps Ki maximum", () => {
  persisted.clear();
  assert.equal(openCharacterSession("sara-velaris").status, "missing");
  updateSessionState(getSessionContext(), (draft) => {
    draft.profile.level = 18;
    draft.monk.ordinaryTechniqueIds.push("ll-monk:awaken-the-third-eye");
    return draft;
  });
  let context = getSessionContext();
  const started = executeMonkTechnique(context, "ll-monk:awaken-the-third-eye", {
    confirmed: true,
    operationId: "third-eye-start"
  });
  assert.equal(started.status, "applied");
  assert.equal(getState().combat.ki.current, 8);
  assert.equal(getState().monk.techniqueRuntime["ll-monk:awaken-the-third-eye"].awakenThirdEyePending, true);

  context = getSessionContext();
  const completed = completeAwakenThirdEyeMeditation(context, "third-eye-complete");
  assert.equal(completed.status, "applied");
  assert.equal(getDerivedStats(getState()).monk.kiMaximum, 14);
  assert.equal(getState().combat.ki.current, 8);

  context = getSessionContext();
  const ended = endAwakenThirdEye(context, "third-eye-end");
  assert.equal(ended.status, "applied");
  assert.equal(getDerivedStats(getState()).monk.kiMaximum, 22);
  assert.equal(getState().combat.ki.current, 8);
});

test("Practiced replaces one Strike cost once per marked turn and never applies to Indomitable Spirit", () => {
  const state = cloneSara();
  const first = applyMonkTechnique(state, "ll-monk:crippling-strike", {
    confirmed: true,
    paymentMode: "practiced",
    ownTurnConfirmed: true,
    unarmedHitConfirmed: true
  });
  assert.equal(first.ok, true);
  assert.equal(state.combat.ki.current, 16);
  assert.equal(state.combat.practiced.current, 3);
  assert.equal(state.monk.techniqueRuntime.practicedUsedThisTurn, true);
  const second = applyMonkTechnique(state, "ll-monk:empowered-strike", {
    confirmed: true,
    paymentMode: "practiced",
    ownTurnConfirmed: true,
    unarmedHitConfirmed: true
  });
  assert.equal(second.ok, false);
  assert.match(second.reason, /Practiced уже использован/);
  const nonStrike = applyMonkTechnique(state, "ll-monk:indomitable-spirit", {
    confirmed: true,
    paymentMode: "practiced",
    ownTurnConfirmed: true,
    unarmedHitConfirmed: true
  });
  assert.equal(nonStrike.ok, false);
  assert.match(nonStrike.reason, /eligible Strike/);
});

test("Deflect Missile creates a same-reaction continuation and charges return Ki once", () => {
  persisted.clear();
  assert.equal(openCharacterSession("sara-velaris").status, "missing");
  const context = getSessionContext();
  const deflected = executeMonkTechnique(context, "ll-monk:deflect-missile", {
    confirmed: true,
    mode: "weapon",
    incomingDamage: 12,
    deflectRoll: 10,
    caught: true,
    freeHand: true,
    physicalProjectile: true,
    operationId: "missile-deflect-event"
  });
  assert.equal(deflected.status, "applied");
  assert.equal(deflected.outcome.result.reducedDamage, 0);
  assert.equal(getState().ui.turn.reactionUsed, true);
  const continuationId = getState().monk.techniqueRuntime.deflectContinuation.id;
  const returned = continueDeflectMissile(
    getSessionContext(), continuationId, 15, 20, {
      proficiencyConfirmed: true,
      damageRolls: [4]
    }
  );
  assert.equal(returned.status, "applied");
  assert.equal(returned.outcome.sameReaction, true);
  assert.equal(returned.outcome.damageTotalBeforeTargetModifiers, 9);
  assert.equal(getState().combat.ki.current, 15);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation, undefined);
  assert.equal(continueDeflectMissile(
    getSessionContext(), continuationId, 15, 20, {
      proficiencyConfirmed: true,
      damageRolls: [4]
    }
  ).status, "rejected");
});

test("racial Suggestion spends its own use, asks for concentration replacement, and never spends Ki", () => {
  persisted.clear();
  const opened = openCharacterSession("sara-velaris");
  assert.equal(opened.status, "missing");
  updateSessionState(getSessionContext(), (draft) => {
    draft.combat.concentration = "existing-effect";
    return draft;
  });
  const beforeContext = getSessionContext();
  const beforeKi = getState().combat.ki.current;
  const rejected = castSaraRacialSpell(beforeContext, "suggestion-2014", { confirmed: true });
  assert.equal(rejected.status, "rejected");
  assert.equal(getState().spellcasting.racialSpells.find((spell) => spell.id === "suggestion-2014").uses.current, 1);

  const context = getSessionContext();
  const applied = castSaraRacialSpell(context, "suggestion-2014", {
    confirmed: true,
    replaceConcentration: true,
    expectedConcentration: "existing-effect",
    operationId: "racial-suggestion-operation"
  });
  assert.equal(applied.status, "applied");
  assert.equal(getState().combat.concentration, "suggestion-2014");
  assert.equal(getState().combat.ki.current, beforeKi);
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getState().spellcasting.racialSpells.find((spell) => spell.id === "suggestion-2014").uses.current, 0);
  assert.equal(castSaraRacialSpell(getSessionContext(), "suggestion-2014", {
    confirmed: true, operationId: "racial-suggestion-operation"
  }).reason, "duplicate-operation");

  const afterContext = getSessionContext();
  const atWill = castSaraRacialSpell(afterContext, "animal-friendship-2014", { confirmed: true });
  assert.equal(atWill.status, "applied");
  assert.equal(getState().combat.ki.current, beforeKi);
});

test("Sara rest consequences require explicit meditation and preserve non-rest state", () => {
  const handlers = createActionHandlers({ resetState: () => {} });
  const short = cloneSara();
  short.combat.hp.current = 40;
  short.combat.hp.temp = 7;
  short.combat.ki.current = 2;
  short.combat.practiced.current = 1;
  short.combat.hitDice.remaining = 5;
  short.combat.concentration = "suggestion-2014";
  short.spellcasting.racialSpells.find((spell) => spell.id === "suggestion-2014").uses.current = 0;
  short.ui.activeEffects = [
    { id: "short", durationType: "until-short-rest" },
    { id: "custom", durationType: "custom" }
  ];
  confirmAnswers = [true, false];
  handlers["short-rest"](short);
  assert.equal(short.combat.ki.current, 2);
  assert.equal(short.combat.hp.current, 40);
  assert.equal(short.combat.hp.temp, 7);
  assert.equal(short.combat.practiced.current, 1);
  assert.equal(short.combat.hitDice.remaining, 5);
  assert.equal(short.combat.concentration, "suggestion-2014");
  assert.equal(
    short.spellcasting.racialSpells.find((spell) => spell.id === "suggestion-2014").uses.current,
    0
  );
  assert.deepEqual(short.ui.activeEffects.map((effect) => effect.id), ["custom"]);

  const long = cloneSara();
  long.combat.hp.current = 40;
  long.combat.hp.temp = 9;
  long.combat.ki.current = 2;
  long.combat.practiced.current = 1;
  long.combat.hitDice.remaining = 4;
  long.ui.turn.turnNumber = 5;
  long.combat.concentration = "suggestion-2014";
  long.monk.techniqueRuntime["ll-monk:awaken-the-third-eye"] = {
    awakenThirdEyeActive: true,
    awakenThirdEyePending: true
  };
  long.ui.activeEffects = [
    { id: "short", durationType: "until-short-rest" },
    { id: "long", durationType: "until-long-rest" },
    { id: "custom", durationType: "custom" }
  ];
  confirmAnswers = [true, true, true];
  handlers["long-rest"](long);
  assert.equal(long.combat.hp.current, 124);
  assert.equal(long.combat.hp.temp, 0);
  assert.equal(long.combat.ki.current, 16);
  assert.equal(long.combat.practiced.current, 4);
  assert.equal(long.combat.hitDice.remaining, 10);
  assert.equal(
    long.spellcasting.racialSpells.find((spell) => spell.id === "suggestion-2014").uses.current,
    1
  );
  assert.equal(long.combat.concentration, "");
  assert.equal(long.ui.turn.turnNumber, 5);
  assert.deepEqual(long.ui.activeEffects.map((effect) => effect.id), ["custom"]);
  assert.equal(long.monk.ordinaryReplacementCredit, 1);
  assert.equal(long.monk.replacementEntitlements.length, 1);
  assert.equal(long.monk.techniqueRuntime["ll-monk:awaken-the-third-eye"].awakenThirdEyeActive, false);
  assert.equal(long.monk.techniqueRuntime["ll-monk:awaken-the-third-eye"].awakenThirdEyePending, false);

  const overwritten = structuredClone(long);
  confirmAnswers = [true, false, false];
  handlers["long-rest"](overwritten);
  assert.equal(overwritten.monk.ordinaryReplacementCredit, 0);
  assert.equal(overwritten.monk.replacementEntitlements.length, 0);

  const levelTwenty = cloneSara();
  levelTwenty.profile.level = 20;
  levelTwenty.combat.ki.current = 0;
  confirmAnswers = [true, true];
  handlers["short-rest"](levelTwenty);
  assert.equal(levelTwenty.combat.ki.current, getDerivedStats(levelTwenty).monk.kiMaximum);

  const cancelled = cloneSara();
  const cancelledBefore = structuredClone(cancelled);
  confirmAnswers = [false];
  handlers["short-rest"](cancelled);
  assert.deepEqual(cancelled, cancelledBefore);
});

test("runtime manifest includes each Sara data module without running packaging", async () => {
  const manifest = await readFile(new URL("../../tools/prepare-web.mjs", import.meta.url), "utf8");
  for (const path of [
    "data/sara.js", "data/sara-lore.js",
    "data/monk-techniques.js", "data/monk-support-spells.js"
  ]) {
    assert.match(manifest, new RegExp(`"${path.replaceAll(".", "\\.")}"`));
  }
});
