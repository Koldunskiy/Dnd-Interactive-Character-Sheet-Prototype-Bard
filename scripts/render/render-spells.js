import {
  escapeHtml,
  formatSpellLevel,
  renderSpellFacts,
  renderTextParagraph,
  renderSpellBody,
  getBaseSpellFactItems,
  renderSpellCardHeader,
  renderSpellSummaryLine,
  renderSpellCombatStats,
  getSpellGeometryFactItem,
} from "./shared/spell-card.js";
import { buildCharacterSpellCollections } from "../selectors/spellcasting.js";
import {
  formatSpellSave,
  formatSpellDamage,
  formatHealing,
} from "../calculations.js";
import { renderSpellSlotPips } from "./shared/resource-pips.js";
import { getSpellPersonalHint } from "../rule-reference.js";

const slotChoiceBySpellId = new Map();

export function setSpellSlotChoice(spellId, slotLevel) {
  slotChoiceBySpellId.set(spellId, slotLevel);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function renderSlotEntry(slot) {
  const level = Number(slot?.level || 0);
  const max = Math.max(0, Number(slot?.max || 0));
  const available = clamp(Number(slot?.available || 0), 0, max);

  return `
    <div class="resource-row">
      <div class="resource-row-main">
        <span class="resource-row-title">${escapeHtml(`${level} круг`)}</span>
        <span class="resource-row-meta">${escapeHtml(String(available))}/${escapeHtml(String(max))} доступно</span>
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
              data-slot-level="${escapeHtml(String(level))}"
              data-slot-index="${escapeHtml(String(pipIndex))}"
              aria-label="Установить доступные ячейки ${escapeHtml(String(pipIndex))} из ${escapeHtml(String(max))} для ${escapeHtml(String(level))} круга"
              aria-pressed="${isActive ? "true" : "false"}"
            ></button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function formatSigned(value) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return "—";
  }

  return number >= 0 ? `+${number}` : `${number}`;
}

function renderSpellStats(spell, spellStats = null) {
  const items = [];

  const save = formatSpellSave(spell, spellStats?.spellSaveDc);
  const damage = formatSpellDamage(spell, spellStats?.spellcastingModifier);
  const healing = formatHealing(spell, spellStats?.spellcastingModifier);

  if (save) {
    items.push({ label: "Спасбросок", value: save });
  }

  if (spell.attackBonus) {
    items.push({ label: "Атака", value: spell.attackBonus });
  }

  if (spell.upcast) {
    items.push({ label: "Апкаст", value: spell.upcast });
  }

  if (spell.uses?.max) {
    items.push({
      label: "Использования",
      value: `${spell.uses.current}/${spell.uses.max}${spell.uses.refresh ? ` · ${spell.uses.refresh}` : ""}`,
    });
  }

  if (!items.length) {
    return "";
  }

  return renderSpellFacts(items);
}

function renderSpellCompactMeta(spell) {
  const items = [];
  const castTime = spell.castTime ?? spell.castingTime;

  if (castTime) {
    items.push(`Время: ${castTime}`);
  }

  const geometry = getSpellGeometryFactItem(spell);
  const range = geometry?.value ?? spell.range;
  if (range) {
    items.push(`${geometry ? "Дистанция / зона" : "Дистанция"}: ${range}`);
  }

  if (
    spell.uses?.current !== null &&
    spell.uses?.current !== undefined &&
    spell.uses?.max !== null &&
    spell.uses?.max !== undefined &&
    Number(spell.uses.max) > 0
  ) {
    items.push(`Применения: ${spell.uses.current}/${spell.uses.max}`);
  }

  if (!items.length) {
    return "";
  }

  return `
    <div class="spell-card-compact-meta">
      ${items.map(escapeHtml).join(" · ")}
    </div>
  `;
}

function renderSourceBadge(spell) {
  const source = spell.source ?? "class";
  const sourceLabel = spell.sourceLabel ?? "Классовое";

  return `<span class="spell-badge spell-badge--source spell-badge--${escapeHtml(source)}">${escapeHtml(sourceLabel)}</span>`;
}

function renderLevelBadge(spell) {
  const label = spell.source === "racial" && spell.level > 0
    ? "Расовое наложение · 2 круг"
    : formatSpellLevel(spell.level);
  return `<span class="spell-badge spell-badge--level">${escapeHtml(label)}</span>`;
}

function renderGrantedBadge() {
  return `<span class="spell-badge spell-badge--granted">Даровано</span>`;
}

function buildSpellBadges(spell, options = {}) {
  const badges = [];

  if (options.showSource !== false) {
    badges.push(renderSourceBadge(spell));
  }

  badges.push(renderLevelBadge(spell));

  if (options.isGranted) {
    badges.push(renderGrantedBadge());
  }

  if (spell.ritual) {
    badges.push(`<span class="spell-badge spell-badge--ritual">Ритуал</span>`);
  }

  if (spell.concentration) {
    badges.push(
      `<span class="spell-badge spell-badge--concentration">Концентрация</span>`,
    );
  }

  if (spell.availableFromLevel && options.characterLevel && spell.availableFromLevel > options.characterLevel) {
    badges.push(
      `<span class="spell-badge spell-badge--locked">С ${escapeHtml(`${spell.availableFromLevel} уровня`)}</span>`,
    );
  }

  return badges;
}

function getSpellFactItems(spell) {
  const items = [...getBaseSpellFactItems(spell)];

  const geometryItem = getSpellGeometryFactItem(spell);
  if (geometryItem) {
    const hasBaseRange = items.some((item) => item?.label === "Дистанция");
    if (hasBaseRange) {
      const index = items.findIndex((item) => item?.label === "Дистанция");
      items[index] = geometryItem;
    } else {
      items.push(geometryItem);
    }
  }

  if (spell.classes) {
    items.push({
      label: "Классы",
      value: Array.isArray(spell.classes) ? spell.classes.join(", ") : spell.classes,
    });
  }

  return items;
}

function renderSpellCard(spell, spellStats, options = {}) {
  const badges = buildSpellBadges(spell, options);
  const compactMeta = renderSpellCompactMeta(spell);
  const combatStatsHtml = renderSpellCombatStats(spell, spellStats);
  const expandedSpellIds = Array.isArray(options.expandedSpellIds)
    ? options.expandedSpellIds
    : [];

  const isExpanded = expandedSpellIds.includes(spell.id);
  const contentId = `spells-content-${String(spell.id)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";
  const slots = options.slots ?? [];
  const hasSlotMode = spell.level > 0 && (
    spell.memberships?.includes("known") ||
    (spell.memberships?.includes("granted") && spell.source === "magical-secret")
  );
  const hasRacialMode = spell.level > 0 && spell.source === "racial";
  const hasCantripMode = spell.level === 0;
  const usableSlots = slots.filter((slot) =>
    Number(slot.level) >= Number(spell.level) && Number(slot.available) > 0,
  );
  const previousChoice = slotChoiceBySpellId.get(spell.id);
  const selectedSlotLevel = usableSlots.some((slot) => Number(slot.level) === Number(previousChoice))
    ? Number(previousChoice)
    : usableSlots[0]?.level;
  if (selectedSlotLevel != null) slotChoiceBySpellId.set(spell.id, Number(selectedSlotLevel));
  const personalHint = getSpellPersonalHint(
    spell,
    options.personalStats,
    selectedSlotLevel ?? spell.level,
  );
  const castTime = String(spell.castTime ?? spell.castingTime ?? "");
  const usesStandardTurnEconomy = ["1 действие", "1 бонусное действие", "1 реакция"]
    .includes(castTime.trim().toLowerCase());
  const applicationLabel = usesStandardTurnEconomy
    ? "Применить"
    : "Применить вне стандартной экономики хода";
  const applicationControls = hasCantripMode
    ? `<button type="button" class="btn btn--utility spell-apply-btn" data-action="spell-cast" data-spell-id="${escapeHtml(spell.id)}" data-spell-mode="cantrip">${applicationLabel}</button>`
    : [
        hasSlotMode
          ? usableSlots.length
            ? `<label class="spell-slot-select-label">Ячейка для применения
                <select class="input spell-slot-select" data-spell-slot-select="${escapeHtml(spell.id)}" aria-label="Выбрать ячейку для ${escapeHtml(spell.name)}">
                  ${usableSlots.map((slot) => `<option value="${escapeHtml(slot.level)}" ${Number(slot.level) === Number(selectedSlotLevel) ? "selected" : ""}>${escapeHtml(slot.level)} круг · ${escapeHtml(slot.available)} доступно</option>`).join("")}
                </select>
              </label>
              <button type="button" class="btn btn--utility spell-apply-btn" data-action="spell-cast" data-spell-id="${escapeHtml(spell.id)}" data-spell-mode="slot" data-slot-level="${escapeHtml(selectedSlotLevel)}">${applicationLabel}</button>`
            : `<button type="button" class="btn btn--utility spell-apply-btn" disabled>Нет доступных ячеек</button>`
          : "",
        hasRacialMode
          ? `<button type="button" class="btn btn--utility spell-apply-btn" data-action="spell-cast" data-spell-id="${escapeHtml(spell.id)}" data-spell-mode="racial" ${Number(spell.uses?.current ?? 0) <= 0 ? "disabled" : ""}>${Number(spell.uses?.current ?? 0) <= 0 ? "Расовое применение израсходовано" : applicationLabel} · ${escapeHtml(spell.uses?.current ?? 0)}/${escapeHtml(spell.uses?.max ?? 0)}</button>`
          : "",
      ].filter(Boolean).join("");

  return `
    <article class="spell-card ${options.isGranted ? "spell-card--granted" : ""} ${isExpanded ? "spell-card--expanded" : "spell-card--collapsed"}">
      ${renderSpellCardHeader({
        name: spell.name,
        originalName: spell.originalName,
        badges,
      })}

      ${compactMeta}
      ${renderSpellSummaryLine(spell)}
      ${personalHint ? `<p class="spell-personal-hint">${escapeHtml(personalHint)}</p>` : ""}

      <div class="spell-card-footer">
        <div class="spell-card-footer-actions">
          ${applicationControls}
          <button
            type="button"
            class="spell-card-toggle"
            data-spells-toggle="${escapeHtml(spell.id)}"
            aria-expanded="${isExpanded ? "true" : "false"}"
            aria-controls="${contentId}"
          >
            ${toggleLabel}
          </button>
        </div>
      </div>

      <div
        id="${contentId}"
        class="spell-card-expandable"
        ${isExpanded ? "" : "hidden"}
      >
        ${
          isExpanded
            ? `
              ${
                spell.originalName
                  ? `<p class="spell-card-original-name">Оригинальное название: ${escapeHtml(spell.originalName)}</p>`
                  : ""
              }
              ${
                spell.school
                  ? `<p class="spell-card-school">Школа: ${escapeHtml(spell.school)}</p>`
                  : ""
              }
              ${renderSpellFacts(getSpellFactItems(spell))}
              ${renderSpellStats(spell, spellStats)}
              ${combatStatsHtml}
              ${renderSpellBody(
                renderTextParagraph("spell-description", spell.description ?? spell.summary),
                renderTextParagraph("spell-notes", spell.notes),
                renderTextParagraph("spell-vibe", spell.vibe),
              )}
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderSpellSection(title, spells, emptyText, options = {}) {
  const cardOptions = options.cardOptions ?? {};
  const spellStats = cardOptions.spellStats ?? null;

  return `
    <section class="panel-section panel-section--spells">
      <div class="section-heading-row">
        <div>
          <h2 class="section-title">${escapeHtml(title)}</h2>
          ${
            options.subtitle
              ? `<p class="section-subtitle">${escapeHtml(options.subtitle)}</p>`
              : ""
          }
        </div>
      </div>

      ${options.resourceHtml ?? ""}
      <div class="spell-grid">
        ${
          spells.length
            ? spells
                .map((spell) => renderSpellCard(spell, spellStats, cardOptions))
                .join("")
            : `<p class="empty-copy">${escapeHtml(emptyText)}</p>`
        }
      </div>
    </section>
  `;
}

export function renderSpells(root, character, derived) {
  if (!root) return;

  const spellcasting = character.spellcasting ?? {};
  const level = character.profile?.level ?? 1;
  const spellCollections = buildCharacterSpellCollections(character);

  const expandedSpellIds = Array.isArray(character?.ui?.spells?.expandedSpellIds)
    ? character.ui.spells.expandedSpellIds
    : [];

  const { cantrips, knownSpells, racialSpells, counts, limits, missingIds } = spellCollections;

  const sharedSpellStats = {
    spellSaveDc: derived?.spellStats?.spellSaveDc ?? derived?.spellSaveDc ?? null,
    spellcastingModifier: derived?.spellStats?.spellcastingModifier ?? null,
    spellAttackBonus: derived?.spellStats?.spellAttackBonus ?? derived?.spellAttackBonus ?? null,
    formattedSpellAttackBonus:
      derived?.spellStats?.formattedSpellAttackBonus ??
      derived?.formattedSpellAttackBonus ??
      null,
  };

  const slots = Array.isArray(derived.spellSlots) ? derived.spellSlots : [];
  const cardsOptions = {
    characterLevel: level,
    showSource: true,
    spellStats: sharedSpellStats,
    expandedSpellIds,
    slots,
    personalStats: derived,
  };
  const slotLevels = [...new Set([
    ...slots.map((slot) => Number(slot.level)),
    ...knownSpells.map((spell) => Number(spell.level)),
  ].filter((slotLevel) => Number.isInteger(slotLevel) && slotLevel > 0))]
    .sort((a, b) => a - b);
  const levelSections = slotLevels.map((slotLevel) => {
    const levelSpells = knownSpells.filter((spell) => Number(spell.level) === slotLevel);
    const slot = slots.find((entry) => Number(entry.level) === slotLevel);
    return renderSpellSection(`${slotLevel} круг`, levelSpells, "Выбранных заклинаний этого круга нет.", {
      resourceHtml: slot
        ? `<div class="resource-stack">${renderSpellSlotPips(slot)}</div>`
        : `<p class="empty-copy spell-slot-unavailable" role="status">Ячейки этого круга сейчас недоступны</p>`,
      cardOptions: cardsOptions,
    });
  }).join("");

  root.innerHTML = `
    <section class="panel-section panel-section--spells">
      <div class="section-heading-row">
        <div>
          <h2 class="section-title">Магия</h2>
          <p class="section-subtitle">
            Сл спасброска: ${escapeHtml(derived?.spellSaveDc ?? "—")},
            атака заклинанием: ${escapeHtml(formatSigned(derived?.spellAttackBonus ?? 0))}
          </p>
          <p class="section-subtitle">
            Проверка магии: ${escapeHtml(formatSigned(derived?.abilityChecks?.charisma ?? 0))}
          </p>
          <p class="section-subtitle">Обзор: ${escapeHtml(counts.cantrips)} заговоров · ${escapeHtml(counts.nonracialLevelledSpells)} уровневых · ${escapeHtml(counts.racialSpells)} расовых</p>
          <p class="section-subtitle">Выбор: ${escapeHtml(counts.classCantrips)}/${escapeHtml(limits.classCantrips)} классовых заговоров · ${escapeHtml(counts.knownSpells)}/${escapeHtml(limits.knownSpells)} известных заклинаний</p>
        </div>
      </div>
      ${missingIds.length ? `<p class="spell-diagnostic" role="status">Неизвестные заклинания не применяются: ${escapeHtml(missingIds.join(", "))}</p>` : ""}
    </section>

    ${renderSpellSection("Заговоры", cantrips, "Заговоры не выбраны.", {
      subtitle: `${counts.cantrips} всего · ${counts.classCantrips}/${limits.classCantrips} классовых`,
      cardOptions: cardsOptions,
    })}

    ${levelSections}

    ${
      racialSpells.length
        ? renderSpellSection("Расовая магия", racialSpells, "Расовых заклинаний нет.", {
            cardOptions: cardsOptions,
          })
        : ""
    }
  `;
}