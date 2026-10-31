import { MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import { getDerivedStats } from "../calculations.js";
import {
  getTechniqueAvailability,
  isTechniqueEffectivelySelected
} from "../selectors/techniques.js";
import { getSessionContext, getState, updateSessionState } from "../state.js";
import { ALTERNATE_MONK_RULESET_ID } from "../rules/alternate-monk.js";
import { MONK_RACIAL_SPELLS } from "../../data/monk-support-spells.js";
import { applyDamagePools } from "../combat/damage-pools.js";
import {
  calculateAttackDamage,
  parsePhysicalInteger
} from "../combat/sara-combat.js";

function isSara(character) {
  return character.profile?.id === "sara-velaris" &&
    character.profile?.rulesetId === ALTERNATE_MONK_RULESET_ID;
}

function getBattlePhaseReason(character, activation) {
  const phase = character.battleConsole?.current?.phase;
  if (!phase) return null;
  if (["action", "bonus-action", "replace-attack", "hit", "after-roll", "start-of-turn"]
    .includes(activation)) {
    return phase === "own-turn" ? null : "Эту способность можно применить только в свой ход.";
  }
  if (activation === "reaction") {
    return ["waiting", "own-turn"].includes(phase)
      ? null
      : "Реакцию нельзя применить в приостановленной сцене.";
  }
  return null;
}

function getSelectedIds(character) {
  return [
    ...(character.monk?.ordinaryTechniqueIds ?? []),
    ...Object.values(character.monk?.signatureTechniqueSlots ?? {})
  ];
}

function parseKiCost(technique, input) {
  if (technique.id === "ll-monk:empty-body") {
    if (input.mode === "invisibility") return 4;
    if (input.mode === "astral-projection") return 8;
    return { reason: "Выберите режим Empty Body: invisibility или astral-projection." };
  }
  if (technique.id === "ll-monk:gentling-touch") {
    const extraKi = Number(input.extraKi);
    const maximum = getDerivedStats(input.character).abilityModifiers.wisdom;
    if (!Number.isInteger(extraKi) || extraKi < 0 || extraKi > maximum) {
      return { reason: `Введите целое число дополнительных Ki от 0 до ${maximum}.` };
    }
    return 1 + extraKi;
  }
  if (["ll-monk:gale-rush", "ll-monk:tremor-strike"].includes(technique.id)) {
    const cost = Number(input.kiCost);
    const maximum = getDerivedStats(input.character).abilityModifiers.wisdom;
    if (!Number.isInteger(cost) || cost < 1 || cost > maximum) {
      return { reason: `Введите целое число Ki от 1 до ${maximum}.` };
    }
    return cost;
  }
  if (technique.id === "ll-monk:conjure-previous-life") {
    const transferredKi = Number(input.transferredKi ?? 0);
    const currentKi = Number(input.character.combat?.ki?.current);
    if (!Number.isInteger(transferredKi) || transferredKi < 0 ||
        transferredKi > currentKi - 5) {
      return { reason: `Передаваемая ци должна быть целым числом от 0 до ${Math.max(0, currentKi - 5)}.` };
    }
    return 5 + transferredKi;
  }
  if (technique.id === "ll-monk:deflect-missile") {
    if (input.mode === "weapon") return 0;
    if (["other-ranged", "spell"].includes(input.mode) &&
        Number(input.level ?? input.character?.profile?.level) >= 11) return 1;
    return { reason: "Выберите допустимый режим отражения снаряда." };
  }
  if (technique.id === "ll-monk:heavenly-step") {
    return input.stopOnSurface === true ? 1 : { reason: "Подтвердите остановку на стене, жидкости или потолке." };
  }
  if (technique.id === "ll-monk:crushing-strike") {
    const cost = Number(input.kiCost);
    if (!Number.isInteger(cost) || cost < 1 || cost > getDerivedStats(input.character).abilityModifiers.wisdom) {
      return { reason: "Оплачиваемый режим Crushing Strike требует целое число Ki от 1 до модификатора Мудрости." };
    }
    return cost;
  }
  const fixed = technique.payment.match(/(?:^|[ +/])(\d+)\s*Ki\b/);
  if (!fixed) return technique.payment.includes("0 Ki") ? 0 : { reason: "Этот режим стоимости не поддерживается приложением." };
  return Number(fixed[1]);
}

function markActivation(character, technique) {
  const turn = character.ui.turn;
  if (technique.activation === "action") turn.actionUsed = true;
  if (technique.activation === "bonus-action") turn.bonusActionUsed = true;
  if (technique.activation === "reaction") turn.reactionUsed = true;
  if (technique.activation === "replace-attack") turn.actionUsed = true;
}

function applySaraDamage(character, damage) {
  const hp = character.combat?.hp;
  const result = applyDamagePools(
    Number(hp?.current),
    Number(hp?.temp ?? 0),
    damage
  );
  if (!result.ok) return result;
  hp.current = result.hpAfter;
  hp.temp = result.tempHpAfter;
  return result;
}

function applyToCharacter(character, techniqueId, input) {
  if (!isSara(character)) return { ok: false, reason: "Эта операция доступна только в листе Сары." };
  const technique = MONK_TECHNIQUE_BY_ID.get(techniqueId);
  if (!technique) return { ok: false, reason: "Неизвестный ID техники." };
  if (!getSelectedIds(character).includes(techniqueId)) return { ok: false, reason: "Техника не выбрана." };
  const availability = getTechniqueAvailability(character, technique);
  if (!availability.available) return { ok: false, reason: availability.reason };
  if (!isTechniqueEffectivelySelected(character, techniqueId)) {
    return { ok: false, reason: "Техника сохранена в выборе, но сейчас недоступна по уровню, предварительным требованиям или выбору стиля." };
  }
  if (input.confirmed !== true) return { ok: false, reason: "Применение не подтверждено." };
  const phaseReason = getBattlePhaseReason(character, technique.activation);
  if (phaseReason) return { ok: false, reason: phaseReason };

  character.monk.techniqueRuntime ??= {};
  const runtime = character.monk.techniqueRuntime[techniqueId] ?? {};
  if (technique.id === "ll-monk:awaken-the-third-eye" &&
      (runtime.awakenThirdEyeActive || runtime.awakenThirdEyePending)) {
    return { ok: false, reason: "Пробуждение третьего глаза уже активно или ожидает завершения медитации." };
  }
  if (technique.limit === "once-per-turn" && runtime.usedThisTurn) {
    return { ok: false, reason: "Эта техника уже применена в отмеченном текущем ходу." };
  }
  if (technique.limit === "once-per-short-or-long-rest" && runtime.usedUntilRest) {
    return { ok: false, reason: "Эта техника уже применена после последнего отдыха." };
  }
  const currentKi = Number(character.combat.ki.current);
  const usingPracticed = input.paymentMode === "practiced";
  if (input.paymentMode != null && !["ki", "practiced"].includes(input.paymentMode)) {
    return { ok: false, reason: "Неизвестный способ оплаты техники." };
  }
  if (usingPracticed) {
    if (!technique.eligibleStrike) {
      return { ok: false, reason: "Practiced можно применить только к явно отмеченной eligible Strike." };
    }
    if (technique.id === "ll-monk:crushing-strike") {
      return { ok: false, reason: "Бесплатный variable-cost режим Crushing Strike не поддерживается; выберите оплачиваемый режим ци." };
    }
    if (input.ownTurnConfirmed !== true || input.unarmedHitConfirmed !== true) {
      return { ok: false, reason: "Подтвердите свой ход и безоружное попадание для Practiced." };
    }
    if (character.monk.techniqueRuntime.practicedUsedThisTurn) {
      return { ok: false, reason: "Practiced уже использован в отмеченном текущем ходу." };
    }
    if (!Number.isInteger(Number(character.combat.practiced?.current)) ||
        Number(character.combat.practiced.current) < 1) {
      return { ok: false, reason: "Недостаточно применений Practiced." };
    }
  }
  const costResult = usingPracticed ? 0 : parseKiCost(technique, { ...input, character });
  if (typeof costResult === "object") return { ok: false, reason: costResult.reason };
  if (!Number.isInteger(currentKi) || currentKi < costResult) return { ok: false, reason: "Недостаточно ци." };

  const derived = getDerivedStats(character);
  if (technique.id === "ll-monk:gentling-touch" &&
      (!Number.isInteger(Number(input.targetCurrentHp)) || Number(input.targetCurrentHp) < 0)) {
    return { ok: false, reason: "Введите текущие HP цели целым неотрицательным числом." };
  }
  if (technique.id === "ll-monk:conjure-previous-life") {
    const concentration = String(character.combat?.concentration ?? "");
    if (concentration && (input.replaceConcentration !== true ||
        input.expectedConcentration !== concentration)) {
      return { ok: false, reason: "Подтвердите замену текущей концентрации перед призывом." };
    }
  }
  if (technique.id === "ll-monk:deflect-strike" &&
      !(input.mode === "weapon-melee" ||
        (input.mode === "other-melee" && derived.level >= 11))) {
    return { ok: false, reason: "До 11 уровня Deflect Strike требует попадание melee-оружием; с 11 уровня допустима иная melee-атака." };
  }
  if (technique.id === "ll-monk:step-of-the-wind" &&
      !["dash", "disengage"].includes(input.mode)) {
    return { ok: false, reason: "Выберите Рывок или Отход для Step of the Wind." };
  }
  if (technique.id === "ll-monk:mantle-of-courtesy" &&
      (!Number.isInteger(Number(input.otherModifiers ?? 0)))) {
    return { ok: false, reason: "Дополнительные модификаторы Mantle должны быть целым числом." };
  }
  if (technique.id === "ll-monk:deflect-strike" || technique.id === "ll-monk:deflect-missile") {
    const incoming = parsePhysicalInteger(input.incomingDamage, 0, Number.MAX_SAFE_INTEGER, "Входящий урон");
    const die = parsePhysicalInteger(input.deflectRoll, 1, derived.monk.martialDieSides, "Результат кости");
    if (!incoming.ok) return incoming;
    if (!die.ok) return die;
    if (technique.id === "ll-monk:deflect-missile" &&
        input.mode !== "weapon" && input.returnProjectile === true) {
      return { ok: false, reason: "Комбинация spell-deflect и возврата снаряда не поддерживается." };
    }
  }
  if (technique.id === "ll-monk:mystic-regeneration") {
    const die = parsePhysicalInteger(input.dieResult, 1, derived.monk.martialDieSides, "Результат кости");
    if (!die.ok) return die;
    if (derived.currentHitPoints >= derived.maxHitPoints && input.confirmNoHealing !== true) {
      return { ok: false, reason: "Хиты уже полные; подтвердите применение без полезного лечения или отмените." };
    }
    const heal = Math.max(0, die.value + derived.abilityModifiers.wisdom);
    character.combat.hp.current = Math.min(derived.maxHitPoints, derived.currentHitPoints + heal);
  }

  if (technique.id === "ll-monk:conjure-previous-life") {
    character.combat.concentration = technique.id;
  }
  if (technique.id === "ll-monk:awaken-the-third-eye") {
    character.monk.techniqueRuntime[techniqueId] = {
      ...runtime,
      awakenThirdEyePending: true
    };
  }
  character.combat.ki.current = currentKi - costResult;
  if (usingPracticed) {
    character.combat.practiced.current -= 1;
    character.monk.techniqueRuntime.practicedUsedThisTurn = true;
  }
  markActivation(character, technique);
  if (technique.limit === "once-per-turn") {
    character.monk.techniqueRuntime[techniqueId] = { ...runtime, usedThisTurn: true };
  }
  if (technique.limit === "once-per-short-or-long-rest") {
    character.monk.techniqueRuntime[techniqueId] = { ...runtime, usedUntilRest: true };
  }
  if (technique.id === "ll-monk:deflect-missile") {
    const rawRemainder = Math.max(0, Number(input.incomingDamage) - (
      derived.level + Number(input.deflectRoll) + derived.abilityModifiers.dexterity
    ));
    const adjustedRemainder = input.finalAdjustedDamage == null ||
      String(input.finalAdjustedDamage).trim() === ""
      ? { ok: true, value: rawRemainder }
      : parsePhysicalInteger(input.finalAdjustedDamage, 0, rawRemainder, "Итоговый скорректированный остаток");
    if (!adjustedRemainder.ok) return adjustedRemainder;
    const reduced = adjustedRemainder.value;
    const canCatch = reduced === 0 && input.freeHand === true && input.physicalProjectile === true;
    const hpResult = input.applyDamageToSara === true
      ? applySaraDamage(character, reduced)
      : null;
    if (hpResult && !hpResult.ok) return hpResult;
    if (input.caught === true && canCatch && input.mode === "weapon") {
      const battle = character.battleConsole?.current;
      character.monk.techniqueRuntime.deflectContinuation = {
        id: input.continuationId ?? input.operationId ??
          globalThis.crypto?.randomUUID?.() ?? `missile-${Date.now()}`,
        sourceSessionGeneration: input.sessionGeneration,
        kind: "missile-return",
        reactionAlreadyUsed: true,
        ...(battle ? { battleId: battle.id } : {}),
        ...(battle?.phase === "own-turn" ? { ownTurnId: battle.ownTurnId } : {})
      };
    }
    return {
      ok: true,
      result: {
        reducedDamage: reduced,
        remainingDamage: reduced,
        damagePools: hpResult,
        canCatch: input.caught === true && canCatch,
        returnUnsupported: input.caught === true && canCatch && input.mode !== "weapon"
      }
    };
  }
  if (technique.id === "ll-monk:deflect-strike") {
    const reduction = derived.level + Number(input.deflectRoll) + derived.abilityModifiers.dexterity;
    const rawRemainder = Math.max(0, Number(input.incomingDamage) - reduction);
    const adjustedRemainder = input.finalAdjustedDamage == null ||
      String(input.finalAdjustedDamage).trim() === ""
      ? { ok: true, value: rawRemainder }
      : parsePhysicalInteger(input.finalAdjustedDamage, 0, rawRemainder, "Итоговый скорректированный остаток");
    if (!adjustedRemainder.ok) return adjustedRemainder;
    const remaining = adjustedRemainder.value;
    const hpResult = input.applyDamageToSara === true
      ? applySaraDamage(character, remaining)
      : null;
    if (hpResult && !hpResult.ok) return hpResult;
    return { ok: true, result: { reduction, remainingDamage: remaining, damagePools: hpResult, canCounterattack: remaining === 0 } };
  }
  return {
    ok: true,
    result: technique.id === "ll-monk:mystic-regeneration"
      ? { hp: character.combat.hp.current, maximum: derived.maxHitPoints }
      : technique.id === "ll-monk:step-of-the-wind"
        ? { mode: input.mode, jumpMultiplier: 2, until: "end-of-current-turn" }
        : technique.id === "ll-monk:spirit-of-tranquility"
          ? { saveBonus: Math.max(1, derived.abilityModifiers.wisdom), reactionUsed: false }
          : technique.id === "ll-monk:mantle-of-courtesy"
            ? {
                total: derived.level + derived.skills.persuasion + Number(input.otherModifiers ?? 0),
                replacedD20WithLevel: derived.level
              }
            : technique.id === "ll-monk:indomitable-spirit"
              ? { athleticsBonus: derived.abilityModifiers.wisdom, postRoll: true }
              : technique.id === "ll-monk:crushing-strike"
              ? { addedDamage: `${costResult}d${derived.monk.martialDieSides}`, requiresManualDamageRoll: true }
                    : technique.id === "ll-monk:gentling-touch"
              ? {
                  targetCurrentHp: Number(input.targetCurrentHp),
                  knockoutThreshold: 5 + Number(input.extraKi ?? 0),
                  damageDice: `${5 + Number(input.extraKi ?? 0)}d${derived.monk.martialDieSides}`,
                  requiresManualTargetResult: true
                }
              : technique.id === "ll-monk:gale-rush"
                ? { movementFeet: 10 * costResult, damageDice: `${costResult}d${derived.monk.martialDieSides}`, requiresManualSave: true }
                : technique.id === "ll-monk:tremor-strike"
                  ? { damageDice: `${costResult}d${derived.monk.martialDieSides}`, requiresManualSave: true }
                  : technique.id === "ll-monk:conjure-previous-life"
                    ? { kiTransferred: Number(input.transferredKi ?? 0), concentration: technique.id }
                    : technique.id === "ll-monk:empty-body"
                      ? { mode: input.mode, duration: "1 minute or until manually ended" }
                      : technique.id === "ll-monk:awaken-the-third-eye"
                        ? { meditationPending: true, duration: "1 minute; completion is manual" }
            : { ki: character.combat.ki.current }
  };
}

export function applyMonkTechnique(character, techniqueId, input = {}) {
  return applyToCharacter(character, techniqueId, input);
}

export function castSaraRacialSpell(context, spellId, input = {}) {
  const spell = MONK_RACIAL_SPELLS.find((entry) => entry.id === spellId);
  if (!spell || spell.source !== "racial" ||
      !["cantrip", "at-will-racial", "limited-racial"].includes(spell.mode)) {
    return { status: "rejected", reason: "Неизвестный режим расового заклинания." };
  }
  if (input.confirmed !== true) {
    return { status: "rejected", reason: "Применение не подтверждено." };
  }
  const operationId = input.operationId ?? globalThis.crypto?.randomUUID?.() ??
    `racial-spell-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let outcome;
  const result = updateSessionState(context, (draft) => {
    if (!isSara(draft)) throw new Error("Расовая магия доступна только в листе Сары.");
    const phaseReason = getBattlePhaseReason(draft, "action");
    if (phaseReason) throw new Error(phaseReason);
    const record = draft.spellcasting?.racialSpells?.find((entry) =>
      entry.id === spellId && entry.source === "racial" && entry.mode === spell.mode);
    if (!record) throw new Error("Запись расового режима не найдена в активном листе.");
    if (spell.mode === "limited-racial" &&
        (!Number.isInteger(record.uses?.current) || record.uses.current < 1)) {
      throw new Error("Применение этого расового заклинания уже потрачено.");
    }
    const currentConcentration = String(draft.combat?.concentration ?? "");
    if (spell.concentration && currentConcentration &&
        (input.replaceConcentration !== true ||
         input.expectedConcentration !== currentConcentration)) {
      throw new Error("Подтвердите замену текущей концентрации перед применением.");
    }
    draft.ui.turn.actionUsed = true;
    if (spell.mode === "limited-racial") {
      record.uses.current -= 1;
    }
    if (spell.concentration) draft.combat.concentration = spell.id;
    outcome = {
      spellId,
      mode: spell.mode,
      concentration: spell.concentration ? spell.id : currentConcentration,
      resolvedAutomatically: false
    };
    return draft;
  }, {
    operationId,
    metadata: { kind: "sara-racial-spell", spellId },
    validate: (current) => {
      if (!isSara(current)) return "Расовая магия доступна только в листе Сары.";
      const phaseReason = getBattlePhaseReason(current, "action");
      if (phaseReason) return phaseReason;
      const record = current.spellcasting?.racialSpells?.find((entry) =>
        entry.id === spellId && entry.source === "racial" && entry.mode === spell.mode);
      if (!record) return "Запись расового режима не найдена в активном листе.";
      if (spell.mode === "limited-racial" &&
          (!Number.isInteger(record.uses?.current) || record.uses.current < 1)) {
        return "Применение этого расового заклинания уже потрачено.";
      }
      const concentration = String(current.combat?.concentration ?? "");
      if (spell.concentration && concentration &&
          (input.replaceConcentration !== true || input.expectedConcentration !== concentration)) {
        return "Подтвердите замену текущей концентрации перед применением.";
      }
      return null;
    }
  });
  return result.status === "applied" ? { ...result, outcome } : result;
}

export function applySaraCombatAction(context, actionId, input = {}) {
  const allowed = new Set(["bonus-unarmed", "flurry", "ebb-and-flow"]);
  if (!allowed.has(actionId)) return { status: "rejected", reason: "Неизвестное боевое действие Сары." };
  if (input.confirmed !== true) return { status: "rejected", reason: "Применение не подтверждено." };
  const operationId = input.operationId ?? globalThis.crypto?.randomUUID?.() ??
    `sara-combat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let outcome;
  const result = updateSessionState(context, (draft) => {
    if (!isSara(draft)) throw new Error("Это действие доступно только в листе Сары.");
    const phaseReason = getBattlePhaseReason(draft, actionId === "ebb-and-flow" ? "reaction" : "bonus-action");
    if (phaseReason) throw new Error(phaseReason);
    const level = Number(draft.profile.level);
    if (level < 2) throw new Error("Это действие ещё не доступно на текущем уровне.");
    const turn = draft.ui.turn;
    if (actionId === "bonus-unarmed") {
      turn.bonusActionUsed = true;
      outcome = { unarmedAttacks: 1, kiSpent: 0, condition: "подтвердите условие Martial Arts вручную" };
    } else if (actionId === "flurry") {
      if (!Number.isInteger(Number(draft.combat.ki.current)) || Number(draft.combat.ki.current) < 1) {
        throw new Error("Для Flurry of Blows требуется 1 Ki.");
      }
      draft.combat.ki.current -= 1;
      turn.bonusActionUsed = true;
      outcome = { unarmedAttacks: level >= 17 ? 3 : 2, kiSpent: 1, requiresAttackAction: false };
    } else {
      if (level < 6) throw new Error("Ebb & Flow доступна с 6 уровня.");
      if (input.mode !== "unarmed" && input.mode !== "dexterity-save") {
        throw new Error("Выберите безоружный ответ или ручной спасбросок Ловкости цели.");
      }
      turn.reactionUsed = true;
      outcome = input.mode === "unarmed"
        ? { response: "unarmed", kiSpent: 0 }
        : {
            response: "dexterity-save",
            kiSpent: 0,
            onFailedSave: "prone-and-speed-zero-until-end-of-target-turn",
            largerTargetHasAdvantage: true
          };
    }
    return draft;
  }, {
    operationId,
    metadata: { kind: "sara-combat-action", actionId },
    validate: (current) => {
      if (!isSara(current)) return "Это действие доступно только в листе Сары.";
      if (Number(current.profile.level) < 2) return "Это действие ещё не доступно на текущем уровне.";
      if (actionId === "flurry" && Number(current.combat?.ki?.current) < 1) {
        return "Для Flurry of Blows требуется 1 Ki.";
      }
      if (actionId === "ebb-and-flow" && Number(current.profile.level) < 6) {
        return "Ebb & Flow доступна с 6 уровня.";
      }
      if (actionId === "ebb-and-flow" &&
          input.mode !== "unarmed" && input.mode !== "dexterity-save") {
        return "Выберите допустимый ответ Ebb & Flow.";
      }
      return null;
    }
  });
  return result.status === "applied" ? { ...result, outcome } : result;
}

export function completeAwakenThirdEyeMeditation(context, operationId) {
  const result = updateSessionState(context, (draft) => {
    const runtime = draft.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"];
    if (!isSara(draft) || !runtime?.awakenThirdEyePending) {
      throw new Error("Нет ожидающей завершения медитации третьего глаза.");
    }
    runtime.awakenThirdEyePending = false;
    runtime.awakenThirdEyeActive = true;
    return draft;
  }, {
    operationId,
    metadata: { kind: "monk-awaken-third-eye-complete" },
    validate: (current) => current.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"]?.awakenThirdEyePending
      ? null
      : "Нет ожидающей завершения медитации третьего глаза."
  });
  return result;
}

export function endAwakenThirdEye(context, operationId) {
  return updateSessionState(context, (draft) => {
    const runtime = draft.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"];
    if (!isSara(draft) || !runtime?.awakenThirdEyeActive) {
      throw new Error("Третий глаз сейчас не активен.");
    }
    runtime.awakenThirdEyeActive = false;
    return draft;
  }, {
    operationId,
    metadata: { kind: "monk-awaken-third-eye-end" },
    validate: (current) => current.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"]?.awakenThirdEyeActive
      ? null
      : "Третий глаз сейчас не активен."
  });
}

export function executeMonkTechnique(context, techniqueId, input = {}) {
  const operationId = input.operationId ?? globalThis.crypto?.randomUUID?.() ??
    `monk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let outcome = null;
  const result = updateSessionState(context, (draft) => {
    outcome = applyToCharacter(draft, techniqueId, { ...input, operationId, confirmed: true, sessionGeneration: context.sessionGeneration });
    if (!outcome.ok) throw new Error(outcome.reason);
    return draft;
  }, {
    operationId,
    metadata: { kind: "monk-technique", techniqueId },
    validate: (current) => {
      const preview = structuredClone(current);
      const previewResult = applyToCharacter(preview, techniqueId, { ...input, operationId, confirmed: true, sessionGeneration: context.sessionGeneration });
      return previewResult.ok ? null : previewResult.reason;
    }
  });
  return result.status === "applied"
    ? { ...result, outcome }
    : result;
}

export function markSaraAttack(context) {
  return updateSessionState(context, (draft) => {
    if (!isSara(draft)) throw new Error("Эта операция доступна только в листе Сары.");
    draft.ui.turn.actionUsed = true;
    return draft;
  }, { metadata: { kind: "monk-attack" } });
}

export function continueDeflectMissile(
  context,
  continuationId,
  attackRoll,
  targetArmorClass,
  { dmHitResult = null, damageRolls = [], proficiencyConfirmed = false } = {}
) {
  const operationId = `missile-return:${continuationId}`;
  let outcome;
  const result = updateSessionState(context, (draft) => {
    const token = draft.monk?.techniqueRuntime?.deflectContinuation;
    if (!token || token.id !== continuationId || token.kind !== "missile-return" ||
        token.sourceSessionGeneration !== context.sessionGeneration || token.reactionAlreadyUsed !== true) {
      throw new Error("Продолжение отражения снаряда устарело или недействительно.");
    }
    if (token.battleId) {
      const battle = draft.battleConsole?.current;
      if (!battle || battle.id !== token.battleId ||
          !["waiting", "own-turn"].includes(battle.phase) ||
          token.ownTurnId && token.ownTurnId !== battle.ownTurnId) {
        throw new Error("Продолжение отражения снаряда вышло за границы своего боевого контекста.");
      }
    }
    const currentKi = Number(draft.combat?.ki?.current);
    if (!Number.isInteger(currentKi) || currentKi < 1) throw new Error("Для возврата снаряда требуется 1 Ki.");
    if (proficiencyConfirmed !== true) {
      throw new Error("Подтвердите владение простым оружием для возврата.");
    }
    const checkedD20 = parsePhysicalInteger(attackRoll, 1, 20, "Результат к20");
    if (!checkedD20.ok) throw new Error(checkedD20.reason);
    const checkedAc = targetArmorClass == null || String(targetArmorClass).trim() === ""
      ? null
      : parsePhysicalInteger(targetArmorClass, 1, 99, "КД цели");
    if (checkedAc && !checkedAc.ok) throw new Error(checkedAc.reason);
    if (checkedAc == null && !["hit", "miss"].includes(dmHitResult)) {
      throw new Error("Введите результат к20 и укажите КД цели либо подтвердите попадание/промах.");
    }
    const derived = getDerivedStats(draft);
    const profile = derived.saraAttackProfiles.returnedProjectile;
    const total = checkedD20.value + profile.attackBonus;
    const hits = checkedAc == null
      ? dmHitResult === "hit"
      : checkedD20.value === 20 || (checkedD20.value !== 1 && total >= checkedAc.value);
    const damage = hits
      ? calculateAttackDamage(profile, damageRolls, checkedD20.value === 20)
      : null;
    if (damage && !damage.ok) throw new Error(damage.reason);
    draft.combat.ki.current = currentKi - 1;
    delete draft.monk.techniqueRuntime.deflectContinuation;
    outcome = {
      attackBonus: profile.attackBonus,
      damageDice: profile.damageDice,
      damageModifier: profile.damageModifier,
      attackKind: profile.attackKind,
      total,
      hits,
      critical: checkedD20.value === 20,
      damageRolls: damage?.damageRolls ?? null,
      damageTotalBeforeTargetModifiers: damage?.damageTotalBeforeTargetModifiers ?? null,
      range: "20/60",
      sameReaction: true
    };
    return draft;
  }, {
    operationId,
    metadata: { kind: "monk-missile-return" }
  });
  return result.status === "applied" ? { ...result, outcome } : result;
}

export function clearSaraTurnTechniqueMarks(context) {
  return updateSessionState(context, (draft) => {
    if (!isSara(draft)) return draft;
    for (const runtime of Object.values(draft.monk.techniqueRuntime ?? {})) {
      if (runtime && typeof runtime === "object") delete runtime.usedThisTurn;
    }
    if (draft.monk.techniqueRuntime) {
      delete draft.monk.techniqueRuntime.practicedUsedThisTurn;
    }
    return draft;
  }, { metadata: { kind: "monk-turn-marks-clear" } });
}

export function getCurrentMonkContext() {
  return getSessionContext();
}

export function getCurrentMonkState() {
  return getState();
}
