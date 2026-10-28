import { initTabs } from "./tabs.js";
import { getState, subscribe, setValue, updateState, resetState } from "./state.js";
import { getDerivedStats } from "./calculations.js";
import { renderPortraitMedia, initPortraitControls } from "./media.js";

import { renderHeader } from "./render/render-header.js";
import { renderQuickStats, renderSidebarSummary } from "./render/render-sidebar.js";
import { renderProfile } from "./render/render-profile.js";
import { renderMeleePanel } from "./render/render-melee.js";
import { renderSpells } from "./render/render-spells.js";
import { renderLorePanel } from "./render/render-lore.js";
import { renderInventoryPanel } from "./render/render-inventory.js";
import { renderSpellLibrary } from "./render/render-spell-library.js";
import {
  setSpellSlotChoice,
} from "./render/render-spells.js";
import {
  clearLoreNoteStatus,
  setLoreNoteExpanded,
  updateLoreNoteEditView,
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
      const path = target.dataset.bind;
      const value = parseInputValue(target);

      setValue(path, value);
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

      updateState((draft) => {
        handler(draft, target);
        return draft;
      });
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
      const effectId = target.dataset.effectId;
      const field = target.dataset.bindEffectField;
      const value = target.type === "checkbox" ? target.checked : target.value;

      updateState((draft) => {
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

      updateState((draft) => {
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

      updateState((draft) => {
        handler(draft, target);
        return draft;
      });
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
        const handler = actionHandlers["spell-library-search"];

        if (!handler) {
          return;
        }

        const selectionStart = target.selectionStart ?? target.value.length;
        const selectionEnd = target.selectionEnd ?? selectionStart;

        updateState((draft) => {
          handler(draft, target);
          return draft;
        });

        requestAnimationFrame(() => {
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
  const noteId = input.dataset.noteId;
  const field = input.dataset.noteField;
  if (!noteId || !["title", "text"].includes(field)) return;
  const value = input.value;
  const current = getState().lore?.noteEntries?.find((note) => note.id === noteId);
  if (!current || (current[field] === value && !failedLoreNoteIds.has(noteId))) return;
  updateState((draft) => {
    const updated = updateNoteEntry(draft.lore.noteEntries, noteId, field, value);
    if (!updated.issue) draft.lore.noteEntries = updated.entries;
    return draft;
  }, { kind: "lore-note-edit", noteId, field });
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
    if (!input || !root.contains(input) || input.dataset.composing === "true") return;
    persistLoreNoteField(input);
  });
  root.addEventListener("change", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (input && root.contains(input)) persistLoreNoteField(input);
  });
  root.addEventListener("blur", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (input && root.contains(input)) persistLoreNoteField(input);
  }, true);
  root.addEventListener("compositionstart", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (input) input.dataset.composing = "true";
  });
  root.addEventListener("compositionend", (event) => {
    const input = event.target.closest?.("[data-note-field]");
    if (!input) return;
    input.dataset.composing = "false";
    persistLoreNoteField(input);
  });
  root.addEventListener("click", (event) => {
    const target = event.target.closest?.("button");
    if (!target || !root.contains(target)) return;
    const card = target.closest("[data-note-id]");
    if (target.matches("[data-note-add]")) {
      const entries = getState().lore?.noteEntries;
      if (validateNoteEntries(entries)) return;
      const id = globalThis.crypto?.randomUUID?.() ??
        `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setLoreNoteExpanded(id, true);
      updateState((draft) => {
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
      updateState((draft) => {
        const deleted = deleteNoteEntry(draft.lore.noteEntries, noteId);
        if (!deleted.issue) draft.lore.noteEntries = deleted.entries;
        return draft;
      });
      setLoreNoteExpanded(noteId, false);
      clearLoreNoteStatus(noteId);
      failedLoreNoteIds.delete(noteId);
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
      const spellId = select.dataset.spellSlotSelect;
      const slotLevel = Number(select.value);
      setSpellSlotChoice(spellId, slotLevel);
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
  const derived = getDerivedStats(state);

  const profilePanel = document.getElementById("profilePanel");
  const spellsPanel = document.getElementById("spellsPanel");

  renderHeader(state);
  renderPortraitMedia(state);
  renderQuickStats(state, derived);
  renderSidebarSummary(state);

  renderProfile(profilePanel, state, derived);
  renderMeleePanel(state, derived);
  renderSpells(spellsPanel, state, derived);
  renderSpellLibraryIfNeeded(state, derived);
  renderInventoryPanel(state);
  renderLorePanel(state);

  bindUi(document);
  initPortraitControls();
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
  initTabs(handleTabActivation, { beforeActivate: flushLoreNotes });
  renderApp();
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
    if (metadata.persistenceResult?.ok) failedLoreNoteIds.delete(metadata.noteId);
    else failedLoreNoteIds.add(metadata.noteId);
    updateLoreNoteEditView(metadata);
    return;
  }
  renderApp();
});

window.addEventListener("pagehide", flushLoreNotes);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushLoreNotes();
});

initApp();