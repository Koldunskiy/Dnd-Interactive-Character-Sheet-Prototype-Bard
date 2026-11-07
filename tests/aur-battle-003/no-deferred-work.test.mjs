import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import {
  getWorkspaceRecoverySessions,
  getWorkspaceSessionForTests,
  minimizeWorkspace,
  openNormalAttack,
  prepareWorkspaceTabTransition,
} from "../../scripts/workspace/controller.js";
import { getSavedPlayerRecords } from "../../scripts/battle/player-hub.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { getWorkspaceHost } from "../../scripts/workspace/host.js";
import { initTabs } from "../../scripts/tabs.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("N01/N02 canonical records remain accessible without a pending-work queue", () => {
  const { unsubscribe } = installWorkspaceFixture();
  const markup = renderBattleConsole(getState());
  assert.doesNotMatch(markup, /battle-unfinished-work|visibleWorkCount|Обязательные последствия|Черновики/);
  assert.equal(getSavedPlayerRecords(getState()).sequences.length, 0);
  const populated = structuredClone(getState());
  populated.monk.combatAssistant.activeSequences = [{
    id: "legacy-pending-sequence",
    kind: "attack-action",
    status: "open",
    maximumAttacks: 1,
    resolvedAttacks: [{
      id: "legacy-pending-hit",
      slotNumber: 1,
      hitResult: "hit",
      damageStatus: "awaiting-damage",
    }],
  }];
  const populatedMarkup = renderBattleConsole(populated);
  assert.doesNotMatch(populatedMarkup, /battle-unfinished-work|Урон · удар/);
  assert.equal(getSavedPlayerRecords(populated).sequences.length, 1);
  unsubscribe();
});

test("N03/N05 dirty workspace stays active and synthetic defer actions are side-effect free", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  assert.equal(openNormalAttack().ok, true);
  fireWorkspaceInput(dialog, "firstD20", "13");
  const before = structuredClone(getWorkspaceSessionForTests());
  const canonicalStateBefore = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storage = new Map(window.localStorage.values);
  assert.equal(minimizeWorkspace(), false);
  fireWorkspaceAction(dialog, "minimize");
  fireWorkspaceAction(dialog, "roll-defer");
  const after = getWorkspaceSessionForTests();
  assert.equal(after.workspaceSessionId, before.workspaceSessionId);
  assert.equal(after.currentStep, before.currentStep);
  assert.equal(after.currentStepKey, before.currentStepKey);
  assert.deepEqual(after.rawInputsByStep, before.rawInputsByStep);
  assert.deepEqual(getState(), canonicalStateBefore);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(window.localStorage.values, storage);
  assert.deepEqual(getWorkspaceRecoverySessions(), []);
  unsubscribe();
});

test("N06/N25 Back requests close and tab transition leaves the active workspace intact", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  assert.equal(openNormalAttack().ok, true);
  fireWorkspaceAction(dialog, "attack-miss");
  fireWorkspaceAction(dialog, "back");
  assert.equal(getWorkspaceSessionForTests().currentStep, "confirm-close");
  const currentId = getWorkspaceSessionForTests().workspaceSessionId;
  prepareWorkspaceTabTransition("melee", "inventory");
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, currentId);
  assert.notEqual(getWorkspaceSessionForTests().minimized, true);
  unsubscribe();
});

test("N25 real tab activation keeps the permanent-dock workspace and its owner/input", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousMatchMedia = window.matchMedia;
  class TabButton {
    constructor(tab) {
      this.dataset = { tab };
      this.classList = { toggle() {} };
      this.listeners = new Map();
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    setAttribute() {}
    click() { this.listeners.get("click")?.(); }
  }
  class TabPanel {
    constructor(panel) {
      this.dataset = { panel };
      this.classList = { toggle() {} };
      this.hidden = false;
    }
  }
  class AppRoot {
    constructor() {
      this.dataset = { screen: "sheet" };
      this.style = { setProperty() {} };
    }
  }
  globalThis.HTMLElement = AppRoot;
  window.matchMedia = () => ({ matches: false });
  const appRoot = new AppRoot();
  const buttons = ["melee", "inventory"].map((tab) => new TabButton(tab));
  const panels = ["melee", "inventory"].map((panel) => new TabPanel(panel));
  globalThis.document = {
    ...previousDocument,
    querySelector(selector) {
      return selector === ".page" ? appRoot : previousDocument.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (selector === "[data-tab]") return buttons;
      if (selector === "[data-panel]") return panels;
      return [];
    },
  };
  try {
    assert.equal(openNormalAttack().ok, true);
    fireWorkspaceInput(dialog, "firstD20", "17");
    const before = getWorkspaceSessionForTests();
    const stateBefore = structuredClone(getState());
    const revisionBefore = getSessionContext().stateRevision;
    const storageBefore = new Map(window.localStorage.values);
    initTabs(() => {}, {
      tabs: ["melee", "inventory"],
      characterId: "sara-velaris",
      sessionGeneration: getSessionContext().sessionGeneration,
      initialTab: "melee",
      beforeActivate: (fromTab, toTab) =>
        prepareWorkspaceTabTransition(fromTab, toTab),
    });
    buttons[1].click();
    const after = getWorkspaceSessionForTests();
    assert.equal(appRoot.dataset.activeTab, "inventory");
    assert.equal(after.workspaceSessionId, before.workspaceSessionId);
    assert.deepEqual(after.owner, before.owner);
    assert.equal(getWorkspaceHost(), dialog);
    assert.equal(dialog.hidden, false);
    assert.equal(after.minimized, false);
    assert.equal(after.rawInputsByStep[after.currentStepKey].firstD20, "17");
    assert.deepEqual(getState(), stateBefore);
    assert.equal(getSessionContext().stateRevision, revisionBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
  } finally {
    globalThis.document = previousDocument;
    globalThis.HTMLElement = previousHTMLElement;
    window.matchMedia = previousMatchMedia;
    unsubscribe();
  }
});
