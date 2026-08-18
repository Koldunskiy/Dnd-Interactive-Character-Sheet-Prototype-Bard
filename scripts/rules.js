export const ABILITY_KEYS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];

export const ABILITY_SHORT_MAP = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

export const ABILITY_LABELS_RU = {
  strength: "Сила",
  dexterity: "Ловкость",
  constitution: "Телосложение",
  intelligence: "Интеллект",
  wisdom: "Мудрость",
  charisma: "Харизма",
};

export const SKILL_ID_META = {
  athletics: { label: "Атлетика", ability: "strength" },
  acrobatics: { label: "Акробатика", ability: "dexterity" },
  sleightOfHand: { label: "Ловкость рук", ability: "dexterity" },
  stealth: { label: "Скрытность", ability: "dexterity" },

  arcana: { label: "Магия", ability: "intelligence" },
  history: { label: "История", ability: "intelligence" },
  investigation: { label: "Расследование", ability: "intelligence" },
  nature: { label: "Природа", ability: "intelligence" },
  religion: { label: "Религия", ability: "intelligence" },

  animalHandling: { label: "Уход за животными", ability: "wisdom" },
  insight: { label: "Проницательность", ability: "wisdom" },
  medicine: { label: "Медицина", ability: "wisdom" },
  perception: { label: "Восприятие", ability: "wisdom" },
  survival: { label: "Выживание", ability: "wisdom" },

  deception: { label: "Обман", ability: "charisma" },
  intimidation: { label: "Запугивание", ability: "charisma" },
  performance: { label: "Выступление", ability: "charisma" },
  persuasion: { label: "Убеждение", ability: "charisma" },
};

export const SKILL_ABILITY_MAP = Object.fromEntries(
  Object.values(SKILL_ID_META).map((entry) => [entry.label, entry.ability]),
);

export const PROFICIENCY_BY_LEVEL = [
  { min: 1, max: 4, value: 2 },
  { min: 5, max: 8, value: 3 },
  { min: 9, max: 12, value: 4 },
  { min: 13, max: 16, value: 5 },
  { min: 17, max: 20, value: 6 },
];

export const BARD_PROGRESSION = {
  1: {
    cantripsKnown: 2,
    preparedSpells: 4,
    bardicDie: "1d6",
    slots: { 1: 2 },
  },
  2: {
    cantripsKnown: 2,
    preparedSpells: 5,
    bardicDie: "1d6",
    slots: { 1: 3 },
  },
  3: {
    cantripsKnown: 2,
    preparedSpells: 6,
    bardicDie: "1d6",
    slots: { 1: 4, 2: 2 },
  },
  4: {
    cantripsKnown: 3,
    preparedSpells: 7,
    bardicDie: "1d6",
    slots: { 1: 4, 2: 3 },
  },
  5: {
    cantripsKnown: 3,
    preparedSpells: 8,
    bardicDie: "1d8",
    slots: { 1: 4, 2: 3, 3: 2 },
  },
  6: {
    cantripsKnown: 3,
    preparedSpells: 9,
    bardicDie: "1d8",
    slots: { 1: 4, 2: 3, 3: 3 },
  },
  7: {
    cantripsKnown: 3,
    preparedSpells: 10,
    bardicDie: "1d8",
    slots: { 1: 4, 2: 3, 3: 3, 4: 1 },
  },
  8: {
    cantripsKnown: 3,
    preparedSpells: 11,
    bardicDie: "1d8",
    slots: { 1: 4, 2: 3, 3: 3, 4: 2 },
  },
  9: {
    cantripsKnown: 3,
    preparedSpells: 12,
    bardicDie: "1d8",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 },
  },
  10: {
    cantripsKnown: 4,
    preparedSpells: 14,
    bardicDie: "1d10",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 },
  },
  11: {
    cantripsKnown: 4,
    preparedSpells: 15,
    bardicDie: "1d10",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 },
  },
  12: {
    cantripsKnown: 4,
    preparedSpells: 15,
    bardicDie: "1d10",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 },
  },
  13: {
    cantripsKnown: 4,
    preparedSpells: 16,
    bardicDie: "1d10",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 },
  },
  14: {
    cantripsKnown: 4,
    preparedSpells: 18,
    bardicDie: "1d10",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 },
  },
  15: {
    cantripsKnown: 4,
    preparedSpells: 19,
    bardicDie: "1d12",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 },
  },
  16: {
    cantripsKnown: 4,
    preparedSpells: 19,
    bardicDie: "1d12",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 },
  },
  17: {
    cantripsKnown: 4,
    preparedSpells: 20,
    bardicDie: "1d12",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 },
  },
  18: {
    cantripsKnown: 4,
    preparedSpells: 22,
    bardicDie: "1d12",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1, 7: 1, 8: 1, 9: 1 },
  },
  19: {
    cantripsKnown: 4,
    preparedSpells: 22,
    bardicDie: "1d12",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 1, 8: 1, 9: 1 },
  },
  20: {
    cantripsKnown: 4,
    preparedSpells: 22,
    bardicDie: "1d12",
    slots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1 },
  },
};

export function clampCharacterLevel(level) {
  const numericLevel = Number(level);

  if (Number.isNaN(numericLevel)) {
    return 1;
  }

  return Math.min(20, Math.max(1, numericLevel));
}

export function getBardProgression(level) {
  return BARD_PROGRESSION[clampCharacterLevel(level)] ?? BARD_PROGRESSION[1];
}

export function getBardCantripLimit(level) {
  return getBardProgression(level).cantripsKnown ?? 0;
}

export function getBardPreparedSpellLimit(level) {
  return getBardProgression(level).preparedSpells ?? 0;
}

export function getBardSpellSlots(level) {
  return { ...getBardProgression(level).slots };
}

export function getBardicInspirationDie(level) {
  return getBardProgression(level).bardicDie ?? "1d6";
}

export const TURN_TRACKER_META = [
  { key: "actionUsed", label: "Действие", readyLabel: "Готово", usedLabel: "Потрачено" },
  { key: "bonusActionUsed", label: "Бонусное действие", readyLabel: "Готово", usedLabel: "Потрачено" },
  { key: "reactionUsed", label: "Реакция", readyLabel: "Готово", usedLabel: "Потрачено" },
];