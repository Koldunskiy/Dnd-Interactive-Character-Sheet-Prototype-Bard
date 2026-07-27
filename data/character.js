export const character = {
  profile: {
    id: "aurelia",
    name: "Аурелия",
    race: "Тифлинг",
    subrace: "Гласия",
    lineage: "Наследие Малболга",
    className: "Бард",
    subclass: "Коллегия Мечей",
    background: "Артист",
    alignment: "Нейтрально-злая",
    level: 3,
    proficiencyBonusOverride: null,
    summary:
      "Тифлинг-бард Коллегии Мечей, выросшая в тени Ордена Кровавой Каденции и превращающая сценичность, дуэльную выучку и психическую магию в оружие влияния.",
    media: {
      type: "video",
      src: "./assets/portrait.mp4",
      poster: "./assets/portrait.png",
      alt: "Анимированный портрет Аурелии"
    }
  },

  ui: {
    abilitiesEditable: false,
    activeEffects: [],
    hpAdjustAmount: 1,
    turn: {
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      turnNumber: 1
    },
    spellLibrary: {
      selectedLevel: "all",
      selectionFilter: "all",
      expandedSpellIds: []
    },
    spells: {
      expandedSpellIds: [],
    },
    melee: {
      expandedCardIds: [],
    },
  },

  abilities: {
    strength: 8,
    dexterity: 16,
    constitution: 13,
    intelligence: 10,
    wisdom: 10,
    charisma: 17
  },

  raceDetails: {
    name: "Тифлинг",
    subrace: "Гласия",
    lineage: "Наследие Малболга",
    source: "Mordenkainen’s Tome of Foes",
    size: "Средний",
    speedFeet: 30,
    speedMeters: 9,
    languages: ["Общий", "Инфернальный"],
    abilityScoreIncrease: {
      charisma: 2,
      dexterity: 1
    },
    darkvision: {
      rangeFeet: 60,
      rangeMeters: 18,
      notes:
        "Видит при тусклом свете как при ярком, а в темноте как при тусклом; в темноте различает только оттенки серого."
    },
    resistances: ["огонь"],
    traits: [
      {
        name: "Тёмное зрение",
        text:
          "Благодаря дьявольскому наследию Аурелия отлично видит в темноте на расстоянии до 60 футов."
      },
      {
        name: "Адское сопротивление",
        text: "Аурелия получает сопротивление урону огнём."
      },
      {
        name: "Наследие Малболга",
        text:
          "Гласия дарует магию, полезную для маскировки, обмана и исчезновения: малая иллюзия, маскировка и в будущем — невидимость."
      },
      {
        name: "Социальная стигма",
        text:
          "Аурелия привыкла к настороженным взглядам, слухам и недоверию. Она отвечает на них обаянием, угрозой и сценическим самообладанием."
      }
    ]
  },

  backgroundDetails: {
    name: "Артист",
    source: "Player’s Handbook",
    feature: {
      name: "По многочисленным просьбам",
      text:
        "Аурелия всегда может найти место для выступления — обычно в таверне, постоялом дворе, театре или даже при дворе знатного господина. Если она выступает по вечерам, ей обеспечены еда и постой, а в городах, где она уже выступала, её могут узнавать и относиться к ней лучше."
    },
    proficiencies: {
      skills: ["Акробатика", "Выступление"],
      tools: ["Набор для грима", "Музыкальный инструмент"]
    },
    equipment: [
      "Музыкальный инструмент",
      "Подарок от поклонницы",
      "Костюм",
      "Поясной кошель с 15 зм"
    ],
    persona: {
      routine: ["Танцор", "Музыкант", "Поэт"],
      trait:
        "Для любой ситуации она найдёт подходящую историю или реплику, а её настроение меняется так же быстро, как ноты в музыке.",
      ideal: "Творчество. Миру нужны новые идеи и смелые действия.",
      bond:
        "Сцена и искусство — не просто ремесло, а форма власти над вниманием и эмоциями окружающих.",
      flaw:
        "Острый язык и тяга к эффектным жестам регулярно втягивают её в лишние неприятности."
    }
  },

  savingThrows: {
    strength: { proficient: false },
    dexterity: { proficient: true },
    constitution: { proficient: false },
    intelligence: { proficient: false },
    wisdom: { proficient: false },
    charisma: { proficient: true }
  },

  combat: {
    armorBase: 12,
    armorName: "Клёпаная кожаная броня",
    hitDie: 8,
    speed: 9,
    speedFeet: 30,
    initiativeBonusExtra: 0,
    concentration: "",

    hp: {
      current: 21,
      temp: 0,
      maxOverride: null
    },

    weapons: [
      {
        id: "rapier",
        name: "Рапира",
        attackStat: "dexterity",
        damageDice: "1d8",
        damageType: "колющий",
        properties: ["Фехтовальное", "Одноручное"],
        notes: "Основное оружие дуэлянта; стиль боя «Дуэлянт» усиливает урон."
      },
      {
        id: "dagger",
        name: "Кинжал",
        attackStat: "dexterity",
        damageDice: "1d4",
        damageType: "колющий",
        properties: ["Фехтовальное", "Лёгкое", "Метательное (20/60)"],
        notes: "Запасное и метательное оружие; урон использует модификатор Ловкости."
      },
    ],

    fightingStyle: {
      name: "Дуэлянт",
      damageBonus: 2,
      notes:
        "Пока Аурелия держит оружие ближнего боя в одной руке и не использует второго оружия, она получает +2 к броскам урона этим оружием."
    },

    proficiencies: {
      armor: ["Лёгкие доспехи", "Средние доспехи"],
      weapons: [
        "Простое оружие",
        "Длинные мечи",
        "Короткие мечи",
        "Рапиры",
        "Ручные арбалеты",
        "Скимитары"
      ],
      tools: [
        "Три музыкальных инструмента",
        "Набор для грима"
      ]
    },

    flourishes: [
      {
        name: "Оборонительный росчерк",
        cost: "1 использование Бардского вдохновения",
        text:
          "После попадания добавляет куб вдохновения к урону и повышает КД на выпавшее значение до начала следующего хода."
      },
      {
        name: "Режущий росчерк",
        cost: "1 использование Бардского вдохновения",
        text:
          "После попадания добавляет куб вдохновения к урону цели и наносит такой же дополнительный урон другому существу в пределах 5 футов."
      },
      {
        name: "Мобильный росчерк",
        cost: "1 использование Бардского вдохновения",
        text:
          "После попадания добавляет куб вдохновения к урону, отталкивает цель и позволяет сместиться вслед за ней реакцией."
      }
    ],

    bardicInspiration: {
      current: 3,
      refresh: "Долгий отдых",
      rangeFeet: 60,
      rangeMeters: 18,
      duration: "10 минут",
      notes: "Используется для вдохновения союзников и для Росчерков клинка."
    }
  },

  classFeatures: [
    {
      level: 1,
      category: "Класс",
      name: "Использование заклинаний",
      text:
        "Аурелия использует Харизму как базовую характеристику заклинаний барда. Сл спасброска = 8 + бонус мастерства + модификатор Харизмы, модификатор атаки заклинаниями = бонус мастерства + модификатор Харизмы."
    },
    {
      level: 1,
      category: "Класс",
      name: "Вдохновение барда",
      text:
        "Бонусным действием даёт союзнику в пределах 60 футов кость вдохновения 1d6, которую можно добавить к проверке характеристики, броску атаки или спасброску."
    },
    {
      level: 2,
      category: "Класс",
      name: "Мастер на все руки",
      text:
        "Добавляет половину бонуса мастерства, округлённую вниз, ко всем проверкам характеристики, где бонус мастерства ещё не применяется."
    },
    {
      level: 2,
      category: "Класс",
      name: "Песнь отдыха",
      text:
        "Во время короткого отдыха Аурелия помогает союзникам восстановить дополнительно 1d6 хитов, если они тратят Кости Хитов и слышат её исполнение."
    },
    {
      level: 3,
      category: "Класс",
      name: "Компетентность",
      text:
        "Бонус мастерства удваивается для двух выбранных навыков. Для Аурелии логично использовать Выступление и Обман или Запугивание."
    },
    {
      level: 3,
      category: "Подкласс",
      name: "Коллегия Мечей",
      text:
        "Аурелия сочетает сценическое мастерство с фехтованием, превращая бой в перформанс и используя клинок как продолжение своей харизмы."
    },
    {
      level: 3,
      category: "Подкласс",
      name: "Дополнительные владения",
      text:
        "Получает владение средними доспехами и скимитарами; если владеет простым или воинским оружием ближнего боя, может использовать его как фокусировку для заклинаний барда."
    },
    {
      level: 3,
      category: "Подкласс",
      name: "Боевой стиль: Дуэлянт",
      text:
        "Пока она сражается оружием ближнего боя в одной руке и без второго оружия, получает +2 к урону."
    },
    {
      level: 3,
      category: "Подкласс",
      name: "Росчерк клинка",
      text:
        "Когда Аурелия совершает действие Атака, её скорость увеличивается на 10 футов до конца хода, а при попадании она может потратить Бардское вдохновение на Оборонительный, Режущий или Мобильный росчерк."
    }
  ],

  spellcasting: {
    ability: "charisma",
    spellAttackBonusOverride: null,
    spellSaveDcOverride: null,
    ritualCasting: true,
    focus: "Музыкальный инструмент или оружие ближнего боя, подходящее как фокусировка Коллегии Мечей",

    slotsUsed: {
      1: 0,
      2: 0
    },

    notes:
      "Модель ориентирована на Bard 2024: заговоры выбираются отдельно, заклинания 1+ круга готовятся из библиотеки.",

    cantripIds: [
      "dancing-lights",
      "vicious-mockery",
      "minor-illusion"
    ],

    preparedSpellIds: [
      "tashas-hideous-laughter",
      "dissonant-whispers",
      "cure-wounds",
      "healing-word",
      "speak-with-animals",
      "mirror-image"
    ],

    grantedSpellIds: [
      "minor-illusion",
      "disguise-self"
    ],

    spellOverrides: {
      "minor-illusion": {
        source: "racial",
        sourceLabel: "Расовое",
        notes: "Получено через наследие Малболга (Гласия). Базовая характеристика — Харизма."
      },
      "disguise-self": {
        source: "racial",
        sourceLabel: "Расовое",
        availableFromLevel: 3,
        uses: {
          max: 1,
          current: 1,
          refresh: "Долгий отдых"
        }
      }
    }
  },

  skills: [
    {
      id: "athletics",
      name: "Атлетика",
      ability: "strength",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "acrobatics",
      name: "Акробатика",
      ability: "dexterity",
      proficient: true,
      expertise: false,
      source: "background"
    },
    {
      id: "sleightOfHand",
      name: "Ловкость рук",
      ability: "dexterity",
      proficient: true,
      expertise: false,
      source: "class"
    },
    {
      id: "stealth",
      name: "Скрытность",
      ability: "dexterity",
      proficient: true,
      expertise: false,
      source: "class"
    },
    {
      id: "arcana",
      name: "Магия",
      ability: "intelligence",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "history",
      name: "История",
      ability: "intelligence",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "investigation",
      name: "Расследование",
      ability: "intelligence",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "nature",
      name: "Природа",
      ability: "intelligence",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "religion",
      name: "Религия",
      ability: "intelligence",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "animalHandling",
      name: "Уход за животными",
      ability: "wisdom",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "insight",
      name: "Проницательность",
      ability: "wisdom",
      proficient: true,
      expertise: false,
      source: "class"
    },
    {
      id: "medicine",
      name: "Медицина",
      ability: "wisdom",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "perception",
      name: "Восприятие",
      ability: "wisdom",
      proficient: true,
      expertise: false,
      source: "class"
    },
    {
      id: "survival",
      name: "Выживание",
      ability: "wisdom",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "deception",
      name: "Обман",
      ability: "charisma",
      proficient: true,
      expertise: false,
      source: "class"
    },
    {
      id: "intimidation",
      name: "Запугивание",
      ability: "charisma",
      proficient: false,
      expertise: false,
      source: null
    },
    {
      id: "performance",
      name: "Выступление",
      ability: "charisma",
      proficient: true,
      expertise: false,
      source: "background"
    },
    {
      id: "persuasion",
      name: "Убеждение",
      ability: "charisma",
      proficient: true,
      expertise: false,
      source: "class"
    }
  ],

  inventory: {
    items: [
      {
        id: "rapier",
        name: "Рапира",
        quantity: 1,
        equipped: true,
        notes: "Основное оружие"
      },
      {
        id: "dagger",
        name: "Кинжал",
        quantity: 1,
        equipped: false,
        notes: "Запасное и метательное оружие"
      },
      {
        id: "studded-leather",
        name: "Клёпаная кожаная броня",
        quantity: 1,
        equipped: true,
        notes: "Основной доспех"
      },
      {
        id: "costume",
        name: "Костюм артиста",
        quantity: 1,
        equipped: false,
        notes: "Сценический образ"
      },
      {
        id: "makeup-kit",
        name: "Набор для грима",
        quantity: 1,
        equipped: false,
        notes: "Инструмент предыстории"
      },
      {
        id: "instrument",
        name: "Музыкальный инструмент",
        quantity: 1,
        equipped: false,
        notes: "Фокусировка заклинаний и часть образа"
      },
      {
        id: "fan-gift",
        name: "Подарок от поклонницы",
        quantity: 1,
        equipped: false,
        notes: "Личная безделушка из прошлого"
      }
    ],
    currency: {
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 25,
      pp: 0
    },
    notes:
      "Монеты включают стартовые средства и имущество, оставшееся после базового снаряжения и личных вещей Аурелии."
  },

  lore: {
    appearance:
      "Аурелия носит красную культистскую блузку, чёрную орденскую кожаную броню и держится как уверенная дуэлянтка с театральной пластикой. Её тифлингская природа проявляется в рогах, хвосте, резких чертах и пугающе выразительном взгляде.",
    order:
      "Орден Кровавой Каденции воспитал её как инструмент дисциплины и устрашения, скрывая за ритуалами жажду власти и лицемерие верхушки.",
    motivation:
      "Её цель — обратить знания Ордена против по-настоящему опасных сил, а затем решить, должен ли сам Орден быть уничтожен, подчинён или очищен изнутри.",
    personality:
      "Сдержанная, острая на язык, обаятельная и опасная; умеет звучать как спасение и как угроза одновременно.",
    racePerspective:
      "Быть тифлингом для Аурелии значит постоянно чувствовать чужой страх, недоверие и перешёптывания. Она давно научилась использовать это напряжение как часть своего образа.",
    performerIdentity:
      "Как артистка, она знает цену вниманию публики, умеет завораживать людей речью, музыкой и движением и превращает любое появление в сцену."
  }
};