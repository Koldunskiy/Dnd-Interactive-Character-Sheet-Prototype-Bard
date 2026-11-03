import test from "node:test";
import assert from "node:assert/strict";
import { getState, updateState } from "../../scripts/state.js";
import {
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
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().combat.hitDice.remaining, 2);
  assert.equal(getState().monk.functionalRuntime.rest.hitDiceSpent, 1);
  dialog.forms.command = new FixtureForm("command", { roll: "3" });
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().combat.hitDice.remaining, 1);
  assert.equal(getState().monk.functionalRuntime.rest.hitDiceSpent, 2);
  fireWorkspaceAction(dialog, "finish-short-rest");
  assert.equal(getState().monk.functionalRuntime.rest.phase, "finished");
  assert.equal(getWorkspaceSessionForTests().currentStep, "command-result");
  unsubscribe();
});
