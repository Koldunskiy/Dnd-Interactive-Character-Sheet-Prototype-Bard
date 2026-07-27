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


function renderSourceBadge(spell) {
  const source = spell.source ?? "class";
  const sourceLabel = spell.sourceLabel ?? "Классовое";

  return `<span class="spell-badge spell-badge--source spell-badge--${escapeHtml(source)}">${escapeHtml(sourceLabel)}</span>`;
}

function renderLevelBadge(spell) {
  return `<span class="spell-badge spell-badge--level">${escapeHtml(formatSpellLevel(spell.level))}</span>`;
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
    badges.push(`<span class="spell-badge">Ритуал</span>`);
  }

  if (spell.concentration) {
    badges.push(`<span class="spell-badge">Концентрация</span>`);
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
  const combatStatsHtml = renderSpellCombatStats(spell, spellStats);
  const expandedSpellIds = Array.isArray(options.expandedSpellIds)
    ? options.expandedSpellIds
    : [];

  const isExpanded = expandedSpellIds.includes(spell.id);
  const contentId = `spells-content-${String(spell.id)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";

  return `
    <article class="spell-card ${options.isGranted ? "spell-card--granted" : ""} ${isExpanded ? "spell-card--expanded" : "spell-card--collapsed"}">
      ${renderSpellCardHeader({
        name: spell.name,
        originalName: spell.originalName,
        badges,
      })}

      ${renderSpellSummaryLine(spell)}

      <div class="spell-card-footer">
        <div class="spell-card-footer-actions">
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
    <section class="panel-section">
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

  const {
    cantrips,
    preparedSpells,
    grantedSpells,
    counts,
    limits,
  } = spellCollections;

  const sharedSpellStats = {
    spellSaveDc: derived?.spellStats?.spellSaveDc ?? derived?.spellSaveDc ?? null,
    spellcastingModifier: derived?.spellStats?.spellcastingModifier ?? null,
    spellAttackBonus: derived?.spellStats?.spellAttackBonus ?? derived?.spellAttackBonus ?? null,
    formattedSpellAttackBonus:
      derived?.spellStats?.formattedSpellAttackBonus ??
      derived?.formattedSpellAttackBonus ??
      null,
  };

  const slotEntries = Array.isArray(derived.spellSlots)
    ? derived.spellSlots.map(renderSpellSlotPips).join("")
    : "";

  root.innerHTML = `
    <section class="panel-section panel-section--spells">
      <div class="section-heading-row">
        <div>
          <h2 class="section-title">Заклинания</h2>
          <p class="section-subtitle">
            Сл спасброска: ${escapeHtml(derived?.spellSaveDc ?? "—")},
            атака заклинанием: ${escapeHtml(formatSigned(derived?.spellAttackBonus ?? 0))}
          </p>
          <p class="section-subtitle">
            Заговоры: ${escapeHtml(counts.cantrips)}/${escapeHtml(limits.cantrips)},
            подготовлено: ${escapeHtml(counts.preparedSpells)}/${escapeHtml(limits.preparedSpells)},
            даровано: ${escapeHtml(counts.grantedSpells)}
          </p>
        </div>
      </div>

      <div class="resource-stack">
        ${slotEntries || `<p class="empty-copy">Нет ячеек заклинаний.</p>`}
      </div>
    </section>

    ${renderSpellSection("Заговоры", cantrips, "Заговоры не выбраны.", {
      subtitle: `${counts.cantrips}/${limits.cantrips}`,
      cardOptions: {
        characterLevel: level,
        showSource: true,
        isGranted: false,
        spellStats: sharedSpellStats,
        expandedSpellIds,
      },
    })}

    ${renderSpellSection("Подготовленные заклинания", preparedSpells, "Подготовленные заклинания отсутствуют.", {
      subtitle: `${counts.preparedSpells}/${limits.preparedSpells}`,
      cardOptions: {
        characterLevel: level,
        showSource: true,
        isGranted: false,
        spellStats: sharedSpellStats,
        expandedSpellIds,
      },
    })}

    ${
      grantedSpells.length
        ? renderSpellSection("Дарованные заклинания", grantedSpells, "Дарованные заклинания отсутствуют.", {
            subtitle: `${counts.grantedSpells}`,
            cardOptions: {
              characterLevel: level,
              showSource: true,
              isGranted: true,
              spellStats: sharedSpellStats,
              expandedSpellIds,
            },
          })
        : ""
    }
  `;
}