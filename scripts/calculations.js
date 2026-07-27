import {
  ABILITY_KEYS,
  ABILITY_SHORT_MAP,
  SKILL_ID_META,
  SKILL_ABILITY_MAP,
  PROFICIENCY_BY_LEVEL,
  BARD_PROGRESSION,
  TURN_TRACKER_META
} from "./rules.js";
import { buildCharacterSpellCollections } from "./selectors/spellcasting.js";

function getAbilityModifier(score = 10) {
  return Math.floor((Number(score) - 10) / 2);
}

function formatSigned(value) {
  const number = Number(value) || 0;
  return number >= 0 ? `+${number}` : `${number}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getLevel(character) {
  return Math.max(1, Number(character.profile?.level ?? 1));
}

function getProficiencyBonus(level, override = null) {
  if (override != null && override !== "") {
    return Number(override);
  }

  return (
    PROFICIENCY_BY_LEVEL.find((row) => level >= row.min && level <= row.max)?.value ?? 2
  );
}

function hasFeature(character, featureName) {
  const level = getLevel(character);
  const features = Array.isArray(character.classFeatures) ? character.classFeatures : [];

  return features.some(
    (feature) =>
      feature?.name === featureName &&
      Number(feature?.level ?? 0) <= level
  );
}

function hasJackOfAllTrades(character) {
  const disabledByUi = Boolean(character.ui?.rulesOverrides?.disableJackOfAllTrades);
  return hasFeature(character, "Мастер на все руки") && !disabledByUi;
}

function getAbilityModifiers(character) {
  const abilities = character.abilities ?? {};

  return ABILITY_KEYS.reduce((acc, key) => {
    acc[key] = getAbilityModifier(abilities[key]);
    return acc;
  }, {});
}

function getAbilityChecks(abilityModifiers, proficiencyBonus, hasJoat) {
  const halfProf = hasJoat ? Math.floor(proficiencyBonus / 2) : 0;

  return ABILITY_KEYS.reduce((acc, key) => {
    acc[key] = (abilityModifiers[key] ?? 0) + halfProf;
    return acc;
  }, {});
}

function getSavingThrows(character, abilityModifiers, proficiencyBonus) {
  const savingThrows = character.savingThrows ?? {};

  return ABILITY_KEYS.reduce((acc, key) => {
    const proficient = Boolean(savingThrows[key]?.proficient);
    acc[key] = (abilityModifiers[key] ?? 0) + (proficient ? proficiencyBonus : 0);
    return acc;
  }, {});
}

function getSkillValue(skill, abilityModifiers, proficiencyBonus, hasJoat) {
  const abilityKey = skill?.ability ?? null;
  const abilityMod = abilityKey ? abilityModifiers[abilityKey] ?? 0 : 0;

  if (skill?.expertise) {
    return abilityMod + proficiencyBonus * 2;
  }

  if (skill?.proficient) {
    return abilityMod + proficiencyBonus;
  }

  return abilityMod + (hasJoat ? Math.floor(proficiencyBonus / 2) : 0);
}

function getSkills(character, abilityModifiers, proficiencyBonus, hasJoat) {
  const skills = Array.isArray(character.skills) ? character.skills : [];
  const byId = new Map(skills.filter((skill) => skill?.id).map((skill) => [skill.id, skill]));

  return Object.entries(SKILL_ID_META).reduce((acc, [skillId, meta]) => {
    const sourceSkill = byId.get(skillId) ?? {
      id: skillId,
      name: meta.label,
      ability: meta.ability,
      proficient: false,
      expertise: false,
      source: null,
    };

    const value = getSkillValue(sourceSkill, abilityModifiers, proficiencyBonus, hasJoat);

    acc[skillId] = value;
    acc[meta.label] = value;
    return acc;
  }, {});
}

function getArmorClass(character, abilityModifiers) {
  const armorBase = Number(character.combat?.armorBase ?? 10);
  const dexMod = abilityModifiers.dexterity ?? 0;
  const dexCap = character.combat?.armorDexCap;
  const shieldBonus = Number(character.combat?.shieldBonus ?? 0);
  const miscBonus = Number(character.combat?.armorBonusExtra ?? 0);
  const appliedDex = dexCap == null ? dexMod : Math.min(dexMod, Number(dexCap));

  return armorBase + appliedDex + shieldBonus + miscBonus;
}

function getMaxHitPoints(character, abilityModifiers) {
  const override = character.combat?.hp?.maxOverride;
  if (override != null && override !== "") {
    return Number(override);
  }

  const explicitMax = character.combat?.hp?.max;
  if (explicitMax != null && explicitMax !== "") {
    return Number(explicitMax);
  }

  const level = getLevel(character);
  const hitDie = Number(character.combat?.hitDie ?? 8);
  const conMod = abilityModifiers.constitution ?? 0;
  const averagePerLevelAfterFirst = Math.floor(hitDie / 2) + 1;

  return hitDie + conMod + (level - 1) * (averagePerLevelAfterFirst + conMod);
}

function getCurrentHitPoints(character, maxHitPoints) {
  const current = Number(character.combat?.hp?.current ?? maxHitPoints);
  return clamp(current, 0, maxHitPoints);
}

function getInitiative(character, abilityModifiers, proficiencyBonus, hasJoat) {
  const dexMod = abilityModifiers.dexterity ?? 0;
  const extra = Number(character.combat?.initiativeBonusExtra ?? 0);
  const halfProf = hasJoat ? Math.floor(proficiencyBonus / 2) : 0;

  return dexMod + extra + halfProf;
}

function getBardProgression(character) {
  const level = getLevel(character);
  const fallback = {
    cantripsKnown: 0,
    spellsKnown: 0,
    bardicDie: null,
    bardicUses: 0,
    slots: {}
  };

  if (character.profile?.className !== "Бард") {
    return fallback;
  }

  return BARD_PROGRESSION[level] ?? fallback;
}

function getWeaponDerivedList(character, abilityModifiers, proficiencyBonus) {
  const weapons =
    Array.isArray(character.combat?.weapons) && character.combat.weapons.length
      ? character.combat.weapons
      : character.combat?.weapon
        ? [character.combat.weapon]
        : [];

  return weapons.map((weapon) => {
    const attackStat = weapon.attackStat ?? "strength";
    const abilityMod = abilityModifiers[attackStat] ?? 0;
    const duelingApplies =
      character.combat?.fightingStyle?.name === "Дуэлянт" &&
      String(weapon.name || "").toLowerCase() !== "кинжал";

    const styleDamageBonus = duelingApplies
      ? Number(character.combat?.fightingStyle?.damageBonus ?? 0)
      : 0;

    const attackBonus = abilityMod + proficiencyBonus;
    const damageBonus = abilityMod + styleDamageBonus;

    return {
      id: weapon.id || `weapon-${String(weapon.name || "weapon").toLowerCase().replaceAll(" ", "-")}`,
      name: weapon.name || "Оружие",
      attackStat,
      attackBonus,
      formattedAttackBonus: formatSigned(attackBonus),
      damageDice: weapon.damageDice ?? weapon.damage ?? "—",
      damageBonus,
      formattedDamageBonus: formatSigned(damageBonus),
      damageType: weapon.damageType || "—",
      properties: weapon.properties || [],
      notes: weapon.notes || "",
      duelingApplies
    };
  });
}

function getSpellStats(character, abilityModifiers, proficiencyBonus) {
  const spellcasting = character.spellcasting ?? {};
  const spellAbility = spellcasting.ability ?? "charisma";
  const spellMod = abilityModifiers[spellAbility] ?? 0;

  const spellSaveDc =
    spellcasting.spellSaveDcOverride != null
      ? Number(spellcasting.spellSaveDcOverride)
      : 8 + proficiencyBonus + spellMod;

  const spellAttackBonus =
    spellcasting.spellAttackBonusOverride != null
      ? Number(spellcasting.spellAttackBonusOverride)
      : proficiencyBonus + spellMod;

  return {
    spellcastingAbility: spellAbility,
    spellcastingModifier: spellMod,
    spellSaveDc,
    spellAttackBonus,
    formattedSpellAttackBonus: formatSigned(spellAttackBonus)
  };
}

export function formatSpellSave(spell, spellSaveDc) {
  if (spell?.save) {
    return spell.save;
  }

  if (!spell?.saveAbility) {
    return null;
  }

  const map = {
    strength: "Сила",
    dexterity: "Ловкость",
    constitution: "Телосложение",
    intelligence: "Интеллект",
    wisdom: "Мудрость",
    charisma: "Харизма",
  };

  if (spellSaveDc == null) {
    return map[spell.saveAbility] ?? spell.saveAbility;
  }

  return `${map[spell.saveAbility] ?? spell.saveAbility} ${spellSaveDc}`;
}

export function formatSpellDamage(spell, spellcastingModifier) {
  if (!spell?.damage) {
    return null;
  }

  if (typeof spell.damage === "string") {
    return spell.damage;
  }

  const modifier =
    spell.damage.modifier === "spellcasting"
      ? spellcastingModifier
      : Number(spell.damage.modifier ?? 0);

  const modifierPart =
    modifier === 0 ? "" : ` ${formatSigned(modifier)}`;

  return `${spell.damage.dice}${modifierPart} ${spell.damage.type}`.trim();
}

export function formatHealing(spell, spellcastingModifier) {
  if (!spell?.healing) {
    return null;
  }

  const modifier =
    spell.healing.modifier === "spellcasting"
      ? spellcastingModifier
      : Number(spell.healing.modifier ?? 0);

  const modifierPart =
    modifier === 0 ? "" : ` ${formatSigned(modifier)}`;

  return `${spell.healing.dice}${modifierPart} лечение`.trim();
}

function formatDiceWithModifier(dice, modifier) {
  const numericModifier = Number(modifier ?? 0);

  if (!numericModifier) {
    return dice;
  }

  return `${dice} ${formatSigned(numericModifier)}`;
}

function isSpellAvailable(character, spell) {
  const level = getLevel(character);

  if (spell?.availableFromLevel && level < Number(spell.availableFromLevel)) {
    return false;
  }

  if (spell?.locked) {
    return false;
  }

  return true;
}

function inferCombatRole(spell) {
  if (spell?.combatRole) {
    return spell.combatRole;
  }

  if (spell?.damage || spell?.healing) {
    return "combat";
  }

  if (spell?.concentration) {
    return "combat";
  }

  const originalName = String(spell?.originalName || "").toLowerCase();
  const name = String(spell?.name || "").toLowerCase();

  const knownCombatSpells = [
    "vicious mockery",
    "tasha’s hideous laughter",
    "tasha's hideous laughter",
    "dissonant whispers",
    "cure wounds",
    "healing word",
    "mirror image",
    "язвительная насмешка",
    "безудержный смех",
    "диссонирующий шёпот",
    "исцеление ран",
    "исцеляющее слово",
    "зеркальное отражение",
  ];

  if (
    knownCombatSpells.includes(originalName) ||
    knownCombatSpells.includes(name)
  ) {
    return "combat";
  }

  return "utility";
}

function getCombatSpells(character, spellStats) {
  const collections = buildCharacterSpellCollections(character);
  const spells = [
    ...(collections.cantrips || []),
    ...(collections.preparedSpells || []),
    ...(collections.grantedSpells || []),
  ];

  return spells
    .filter((spell) => isSpellAvailable(character, spell))
    .filter((spell) => inferCombatRole(spell) !== "utility")
    .map((spell) => ({
      id: `spell-${String(spell.originalName ?? spell.name ?? "")
        .toLowerCase()
        .replaceAll(" ", "-")}`,
      spellId: spell.id ?? null,
      kind: "spell",
      title: spell.name ?? "",
      originalName: spell.originalName ?? null,
      level: Number(spell.level ?? 0),
      school: spell.school ?? null,
      attack: spell.attackBonus ?? (spell.attackType ? spellStats.formattedSpellAttackBonus : null),
      save: formatSpellSave(spell, spellStats.spellSaveDc),
      damage:
        formatSpellDamage(spell, spellStats.spellcastingModifier) ??
        formatHealing(spell, spellStats.spellcastingModifier),
      concentration: Boolean(spell.concentration),
      castTime: spell.castTime ?? spell.castingTime ?? "",
      range: spell.range ?? "",
      rangeFeet:
        spell.rangeFeet !== null && spell.rangeFeet !== undefined
          ? Number(spell.rangeFeet)
          : null,
      areaShape: spell.areaShape ?? null,
      areaSizeFeet:
        spell.areaSizeFeet !== null && spell.areaSizeFeet !== undefined
          ? Number(spell.areaSizeFeet)
          : null,
      areaType: spell.areaType ?? null,
      duration: spell.duration ?? "",
      tags: [spell.sourceLabel, spell.school, spell.combatRole ?? inferCombatRole(spell)].filter(Boolean),
      notes: spell.vibe ?? spell.description ?? spell.notes ?? "",
    }));
}

function getCombatFeatures(character) {
  const flourishes = Array.isArray(character.combat?.flourishes) ? character.combat.flourishes : [];

  return flourishes.map((flourish) => ({
    id: `flourish-${String(flourish.name || "").toLowerCase().replaceAll(" ", "-")}`,
    kind: "feature",
    title: flourish.name || "Росчерк",
    cost: flourish.cost || "",
    notes: flourish.text || "",
    tags: ["Росчерк клинка"]
  }));
}

function getCombatCards(character, derivedBase) {
  const weapons = derivedBase.weapons.map((weapon) => ({
    id: weapon.id,
    kind: "weapon",
    title: weapon.name,
    attack: weapon.formattedAttackBonus,
    damage: formatDiceWithModifier(weapon.damageDice, weapon.damageBonus),
    damageType: weapon.damageType,
    tags: weapon.properties,
    notes: weapon.notes
  }));

  return {
    weapons,
    features: getCombatFeatures(character),
    spells: getCombatSpells(character, derivedBase.spellStats)
  };
}

function getSpellSlotsState(character, bardProgression) {
  const usedMap = character.spellcasting?.slotsUsed ?? character.spellcasting?.slots ?? {};
  const levels = Object.keys(bardProgression.slots ?? {}).map(Number).sort((a, b) => a - b);

  return levels.map((level) => {
    const max = Number(bardProgression.slots[level] ?? 0);
    const rawUsed = Number(usedMap[level]?.used ?? usedMap[level] ?? 0);
    const used = clamp(rawUsed, 0, max);

    return {
      level,
      max,
      used,
      available: Math.max(0, max - used)
    };
  });
}

function getPassivePerception(skills, abilityChecks) {
  if (typeof skills.perception === "number") {
    return 10 + skills.perception;
  }

  if (typeof skills["Восприятие"] === "number") {
    return 10 + skills["Восприятие"];
  }

  return 10 + (abilityChecks.wisdom ?? 0);
}

function getTurnTracker(character) {
  const turn = character.ui?.turn ?? {};

  return {
    turnNumber: Math.max(1, Number(turn.turnNumber ?? 1)),
    items: TURN_TRACKER_META.map((item) => {
      const used = Boolean(turn[item.key]);

      return {
        key: item.key,
        label: item.label,
        used,
        ready: !used,
        stateLabel: used ? item.usedLabel : item.readyLabel
      };
    })
  };
}

function getBardicInspirationState(character, bardProgression, abilityModifiers) {
  const max = Math.max(1, Number(abilityModifiers.charisma ?? 0));
  const current = clamp(Number(character.combat?.bardicInspiration?.current ?? max), 0, max);

  return {
    dice: bardProgression.bardicDie,
    max,
    current,
    refresh: character.combat?.bardicInspiration?.refresh ?? "Долгий отдых",
    rangeFeet: Number(character.combat?.bardicInspiration?.rangeFeet ?? 60),
    rangeMeters: Number(character.combat?.bardicInspiration?.rangeMeters ?? 18),
    duration: character.combat?.bardicInspiration?.duration ?? "10 минут",
    notes: character.combat?.bardicInspiration?.notes ?? ""
  };
}

export function getDerivedStats(character) {
  const level = getLevel(character);
  const proficiencyBonus = getProficiencyBonus(
    level,
    character.profile?.proficiencyBonusOverride ?? null
  );
  const joat = hasJackOfAllTrades(character);
  const abilityModifiers = getAbilityModifiers(character);
  const abilityChecks = getAbilityChecks(abilityModifiers, proficiencyBonus, joat);
  const savingThrows = getSavingThrows(character, abilityModifiers, proficiencyBonus);
  const skills = getSkills(character, abilityModifiers, proficiencyBonus, joat);
  const armorClass = getArmorClass(character, abilityModifiers);
  const maxHitPoints = getMaxHitPoints(character, abilityModifiers);
  const currentHitPoints = getCurrentHitPoints(character, maxHitPoints);
  const initiative = getInitiative(character, abilityModifiers, proficiencyBonus, joat);
  const bardProgression = getBardProgression(character);
  const weapons = getWeaponDerivedList(character, abilityModifiers, proficiencyBonus);
  const spellStats = getSpellStats(character, abilityModifiers, proficiencyBonus);
  const spellSlots = getSpellSlotsState(character, bardProgression);
  const bardicInspiration = getBardicInspirationState(
    character,
    bardProgression,
    abilityModifiers
  );

  const derivedBase = {
    level,
    proficiencyBonus,
    hasJackOfAllTrades: joat,
    abilityModifiers,
    abilityChecks,
    savingThrows,
    skills,
    armorClass,
    maxHitPoints,
    currentHitPoints,
    tempHitPoints: Number(character.combat?.hp?.temp ?? 0),
    initiative,
    formattedInitiative: formatSigned(initiative),
    passivePerception: getPassivePerception(skills, abilityChecks),
    spellStats,
    spellSaveDc: spellStats.spellSaveDc,
    spellAttackBonus: spellStats.spellAttackBonus,
    formattedSpellAttackBonus: spellStats.formattedSpellAttackBonus,
    weapons,
    spellSlots,
    bardicInspiration,
    bardProgression,
    cantripsKnown: bardProgression.cantripsKnown,
    spellsKnown: bardProgression.spellsKnown,
  };

  return {
    ...derivedBase,
    combatCards: getCombatCards(character, derivedBase),
    turnTracker: getTurnTracker(character),
    maxHp: maxHitPoints,
    maxHpLegacy: maxHitPoints,
    currentHp: currentHitPoints,
  };
}