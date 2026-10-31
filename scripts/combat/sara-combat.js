import { getDerivedStats } from "../calculations.js";
import { applyDamagePools, applyHealing } from "./damage-pools.js";

export function parsePhysicalInteger(raw, minimum, maximum, field = "Результат") {
  if ((typeof raw !== "string" && typeof raw !== "number") ||
      (typeof raw === "string" && raw.trim() === "")) {
    return { ok: false, reason: `${field}: введите физический результат.` };
  }
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, reason: `${field}: требуется конечное целое число.` };
  }
  if (value < minimum || value > maximum) {
    return { ok: false, reason: `${field}: допустимый диапазон ${minimum}–${maximum}.` };
  }
  return { ok: true, value };
}

export function getSaraAttackProfiles(character, derived = getDerivedStats(character)) {
  if (character?.profile?.id !== "sara-velaris" || !derived?.saraAttackProfiles) {
    return null;
  }
  return structuredClone(derived.saraAttackProfiles);
}

export function calculateAttackPreview(character, input) {
  const derived = getDerivedStats(character);
  const profiles = getSaraAttackProfiles(character, derived);
  const profile = profiles?.[input.profileId];
  if (!profile) return { ok: false, reason: "Неизвестный профиль атаки Сары." };
  if (!["normal", "advantage", "disadvantage"].includes(input.rollMode)) {
    return { ok: false, reason: "Выберите обычный бросок, преимущество или помеху." };
  }
  const first = parsePhysicalInteger(input.firstD20, 1, 20, "Первый к20");
  if (!first.ok) return first;
  const rolls = [first.value];
  if (input.rollMode !== "normal") {
    const second = parsePhysicalInteger(input.secondD20, 1, 20, "Второй к20");
    if (!second.ok) return second;
    rolls.push(second.value);
  }
  const chosenD20 = input.rollMode === "advantage"
    ? Math.max(...rolls)
    : input.rollMode === "disadvantage" ? Math.min(...rolls) : rolls[0];
  const attackTotal = chosenD20 + profile.attackBonus;
  let hitResult = null;
  let hitResolutionSource = null;
  if (input.targetArmorClass !== undefined &&
      input.targetArmorClass !== null &&
      String(input.targetArmorClass).trim() !== "") {
    const ac = parsePhysicalInteger(input.targetArmorClass, 1, 99, "КД цели");
    if (!ac.ok) return ac;
    hitResult = chosenD20 === 20 || (chosenD20 !== 1 && attackTotal >= ac.value);
    hitResolutionSource = "known-ac";
  } else if (input.dmHitResult === "hit" || input.dmHitResult === "miss") {
    hitResult = input.dmHitResult === "hit";
    hitResolutionSource = "dm";
  }
  return {
    ok: true,
    profileId: input.profileId,
    rollMode: input.rollMode,
    rawD20Rolls: rolls,
    chosenD20,
    attackBonusSnapshot: profile.attackBonus,
    attackTotal,
    critical: chosenD20 === 20,
    naturalMiss: chosenD20 === 1,
    hitResult,
    hitResolutionSource,
    profile
  };
}

export function calculateAttackDamage(profile, rolls, critical = false) {
  const requiredDice = critical ? 2 : 1;
  if (!Array.isArray(rolls) || rolls.length !== requiredDice) {
    return { ok: false, reason: `Введите ровно ${requiredDice} физический результат кости урона.` };
  }
  const checked = rolls.map((raw, index) =>
    parsePhysicalInteger(raw, 1, Number(String(profile.damageDice).match(/d(\d+)/)?.[1]), `Кость урона ${index + 1}`));
  const invalid = checked.find((result) => !result.ok);
  if (invalid) return invalid;
  const physicalRolls = checked.map((result) => result.value);
  return {
    ok: true,
    damageRolls: physicalRolls,
    damageModifierSnapshot: profile.damageModifier,
    damageTotalBeforeTargetModifiers: physicalRolls.reduce((sum, roll) => sum + roll, 0) +
      profile.damageModifier,
    damageType: profile.damageType,
    note: "Урон до сопротивлений и других поправок цели."
  };
}

export function calculateDeflectionPreview(character, input) {
  const derived = getDerivedStats(character);
  const incoming = parsePhysicalInteger(input.incomingDamage, 0, Number.MAX_SAFE_INTEGER, "Входящий урон");
  if (!incoming.ok) return incoming;
  const die = parsePhysicalInteger(
    input.deflectRoll,
    1,
    derived.monk.martialDieSides,
    "Результат кости Боевых искусств"
  );
  if (!die.ok) return die;
  const reduction = die.value + derived.level + derived.abilityModifiers.dexterity;
  const rawRemainder = Math.max(0, incoming.value - reduction);
  const adjusted = input.finalAdjustedDamage == null ||
    String(input.finalAdjustedDamage).trim() === ""
    ? { ok: true, value: rawRemainder }
    : parsePhysicalInteger(input.finalAdjustedDamage, 0, rawRemainder, "Итоговый скорректированный остаток");
  if (!adjusted.ok) return adjusted;
  const pools = applyDamagePools(
    Number(character.combat?.hp?.current),
    Number(character.combat?.hp?.temp ?? 0),
    input.applyDamageToSara === true ? adjusted.value : 0
  );
  if (!pools.ok) return pools;
  return {
    ok: true,
    incomingDamage: incoming.value,
    deflectRoll: die.value,
    reduction,
    rawRemainder,
    finalRemainder: adjusted.value,
    damagePools: pools,
    applyDamageToSara: input.applyDamageToSara === true
  };
}

export function calculateRegenerationPreview(character, rawDieResult) {
  const derived = getDerivedStats(character);
  const roll = parsePhysicalInteger(
    rawDieResult,
    1,
    derived.monk.martialDieSides,
    "Результат кости Боевых искусств"
  );
  if (!roll.ok) return roll;
  const healing = Math.max(0, roll.value + derived.abilityModifiers.wisdom);
  const result = applyHealing(
    derived.currentHitPoints,
    derived.maxHitPoints,
    healing
  );
  if (!result.ok) return result;
  return {
    ok: true,
    dieResult: roll.value,
    wisdomModifier: derived.abilityModifiers.wisdom,
    calculatedHealing: healing,
    usefulHealing: result.healing,
    hpBefore: result.hpBefore,
    hpAfter: result.hpAfter,
    kiBefore: Number(character.combat?.ki?.current),
    kiAfter: Number(character.combat?.ki?.current) - 2
  };
}
