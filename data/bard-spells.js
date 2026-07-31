function detectEditionFromSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== "string") {
    return "unknown";
  }

  if (sourceUrl.includes("next.dnd.su")) {
    return "2024";
  }

  if (sourceUrl.includes("5e14.dnd.su")) {
    return "2014";
  }

  return "unknown";
}

function createBardSpell(spell) {
  const edition =
    spell.edition ?? detectEditionFromSourceUrl(spell.sourceUrl ?? null);

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

    damage: null,
    healing: null,
    saveAbility: null,

    rangeFeet: null,
    areaShape: null,
    areaSizeFeet: null,
    areaType: null,

    edition,
    isLegacy: edition === "2014",
    supersedesSpellId: null,

    ...spell,
    edition,
    isLegacy: spell.isLegacy ?? edition === "2014",
  };
}

function normalizeSpellIdentity(spell) {
  return (
    spell.originalName?.trim().toLowerCase() ||
    spell.name?.trim().toLowerCase() ||
    spell.id
  );
}

function scoreSpellEdition(spell) {
  if (spell.edition === "2024") {
    return 2;
  }

  if (spell.edition === "2014") {
    return 1;
  }

  return 0;
}

function mergeSpellVersions(spells) {
  const byIdentity = new Map();

  for (const spell of spells) {
    const identity = normalizeSpellIdentity(spell);
    const existing = byIdentity.get(identity);

    if (!existing) {
      byIdentity.set(identity, spell);
      continue;
    }

    if (scoreSpellEdition(spell) > scoreSpellEdition(existing)) {
      byIdentity.set(identity, {
        ...spell,
        supersedesSpellId: existing.id,
      });
      continue;
    }

    if (!existing.supersedesSpellId) {
      existing.supersedesSpellId = spell.id;
    }
  }

  return Array.from(byIdentity.values()).sort((a, b) => {
    if (a.level !== b.level) {
      return a.level - b.level;
    }

    return a.name.localeCompare(b.name, "ru");
  });
}

export const RAW_BARD_SPELL_LIBRARY = [
  // 0 УРОВЕНЬ (КАНТРИПЫ) — 2024

  createBardSpell({
    id: "mage-hand-2024",
    level: 0,
    name: "Волшебная рука",
    originalName: "Mage Hand",
    school: "Вызов",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10564-mage-hand",
    summary:
      "Призрачная рука выполняет простые манипуляции с лёгкими предметами на расстоянии.",
    notes:
      "Не может атаковать, активировать магические предметы и переносить тяжёлые объекты.",
  }),

  createBardSpell({
    id: "friends-2024",
    level: 0,
    name: "Дружба",
    originalName: "Friends",
    school: "Очарование",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
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
    id: "blade-ward-2024",
    level: 0,
    name: "Защита от оружия",
    originalName: "Blade Ward",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10444-blade-ward",
    summary:
      "Даёт сопротивление дробящему, колющему и рубящему урону от оружия до начала вашего следующего хода.",
  }),

  createBardSpell({
    id: "starry-wisp-2024",
    level: 0,
    name: "Звёздный светлячок",
    originalName: "Starry Wisp",
    school: "Вызов",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
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
    id: "vicious-mockery-2024",
    level: 0,
    name: "Злая насмешка",
    originalName: "Vicious Mockery",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10692-vicious-mockery",
    summary:
      "Наносит психический урон и накладывает помеху на следующий бросок атаки цели при провале спасброска.",
    damage: {
      dice: "1d4",
      modifier: null,
      type: "психический",
    },
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "minor-illusion-2024",
    level: 0,
    name: "Малая иллюзия",
    originalName: "Minor Illusion",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "С, М",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10582-minor-illusion",
    summary:
      "Создаёт небольшой звук или статичный визуальный образ для отвлечения, маскировки или обмана.",
  }),

  createBardSpell({
    id: "true-strike-2024",
    level: 0,
    name: "Меткий удар",
    originalName: "True Strike",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10688-true-strike",
    summary:
      "Даёт преимущество на одну атаку по выбранной цели, если вы атакуюте её до конца следующего хода.",
  }),

  createBardSpell({
    id: "dancing-lights-2024",
    level: 0,
    name: "Пляшущие огоньки",
    originalName: "Dancing Lights",
    school: "Вызов",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10472-dancing-lights",
    summary:
      "Создаёт до четырёх движущихся огоньков, дающих тусклый свет и способных изменять расположение.",
  }),

  createBardSpell({
    id: "mending-2024",
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
  }),

  createBardSpell({
    id: "thunderclap-2024",
    level: 0,
    name: "Раскат грома",
    originalName: "Thunderclap",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (радиус 5 футов)",
    rangeFeet: 0,
    areaShape: "radius",
    areaSizeFeet: 5,
    areaType: "radius",
    components: "С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10678-thunderclap",
    summary:
      "Создаёт громкий взрыв звука вокруг вас, который может повредить существам поблизости.",
    damage: {
      dice: "1d6",
      modifier: null,
      type: "громовой",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "light-2024",
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
  }),

  createBardSpell({
    id: "message-2024",
    level: 0,
    name: "Сообщение",
    originalName: "Message",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10577-message",
    summary:
      "Отправляет короткое шепчущее сообщение выбранному существу, которое может ответить.",
  }),

  createBardSpell({
    id: "prestidigitation-2024",
    level: 0,
    name: "Фокусы",
    originalName: "Prestidigitation",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "10 футов",
    rangeFeet: 10,
    components: "В, С",
    duration: "До 1 часа",
    sourceUrl: "https://next.dnd.su/spells/10610-prestidigitation",
    summary:
      "Создаёт набор мелких утилитарных и сценических эффектов: чистка, вкус, искры и подобные трюки.",
  }),

  // 0 УРОВЕНЬ — пример legacy 2014 (остальные добавишь по необходимости)

  createBardSpell({
    id: "mage-hand-2014",
    level: 0,
    name: "Волшебная рука",
    originalName: "Mage Hand",
    school: "Вызов",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://5e14.dnd.su/spells/26-mage-hand/",
    summary:
      "Призрачная рука выполняет простые манипуляции с лёгкими предметами на расстоянии.",
  }),

  // 1 УРОВЕНЬ — 2024

  createBardSpell({
    id: "silent-image-2024",
    level: 1,
    name: "Безмолвный образ",
    originalName: "Silent Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10642-silent-image",
    summary:
      "Создаёт подвижную, но беззвучную иллюзию объекта или существа среднего размера.",
  }),

  createBardSpell({
    id: "thunderwave-2024",
    level: 1,
    name: "Волна грома",
    originalName: "Thunderwave",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (куб 15 футов)",
    rangeFeet: 0,
    areaShape: "cube",
    areaSizeFeet: 15,
    areaType: "side",
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
    id: "heroism-2024",
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
    id: "dissonant-whispers-2024",
    level: 1,
    name: "Диссонирующий шёпот",
    originalName: "Dissonant Whispers",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
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
    id: "animal-friendship-2024",
    level: 1,
    name: "Дружба с животными",
    originalName: "Animal Friendship",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10264-animal-friendship",
    summary:
      "Убеждает зверя в том, что вы не представляете угрозы, делая его дружелюбным на время действия заклинания.",
  }),

  createBardSpell({
    id: "tashas-hideous-laughter-2024",
    level: 1,
    name: "Жуткий смех Таши",
    originalName: "Tasha's Hideous Laughter",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10670-tashas-hideous-laughter",
    summary:
      "Повергает цель в неудержимый смех, лишая её дееспособности и сбивая с ног при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "illusory-script-2024",
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
    id: "healing-word-2024",
    level: 1,
    name: "Лечащее слово",
    originalName: "Healing Word",
    school: "Воплощение",
    castingTime: "1 бонусное действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10539-healing-word",
    summary:
      "Быстро лечит союзника на расстоянии; особенно полезно для поднятия из состояния 0 хитов.",
    healing: {
      dice: "1d4",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "cure-wounds-2024",
    level: 1,
    name: "Лечение ран",
    originalName: "Cure Wounds",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10270-cure-wounds",
    summary:
      "Лечит существо прикосновением, восстанавливая больше хитов, чем лечащее слово, но требуя действия и близости.",
    healing: {
      dice: "1d8",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "disguise-self-2024",
    level: 1,
    name: "Маскировка",
    originalName: "Disguise Self",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10480-disguise-self",
    summary:
      "Меняет ваш внешний вид на иллюзорный: одежду, черты лица и телосложение в допустимых пределах.",
  }),

  createBardSpell({
    id: "unseen-servant-2024",
    level: 1,
    name: "Невидимый слуга",
    originalName: "Unseen Servant",
    school: "Вызов",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10690-unseen-servant",
    summary:
      "Создаёт невидимую силу, которая выполняет простые бытовые задачи по вашей команде.",
  }),

  createBardSpell({
    id: "wardaway-2024",
    level: 1,
    name: "Оберегающий разряд",
    originalName: "Wardaway",
    school: "Ограждение",
    castingTime: "1 реакция",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/12471-wardaway",
    summary:
      "Используется реакцией для ослабления удара или эффекта, направленного на союзника.",
  }),

  createBardSpell({
    id: "detect-magic-2024",
    level: 1,
    name: "Обнаружение магии",
    originalName: "Detect Magic",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя (радиус 30 футов)",
    rangeFeet: 0,
    areaShape: "radius",
    areaSizeFeet: 30,
    areaType: "radius",
    components: "В, С",
    duration: "До 10 минут",
    concentration: true,
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10274-detect-magic",
    summary:
      "Позволяет чувствовать присутствие магии и видеть её ауру вокруг предметов и существ.",
  }),

  createBardSpell({
    id: "faerie-fire-2024",
    level: 1,
    name: "Огонь фей",
    originalName: "Faerie Fire",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов, куб 20 футов",
    rangeFeet: 60,
    areaShape: "cube",
    areaSizeFeet: 20,
    areaType: "side",
    components: "В",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10503-faerie-fire",
    summary:
      "Обводит существ и объекты светом, давая преимущество на атаки по ним и лишая скрытности.",
    saveAbility: "dexterity",
  }),

  createBardSpell({
    id: "identify-2024",
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
    id: "charm-person-2024",
    level: 1,
    name: "Очарование личности",
    originalName: "Charm Person",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10456-charm-person",
    summary:
      "Пытается сделать гуманоид дружелюбным к вам, облегчая социальные взаимодействия.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "feather-fall-2024",
    level: 1,
    name: "Падение пёрышком",
    originalName: "Feather Fall",
    school: "Воплощение",
    castingTime: "1 реакция",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, М",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10506-feather-fall",
    summary:
      "Замедляет падение нескольких существ, предотвращая повреждения от падения.",
  }),

  createBardSpell({
    id: "comprehend-languages-2024",
    level: 1,
    name: "Понимание языков",
    originalName: "Comprehend Languages",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10200-comprehend-languages",
    summary:
      "Позволяет понимать значение устной и письменной речи на любом языке, но не расшифровывает шифры.",
  }),

  createBardSpell({
    id: "bane-2024",
    level: 1,
    name: "Порча",
    originalName: "Bane",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10243-bane",
    summary:
      "Накладывает штраф на броски атаки и спасброски трём существам при провале их бросков.",
    saveAbility: "charisma",
  }),

  createBardSpell({
    id: "command-2024",
    level: 1,
    name: "Приказ",
    originalName: "Command",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10196-command",
    summary:
      "Заставляет цель выполнить краткий однословный приказ при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "speak-with-animals-2024",
    level: 1,
    name: "Разговор с животными",
    originalName: "Speak with Animals",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "10 минут",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10246-speak-with-animals",
    summary:
      "Позволяет понимать и устно общаться с обычными животными.",
  }),

  createBardSpell({
    id: "color-spray-2024",
    level: 1,
    name: "Сверкающие брызги",
    originalName: "Color Spray",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (конус 15 футов)",
    rangeFeet: 0,
    areaShape: "cone",
    areaSizeFeet: 15,
    areaType: "length",
    components: "В, С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10465-color-spray",
    summary:
      "Выбрасывает конус ослепляющих цветных вспышек, временно ослепляя существ с низкими хитами.",
  }),

  createBardSpell({
    id: "longstrider-2024",
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
    id: "sleep-2024",
    level: 1,
    name: "Усыпление",
    originalName: "Sleep",
    school: "Очарование",
    castingTime: "1 действие",
    range: "90 футов, радиус 20 футов",
    rangeFeet: 90,
    areaShape: "radius",
    areaSizeFeet: 20,
    areaType: "radius",
    components: "В, С, М",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10644-sleep",
    summary:
      "Погружает существ с низкими хитами в магический сон, начиная с самых ослабленных.",
  }),

  // 2 УРОВЕНЬ — 2024

  createBardSpell({
    id: "see-invisibility-2024",
    level: 2,
    name: "Видение невидимого",
    originalName: "See Invisibility",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10632-see-invisibility",
    summary:
      "Позволяет видеть невидимых существ и объекты.",
  }),

  createBardSpell({
    id: "suggestion-2024",
    level: 2,
    name: "Внушение",
    originalName: "Suggestion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, М",
    duration: "До 8 часов",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10658-suggestion",
    summary:
      "Заставляет цель следовать разумному предложению, сформулированному в одной фразе.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "magic-mouth-2024",
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
    id: "phantasmal-force-2024",
    level: 2,
    name: "Воображаемая сила",
    originalName: "Phantasmal Force",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
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
    id: "blindness-deafness-2024",
    level: 2,
    name: "Глухота/слепота",
    originalName: "Blindness/Deafness",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10448-blindness-deafness",
    summary:
      "Лишает цель зрения или слуха при провале спасброска.",
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "shatter-2024",
    level: 2,
    name: "Дребезги",
    originalName: "Shatter",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов, радиус 10 футов",
    rangeFeet: 60,
    areaShape: "radius",
    areaSizeFeet: 10,
    areaType: "radius",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10637-shatter",
    summary:
      "Выбрасывает зону звукового взрыва, наносящего урон существам и предметам.",
    damage: {
      dice: "3d8",
      modifier: null,
      type: "громовой",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "crown-of-madness-2024",
    level: 2,
    name: "Корона безумия",
    originalName: "Crown of Madness",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10470-crown-of-madness",
    summary:
      "Вселяет безумие в гуманоид, заставляя его атаковать ближайших существ по вашему указанию.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "lesser-restoration-2024",
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
      "Снимает болезнь или одно состояние, такое как ослепление, паралич, отравление.",
  }),

  createBardSpell({
    id: "heat-metal-2024",
    level: 2,
    name: "Нагрев металла",
    originalName: "Heat Metal",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10540-heat-metal",
    summary:
      "Нагревает металлический предмет, причиняя урон существу, которое его носит или держит.",
    damage: {
      dice: "2d8",
      modifier: null,
      type: "огненный",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "invisibility-2024",
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
      "Делает существо невидимым до нападения или применения заклинания.",
  }),

  createBardSpell({
    id: "cloud-of-daggers-2024",
    level: 2,
    name: "Облако кинжалов",
    originalName: "Cloud of Daggers",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10463-cloud-of-daggers",
    summary:
      "Создаёт куб вращающихся лезвий, наносящих урон существам внутри.",
    damage: {
      dice: "4d4",
      modifier: null,
      type: "рубящий",
    },
  }),

  createBardSpell({
    id: "zone-of-truth-2024",
    level: 2,
    name: "Область истины",
    originalName: "Zone of Truth",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "10 минут",
    sourceUrl: "https://next.dnd.su/spells/10240-zone-of-truth",
    summary:
      "Создаёт область, в которой существа затрудняются лгать.",
    saveAbility: "charisma",
  }),

  createBardSpell({
    id: "detect-thoughts-2024",
    level: 2,
    name: "Обнаружение мыслей",
    originalName: "Detect Thoughts",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10479-detect-thoughts",
    summary:
      "Считывает поверхностные мысли существ и может углубляться дальше.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "mirror-image-2024",
    level: 2,
    name: "Отражения",
    originalName: "Mirror Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10584-mirror-image",
    summary:
      "Создаёт несколько иллюзорных копий вас, затрудняя попадание по вам.",
  }),

  createBardSpell({
    id: "aid-2024",
    level: 2,
    name: "Подмога",
    originalName: "Aid",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10242-aid",
    summary:
      "Повышает максимальные и текущие хиты нескольких существ.",
  }),

  createBardSpell({
    id: "locate-animals-or-plants-2024",
    level: 2,
    name: "Поиск животных или растений",
    originalName: "Locate Animals or Plants",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "10 минут",
    ritual: true,
    sourceUrl:
      "https://next.dnd.su/spells/10291-locate-animals-or-plants",
    summary:
      "Определяет направление к ближайшему животному или растению заданного вида.",
  }),

  createBardSpell({
    id: "locate-object-2024",
    level: 2,
    name: "Поиск объекта",
    originalName: "Locate Object",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10293-locate-object",
    summary:
      "Позволяет ощущать направление к известному вам объекту.",
  }),

  createBardSpell({
    id: "animal-messenger-2024",
    level: 2,
    name: "Почтовое животное",
    originalName: "Animal Messenger",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "24 часа",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10265-animal-messenger",
    summary:
      "Посылает небольшое животное с коротким устным сообщением к указанному адресату.",
  }),

  createBardSpell({
    id: "enthrall-2024",
    level: 2,
    name: "Речь златоуста",
    originalName: "Enthrall",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10497-enthrall",
    summary:
      "Привлекает внимание существ, затрудняя их восприятие других целей.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "knock-2024",
    level: 2,
    name: "Стук",
    originalName: "Knock",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10557-knock",
    summary:
      "Открывает запертые двери, сундуки и другие запоры, включая магические.",
  }),

  createBardSpell({
    id: "silence-2024",
    level: 2,
    name: "Тишина",
    originalName: "Silence",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10300-silence",
    summary:
      "Создаёт область абсолютной тишины, в которой невозможно произносить заклинания с вербальным компонентом.",
  }),

  createBardSpell({
    id: "enlarge-reduce-2024",
    level: 2,
    name: "Увеличение/уменьшение",
    originalName: "Enlarge/Reduce",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10496-enlarge-reduce",
    summary:
      "Увеличивает или уменьшает существо или объект, изменяя размер и наносящие урон кубики.",
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "hold-person-2024",
    level: 2,
    name: "Удержание личности",
    originalName: "Hold Person",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10254-hold-person",
    summary:
      "Парализует гуманоид при провале спасброска, делая его уязвимым к атакам.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "enhance-ability-2024",
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
      "Даёт существу магическое улучшение выбранной характеристики, предоставляя преимущество на соответствующие проверки.",
  }),

  createBardSpell({
    id: "calm-emotions-2024",
    level: 2,
    name: "Умиротворение",
    originalName: "Calm Emotions",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10453-calm-emotions",
    summary:
      "Подавляет сильные эмоции существ в области, ослабляя враждебность и страх.",
    saveAbility: "charisma",
  }),

  // 3 УРОВЕНЬ — 2024

  createBardSpell({
    id: "hypnotic-pattern-2024",
    level: 3,
    name: "Гипнотический узор",
    originalName: "Hypnotic Pattern",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10547-hypnotic-pattern",
    summary:
      "Создаёт узор, очаровывающий и лишающий дееспособности существ при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "slow-2024",
    level: 3,
    name: "Замедление",
    originalName: "Slow",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10646-slow",
    summary:
      "Замедляет несколько существ, снижая их скорость и ограничивая действия.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "stinking-cloud-2024",
    level: 3,
    name: "Зловонное облако",
    originalName: "Stinking Cloud",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "90 футов",
    rangeFeet: 90,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10655-stinking-cloud",
    summary:
      "Создаёт облако газа, мешающее существам действовать и концентрироваться.",
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "mass-healing-word-2024",
    level: 3,
    name: "Множественное лечащее слово",
    originalName: "Mass Healing Word",
    school: "Воплощение",
    castingTime: "1 бонусное действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10572-mass-healing-word",
    summary:
      "Лечит нескольких союзников на небольшое количество хитов.",
    healing: {
      dice: "1d4",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "bestow-curse-2024",
    level: 3,
    name: "Наложение проклятия",
    originalName: "Bestow Curse",
    school: "Очарование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10441-bestow-curse",
    summary:
      "Накладывает разнообразные негативные эффекты на цель при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "nondetection-2024",
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
      "Защищает существо или объект от обнаружения магией прорицания.",
  }),

  createBardSpell({
    id: "major-image-2024",
    level: 3,
    name: "Образ",
    originalName: "Major Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С, М",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10569-major-image",
    summary:
      "Создаёт крупную детализированную иллюзию с визуальными и звуковыми эффектами.",
  }),

  createBardSpell({
    id: "glyph-of-warding-2024",
    level: 3,
    name: "Охранная руна",
    originalName: "Glyph of Warding",
    school: "Ограждение",
    castingTime: "1 час",
    range: "Касание",
    components: "В, С, М",
    duration: "До развеивания",
    sourceUrl: "https://next.dnd.su/spells/10531-glyph-of-warding",
    summary:
      "Создаёт магическую глифу, которая срабатывает при определённых условиях, нанося урон или накладывая заклинание.",
  }),

  createBardSpell({
    id: "clairvoyance-2024",
    level: 3,
    name: "Подсматривание",
    originalName: "Clairvoyance",
    school: "Прорицание",
    castingTime: "10 минут",
    range: "1 миля",
    rangeFeet: null,
    components: "В, С, М",
    duration: "10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10461-clairvoyance",
    summary:
      "Создаёт невидимый сенсор, позволяющий видеть или слышать удалённое место.",
  }),

  createBardSpell({
    id: "sending-2024",
    level: 3,
    name: "Послание",
    originalName: "Sending",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "Специальная",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10634-sending",
    summary:
      "Отправляет короткое сообщение существу в любом месте, даже на другом плане.",
  }),

  createBardSpell({
    id: "feign-death-2024",
    level: 3,
    name: "Притворная смерть",
    originalName: "Feign Death",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10507-feign-death",
    summary:
      "Погружает существо в состояние, похожее на смерть, защищая его от некоторых эффектов.",
  }),

  createBardSpell({
    id: "speak-with-dead-2024",
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
      "Позволяет задавать вопросы трупу и получать ограниченные ответы.",
  }),

  createBardSpell({
    id: "speak-with-plants-2024",
    level: 3,
    name: "Разговор с растениями",
    originalName: "Speak with Plants",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "10 минут",
    sourceUrl: "https://next.dnd.su/spells/10301-speak-with-plants",
    summary:
      "Одушевляет растения, позволяя им отвечать на вопросы и двигаться ограниченным образом.",
  }),

  createBardSpell({
    id: "dispel-magic-2024",
    level: 3,
    name: "Рассеивание магии",
    originalName: "Dispel Magic",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10245-dispel-magic",
    summary:
      "Разрушает магические эффекты и заклинания определённого уровня или ниже.",
  }),

  createBardSpell({
    id: "plant-growth-2024",
    level: 3,
    name: "Рост растений",
    originalName: "Plant Growth",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "150 футов",
    rangeFeet: 150,
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10247-plant-growth",
    summary:
      "Усиливает рост растений, преобразуя местность или улучшая урожай.",
  }),

  createBardSpell({
    id: "fear-2024",
    level: 3,
    name: "Ужас",
    originalName: "Fear",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10505-fear",
    summary:
      "Порождает сильный страх, заставляющий существ бросать оружие и убегать.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "leomunds-tiny-hut-2024",
    level: 3,
    name: "Хижина Леомунда",
    originalName: "Leomund's Tiny Hut",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "8 часов",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10559-leomunds-tiny-hut",
    summary:
      "Создаёт стационарный купол, защищающий вас и союзников от внешних воздействий.",
  }),

  createBardSpell({
    id: "cacophonic-shield-2024",
    level: 3,
    name: "Щит какофонии",
    originalName: "Cacophonic Shield",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12446-cacophonic-shield",
    summary:
      "Создаёт звуковой щит, мешающий атакам и заклинаниям против вас.",
  }),

  createBardSpell({
    id: "tongues-2024",
    level: 3,
    name: "Языки",
    originalName: "Tongues",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10683-tongues",
    summary:
      "Позволяет существу понимать и говорить на любом языке.",
  }),

    // 4 УРОВЕНЬ — 2024

  createBardSpell({
    id: "phantasmal-killer-2024",
    level: 4,
    name: "Воображаемый убийца",
    originalName: "Phantasmal Killer",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10598-phantasmal-killer",
    summary:
      "Создаёт ужасающую иллюзию, причиняющую повторяющийся психический урон существу при провале спасбросков.",
    damage: {
      dice: "4d10",
      modifier: null,
      type: "психический",
    },
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "greater-invisibility-2024",
    level: 4,
    name: "Высшая невидимость",
    originalName: "Greater Invisibility",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10533-greater-invisibility",
    summary:
      "Делает цель невидимой даже при атаке или использовании заклинаний, пока вы сохраняете концентрацию.",
  }),

  createBardSpell({
    id: "fount-of-moonlight-2024",
    level: 4,
    name: "Источник лунного света",
    originalName: "Fount of Moonlight",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10522-fount-of-moonlight",
    summary:
      "Создаёт столп лунного света, наносящий урон врагам и усиливающий союзников в области.",
  }),

  createBardSpell({
    id: "hallucinatory-terrain-2024",
    level: 4,
    name: "Мираж",
    originalName: "Hallucinatory Terrain",
    school: "Иллюзия",
    castingTime: "10 минут",
    range: "300 футов",
    rangeFeet: 300,
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10536-hallucinatory-terrain",
    summary:
      "Меняет визуальное восприятие местности, создавая иллюзорные изменения ландшафта.",
  }),

  createBardSpell({
    id: "backlash-2024",
    level: 4,
    name: "Ответный урон",
    originalName: "Backlash",
    school: "Ограждение",
    castingTime: "1 реакция",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/12444-backlash",
    summary:
      "Отражает часть урона или эффекта обратно в атакующего.",
  }),

  createBardSpell({
    id: "charm-monster-2024",
    level: 4,
    name: "Очарование монстра",
    originalName: "Charm Monster",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10455-charm-monster",
    summary:
      "Очаровывает любое существо, делая его дружелюбным к вам при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "dimension-door-2024",
    level: 4,
    name: "Переносящая дверь",
    originalName: "Dimension Door",
    school: "Вызов",
    castingTime: "1 действие",
    range: "500 футов",
    rangeFeet: 500,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10244-dimension-door",
    summary:
      "Мгновенно перемещает вас и ещё одно существо на значительное расстояние, если точка назначения известна.",
  }),

  createBardSpell({
    id: "doomtide-2024",
    level: 4,
    name: "Погибель",
    originalName: "Doomtide",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    areaShape: "sphere",
    areaSizeFeet: 15,
    areaType: "radius",
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12451-doomtide",
    summary:
      "Создаёт волну некротической энергии, наносящую урон и ослабляющую существ в области.",
    damage: {
      dice: "4d6",
      modifier: null,
      type: "некротический",
    },
    saveAbility: "constitution",
  }),

  createBardSpell({
    id: "locate-creature-2024",
    level: 4,
    name: "Поиск существа",
    originalName: "Locate Creature",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10292-locate-creature",
    summary:
      "Позволяет чувствовать направление к известному существу в пределах определённой дистанции.",
  }),

  createBardSpell({
    id: "polymorph-2024",
    level: 4,
    name: "Превращение",
    originalName: "Polymorph",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10604-polymorph",
    summary:
      "Превращает существо в другое существо того же или меньшего уровня опасности при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "compulsion-2024",
    level: 4,
    name: "Принуждение",
    originalName: "Compulsion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10201-compulsion",
    summary:
      "Заставляет существ в радиусе двигаться в выбранном вами направлении при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "freedom-of-movement-2024",
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
      "Защищает существо от затруднённой местности и эффектов, ограничивающих движение.",
  }),

  createBardSpell({
    id: "confusion-2024",
    level: 4,
    name: "Смятение",
    originalName: "Confusion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "90 футов",
    rangeFeet: 90,
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10203-confusion",
    summary:
      "Дезориентирует существ в области, заставляя их действовать хаотично при провале спасбросков.",
    saveAbility: "wisdom",
  }),

  // 5 УРОВЕНЬ — 2024

  createBardSpell({
    id: "raise-dead-2024",
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
      "Возвращает умершее существо к жизни с ослабленным состоянием.",
  }),

  createBardSpell({
    id: "greater-restoration-2024",
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
      "Снимает тяжёлые негативные эффекты, такие как уровни истощения, окаменение и проклятия.",
  }),

  createBardSpell({
    id: "geas-2024",
    level: 5,
    name: "Гейс",
    originalName: "Geas",
    school: "Очарование",
    castingTime: "1 минута",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "30 дней",
    sourceUrl: "https://next.dnd.su/spells/10526-geas",
    summary:
      "Накладывает долгосрочное магическое повеление на существо при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "dream-2024",
    level: 5,
    name: "Грёзы",
    originalName: "Dream",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "Специальная",
    components: "В, С, М",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10491-dream",
    summary:
      "Позволяет вступить в сновидение существа, посылать сообщения и наносить психический урон.",
  }),

  createBardSpell({
    id: "legend-lore-2024",
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
      "Даёт видения и факты о легендарных личностях, местах или предметах.",
  }),

  createBardSpell({
    id: "modify-memory-2024",
    level: 5,
    name: "Изменение памяти",
    originalName: "Modify Memory",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10586-modify-memory",
    summary:
      "Изменяет или стирает воспоминания существа при провале спасброска, переписывая события.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "teleportation-circle-2024",
    level: 5,
    name: "Круг телепортации",
    originalName: "Teleportation Circle",
    school: "Вызов",
    castingTime: "1 минута",
    range: "10 футов",
    rangeFeet: 10,
    components: "В, С, М",
    duration: "1 раунд",
    sourceUrl: "https://next.dnd.su/spells/10674-teleportation-circle",
    summary:
      "Создаёт круг, через который существа могут мгновенно переместиться на связанную локацию.",
  }),

  createBardSpell({
    id: "alustriels-mooncloak-2024",
    level: 5,
    name: "Лунный покров Алустриэли",
    originalName: "Alustriel's Mooncloak",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С, М",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12443-alustriels-mooncloak",
    summary:
      "Создаёт защитный покров лунного света, дающий резисты и полезные эффекты.",
  }),

  createBardSpell({
    id: "rarys-telepathic-bond-2024",
    level: 5,
    name: "Ментальная связь Рэри",
    originalName: "Rary's Telepathic Bond",
    school: "Прорицание",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "1 час",
    ritual: true,
    sourceUrl: "https://next.dnd.su/spells/10618-rarys-telepathic-bond",
    summary:
      "Создаёт телепатическую сеть между несколькими существами для мгновенной связи.",
  }),

  createBardSpell({
    id: "mass-cure-wounds-2024",
    level: 5,
    name: "Множественное лечение ран",
    originalName: "Mass Cure Wounds",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10570-mass-cure-wounds",
    summary:
      "Лечит несколько существ в области на умеренное количество хитов.",
    healing: {
      dice: "3d8",
      modifier: "spellcasting",
    },
  }),

  createBardSpell({
    id: "scrying-2024",
    level: 5,
    name: "Наблюдение",
    originalName: "Scrying",
    school: "Прорицание",
    castingTime: "10 минут",
    range: "Специальная",
    components: "В, С, М",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10236-scrying",
    summary:
      "Создаёт магический сенсор, позволяющий наблюдать за существом или местом на расстоянии.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "animate-objects-2024",
    level: 5,
    name: "Оживление вещей",
    originalName: "Animate Objects",
    school: "Вызов",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10423-animate-objects",
    summary:
      "Оживляет несколько объектов, позволяя им атаковать и действовать как ваши слуги.",
  }),

  createBardSpell({
    id: "planar-binding-2024",
    level: 5,
    name: "Планарные узы",
    originalName: "Planar Binding",
    school: "Ограждение",
    castingTime: "1 час",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10601-planar-binding",
    summary:
      "Привязывает вызванное или родное иное существо к вашей службе на длительное время.",
    saveAbility: "charisma",
  }),

  createBardSpell({
    id: "dominate-person-2024",
    level: 5,
    name: "Подчинение личности",
    originalName: "Dominate Person",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10488-dominate-person",
    summary:
      "Берёт под контроль действия гуманоида при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "seeming-2024",
    level: 5,
    name: "Притворство",
    originalName: "Seeming",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10633-seeming",
    summary:
      "Меняет внешний вид множества существ, создавая массовую маскировку.",
  }),

  createBardSpell({
    id: "awaken-2024",
    level: 5,
    name: "Пробуждение разума",
    originalName: "Awaken",
    school: "Преобразование",
    castingTime: "8 часов",
    range: "Касание",
    components: "В, С, М",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10438-awaken",
    summary:
      "Дарует разум и речь существу зверя или растения, делая его полноценным союзником.",
  }),

  createBardSpell({
    id: "synaptic-static-2024",
    level: 5,
    name: "Синаптический разряд",
    originalName: "Synaptic Static",
    school: "Очарование",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10668-synaptic-static",
    summary:
      "Создаёт психический взрыв, наносящий урон и накладывающий штрафы на мыслительные процессы.",
    damage: {
      dice: "8d6",
      modifier: null,
      type: "психический",
    },
    saveAbility: "intelligence",
  }),

  createBardSpell({
    id: "hold-monster-2024",
    level: 5,
    name: "Удержание монстра",
    originalName: "Hold Monster",
    school: "Очарование",
    castingTime: "1 действие",
    range: "90 футов",
    rangeFeet: 90,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10253-hold-monster",
    summary:
      "Парализует любое существо при провале спасброска, делая его уязвимым к атакам.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "mislead-2024",
    level: 5,
    name: "Фальшивый двойник",
    originalName: "Mislead",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10585-mislead",
    summary:
      "Создаёт иллюзорного двойника, пока вы становитесь невидимыми и управляете образом.",
  }),

  createBardSpell({
    id: "yolandes-regal-presence-2024",
    level: 5,
    name: "Царственное величие Йоланды",
    originalName: "Yolande's Regal Presence",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10257-yolandes-regal-presence",
    summary:
      "Вселяет благоговение и уважение к вам, усиливая ваши социальные воздействия.",
  }),

  // 6 УРОВЕНЬ — 2024

  createBardSpell({
    id: "programmed-illusion-2024",
    level: 6,
    name: "Заданная иллюзия",
    originalName: "Programmed Illusion",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С, М",
    duration: "До развеивания",
    sourceUrl: "https://next.dnd.su/spells/10614-programmed-illusion",
    summary:
      "Создаёт сложную иллюзию, срабатывающую при предусмотренном триггере.",
  }),

  createBardSpell({
    id: "true-seeing-2024",
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
      "Дарует существу способность видеть невидимое, иллюзии и истинную форму существ.",
  }),

  createBardSpell({
    id: "mass-suggestion-2024",
    level: 6,
    name: "Множественное внушение",
    originalName: "Mass Suggestion",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10573-mass-suggestion",
    summary:
      "Навязывает разумные указания группе существ, заставляя их следовать им при провале спасбросков.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "ottos-irresistible-dance-2024",
    level: 6,
    name: "Неудержимая пляска Отто",
    originalName: "Otto's Irresistible Dance",
    school: "Очарование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10595-ottos-irresistible-dance",
    summary:
      "Заставляет существо бесконтрольно танцевать, мешая ему действовать эффективно.",
  }),

  createBardSpell({
    id: "dirge-2024",
    level: 6,
    name: "Панихида",
    originalName: "Dirge",
    school: "Некромантия",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/12450-dirge",
    summary:
      "Мрачная песнь, ослабляющая врагов и усиливающая союзников против мёртвых.",
  }),

  createBardSpell({
    id: "heroes-feast-2024",
    level: 6,
    name: "Пир героев",
    originalName: "Heroes' Feast",
    school: "Воплощение",
    castingTime: "1 час",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10542-heroes-feast",
    summary:
      "Создаёт магический пир, дающий участникам бонусы к хп, спасброскам и иммунитеты.",
  }),

  createBardSpell({
    id: "find-the-path-2024",
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
      "Указывает кратчайший безопасный путь к известному месту.",
  }),

  createBardSpell({
    id: "eyebite-2024",
    level: 6,
    name: "Разящее око",
    originalName: "Eyebite",
    school: "Очарование",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "1 минута",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10501-eyebite",
    summary:
      "Позволяет накладывать различные эффекты ужаса и сонливости на существ, на которых вы смотрите.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "guards-and-wards-2024",
    level: 6,
    name: "Стражи и обереги",
    originalName: "Guards and Wards",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "120 футов",
    rangeFeet: 120,
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl: "https://next.dnd.su/spells/10534-guards-and-wards",
    summary:
      "Защищает здание или область набором магических эффектов и ловушек.",
  }),

    // 7 УРОВЕНЬ — 2024

  createBardSpell({
    id: "mordenkainens-magnificent-mansion-2024",
    level: 7,
    name: "Великолепный особняк Морденкайнена",
    originalName: "Mordenkainen's Magnificent Mansion",
    school: "Вызов",
    castingTime: "1 минута",
    range: "300 футов",
    rangeFeet: 300,
    components: "В, С, М",
    duration: "24 часа",
    sourceUrl:
      "https://next.dnd.su/spells/10588-mordenkainens-magnificent-mansion",
    summary:
      "Создаёт экстрамерный особняк, служащий безопасным убежищем.",
  }),

  createBardSpell({
    id: "resurrection-2024",
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
      "Возвращает умершее существо к жизни спустя значительное время после смерти.",
  }),

  createBardSpell({
    id: "symbol-2024",
    level: 7,
    name: "Знак",
    originalName: "Symbol",
    school: "Ограждение",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "До развеивания",
    sourceUrl: "https://next.dnd.su/spells/10667-symbol",
    summary:
      "Создаёт магический символ, накладывающий мощные эффекты при срабатывании.",
  }),

  createBardSpell({
    id: "mordenkainens-sword-2024",
    level: 7,
    name: "Меч Морденкайнена",
    originalName: "Mordenkainen's Sword",
    school: "Вызов",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10590-mordenkainens-sword",
    summary:
      "Призывает летающий магический меч, который наносит урон по вашим командам.",
    damage: {
      dice: "3d10",
      modifier: null,
      type: "силовой",
    },
  }),

  createBardSpell({
    id: "project-image-2024",
    level: 7,
    name: "Проекция",
    originalName: "Project Image",
    school: "Иллюзия",
    castingTime: "1 действие",
    range: "500 миль",
    rangeFeet: null,
    components: "В, С, М",
    duration: "До 1 дня",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10615-project-image",
    summary:
      "Создаёт иллюзорную копию вас, через которую можно видеть, слышать и накладывать заклинания.",
  }),

  createBardSpell({
    id: "prismatic-spray-2024",
    level: 7,
    name: "Радужные брызги",
    originalName: "Prismatic Spray",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "На себя (конус 60 футов)",
    rangeFeet: 0,
    areaShape: "cone",
    areaSizeFeet: 60,
    areaType: "length",
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10611-prismatic-spray",
    summary:
      "Выбрасывает конус разноцветных лучей, каждый из которых оказывает различный опасный эффект.",
  }),

  createBardSpell({
    id: "regenerate-2024",
    level: 7,
    name: "Регенерация",
    originalName: "Regenerate",
    school: "Преобразование",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10622-regenerate",
    summary:
      "Быстро лечит цель и восстанавливает утраченные конечности.",
    healing: {
      dice: "4d8",
      modifier: 15,
    },
  }),

  createBardSpell({
    id: "power-word-fortify-2024",
    level: 7,
    name: "Слово силы: укрепление",
    originalName: "Power Word Fortify",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "1 минута",
    sourceUrl: "https://next.dnd.su/spells/10605-power-word-fortify",
    summary:
      "Мгновенно наполняет существо силой и стойкостью, давая значительный запас временных хитов.",
  }),

  createBardSpell({
    id: "mirage-arcane-2024",
    level: 7,
    name: "Таинственный мираж",
    originalName: "Mirage Arcane",
    school: "Иллюзия",
    castingTime: "10 минут",
    range: "Миля",
    rangeFeet: null,
    components: "В, С",
    duration: "10 дней",
    sourceUrl: "https://next.dnd.su/spells/10583-mirage-arcane",
    summary:
      "Преображает обширную область, создавая сложную иллюзию изменённого ландшафта.",
  }),

  createBardSpell({
    id: "teleport-2024",
    level: 7,
    name: "Телепортация",
    originalName: "Teleport",
    school: "Вызов",
    castingTime: "1 действие",
    range: "10 футов",
    rangeFeet: 10,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10673-teleport",
    summary:
      "Мгновенно переносит вас и несколько существ или предметов в известную точку на том же плане.",
  }),

  createBardSpell({
    id: "forcecage-2024",
    level: 7,
    name: "Узилище",
    originalName: "Forcecage",
    school: "Вызов",
    castingTime: "1 действие",
    range: "100 футов",
    rangeFeet: 100,
    areaShape: "cube",
    areaSizeFeet: 20,
    areaType: "side",
    components: "В, С, М",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10520-forcecage",
    summary:
      "Создаёт почти неразрушимую клетку или короб из магической силы, запирая существ внутри.",
  }),

  createBardSpell({
    id: "etherealness-2024",
    level: 7,
    name: "Эфирность",
    originalName: "Etherealness",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В, С",
    duration: "До 8 часов",
    sourceUrl: "https://next.dnd.su/spells/10498-etherealness",
    summary:
      "Переводит вас в Эфирный план, позволяя проходить сквозь материальные преграды.",
  }),

  // 8 УРОВЕНЬ — 2024

  createBardSpell({
    id: "antipathy-sympathy-2024",
    level: 8,
    name: "Антипатия/симпатия",
    originalName: "Antipathy/Sympathy",
    school: "Очарование",
    castingTime: "1 час",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "10 дней",
    sourceUrl: "https://next.dnd.su/spells/10426-antipathy-sympathy",
    summary:
      "Настраивает объект или существо так, чтобы другие либо избегали его, либо тянулись к нему.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "glibness-2024",
    level: 8,
    name: "Находчивость",
    originalName: "Glibness",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "На себя",
    rangeFeet: 0,
    components: "В",
    duration: "1 час",
    sourceUrl: "https://next.dnd.su/spells/10529-glibness",
    summary:
      "Делает вашу речь сверхъестественно убедительной и почти неуязвимой для магического распознавания лжи.",
  }),

  createBardSpell({
    id: "dominate-monster-2024",
    level: 8,
    name: "Подчинение монстра",
    originalName: "Dominate Monster",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10487-dominate-monster",
    summary:
      "Подчиняет любое существо вашей воле при провале спасброска.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "befuddlement-2024",
    level: 8,
    name: "Помутнение разума",
    originalName: "Befuddlement",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С, М",
    duration: "До 1 минуты",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10440-befuddlement",
    summary:
      "Запутывает разум существ в области, ухудшая их способность действовать и концентрироваться.",
    saveAbility: "intelligence",
  }),

  createBardSpell({
    id: "power-word-stun-2024",
    level: 8,
    name: "Слово силы: ошеломление",
    originalName: "Power Word Stun",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10608-power-word-stun",
    summary:
      "Может немедленно оглушить существо с достаточно низким запасом хитов.",
  }),

  createBardSpell({
    id: "mind-blank-2024",
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
      "Защищает разум существа от психического воздействия, чар и магического чтения мыслей.",
  }),

  // 9 УРОВЕНЬ — 2024

  createBardSpell({
    id: "true-polymorph-2024",
    level: 9,
    name: "Истинное превращение",
    originalName: "True Polymorph",
    school: "Преобразование",
    castingTime: "1 действие",
    range: "30 футов",
    rangeFeet: 30,
    components: "В, С, М",
    duration: "До 1 часа",
    concentration: true,
    sourceUrl: "https://next.dnd.su/spells/10685-true-polymorph",
    summary:
      "Постоянно превращает существо или объект в другое существо или объект при длительной концентрации.",
    saveAbility: "wisdom",
  }),

  createBardSpell({
    id: "foresight-2024",
    level: 9,
    name: "Предвидение",
    originalName: "Foresight",
    school: "Прорицание",
    castingTime: "1 минута",
    range: "Касание",
    components: "В, С, М",
    duration: "8 часов",
    sourceUrl: "https://next.dnd.su/spells/10521-foresight",
    summary:
      "Дарует существу почти безошибочное предчувствие опасности, давая огромные преимущества в бою и вне его.",
  }),

  createBardSpell({
    id: "prismatic-wall-2024",
    level: 9,
    name: "Радужная стена",
    originalName: "Prismatic Wall",
    school: "Ограждение",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В, С",
    duration: "10 минут",
    sourceUrl: "https://next.dnd.su/spells/10612-prismatic-wall",
    summary:
      "Создаёт многослойную магическую стену, каждый слой которой накладывает опасный эффект.",
  }),

  createBardSpell({
    id: "power-word-heal-2024",
    level: 9,
    name: "Слово силы: исцеление",
    originalName: "Power Word Heal",
    school: "Воплощение",
    castingTime: "1 действие",
    range: "Касание",
    components: "В, С",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10606-power-word-heal",
    summary:
      "Мгновенно восстанавливает огромное количество хитов и снимает ряд тяжёлых состояний.",
    healing: {
      dice: null,
      modifier: 70,
    },
  }),

  createBardSpell({
    id: "power-word-kill-2024",
    level: 9,
    name: "Слово силы: смерть",
    originalName: "Power Word Kill",
    school: "Очарование",
    castingTime: "1 действие",
    range: "60 футов",
    rangeFeet: 60,
    components: "В",
    duration: "Мгновенная",
    sourceUrl: "https://next.dnd.su/spells/10607-power-word-kill",
    summary:
      "Немедленно убивает существо, если его запас хитов достаточно низок.",
  }),

  // 3 УРОВЕНЬ — legacy 2014 (Magical Secrets)

  createBardSpell({
    id: "counterspell-2014",
    level: 3,
    name: "Противодействие заклинанию",
    originalName: "Counterspell",
    school: "Ограждение",
    castingTime: "1 реакция",
    range: "60 футов",
    rangeFeet: 60,
    components: "С",
    duration: "Мгновенная",
    sourceUrl: "https://5e14.dnd.su/spells/53-counterspell/",
    summary:
      "Реакцией прерывает накладывание заклинания другим существом, при успехе полностью отменяя его эффект.",
  }),

  createBardSpell({
    id: "spirit-guardians-2014",
    level: 3,
    name: "Духи-хранители",
    originalName: "Spirit Guardians",
    school: "Вызов",
    castingTime: "1 действие",
    range: "На себя (радиус 15 футов)",
    rangeFeet: 0,
    areaShape: "radius",
    areaSizeFeet: 15,
    areaType: "radius",
    components: "В, С, М",
    duration: "До 10 минут",
    concentration: true,
    sourceUrl: "https://5e14.dnd.su/spells/90-spirit-guardians/",
    summary:
      "Вызываете духов-хранителей, наносящих урон существам по вашему выбору в радиусе 15 футов и замедляющих их движение при провале спасброска.",
    damage: {
      dice: "3d8",
      modifier: null,
      type: "радиантный/некротический",
    },
    saveAbility: "wisdom",
  }),
];

export const BARD_SPELL_LIBRARY = mergeSpellVersions(RAW_BARD_SPELL_LIBRARY);

export const BARD_SPELL_LIBRARY_ALL_EDITIONS = [...RAW_BARD_SPELL_LIBRARY];

export const BARD_SPELL_LIBRARY_2024_ONLY = BARD_SPELL_LIBRARY.filter(
  (spell) => spell.edition === "2024",
);