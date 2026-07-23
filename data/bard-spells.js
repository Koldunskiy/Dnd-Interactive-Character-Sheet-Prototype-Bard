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

  // 4 УРОВЕНЬ

  createBardSpell({
    id: "phantasmal-killer",
    level: 4,
    name: "Воображаемый убийца",
    originalName: "Phantasmal Killer",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10598-phantasmal-killer",
    summary:
      "Создаёт кошмарный образ, преследующий цель и наносящий психический урон.",
  }),

  createBardSpell({
    id: "greater-invisibility",
    level: 4,
    name: "Высшая невидимость",
    originalName: "Greater Invisibility",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10533-greater-invisibility",
    summary:
      "Делает цель невидимой даже при атаке и использовании заклинаний, позволяя действовать незаметно.",
  }),

  createBardSpell({
    id: "fount-of-moonlight",
    level: 4,
    name: "Источник лунного света",
    originalName: "Fount of Moonlight",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10522-fount-of-moonlight",
    summary:
      "Создаёт магический лунный свет, который может усиливать или ослаблять существа и эффекты.",
  }),

  createBardSpell({
    id: "hallucinatory-terrain",
    level: 4,
    name: "Мираж",
    originalName: "Hallucinatory Terrain",
    school: "Иллюзия",
    castingTime: "10 минут",
    range: "90 метров", // 300 футов
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10536-hallucinatory-terrain",
    summary:
      "Меняет внешний вид местности, скрывая её настоящую природу иллюзией.",
  }),

  createBardSpell({
    id: "backlash",
    level: 4,
    name: "Ответный урон",
    originalName: "Backlash",
    school: "Ограждение",
    castingTime: "1 реакция",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/12444-backlash",
    summary:
      "Используется реакцией, чтобы отразить часть урона или эффекта обратно нападающему.",
  }),

  createBardSpell({
    id: "charm-monster",
    level: 4,
    name: "Очарование монстра",
    originalName: "Charm Monster",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10455-charm-monster",
    summary:
      "Очаровывает любое существо, а не только гуманоидов, делая его дружелюбным к вам.",
  }),

  createBardSpell({
    id: "dimension-door",
    level: 4,
    name: "Переносящая дверь",
    originalName: "Dimension Door",
    school: "Вызов",
    castingTime: "1 действие",
    range: "152 метров", // примерно 500 футов в 2014, уточнить PH24
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10244-dimension-door",
    summary:
      "Телепортирует вас и ещё одного существа на известное вам место в пределах дистанции.",
  }),

  createBardSpell({
    id: "doomtide",
    level: 4,
    name: "Погибель",
    originalName: "Doomtide",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12451-doomtide",
    summary:
      "Выпускает волну мрачной энергии, ослабляющей и повреждающей существ в области.",
  }),

  createBardSpell({
    id: "locate-creature",
    level: 4,
    name: "Поиск существа",
    originalName: "Locate Creature",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "1 час",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10292-locate-creature",
    summary:
      "Чувствуете направление к ближайшему существу определённого типа или знакомой вам личности.",
  }),

  createBardSpell({
    id: "polymorph",
    level: 4,
    name: "Превращение",
    originalName: "Polymorph",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "1 час",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10604-polymorph",
    summary:
      "Меняет существо в другое существо того же КР или ниже, полностью изменяя его физические характеристики.",
  }),

  createBardSpell({
    id: "compulsion",
    level: 4,
    name: "Принуждение",
    originalName: "Compulsion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10201-compulsion",
    summary:
      "Заставляет существ двигаться в выбранном вами направлении при провале спасброска.",
  }),

  createBardSpell({
    id: "freedom-of-movement",
    level: 4,
    name: "Свобода перемещения",
    originalName: "Freedom of Movement",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10249-freedom-of-movement",
    summary:
      "Позволяет цели свободно двигаться, игнорируя многие эффекты, замедляющие или ограничивающие движение.",
  }),

  createBardSpell({
    id: "confusion",
    level: 4,
    name: "Смятение",
    originalName: "Confusion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "27 метров", // 90 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10203-confusion",
    summary:
      "Сбивает существ с толку, заставляя их действовать непредсказуемо каждый ход.",
  }),

  // 5 УРОВЕНЬ

  createBardSpell({
    id: "raise-dead",
    level: 5,
    name: "Возвращение к жизни",
    originalName: "Raise Dead",
    school: "Некромантия",
    castingTime: "1 час",
    range: "Касание",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10617-raise-dead",
    summary:
      "Возвращает умершее существо к жизни с штрафами и ограничениями.",
  }),

  createBardSpell({
    id: "greater-restoration",
    level: 5,
    name: "Высшее восстановление",
    originalName: "Greater Restoration",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10212-greater-restoration",
    summary:
      "Снимает серьёзные магические эффекты, такие как ослабление характеристик и проклятия.",
  }),

  createBardSpell({
    id: "geas",
    level: 5,
    name: "Гейс",
    originalName: "Geas",
    school: "Очарование",
    castingTime: "1 минута",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "30 дней",
    sourceUrl: "https://next.dnd.su/spells/10526-geas",
    summary:
      "Накладывает долгосрочное магическое обязательство на существо, причиняя ему урон, если оно нарушает приказ.",
  }),

  createBardSpell({
    id: "dream",
    level: 5,
    name: "Грёзы",
    originalName: "Dream",
    school: "Иллюзия",
    castingTime: "1 минута",
    range: "Особая",
    components: "В, С, М",
    duration: "Специальная",
    sourceUrl: "https://next.dnd.su/spells/10491-dream",
    summary:
      "Входит в сны существа, общаясь с ним и потенциально причиняя психический урон.",
  }),

  createBardSpell({
    id: "legend-lore",
    level: 5,
    name: "Знание легенд",
    originalName: "Legend Lore",
    school: "Прорицание",
    castingTime: "10 минут",
    range: "На себя",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10228-legend-lore",
    summary:
      "Вы узнаёте легендарную информацию о персоне, месте или объекте.",
  }),

  createBardSpell({
    id: "modify-memory",
    level: 5,
    name: "Изменение памяти",
    originalName: "Modify Memory",
    school: "Очарование",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10586-modify-memory",
    summary:
      "Переписывает воспоминания существа о выбранном промежутке времени при провале спасброска.",
  }),

  createBardSpell({
    id: "teleportation-circle",
    level: 5,
    name: "Круг телепортации",
    originalName: "Teleportation Circle",
    school: "Вызов",
    castingTime: "1 минута",
    range: "10 футов",
    components: "В, С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10674-teleportation-circle",
    summary:
      "Создаёт кратковременный портал между двумя заранее подготовленными кругами.",
  }),

  createBardSpell({
    id: "alustriels-mooncloak",
    level: 5,
    name: "Лунный покров Алустриэли",
    originalName: "Alustriel's Mooncloak",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12443-alustriels-mooncloak",
    summary:
      "Оберегает цель лунным покровом, давая ей защитные и утилитарные преимущества.",
  }),

  createBardSpell({
    id: "rarys-telepathic-bond",
    level: 5,
    name: "Ментальная связь Рэри",
    originalName: "Rary's Telepathic Bond",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "9 метров", // 30 футов
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10618-rarys-telepathic-bond",
    summary:
      "Создаёт телепатическую связь между группой существ, позволяя им общаться на расстоянии.",
  }),

  createBardSpell({
    id: "mass-cure-wounds",
    level: 5,
    name: "Множественное лечение ран",
    originalName: "Mass Cure Wounds",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10570-mass-cure-wounds",
    summary:
      "Лечит хиты нескольких существ в выбранной области.",
  }),

  createBardSpell({
    id: "scrying",
    level: 5,
    name: "Наблюдение",
    originalName: "Scrying",
    school: "Прорицание",
    castingTime: "10 минут",
    range: "Особая",
    components: "В, С, М",
    duration: "10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10236-scrying",
    summary:
      "Позволяет наблюдать за существом или местом на расстоянии через магический сенсор.",
  }),

  createBardSpell({
    id: "animate-objects",
    level: 5,
    name: "Оживление вещей",
    originalName: "Animate Objects",
    school: "Вызов",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10423-animate-objects",
    summary:
      "Оживляет несколько объектов, превращая их в боевых или утилитарных помощников.",
  }),

  createBardSpell({
    id: "planar-binding",
    level: 5,
    name: "Планарные узы",
    originalName: "Planar Binding",
    school: "Ограждение",
    castingTime: "1 час",
    range: "Касание",
    components: "В, С, М",
    duration: "24 часа или больше",
    sourceUrl: "https://next.dnd.su/spells/10601-planar-binding",
    summary:
      "Привязывает призванное существо к службе вам на длительный срок.",
  }),

  createBardSpell({
    id: "dominate-person",
    level: 5,
    name: "Подчинение личности",
    originalName: "Dominate Person",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "1 минута или больше",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10488-dominate-person",
    summary:
      "Берёт под контроль гуманоидов, заставляя их действовать по вашей воле при провале спасброска.",
  }),

  createBardSpell({
    id: "seeming",
    level: 5,
    name: "Притворство",
    originalName: "Seeming",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10633-seeming",
    summary:
      "Меняет внешний вид множества существ, создавая большие маскарадные или маскировочные эффекты.",
  }),

  createBardSpell({
    id: "awaken",
    level: 5,
    name: "Пробуждение разума",
    originalName: "Awaken",
    school: "Прорицание",
    castingTime: "8 часов",
    range: "Касание",
    components: "В, С, М",
    duration: "Постоянная",
    sourceUrl: "https://next.dnd.su/spells/10438-awaken",
    summary:
      "Даёт разум животному или растению, повышая его Интеллект и делая его союзником.",
  }),

  createBardSpell({
    id: "synaptic-static",
    level: 5,
    name: "Синаптический разряд",
    originalName: "Synaptic Static",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10668-synaptic-static",
    summary:
      "Взрыв психической энергии, наносящий урон и накладывающий штрафы на ментальные активности цели.",
  }),

  createBardSpell({
    id: "hold-monster",
    level: 5,
    name: "Удержание монстра",
    originalName: "Hold Monster",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10253-hold-monster",
    summary:
      "Парализует любое существо, а не только гуманоидов, при провале спасброска.",
  }),

  createBardSpell({
    id: "mislead",
    level: 5,
    name: "Фальшивый двойник",
    originalName: "Mislead",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "1 час",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10585-mislead",
    summary:
      "Создаёт иллюзорного двойника, пока вы становитесь невидимы и можете управлять копией.",
  }),

  createBardSpell({
    id: "yolandes-regal-presence",
    level: 5,
    name: "Царственное величие Йоланды",
    originalName: "Yolande's Regal Presence",
    school: "Очарование",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl:
      "https://next.dnd.su/spells/10257-yolandes-regal-presence",
    summary:
      "Придаёт вам царственную ауру, усиливая влияние на окружающих.",
  }),

  // 6 УРОВЕНЬ

  createBardSpell({
    id: "programmed-illusion",
    level: 6,
    name: "Заданная иллюзия",
    originalName: "Programmed Illusion",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "Пока не будет развеяно",
    sourceUrl: "https://next.dnd.su/spells/10614-programmed-illusion",
    summary:
      "Создаёт сложную иллюзию, которая срабатывает при заданном триггере.",
  }),

  createBardSpell({
    id: "true-seeing",
    level: 6,
    name: "Истинный взор",
    originalName: "True Seeing",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10687-true-seeing",
    summary:
      "Дарует существу способность видеть скрытые вещи, иллюзии и истинную природу объектов.",
  }),

  createBardSpell({
    id: "mass-suggestion",
    level: 6,
    name: "Множественное внушение",
    originalName: "Mass Suggestion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "24 часа или больше",
    sourceUrl: "https://next.dnd.su/spells/10573-mass-suggestion",
    summary:
      "Внушает разумное предложение группе существ, заставляя их действовать согласно вашему плану.",
  }),

  createBardSpell({
    id: "ottos-irresistible-dance",
    level: 6,
    name: "Неудержимая пляска Отто",
    originalName: "Otto's Irresistible Dance",
    school: "Очарование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10595-ottos-irresistible-dance",
    summary:
      "Заставляет существо неконтролируемо танцевать, мешая ему действовать нормально.",
  }),

  createBardSpell({
    id: "dirge",
    level: 6,
    name: "Панихида",
    originalName: "Dirge",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12450-dirge",
    summary:
      "Мрачная песнь, ослабляющая живых или усиливающая нежить в области.",
  }),

  createBardSpell({
    id: "heroes-feast",
    level: 6,
    name: "Пир героев",
    originalName: "Heroes' Feast",
    school: "Воплощение",
    castingTime: "10 минут",
    range: "Касание",
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10542-heroes-feast",
    summary:
      "Создаёт магическое пиршество, дающее участникам серьёзные бонусы к выживанию и защите.",
  }),

  createBardSpell({
    id: "find-the-path",
    level: 6,
    name: "Поиск пути",
    originalName: "Find the Path",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 день",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10509-find-the-path",
    summary:
      "Указывает на кратчайший безопасный путь к месту, которое вы хотите найти.",
  }),

  createBardSpell({
    id: "eyebite",
    level: 6,
    name: "Разящее око",
    originalName: "Eyebite",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10501-eyebite",
    summary:
      "Взгляд, насылающий на цели страх, сон или слабость, пока вы поддерживаете концентрацию.",
  }),

  createBardSpell({
    id: "guards-and-wards",
    level: 6,
    name: "Стражи и обереги",
    originalName: "Guards and Wards",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "30 метров", // 100 футов
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10534-guards-and-wards",
    summary:
      "Наполняет здание множеством магических защит: туман, запутывание, замки и прочие препятствия.",
  }),

  // 7 УРОВЕНЬ

  createBardSpell({
    id: "mordenkainens-magnificent-mansion",
    level: 7,
    name: "Великолепный особняк Морденкайнена",
    originalName: "Mordenkainen's Magnificent Mansion",
    school: "Вызов",
    castingTime: "1 действие",
    range: "10 футов",
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10588-mordenkainens-magnificent-mansion",
    summary:
      "Создаёт роскошное внезапно доступное карманное измерение‑особняк для отдыха и приёма гостей.",
  }),

  createBardSpell({
    id: "resurrection",
    level: 7,
    name: "Воскрешение",
    originalName: "Resurrection",
    school: "Некромантия",
    castingTime: "1 час",
    range: "Касание",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10626-resurrection",
    summary:
      "Возвращает умершее существо к жизни спустя длительное время после смерти, с серьёзной ценой.",
  }),

  createBardSpell({
    id: "symbol",
    level: 7,
    name: "Знак",
    originalName: "Symbol",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "Пока не будет развеяно или сработает",
    sourceUrl: "https://next.dnd.su/spells/10667-symbol",
    summary:
      "Чернит магический символ, вызывающий разрушительные или ослабляющие эффекты при активации.",
  }),

  createBardSpell({
    id: "mordenkainens-sword",
    level: 7,
    name: "Меч Морденкайнена",
    originalName: "Mordenkainen's Sword",
    school: "Вызов",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10590-mordenkainens-sword",
    summary:
      "Призывает парящий магический меч, который атакует цели по вашему указанию каждый ход.",
  }),

  createBardSpell({
    id: "project-image",
    level: 7,
    name: "Проекция",
    originalName: "Project Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "750 футов", // уточнение по PH24
    components: "В, С, М",
    duration: "1 день",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10615-project-image",
    summary:
      "Создаёт иллюзорную проекцию вас самих, через которую можно говорить и действовать на расстоянии.",
  }),

  createBardSpell({
    id: "prismatic-spray",
    level: 7,
    name: "Радужные брызги",
    originalName: "Prismatic Spray",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (конус)",
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10611-prismatic-spray",
    summary:
      "Выбрасывает конус разноцветных лучей, каждый из которых наносит различный опасный эффект.",
  }),

  createBardSpell({
    id: "regenerate",
    level: 7,
    name: "Регенерация",
    originalName: "Regenerate",
    school: "Воплощение",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10622-regenerate",
    summary:
      "Запускает мощное восстановление тела цели, возвращая потерянные части и большое количество хитов.",
  }),

  createBardSpell({
    id: "power-word-fortify",
    level: 7,
    name: "Слово силы: укрепление",
    originalName: "Power Word Fortify",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "1 минута или особая",
    sourceUrl: "https://next.dnd.su/spells/10605-power-word-fortify",
    summary:
      "Словом силы усиливает защиту или устойчивость цели, не требуя спасброска.",
    notes:
      "Новое заклинание PH24; точные механики смотри текст книги.",
  }),

  createBardSpell({
    id: "mirage-arcane",
    level: 7,
    name: "Таинственный мираж",
    originalName: "Mirage Arcane",
    school: "Иллюзия",
    castingTime: "10 минут",
    range: "750 футов", // 1,5 км в исходных редакциях
    components: "В, С, М",
    duration: "10 дней",
    sourceUrl: "https://next.dnd.su/spells/10583-mirage-arcane",
    summary:
      "Изменяет вид и свойства большой области местности магической иллюзией.",
  }),

  createBardSpell({
    id: "teleport",
    level: 7,
    name: "Телепортация",
    originalName: "Teleport",
    school: "Вызов",
    castingTime: "1 действие",
    range: "На себя",
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10673-teleport",
    summary:
      "Перемещает вас и группу существ на большое расстояние к знакомому месту, с риском неточности.",
  }),

  createBardSpell({
    id: "forcecage",
    level: 7,
    name: "Узилище",
    originalName: "Forcecage",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "30 метров", // 100 футов
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10520-forcecage",
    summary:
      "Создаёт невидимую силовую клетку, практически невозможную для побега без магии высшего порядка.",
  }),

  createBardSpell({
    id: "etherealness",
    level: 7,
    name: "Эфирность",
    originalName: "Etherealness",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "На себя",
    components: "В, С",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10498-etherealness",
    summary:
      "Перемещает вас на Эфирный план, позволяя проходить сквозь стены и путешествовать не замеченным.",
  }),

  // 8 УРОВЕНЬ

  createBardSpell({
    id: "antipathy-sympathy",
    level: 8,
    name: "Антипатия/симпатия",
    originalName: "Antipathy/Sympathy",
    school: "Очарование",
    castingTime: "1 час",
    range: "30 метров", // 100 футов
    components: "В, С, М",
    duration: "10 дней",
    sourceUrl: "https://next.dnd.su/spells/10426-antipathy-sympathy",
    summary:
      "Заставляет существ избегать или стремиться к объекту или области, к которым зачарованы их чувства.",
  }),

  createBardSpell({
    id: "glibness",
    level: 8,
    name: "Находчивость",
    originalName: "Glibness",
    school: "Очарование",
    castingTime: "1 действие",
    range: "На себя",
    components: "В",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10529-glibness",
    summary:
      "Делает ваши слова почти неоспоримыми, сильно усиливая проверки Харизмы и убедительность.",
  }),

  createBardSpell({
    id: "dominate-monster",
    level: 8,
    name: "Подчинение монстра",
    originalName: "Dominate Monster",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "1 час или больше",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10487-dominate-monster",
    summary:
      "Берёт под контроль любое существо, если оно проваливает спасбросок, позволяя вам управлять его действиями.",
  }),

  createBardSpell({
    id: "befuddlement",
    level: 8,
    name: "Помутнение разума",
    originalName: "Befuddlement",
    school: "Очарование",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10440-befuddlement",
    summary:
      "Сильно нарушает когнитивные способности цели, мешая ей эффективно действовать.",
  }),

  createBardSpell({
    id: "power-word-stun",
    level: 8,
    name: "Слово силы: ошеломление",
    originalName: "Power Word Stun",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "Мгновенная или несколько раундов",
    sourceUrl: "https://next.dnd.su/spells/10608-power-word-stun",
    summary:
      "Одним словом ошеломляет существо с относительно низким запасом хитов, лишая его действий.",
  }),

  createBardSpell({
    id: "mind-blank",
    level: 8,
    name: "Сокрытие разума",
    originalName: "Mind Blank",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10579-mind-blank",
    summary:
      "Защищает существо от магии влияния на разум и магического обнаружения.",
  }),

  // 9 УРОВЕНЬ

  createBardSpell({
    id: "true-polymorph",
    level: 9,
    name: "Истинное превращение",
    originalName: "True Polymorph",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "36 метров", // 120 футов
    components: "В, С, М",
    duration: "1 час или постоянная",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10685-true-polymorph",
    summary:
      "Постоянно превращает существо или объект в другое существо или объект при достаточной длительности.",
  }),

  createBardSpell({
    id: "foresight",
    level: 9,
    name: "Предвидение",
    originalName: "Foresight",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10521-foresight",
    summary:
      "Дарует цели исключительную интуицию, давая преимущество практически на все важные броски и защиту от сюрприза.",
  }),

  createBardSpell({
    id: "prismatic-wall",
    level: 9,
    name: "Радужная стена",
    originalName: "Prismatic Wall",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В, С",
    duration: "10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10612-prismatic-wall",
    summary:
      "Создаёт многослойную магическую стену, практически непреодолимую без специальных средств.",
  }),

  createBardSpell({
    id: "power-word-heal",
    level: 9,
    name: "Слово силы: исцеление",
    originalName: "Power Word Heal",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10606-power-word-heal",
    summary:
      "Мгновенно полностью исцеляет существо словом силы, снимая множество негативных эффектов.",
  }),

  createBardSpell({
    id: "power-word-kill",
    level: 9,
    name: "Слово силы: смерть",
    originalName: "Power Word Kill",
    school: "Очарование",
    castingTime: "1 действие",
    range: "18 метров", // 60 футов
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10607-power-word-kill",
    summary:
      "Мгновенно убивает существо с относительно низким запасом хитов без спасброска.",
  }),
];