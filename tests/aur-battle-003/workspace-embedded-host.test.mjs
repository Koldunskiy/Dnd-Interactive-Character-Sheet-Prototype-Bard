import test from "node:test";
import assert from "node:assert/strict";
import { getState, updateState } from "../../scripts/state.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  disposeWorkspaceOwner,
  openNormalAttack,
  openSaraBattleCommand,
  getWorkspaceSessionForTests,
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
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("Sara combat tasks use the embedded host without dialog or body-lock behavior", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const bodyStyles = { ...globalThis.document.body.style };

  const opened = openNormalAttack();
  assert.equal(opened.ok, true);
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
  fireWorkspaceAction(dialog, "attack-hit");
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === getWorkspaceSessionForTests().sequenceId);
  const attack = sequence.resolvedAttacks[0];
  assert.equal(attack.profileId, "darts");
  assert.equal(attack.profileSnapshot.attackKind, "weapon");
  assert.equal(attack.ammunitionSpend.itemId, "darts");
  assert.equal(attack.hitResult, "hit");
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 19);
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
