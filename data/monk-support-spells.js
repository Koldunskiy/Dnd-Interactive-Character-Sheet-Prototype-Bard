export const MONK_RACIAL_SPELLS = Object.freeze([
  {
    id: "poison-spray-2014",
    name: "Poison Spray",
    source: "racial",
    mode: "cantrip",
    action: "action",
    range: "10 футов",
    components: ["V", "S"],
    save: "constitution",
    damage: "1/2/3/4d12 poison на уровнях 1/5/11/17; при успехе 0",
    description: "Видимое существо в пределах 10 футов совершает спасбросок Телосложения. Не является действием Attack и не запускает бонусный безоружный удар."
  },
  {
    id: "animal-friendship-2014",
    name: "Animal Friendship",
    source: "racial",
    mode: "at-will-racial",
    action: "action",
    range: "30 футов",
    components: ["V", "S", "M: пища"],
    duration: "24 часа",
    save: "wisdom",
    description: "Только видимая змея-зверь, которая видит и слышит вас; цель с INT ≥ 4 не подвержена. Спасбросок Мудрости; провал — очарована. Эффект заканчивается, если Сара или её спутники наносят ей вред. Без концентрации; без лимита применений и Ki."
  },
  {
    id: "suggestion-2014",
    name: "Suggestion",
    source: "racial",
    mode: "limited-racial",
    action: "action",
    range: "30 футов",
    concentration: true,
    components: ["V", "M: язык змеи и медовые соты или капля масла"],
    duration: "Концентрация, до 8 часов",
    save: "wisdom",
    uses: { max: 1, refresh: "long-rest" },
    description: "Видимая цель, слышащая и понимающая Сару, совершает спасбросок Мудрости; существа с иммунитетом к очарованию не затрагиваются. Предложение должно быть разумным и занимать 1–2 предложения; явно вредное не работает. Завершение задачи, урон Саре/спутникам прекращают эффект. Одно применение за долгий отдых; нет расхода Ki или ячейки."
  }
]);

export const MONK_SUPPORT_SPELLS = Object.freeze([
  ...MONK_RACIAL_SPELLS,
  {
    id: "summon-celestial-tce",
    name: "Summon Celestial",
    source: "laserllama-expanded",
    mode: "technique-granted",
    level: 5,
    concentration: true,
    description: "Поддерживающая запись для Conjure Previous Life. Summon Celestial TCE, только Defender; выбранный монахом Medium humanoid, без материального компонента. Не показывать в обычной библиотеке Аурелии."
  },
  {
    id: "commune-2014",
    name: "Commune",
    source: "laserllama-core",
    mode: "technique-granted",
    level: 5,
    description: "Поддерживающая запись для Commune with Self; ответы на до трёх вопросов да/нет выдаёт мастер."
  },
  {
    id: "commune-with-nature-2014",
    name: "Commune with Nature",
    source: "laserllama-core",
    mode: "technique-granted",
    level: 5,
    description: "Поддерживающая запись для Friend of Beast and Leaf; результаты об окружающей природе выдаёт мастер."
  }
]);
