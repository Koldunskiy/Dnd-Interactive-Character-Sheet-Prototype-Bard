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

const SKILL_TO_ABILITY = {
  athletics: "str",
  acrobatics: "dex",
  sleightOfHand: "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  animalHandling: "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

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

function renderSkillBadges(skill) {
  const badges = [];

  if (skill.proficient) badges.push("Владение");
  if (skill.expertise) badges.push("Компетентность");
  if (skill.source === "background") badges.push("Предыстория");
  if (skill.source === "class") badges.push("Класс");

  if (!badges.length) {
    return "";
  }

  return `
    <div class="skill-badges skill-badges--soft">
      ${badges
        .map((badge) => `<span class="skill-badge">${escapeHtml(badge)}</span>`)
        .join("")}
    </div>
  `;
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
  const characterSkills = Array.isArray(character.skills) ? character.skills : [];
  const derivedSkillMap = getDerivedSkillMap(derived);

  const skillsById = new Map(
    characterSkills
      .filter((skill) => skill?.id)
      .map((skill) => [skill.id, skill]),
  );

  return Object.entries(ABILITY_META).map(([abilityId, meta]) => {
    const score = character.abilities?.[abilityId] ?? null;
    const mod =
      derived?.abilityModifiers?.[abilityId] ??
      derived?.abilityMods?.[abilityId] ??
      null;
    const save = derived?.savingThrows?.[abilityId] ?? null;

    const linkedSkills = Object.entries(SKILL_TO_ABILITY)
      .filter(([, abilityKey]) => abilityKey === meta.key)
      .map(([skillId]) => {
        const existingSkill = skillsById.get(skillId);
        const skillName = SKILL_LABELS[skillId] ?? skillId;

        const derivedValue =
          derivedSkillMap?.[skillId] ??
          derivedSkillMap?.[skillName] ??
          mod;

        return {
          id: skillId,
          name: skillName,
          value: derivedValue,
          proficient: Boolean(existingSkill?.proficient),
          expertise: Boolean(existingSkill?.expertise),
          source: existingSkill?.source ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    return {
      id: abilityId,
      short: meta.short,
      label: meta.label,
      score,
      mod,
      checkValue: derived?.abilityChecks?.[abilityId] ?? mod,
      saveValue: save,
      saveProficient: Boolean(character.savingThrows?.[abilityId]?.proficient),
      editable: Boolean(character.ui?.abilitiesEditable),
      linkedSkills,
    };
  });
}

function renderAbilitySkillRow(skill) {
  return `
    <div class="ability-skill-row">
      <div class="ability-skill-main">
        <span class="ability-skill-name">${escapeHtml(skill.name)}</span>

        <div class="skill-toggle-group" aria-label="Уровень владения навыком ${escapeHtml(skill.name)}">
          <button
            type="button"
            class="skill-toggle-btn skill-toggle-btn--compact ${skill.proficient ? "skill-toggle-btn--active" : ""}"
            data-action="skill-toggle"
            data-skill-id="${escapeHtml(skill.id)}"
            data-toggle="proficient"
            aria-pressed="${skill.proficient ? "true" : "false"}"
            aria-label="Владение: ${escapeHtml(skill.name)}"
            title="Владение"
          >
            В
          </button>

          <button
            type="button"
            class="skill-toggle-btn skill-toggle-btn--compact skill-toggle-btn--expertise ${skill.expertise ? "skill-toggle-btn--active" : ""}"
            data-action="skill-toggle"
            data-skill-id="${escapeHtml(skill.id)}"
            data-toggle="expertise"
            aria-pressed="${skill.expertise ? "true" : "false"}"
            aria-label="Экспертиза: ${escapeHtml(skill.name)}"
            title="Экспертиза"
          >
            Э
          </button>
        </div>
      </div>

      <span class="ability-skill-value">${escapeHtml(formatSigned(skill.value))}</span>
    </div>
  `;
}

function renderAbilityCard(card) {
  return `
    <article class="ability-card ability-card--detailed${card.editable ? " stat-card--editable" : ""}">
      <div class="ability-card-top">
        <div class="ability-card-head">
          <div class="ability-card-title-block">
            <span class="ability-card-label">${escapeHtml(card.label)}</span>
            <span class="ability-card-abbr">${escapeHtml(card.short)}</span>
          </div>

          <div class="ability-card-mod-block">
            <div class="ability-card-mod" aria-label="Модификатор ${escapeHtml(card.label)}">
              ${escapeHtml(formatSigned(card.mod))}
            </div>
          </div>
        </div>

        <div class="ability-card-summary-row">
          <div class="ability-card-score-inline">
            <button
              type="button"
              class="ability-adjust-btn"
              data-action="ability-adjust"
              data-ability-id="${escapeHtml(card.id)}"
              data-delta="-1"
              aria-label="Уменьшить ${escapeHtml(card.label)}"
            >
              −
            </button>

            <div class="ability-card-score" aria-label="Значение ${escapeHtml(card.label)}">
              ${escapeHtml(card.score)}
            </div>

            <button
              type="button"
              class="ability-adjust-btn"
              data-action="ability-adjust"
              data-ability-id="${escapeHtml(card.id)}"
              data-delta="1"
              aria-label="Увеличить ${escapeHtml(card.label)}"
            >
              +
            </button>
          </div>
        </div>

        <div class="ability-card-stat-inline">
          <span class="ability-card-stat-label">Проверка</span>
          <strong class="ability-card-stat-value">${escapeHtml(formatSigned(card.checkValue))}</strong>
        </div>

        <div class="ability-card-stat-inline ability-card-stat-inline--save">
          <span class="ability-card-stat-label">Спасбросок</span>
          <strong class="ability-card-stat-value">${escapeHtml(formatSigned(card.saveValue))}</strong>
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
        </div>
      </div>

      <div class="ability-card-skills">
        <div class="ability-card-skills-inner">
          ${
            card.linkedSkills.length
              ? `<div class="ability-skill-list">${card.linkedSkills.map(renderAbilitySkillRow).join("")}</div>`
              : `<p class="empty-copy ability-card-empty">Нет связанных навыков.</p>`
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
        <div>
          <h2 class="section-title">Характеристики</h2>
          <p class="section-subtitle">Базовые значения, спасброски и связанные навыки.</p>
        </div>
      </div>

      <div class="ability-grid">
        ${cards.map(renderAbilityCard).join("")}
      </div>
    </section>
  `;
}

function renderRaceDetails(raceDetails) {
  if (!raceDetails) return "";

  const summaryTraitNames = new Set();

  if (raceDetails.darkvision?.rangeMeters) {
    summaryTraitNames.add("Тёмное зрение");
  }

  if (Array.isArray(raceDetails.resistances) && raceDetails.resistances.length) {
    summaryTraitNames.add("Адское сопротивление");
    summaryTraitNames.add("Сопротивление");
    summaryTraitNames.add("Сопротивления");
  }

  if (raceDetails.lineage) {
    summaryTraitNames.add(raceDetails.lineage);
  }

  const uniqueTraits = (Array.isArray(raceDetails.traits) ? raceDetails.traits : []).filter(
    (trait) => !summaryTraitNames.has(trait?.name),
  );

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
                ? `${raceDetails.darkvision.rangeMeters} м`
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
        uniqueTraits.length
          ? `
            <div class="feature-list">
              ${uniqueTraits
                .map(
                  (trait) => `
                    <article class="feature-card">
                      <h3 class="feature-title">${escapeHtml(trait.name)}</h3>
                      <p class="feature-text">${escapeHtml(trait.text)}</p>
                    </article>
                  `,
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
              <p class="feature-text">
                <strong>${escapeHtml(backgroundDetails.feature.name)}:</strong>
                ${escapeHtml(backgroundDetails.feature.text)}
              </p>
            `
            : ""
        }
      </div>

      ${
        backgroundDetails.persona
          ? `
            <div class="feature-list">
              <article class="feature-card">
                <h3 class="feature-title">Амплуа</h3>
                <p class="feature-text">${escapeHtml(
                  (backgroundDetails.persona.routine ?? []).join(", ") || "—",
                )}</p>
              </article>
              <article class="feature-card">
                <h3 class="feature-title">Черта</h3>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.trait ?? "—")}</p>
              </article>
              <article class="feature-card">
                <h3 class="feature-title">Идеал</h3>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.ideal ?? "—")}</p>
              </article>
              <article class="feature-card">
                <h3 class="feature-title">Привязанность</h3>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.bond ?? "—")}</p>
              </article>
              <article class="feature-card">
                <h3 class="feature-title">Слабость</h3>
                <p class="feature-text">${escapeHtml(backgroundDetails.persona.flaw ?? "—")}</p>
              </article>
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

function renderClassFeatures(features, character) {
  if (!Array.isArray(features) || !features.length) return "";

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Черты и умения</h2>
      </div>

      <div class="feature-list">
        ${features
          .map(
            (feature) => `
              <article class="feature-card">
                <div class="feature-topline">
                  <span class="feature-badge">${escapeHtml(feature.category ?? "Черта")}</span>
                  <span class="feature-level">Уровень ${escapeHtml(feature.level ?? "—")}</span>
                </div>
                <h3 class="feature-title">${escapeHtml(feature.name)}</h3>
                <p class="feature-text">${escapeHtml(feature.text)}</p>
                ${renderFeatureRulesToggle(feature, character)}
              </article>
            `,
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

  const profile = character.profile ?? {};
  const abilityCards = getAbilityCardsData(character, derived);

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

          ${profile.summary ? `<p class="profile-summary">${escapeHtml(profile.summary)}</p>` : ""}

          <div class="profile-hero-stats">
            ${heroStats.join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Характеристики</h2>
      </div>
      <div class="ability-grid">
        ${abilityCards.map(renderAbilityCard).join("")}
      </div>
    </section>

    ${renderRaceDetails(character.raceDetails)}
    ${renderBackgroundDetails(character.backgroundDetails)}
    ${renderClassFeatures(character.classFeatures, character)}
  `;
}