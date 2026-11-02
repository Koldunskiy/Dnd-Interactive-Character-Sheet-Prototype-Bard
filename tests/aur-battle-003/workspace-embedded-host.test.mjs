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
