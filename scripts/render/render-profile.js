import { getFeatureReference, getRaceTraitReference } from "../rule-reference.js";

const ABILITY_META = {
  strength: { key: "str", short: "STR", label: "Сила" },
  dexterity: { key: "dex", short: "DEX", label: "Ловкость" },
  constitution: { key: "con", short: "CON", label: "Телосложение" },
  intelligence: { key: "int", short: "INT", label: "Интеллект" },
  wisdom: { key: "wis", short: "WIS", label: "Мудрость" },
  charisma: { key: "cha", short: "CHA", label: "Харизма" },
};

const SKILL_LABELS = {
  athletics: "Атлетика",
  acrobatics: "Акробатика",
  sleightOfHand: "Ловкость рук",
  stealth: "Скрытность",
  arcana: "Магия",
  history: "История",
  investigation: "Расследование",
  nature: "Природа",
  religion: "Религия",
  animalHandling: "Уход за животными",
  insight: "Проницательность",
  medicine: "Медицина",
  perception: "Восприятие",
  survival: "Выживание",
  deception: "Обман",
  intimidation: "Запугивание",
  performance: "Выступление",
  persuasion: "Убеждение",
};

let profileDisclosureMediaQuery = null;
let currentDisclosureCharacterId = null;
const profileDisclosureStates = new Map();

function getProfileDisclosureState() {
  return new Map(
    [...document.querySelectorAll("details[data-profile-disclosure]")].map(
      (details) => [details.dataset.profileDisclosure, details.open],
    ),
  );
}

function applyProfileDisclosureState(previousState, characterId) {
  if (!profileDisclosureMediaQuery) {
    profileDisclosureMediaQuery = window.matchMedia("(max-width: 899px)");
    const updateForViewport = (event) => {
      document
        .querySelectorAll("details[data-profile-disclosure]")
        .forEach((details) => {
          details.open = !event.matches;
        });
    };

    if (typeof profileDisclosureMediaQuery.addEventListener === "function") {
      profileDisclosureMediaQuery.addEventListener("change", updateForViewport);
    } else {
      profileDisclosureMediaQuery.addListener(updateForViewport);
    }
  }

  const useDefaults = !profileDisclosureStates.has(characterId);
  document
    .querySelectorAll("details[data-profile-disclosure]")
    .forEach((details) => {
      const key = details.dataset.profileDisclosure;
      details.open =
        !useDefaults && previousState.has(key)
          ? previousState.get(key)
          : !profileDisclosureMediaQuery.matches;
    });
  profileDisclosureStates.set(characterId, new Map(
    [...document.querySelectorAll("details[data-profile-disclosure]")].map((details) =>
      [details.dataset.profileDisclosure, details.open]),
  ));
  currentDisclosureCharacterId = characterId;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSigned(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return value >= 0 ? `+${value}` : `${value}`;
}

function renderTag(text) {
  return `<span class="profile-tag">${escapeHtml(text)}</span>`;
}

function getDerivedSkillMap(derived) {
  if (!derived || typeof derived !== "object") {
    return {};
  }

  return (
    derived.skillValues ??
    derived.skills ??
    derived.skillMap ??
    derived.derivedSkills ??
    {}
  );
}

function getAbilityCardsData(character, derived) {
  return Object.entries(ABILITY_META).map(([abilityId, meta]) => {
    const score = character.abilities?.[abilityId] ?? null;
    const mod =
      derived?.abilityModifiers?.[abilityId] ??
      derived?.abilityMods?.[abilityId] ??
      null;
    const save = derived?.savingThrows?.[abilityId] ?? null;

    return {
      id: abilityId,
      short: meta.short,
      label: meta.label,
      score,
      effectiveScore: derived?.abilities?.[abilityId] ?? score,
      mod,
      checkValue: derived?.abilityChecks?.[abilityId] ?? mod,
      saveValue: save,
      saveProficient: Boolean(character.savingThrows?.[abilityId]?.proficient),
      editable: Boolean(character.ui?.abilitiesEditable),
      characterId: character.profile?.id,
    };
  });
}

function renderAbilityCard(card) {
  const canEdit = card.editable &&
    (card.characterId !== "sara-velaris" || card.id === "constitution");
  return `
    <article class="ability-card profile-ability-card">
      <div class="ability-card-top">
        <div class="ability-card-head">
          <div class="ability-card-title-block">
            <span class="ability-card-label">${escapeHtml(card.label)}</span>
            <span class="ability-card-abbr">${escapeHtml(card.short)}</span>
          </div>

          <div class="ability-card-mod-block">
            <span class="ability-card-mod-label">Модификатор</span>
            <div class="ability-card-mod" aria-label="Модификатор ${escapeHtml(card.label)}">
              ${escapeHtml(formatSigned(card.mod))}
            </div>
          </div>
        </div>

        <div class="ability-card-summary-row">
          <div class="ability-card-score-inline">
            ${canEdit ? `<button type="button" class="ability-adjust-btn" data-action="ability-adjust" data-ability-id="${escapeHtml(card.id)}" data-delta="-1" aria-label="Уменьшить ${escapeHtml(card.label)}">−</button>` : ""}

            <div class="ability-card-score" aria-label="Значение ${escapeHtml(card.label)}">
              ${escapeHtml(card.score)}
            </div>
            ${card.effectiveScore !== card.score
              ? `<span class="ability-card-stat-label">С учётом предмета: ${escapeHtml(card.effectiveScore)}</span>`
              : ""}

            ${canEdit ? `<button type="button" class="ability-adjust-btn" data-action="ability-adjust" data-ability-id="${escapeHtml(card.id)}" data-delta="1" aria-label="Увеличить ${escapeHtml(card.label)}">+</button>` : ""}
          </div>
        </div>

        <div class="ability-card-stat-inline">
          <span class="ability-card-stat-label">Проверка</span>
          <strong class="ability-card-stat-value">${escapeHtml(formatSigned(card.checkValue))}</strong>
          ${card.characterId === "sara-velaris" ? `<button type="button" class="btn btn--utility profile-roll-button" data-open-character-roll data-roll-kind="ability-check" data-roll-id="${escapeHtml(card.id)}">Бросить</button>` : ""}
        </div>

        <div class="ability-card-stat-inline ability-card-stat-inline--save">
          <span class="ability-card-stat-label">Спасбросок</span>
          <strong class="ability-card-stat-value">${escapeHtml(formatSigned(card.saveValue))}</strong>
          ${card.characterId === "sara-velaris" ? `<button type="button" class="btn btn--utility profile-roll-button" data-open-character-roll data-roll-kind="saving-throw" data-roll-id="${escapeHtml(card.id)}">Бросить</button>` : ""}
          ${
            card.editable
              ? `
          <button
            type="button"
            class="save-toggle-btn ${card.saveProficient ? "save-toggle-btn--active" : ""}"
            data-action="saving-throw-toggle"
            data-ability-id="${escapeHtml(card.id)}"
            aria-pressed="${card.saveProficient ? "true" : "false"}"
            aria-label="Владение спасброском ${escapeHtml(card.label)}"
            title="Владение спасброском"
          >
            В
          </button>
              `
              : `<span class="save-proficiency-indicator">${card.saveProficient ? "Владение" : ""}</span>`
          }
        </div>
      </div>
    </article>
  `;
}

function renderFeatureToggle({
  label,
  action,
  enabled,
  title,
}) {
  return `
    <div class="feature-toggle-row">
      <span class="feature-toggle-label">${escapeHtml(label)}</span>
      <button
        type="button"
        class="feature-toggle-btn ${enabled ? "feature-toggle-btn--active" : ""}"
        data-action="${escapeHtml(action)}"
        aria-pressed="${enabled ? "true" : "false"}"
        aria-label="${escapeHtml(`${title}: ${enabled ? "включён" : "выключен"}`)}"
        title="${escapeHtml(title)}"
      >
        ${enabled ? "Вкл" : "Выкл"}
      </button>
    </div>
  `;
}

function renderAbilitiesSection(character, derived) {
  const cards = getAbilityCardsData(character, derived);

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Характеристики</h2>
      </div>

      <div class="profile-ability-grid">
        ${cards.map(renderAbilityCard).join("")}
      </div>
    </section>
  `;
}

const SKILL_GROUPS = [
  ["strength", "Сила", ["athletics"]],
  ["dexterity", "Ловкость", ["acrobatics", "sleightOfHand", "stealth"]],
  ["intelligence", "Интеллект", ["arcana", "history", "investigation", "nature", "religion"]],
  ["wisdom", "Мудрость", ["animalHandling", "insight", "medicine", "perception", "survival"]],
  ["charisma", "Харизма", ["deception", "intimidation", "performance", "persuasion"]],
];

function renderSkillCard(skillId, character, derived) {
  const skill = (character.skills ?? []).find((entry) => entry.id === skillId) ?? {};
  const skillValues = getDerivedSkillMap(derived);
  const value = skillValues[skillId] ?? skillValues[SKILL_LABELS[skillId]] ?? 0;
  const editable = Boolean(character.ui?.abilitiesEditable);
  const status = skill.expertise ? "Экспертность" : skill.proficient ? "Владение" : "";
  return `
    <article class="profile-skill-card">
      <div class="profile-skill-card-main">
        <button type="button" class="profile-skill-name profile-roll-link" data-open-character-roll data-roll-kind="ability-check" data-roll-id="${escapeHtml(skillId)}">${escapeHtml(SKILL_LABELS[skillId])}</button>
        ${status ? `<span class="profile-skill-status">${escapeHtml(status)}</span>` : ""}
      </div>
      <strong class="profile-skill-value">${escapeHtml(formatSigned(value))}</strong>
      ${editable ? `
        <div class="profile-skill-controls">
          <button type="button" class="skill-toggle-btn ${skill.proficient ? "skill-toggle-btn--active" : ""}" data-action="skill-toggle" data-skill-id="${escapeHtml(skillId)}" data-toggle="proficient" aria-pressed="${Boolean(skill.proficient)}" aria-label="Владение: ${escapeHtml(SKILL_LABELS[skillId])}">Владение</button>
          <button type="button" class="skill-toggle-btn ${skill.expertise ? "skill-toggle-btn--active" : ""}" data-action="skill-toggle" data-skill-id="${escapeHtml(skillId)}" data-toggle="expertise" aria-pressed="${Boolean(skill.expertise)}" aria-label="Экспертность: ${escapeHtml(SKILL_LABELS[skillId])}">Экспертность</button>
        </div>
      ` : ""}
    </article>
  `;
}

function renderSkillsSection(character, derived) {
  const skillValues = getDerivedSkillMap(derived);
  const passiveValue = (id) => 10 + Number(skillValues[id] ?? 0);
  const editable = Boolean(character.ui?.abilitiesEditable);
  return `
    <section class="panel-section profile-skills-panel">
      <div class="section-heading-row">
        <div><h2 class="section-title">Навыки</h2><p class="section-subtitle">Все навыки персонажа</p></div>
        <button type="button" class="btn btn--utility profile-edit-toggle" data-action="toggle-abilities-edit">${editable ? "Готово" : "Изменить"}</button>
      </div>
      <div class="profile-skill-groups">
        ${SKILL_GROUPS.map(([id, label, skillIds]) => `
          <section class="profile-skill-group" aria-labelledby="skill-group-${id}">
            <h3 id="skill-group-${id}">${label}</h3>
            <div class="profile-skill-grid">${skillIds.map((skillId) => renderSkillCard(skillId, character, derived)).join("")}</div>
          </section>
        `).join("")}
      </div>
      <section class="profile-passives">
        <h3>Пассивные проверки</h3>
        <div class="profile-passive-grid">
          <div><span>Восприятие</span><strong>${passiveValue("perception")}</strong></div>
          <div><span>Проницательность</span><strong>${passiveValue("insight")}</strong></div>
          <div><span>Расследование</span><strong>${passiveValue("investigation")}</strong></div>
        </div>
      </section>
    </section>
  `;
}

function renderRaceDetails(raceDetails) {
  if (!raceDetails) return "";

  const traits = Array.isArray(raceDetails.traits) ? raceDetails.traits : [];

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Наследие</h2>
      </div>

      <div class="info-grid">
        <div class="info-card">
          <div class="info-label">Раса</div>
          <div class="info-value">${escapeHtml(raceDetails.name)}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Подраса</div>
          <div class="info-value">${escapeHtml(raceDetails.subrace ?? "—")}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Наследие</div>
          <div class="info-value">${escapeHtml(raceDetails.lineage ?? "—")}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Языки</div>
          <div class="info-value">${escapeHtml((raceDetails.languages ?? []).join(", ") || "—")}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Тёмное зрение</div>
          <div class="info-value">${
            escapeHtml(
              raceDetails.darkvision?.rangeMeters
                ? `${raceDetails.darkvision.rangeFeet ?? 60} футов / ${raceDetails.darkvision.rangeMeters} м. ${raceDetails.darkvision.notes ?? ""}`
                : "—",
            )
          }</div>
        </div>
        <div class="info-card">
          <div class="info-label">Сопротивления</div>
          <div class="info-value">${escapeHtml((raceDetails.resistances ?? []).join(", ") || "—")}</div>
        </div>
      </div>

      ${
        traits.length
          ? `
            <div class="feature-list">
              ${traits
                .map(
                  (trait, index) => {
                    const reference = getRaceTraitReference(trait);
                    return `
                    <details
                      class="feature-card profile-responsive-disclosure"
                      data-profile-disclosure="race-trait-${index}"
                      open
                    >
                      <summary class="profile-disclosure-summary profile-feature-summary">
                        <span class="feature-title" role="heading" aria-level="3">${escapeHtml(trait.name)}</span>
                      </summary>
                      <p class="feature-text">${escapeHtml(reference ?? trait.text)}</p>
                      ${reference && trait.text ? `<details class="profile-text-disclosure"><summary>Текст записи</summary><p class="feature-text">${escapeHtml(trait.text)}</p></details>` : ""}
                    </details>
                    `;
                  },
                )
                .join("")}
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderBackgroundDetails(backgroundDetails) {
  if (!backgroundDetails) return "";

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Предыстория</h2>
      </div>

      <div class="feature-card">
        <h3 class="feature-title">${escapeHtml(backgroundDetails.name)}</h3>
        <p class="feature-text">
          Владение навыками: ${escapeHtml(
            (backgroundDetails.proficiencies?.skills ?? []).join(", ") || "—",
          )}.
        </p>
        <p class="feature-text">
          Владение инструментами: ${escapeHtml(
            (backgroundDetails.proficiencies?.tools ?? []).join(", ") || "—",
          )}.
        </p>
        ${
          backgroundDetails.feature
            ? `
              <details
                class="profile-text-disclosure profile-responsive-disclosure"
                data-profile-disclosure="background-feature"
                open
              >
                <summary class="profile-disclosure-summary">
                  <span class="feature-title" role="heading" aria-level="3">${escapeHtml(backgroundDetails.feature.name)}</span>
                </summary>
                ${
                  backgroundDetails.feature.name === "По многочисленным просьбам"
                    ? `<p class="feature-text">Может найти место для выступления. Если выступает каждый вечер, обычно получает бесплатную скромную или комфортную пищу и ночлег в зависимости от заведения, местную узнаваемость и доброжелательное отношение. Это не гарантирует проверок общения и не создаёт автоматический доход.</p><details class="profile-text-disclosure"><summary>Текст записи</summary><p class="feature-text">${escapeHtml(backgroundDetails.feature.text)}</p></details>`
                    : `<p class="feature-text">${escapeHtml(backgroundDetails.feature.text)}</p>`
                }
              </details>
            `
            : ""
        }
      </div>

      ${
        backgroundDetails.persona
          ? `
            <div class="feature-list">
              <details
                class="feature-card profile-responsive-disclosure"
                data-profile-disclosure="background-persona-routine"
                open
              >
                <summary class="profile-disclosure-summary profile-feature-summary">
                  <span class="feature-title" role="heading" aria-level="3">Амплуа</span>
                </summary>
                <p class="feature-text">${escapeHtml(
                  (backgroundDetails.persona.routine ?? []).join(", ") || "—",
                )}</p>
              </details>
              <details
                class="feature-card profile-responsive-disclosure"
                data-profile-disclosure="background-persona-trait"
                open
              >
                <summary class="profile-disclosure-summary profile-feature-summary">
                  <span class="feature-title" role="heading" aria-level="3">Черта</span>
                </summary>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.trait ?? "—")}</p>
              </details>
              <details
                class="feature-card profile-responsive-disclosure"
                data-profile-disclosure="background-persona-ideal"
                open
              >
                <summary class="profile-disclosure-summary profile-feature-summary">
                  <span class="feature-title" role="heading" aria-level="3">Идеал</span>
                </summary>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.ideal ?? "—")}</p>
              </details>
              <details
                class="feature-card profile-responsive-disclosure"
                data-profile-disclosure="background-persona-bond"
                open
              >
                <summary class="profile-disclosure-summary profile-feature-summary">
                  <span class="feature-title" role="heading" aria-level="3">Привязанность</span>
                </summary>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.bond ?? "—")}</p>
              </details>
              <details
                class="feature-card profile-responsive-disclosure"
                data-profile-disclosure="background-persona-flaw"
                open
              >
                <summary class="profile-disclosure-summary profile-feature-summary">
                  <span class="feature-title" role="heading" aria-level="3">Слабость</span>
                </summary>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.flaw ?? "—")}</p>
              </details>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderFeatureRulesToggle(feature, character) {
  const featureName = String(feature?.name || "").trim();
  const rulesOverrides = character?.ui?.rulesOverrides ?? {};

  if (featureName === "Мастер на все руки") {
    return renderFeatureToggle({
      label: "Учитывать в расчётах",
      action: "toggle-jack-of-all-trades",
      enabled: !Boolean(rulesOverrides.disableJackOfAllTrades),
      title: "Мастер на все руки",
    });
  }

  if (featureName === "Боевой стиль: Дуэлянт") {
    return renderFeatureToggle({
      label: "Учитывать в расчётах",
      action: "toggle-dueling-style",
      enabled: !Boolean(rulesOverrides.disableDuelingStyle),
      title: "Боевой стиль: Дуэлянт",
    });
  }

  return "";
}

function renderClassFeatures(features, character, derived) {
  const projectedFeatures = Array.isArray(features) ? [...features] : [];
  const level = Number(character.profile?.level ?? 1);
  if (level >= 6 && !projectedFeatures.some((feature) =>
    ["Контрчары", "Countercharm"].includes(feature.name),
  )) {
    projectedFeatures.push({
      id: "countercharm-reference",
      level: 6,
      category: "Класс",
      name: "Контрчары",
      text: "",
    });
  }
  if (!projectedFeatures.length) return "";

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Черты и умения</h2>
      </div>

      <div class="feature-list">
        ${projectedFeatures
          .map(
            (feature, index) => {
              const reference = getFeatureReference(feature, character, derived);
              return `
                <details
                  class="feature-card profile-responsive-disclosure"
                  data-profile-disclosure="class-feature-${index}"
                  open
                >
                  <summary class="profile-disclosure-summary profile-feature-summary">
                    <span class="feature-topline">
                      <span class="feature-badge">${escapeHtml(feature.category ?? "Черта")}</span>
                      <span class="feature-level">Уровень ${escapeHtml(feature.level ?? "—")}</span>
                    </span>
                    <span class="feature-title" role="heading" aria-level="3">${escapeHtml(feature.name)}</span>
                  </summary>
                  ${
                    reference
                      ? `<p class="feature-text"><strong>${escapeHtml(reference.headline)}</strong></p><details class="profile-text-disclosure"><summary>Правило</summary><p class="feature-text">${escapeHtml(reference.details)}</p></details>${feature.text ? `<details class="profile-text-disclosure"><summary>Сохранённый текст записи</summary><p class="feature-text">${escapeHtml(feature.text)}</p></details>` : ""}`
                      : `<p class="feature-text">${escapeHtml(feature.text)}</p>`
                  }
                  ${renderFeatureRulesToggle(feature, character)}
                </details>
              `;
            },
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLevelControl(level) {
  const safeLevel = Math.max(1, Number(level ?? 1));

  return `
    <div class="hero-stat-card hero-stat-card--level-control">
      <div class="hero-stat-label">Уровень</div>

      <div class="level-stat-row" aria-label="Управление уровнем персонажа">
        <div class="hero-stat-value level-stat-row__value">
          ${escapeHtml(safeLevel)}
        </div>

        <div class="level-stat-row__controls">
          <button
            type="button"
            class="level-inline-btn"
            data-action="level-adjust"
            data-delta="1"
            aria-label="Повысить уровень"
            title="Повысить уровень"
          >
            ▴
          </button>

          <button
            type="button"
            class="level-inline-btn"
            data-action="level-adjust"
            data-delta="-1"
            aria-label="Понизить уровень"
            title="Понизить уровень"
          >
            ▾
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderHeroStat(label, value) {
  return `
    <div class="hero-stat-card">
      <div class="hero-stat-label">${escapeHtml(label)}</div>
      <div class="hero-stat-value">${escapeHtml(value ?? "—")}</div>
    </div>
  `;
}

export function renderProfile(root, character, derived) {
  if (!root) return;

  if (currentDisclosureCharacterId) {
    profileDisclosureStates.set(currentDisclosureCharacterId, getProfileDisclosureState());
  }
  const characterId = character.profile?.id ?? "aurelia";
  const disclosureState = profileDisclosureStates.get(characterId) ?? new Map();
  const profile = character.profile ?? {};

  const heroStats = [
    renderLevelControl(profile.level),
    renderHeroStat("КД", derived?.armorClass ?? "—"),
    renderHeroStat("Хиты", derived?.maxHitPoints ?? "—"),
    renderHeroStat("Бонус мастерства", formatSigned(derived?.proficiencyBonus)),
    renderHeroStat("Инициатива", derived?.formattedInitiative ?? "—"),
    renderHeroStat("Пассивная внимательность", derived?.passivePerception ?? "—"),
    renderHeroStat("Сл заклинаний", derived?.spellSaveDc ?? derived?.spellStats?.spellSaveDc ?? "—"),
    renderHeroStat(
      "Атака заклинанием",
      derived?.formattedSpellAttackBonus ?? derived?.spellStats?.spellAttackBonus ?? "—",
    ),
  ];

  root.innerHTML = `
    <section class="panel-section panel-section--hero">
      <div class="profile-hero">
        <div class="profile-hero-main">
          <div class="profile-name-row">
            <h1 class="profile-name">${escapeHtml(profile.name ?? "Безымянный персонаж")}</h1>
          </div>

          <div class="profile-tag-row">
            ${renderTag(profile.race ?? "—")}
            ${profile.subrace ? renderTag(profile.subrace) : ""}
            ${renderTag(profile.className ?? "—")}
            ${profile.subclass ? renderTag(profile.subclass) : ""}
            ${profile.background ? renderTag(profile.background) : ""}
            ${profile.alignment ? renderTag(profile.alignment) : ""}
          </div>

          <div class="profile-hero-stats">
            ${heroStats.join("")}
          </div>
        </div>
      </div>
    </section>

    ${renderAbilitiesSection(character, derived)}
    ${renderSkillsSection(character, derived)}
    ${
      profile.summary
        ? `<details class="profile-summary-disclosure profile-responsive-disclosure" data-profile-disclosure="hero-summary" open><summary class="profile-disclosure-summary">Описание персонажа</summary><p class="profile-summary">${escapeHtml(profile.summary)}</p></details>`
        : ""
    }

    ${renderRaceDetails(character.raceDetails)}
    ${renderBackgroundDetails(character.backgroundDetails)}
    ${renderClassFeatures(character.classFeatures, character, derived)}
  `;

  applyProfileDisclosureState(disclosureState, characterId);
}