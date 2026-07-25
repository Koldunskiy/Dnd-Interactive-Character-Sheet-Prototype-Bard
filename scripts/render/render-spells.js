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
} from "./shared/spell-card.js";
import { buildCharacterSpellCollections } from "../selectors/spellcasting.js";
import {
  formatSpellSave,
  formatSpellDamage,
  formatHealing,
} from "../calculations.js";


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

  if (save && !spell.saveAbility) {
    items.push({ label: "Эффект", value: save });
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

  return `
    <article class="spell-card ${options.isGranted ? "spell-card--granted" : ""}">
      ${renderSpellCardHeader({
        name: spell.name,
        originalName: spell.originalName,
        badges,
      })}

      ${renderSpellSummaryLine(spell)}

      ${renderSpellFacts(getSpellFactItems(spell))}

      ${renderSpellStats(spell)}
      ${combatStatsHtml}

      ${renderSpellBody(
        renderTextParagraph("spell-description", spell.description ?? spell.summary),
        renderTextParagraph("spell-notes", spell.notes),
        renderTextParagraph("spell-vibe", spell.vibe),
      )}
    </article>
  `;
}

function renderSlotEntry(slot) {
  return `
    <div class="resource-card">
      <div class="resource-card-label">${escapeHtml(`${slot.level} круг`)}</div>
      <div class="resource-card-value">${escapeHtml(slot.available)}/${escapeHtml(slot.max)}</div>
      <div class="resource-card-subtle">потрачено: ${escapeHtml(slot.used)}</div>
    </div>
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

  const {
    cantrips,
    preparedSpells,
    grantedSpells,
    counts,
    limits,
  } = spellCollections;

  const sharedSpellStats = {
    spellSaveDc: derived?.spellStats?.spellSaveDc ?? derived?.spellSaveDc ?? null,
    spellcastingModifier:
      derived?.spellStats?.spellcastingModifier ?? null,
    spellAttackBonus:
      derived?.spellStats?.spellAttackBonus ?? derived?.spellAttackBonus ?? null,
    formattedSpellAttackBonus:
      derived?.spellStats?.formattedSpellAttackBonus ??
      derived?.formattedSpellAttackBonus ??
      null,
  };

  const slotEntries = Array.isArray(derived.spellSlots)
    ? derived.spellSlots.map(renderSlotEntry).join("")
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

      <div class="resource-grid">
        ${slotEntries || `<p class="empty-copy">Нет ячеек заклинаний.</p>`}
      </div>

      ${
        spellcasting.focus
          ? `<p class="section-copy"><strong>Фокус:</strong> ${escapeHtml(spellcasting.focus)}</p>`
          : ""
      }
      ${
        spellcasting.notes
          ? `<p class="section-copy">${escapeHtml(spellcasting.notes)}</p>`
          : ""
      }
    </section>

    ${renderSpellSection("Заговоры", cantrips, "Заговоры не выбраны.", {
      subtitle: `${counts.cantrips}/${limits.cantrips}`,
      cardOptions: {
        characterLevel: level,
        showSource: true,
        isGranted: false,
        spellStats: sharedSpellStats,
      },
    })}

    ${renderSpellSection("Подготовленные заклинания", preparedSpells, "Подготовленные заклинания отсутствуют.", {
      subtitle: `${counts.preparedSpells}/${limits.preparedSpells}`,
      cardOptions: {
        characterLevel: level,
        showSource: true,
        isGranted: false,
        spellStats: sharedSpellStats,
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
            },
          })
        : ""
    }
  `;
}