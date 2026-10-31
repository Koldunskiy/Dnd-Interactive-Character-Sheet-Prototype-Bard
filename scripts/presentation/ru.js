export const RU_LABELS = Object.freeze({
  hp: "Хиты",
  tempHp: "Временные хиты",
  ki: "Ци",
  practiced: "Отработанные удары",
  hitDice: "Кости хитов",
  martialArts: "Боевые искусства",
  signatureTechniques: "Техники подкласса",
  core: "Основной каталог",
  expanded: "Дополнение",
  action: "Действие",
  bonusAction: "Бонусное действие",
  reaction: "Реакция",
  hit: "После попадания",
  replaceAttack: "Вместо атаки",
  passive: "Пассивная способность",
  unarmed: "Безоружная атака",
  weaponMelee: "Рукопашная атака оружием",
  otherMelee: "Другая рукопашная атака",
  weaponRanged: "Дальнобойная атака оружием",
  otherRanged: "Другая дальнобойная атака / атака заклинанием",
  dash: "Рывок",
  disengage: "Отход",
  blinded: "Ослепление",
  deafened: "Глухота",
  unableToSpeak: "Невозможность говорить",
  stunned: "Ошеломление",
  incapacitated: "Недееспособность",
  prone: "Ничком",
  frightened: "Испуг",
  charmed: "Очарование",
  poisoned: "Отравлен"
});

export const RU_FEATURE_TITLES = Object.freeze({
  "Martial Arts": "Боевые искусства",
  "Unarmored Defense": "Защита без доспехов",
  "Flurry of Blows": "Шквал ударов",
  "Unarmored Movement": "Движение без доспехов",
  "Extra Attack": "Дополнительная атака",
  "Enlightened Strikes": "Просветлённые удары",
  Evasion: "Увёртливость",
  "Spirit of Tranquility": "Дух спокойствия",
  "Warrior's Spirit": "Воинский дух",
  "Warrior’s Spirit": "Воинский дух",
  "Ebb & Flow": "Прилив и отлив",
  "Open Hand Strike": "Удар открытой ладони",
  "Master of Many Forms": "Мастер многих форм",
  "Poison Spray": "Ядовитые брызги",
  "Animal Friendship": "Дружба с животными",
  Suggestion: "Внушение"
});

export const RU_SPELL_TITLES = Object.freeze({
  "Poison Spray": "Ядовитые брызги",
  "Animal Friendship": "Дружба с животными",
  Suggestion: "Внушение",
  "Summon Celestial": "Призыв небожителя",
  Commune: "Общение",
  "Commune with Nature": "Общение с природой"
});

const ACTIVATIONS = Object.freeze({
  action: RU_LABELS.action,
  "bonus-action": RU_LABELS.bonusAction,
  reaction: RU_LABELS.reaction,
  hit: RU_LABELS.hit,
  "replace-attack": RU_LABELS.replaceAttack,
  passive: RU_LABELS.passive
});

const PAYMENTS = Object.freeze({
  "—": "Без затрат ци",
  "0 Ki": "Без затрат ци",
  "1 Ki": "1 ци",
  "2 Ki": "2 ци",
  "0 Ki / 1 Ki": "Без затрат ци / 1 ци"
});

const SUBCHOICE_LABELS = Object.freeze({
  "ll-style:archery": "Стрельба",
  "ll-style:balanced-fighting": "Сбалансированный бой",
  "ll-style:featherweight-fighting": "Лёгкий бой",
  "ll-style:versatile-fighting": "Универсальный бой",
  "ll-style:polearm-fighting": "Бой древковым оружием"
});

export function techniqueTitle(entry) {
  return entry.nameRu || RU_FEATURE_TITLES[entry.nameEn] || entry.nameEn;
}

export function spellTitle(name) {
  return RU_SPELL_TITLES[name] ?? name;
}

export function activationLabel(value) {
  return ACTIVATIONS[value] ?? value;
}

export function paymentLabel(value) {
  return PAYMENTS[value] ?? value.replace(/\bKi\b/g, RU_LABELS.ki);
}

export function sourceLabel(sourceId) {
  return sourceId === "laserllama-core" ? RU_LABELS.core : RU_LABELS.expanded;
}

export function subchoiceLabel(id) {
  return SUBCHOICE_LABELS[id] ?? id;
}
