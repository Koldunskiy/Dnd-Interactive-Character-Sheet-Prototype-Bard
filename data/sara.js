import { SARA_LORE } from "./sara-lore.js";

export const sara = {
  schemaVersion: 1,
  profile: {
    id: "sara-velaris",
    name: "Ссаэйрра «Сара» Веларис",
    humanName: "Сара Веларис",
    race: "Юань-ти (Monsters of the Multiverse)",
    size: "Средний",
    alignment: "Хаотично-нейтральное",
    className: "Монах (Alternate Monk)",
    subclass: "Открытая ладонь",
    subclassId: "open-hand",
    background: "Преступник (шантажистка)",
    level: 12,
    rulesetId: "laserllama-alternate-monk-open-hand-snapshot-2026-10-29",
    proficiencyBonusOverride: null,
    summary: "Ссаэйрра, известная среди людей как Сара Веларис, — юань-ти и монах Открытой ладони.",
    media: null
  },
  ui: {
    abilitiesEditable: true,
    activeEffects: [],
    hpAdjustAmount: 1,
    turn: { actionUsed: false, bonusActionUsed: false, reactionUsed: false, turnNumber: 1 },
    spellLibrary: { selectedLevel: "all", selectionFilter: "all", expandedSpellIds: [] },
    spells: { expandedSpellIds: [] },
    melee: { expandedCardIds: [] },
    techniques: { searchQuery: "", source: "all", type: "all", filter: "all" }
  },
  abilities: { strength: 8, dexterity: 20, constitution: 14, intelligence: 8, wisdom: 18, charisma: 12 },
  raceDetails: {
    name: "Юань-ти",
    source: "Monsters of the Multiverse",
    size: "Средний",
    speedFeet: 30,
    speedMeters: 9,
    languages: [
      { name: "Общий", status: "подтверждено" },
      { name: "Драконий", status: "согласовать" }
    ],
    traits: [
      { name: "Магия змеиного народа", text: "См. отдельные расовые заклинания в разделе «Бой»." }
    ]
  },
  backgroundDetails: {
    name: "Преступник — шантажистка",
    source: "Player’s Handbook 2014",
    proficiencies: { skills: ["deception", "stealth"], tools: ["thieves-tools", "playing-cards"] }
  },
  savingThrows: {
    strength: { proficient: true },
    dexterity: { proficient: true },
    constitution: { proficient: false },
    intelligence: { proficient: false },
    wisdom: { proficient: false },
    charisma: { proficient: false }
  },
  combat: {
    hitDie: 10,
    speed: 9,
    speedFeet: 30,
    initiativeBonusExtra: 0,
    concentration: "",
    hp: { current: 124, temp: 0, maxOverride: null },
    armorBonusExtra: 0,
    shieldBonus: 0,
    proficiencies: { weapons: ["Simple weapons", "Shortswords"] },
    ki: { current: 16 },
    practiced: { current: 4 },
    hitDice: { total: 12, remaining: 12 },
    features: {
      features: ["Martial Arts", "Unarmored Defense", "Ki", "Techniques", "Flurry of Blows",
        "Unarmored Movement", "Extra Attack", "Enlightened Strikes", "Ebb & Flow",
        "Evasion", "Spirit of Tranquility", "Open Hand Strike", "Master of Many Forms",
        "Warrior’s Spirit", "Purity of Body", "Purity of Mind", "Timeless Body"]
    }
  },
  monk: {
    ordinaryTechniqueIds: [
      "ll-monk:crippling-strike",
      "ll-monk:deflect-strike",
      "ll-monk:step-of-the-wind",
      "ll-monk:slowing-strike",
      "ll-monk:deflect-missile",
      "ll-monk:mantle-of-courtesy",
      "ll-monk:mystic-regeneration"
    ],
    signatureTechniqueSlots: {
      "open-hand:3": "ll-monk:empowered-strike",
      "open-hand:5": "ll-monk:stunning-strike",
      "open-hand:9": "ll-monk:indomitable-spirit"
    },
    techniqueChoices: {},
    techniqueRuntime: {},
    replacementEvents: [],
    replacementEntitlements: [],
    ordinaryReplacementCredit: 0,
    processedLevel: 12,
    schemaVersion: 1,
    rulesetRevision: "snapshot-2026-10-29"
  },
  classFeatures: [
    { id: "martial-arts", name: "Боевые искусства", level: 1, text: "Безоружные удары и допустимое рукопашное оружие используют Ловкость и кость Боевых искусств при выполнении условий; дротики остаются дальнобойным оружием." },
    { id: "unarmored-defense", name: "Защита без доспехов", level: 1, text: "Без брони и щита КД = 10 + модификатор Ловкости + модификатор Мудрости." },
    { id: "ki", name: "Ци", level: 2, text: "Максимум ци равен уровню монаха + модификатору Мудрости; текущий ресурс меняется только явными операциями и отдыхом." },
    { id: "techniques", name: "Техники", level: 2, text: "Обычные и техники подкласса доступны по правилам листа." },
    { id: "flurry-of-blows", name: "Шквал ударов", level: 2, text: "Бонусным действием потратьте 1 ци, чтобы совершить два безоружных удара; предварительное действие «Атака» не требуется." },
    { id: "unarmored-movement", name: "Движение без доспехов", level: 2, text: "Бонус скорости действует только без брони и щита; на 12 уровне он равен 20 футам." },
    { id: "practiced", name: "Отработанные удары", level: 3, text: "Ограниченный ресурс для подходящих ударов после безоружного попадания в свой ход; восстановление при долгом отдыхе." },
    { id: "extra-attack", name: "Дополнительная атака", level: 5, text: "Совершите две атаки в рамках одного действия «Атака», а не два действия. После действия «Рывок» или «Отход» доступна бонусная атака Боевых искусств." },
    { id: "enlightened-strikes", name: "Просветлённые удары", level: 6, text: "Удары учитывают правила выбранного Alternate Monk ruleset." },
    { id: "ebb-and-flow", name: "Прилив и отлив", level: 6, text: "Реакция на видимый промах рукопашной атаки: ответный безоружный удар или спасбросок Ловкости цели; провал опрокидывает цель и снижает её скорость до 0 до конца её текущего хода." },
    { id: "evasion", name: "Увёртливость", level: 7, text: "Только при эффекте, позволяющем спасбросок Ловкости для половины урона: при успехе урона нет, при провале получает половину. Не действует на все спасброски Ловкости." },
    { id: "spirit-of-tranquility", name: "Дух спокойствия", level: 9, text: "При провале спасброска потратьте 1 ци, чтобы добавить модификатор Мудрости к результату; реакция не тратится. Результат и момент решения определяются игроком по правилам стола." },
    { id: "open-hand-strike", name: "Удар открытой ладони", level: 10, text: "При критическом попадании безоружной атакой цель совершает с помехой спасбросок, вызванный именно этой атакой." },
    { id: "master-of-many-forms", name: "Мастер многих форм", level: 10, text: "После 10 минут практики во время долгого отдыха можно заменить одну обычную технику; техники подкласса меняются только по согласованному правилу повышения уровня." },
    { id: "warriors-spirit", name: "Воинский дух", level: 11, text: "В начале своего хода в бою, если вы не недееспособны, вручную восстановите 1 ци, не выше максимума. Автоматического начисления и лечения вне боя нет." },
    { id: "purity-of-body", name: "Чистота тела", level: 13, text: "Будущая способность: иммунитет к болезням и состоянию «Отравлен», а также владение спасбросками Телосложения; не иммунитет к урону ядом." },
    { id: "purity-of-mind", name: "Чистота разума", level: 14, text: "Будущая способность: в начале хода при состоянии «Очарование» или «Испуг» можно вручную потратить 1 ци, чтобы прекратить эффект." },
    { id: "timeless-body", name: "Вневременное тело", level: 15, text: "Будущая способность: не нуждается в пище и воде; стареет на 1 год за 10 лет." },
    { id: "purity-spirit", name: "Чистота духа", level: 20, text: "Будущая способность: правила восстановления при коротком отдыхе, инициативе и начале хода; автоматического начисления нет." }
  ],
  spellcasting: {
    ability: "wisdom",
    racialSpells: [
      { id: "poison-spray-2014", mode: "cantrip", source: "racial", uses: null },
      { id: "animal-friendship-2014", mode: "at-will-racial", source: "racial", uses: null },
      { id: "suggestion-2014", mode: "limited-racial", source: "racial", uses: { current: 1, max: 1, refresh: "Долгий отдых" } }
    ],
    slotsUsed: {},
    notes: "Расовые заклинания Yuan-ti MotM; тексты и применение по правилам 2014 года."
  },
  skills: [
    { id: "athletics", proficient: false, expertise: false, source: null },
    { id: "acrobatics", proficient: true, expertise: false, source: "class" },
    { id: "sleightOfHand", proficient: false, expertise: false, source: null },
    { id: "stealth", proficient: true, expertise: false, source: "background" },
    { id: "arcana", proficient: false, expertise: false, source: null },
    { id: "history", proficient: false, expertise: false, source: null },
    { id: "investigation", proficient: false, expertise: false, source: null },
    { id: "nature", proficient: false, expertise: false, source: null },
    { id: "religion", proficient: false, expertise: false, source: null },
    { id: "animalHandling", proficient: false, expertise: false, source: null },
    { id: "insight", proficient: true, expertise: false, source: "class" },
    { id: "medicine", proficient: false, expertise: false, source: null },
    { id: "perception", proficient: false, expertise: false, source: null },
    { id: "survival", proficient: false, expertise: false, source: null },
    { id: "deception", proficient: true, expertise: false, source: "background" },
    { id: "intimidation", proficient: false, expertise: false, source: null },
    { id: "performance", proficient: false, expertise: false, source: null },
    { id: "persuasion", proficient: false, expertise: false, source: null }
  ],
  proficiencies: {
    tools: ["thieves-tools", "playing-cards", "calligraphers-supplies"],
    languages: [
      { name: "Общий", status: "подтверждено" },
      { name: "Драконий", status: "согласовать" }
    ]
  },
  inventory: {
    items: [{
      id: "amulet-of-health",
      type: "misc",
      name: "Амулет здоровья",
      quantity: 1,
      equipped: true,
      attuned: true,
      notes: "Эффективное Телосложение равно 19, если базовое значение ниже 19.",
      tags: ["магическое", "требует настройки"],
      weapon: null,
      armor: null
    }, {
      id: "insignia-of-claws",
      type: "misc",
      name: "Эмблема когтей",
      quantity: 1,
      equipped: true,
      requiresAttunement: false,
      rarity: "uncommon",
      description: "При ношении даёт +1 к броскам попадания и урона безоружных атак и природного оружия; эти атаки считаются магическими. Не повышает СЛ техник, КД, лечение, снижение урона или характеристики оружейных атак.",
      appearance: "Брошь дома Веларис: овальный бронзовый щит со змеёй вокруг сливового аметиста, графитовой эмалью и потёртыми краями.",
      notes: "",
      tags: ["магическое"],
      weapon: null,
      armor: null
    }],
    currency: null,
    currencyStatus: "Не заполнено",
    otherItemsStatus: "Не заполнено",
    notes: ""
  },
  lore: {
    noteEntries: [],
    notesMigrationVersion: 1,
    biography: SARA_LORE
  }
};
