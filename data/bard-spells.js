function createBardSpell(spell) {
  return {
    originalName: null,
    classes: ["Бард"],
    source: "class",
    sourceLabel: "Бард",
    concentration: false,
    ritual: false,
    description: null,
    upcast: null,
    notes: null,

    // Базовые боевые поля (по умолчанию null)
    damage: null,
    healing: null,
    saveAbility: null,

    ...spell,
  };
}

export const BARD_SPELL_LIBRARY = [
  // КАНТРИПЫ (0 уровень)

  createBardSpell({
    id: "mage-hand",
    level: 0,
    name: "Волшебная рука",
    originalName: "Mage Hand",
    school: "Вызов",
    castingTime: "1 действие",
    range: "30 футов",
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10564-mage-hand",
    summary:
      "Призрачная рука выполняет простые манипуляции с лёгкими предметами на расстоянии.",
    notes:
      "Не может атаковать, активировать магические предметы и переносить тяжёлые объекты.",
  }),

  createBardSpell({
    id: "friends",
    level: 0,
    name: "Дружба",
    originalName: "Friends",
    school: "Очарование",
    castingTime: "1 действие",
    range: "На себя",
    components: "С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10523-friends",
    summary:
      "Даёт преимущество на проверки Харизмы против выбранного существа, которое не враждебно.",
    notes:
      "После окончания эффекта цель понимает, что на неё воздействовали магией, и может стать враждебной.",
  }),

  createBardSpell({
    id: "blade-ward",
    level: 0,
    name: "Защита от оружия",
    originalName: "Blade Ward",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10444-blade-ward",
    summary:
      "Даёт сопротивление дробящему, колющему и рубящему урону от оружия до начала вашего следующего хода.",
  }),

  createBardSpell({
    id: "starry-wisp",
    level: 0,
    name: "Звёздный светлячок",
    originalName: "Starry Wisp",
    school: "Вызов",
    castingTime: "1 действие",
    range: "60 футов",
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10654-starry-wisp",
    summary:
      "Создаёт маленький мерцающий светлячок, который освещает область и может перемещаться по команде.",
    notes:
      "Подходит для скрытного освещения или обозначения цели в темноте.",
  }),

  createBardSpell({
    id: "vicious-mockery",
    level: 0,
    name: "Злая насмешка",
    originalName: "Vicious Mockery",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10692-vicious-mockery",
    summary:
      "Наносит небольшой психический урон и накладывает помеху на следующий бросок атаки цели при провале спасброска.",
    notes:
      "Сильное заклинание для поддержки: мешает противнику попадать по союзникам.",

    damage: {
      dice: "1d4",
      modifier: null, // классический VM без модификатора
      type: "психический",
    },
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "minor-illusion",
    level: 0,
    name: "Малая иллюзия",
    originalName: "Minor Illusion",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "30 футов",
    components: "С, М",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10582-minor-illusion",
    summary:
      "Создаёт небольшой звук или статичный визуальный образ для отвлечения, маскировки или обмана.",
    notes:
      "Звук и образ не создаются одновременно; заклинание создаёт один тип иллюзии на выбор.",
  }),

  createBardSpell({
    id: "true-strike",
    level: 0,
    name: "Меткий удар",
    originalName: "True Strike",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "30 футов",
    components: "С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10688-true-strike",
    summary:
      "Даёт преимущество на одну атаку по выбранной цели, если вы атакуюте её до конца следующего хода.",
    notes:
      "Редко окупает затраченное действие в бою, но может быть полезен вне боя или с некоторыми особенностями класса.",
  }),

  createBardSpell({
    id: "dancing-lights",
    level: 0,
    name: "Пляшущие огоньки",
    originalName: "Dancing Lights",
    school: "Вызов",
    castingTime: "1 действие",
    range: "120 футов",
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10472-dancing-lights",
    summary:
      "Создаёт до четырёх движущихся огоньков, дающих тусклый свет и способных изменять расположение.",
    notes:
      "Огоньки можно объединять или перемещать, создавая визуальные эффекты и освещение.",
  }),

  createBardSpell({
    id: "mending",
    level: 0,
    name: "Починка",
    originalName: "Mending",
    school: "Преобразование",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10576-mending",
    summary:
      "Чинит небольшие повреждения объекта или соединяет разорванные части целого предмета.",
    notes:
      "Не восстанавливает магические свойства и не чинит крупные разрушения.",
  }),

  createBardSpell({
    id: "thunderclap",
    level: 0,
    name: "Раскат грома",
    originalName: "Thunderclap",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (радиус вокруг)",
    components: "С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10678-thunderclap",
    summary:
      "Создаёт громкий взрыв звука вокруг вас, который может повредить существам поблизости.",
    notes:
      "Заклинание громкое и легко выдаёт ваше местоположение.",

    damage: {
      dice: "1d6",
      modifier: null,
      type: "громовой",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "light",
    level: 0,
    name: "Свет",
    originalName: "Light",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10561-light",
    summary:
      "Освещает объект ярким светом в радиусе, заменяя факел или магический фонарь.",
    notes:
      "Если накладывается на объект в руках противника, тот может попытаться его спрятать или снять.",
  }),

  createBardSpell({
    id: "message",
    level: 0,
    name: "Сообщение",
    originalName: "Message",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10577-message",
    summary:
      "Отправляет короткое шепчущее сообщение выбранному существу, которое может ответить.",
    notes:
      "Работает через большинство препятствий, но не через плотный металл и аналогичные преграды.",
  }),

  createBardSpell({
    id: "prestidigitation",
    level: 0,
    name: "Фокусы",
    originalName: "Prestidigitation",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "10 футов",
    components: "В, С",
    duration: "До 1 часа",
    sourceUrl: "https://next.dnd.su/spells/10610-prestidigitation",
    summary:
      "Создаёт набор мелких утилитарных и сценических эффектов: чистка, вкус, искры и подобные трюки.",
    notes:
      "Удобно для ролевых сцен, быта и театральных выступлений, но не заменяет боевые заклинания.",
  }),

  // 1 УРОВЕНЬ

  createBardSpell({
    id: "silent-image",
    level: 1,
    name: "Безмолвный образ",
    originalName: "Silent Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10642-silent-image",
    summary:
      "Создаёт подвижную, но беззвучную иллюзию объекта или существа среднего размера.",
  }),

  createBardSpell({
    id: "thunderwave",
    level: 1,
    name: "Волна грома",
    originalName: "Thunderwave",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (куб 4,5 м)",
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10680-thunderwave",
    summary:
      "Вызываете ударную волну, наносящую громовой урон и отбрасывающую существ вокруг вас.",

    damage: {
      dice: "2d8",
      modifier: null,
      type: "громовой",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "heroism",
    level: 1,
    name: "Героизм",
    originalName: "Heroism",
    school: "Очарование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10222-heroism",
    summary:
      "Вселяет храбрость в цель, делая её невосприимчивой к испугу и давая временные хиты каждый ход.",
  }),

  createBardSpell({
    id: "dissonant-whispers",
    level: 1,
    name: "Диссонирующий шёпот",
    originalName: "Dissonant Whispers",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10483-dissonant-whispers",
    summary:
      "Наносит психический урон и может заставить цель немедленно отступить реакцией при провале спасброска.",

    damage: {
      dice: "3d6",
      modifier: null,
      type: "психический",
    },
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "animal-friendship",
    level: 1,
    name: "Дружба с животными",
    originalName: "Animal Friendship",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10264-animal-friendship",
    summary:
      "Убеждает зверя в том, что вы не представляете угрозы, делая его дружелюбным на время действия заклинания.",
  }),

  createBardSpell({
    id: "tashas-hideous-laughter",
    level: 1,
    name: "Жуткий смех Таши",
    originalName: "Tasha's Hideous Laughter",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10670-tashas-hideous-laughter",
    summary:
      "Повергает цель в неудержимый смех, лишая её дееспособности и сбивая с ног при провале спасброска.",
    notes:
      "Существа с очень низким Интеллектом могут быть невосприимчивы к эффекту.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "illusory-script",
    level: 1,
    name: "Иллюзорные письмена",
    originalName: "Illusory Script",
    school: "Иллюзия",
    castingTime: "1 минута",
    range: "Касание",
    components: "С, М",
    duration: "10 дней",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10550-illusory-script",
    summary:
      "Накладывает иллюзию на письменный текст, скрывая истинное содержание от всех, кроме выбранных вами читателей.",
  }),

  createBardSpell({
    id: "healing-word",
    level: 1,
    name: "Лечащее слово",
    originalName: "Healing Word",
    school: "Воплощение",
    castingTime: "1 бонусное действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "Мгновенная",
    classes: ["Бард", "Друид", "Жрец"],
    sourceUrl: "https://next.dnd.su/spells/10539-healing-word",
    summary:
      "Быстро лечит союзника на расстоянии; особенно полезно для поднятия из состояния 0 хитов.",

    healing: {
      dice: "1d4",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "cure-wounds",
    level: 1,
    name: "Лечение ран",
    originalName: "Cure Wounds",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "Мгновенная",
    classes: ["Бард", "Друид", "Жрец", "Паладин", "Следопыт"],
    sourceUrl: "https://next.dnd.su/spells/10270-cure-wounds",
    summary:
      "Лечит существо прикосновением, восстанавливая больше хитов, чем лечащее слово, но требуя действия и близости.",

    healing: {
      dice: "1d8",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "disguise-self",
    level: 1,
    name: "Маскировка",
    originalName: "Disguise Self",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10480-disguise-self",
    summary:
      "Меняет ваш внешний вид на иллюзорный: одежду, черты лица и телосложение в допустимых пределах.",
  }),

  createBardSpell({
    id: "unseen-servant",
    level: 1,
    name: "Невидимый слуга",
    originalName: "Unseen Servant",
    school: "Вызов",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10690-unseen-servant",
    summary:
      "Создаёт невидимую силу, которая выполняет простые бытовые задачи по вашей команде.",
  }),

  createBardSpell({
    id: "wardaway",
    level: 1,
    name: "Оберегающий разряд",
    originalName: "Wardaway",
    school: "Ограждение",
    castingTime: "1 реакция",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/12471-wardaway",
    summary:
      "Используется реакцией для ослабления удара или эффекта, направленного на союзника.",
    notes:
      "Новая защитная магия из 2024 изданий; детали эффекта уточняются по PH24.",
  }),

  createBardSpell({
    id: "detect-magic",
    level: 1,
    name: "Обнаружение магии",
    originalName: "Detect Magic",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя (радиус 9 м)",
    components: "В, С",
    duration: "До 10 минут",
    concentration: true,
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10274-detect-magic",
    summary:
      "Позволяет чувствовать присутствие магии и видеть её ауру вокруг предметов и существ.",
  }),

  createBardSpell({
    id: "faerie-fire",
    level: 1,
    name: "Огонь фей",
    originalName: "Faerie Fire",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10503-faerie-fire",
    summary:
      "Обводит существ и объекты светом, давая преимущество на атаки по ним и лишая скрытности.",

    saveAbility: "dexterity",
  }),

  createBardSpell({
    id: "identify",
    level: 1,
    name: "Опознание",
    originalName: "Identify",
    school: "Прорицание",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "Мгновенная",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10549-identify",
    summary:
      "Определяет магические свойства предмета или заклинания, наложенного на существо.",
  }),

  createBardSpell({
    id: "charm-person",
    level: 1,
    name: "Очарование личности",
    originalName: "Charm Person",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10456-charm-person",
    summary:
      "Пытается сделать humanoid-friendly к вам, облегчая социальные взаимодействия на время.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "feather-fall",
    level: 1,
    name: "Падение пёрышком",
    originalName: "Feather Fall",
    school: "Воплощение",
    castingTime: "1 реакция",
    range: "18 метров", // 60 футов
    components: "В, М",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10506-feather-fall",
    summary:
      "Замедляет падение нескольких существ, предотвращая повреждения от падения.",
  }),

  createBardSpell({
    id: "comprehend-languages",
    level: 1,
    name: "Понимание языков",
    originalName: "Comprehend Languages",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10200-comprehend-languages",
    summary:
      "Позволяет понимать значение устной и письменной речи на любом языке, но не расшифровывает шифры.",
  }),

  createBardSpell({
    id: "bane",
    level: 1,
    name: "Порча",
    originalName: "Bane",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10243-bane",
    summary:
      "Накладывает штраф на броски атаки и спасброски трём существам при провале их бросков.",

    saveAbility: "charisma",
  }),

  createBardSpell({
    id: "command",
    level: 1,
    name: "Приказ",
    originalName: "Command",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10196-command",
    summary:
      "Заставляет цель выполнить краткий однословный приказ при провале спасброска.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "speak-with-animals",
    level: 1,
    name: "Разговор с животными",
    originalName: "Speak with Animals",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "10 минут",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10246-speak-with-animals",
    summary:
      "Позволяет понимать и устно общаться с обычными животными, задавая вопросы о их восприятии и окружении.",
  }),

  createBardSpell({
    id: "color-spray",
    level: 1,
    name: "Сверкающие брызги",
    originalName: "Color Spray",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (конус)",
    components: "В, С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10465-color-spray",
    summary:
      "Выбрасывает конус ослепляющих цветных вспышек, временно ослепляя существ с низкими хитами.",
  }),

  createBardSpell({
    id: "longstrider",
    level: 1,
    name: "Скороход",
    originalName: "Longstrider",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10294-longstrider",
    summary:
      "Увеличивает скорость перемещения цели, улучшая мобильность в бою и путешествиях.",
  }),

  createBardSpell({
    id: "sleep",
    level: 1,
    name: "Усыпление",
    originalName: "Sleep",
    school: "Очарование",
    castingTime: "1 действие",
    range: "27 метров", // 90 футов
    components: "В, С, М",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10644-sleep",
    summary:
      "Погружает существ с низкими хитами в магический сон, начиная с самых ослабленных.",
  }),

  // 2 УРОВЕНЬ

  createBardSpell({
    id: "see-invisibility",
    level: 2,
    name: "Видение невидимого",
    originalName: "See Invisibility",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10632-see-invisibility",
    summary:
      "Позволяет видеть невидимых существ и объекты, а также частично замечать эффекты на эфирном плане.",
  }),

  createBardSpell({
    id: "suggestion",
    level: 2,
    name: "Внушение",
    originalName: "Suggestion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, М",
    duration: "До 8 часов",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10658-suggestion",
    summary:
      "Заставляет цель следовать разумному предложению, сформулированному в одной фразе.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "magic-mouth",
    level: 2,
    name: "Волшебные уста",
    originalName: "Magic Mouth",
    school: "Иллюзия",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "До активации",
    sourceUrl: "https://next.dnd.su/spells/10568-magic-mouth",
    summary:
      "Вкладывает в объект условное голосовое сообщение, которое срабатывает при заданном триггере.",
  }),

  createBardSpell({
    id: "phantasmal-force",
    level: 2,
    name: "Воображаемая сила",
    originalName: "Phantasmal Force",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10597-phantasmal-force",
    summary:
      "Создаёт для цели частично реальную иллюзию, наносящую ей урон, пока она верит в её существование.",

    damage: {
      dice: "1d6",
      modifier: null,
      type: "психический",
    },
    saveAbility: "intelligence",
  }),

  createBardSpell({
    id: "blindness-deafness",
    level: 2,
    name: "Глухота/слепота",
    originalName: "Blindness/Deafness",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10448-blindness-deafness",
    summary:
      "Лишает цель зрения или слуха при провале спасброска, осложняя ей бой и восприятие.",

    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "shatter",
    level: 2,
    name: "Дребезги",
    originalName: "Shatter",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10637-shatter",
    summary:
      "Выбрасывает зону звукового взрыва, наносящего урон существам и особенно сильно повреждающего предметы.",

    damage: {
      dice: "3d8",
      modifier: null,
      type: "громовой",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "crown-of-madness",
    level: 2,
    name: "Корона безумия",
    originalName: "Crown of Madness",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10470-crown-of-madness",
    summary:
      "Вселяет безумие в гуманоид, заставляя его атаковать ближайших существ по команде.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "lesser-restoration",
    level: 2,
    name: "Малое восстановление",
    originalName: "Lesser Restoration",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10289-lesser-restoration",
    summary:
      "Снимает одно состояние, такое как болезнь, отравление, паралич или ослепление.",
  }),

  createBardSpell({
    id: "heat-metal",
    level: 2,
    name: "Нагрев металла",
    originalName: "Heat Metal",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10540-heat-metal",
    summary:
      "Нагревает металлический объект, причиняя урон существу, которое его носит или держит.",

    damage: {
      dice: "2d8",
      modifier: null,
      type: "огонь",
    },
  }),

  createBardSpell({
    id: "invisibility",
    level: 2,
    name: "Невидимость",
    originalName: "Invisibility",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10555-invisibility",
    summary:
      "Делает цель невидимой до атаки или завершения действия, сильно повышая скрытность.",
  }),

  createBardSpell({
    id: "cloud-of-daggers",
    level: 2,
    name: "Облако кинжалов",
    originalName: "Cloud of Daggers",
    school: "Вызов",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10463-cloud-of-daggers",
    summary:
      "Создаёт куб вращающихся кинжалов, наносящих урон существам, входящим в область.",

    damage: {
      dice: "4d4",
      modifier: null,
      type: "рубящий",
    },
  }),

  createBardSpell({
    id: "zone-of-truth",
    level: 2,
    name: "Область истины",
    originalName: "Zone of Truth",
    school: "Зачарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "10 минут",
    sourceUrl: "https://next.dnd.su/spells/10240-zone-of-truth",
    summary:
      "Создаёт область, где существа испытывают трудности с ложью и вынуждены говорить правду.",

    saveAbility: "charisma",
  }),

  createBardSpell({
    id: "detect-thoughts",
    level: 2,
    name: "Обнаружение мыслей",
    originalName: "Detect Thoughts",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10479-detect-thoughts",
    summary:
      "Позволяет поверхностно читать мысли существ и при усилении углубляться в их сознание.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "mirror-image",
    level: 2,
    name: "Отражения",
    originalName: "Mirror Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10584-mirror-image",
    summary:
      "Создаёт несколько иллюзорных копий, затрудняющих попадание по вам атаками.",
  }),

  createBardSpell({
    id: "aid",
    level: 2,
    name: "Подмога",
    originalName: "Aid",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10242-aid",
    summary:
      "Увеличивает максимальное количество хитов и текущие хиты нескольких союзников.",
  }),

  createBardSpell({
    id: "locate-animals-or-plants",
    level: 2,
    name: "Поиск животных или растений",
    originalName: "Locate Animals or Plants",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "1 минута",
    sourceUrl:
      "https://next.dnd.su/spells/10291-locate-animals-or-plants",
    summary:
      "Определяет направление к ближайшим существам или растениям определённого вида.",
  }),

  createBardSpell({
    id: "locate-object",
    level: 2,
    name: "Поиск объекта",
    originalName: "Locate Object",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10293-locate-object",
    summary:
      "Чувствуете направление к конкретному известному объекту поблизости.",
  }),

  createBardSpell({
    id: "animal-messenger",
    level: 2,
    name: "Почтовое животное",
    originalName: "Animal Messenger",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10265-animal-messenger",
    summary:
      "Отправляет маленькое животное с устным сообщением к указанному получателю.",
  }),

  createBardSpell({
    id: "enthrall",
    level: 2,
    name: "Речь златоуста",
    originalName: "Enthrall",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10497-enthrall",
    summary:
      "Завораживает слушателей, затрудняя им замечание других существ и отвлекающих факторов.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "knock",
    level: 2,
    name: "Стук",
    originalName: "Knock",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10557-knock",
    summary:
      "Открывает запертые двери, сундуки и другие замки, часто сопровождаясь громким звуком.",
  }),

  createBardSpell({
    id: "silence",
    level: 2,
    name: "Тишина",
    originalName: "Silence",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С",
    duration: "10 минут",
    concentration: true,
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10300-silence",
    summary:
      "Создаёт область, где звук не распространяется, лишая возможности накладывать заклинания с вербальным компонентом.",
  }),

  createBardSpell({
    id: "enlarge-reduce",
    level: 2,
    name: "Увеличение/уменьшение",
    originalName: "Enlarge/Reduce",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10496-enlarge-reduce",
    summary:
      "Меняет размер цели, усиливая её урон и дальность или уменьшая её и усложняя попадания по ней.",

    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "hold-person",
    level: 2,
    name: "Удержание личности",
    originalName: "Hold Person",
    school: "Зачарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10254-hold-person",
    summary:
      "Парализует гуманоидов при провале спасброска, делая их беззащитными перед атаками.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "enhance-ability",
    level: 2,
    name: "Улучшение характеристики",
    originalName: "Enhance Ability",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10252-enhance-ability",
    summary:
      "Даёт существу преимущества в проверках одной характеристики и дополнительные эффекты.",
  }),

  createBardSpell({
    id: "calm-emotions",
    level: 2,
    name: "Умиротворение",
    originalName: "Calm Emotions",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10453-calm-emotions",
    summary:
      "Сглаживает сильные эмоции, ослабляя страх и враждебность в группе существ.",

    saveAbility: "charisma",
  }),

  // 3 УРОВЕНЬ

  createBardSpell({
    id: "hypnotic-pattern",
    level: 3,
    name: "Гипнотический узор",
    originalName: "Hypnotic Pattern",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10547-hypnotic-pattern",
    summary:
      "Создаёт завораживающий узор, который может лишить существ дееспособности при провале спасброска.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "slow",
    level: 3,
    name: "Замедление",
    originalName: "Slow",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10646-slow",
    summary:
      "Замедляет до шести существ, уменьшая их скорость, количество действий и усложняя спасброски.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "stinking-cloud",
    level: 3,
    name: "Зловонное облако",
    originalName: "Stinking Cloud",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10655-stinking-cloud",
    summary:
      "Создаёт облако отвратительного газа, вынуждающее существ тратить ходы на кашель и терять боевую эффективность.",

    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "mass-healing-word",
    level: 3,
    name: "Множественное лечащее слово",
    originalName: "Mass Healing Word",
    school: "Воплощение",
    castingTime: "1 бонусное действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10572-mass-healing-word",
    summary:
      "Мгновенно лечит несколько союзников в пределах дистанции небольшим количеством хитов.",

    healing: {
      dice: "1d4",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "bestow-curse",
    level: 3,
    name: "Наложение проклятия",
    originalName: "Bestow Curse",
    school: "Очарование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "1 минута или больше",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10441-bestow-curse",
    summary:
      "Накладывает проклятие на цель, выбирая один из нескольких эффектов штрафа.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "nondetection",
    level: 3,
    name: "Необнаружимость",
    originalName: "Nondetection",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10296-nondetection",
    summary:
      "Защищает цель от магических средств обнаружения и прорицания.",
  }),

  createBardSpell({
    id: "major-image",
    level: 3,
    name: "Образ",
    originalName: "Major Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10569-major-image",
    summary:
      "Создаёт крупную, детализированную иллюзию с визуальными и звуковыми эффектами.",
  }),

  createBardSpell({
    id: "glyph-of-warding",
    level: 3,
    name: "Охранная руна",
    originalName: "Glyph of Warding",
    school: "Ограждение",
    castingTime: "1 час",
    range: "Касание",
    components: "В, С, М",
    duration: "До активации",
    sourceUrl: "https://next.dnd.su/spells/10531-glyph-of-warding",
    summary:
      "Создаёт магический глиф, который срабатывает при заданном условии и вызывает эффект или взрыв.",
  }),

  createBardSpell({
    id: "clairvoyance",
    level: 3,
    name: "Подсматривание",
    originalName: "Clairvoyance",
    school: "Прорицание",
    castingTime: "10 минут",
    range: "1 миля",
    components: "В, С, М",
    duration: "10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10461-clairvoyance",
    summary:
      "Создаёт видящую или слышащую сенсорную точку в удалённом месте, позволяя наблюдать за происходящим там.",
  }),

  createBardSpell({
    id: "sending",
    level: 3,
    name: "Послание",
    originalName: "Sending",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "Неограниченная, если цель на том же плане",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10634-sending",
    summary:
      "Отправляет короткое магическое сообщение существу, которое может ответить.",
  }),

  createBardSpell({
    id: "feign-death",
    level: 3,
    name: "Притворная смерть",
    originalName: "Feign Death",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10507-feign-death",
    summary:
      "Погружает существо в заснулое состояние, выглядящее как смерть для поверхностного осмотра.",
  }),

  createBardSpell({
    id: "speak-with-dead",
    level: 3,
    name: "Разговор с мёртвыми",
    originalName: "Speak with Dead",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "10 минут",
    sourceUrl: "https://next.dnd.su/spells/10649-speak-with-dead",
    summary:
      "Позволяет задать ограниченное количество вопросов трупу, извлекая информацию из его прошлого опыта.",
  }),

  createBardSpell({
    id: "speak-with-plants",
    level: 3,
    name: "Разговор с растениями",
    originalName: "Speak with Plants",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "10 минут",
    sourceUrl: "https://next.dnd.su/spells/10301-speak-with-plants",
    summary:
      "Даёт возможность общаться с растениями и просить их о простой помощи.",
  }),

  createBardSpell({
    id: "dispel-magic",
    level: 3,
    name: "Рассеивание магии",
    originalName: "Dispel Magic",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10245-dispel-magic",
    summary:
      "Снимает магические эффекты и заклинания с целей или областей.",
  }),

  createBardSpell({
    id: "plant-growth",
    level: 3,
    name: "Рост растений",
    originalName: "Plant Growth",
    school: "Воплощение",
    castingTime: "1 действие или 8 часов",
    range: "45 метров", // 150 футов
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10247-plant-growth",
    summary:
      "Ускоряет рост растений, улучшая урожайность или создавая труднопроходимую местность.",
  }),

  createBardSpell({
    id: "fear",
    level: 3,
    name: "Ужас",
    originalName: "Fear",
    school: "Очарование",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10505-fear",
    summary:
      "Вселяет сильный страх в существ, заставляя их бросать предметы и бежать.",

    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "leomunds-tiny-hut",
    level: 3,
    name: "Хижина Леомунда",
    originalName: "Leomund's Tiny Hut",
    school: "Вызов",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "8 часов",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10559-leomunds-tiny-hut",
    summary:
      "Создаёт безопасный купол, защищающий от непогоды и внешних угроз во время отдыха.",
  }),

  createBardSpell({
    id: "cacophonic-shield",
    level: 3,
    name: "Щит какофонии",
    originalName: "Cacophonic Shield",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12446-cacophonic-shield",
    summary:
      "Оборачивает цель звуковым щитом, который может гасить некоторые эффекты и урон.",
    notes:
      "Новое заклинание из FRHoF; точные механики смотри в PH24/FRHoF.",
  }),

  createBardSpell({
    id: "tongues",
    level: 3,
    name: "Языки",
    originalName: "Tongues",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10683-tongues",
    summary:
      "Позволяет цели говорить и понимать любой язык, делая общение универсальным.",
  }),

  // 4 УРОВЕНЬ и выше — добавляются дальше
];