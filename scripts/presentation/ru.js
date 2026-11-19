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
  poisoned: "Отравлен",
  afterRoll: "После броска",
  onMiss: "При промахе"
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
  "Hypnotic Pattern": "Гипнотический узор",
  Guidance: "Указание",
  Light: "Свет",
  Mending: "Починка",
  Resistance: "Сопротивление",
  "Sacred Flame": "Священное пламя",
  "Spare the Dying": "Уход за умирающим",
  Thaumaturgy: "Чудотворство",
  "Toll the Dead": "Погребальный звон",
  "Word of Radiance": "Слово сияния",
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
  passive: RU_LABELS.passive,
  "after-roll": RU_LABELS.afterRoll,
  "on-miss": RU_LABELS.onMiss
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
  "ll-style:blind-warrior": "Слепой воин",
  "ll-style:balanced-fighting": "Сбалансированный бой",
  "ll-style:featherweight-fighting": "Лёгкий бой",
  "ll-style:hurler": "Метатель",
  "ll-style:versatile-fighting": "Универсальный бой",
  "ll-style:polearm-fighting": "Бой древковым оружием"
});

const FIGHTING_STYLE_PRESENTATION = Object.freeze({
  "ll-style:archery": {
    prerequisites: ["Ловкость 13"],
    text: "+1 к дальнобойным атакам оружием; игнорируйте укрытие наполовину, а укрытие на три четверти считайте укрытием наполовину."
  },
  "ll-style:blind-warrior": {
    prerequisites: ["Владение Восприятием"],
    text: "Владение Восприятием; слепое зрение на расстоянии 5 × бонус мастерства футов с учётом полного укрытия и скрытности."
  },
  "ll-style:balanced-fighting": {
    prerequisites: [],
    text: "+2 к урону оружием ближнего боя в одной руке и без другого оружия; щит разрешён, безоружные удары бонуса не получают."
  },
  "ll-style:featherweight-fighting": {
    prerequisites: ["Ловкость 13", "Акробатика"],
    text: "Без доспехов или в лёгком доспехе: при безоружных атаках или с одним лёгким оружием скорость увеличивается на 10 футов; лёгкое оружие ближнего боя и безоружные атаки наносят на 1 урон больше."
  },
  "ll-style:hurler": {
    prerequisites: ["Сила 11 или Ловкость 11"],
    text: "Извлекайте метательное оружие как часть атаки и удваивайте дальность его броска. Если вы держите только метательное оружие, можете совершить бонусную дальнобойную атаку метательным оружием."
  },
  "ll-style:polearm-fighting": {
    prerequisites: ["Сила 11", "Ловкость 11"],
    text: "Только с глефой, алебардой, пикой, боевым посохом или копьём и без щита: +1 к урону; провоцируйте атаку, когда существо входит в вашу досягаемость или перемещается внутри неё."
  },
  "ll-style:versatile-fighting": {
    prerequisites: ["Сила 11 или Ловкость 11"],
    text: "С одним универсальным оружием и без щита получайте +1 к атаке; бонусным действием можете схватить, толкнуть или взаимодействовать с предметом."
  }
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

export function fightingStylePresentation(style) {
  const presentation = FIGHTING_STYLE_PRESENTATION[style.id];
  return {
    title: subchoiceLabel(style.id),
    prerequisites: presentation?.prerequisites ?? style.prerequisites,
    text: presentation?.text ?? style.text
  };
}
