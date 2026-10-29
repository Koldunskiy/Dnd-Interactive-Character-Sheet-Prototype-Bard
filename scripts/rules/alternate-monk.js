export const ALTERNATE_MONK_RULESET_ID =
  "laserllama-alternate-monk-open-hand-snapshot-2026-10-29";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const SKILLS = {
  athletics: ["Атлетика", "strength"],
  acrobatics: ["Акробатика", "dexterity"],
  sleightOfHand: ["Ловкость рук", "dexterity"],
  stealth: ["Скрытность", "dexterity"],
  arcana: ["Магия", "intelligence"],
  history: ["История", "intelligence"],
  investigation: ["Расследование", "intelligence"],
  nature: ["Природа", "intelligence"],
  religion: ["Религия", "intelligence"],
  animalHandling: ["Уход за животными", "wisdom"],
  insight: ["Проницательность", "wisdom"],
  medicine: ["Медицина", "wisdom"],
  perception: ["Восприятие", "wisdom"],
  survival: ["Выживание", "wisdom"],
  deception: ["Обман", "charisma"],
  intimidation: ["Запугивание", "charisma"],
  performance: ["Выступление", "charisma"],
  persuasion: ["Убеждение", "charisma"]
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const modifier = (score) => Math.floor((Number(score ?? 10) - 10) / 2);

function selectedTechniqueIds(monk) {
  return [
    ...(monk.ordinaryTechniqueIds ?? []),
    ...Object.values(monk.signatureTechniqueSlots ?? {})
  ];
}

export function getAlternateMonkDerived(character) {
  const level = Math.max(1, Math.min(20, Number(character.profile?.level ?? 1)));
  const proficiencyBonus = 2 + Math.floor((level - 1) / 4);
  const baseAbilities = { ...character.abilities };
  const items = Array.isArray(character.inventory?.items) ? character.inventory.items : [];
  const amuletActive = items.some((item) =>
    item.id === "amulet-of-health" && item.equipped === true && item.attuned === true);
  const abilities = { ...baseAbilities };
  if (amuletActive && Number(abilities.constitution) < 19) abilities.constitution = 19;
  const abilityModifiers = Object.fromEntries(ABILITIES.map((key) => [key, modifier(abilities[key])]));
  const wisdomModifier = abilityModifiers.wisdom;
  const dexterityModifier = abilityModifiers.dexterity;
  const martialDieSides = level <= 4 ? 6 : level <= 10 ? 8 : level <= 16 ? 10 : 12;
  const baseKiMaximum = level === 1 ? 0 : Math.max(0, level + wisdomModifier);
  const thirdEyeActive =
    character.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"]?.awakenThirdEyeActive === true;
  const kiMaximum = Math.max(0, baseKiMaximum -
    (thirdEyeActive ? 8 : 0));
  const ki = clamp(Number(character.combat?.ki?.current ?? 0), 0, kiMaximum);
  const practicedMaximum = level >= 3 ? Math.max(1, wisdomModifier) : 0;
  const practiced = clamp(Number(character.combat?.practiced?.current ?? 0), 0, practicedMaximum);
  const techniqueSaveDc = 8 + proficiencyBonus + wisdomModifier;
  const hitPoints = 10 + abilityModifiers.constitution + (level - 1) * (6 + abilityModifiers.constitution);
  const armor = items.find((item) => item?.equipped && item?.type === "armor" && item?.armor)?.armor ?? null;
  const shield = Number(character.combat?.shieldBonus ?? 0);
  const wieldedWeapons = items.filter((item) => item?.equipped && item?.type === "weapon" && item?.weapon);
  const martialArtsAvailable = (!armor || armor.category !== "heavy") &&
    shield <= 0 && !wieldedWeapons.some((item) =>
      (item.weapon.properties ?? []).some((property) => String(property).toLowerCase() === "heavy"));
  let armorClass;
  if (!armor && shield <= 0) {
    armorClass = 10 + dexterityModifier + wisdomModifier + Number(character.combat?.armorBonusExtra ?? 0);
  } else if (!armor) {
    armorClass = 10 + dexterityModifier + shield + Number(character.combat?.armorBonusExtra ?? 0);
  } else {
    const dexCap = armor.category === "heavy" ? 0 : armor.dexCap;
    const appliedDex = dexCap == null ? dexterityModifier : Math.min(dexterityModifier, Number(dexCap));
    armorClass = Number(armor.baseAc ?? 10) + appliedDex +
      Number(armor.magicalBonusAc ?? 0) + shield + Number(character.combat?.armorBonusExtra ?? 0);
  }

  const monk = character.monk ?? {};
  const warriorAdeptSelected = selectedTechniqueIds(monk).includes("ll-monk:warrior-adept");
  const warriorAdeptStyle = warriorAdeptSelected
    ? monk.techniqueChoices?.["ll-monk:warrior-adept"]?.styleId ?? null
    : null;
  const mantleSelected = (monk.ordinaryTechniqueIds ?? []).includes("ll-monk:mantle-of-courtesy") ||
    Object.values(monk.signatureTechniqueSlots ?? {}).includes("ll-monk:mantle-of-courtesy");
  const baseSkills = new Map((character.skills ?? []).map((skill) => [skill.id, skill]));
  const skills = {};
  for (const [id, [label, ability]] of Object.entries(SKILLS)) {
    const saved = baseSkills.get(id) ?? {};
    const proficient = Boolean(saved.proficient) || (id === "persuasion" && mantleSelected);
    const skillAbility = id === "persuasion" && mantleSelected ? "wisdom" : ability;
    const skillValue = modifier(abilities[skillAbility]) +
      (saved.expertise ? 2 * proficiencyBonus : proficient ? proficiencyBonus : 0);
    skills[id] = skillValue;
    skills[label] = skillValue;
  }
  const spellAttackBonus = proficiencyBonus + wisdomModifier;
  const currentHp = clamp(Number(character.combat?.hp?.current ?? hitPoints), 0, hitPoints);
  const passivePerception = 10 + skills.perception;
  const passiveInsight = 10 + skills.insight;
  const passiveInvestigation = 10 + skills.investigation;
  const movementBonus = level <= 1 ? 0 : level <= 5 ? 10 : level <= 9 ? 15 :
    level <= 13 ? 20 : level <= 17 ? 25 : 30;
  const featherweightMovementBonus = warriorAdeptStyle === "ll-style:featherweight-fighting" &&
    (!armor || !["medium", "heavy"].includes(armor.category)) ? 10 : 0;
  const activeMovementBonus = (armor || shield ? 0 : movementBonus) + featherweightMovementBonus;
  const ordinaryTechniqueLimit = level === 1 ? 0 : level <= 4 ? 3 : level <= 6 ? 4 :
    level <= 8 ? 5 : level <= 10 ? 6 : level <= 12 ? 7 : level <= 14 ? 8 :
      level <= 17 ? 9 : 10;
  const weaponProficiencies = new Set(character.combat?.proficiencies?.weapons ?? []);
  const weapons = wieldedWeapons.map((item) => {
    const weapon = item.weapon;
    const properties = (weapon.properties ?? []).map((property) => String(property).toLowerCase());
    const weaponName = `${item.name ?? ""} ${weapon.proficiencyName ?? ""}`.toLowerCase();
    const allowedMartialWeapon = weapon.category !== "ranged" &&
      !properties.some((property) => ["heavy", "special"].includes(property));
    const isProficient = weapon.proficient === true ||
      weaponProficiencies.has(weapon.proficiencyName) ||
      (weapon.category === "simple-melee" && weaponProficiencies.has("Simple weapons")) ||
      (weapon.category === "martial-melee" && weapon.proficiencyName === "Shortsword" &&
        weaponProficiencies.has("Shortswords"));
    const attackStat = allowedMartialWeapon && martialArtsAvailable
      ? "dexterity" : weapon.attackStat ?? "strength";
    const attackAbility = abilityModifiers[attackStat] ?? 0;
    const magicalAttack = Number(weapon.magicalBonusAttack ?? 0);
    const magicalDamage = Number(weapon.magicalBonusDamage ?? 0);
    const adeptAttackBonus =
      warriorAdeptStyle === "ll-style:archery" && weapon.category === "ranged" ? 1 :
      warriorAdeptStyle === "ll-style:versatile-fighting" && properties.includes("versatile") &&
        shield <= 0 ? 1 : 0;
    const balancedBonus = warriorAdeptStyle === "ll-style:balanced-fighting" &&
      !weapon.twoHanded && wieldedWeapons.length === 1 ? 2 : 0;
    const featherweightAllowed = warriorAdeptStyle === "ll-style:featherweight-fighting" &&
      (!armor || !["medium", "heavy"].includes(armor.category));
    const featherweightBonus = featherweightAllowed && properties.includes("light") ? 1 : 0;
    const polearmNames = ["glaive", "halberd", "pike", "quarterstaff", "spear"];
    const polearmBonus = warriorAdeptStyle === "ll-style:polearm-fighting" &&
      shield <= 0 && polearmNames.some((name) => weaponName.includes(name)) ? 1 : 0;
    const adeptDamageBonus = balancedBonus + featherweightBonus + polearmBonus;
    const attackBonus = attackAbility + (isProficient ? proficiencyBonus : 0) +
      magicalAttack + adeptAttackBonus;
    const damageBonus = attackAbility + magicalDamage + adeptDamageBonus;
    return {
      id: item.id,
      name: item.name,
      attackStat,
      attackBonus,
      formattedAttackBonus: `${attackBonus >= 0 ? "+" : ""}${attackBonus}`,
      damageDice: allowedMartialWeapon && martialArtsAvailable ? `1d${martialDieSides}` : weapon.damageDice ?? "—",
      damageBonus,
      formattedDamageBonus: `${damageBonus >= 0 ? "+" : ""}${damageBonus}`,
      damageType: weapon.damageType ?? "—",
      properties: weapon.properties ?? [],
      notes: item.notes ?? "",
      proficient: isProficient,
      martialArtsAvailable
    };
  });
  const tools = {
    "thieves-tools": abilityModifiers.dexterity + proficiencyBonus
  };

  return {
    level,
    proficiencyBonus,
    hasJackOfAllTrades: false,
    abilities,
    abilityModifiers,
    abilityChecks: Object.fromEntries(ABILITIES.map((key) => [key, abilityModifiers[key]])),
    savingThrows: Object.fromEntries(ABILITIES.map((key) => [
      key,
      abilityModifiers[key] + (
        character.savingThrows?.[key]?.proficient ||
        (key === "constitution" && level >= 13) ? proficiencyBonus : 0
      )
    ])),
    skills,
    armorClass,
    maxHitPoints: hitPoints,
    maxHp: hitPoints,
    maxHpLegacy: hitPoints,
    currentHitPoints: currentHp,
    currentHp,
    tempHitPoints: Math.max(0, Number(character.combat?.hp?.temp ?? 0)),
    initiative: dexterityModifier + Number(character.combat?.initiativeBonusExtra ?? 0),
    formattedInitiative: dexterityModifier + Number(character.combat?.initiativeBonusExtra ?? 0) >= 0
      ? `+${dexterityModifier + Number(character.combat?.initiativeBonusExtra ?? 0)}`
      : String(dexterityModifier + Number(character.combat?.initiativeBonusExtra ?? 0)),
    passivePerception,
    passiveInsight,
    passiveInvestigation,
    martialDie: `d${martialDieSides}`,
    martialDieSides,
    ki: { current: ki, maximum: kiMaximum },
    kiMaximum,
    baseKiMaximum,
    practiced: { current: practiced, maximum: practicedMaximum },
    practicedMaximum,
    techniqueSaveDc,
    racialSaveDc: techniqueSaveDc,
    ordinaryTechniqueLimit,
    unarmoredMovementBonus: activeMovementBonus,
    unarmedAttackBonus: dexterityModifier + proficiencyBonus,
    unarmedDamage: `1d${martialDieSides} ${dexterityModifier + (
      warriorAdeptStyle === "ll-style:featherweight-fighting" &&
      (!armor || !["medium", "heavy"].includes(armor.category)) ? 1 : 0
    ) >= 0 ? "+" : ""}${dexterityModifier + (
      warriorAdeptStyle === "ll-style:featherweight-fighting" &&
      (!armor || !["medium", "heavy"].includes(armor.category)) ? 1 : 0
    )} дробящего`,
    spellStats: {
      ability: "wisdom",
      spellcastingModifier: wisdomModifier,
      spellSaveDc: techniqueSaveDc,
      spellAttackBonus,
      formattedSpellAttackBonus: spellAttackBonus >= 0 ? `+${spellAttackBonus}` : String(spellAttackBonus)
    },
    spellSaveDc: techniqueSaveDc,
    spellAttackBonus,
    formattedSpellAttackBonus: spellAttackBonus >= 0 ? `+${spellAttackBonus}` : String(spellAttackBonus),
    spellSlots: [],
    bardProgression: { cantripsKnown: 0, spellsKnown: 0, bardicDie: null, bardicUses: 0, slots: {} },
    bardicInspiration: null,
    cantripsKnown: 0,
    spellsKnown: 0,
    weapons,
    tools,
    martialArtsAvailable,
    grappleShoveBonus: dexterityModifier,
    indomitableAthleticsBonus: wisdomModifier,
    combatCards: {
      weapons: weapons.map((weapon) => ({
        id: weapon.id,
        kind: "weapon",
        title: weapon.name,
        attack: weapon.formattedAttackBonus,
        damage: `${weapon.damageDice} ${weapon.formattedDamageBonus} ${weapon.damageType}`,
        damageType: weapon.damageType,
        tags: weapon.properties,
        notes: weapon.notes
      })),
      features: [],
      spells: []
    },
    turnTracker: {
      turnNumber: Math.max(1, Number(character.ui?.turn?.turnNumber ?? 1)),
      items: [
        ["actionUsed", "Действие", "Использовано", "Готово"],
        ["bonusActionUsed", "Бонусное действие", "Использовано", "Готово"],
        ["reactionUsed", "Реакция", "Использована", "Готова"]
      ].map(([key, label, usedLabel, readyLabel]) => ({
        key, label, used: Boolean(character.ui?.turn?.[key]),
        ready: !character.ui?.turn?.[key],
        stateLabel: character.ui?.turn?.[key] ? usedLabel : readyLabel
      }))
    },
    monk: {
      kiMaximum,
      practicedMaximum,
      techniqueSaveDc,
      ordinaryTechniqueLimit,
      martialDie: `d${martialDieSides}`,
      martialDieSides,
      movementBonus,
      mantleSelected,
      warriorAdeptStyle
    }
  };
}
