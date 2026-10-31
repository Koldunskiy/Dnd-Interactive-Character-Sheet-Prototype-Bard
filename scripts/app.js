import { initTabs } from "./tabs.js";
import {
  getState,
  subscribe,
  getSessionContext,
  isCurrentSession,
  updateSessionState,
  openCharacterSession,
  readAppPreferences,
  saveAppPreferences,
  retryPersistedState,
  resetState
} from "./state.js";
import { CHARACTER_DESCRIPTORS } from "./characters.js";
import { loadCharacterState } from "./storage.js";
import { getDerivedStats } from "./calculations.js";
import { renderPortraitMedia, initPortraitControls, resetPortraitForCharacter } from "./media.js";

import { renderHeader } from "./render/render-header.js";
import {
  bindCharacterRollEntryPoints,
  clearCharacterRollDraft,
  hasChangedCharacterRollDraft,
  hasUnsavedCharacterRoll,
  markCharacterRollSaved,
} from "./rolls/controller.js";
import { renderQuickStats, renderSidebarSummary } from "./render/render-sidebar.js";
import { renderProfile } from "./render/render-profile.js";
import { renderMeleePanel } from "./render/render-melee.js";
import { bindBattleConsole } from "./render/render-battle-console.js";
import { renderSpells } from "./render/render-spells.js";
import { renderLorePanel } from "./render/render-lore.js";
import { renderInventoryPanel } from "./render/render-inventory.js";
import { renderSpellLibrary } from "./render/render-spell-library.js";
import {
  renderTechniquesPanel,
  clearTechniqueDrafts,
  bindSaraCombatControls,
  hasChangedTechniqueDraft
} from "./render/render-techniques.js";
import {
  setSpellSlotChoice,
} from "./render/render-spells.js";
import {
  clearLoreNoteStatus,
  setLoreNoteExpanded,
  updateLoreNoteEditView,
  activateLoreCharacter
} from "./render/render-lore.js";
import {
  createNoteEntry,
  deleteNoteEntry,
  updateNoteEntry,
  validateNoteEntries,
} from "./lore-notes.js";
import { getSpellPersonalHint } from "./rule-reference.js";
import { buildCharacterSpellCollections } from "./selectors/spellcasting.js";

import { createActionHandlers, STATELESS_ACTIONS } from "./actions.js";
import {
  ensureEffectsState,
  ensureInventoryState,
} from "./state-helpers.js";

const actionHandlers = createActionHandlers({ resetState });
let spellLibraryDirty = true;
const failedLoreNoteIds = new Set();
let activeTabsController = null;
let switchingCharacter = false;
let isSheetVisible = false;

function updateCurrentSession(updater, metadata = null) {
  const context = getSessionContext();
  return updateSessionState(context, updater, { metadata });
}

function setCurrentValue(path, value) {
  return updateCurrentSession((draft) => {
    setByPathOnObject(draft, path, value);
    return draft;
  });
}

function showPersistenceWarning(message = "") {
  let node = document.getElementById("saveWarning");
  if (!node) {
    node = document.createElement("p");
    node.id = "saveWarning";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.querySelector(".topbar")?.append(node);
  }
  node.textContent = message;
  node.hidden = !message;
  if (message && !node.querySelector("[data-app-action='retry-save']")) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn--utility";
    retry.dataset.appAction = "retry-save";
    retry.textContent = "Повторить сохранение";
    node.append(retry);
    bindAppControls();
  }
}

function getLoreNoteKey(noteId) {
  return `${getState().profile?.id ?? "aurelia"}:${noteId}`;
}

function persistPreferences(patch) {
  const current = readAppPreferences();
  if (current.status === "invalid" || current.status === "unavailable") {
    showPersistenceWarning(`Настройки приложения не обновлены: ${current.reason}`);
    return { ok: false, error: new Error(current.reason) };
  }
  const preferences = current.status === "loaded" ? current.preferences : {};
  const result = saveAppPreferences({
    ...preferences,
    ...patch,
    ...(patch.lastTab ? { lastTab: { ...(preferences.lastTab ?? {}), ...patch.lastTab } } : {})
  });
  if (!result.ok) showPersistenceWarning("Настройки приложения не сохранены; лист персонажа сохранён отдельно.");
  return result;
}

function parseInputValue(input) {
  if (input.type === "number") {
    if (input.value === "") {
      return 0;
    }

    return Number(input.value);
  }

  if (input.type === "checkbox") {
    return input.checked;
  }

  return input.value;
}

function getSaraBoundValueError(character, path, value) {
  if (character.profile?.id !== "sara-velaris") return null;
  const derived = getDerivedStats(character);
  const finiteInteger = Number.isInteger(value);
  if (path === "combat.ki.current" &&
      (!finiteInteger || value < 0 || value > derived.monk.kiMaximum)) {
    return `Ци должно быть целым числом от 0 до ${derived.monk.kiMaximum}.`;
  }
  if (path === "combat.practiced.current" &&
      (!finiteInteger || value < 0 || value > derived.monk.practicedMaximum)) {
    return `Practiced должно быть целым числом от 0 до ${derived.monk.practicedMaximum}.`;
  }
  if (path === "combat.hp.current" &&
      (!finiteInteger || value < 0 || value > derived.maxHitPoints)) {
    return `HP должно быть целым числом от 0 до ${derived.maxHitPoints}.`;
  }
  if (path === "combat.hp.temp" && (!finiteInteger || value < 0)) {
    return "Временные HP должны быть неотрицательным целым числом.";
  }
  if (path === "combat.hitDice.remaining" &&
      (!finiteInteger || value < 0 || value > Number(character.profile?.level ?? 1))) {
    return `Оставшиеся Hit Dice должны быть целым числом от 0 до ${Number(character.profile?.level ?? 1)}.`;
  }
  if (path.startsWith("abilities.") &&
      (!finiteInteger || value < 1 || value > 30)) {
    return "Характеристика должна быть целым числом от 1 до 30.";
  }
  return null;
}

function setByPathOnObject(target, path, value) {
  const keys = String(path || "").split(".");
  const lastKey = keys.pop();

  if (!lastKey) {
    return;
  }

  let current = target;

  for (const key of keys) {
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  }

  current[lastKey] = value;
}

function bindEditableFields(root = document) {
  root.querySelectorAll("[data-bind]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const isImmediate =
      element.type === "checkbox" ||
      element.dataset.bindImmediate === "true";

    const eventName = isImmediate ? "input" : "change";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      if (!isActiveSheetTarget(target)) return;
      const path = target.dataset.bind;
      const value = parseInputValue(target);
      const validationError = getSaraBoundValueError(getState(), path, value);
      if (validationError) {
        target.setCustomValidity(validationError);
        target.reportValidity();
        return;
      }
      target.setCustomValidity("");

      setCurrentValue(path, value);
    });

    element.dataset.bound = "true";
  });
}

function bindActionButtons(root = document) {
  root.querySelectorAll("[data-action]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const eventName = element.type === "checkbox" ? "change" : "click";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      if (!isActiveSheetTarget(target)) return;
      const action = target.dataset.action;
      const handler = actionHandlers[action];

      if (!handler) {
        return;
      }

      if (action === "spell-cast") {
        if (target.dataset.processing === "true") return;
        target.dataset.processing = "true";
        target.disabled = true;
      }

      if (STATELESS_ACTIONS.has(action)) {
        handler();
        return;
      }

      const context = getSessionContext();
      const restOperationId = ["short-rest", "long-rest"].includes(action)
        ? globalThis.crypto?.randomUUID?.() ??
          `rest-${action}-${Date.now()}-${Math.random().toString(16).slice(2)}`
        : null;
      const result = updateSessionState(context, (draft) => {
        const outcome = handler(draft, target);
        if (outcome === false) return false;
        return draft;
      }, {
        operationId: restOperationId,
        metadata: restOperationId ? { kind: "rest", restType: action } : null
      });
      if (result.status === "rejected" && result.reason !== "stale-session") {
        showPersistenceWarning(`Операция не выполнена: ${result.reason}`);
      }
    });

    element.dataset.bound = "true";
  });
}

function bindEffectFields(root = document) {
  root.querySelectorAll("[data-bind-effect-field]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const isImmediate =
      element.type === "checkbox" ||
      element.dataset.bindImmediate === "true";

    const eventName = isImmediate ? "input" : "change";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      if (!isActiveSheetTarget(target)) return;
      const effectId = target.dataset.effectId;
      const field = target.dataset.bindEffectField;
      const value = target.type === "checkbox" ? target.checked : target.value;

      updateCurrentSession((draft) => {
        const activeEffects = ensureEffectsState(draft);
        const effect = activeEffects.find((entry) => entry.id === effectId);

        if (!effect) {
          return draft;
        }

        effect[field] = value;
        return draft;
      });
    });

    element.dataset.bound = "true";
  });
}

function bindInventoryFields(root = document) {
  root.querySelectorAll("[data-bind-item-field]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const isImmediate =
      element.type === "checkbox" ||
      element.dataset.bindImmediate === "true";

    const eventName = isImmediate ? "input" : "change";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      if (!isActiveSheetTarget(target)) return;
      const itemId = target.dataset.itemId;
      const field = target.dataset.bindItemField;

      let value;
      if (target.type === "checkbox") {
        value = target.checked;
      } else if (target.type === "number") {
        value = target.value === "" ? 0 : Number(target.value);
      } else {
        value = target.value;
      }
      if (field === "quantity" && getState().profile?.id === "sara-velaris" &&
          (!Number.isInteger(value) || value < 0)) {
        target.setCustomValidity("Количество предмета должно быть неотрицательным целым числом.");
        target.reportValidity();
        return;
      }
      target.setCustomValidity("");

      updateCurrentSession((draft) => {
        const inventory = ensureInventoryState(draft);
        const item = inventory.items.find((entry) => entry.id === itemId);

        if (!item) {
          return draft;
        }

        setByPathOnObject(item, field, value);
        return draft;
      });
    });

    element.dataset.bound = "true";
  });
}

function bindClickAction(root, selector, actionKey) {
  const handler = actionHandlers[actionKey];
  if (!handler) {
    return;
  }

  root.querySelectorAll(selector).forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    element.addEventListener("click", (event) => {
      const target = event.currentTarget;
      if (!isActiveSheetTarget(target)) return;

      const result = updateCurrentSession((draft) => {
        handler(draft, target);
        return draft;
      });
      if (result.status === "rejected" && result.reason !== "stale-session") {
        showPersistenceWarning(`Операция не выполнена: ${result.reason}`);
      }
    });

    element.dataset.bound = "true";
  });
}

function bindSpellLibrarySearch(root = document) {
  root
    .querySelectorAll("[data-spell-library-search]")
    .forEach((element) => {
      if (element.dataset.bound === "true") {
        return;
      }

      element.addEventListener("input", (event) => {
        const target = event.currentTarget;
        if (!isActiveSheetTarget(target)) return;
        const context = getSessionContext();
        const handler = actionHandlers["spell-library-search"];

        if (!handler) {
          return;
        }

        const selectionStart = target.selectionStart ?? target.value.length;
        const selectionEnd = target.selectionEnd ?? selectionStart;

        updateSessionState(context, (draft) => {
          handler(draft, target);
          return draft;
        });

        requestAnimationFrame(() => {
          if (!isCurrentSession(context)) return;
          const nextInput = document.querySelector(
            "[data-spell-library-search]",
          );

          if (!(nextInput instanceof HTMLInputElement)) {
            return;
          }

          nextInput.focus();

          const maxPosition = nextInput.value.length;

          nextInput.setSelectionRange(
            Math.min(selectionStart, maxPosition),
            Math.min(selectionEnd, maxPosition),
          );
        });
      });

      element.dataset.bound = "true";
    });
}

function bindSpellLibraryControls(root = document) {
  bindClickAction(root, "[data-spell-library-level]", "spell-library-set-level");
  bindClickAction(
    root,
    "[data-spell-library-selection]",
    "spell-library-set-selection-filter",
  );
  bindClickAction(root, "[data-spell-library-toggle]", "spell-library-toggle-expand");
  bindClickAction(root, "[data-spell-library-select]", "spell-library-toggle-select");
  bindSpellLibrarySearch(root);

  bindClickAction(
    root,
    "[data-spell-library-school]",
    "spell-library-set-school",
  );

  bindClickAction(
    root,
    "[data-spell-library-flag]",
    "spell-library-toggle-flag",
  );
}

function bindSpellsControls(root = document) {
  bindClickAction(root, "[data-spells-toggle]", "spells-toggle-expand");
}

function bindMeleeControls(root = document) {
  bindClickAction(root, "[data-melee-toggle]", "melee-toggle-expand");
}

function persistLoreNoteField(input) {
  if (!isActiveSheetTarget(input)) return;
  const context = getSessionContext();
  const noteId = input.dataset.noteId;
  const field = input.dataset.noteField;
  if (!noteId || !["title", "text"].includes(field)) return;
  const value = input.value;
  const current = getState().lore?.noteEntries?.find((note) => note.id === noteId);
  const noteKey = getLoreNoteKey(noteId);
  if (!current || (current[field] === value && !failedLoreNoteIds.has(noteKey))) return;
  updateSessionState(context, (draft) => {
    const updated = updateNoteEntry(draft.lore.noteEntries, noteId, field, value);
    if (!updated.issue) draft.lore.noteEntries = updated.entries;
    return draft;
  }, { metadata: { kind: "lore-note-edit", noteId, field } });
}

function flushLoreNotes() {
  document.querySelectorAll("#loreNotesRoot [data-note-field]").forEach((input) => {
    persistLoreNoteField(input);
  });
}

function bindLoreNoteControls() {
  const root = document.getElementById("loreNotesRoot");
  if (!root || root.dataset.bound === "true") return;
  root.addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (!input || !root.contains(input) || !isActiveSheetTarget(input) || input.dataset.composing === "true") return;
    persistLoreNoteField(input);
  });
  root.addEventListener("change", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (input && root.contains(input) && isActiveSheetTarget(input)) persistLoreNoteField(input);
  });
  root.addEventListener("blur", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (input && root.contains(input) && isActiveSheetTarget(input)) persistLoreNoteField(input);
  }, true);
  root.addEventListener("compositionstart", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (input) input.dataset.composing = "true";
  });
  root.addEventListener("compositionend", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (!input || !isActiveSheetTarget(input)) return;
    input.dataset.composing = "false";
    persistLoreNoteField(input);
  });
  root.addEventListener("click", (event) => {
    const target = event.target.closest?.("button");
    if (!target || !root.contains(target) || !isActiveSheetTarget(target)) return;
    const card = target.closest("[data-note-id]");
    if (target.matches("[data-note-add]")) {
      const entries = getState().lore?.noteEntries;
      if (validateNoteEntries(entries)) return;
      const id = globalThis.crypto?.randomUUID?.() ??
        `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setLoreNoteExpanded(id, true);
      updateCurrentSession((draft) => {
        const created = createNoteEntry(draft.lore.noteEntries, {
          id,
          title: "Новая заметка",
          text: "",
        });
        if (!created.issue) draft.lore.noteEntries = created.entries;
        return draft;
      });
      [...document.querySelectorAll("#loreNotesRoot [data-note-id]")].find((entry) => entry.dataset.noteId === id)
        ?.querySelector('[data-note-field="title"]')?.focus();
      return;
    }
    if (!card) return;
    const noteId = card.dataset.noteId;
    if (target.matches("[data-note-toggle]")) {
      const opening = target.getAttribute("aria-expanded") !== "true";
      if (!opening) flushLoreNotes();
      setLoreNoteExpanded(noteId, opening);
      const entry = getState().lore.noteEntries.find((note) => note.id === noteId);
      if (entry) {
        const editor = card.querySelector(".lore-note-editor");
        editor.hidden = !opening;
        target.textContent = opening ? "Свернуть" : "Открыть";
        target.setAttribute("aria-expanded", String(opening));
      }
      return;
    }
    if (target.matches("[data-note-collapse]")) {
      flushLoreNotes();
      setLoreNoteExpanded(noteId, false);
      card.querySelector(".lore-note-editor").hidden = true;
      const toggle = card.querySelector("[data-note-toggle]");
      toggle.textContent = "Открыть";
      toggle.setAttribute("aria-expanded", "false");
      return;
    }
    if (target.matches("[data-note-delete]")) {
      flushLoreNotes();
      const entry = getState().lore.noteEntries.find((note) => note.id === noteId);
      const title = entry?.title.trim() || "Без названия";
      if (!window.confirm(`Удалить заметку «${title}»?`)) return;
      updateCurrentSession((draft) => {
        const deleted = deleteNoteEntry(draft.lore.noteEntries, noteId);
        if (!deleted.issue) draft.lore.noteEntries = deleted.entries;
        return draft;
      });
      setLoreNoteExpanded(noteId, false);
      clearLoreNoteStatus(noteId);
      failedLoreNoteIds.delete(getLoreNoteKey(noteId));
    }
  });
  root.querySelectorAll("[data-note-field]").forEach((input) => {
    input.dataset.noteId = input.closest("[data-note-id]").dataset.noteId;
  });
  root.dataset.bound = "true";
}

function bindSpellSlotSelectors() {
  document.querySelectorAll("[data-spell-slot-select]").forEach((select) => {
    if (select.dataset.bound === "true") return;
    select.addEventListener("change", () => {
      if (!isActiveSheetTarget(select)) return;
      const panel = select.closest("[data-panel]");
      if (panel && !panel.classList.contains("is-active")) return;
      const spellId = select.dataset.spellSlotSelect;
      const slotLevel = Number(select.value);
      setSpellSlotChoice(spellId, slotLevel, getState().profile?.id ?? "aurelia");
      const button = select.closest(".spell-card")?.querySelector('[data-action="spell-cast"][data-spell-mode="slot"]');
      if (button) button.dataset.slotLevel = String(slotLevel);
      const state = getState();
      const spell = buildCharacterSpellCollections(state).spells.find((entry) => entry.id === spellId);
      const hint = select.closest(".spell-card")?.querySelector(".spell-personal-hint");
      if (spell && hint) {
        hint.textContent = getSpellPersonalHint(spell, getDerivedStats(state), slotLevel) ?? "";
      }
    });
    select.dataset.bound = "true";
  });
}

function bindUi(root = document) {
  bindEditableFields(root);
  bindActionButtons(root);
  bindInventoryFields(root);
  bindEffectFields(root);
  bindSpellsControls(root);
  bindMeleeControls(root);
  bindLoreNoteControls();
  bindSpellSlotSelectors();
}

function renderSpellLibraryIfNeeded(state, derived) {
  const panel = document.getElementById("spellLibraryPanel");
  const tabPanel = panel?.closest('[data-panel="spell-library"]');

  if (!panel || !tabPanel || tabPanel.hidden) {
    spellLibraryDirty = true;
    return;
  }

  renderSpellLibrary(panel, state, derived);
  bindSpellLibraryControls(panel);
  spellLibraryDirty = false;
}

function handleTabActivation(tabId) {
  if (tabId !== "spell-library" || !spellLibraryDirty) {
    return;
  }

  const state = getState();
  renderSpellLibraryIfNeeded(state, getDerivedStats(state));
}

function renderApp() {
  spellLibraryDirty = true;
  const state = getState();
  if (!isSheetVisible) return;
  const derived = getDerivedStats(state);

  const profilePanel = document.getElementById("profilePanel");
  const spellsPanel = document.getElementById("spellsPanel");

  renderHeader(state);
  renderPortraitMedia(state);
  renderQuickStats(state, derived);
  renderSidebarSummary(state);

  renderProfile(profilePanel, state, derived);
  renderMeleePanel(state, derived);
  renderTechniquesPanel(state);
  renderSpells(spellsPanel, state, derived);
  renderSpellLibraryIfNeeded(state, derived);
  renderInventoryPanel(state);
  renderLorePanel(state);

  bindUi(document);
  bindCharacterRollEntryPoints(document);
  bindBattleConsole(document.getElementById("meleePanel") ?? document);
  bindSaraCombatControls();
  initPortraitControls();
}

function isActiveSheetTarget(target) {
  return isSheetVisible && target?.isConnected &&
    document.querySelector(".page")?.dataset.screen === "sheet" &&
    !target.closest("[hidden]");
}

function isVisibleSheetField(element) {
  const panel = element.closest("[data-panel]");
  return isActiveSheetTarget(element) && (!panel || panel.classList.contains("is-active"));
}

function hasActiveComposition() {
  return document.activeElement?.dataset?.composing === "true" ||
    Boolean(document.querySelector("[data-composing='true']:focus"));
}

function flushEditableFields() {
  if (hasActiveComposition()) {
    showPersistenceWarning("Завершите ввод текста и дождитесь окончания IME-композиции перед переключением.");
    return false;
  }
  const context = getSessionContext();
  const bindings = [...document.querySelectorAll("[data-bind]")]
    .filter(isVisibleSheetField)
    .map((element) => ({ path: element.dataset.bind, value: parseInputValue(element) }));
  const itemFields = [...document.querySelectorAll("[data-bind-item-field]")]
    .filter(isVisibleSheetField)
    .map((element) => ({
      itemId: element.dataset.itemId,
      field: element.dataset.bindItemField,
      value: element.type === "checkbox" ? element.checked :
        element.type === "number" ? (element.value === "" ? 0 : Number(element.value)) : element.value
    }));
  const effectFields = [...document.querySelectorAll("[data-bind-effect-field]")]
    .filter(isVisibleSheetField)
    .map((element) => ({
      effectId: element.dataset.effectId,
      field: element.dataset.bindEffectField,
      value: element.type === "checkbox" ? element.checked : element.value
    }));
  const noteFields = [...document.querySelectorAll("#loreNotesRoot [data-note-field]")]
    .filter(isVisibleSheetField)
    .map((element) => ({
      noteId: element.dataset.noteId,
      field: element.dataset.noteField,
      value: element.value
    }));
  const saraBindingError = bindings
    .map(({ path, value }) => getSaraBoundValueError(getState(), path, value))
    .find(Boolean);
  if (saraBindingError) {
    showPersistenceWarning(saraBindingError);
    return false;
  }
  const invalidQuantity = itemFields.find((entry) =>
    entry.field === "quantity" &&
    (!Number.isInteger(entry.value) || entry.value < 0));
  if (invalidQuantity) {
    showPersistenceWarning("Количество предмета должно быть неотрицательным целым числом.");
    return false;
  }
  const invalidBoundItem = itemFields.find((entry) =>
    entry.field === "attuned" && typeof entry.value !== "boolean");
  if (invalidBoundItem) {
    showPersistenceWarning("Состояние настройки предмета должно быть выбрано.");
    return false;
  }
  if (bindings.length || itemFields.length || effectFields.length || noteFields.length) {
    const result = updateSessionState(context, (draft) => {
      bindings.forEach(({ path, value }) => setByPathOnObject(draft, path, value));
      itemFields.forEach(({ itemId, field, value }) => {
        const item = ensureInventoryState(draft).items.find((entry) => entry.id === itemId);
        if (item) setByPathOnObject(item, field, value);
      });
      effectFields.forEach(({ effectId, field, value }) => {
        const effect = ensureEffectsState(draft).find((entry) => entry.id === effectId);
        if (effect) effect[field] = value;
      });
      noteFields.forEach(({ noteId, field, value }) => {
        const updated = updateNoteEntry(draft.lore.noteEntries, noteId, field, value);
        if (!updated.issue) draft.lore.noteEntries = updated.entries;
      });
      return draft;
    }, { metadata: { kind: "switch-input-flush" } });
    if (result.status !== "applied") {
      showPersistenceWarning("Не удалось завершить ввод перед переключением.");
      return false;
    }
    if (!result.persistence.ok) {
      showPersistenceWarning("Последние поля введены, но не сохранены. Переключение отменено.");
      return false;
    }
  }
  return true;
}

function getAllowedTabs(characterId) {
  return CHARACTER_DESCRIPTORS[characterId].tabs;
}

function configureTabs(characterId) {
  const context = getSessionContext();
  activeTabsController = initTabs(handleTabActivation, {
    tabs: getAllowedTabs(characterId),
    characterId,
    sessionGeneration: context.sessionGeneration,
    beforeActivate: flushLoreNotes,
    getLastTab: (id) => {
      const saved = readAppPreferences();
      return saved.status === "loaded" ? saved.preferences.lastTab?.[id] : null;
    },
    onTabChange: (id, tabId, generation) => {
      if (generation !== getSessionContext().sessionGeneration) return;
      persistPreferences({
        lastCharacterId: id,
        lastTab: { [id]: tabId }
      });
    }
  });
  return activeTabsController;
}

function showPicker(message = "", isError = false) {
  const page = document.querySelector(".page");
  const picker = document.getElementById("characterPicker");
  const status = document.getElementById("characterPickerStatus");
  const choices = document.getElementById("characterChoices");
  if (!page || !picker || !status || !choices) return;
  isSheetVisible = false;
  page.dataset.screen = "characters";
  picker.hidden = false;
  status.textContent = message;
  status.classList.toggle("character-picker__error", isError);
  choices.replaceChildren();
  Object.values(CHARACTER_DESCRIPTORS).forEach((descriptor) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-picker__button";
    const name = document.createElement("strong");
    name.textContent = descriptor.defaults.profile.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = `${descriptor.defaults.profile.className} · ${descriptor.defaults.profile.subclass}`;
    button.append(name, subtitle);
    button.addEventListener("click", () => selectCharacter(descriptor.id));
    choices.append(button);
  });
}

function showSaraSetup(context) {
  const choices = document.getElementById("characterChoices");
  const status = document.getElementById("characterPickerStatus");
  if (!choices || !status) return;
  const state = getState();
  const derived = getDerivedStats(state);
  status.textContent = "Новое сохранение Сары: выберите восстановление после отдыха или вручную укажите остатки. До подтверждения сохранение не создаётся.";
  choices.innerHTML = `
    <form class="character-setup" id="saraSetupForm">
      <label class="field-label">Начальное состояние
        <select class="input" name="mode">
          <option value="rest">После отдыха</option>
          <option value="manual">Указать остатки</option>
        </select>
      </label>
      <div class="character-setup__fields">
        <label class="field-label">HP<input class="input" name="hp" type="number" min="0" max="${derived.maxHitPoints}" step="1" value="${derived.maxHitPoints}"></label>
        <label class="field-label">Ki<input class="input" name="ki" type="number" min="0" max="${derived.monk.kiMaximum}" step="1" value="${derived.monk.kiMaximum}"></label>
        <label class="field-label">Practiced<input class="input" name="practiced" type="number" min="0" max="${derived.monk.practicedMaximum}" step="1" value="${derived.monk.practicedMaximum}"></label>
        <label class="field-label">Suggestion<input class="input" name="suggestion" type="number" min="0" max="1" step="1" value="1"></label>
        <label class="field-label">Оставшиеся Hit Dice<input class="input" name="hitDice" type="number" min="0" max="${state.profile.level}" step="1" value="${state.profile.level}"></label>
      </div>
      <button class="btn" type="submit">Подтвердить создание листа Сары</button>
      <button class="btn btn--utility" type="button" data-setup-retry hidden>Повторить сохранение</button>
      <button class="btn btn--utility" type="button" data-setup-cancel>Отмена</button>
      <p class="character-setup__status" role="status"></p>
    </form>
  `;
  const form = document.getElementById("saraSetupForm");
  const retry = form.querySelector("[data-setup-retry]");
  const formStatus = form.querySelector(".character-setup__status");
  let confirmedInMemory = false;
  form.querySelector("[data-setup-cancel]").addEventListener("click", () => {
    showPicker("Создание Сары отменено; сохранение не создано.");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (confirmedInMemory || !isCurrentSession(context)) return;
    const data = new FormData(form);
    const maximums = {
      hp: derived.maxHitPoints,
      ki: derived.monk.kiMaximum,
      practiced: derived.monk.practicedMaximum,
      suggestion: 1,
      hitDice: state.profile.level
    };
    const values = {};
    if (data.get("mode") === "manual") {
      for (const [field, maximum] of Object.entries(maximums)) {
        const value = Number(data.get(field));
        if (!Number.isInteger(value) || value < 0 || value > maximum) {
          formStatus.textContent = `${field}: введите целое число от 0 до ${maximum}.`;
          return;
        }
        values[field] = value;
      }
    } else {
      values.hp = derived.maxHitPoints;
      values.ki = derived.monk.kiMaximum;
      values.practiced = derived.monk.practicedMaximum;
      values.suggestion = 1;
      values.hitDice = state.profile.level;
    }
    if (!window.confirm("Создать и сохранить лист Сары? Это действие создаст новое сохранение.")) return;
    const result = updateSessionState(context, (draft) => {
      draft.combat.hp.current = values.hp;
      draft.combat.hp.temp = 0;
      draft.combat.ki.current = values.ki;
      draft.combat.practiced.current = values.practiced;
      draft.combat.hitDice.remaining = values.hitDice;
      draft.spellcasting.racialSpells.find((spell) => spell.id === "suggestion-2014").uses.current = values.suggestion;
      return draft;
    }, {
      operationId: `create-sara:${context.sessionGeneration}`,
      metadata: { kind: "sara-create" }
    });
    if (result.status !== "applied") {
      formStatus.textContent = result.reason;
      return;
    }
    confirmedInMemory = true;
    if (!result.persistence.ok) {
      formStatus.textContent = "Состояние создано в памяти, но сохранение не удалось. Повторите запись без повторного создания.";
      retry.hidden = false;
      form.querySelector("[data-setup-cancel]").disabled = true;
      return;
    }
    completeCharacterOpen("sara-velaris");
  });
  retry.addEventListener("click", () => {
    if (!confirmedInMemory || !isCurrentSession(context)) return;
    const result = retryPersistedState();
    if (!result.ok) {
      formStatus.textContent = "Сохранение не удалось; попробуйте ещё раз.";
      return;
    }
    completeCharacterOpen("sara-velaris");
  });
}

function completeCharacterOpen(characterId, warning = "") {
  const page = document.querySelector(".page");
  const picker = document.getElementById("characterPicker");
  if (picker) picker.hidden = true;
  if (page) page.dataset.screen = "sheet";
  isSheetVisible = true;
  clearTechniqueDrafts(characterId);
  clearCharacterRollDraft();
  activateLoreCharacter(characterId);
  showPersistenceWarning("");
  configureTabs(characterId);
  if (warning) showPersistenceWarning(warning);
  renderApp();
}

function selectCharacter(characterId) {
  if (switchingCharacter) return;
  switchingCharacter = true;
  try {
    const activeContext = getSessionContext();
    const discardRollDraft = isSheetVisible && hasChangedCharacterRollDraft() &&
      window.confirm("Остаться на текущем персонаже — Отмена. Отбросить незаписанный бросок и перейти к выбору персонажа?");
    if (isSheetVisible && hasChangedCharacterRollDraft() && !discardRollDraft) return;
    if (isSheetVisible && hasUnsavedCharacterRoll()) {
      const savedRoll = retryPersistedState();
      if (!savedRoll.ok) {
        showPersistenceWarning("Бросок применён, но не сохранён. Повторите сохранение перед переключением.");
        return;
      }
      markCharacterRollSaved();
    }
    const discardChangedDraft = isSheetVisible &&
      hasChangedTechniqueDraft(activeContext) &&
      window.confirm("Остаться на текущем персонаже — Отмена. Отбросить изменённый черновик техник и перейти к выбору персонажа?");
    if (isSheetVisible && hasChangedTechniqueDraft(activeContext) && !discardChangedDraft) return;
    if (isSheetVisible) {
      if (!flushEditableFields()) return;
      const saved = retryPersistedState();
      if (!saved.ok) {
        showPersistenceWarning("Не удалось сохранить текущего персонажа. Переключение отменено; повторите сохранение.");
        return;
      }
    }
    const opened = openCharacterSession(characterId, loadCharacterState);
    if (opened.status === "invalid" || opened.status === "unavailable") {
      if (isSheetVisible) {
        showPersistenceWarning(`Не удалось открыть ${characterId}: ${opened.reason}. Текущий лист оставлен без изменений.`);
      } else {
        showPicker(`Не удалось открыть ${characterId}: ${opened.reason}`, true);
      }
      return;
    }
    if (discardChangedDraft) clearTechniqueDrafts(activeContext.characterId);
    clearCharacterRollDraft();
    if (characterId === "sara-velaris" && opened.status === "missing") {
      showPicker();
      showSaraSetup(opened.context);
      return;
    }
    let openWarning = "";
    if (opened.status === "missing") {
      const persisted = retryPersistedState();
      if (!persisted.ok) openWarning = "Аурелия открыта, но defaults не сохранены. Повторите сохранение.";
    }
    const preferences = readAppPreferences();
    const oldCharacterId = preferences.status === "loaded"
      ? preferences.preferences.lastCharacterId
      : null;
    if (oldCharacterId && oldCharacterId !== characterId) clearTechniqueDrafts(oldCharacterId);
    completeCharacterOpen(characterId, openWarning);
  } finally {
    switchingCharacter = false;
  }
}

function returnToCharacterPicker() {
  if (switchingCharacter || !isSheetVisible) return;
  switchingCharacter = true;
  try {
    const context = getSessionContext();
    const discardRollDraft = hasChangedCharacterRollDraft() &&
      window.confirm("Остаться на текущем персонаже — Отмена. Отбросить незаписанный бросок и открыть выбор персонажей?");
    if (hasChangedCharacterRollDraft() && !discardRollDraft) return;
    if (hasUnsavedCharacterRoll()) {
      const savedRoll = retryPersistedState();
      if (!savedRoll.ok) {
        showPersistenceWarning("Бросок применён, но не сохранён. Выбор персонажей не открыт.");
        return;
      }
      markCharacterRollSaved();
    }
    const discardChangedDraft = hasChangedTechniqueDraft(context);
    if (discardChangedDraft &&
        !window.confirm("Остаться на текущем персонаже — Отмена. Отбросить изменённый черновик техник и перейти к выбору персонажа?")) return;
    if (!flushEditableFields()) return;
    const saved = retryPersistedState();
    if (!saved.ok) {
      showPersistenceWarning("Не удалось сохранить текущего персонажа. Выбор персонажей не открыт.");
      return;
    }
    if (discardChangedDraft) clearTechniqueDrafts(context.characterId);
    clearCharacterRollDraft();
    showPersistenceWarning("");
    showPicker();
  } finally {
    switchingCharacter = false;
  }
}

function bindAppControls() {
  document.querySelectorAll("[data-app-action]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      if (!button.isConnected) return;
      if (button.dataset.appAction === "choose-characters") returnToCharacterPicker();
      if (button.dataset.appAction === "retry-save") {
        const result = retryPersistedState();
        if (result.ok) markCharacterRollSaved();
        showPersistenceWarning(result.ok ? "" : "Сохранение не удалось. Попробуйте ещё раз.");
      }
    });
    button.dataset.bound = "true";
  });
}

function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

function initTelegramWebApp() {
  const tg = getTelegramWebApp();

  if (!tg) {
    console.warn("Telegram WebApp SDK is unavailable");
    return null;
  }

  try {
    tg.ready();
    tg.expand();

    document.documentElement.style.setProperty(
      "--tg-bg-color",
      tg.themeParams?.bg_color || "",
    );
    document.documentElement.style.setProperty(
      "--tg-text-color",
      tg.themeParams?.text_color || "",
    );
  } catch (error) {
    console.error("Failed to initialize Telegram WebApp", error);
    return null;
  }

  return tg;
}

function initApp() {
  initTelegramWebApp();
  bindAppControls();
  const preferences = readAppPreferences();
  if (preferences.status === "loaded" && preferences.preferences.lastCharacterId) {
    selectCharacter(preferences.preferences.lastCharacterId);
    return;
  }
  if (preferences.status === "invalid" || preferences.status === "unavailable") {
    showPicker(`Настройки приложения недоступны: ${preferences.reason}`, true);
  } else {
    showPicker("Выберите персонажа.");
  }
}

function debugDerived(character) {
  const derived = getDerivedStats(character);

  console.group("Derived debug");
  console.log("hasJackOfAllTrades", derived.hasJackOfAllTrades);
  console.log("abilityModifiers", derived.abilityModifiers);
  console.log("abilityChecks", derived.abilityChecks);
  console.log("savingThrows", derived.savingThrows);
  console.log("skills", derived.skills);
  console.log("spellSaveDc", derived.spellStats?.spellSaveDc);
  console.log("spellAttackBonus", derived.spellStats?.spellAttackBonus);
  console.log("initiative", derived.initiative);
  console.log("passivePerception", derived.passivePerception);
  console.groupEnd();
}

window.debug = {
  getState: () => getState(),
  getDerivedStats: (state) => getDerivedStats(state),
  debugDerived: (state) => debugDerived(state),
  subscribe: (listener) => subscribe(listener),
};

subscribe((_state, metadata) => {
  if (metadata?.kind === "lore-note-edit") {
    const key = `${_state.profile?.id ?? "aurelia"}:${metadata.noteId}`;
    if (metadata.persistenceResult?.ok) failedLoreNoteIds.delete(key);
    else failedLoreNoteIds.add(key);
    updateLoreNoteEditView(metadata);
    return;
  }
  if (metadata?.persistenceResult?.ok === false) {
    showPersistenceWarning("Изменения применены в памяти, но не сохранены. Повторите сохранение.");
  }
  if (metadata?.kind === "persistence-retry" && metadata.persistenceResult?.ok) {
    markCharacterRollSaved();
    showPersistenceWarning("");
  }
  if (metadata?.kind === "reset") {
    clearTechniqueDrafts(metadata.characterId);
    resetPortraitForCharacter(metadata.characterId);
    activateLoreCharacter(metadata.characterId);
    configureTabs(metadata.characterId);
  }
  renderApp();
});

window.addEventListener("pagehide", flushLoreNotes);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushLoreNotes();
});

initApp();