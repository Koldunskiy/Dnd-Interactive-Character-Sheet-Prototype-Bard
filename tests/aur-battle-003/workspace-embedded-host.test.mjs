import test from "node:test";
import assert from "node:assert/strict";
import { getState } from "../../scripts/state.js";
import { openNormalAttack, getWorkspaceSessionForTests } from "../../scripts/workspace/controller.js";
import {
  getWorkspaceHost,
  renderWorkspaceHost,
  workspaceHostIsEmbedded,
} from "../../scripts/workspace/host.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import {
  fireWorkspaceInput,
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
