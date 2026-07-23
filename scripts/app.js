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

import { createActionHandlers, STATELESS_ACTIONS } from "./actions.js";
import {
  ensureEffectsState,
  ensureInventoryState,
} from "./state-helpers.js";

const actionHandlers = createActionHandlers({ resetState });

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

    element.addEventListener("click", (event) => {
      const target = event.currentTarget;
      const action = target.dataset.action;
      const handler = actionHandlers[action];

      if (!handler) {
        return;
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

        item[field] = value;
        return draft;
      });
    });

    element.dataset.bound = "true";
  });
}

function bindUi(root = document) {
  bindEditableFields(root);
  bindActionButtons(root);
  bindInventoryFields(root);
  bindEffectFields(root);
}

function renderApp() {
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
  renderInventoryPanel(state);
  renderLorePanel(state);

  bindUi(document);
  initPortraitControls();
}

function initApp() {
  initTabs();
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

subscribe(() => {
  renderApp();
});

initApp();