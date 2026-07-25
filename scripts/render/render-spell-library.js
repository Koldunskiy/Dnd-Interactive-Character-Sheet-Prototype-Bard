import {
  escapeHtml,
  renderSpellFacts,
  renderTextParagraph,
  renderSpellBody,
  getBaseSpellFactItems,
  renderSpellCardHeader,
  renderSpellSummaryLine,
  renderSpellCombatStats,
} from "./shared/spell-card.js";
import { BARD_SPELL_LIBRARY } from "../../data/bard-spells.js";
import {
  isCantripSelected,
  isPreparedSpellSelected,
  isGrantedSpell,
  buildCharacterSpellCollections,
} from "../selectors/spellcasting.js";


function sortSpells(spells) {
  return [...spells].sort((left, right) => {
    if (left.level !== right.level) {
      return left.level - right.level;
    }


    return String(left.name).localeCompare(String(right.name), "ru");
  });
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


function renderLibraryBadges(spell, state) {
  const badges = [
    `<span class="spell-badge spell-badge--level">${escapeHtml(
      Number(spell.level) === 0 ? "Заговор" : `${spell.level} круг`,
    )}</span>`,
  ];


  if (state.isGranted) {
    badges.push(`<span class="spell-badge spell-badge--granted">Даровано</span>`);
  } else if (state.isSelected) {
    badges.push(`<span class="spell-badge spell-badge--selected">Выбрано</span>`);
  }


  if (spell.ritual) {
    badges.push(`<span class="spell-badge">Ритуал</span>`);
  }


  if (spell.concentration) {
    badges.push(`<span class="spell-badge">Концентрация</span>`);
  }


  if (!state.isAvailable) {
    badges.push(
      `<span class="spell-badge spell-badge--locked">С ${escapeHtml(
        `${spell.availableFromLevel} уровня`,
      )}</span>`,
    );
  }


  return badges;
}


function getSpellSelectionState(character, spell) {
  const level = character?.profile?.level ?? 1;
  const granted = isGrantedSpell(character, spell.id);
  const cantripSelected = Number(spell.level) === 0 && isCantripSelected(character, spell.id);
  const preparedSelected =
    Number(spell.level) > 0 && isPreparedSpellSelected(character, spell.id);


  return {
    isGranted: granted,
    isSelected: granted || cantripSelected || preparedSelected,
    isCantrip: Number(spell.level) === 0,
    isPrepared: Number(spell.level) > 0,
    isAvailable:
      !spell.availableFromLevel || Number(spell.availableFromLevel) <= Number(level),
  };
}


function renderSelectionStatus(spell, state) {
  if (!state.isAvailable) {
    return `<span class="spell-library-status spell-library-status--locked">Недоступно до ${escapeHtml(
      `${spell.availableFromLevel} уровня`,
    )}</span>`;
  }


  if (state.isGranted) {
    return `<span class="spell-library-status spell-library-status--granted">Получено от происхождения, наследия или особенности</span>`;
  }


  if (state.isCantrip && state.isSelected) {
    return `<span class="spell-library-status spell-library-status--selected">Выбран как заговор</span>`;
  }


  if (state.isPrepared && state.isSelected) {
    return `<span class="spell-library-status spell-library-status--selected">Подготовлено</span>`;
  }


  if (state.isCantrip) {
    return `<span class="spell-library-status">Доступен для выбора как заговор</span>`;
  }


  return `<span class="spell-library-status">Доступно для подготовки</span>`;
}


function renderSelectionAction(spell, state) {
  if (!state.isAvailable) {
    return "";
  }


  if (state.isGranted) {
    return "";
  }


  const buttonLabel = state.isCantrip
    ? state.isSelected
      ? "Убрать заговор"
      : "Выбрать заговор"
    : state.isSelected
      ? "Убрать из подготовленных"
      : "Подготовить";


  const mode = state.isCantrip ? "cantrip" : "prepared";


  return `
    <button
      type="button"
      class="spell-card-select ${state.isSelected ? "is-selected" : ""}"
      data-spell-library-select="${escapeHtml(spell.id)}"
      data-spell-library-mode="${escapeHtml(mode)}"
      aria-pressed="${state.isSelected ? "true" : "false"}"
    >
      ${escapeHtml(buttonLabel)}
    </button>
  `;
}

function renderSpellCard(spell, character, expandedSpellIds, spellStats) {
  const state = getSpellSelectionState(character, spell);
  const isExpanded = expandedSpellIds.includes(spell.id);
  const contentId = `spell-library-content-${String(spell.id)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";
  const badges = renderLibraryBadges(spell, state);

  return `
    <article class="spell-card spell-card--library ${isExpanded ? "spell-card--expanded" : "spell-card--collapsed"} ${state.isSelected ? "spell-card--selected" : ""} ${state.isGranted ? "spell-card--granted" : ""}">
      ${renderSpellCardHeader({
        name: spell.name,
        originalName: spell.originalName,
        badges,
      })}

      ${renderSpellSummaryLine(spell)}

      ${renderSpellBody(
        renderTextParagraph("spell-description", spell.summary),
      )}

      <div class="spell-card-footer">
        <div class="spell-card-footer-meta">
          ${renderSelectionStatus(spell, state)}
        </div>

        <div class="spell-card-footer-actions">
          ${renderSelectionAction(spell, state)}

          <button
            type="button"
            class="spell-card-toggle"
            data-spell-library-toggle="${escapeHtml(spell.id)}"
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
              ${renderSpellCombatStats(spell, spellStats)}

              ${renderSpellBody(
                renderTextParagraph("spell-description", spell.description ?? spell.summary),
                renderTextParagraph("spell-notes", spell.upcast),
                renderTextParagraph("spell-notes", spell.notes),
              )}

              ${
                spell.sourceUrl
                  ? `
                    <div class="spell-card-footer spell-card-footer--expanded">
                      <a
                        class="spell-card-link"
                        href="${escapeHtml(spell.sourceUrl)}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Открыть источник
                      </a>
                    </div>
                  `
                  : ""
              }
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderToolbar(character) {
  const collections = buildCharacterSpellCollections(character);


  return `
    <div class="section-heading-row">
      <div>
        <h2 class="section-title">Библиотека заклинаний</h2>
        <p class="section-subtitle">
          Заговоры: ${escapeHtml(collections.counts.cantrips)}/${escapeHtml(
            collections.limits.cantrips,
          )}, подготовленные: ${escapeHtml(collections.counts.preparedSpells)}/${escapeHtml(
            collections.limits.preparedSpells,
          )}, дарованные: ${escapeHtml(collections.counts.grantedSpells)}.
        </p>
      </div>
    </div>
  `;
}


function renderLevelFilter(levels, selectedLevel, selectionFilter) {
  const options = [
    {
      value: "all",
      label: "Все",
    },
    ...levels.map((level) => ({
      value: String(level),
      label: Number(level) === 0 ? "Заговоры" : `${level} круг`,
    })),
  ];


  return `
    <div class="spell-library-toolbar">
      <div class="spell-library-filters">
        ${options
          .map(
            (option) => `
              <button
                type="button"
                class="spell-filter-chip ${String(selectedLevel) === String(option.value) ? "is-active" : ""}"
                data-spell-library-level="${escapeHtml(option.value)}"
                aria-pressed="${String(selectedLevel) === String(option.value) ? "true" : "false"}"
              >
                ${escapeHtml(option.label)}
              </button>
            `,
          )
          .join("")}
      </div>


      <div class="spell-library-selection-filters">
        <button
          type="button"
          class="spell-filter-chip ${selectionFilter === "selected" ? "is-active" : ""}"
          data-spell-library-selection="selected"
          aria-pressed="${selectionFilter === "selected" ? "true" : "false"}"
        >
          Выбранные
        </button>
      </div>
    </div>
  `;
}


export function renderSpellLibrary(root, character, derived = null) {
  if (!root) {
    return;
  }


  const sharedSpellStats = {
    spellSaveDc: derived?.spellSaveDc ?? null,
    spellcastingModifier: derived?.spellcastingModifier ?? null,
  };


  const selectedLevel = character?.ui?.spellLibrary?.selectedLevel ?? "all";
  const selectionFilter = character.ui?.spellLibrary?.selectionFilter ?? "all";
  const expandedSpellIds = Array.isArray(character?.ui?.spellLibrary?.expandedSpellIds)
    ? character.ui.spellLibrary.expandedSpellIds
    : [];


  const allSpells = sortSpells(BARD_SPELL_LIBRARY);
  const levels = [...new Set(allSpells.map((spell) => spell.level))].sort((a, b) => a - b);


  const filteredSpells = allSpells.filter((spell) => {
    const matchesLevel =
      selectedLevel === "all" ||
      String(spell.level) === String(selectedLevel);


    if (!matchesLevel) {
      return false;
    }


    if (selectionFilter === "selected") {
      return (
        isCantripSelected(character, spell.id) ||
        isPreparedSpellSelected(character, spell.id)
      );
    }


    return true;
  });


  root.innerHTML = `
    <section class="panel-section">
      ${renderToolbar(character)}
      ${renderLevelFilter(levels, selectedLevel, selectionFilter)}


      <div class="spell-grid spell-grid--library">
        ${
          filteredSpells.length
            ? filteredSpells
                .map((spell) => renderSpellCard(spell, character, expandedSpellIds))
                .join("")
            : `<p class="empty-copy">${
                  selectionFilter === "selected"
                    ? "Нет выбранных заклинаний для текущего фильтра."
                    : "Нет заклинаний для выбранного уровня."
                }</p>`
        }
      </div>
    </section>
  `;
}
