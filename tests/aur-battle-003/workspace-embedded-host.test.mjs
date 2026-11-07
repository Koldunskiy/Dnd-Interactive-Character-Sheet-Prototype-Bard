import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState, openCharacterSession, subscribe, updateState } from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  disposeWorkspaceOwner,
  getWorkspaceSessions,
  openNormalAttack,
  openSaraBattleCommand,
  getWorkspaceSessionForTests,
  requestEndBattle,
} from "../../scripts/workspace/controller.js";
import {
  getWorkspaceHost,
  renderWorkspaceHost,
  workspaceHostIsEmbedded,
} from "../../scripts/workspace/host.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { CLERIC_CANTRIPS } from "../../data/monk-techniques.js";
import { MONK_TECHNIQUES } from "../../data/monk-techniques.js";
import { renderCommandWorkspace } from "../../scripts/render/render-command-workspace.js";
import { updateRestReplacementSubchoices } from "../../scripts/render/render-command-workspace.js";
import {
  fireWorkspaceInput,
  fireWorkspaceAction,
  fireWorkspaceActionStrict,
  FixtureForm,
  FixtureInput,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

function beginActiveBattle() {
  assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  return getState().battleConsole.current.id;
}

function setAttackDraft(dialog, value) {
  dialog.forms.attack = new FixtureForm("attack", { firstD20: value }, {
    firstD20: { type: "number", min: 1, max: 20 },
  });
  fireWorkspaceInput(dialog, "firstD20", value);
}

function submitSeekingMiss(dialog) {
  dialog.forms.seeking = new FixtureForm("seeking", {
    rollMode: "normal",
    firstD20: "3",
    secondD20: "",
    targetArmorClass: "30",
    dmHitResult: "miss",
    dmExceptionConfirmed: false,
  }, {
    firstD20: { required: true, min: 1, max: 20, type: "number" },
    targetArmorClass: { min: 1, max: 99, type: "number" },
  });
  fireWorkspaceAction(dialog, "submit-seeking");
}

function fireDockEnd(dialog, owner, battleId) {
  fireWorkspaceAction(dialog, "end-battle", {
    battleId,
    battleOwner: JSON.stringify([owner.characterId, owner.sessionGeneration]),
  });
}

test("Sara combat tasks use the embedded host without dialog or body-lock behavior", () => {
  const { dialog, taskHud, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const stateBefore = JSON.stringify(getState());
  const bodyStyles = { ...globalThis.document.body.style };

  const opened = openNormalAttack();
  assert.equal(opened.ok, true);
  assert.match(taskHud.innerHTML, /class="sara-hud"/);
  assert.match(taskHud.innerHTML, /ХП <strong>/);
  assert.equal(JSON.stringify(getState()), stateBefore);
  assert.equal(workspaceHostIsEmbedded(), true);
  assert.equal(getWorkspaceHost(), dialog);
  assert.equal(dialog.showModalCount, 0);
  assert.equal(dialog.open, false);
  assert.deepEqual(globalThis.document.body.style, bodyStyles);

  const card = renderBattleConsole(getState());
  assert.match(card, /combat-active-task/);
  assert.doesNotMatch(card, /data-battle-command-open="normal-attack"/);

  dialog.forms.attack = {
    dataset: { workspaceForm: "attack" },
    elements: [{ name: "firstD20", type: "number", value: "1" }],
    contains: () => true,
    closest: () => null,
  };
  fireWorkspaceInput(dialog, "firstD20", "17");
  assert.equal(
    getWorkspaceSessionForTests().rawInputsByStep[
      getWorkspaceSessionForTests().currentStepKey
    ].firstD20,
    "17",
  );
  const activeField = {};
  const formNode = {
    dataset: { workspaceForm: "attack" },
    contains: (node) => node === activeField,
  };
  dialog.body.querySelector = (selector) =>
    selector === "[data-workspace-form]" ? formNode : null;
  globalThis.document.activeElement = activeField;
  const existingBody = dialog.body.innerHTML;
  renderWorkspaceHost({
    header: dialog.header.innerHTML,
    body: `${existingBody}<!-- updated state -->`,
    footer: dialog.footer.innerHTML,
    error: "Проверьте введённое значение.",
  });
  assert.equal(dialog.body.innerHTML, existingBody);
  assert.equal(dialog.error.textContent, "Проверьте введённое значение.");
  assert.equal(dialog.error.hidden, false);
  unsubscribe();
});

test("dock cancellation preserves a dirty attack draft, session, state, and Map storage", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = beginActiveBattle();
  assert.equal(openNormalAttack().ok, true);
  setAttackDraft(dialog, "17");
  const owner = getWorkspaceSessionForTests().owner;
  const sessionId = getWorkspaceSessionForTests().workspaceSessionId;
  const stateBefore = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  let confirms = 0;
  window.confirm = () => { confirms += 1; return false; };

  fireDockEnd(dialog, owner, battleId);

  assert.equal(confirms, 1);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, sessionId);
  assert.equal(getWorkspaceSessionForTests().rawInputsByStep[
    getWorkspaceSessionForTests().currentStepKey].firstD20, "17");
  assert.equal(dialog.forms.attack.elements[0].value, "17");
  assert.deepEqual(getState(), stateBefore);
  assert.deepEqual(window.localStorage.values, storageBefore);
  unsubscribe();
});

test("dock host delegation confirms once, archives once, and discards an unrecorded attack", () => {
  const { dialog, taskSceneControls, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = beginActiveBattle();
  assert.equal(openNormalAttack().ok, true);
  setAttackDraft(dialog, "16");
  const owner = getWorkspaceSessionForTests().owner;
  assert.match(taskSceneControls.innerHTML, /data-sara-end-battle/);
  let confirms = 0;
  window.confirm = () => { confirms += 1; return true; };

  fireDockEnd(dialog, owner, battleId);

  assert.equal(confirms, 1);
  assert.equal(getState().battleConsole.current, null);
  assert.equal(getState().battleConsole.history.filter((entry) =>
    entry.id === battleId && entry.phase === "ended").length, 1);
  assert.equal(getWorkspaceSessionForTests(), null);
  assert.equal(getWorkspaceSessions().filter((entry) =>
    entry.workspaceSessionId && entry.label).length, 0);
  assert.equal(getState().monk.combatAssistant?.activeSequences?.filter((entry) =>
    entry.kind === "attack-action").length ?? 0, 0);
  assert.equal(dialog.hidden, true);
  unsubscribe();
});

test("battle end removes parent and child sessions without restoring the suspended parent", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = beginActiveBattle();
  assert.equal(openNormalAttack().ok, true);
  assert.equal(openSaraBattleCommand("character-roll").ok, true);
  const owner = getWorkspaceSessionForTests().owner;
  assert.equal(getWorkspaceSessions().filter((entry) => entry.suspended).length, 1);
  window.confirm = () => true;

  fireDockEnd(dialog, owner, battleId);

  assert.equal(getWorkspaceSessionForTests(), null);
  assert.equal(getWorkspaceSessions().length, 0);
  assert.equal(dialog.hidden, true);
  assert.equal(getState().battleConsole.current, null);
  unsubscribe();
});

test("dock end closes numeric entry through the host and releases presentation", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = beginActiveBattle();
  assert.equal(openNormalAttack().ok, true);
  const field = new FixtureInput("firstD20", "12");
  field.dataset.workspaceField = "firstD20";
  field.parentElement = dialog.body;
  document.activeElement = field;
  dialog.fire("focusin", { target: field });
  assert.equal(dialog.dataset.entryActive, "true");
  assert.equal(document.documentElement.hasAttribute("data-combat-entry-active"), true);
  const owner = getWorkspaceSessionForTests().owner;
  window.confirm = () => true;

  fireDockEnd(dialog, owner, battleId);

  assert.equal(getWorkspaceSessionForTests(), null);
  assert.equal(dialog.hidden, true);
  assert.equal(dialog.dataset.entryActive, undefined);
  assert.equal(document.documentElement.hasAttribute("data-combat-entry-active"), false);
  unsubscribe();
});

test("resolved uncertain request for archived A cannot clear B workspace or its draft", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleA = beginActiveBattle();
  const ownerA = getSessionContext();
  assert.equal(openNormalAttack().ok, true);
  let archivedA;
  const removeArchive = subscribe((state, metadata) => {
    if (metadata?.kind === "battle-command" && metadata.command === "end-battle") {
      archivedA = structuredClone(state.battleConsole.history.find((entry) => entry.id === battleA));
      state.battleConsole.history = state.battleConsole.history.filter((entry) => entry.id !== battleA);
      throw new Error("simulate unverified post-commit state");
    }
  });
  const uncertain = requestEndBattle({ owner: ownerA, battleId: battleA }, { confirm: () => true });
  removeArchive();
  assert.equal(uncertain.status, "verification-required");

  const battleB = beginActiveBattle();
  assert.notEqual(battleB, battleA);
  assert.equal(openNormalAttack().ok, true);
  setAttackDraft(dialog, "14");
  updateState((state) => {
    state.battleConsole.history.push(archivedA);
    return state;
  });
  const sessionBefore = getWorkspaceSessionForTests();
  const stateBefore = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);

  const stale = requestEndBattle({ owner: ownerA, battleId: battleA }, { confirm: () => {
    assert.fail("resolved uncertain request must not open another confirm");
  } });

  assert.equal(stale.status, "rejected");
  assert.equal(stale.cleanupSkipped, true);
  assert.equal(stale.staleContext, true);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, sessionBefore.workspaceSessionId);
  assert.equal(getWorkspaceSessionForTests().rawInputsByStep[
    getWorkspaceSessionForTests().currentStepKey].firstD20, "14");
  assert.deepEqual(getState(), stateBefore);
  assert.deepEqual(window.localStorage.values, storageBefore);
  unsubscribe();
});

test("reentrant end request is rejected while the outer request confirms exactly once", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = beginActiveBattle();
  const owner = getSessionContext();
  let confirmCalls = 0;
  let nested;
  const result = requestEndBattle({ owner, battleId }, { confirm: () => {
    confirmCalls += 1;
    nested = requestEndBattle({ owner, battleId }, { confirm: () => {
      confirmCalls += 1;
      return true;
    } });
    return true;
  } });
  assert.equal(nested.status, "rejected");
  assert.equal(confirmCalls, 1);
  assert.equal(result.status, "applied");
  assert.equal(getState().battleConsole.history.filter((entry) => entry.id === battleId).length, 1);
  unsubscribe();
});

test("owner or battle replacement during confirm rejects without clearing the replacement workspace", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleA = beginActiveBattle();
  const ownerA = getSessionContext();
  assert.equal(openNormalAttack().ok, true);
  const result = requestEndBattle({ owner: ownerA, battleId: battleA }, { confirm: () => {
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    const battleB = beginActiveBattle();
    assert.notEqual(battleB, battleA);
    assert.equal(openNormalAttack().ok, true);
    setAttackDraft(dialog, "13");
    return true;
  } });
  const sessionB = getWorkspaceSessionForTests();
  assert.equal(result.status, "rejected");
  assert.equal(getState().battleConsole.history.some((entry) =>
    entry.id === battleA && entry.phase === "ended"), false);
  assert.equal(getState().battleConsole.current.phase, "own-turn");
  assert.equal(sessionB.rawInputsByStep[sessionB.currentStepKey].firstD20, "13");
  unsubscribe();
});

test("applied A with synchronous B scene and workspace replacement skips stale cleanup", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleA = beginActiveBattle();
  const owner = getSessionContext();
  assert.equal(openNormalAttack().ok, true);
  let battleB;
  const replaceScene = subscribe((_state, metadata) => {
    if (metadata?.kind !== "battle-command" || metadata.command !== "end-battle") return;
    battleB = beginActiveBattle();
    assert.equal(openNormalAttack().ok, true);
    setAttackDraft(dialog, "15");
    throw new Error("subscriber replaced scene then failed");
  });

  const result = requestEndBattle({ owner, battleId: battleA }, { confirm: () => true });
  replaceScene();

  const sessionB = getWorkspaceSessionForTests();
  assert.equal(result.status, "applied");
  assert.equal(result.persistenceUnconfirmed, true);
  assert.equal(result.cleanupSkipped, true);
  assert.equal(result.staleContext, true);
  assert.match(result.warning, /subscriber replaced scene then failed/);
  assert.equal(getState().battleConsole.history.filter((entry) =>
    entry.id === battleA && entry.phase === "ended").length, 1);
  assert.equal(getState().battleConsole.current.id, battleB);
  assert.equal(sessionB.battleContext.battleId, battleB);
  assert.equal(sessionB.rawInputsByStep[sessionB.currentStepKey].firstD20, "15");
  unsubscribe();
});

test("changing workspace steps replaces the focused form instead of leaving stale controls", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const focusedInput = {};
  const attackForm = {
    dataset: { workspaceForm: "attack" },
    contains: (node) => node === focusedInput,
  };
  dialog.body.innerHTML = '<form data-workspace-form="attack"></form>';
  dialog.body.querySelector = (selector) =>
    selector === "[data-workspace-form]" ? attackForm : null;
  dialog.body.contains = (node) => node === focusedInput;
  globalThis.document.activeElement = focusedInput;

  const damageMarkup = '<form data-workspace-form="damage"></form>';
  renderWorkspaceHost({
    header: "<h2>Урон</h2>",
    body: damageMarkup,
    footer: "<button>Записать урон</button>",
  });

  assert.equal(dialog.body.innerHTML, damageMarkup);
  assert.match(dialog.footer.innerHTML, /Записать урон/);
  unsubscribe();
});

test("a changed workspace view replaces a focused footer and clears stale deferred markup", async () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const focusedApply = {
    parentElement: dialog.footer,
    matches: () => false,
  };
  dialog.footer.contains = (node) => node === focusedApply;
  dialog.footer.innerHTML = '<button data-workspace-action="apply-command">Apply</button>';
  globalThis.document.activeElement = focusedApply;

  renderWorkspaceHost({
    header: "<h2>Результат</h2>",
    body: "<p>Ки потрачено</p>",
    footer: '<button data-workspace-action="done">Готово</button>',
    viewKey: JSON.stringify(["task-1", "command-result:none", true]),
  });
  assert.match(dialog.footer.innerHTML, /data-workspace-action="done"/);
  assert.doesNotMatch(dialog.footer.innerHTML, /apply-command/);

  globalThis.document.activeElement = null;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  dialog.fire("focusout", { target: focusedApply });
  globalThis.requestAnimationFrame = previousAnimationFrame;
  assert.match(dialog.footer.innerHTML, /data-workspace-action="done"/);
  assert.doesNotMatch(dialog.footer.innerHTML, /apply-command/);
  unsubscribe();
});

test("changing workspace steps updates a focused task title immediately", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const focusedTitle = {
    matches: (selector) => selector === "[data-workspace-title]",
  };
  dialog.header.innerHTML = "<h2>Продолжение атаки</h2>";
  dialog.header.contains = (node) => node === focusedTitle;
  globalThis.document.activeElement = focusedTitle;

  const nextHeader = '<div><h2 data-workspace-title>Удар 2/2 · безоружный</h2></div>';
  renderWorkspaceHost({
    header: nextHeader,
    body: dialog.body.innerHTML,
    footer: dialog.footer.innerHTML,
  });

  assert.equal(dialog.header.innerHTML, nextHeader);
  unsubscribe();
});

test("potion inventory command opens shared dock, applies physical sum, and shows recorded result", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.combat.hp.current = 1;
    draft.inventory.items.find((item) => item.id === "healing-potion").quantity = 1;
    return draft;
  });

  const opened = openSaraBattleCommand("potion-use:healing-potion:healing-potion");
  assert.equal(opened.ok, true);
  assert.match(dialog.body.innerHTML, /Сумма физических костей/);
  assert.match(dialog.footer.innerHTML, /Применить зелье · записать итог/);

  dialog.forms.command = new FixtureForm("command", {
    target: "self",
    sum: "7",
    intentionalWaste: false,
  });
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getWorkspaceSessionForTests().currentStep, "command-result");
  assert.match(dialog.body.innerHTML, /Полезное лечение: 9 HP/);
  assert.equal(getState().combat.hp.current, 10);
  assert.equal(getState().inventory.items.find((item) => item.id === "healing-potion").quantity, 0);
  unsubscribe();
});

test("equipped dart profile records the weapon snapshot and spends exactly one dart on a hit", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.inventory.items.find((item) => item.id === "darts").equipped = true;
    return draft;
  });
  const opened = openNormalAttack();
  assert.equal(opened.ok, true);
  assert.match(dialog.body.innerHTML, /Профиль атаки/);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "darts",
    rollMode: "normal",
    firstD20: "15",
  });
  fireWorkspaceActionStrict(dialog, "attack-hit");
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 20);
  dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
  fireWorkspaceInput(dialog, "damage1", "3");
  fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === getWorkspaceSessionForTests().sequenceId);
  const attack = sequence.resolvedAttacks[0];
  assert.equal(attack.profileId, "darts");
  assert.equal(attack.profileSnapshot.attackKind, "weapon");
  assert.equal(attack.ammunitionSpend.itemId, "darts");
  assert.equal(attack.hitResult, "hit");
  assert.equal(attack.damageStatus, "recorded");
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 19);
  unsubscribe();
});

test("new Seeking intent is free and the replacement commits through the live workspace route", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "2",
    targetArmorClass: "30",
  }, {
    firstD20: { required: true, min: 1, max: 20, type: "number" },
  });
  fireWorkspaceAction(dialog, "attack-miss");
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  assert.match(dialog.footer.innerHTML, /begin-seeking/);
  const sequenceId = getWorkspaceSessionForTests().sequenceId;
  const attackId = getWorkspaceSessionForTests().attackId;
  const kiBefore = getState().combat.ki.current;
  updateState((draft) => {
    const item = draft.inventory.items.find((entry) => entry.id === "darts");
    if (item) item.quantity += 1;
    return draft;
  });
  fireWorkspaceAction(dialog, "begin-seeking");
  assert.equal(getWorkspaceSessionForTests().currentStep, "seeking-input");
  assert.equal(getState().combat.ki.current, kiBefore);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0].seekingAmendments, undefined);
  dialog.forms.seeking = new FixtureForm("seeking", {
    rollMode: "normal",
    firstD20: "3",
    targetArmorClass: "30",
    dmHitResult: "miss",
  }, {
    firstD20: { required: true, min: 1, max: 20, type: "number" },
    targetArmorClass: { min: 1, max: 99, type: "number" },
  });

  fireWorkspaceAction(dialog, "submit-seeking");
  const attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0];
  assert.equal(attack.id, attackId);
  assert.equal(attack.seekingAmendments.length, 1);
  assert.equal(attack.seekingAmendments[0].status, "resolved");
  assert.equal(attack.seekingAmendment.status, "resolved");
  assert.equal(attack.hitResult, "miss");
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(attack.damageStatus, "not-applicable");
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  unsubscribe();
});

test("Seeking begin ignores unrelated malformed history and creates a free transient intent", () => {
  const first = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  first.dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    targetArmorClass: "30",
  }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
  fireWorkspaceAction(first.dialog, "attack-miss");
  const firstTask = getWorkspaceSessionForTests();
  const firstAttack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === firstTask.sequenceId).resolvedAttacks[0];
  updateState((draft) => {
    const invalid = {
      id: "unrelated-invalid",
      paidOperationId: "unrelated-invalid",
      parent: { actionId: "wrong", attackId: "wrong" },
      status: "resolved", kiPaid: 1, original: {},
    };
    draft.monk.combatAssistant.activeSequences.push({
      id: "unrelated-sequence", kind: "attack-action", status: "complete",
      resolvedAttacks: [{
        ...structuredClone(firstAttack),
        id: "unrelated-attack",
        seekingAmendments: [invalid, structuredClone(invalid)],
        seekingAmendment: null,
      }],
    });
    return draft;
  });
  const firstKi = getState().combat.ki.current;
  fireWorkspaceAction(first.dialog, "begin-seeking");
  assert.equal(getWorkspaceSessionForTests().currentStep, "seeking-input");
  assert.equal(getWorkspaceSessionForTests().submitting, false);
  assert.equal(getState().combat.ki.current, firstKi);
  first.unsubscribe();

  const second = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  second.dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    targetArmorClass: "30",
  }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
  fireWorkspaceAction(second.dialog, "attack-miss");
  const task = getWorkspaceSessionForTests();
  const parent = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === task.sequenceId);
  const attack = parent.resolvedAttacks[0];
  updateState((draft) => {
    const bad = {
      id: "ambiguous-payment-id",
      paidOperationId: "ambiguous-payment-id",
      parent: { actionId: "wrong", attackId: "wrong" },
      status: "resolved", kiPaid: 1, original: {},
    };
    draft.monk.combatAssistant.activeSequences.push({
      id: "collision-sequence", kind: "attack-action", status: "complete",
      resolvedAttacks: [{
        ...structuredClone(attack),
        id: "collision-attack",
        seekingAmendments: [bad],
        seekingAmendment: null,
      }],
    });
    return draft;
  });
  const before = getState().combat.ki.current;
  const previousCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "ambiguous-payment-id" },
  });
  try {
    fireWorkspaceAction(second.dialog, "begin-seeking");
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: previousCrypto,
    });
  }
  assert.equal(getState().combat.ki.current, before);
  assert.equal(getWorkspaceSessionForTests().submitting, false);
  assert.equal(getWorkspaceSessionForTests().currentStep, "seeking-input");
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === task.sequenceId).resolvedAttacks[0]
    .seekingAmendments, undefined);
  second.unsubscribe();
});

test("Seeking selected-parent conflict is a local rejection with retained evidence", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    targetArmorClass: "30",
  }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
  fireWorkspaceAction(dialog, "attack-miss");
  const task = getWorkspaceSessionForTests();
  const attackId = task.attackId;
  const duplicate = {
    id: "selected-conflict", paidOperationId: "selected-conflict",
    parent: { actionId: task.sequenceId, attackId },
    status: "resolved", kiPaid: 1, original: {},
  };
  updateState((draft) => {
    const attack = draft.monk.combatAssistant.activeSequences
      .find((entry) => entry.id === task.sequenceId).resolvedAttacks[0];
    attack.seekingAmendments = [duplicate, structuredClone(duplicate)];
    return draft;
  });
  const kiBefore = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "begin-seeking");
  assert.equal(getState().combat.ki.current, kiBefore);
  assert.equal(getWorkspaceSessionForTests().submitting, false);
  assert.match(dialog.body.innerHTML, /история Seeking Strike противоречива/i);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === task.sequenceId).resolvedAttacks[0]
    .seekingAmendments.length, 2);
  unsubscribe();
});

test("completed Seeking survives storage failure and retry saves without replaying payment", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    targetArmorClass: "30",
  }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
  fireWorkspaceAction(dialog, "attack-miss");
  const storage = globalThis.window.localStorage;
  const savedSetItem = storage.setItem;
  storage.setItem = () => { throw new Error("test storage outage"); };
  const kiBefore = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "begin-seeking");
  submitSeekingMiss(dialog);
  const task = getWorkspaceSessionForTests();
  assert.equal(task.currentStep, "checkpoint");
  assert.equal(task.appliedUnsaved, true);
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  const attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === task.sequenceId).resolvedAttacks[0];
  const operationId = attack.seekingAmendments[0].paidOperationId;
  fireWorkspaceAction(dialog, "begin-seeking");
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(attack.seekingAmendments.length, 1);
  storage.setItem = savedSetItem;
  fireWorkspaceAction(dialog, "retry-save");
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === task.sequenceId).resolvedAttacks[0]
    .seekingAmendments[0].paidOperationId, operationId);
  unsubscribe();
});

test("completed Seeking failure before mutation leaves Ki and parent unchanged", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    targetArmorClass: "30",
  }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
  fireWorkspaceAction(dialog, "attack-miss");
  fireWorkspaceAction(dialog, "begin-seeking");
  const kiBefore = getState().combat.ki.current;
  const originalClone = globalThis.structuredClone;
  let failOnce = true;
  globalThis.structuredClone = (value) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("pre-mutation test failure");
    }
    return originalClone(value);
  };
  try {
    submitSeekingMiss(dialog);
  } finally {
    globalThis.structuredClone = originalClone;
  }
  const task = getWorkspaceSessionForTests();
  assert.equal(task.submitting, false);
  assert.equal(task.appliedUnsaved, false);
  assert.equal(getState().combat.ki.current, kiBefore);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === task.sequenceId).resolvedAttacks[0].hitResult, "miss");
  unsubscribe();
});

test("Seeking post-commit exception is recovered; failed verification stays explicitly unknown", () => {
  const setup = () => {
    const fixture = installWorkspaceFixture({ embeddedHost: true });
    updateState((draft) => {
      draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
      return draft;
    });
    assert.equal(openNormalAttack().ok, true);
    fixture.dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "2",
      targetArmorClass: "30",
    }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
    fireWorkspaceAction(fixture.dialog, "attack-miss");
    fireWorkspaceAction(fixture.dialog, "begin-seeking");
    return fixture;
  };

  const applied = setup();
  const failAfterCommit = subscribe(() => {
    throw new Error("post-commit test failure");
  });
  const kiBefore = getState().combat.ki.current;
  submitSeekingMiss(applied.dialog);
  failAfterCommit();
  const recordedTask = getWorkspaceSessionForTests();
  assert.equal(recordedTask.submitting, false);
  assert.equal(recordedTask.appliedUnsaved, true);
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(recordedTask.currentStep, "checkpoint");
  assert.match(applied.dialog.footer.innerHTML, /retry-save/);
  applied.unsubscribe();

  const unknown = setup();
  const originalClone = globalThis.structuredClone;
  let inspectionFailed = false;
  let postCommitCallbackRan = false;
  const failVerification = subscribe(() => {
    postCommitCallbackRan = true;
    globalThis.structuredClone = (value) => {
      if (!inspectionFailed && value && !Array.isArray(value) &&
          Object.hasOwn(value, "paidOperationId")) {
        inspectionFailed = true;
        throw new Error("verification unavailable");
      }
      return originalClone(value);
    };
    throw new Error("post-commit verification test failure");
  });
  const secondKi = getState().combat.ki.current;
  try {
    submitSeekingMiss(unknown.dialog);
  } finally {
    globalThis.structuredClone = originalClone;
    failVerification();
  }
  const uncertainTask = getWorkspaceSessionForTests();
  assert.equal(postCommitCallbackRan, true);
  assert.equal(inspectionFailed, true);
  assert.equal(uncertainTask.submitting, false);
  assert.equal(uncertainTask.appliedUnsaved, false);
  assert.equal(getState().combat.ki.current, secondKi - 1);
  assert.equal(uncertainTask.readOnly, true);
  assert.doesNotMatch(unknown.dialog.footer.innerHTML, /retry-save/);
  unknown.unsubscribe();
});

test("A replaced workspace task is untouched by the old Begin handler finally", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    targetArmorClass: "30",
  }, { firstD20: { required: true, min: 1, max: 20, type: "number" } });
  fireWorkspaceAction(dialog, "attack-miss");
  fireWorkspaceAction(dialog, "begin-seeking");
  const oldTask = getWorkspaceSessionForTests();
  let replacementId = null;
  const replaceDuringFailure = subscribe(() => {
    disposeWorkspaceOwner(oldTask.owner, "session-changed");
    const opened = openNormalAttack();
    assert.equal(opened.ok, true);
    replacementId = getWorkspaceSessionForTests().workspaceSessionId;
    throw new Error("replace task after commit");
  });
  submitSeekingMiss(dialog);
  replaceDuringFailure();
  const replacement = getWorkspaceSessionForTests();
  assert.notEqual(replacement.workspaceSessionId, oldTask.workspaceSessionId);
  assert.equal(replacement.workspaceSessionId, replacementId);
  assert.equal(replacement.submitting, false);
  assert.equal(replacement.error, "");
  unsubscribe();
});

test("Gentling sequence-create and submit exceptions rerender after releasing submitting", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  const originalClone = globalThis.structuredClone;
  let failCreateOnce = true;
  globalThis.structuredClone = (value) => {
    if (failCreateOnce) {
      failCreateOnce = false;
      throw new Error("Gentling pre-mutation test failure");
    }
    return originalClone(value);
  };
  try {
    fireWorkspaceAction(dialog, "begin-gentling");
  } finally {
    globalThis.structuredClone = originalClone;
  }
  assert.equal(getWorkspaceSessionForTests().submitting, false);
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  assert.match(dialog.footer.innerHTML, /begin-gentling/);
  assert.doesNotMatch(dialog.footer.innerHTML, /begin-gentling[^>]*disabled/);
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);

  fireWorkspaceAction(dialog, "begin-gentling");
  const task = getWorkspaceSessionForTests();
  assert.equal(task.currentStep, "gentling-input");
  const kiBefore = getState().combat.ki.current;
  dialog.forms.gentling = new FixtureForm("gentling", {
    extraKi: "0", targetHp: "7", sum: "20",
  }, {
    extraKi: { required: true, min: 0, max: 30, type: "number" },
    targetHp: { required: true, min: 0, max: 9999, type: "number" },
    sum: { required: true, min: 1, max: 9999, type: "number" },
  });
  let failSubmitOnce = true;
  globalThis.structuredClone = (value) => {
    if (failSubmitOnce) {
      failSubmitOnce = false;
      throw new Error("Gentling submit pre-mutation test failure");
    }
    return originalClone(value);
  };
  try {
    fireWorkspaceAction(dialog, "submit-gentling");
  } finally {
    globalThis.structuredClone = originalClone;
  }
  const recovered = getWorkspaceSessionForTests();
  assert.equal(recovered.submitting, false);
  assert.equal(recovered.appliedUnsaved, false);
  assert.equal(recovered.currentStep, "gentling-input");
  assert.equal(getState().combat.ki.current, kiBefore);
  assert.match(dialog.body.innerHTML, /результат не обнаружен/i);
  assert.match(dialog.footer.innerHTML, /submit-gentling/);
  assert.doesNotMatch(dialog.footer.innerHTML, /submit-gentling[^>]*disabled/);
  unsubscribe();
});

test("Gentling Touch occupies the first real Attack slot, spends action once, and leaves no third slot", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  assert.match(dialog.footer.innerHTML, /begin-gentling/);
  updateState((draft) => {
    const item = draft.inventory.items.find((entry) => entry.id === "darts");
    if (item) item.quantity += 1;
    return draft;
  });
  const kiBefore = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "begin-gentling");
  assert.equal(getWorkspaceSessionForTests().currentStep, "gentling-input");
  const firstIntent = getWorkspaceSessionForTests().gentlingIntent;
  const dieCount = 5;
  const sides = getDerivedStats(getState()).monk.martialDieSides;
  dialog.forms.gentling = new FixtureForm("gentling", {
    extraKi: "0",
    targetHp: "7",
    sum: String(dieCount * sides),
  }, {
    extraKi: { required: true, min: 0, max: 30, type: "number" },
    targetHp: { required: true, min: 0, max: 9999, type: "number" },
    sum: { required: true, min: 1, max: 9999, type: "number" },
  });
  fireWorkspaceAction(dialog, "submit-gentling");
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === getWorkspaceSessionForTests().sequenceId);
  assert.equal(sequence.replacementResults[0].slotNumber, 1);
  assert.equal(sequence.actionFlagApplied, true);
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  const firstOwner = getWorkspaceSessionForTests().owner;
  const sequenceId = sequence.id;
  disposeWorkspaceOwner(firstOwner, "session-changed");
  assert.equal(openCharacterSession("sara-velaris").status, "loaded");
  assert.equal(openNormalAttack({ sequenceId }).ok, true);
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  fireWorkspaceAction(dialog, "begin-gentling");
  assert.equal(getWorkspaceSessionForTests().currentStep, "gentling-input");
  const secondSession = getWorkspaceSessionForTests();
  const secondIntent = secondSession.gentlingIntent;
  assert.notEqual(secondIntent.operationId, firstIntent.operationId);
  assert.notEqual(secondIntent.draftKey, firstIntent.draftKey);
  assert.equal(secondSession.rawInputsByStep[secondIntent.draftKey].sum, "");
  dialog.forms.gentling = new FixtureForm("gentling", {
    extraKi: "0",
    targetHp: "7",
    sum: String(dieCount * sides - 1),
  }, {
    extraKi: { required: true, min: 0, max: 30, type: "number" },
    targetHp: { required: true, min: 0, max: 9999, type: "number" },
    sum: { required: true, min: 1, max: 9999, type: "number" },
  });
  fireWorkspaceAction(dialog, "submit-gentling");
  const completed = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequence.id);
  assert.equal(completed.status, "complete");
  assert.equal(completed.replacementResults[1].slotNumber, 2);
  assert.equal(completed.resolvedAttacks.length + completed.replacementResults.length, 2);
  assert.equal(getState().combat.ki.current, kiBefore - 2);
  assert.equal(getWorkspaceSessionForTests().capabilities.canContinueSequence, false);
  unsubscribe();
});

test("Gentling Touch can replace the second slot after an ordinary attack in the workspace", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "2",
    targetArmorClass: "30",
  }, {
    firstD20: { required: true, min: 1, max: 20, type: "number" },
    targetArmorClass: { min: 1, max: 99, type: "number" },
  });
  fireWorkspaceAction(dialog, "attack-miss");
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  assert.match(dialog.footer.innerHTML, /begin-gentling/);
  fireWorkspaceAction(dialog, "begin-gentling");
  const sides = getDerivedStats(getState()).monk.martialDieSides;
  dialog.forms.gentling = new FixtureForm("gentling", {
    extraKi: "0",
    targetHp: "7",
    sum: String(5 * sides),
  }, {
    extraKi: { required: true, min: 0, max: 30, type: "number" },
    targetHp: { required: true, min: 0, max: 9999, type: "number" },
    sum: { required: true, min: 1, max: 9999, type: "number" },
  });
  fireWorkspaceAction(dialog, "submit-gentling");
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === getWorkspaceSessionForTests().sequenceId);
  assert.equal(sequence.resolvedAttacks[0].slotNumber, 1);
  assert.equal(sequence.replacementResults[0].slotNumber, 2);
  assert.equal(sequence.status, "complete");
  assert.equal(sequence.actionFlagApplied, true);
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getWorkspaceSessionForTests().capabilities.canContinueSequence, false);
  unsubscribe();
});

test("short rest runs in the dock, accepts sequential physical hit dice, then finishes", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.combat.hp.current = 1;
    draft.combat.ki.current = 0;
    draft.combat.hitDice.remaining = 3;
    return draft;
  });
  assert.equal(openSaraBattleCommand("completed-rest").ok, true);
  dialog.forms.command = new FixtureForm("command", { kind: "short" });
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getWorkspaceSessionForTests().command.restStage, "hit-die");
  assert.equal(getState().combat.ki.current, getState().profile.level + 4);

  dialog.forms.command = new FixtureForm("command", { roll: "2" });
  const rollControl = dialog.forms.command.elements[0];
  const originalBody = dialog.body.innerHTML;
  const focusedRoll = {};
  globalThis.document.activeElement = focusedRoll;
  fireWorkspaceInput(dialog, "roll", "2");
  assert.equal(dialog.body.innerHTML, originalBody);
  assert.equal(dialog.hitDieHealing.textContent, String(Math.max(
    0, 2 + getDerivedStats(getState()).abilityModifiers.constitution,
  )));
  assert.equal(globalThis.document.activeElement, focusedRoll);
  assert.equal(dialog.forms.command.elements[0], rollControl);
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().combat.hitDice.remaining, 2);
  assert.equal(getState().monk.functionalRuntime.rest.hitDiceSpent, 1);
  dialog.forms.command = new FixtureForm("command", { roll: "3" });
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().combat.hitDice.remaining, 1);
  assert.equal(getState().monk.functionalRuntime.rest.hitDiceSpent, 2);
  updateState((draft) => {
    draft.combat.hp.current = getDerivedStats(draft).maxHitPoints;
    return draft;
  });
  assert.match(dialog.footer.innerHTML, /data-workspace-action="apply-command"[^>]*disabled/);
  assert.match(dialog.footer.innerHTML, /data-workspace-action="finish-short-rest"/);
  let activeSession = getWorkspaceSessionForTests();
  disposeWorkspaceOwner(activeSession.owner, "reload-test");
  assert.equal(openSaraBattleCommand(`rest-hit-die:${getState().monk.functionalRuntime.rest.id}`).ok, true);
  assert.match(dialog.footer.innerHTML, /data-workspace-action="apply-command"[^>]*disabled/);
  updateState((draft) => {
    draft.combat.hp.current -= 1;
    draft.combat.hitDice.remaining = 0;
    return draft;
  });
  assert.match(dialog.footer.innerHTML, /data-workspace-action="apply-command"[^>]*disabled/);
  assert.match(dialog.footer.innerHTML, /data-workspace-action="finish-short-rest"/);
  activeSession = getWorkspaceSessionForTests();
  disposeWorkspaceOwner(activeSession.owner, "reload-test");
  assert.equal(openSaraBattleCommand(`rest-hit-die:${getState().monk.functionalRuntime.rest.id}`).ok, true);
  assert.match(dialog.footer.innerHTML, /data-workspace-action="apply-command"[^>]*disabled/);
  fireWorkspaceAction(dialog, "finish-short-rest");
  assert.equal(getState().monk.functionalRuntime.rest.phase, "finished");
  assert.equal(getWorkspaceSessionForTests().currentStep, "command-result");
  const finishedOperationCount = Object.keys(getState().monk.functionalRuntime.operations).length;
  fireWorkspaceAction(dialog, "finish-short-rest");
  assert.equal(Object.keys(getState().monk.functionalRuntime.operations).length, finishedOperationCount);
  unsubscribe();
});

test("completed long rest routes through colon command IDs, cancellation, decline, and a passive replacement", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(openSaraBattleCommand("completed-rest").ok, true);
  dialog.forms.command = new FixtureForm("command", { kind: "long" }, {
    kind: { required: true },
  });
  fireWorkspaceAction(dialog, "apply-command");
  let session = getWorkspaceSessionForTests();
  assert.match(session.scenarioId, /^rest-replacement:offer:.+$/);
  const restId = session.command.restId;
  assert.equal(session.command.restStage, "offer");

  fireWorkspaceAction(dialog, "edit-rest-replacement");
  session = getWorkspaceSessionForTests();
  const normalAddition = MONK_TECHNIQUES.find((entry) =>
    entry.category !== "passive" &&
    !getState().monk.ordinaryTechniqueIds.includes(entry.id) &&
    !Object.values(getState().monk.signatureTechniqueSlots).includes(entry.id));
  assert.ok(normalAddition);
  session.rawInputsByStep[session.currentStepKey].add = normalAddition.id;
  const ordinaryMarkup = renderCommandWorkspace(session, getState()).body;
  assert.doesNotMatch(ordinaryMarkup, /name="(?:styleId|cantrip1|cantrip2)"/);
  const ordinaryForm = new FixtureForm("command", {
    remove: getState().monk.ordinaryTechniqueIds[0],
    add: normalAddition.id,
  }, { remove: { required: true }, add: { required: true } });
  assert.equal(ordinaryForm.checkValidity(), true);
  assert.equal(ordinaryForm.elements.some((field) =>
    ["styleId", "cantrip1", "cantrip2"].includes(field.name)), false);
  session.rawInputsByStep[session.currentStepKey].add = "";
  const cantrips = CLERIC_CANTRIPS.slice(0, 2).map((entry) => entry.id);
  dialog.forms.command = new FixtureForm("command", {
    add: "ll-monk:divine-light",
    cantrip1: cantrips[0],
    cantrip2: cantrips[0],
  });
  fireWorkspaceInput(dialog, "add", "ll-monk:divine-light", "select-one");
  assert.match(dialog.restReplacementSubchoices.innerHTML, /name="cantrip1"/);
  assert.match(dialog.restReplacementSubchoices.innerHTML, /name="cantrip2"/);
  session.rawInputsByStep[session.currentStepKey].cantrip2 = cantrips[0];
  fireWorkspaceInput(dialog, "cantrip1", cantrips[0], "select-one");
  session.rawInputsByStep[session.currentStepKey].cantrip1 = cantrips[0];
  updateRestReplacementSubchoices(session, getState());
  assert.equal(session.rawInputsByStep[session.currentStepKey].cantrip2, "");
  assert.equal(getWorkspaceSessionForTests().scenarioId, `rest-replacement:edit:${restId}`);
  fireWorkspaceAction(dialog, "cancel-rest-replacement");
  assert.equal(getWorkspaceSessionForTests().scenarioId, `rest-replacement:offer:${restId}`);
  fireWorkspaceAction(dialog, "decline-rest-replacement");
  assert.equal(getState().monk.functionalRuntime.rest.phase, "finished");
  const declinedOperationCount = Object.keys(getState().monk.functionalRuntime.operations).length;
  fireWorkspaceAction(dialog, "decline-rest-replacement");
  assert.equal(Object.keys(getState().monk.functionalRuntime.operations).length, declinedOperationCount);

  assert.equal(openSaraBattleCommand("completed-rest").ok, true);
  dialog.forms.command = new FixtureForm("command", { kind: "long" }, {
    kind: { required: true },
  });
  fireWorkspaceAction(dialog, "apply-command");
  fireWorkspaceAction(dialog, "edit-rest-replacement");
  session = getWorkspaceSessionForTests();
  const remove = getState().monk.ordinaryTechniqueIds[0];
  assert.equal(cantrips.length, 2);
  const markup = dialog.body.innerHTML;
  assert.match(markup, /data-rest-replacement-subchoices/);
  dialog.forms.command = new FixtureForm("command", {
    remove,
    add: "ll-monk:divine-light",
    cantrip1: cantrips[0],
    cantrip2: cantrips[1],
  }, {
    remove: { required: true },
    add: { required: true },
    cantrip1: { required: true },
    cantrip2: { required: true },
  });
  assert.equal(dialog.forms.command.checkValidity(), true);
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().monk.functionalRuntime.rest.phase, "finished");
  assert.ok(getState().monk.ordinaryTechniqueIds.includes("ll-monk:divine-light"));
  assert.deepEqual(getState().monk.techniqueChoices["ll-monk:divine-light"].clericCantripIds, cantrips);
  unsubscribe();
});
