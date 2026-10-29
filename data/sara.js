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
      "ll-monk:heavenly-step",
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
    { id: "martial-arts", name: "Martial Arts", level: 1, text: "Безоружные удары и допустимое melee-оружие используют DEX и кость Martial Arts при выполнении условий; darts остаются ranged." },
    { id: "unarmored-defense", name: "Unarmored Defense", level: 1, text: "Без брони и щита КД = 10 + DEX + WIS." },
    { id: "ki", name: "Ki", level: 2, text: "Максимум ци = уровень монаха + модификатор Мудрости; текущий ресурс меняется только явными операциями и отдыхом." },
    { id: "techniques", name: "Techniques", level: 2, text: "Обычные и signature-техники доступны по правилам листа." },
    { id: "flurry-of-blows", name: "Flurry of Blows", level: 2, text: "После применения можно совершить безоружные удары бонусным действием за установленную стоимость ци." },
    { id: "unarmored-movement", name: "Unarmored Movement", level: 2, text: "Бонус скорости действует только без брони и щита." },
    { id: "practiced", name: "Practiced", level: 3, text: "Ограниченный ресурс с подтверждением собственного хода и безоружного попадания; восстановление при долгом отдыхе." },
    { id: "extra-attack", name: "Extra Attack", level: 5, text: "Две атаки действием Attack; после Dash/Disengage действием доступна бонусная Martial-атака." },
    { id: "enlightened-strikes", name: "Enlightened Strikes", level: 6, text: "Удары учитывают правила выбранного Alternate Monk ruleset." },
    { id: "ebb-and-flow", name: "Ebb & Flow", level: 6, text: "Реакция на видимый melee-промах: безоружный ответ или ручной спасбросок Ловкости цели." },
    { id: "evasion", name: "Evasion", level: 7, text: "Результат спасброска и урон области определяются вручную." },
    { id: "spirit-of-tranquility", name: "Spirit of Tranquility", level: 9, text: "Явная трата 1 Ki даёт минимум 1 или модификатор WIS к спасброску без реакции." },
    { id: "open-hand-strike", name: "Open Hand Strike", level: 10, text: "Условия и последствия применяются вручную к соответствующей атаке." },
    { id: "master-of-many-forms", name: "Master of Many Forms", level: 10, text: "Правила формы остаются ручными; без автоматической симуляции." },
    { id: "warriors-spirit", name: "Warrior’s Spirit", level: 11, text: "Только подсказка о ручном восстановлении 1 Ki в начале своего хода в бою, если не Incapacitated." },
    { id: "purity-of-body", name: "Purity of Body", level: 13, text: "Иммунитет к болезням и состоянию Poisoned, владение спасбросками Телосложения; не иммунитет к урону ядом." },
    { id: "purity-of-mind", name: "Purity of Mind", level: 14, text: "В начале хода при Charmed или Frightened можно вручную потратить 1 Ki, чтобы прекратить эффект." },
    { id: "timeless-body", name: "Timeless Body", level: 15, text: "Не нуждается в пище и воде; стареет на 1 год за 10 лет." },
    { id: "purity-spirit", name: "Purity Spirit", level: 20, text: "Напоминания о восстановлении на коротком отдыхе/инициативе/ходе; автоматических начислений нет." }
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
