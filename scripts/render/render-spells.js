import {
  escapeHtml,
  formatSpellLevel,
  renderSpellFacts,
  renderTextParagraph,
  renderSpellBody,
  getBaseSpellFactItems,
  renderSpellCardHeader,
  renderSpellSummaryLine,
} from "./shared/spell-card.js";
import { buildCharacterSpellCollections } from "../selectors/spellcasting.js";

function formatSigned(value) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return "—";
  }

  return number >= 0 ? `+${number}` : `${number}`;
}

function renderSpellStats(spell) {
  const rows = [];

  if (spell.save) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Спасбросок</span><span class="spell-stat-value">${escapeHtml(spell.save)}</span></div>`,
    );
  }

  if (spell.attackBonus) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Атака</span><span class="spell-stat-value">${escapeHtml(spell.attackBonus)}</span></div>`,
    );
  }

  if (spell.damage) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Эффект</span><span class="spell-stat-value">${escapeHtml(spell.damage)}</span></div>`,
    );
  }

  if (spell.upcast) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Апкаст</span><span class="spell-stat-value">${escapeHtml(spell.upcast)}</span></div>`,
    );
  }

  if (spell.uses?.max) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Использования</span><span class="spell-stat-value">${escapeHtml(
        `${spell.uses.current}/${spell.uses.max}${spell.uses.refresh ? ` · ${spell.uses.refresh}` : ""}`,
      )}</span></div>`,
    );
  }

  if (!rows.length) {
    return "";
  }

  return `<div class="spell-stats-grid">${rows.join("")}</div>`;
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

function renderSpellCard(spell, options = {}) {
  const badges = buildSpellBadges(spell, options);

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
            ? spells.map((spell) => renderSpellCard(spell, options.cardOptions)).join("")
            : `<p class="empty-copy">${escapeHtml(emptyText)}</p>`
        }
      </div>
    </section>
  `;
}

export function renderSpells(root, character, derived) {
  if (!root) {
    return;
  }

  const spellcasting = character.spellcasting ?? {};
  const level = character.profile?.level ?? 1;

  const spellCollections = buildCharacterSpellCollections(character);

  const cantrips = spellCollections.cantrips;
  const preparedSpells = spellCollections.preparedSpells;
  const grantedSpells = spellCollections.grantedSpells;

  const slotEntries = Array.isArray(derived.spellSlots)
    ? derived.spellSlots.map(renderSlotEntry).join("")
    : "";

  root.innerHTML = `
    <section class="panel-section panel-section--spells">
      <div class="section-heading-row">
        <div>
          <h2 class="section-title">Заклинания</h2>
          <p class="section-subtitle">
            Харизма — базовая характеристика. Сл спасброска: ${escapeHtml(
              derived.spellSaveDc ?? "—",
            )}, атака заклинанием: ${escapeHtml(
              formatSigned(derived.spellAttackBonus),
            )}.
          </p>
          <p class="section-subtitle">
            Заговоры: ${escapeHtml(spellCollections.counts.cantrips)}/${escapeHtml(
              spellCollections.limits.cantrips,
            )}, подготовленные: ${escapeHtml(
              spellCollections.counts.preparedSpells,
            )}/${escapeHtml(spellCollections.limits.preparedSpells)}, дарованные: ${escapeHtml(
              spellCollections.counts.grantedSpells,
            )}.
          </p>
        </div>
      </div>

      <div class="resource-grid">
        ${slotEntries || `<p class="empty-copy">Нет ячеек заклинаний.</p>`}
      </div>

      ${
        spellcasting.focus
          ? `<p class="section-copy"><strong>Фокусировка:</strong> ${escapeHtml(spellcasting.focus)}</p>`
          : ""
      }

      ${
        spellcasting.notes
          ? `<p class="section-copy">${escapeHtml(spellcasting.notes)}</p>`
          : ""
      }
    </section>

    ${renderSpellSection(
      "Заговоры",
      cantrips,
      "Нет выбранных заговоров.",
      {
        subtitle: `Выбрано ${spellCollections.counts.cantrips} из ${spellCollections.limits.cantrips}`,
        cardOptions: {
          characterLevel: level,
          showSource: true,
          isGranted: false,
        },
      },
    )}

    ${renderSpellSection(
      "Подготовленные заклинания",
      preparedSpells,
      "Нет подготовленных заклинаний.",
      {
        subtitle: `Подготовлено ${spellCollections.counts.preparedSpells} из ${spellCollections.limits.preparedSpells}`,
        cardOptions: {
          characterLevel: level,
          showSource: true,
          isGranted: false,
        },
      },
    )}

    ${
      grantedSpells.length
        ? renderSpellSection(
            "Дарованные заклинания",
            grantedSpells,
            "Нет дарованных заклинаний.",
            {
              subtitle: "Получены от происхождения, наследия, черт или других особенностей и не расходуют лимит подготовленных заклинаний.",
              cardOptions: {
                characterLevel: level,
                showSource: true,
                isGranted: true,
              },
            },
          )
        : ""
    }
  `;
}