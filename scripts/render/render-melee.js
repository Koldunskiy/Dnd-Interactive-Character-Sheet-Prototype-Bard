import {
  escapeHtml,
  formatSpellLevel,
  renderSpellFacts,
  renderTextParagraph,
  renderSpellBody,
  renderSpellCardHeader,
  renderSpellSummaryLine,
  getSpellGeometryFactItem,
} from "./shared/spell-card.js";

const EMPTY_COMBAT_CARDS = Object.freeze({
  weapons: [],
  features: [],
  spells: [],
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function renderPipTrack({ total, active, action, itemData = {} }) {
  const safeTotal = Math.max(0, Number(total || 0));
  const safeActive = clamp(Number(active || 0), 0, safeTotal);

  return `
    <div class="resource-pip-track">
      ${Array.from({ length: safeTotal }, (_, index) => {
        const pipIndex = index + 1;
        const isActive = pipIndex <= safeActive;

        const attrs = Object.entries(itemData)
          .map(([key, value]) => `data-${key}="${escapeHtml(String(value))}"`)
          .join(" ");

        return `
          <button
            type="button"
            class="resource-pip ${isActive ? "resource-pip--active" : ""}"
            data-action="${escapeHtml(action)}"
            data-charge-index="${pipIndex}"
            ${attrs}
            aria-label="Установить значение ${pipIndex} из ${safeTotal}"
            aria-pressed="${isActive ? "true" : "false"}"
          ></button>
        `;
      }).join("")}
    </div>
  `;
}

function renderSlotPips(slot) {
  const level = Number(slot?.level || 0);
  const max = Math.max(0, Number(slot?.max || 0));
  const available = clamp(Number(slot?.available || 0), 0, max);

  return `
    <div class="resource-row">
      <div class="resource-row-main">
        <span class="resource-row-title">${level} круг</span>
        <span class="resource-row-meta">${available}/${max} доступно</span>
      </div>

      <div class="resource-pip-track">
        ${Array.from({ length: max }, (_, index) => {
          const pipIndex = index + 1;
          const isActive = pipIndex <= available;

          return `
            <button
              type="button"
              class="resource-pip ${isActive ? "resource-pip--active" : ""}"
              data-action="slot-set-used"
              data-slot-level="${level}"
              data-slot-index="${pipIndex}"
              aria-label="Установить доступные ячейки ${pipIndex} из ${max} для ${level} круга"
              aria-pressed="${isActive ? "true" : "false"}"
            ></button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderBardicPips(bardic) {
  const total = Math.max(0, Number(bardic?.max || 0));
  const current = clamp(Number(bardic?.current || 0), 0, total);

  return `
    <div class="resource-row">
      <div class="resource-row-main">
        <span class="resource-row-title">Бардское вдохновение</span>
        <span class="resource-row-meta">${current}/${total} доступно</span>
      </div>

      ${renderPipTrack({
        total,
        active: current,
        action: "bardic-set-current",
      })}
    </div>
  `;
}

function renderTurnTracker(derived) {
  const turn = derived?.turnTracker ?? {
    turnNumber: 1,
    items: [],
  };

  const actionMap = {
    actionUsed: "turn-toggle-action",
    bonusActionUsed: "turn-toggle-bonus-action",
    reactionUsed: "turn-toggle-reaction",
  };

  const renderTurnPill = (item) => `
    <button
      type="button"
      class="turn-pill ${item.used ? "turn-pill--used" : "turn-pill--ready"}"
      data-action="${actionMap[item.key]}"
      aria-pressed="${item.used ? "true" : "false"}"
    >
      <span class="turn-pill-label">${escapeHtml(item.label)}</span>
      <span class="turn-pill-state">${escapeHtml(item.stateLabel)}</span>
    </button>
  `;

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <div>
          <div class="eyebrow">Ход</div>
          <h2 class="section-title">Экономика хода</h2>
          <p class="section-subtitle">
            Отмечай действие, бонусное действие и реакцию прямо во время боя.
          </p>
        </div>
        <div class="turn-round-indicator">Ход ${Math.max(1, Number(turn.turnNumber || 1))}</div>
      </div>

      <div class="turn-tracker">
        ${(turn.items || []).map(renderTurnPill).join("")}
        <button
          type="button"
          class="btn btn--utility turn-end-btn"
          data-action="turn-end"
        >
          Завершить ход
        </button>
      </div>
    </section>
  `;
}

function renderHpCard(state, derived) {
  const maxHp = Math.max(0, Number(derived?.maxHitPoints ?? derived?.maxHp ?? 0));
  const currentHp = clamp(Number(state?.combat?.hp?.current || 0), 0, maxHp || 0);
  const tempHp = Math.max(0, Number(state?.combat?.hp?.temp || 0));
  const hpAdjustAmount = Math.max(0, Number(state?.ui?.hpAdjustAmount || 0));

  const hpPercent = maxHp > 0 ? Math.round((currentHp / maxHp) * 100) : 0;
  const safeHpPercent = clamp(hpPercent, 0, 100);

  const isCritical = safeHpPercent <= 25;
  const isWounded = safeHpPercent > 25 && safeHpPercent <= 50;

  return `
    <article class="resource-card resource-card--hp ${isCritical ? "resource-card--critical" : ""} ${isWounded ? "resource-card--wounded" : ""}">
      <div class="resource-card-header">
        <div class="resource-card-title-wrap">
          <div class="resource-card-icon" aria-hidden="true">❤</div>
          <div>
            <div class="eyebrow">Выживаемость</div>
            <h3 class="resource-card-title">Хиты</h3>
          </div>
        </div>

        <div class="resource-card-value">${currentHp}/${maxHp}</div>
      </div>

      <div class="hp-bar" aria-hidden="true">
        <div class="hp-bar-fill" style="width: ${safeHpPercent}%"></div>
      </div>

      <div class="resource-row resource-row--hp-meta">
        <span class="resource-row-title">Состояние</span>
        <span class="resource-row-meta">
          ${isCritical ? "Критическое" : isWounded ? "Ранен" : "Стабильно"}
        </span>
      </div>

      <label class="field-label">
        <span>Временные хиты</span>
        <input
          class="input"
          type="number"
          min="0"
          data-bind="combat.hp.temp"
          value="${escapeHtml(String(tempHp))}"
        />
      </label>

      <div class="hp-adjust-block">
        <label class="hp-adjust-field">
          <span class="hp-adjust-label">Количество хитов</span>
          <input
            class="input input--compact"
            type="number"
            min="0"
            data-bind="ui.hpAdjustAmount"
            data-bind-immediate="true"
            value="${escapeHtml(String(hpAdjustAmount))}"
          />
        </label>

        <div class="hp-adjust-actions">
          <button type="button" class="btn btn--utility hp-action-btn" data-action="hp-apply-damage">
            Урон
          </button>

          <button type="button" class="btn btn--utility hp-action-btn" data-action="hp-apply-heal">
            Лечение
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderCombatResources(state, derived) {
  const concentration = state?.combat?.concentration || "";
  const slots = Array.isArray(derived?.spellSlots) ? derived.spellSlots : [];
  const bardic = derived?.bardicInspiration || null;

  return `
    <section class="panel-section">
      <div class="section-heading-row">
        <div>
          <div class="eyebrow">Бой</div>
          <h2 class="section-title">Боевые ресурсы</h2>
          <p class="section-subtitle">
            Всё, что нужно быстро менять прямо в бою: хиты, временные хиты, ячейки, вдохновение и концентрация.
          </p>
        </div>
      </div>

      <div class="combat-resource-grid">
        ${renderHpCard(state, derived)}

        <article class="resource-card">
          <div class="resource-card-header">
            <div>
              <div class="eyebrow">Магия</div>
              <h3 class="resource-card-title">Ячейки заклинаний</h3>
            </div>
          </div>

          <div class="resource-stack">
            ${slots.map((slot) => renderSlotPips(slot)).join("")}
          </div>
        </article>

        <article class="resource-card">
          <div class="resource-card-header">
            <div>
              <div class="eyebrow">Класс</div>
              <h3 class="resource-card-title">Бардское вдохновение</h3>
            </div>
            <div class="resource-card-subtle">${escapeHtml(derived?.bardicInspiration?.dice || "")}</div>
          </div>

          <div class="resource-stack">
            ${bardic ? renderBardicPips(bardic) : `<p class="empty-copy">Ресурс не задан.</p>`}
          </div>
        </article>

        <article class="resource-card">
          <div class="resource-card-header">
            <div>
              <div class="eyebrow">Контроль</div>
              <h3 class="resource-card-title">Концентрация</h3>
            </div>
          </div>

          <label class="field-label">
            <span>Текущая концентрация</span>
            <input
              class="input"
              type="text"
              placeholder="Например, Безудержный смех"
              data-bind="combat.concentration"
              value="${escapeHtml(concentration)}"
            />
          </label>

          <div class="resource-controls">
            <button type="button" class="btn btn--utility" data-action="concentration-clear">
              Сбросить
            </button>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderCardActions(card) {
  if (card.kind === "weapon") {
    return `
      <div class="combat-card-actions">
        <button
          type="button"
          class="btn btn--utility"
          data-action="weapon-attack"
          data-weapon-id="${escapeHtml(card.id || "")}"
        >
          Атаковать
        </button>
      </div>
    `;
  }

  if (card.kind === "spell") {
    const isBonusAction = String(card.castTime || "")
      .toLowerCase()
      .includes("бонусное действие");

    const slotLevel = Number(card.level || 0);
    const attrs = [
      `data-action="spell-cast"`,
      `data-spell-id="${escapeHtml(card.spellId || "")}"`,
      `data-spell-level="${slotLevel}"`,
      `data-cast-time="${escapeHtml(card.castTime || "")}"`,
      card.concentration ? `data-sets-concentration="true"` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="combat-card-actions">
        <button type="button" class="btn btn--utility" ${attrs}>
          ${isBonusAction ? "Сотворить (бонусное)" : "Сотворить"}
        </button>
      </div>
    `;
  }

  if (card.kind === "feature" && String(card.title || "").toLowerCase().includes("росчерк")) {
    return `
      <div class="combat-card-actions">
        <button
          type="button"
          class="btn btn--utility"
          data-action="bardic-use"
          data-mark-bonus-action="false"
          data-resource-source="flourish"
          data-feature-id="${escapeHtml(card.id || "")}"
        >
          Потратить вдохновение
        </button>
      </div>
    `;
  }

  return "";
}

function renderTags(tags = []) {
  if (!tags.length) {
    return "";
  }

  return `
    <div class="skill-badges skill-badges--spaced">
      ${tags
        .map((tag) => `<span class="skill-badge skill-badge--base">${escapeHtml(tag)}</span>`)
        .join("")}
    </div>
  `;
}

function renderMeleeSpellStats(card) {
  const items = [];

  if (card.attack) {
    items.push({ label: "Атака", value: card.attack });
  }

  if (card.save) {
    items.push({ label: "Спасбросок", value: card.save });
  }

  if (card.damage) {
    items.push({ label: "Урон / эффект", value: card.damage });
  }

  if (!items.length) {
    return "";
  }

  return renderSpellFacts(items);
}

function renderCombatSpellCard(card, expandedCardIds = []) {
  const badges = [
    `<span class="spell-badge spell-badge--level">${escapeHtml(formatSpellLevel(card.level))}</span>`,
  ];

  if (card.concentration) {
    badges.push(`<span class="spell-badge">Концентрация</span>`);
  }

  if (Array.isArray(card.tags)) {
    for (const tag of card.tags.filter(Boolean)) {
      badges.push(`<span class="spell-badge">${escapeHtml(tag)}</span>`);
    }
  }

  const geometryItem = getSpellGeometryFactItem(card);

  const factItems = [
    card.castTime ? { label: "Накладывание", value: card.castTime } : null,
    geometryItem ?? (card.range ? { label: "Дистанция", value: card.range } : null),
    card.duration
      ? {
          label: "Длительность",
          value: `${card.duration}${card.concentration ? " (конц.)" : ""}`,
        }
      : card.concentration
        ? { label: "Длительность", value: "Концентрация" }
        : null,
  ].filter(Boolean);

  return renderExpandableCombatCard(
    {
      card,
      title: escapeHtml(card.title || "Заклинание"),
      summary: escapeHtml(card.summary || ""),
      badges: badges.join(""),
      details: `
        ${renderSpellSummaryLine({
          level: card.level,
          school: card.school,
        })}
        ${factItems.length ? renderSpellFacts(factItems) : ""}
        ${renderMeleeSpellStats(card)}
        ${renderSpellBody(
          renderTextParagraph("spell-description", card.description || card.summary),
          renderTextParagraph("spell-notes", card.notes),
          renderTextParagraph("spell-vibe", card.vibe),
        )}
      `,
      actions: renderCardActions(card),
    },
    expandedCardIds,
  );
}

function getCombatCardRuntimeId(card) {
  const kind = String(card?.kind || "card");
  const baseId =
    card?.id ||
    card?.spellId ||
    card?.title ||
    Math.random().toString(16).slice(2);

  return `${kind}:${String(baseId)}`;
}

function renderExpandableCombatCard({ card, title, summary = "", badges = "", details = "", actions = "" }, expandedCardIds = []) {
  const cardId = getCombatCardRuntimeId(card);
  const isExpanded = expandedCardIds.includes(cardId);
  const contentId = `melee-card-content-${escapeHtml(cardId)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";

  return `
    <article class="combat-expandable-card ${isExpanded ? "combat-expandable-card--expanded" : "combat-expandable-card--collapsed"}">
      <div class="combat-expandable-card__header">
        <div class="combat-expandable-card__title-wrap">
          <div class="combat-expandable-card__title">${title}</div>
          ${summary ? `<div class="combat-expandable-card__summary">${summary}</div>` : ""}
        </div>
        ${badges ? `<div class="combat-expandable-card__badges">${badges}</div>` : ""}
      </div>

      <div class="combat-card-footer">
        <div class="combat-card-footer-actions">
          <button
            type="button"
            class="combat-card-toggle"
            data-melee-toggle="${escapeHtml(cardId)}"
            aria-expanded="${isExpanded ? "true" : "false"}"
            aria-controls="${contentId}"
          >
            ${toggleLabel}
          </button>
        </div>
      </div>

      <div
        id="${contentId}"
        class="combat-card-expandable"
        ${isExpanded ? "" : "hidden"}
      >
        ${isExpanded ? `${details}${actions}` : ""}
      </div>
    </article>
  `;
}

function renderCombatActionCard(card, expandedCardIds = []) {
  if (card.kind === "spell") {
    return renderCombatSpellCard(card, expandedCardIds);
  }

  const tagsMarkup = renderTags(card.tags || []);
  const actions = renderCardActions(card);

  if (card.kind === "weapon") {
    return renderExpandableCombatCard(
      {
        card,
        title: escapeHtml(card.title || "Оружие"),
        summary: `Атака: ${escapeHtml(card.attack || "—")} · Урон: ${escapeHtml(card.damage || "—")}`,
        details: `
          <div class="info-card-text">
            Атака: <strong>${escapeHtml(card.attack || "—")}</strong><br>
            Урон: <strong>${escapeHtml(card.damage || "—")}</strong><br>
            Тип урона: ${escapeHtml(card.damageType || "—")}<br>
            ${card.notes ? `${escapeHtml(card.notes)}<br>` : ""}
            ${tagsMarkup}
          </div>
        `,
        actions,
      },
      expandedCardIds,
    );
  }

  if (card.kind === "feature") {
    return renderExpandableCombatCard(
      {
        card,
        title: escapeHtml(card.title || "Способность"),
        summary: card.cost ? `Стоимость: ${escapeHtml(card.cost)}` : "",
        details: `
          <div class="info-card-text">
            ${card.cost ? `Стоимость: <strong>${escapeHtml(card.cost)}</strong><br>` : ""}
            ${card.notes ? `${escapeHtml(card.notes)}<br>` : ""}
            ${tagsMarkup}
          </div>
        `,
        actions,
      },
      expandedCardIds,
    );
  }

  return "";
}

function renderCombatActionGroup(title, cards, expandedCardIds = []) {
  if (!cards.length) {
    return "";
  }

  return `
    <div class="combat-card-group">
      <div class="combat-card-group-title">${escapeHtml(title)}</div>
      <div class="cards-grid">
        ${cards.map((card) => renderCombatActionCard(card, expandedCardIds)).join("")}
      </div>
    </div>
  `;
}

function renderGroupedCombatActionCards(cards = [], expandedCardIds = []) {
  const weapons = cards.filter((card) => card.kind === "weapon");
  const features = cards.filter((card) => card.kind === "feature");
  const spells = cards.filter((card) => card.kind === "spell");

  const markup = [
    renderCombatActionGroup("Оружие", weapons, expandedCardIds),
    renderCombatActionGroup("Способности", features, expandedCardIds),
    renderCombatActionGroup("Заклинания", spells, expandedCardIds),
  ]
    .filter(Boolean)
    .join("");

  if (markup) {
    return markup;
  }

  return `
    <div class="info-card">
      <div class="info-card-title">Боевые действия не заданы</div>
      <div class="info-card-text">
        Нет оружия, боевых способностей или подходящих заклинаний для отображения.
      </div>
    </div>
  `;
}

export function renderMeleePanel(state, derived) {
  const meleePanel = document.getElementById("meleePanel");
  if (!meleePanel) {
    return;
  }

  const combatCards = derived?.combatCards ?? EMPTY_COMBAT_CARDS;
  const expandedCardIds = Array.isArray(state?.ui?.melee?.expandedCardIds)
    ? state.ui.melee.expandedCardIds
    : [];

  meleePanel.innerHTML = `
    ${renderTurnTracker(derived)}
    ${renderCombatResources(state, derived)}
    ${renderGroupedCombatActionCards(
      [
        ...(combatCards.weapons || []),
        ...(combatCards.features || []),
        ...(combatCards.spells || []),
      ],
      expandedCardIds,
    )}
  `;
}