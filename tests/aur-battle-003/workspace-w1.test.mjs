import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState, updateState } from "../../scripts/state.js";
import {
  recordAttackDamage,
  recordAttackOutcome,
} from "../../scripts/actions/sara-combat.js";
import {
  getWorkspaceSessions,
  getWorkspaceSessionForTests,
  minimizeWorkspace,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import {
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";
import { renderWorkspaceHost } from "../../scripts/workspace/host.js";
import { getUnfinishedPlayerWork } from "../../scripts/battle/player-hub.js";

test("W1 historical damage rejects a hit without its recorded profile snapshot", () => {
  const { unsubscribe } = installWorkspaceFixture();
  const sequenceId = "w1-legacy-sequence";
  const attackId = "w1-legacy-hit";
  const recorded = recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
    kind: "attack-action",
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "12",
    dmHitResult: "hit",
  }, "w1-record-legacy-hit");
  assert.equal(recorded.status, "applied");
  updateState((state) => {
    delete state.monk.combatAssistant.activeSequences[0].resolvedAttacks[0].profileSnapshot;
    return state;
  });

  const result = recordAttackDamage(
    getSessionContext(), sequenceId, attackId, ["4"], "w1-no-historical-fallback",
  );
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /снимок профиля атаки/);
  assert.equal(
    getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].damageStatus,
    "awaiting-damage",
  );
  unsubscribe();
});

test("W1 rendering an error does not release active compact-entry presentation", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(openNormalAttack().ok, true);
  const field = { name: "firstD20", matches: () => true };
  dialog.contains = (node) => node === field;
  globalThis.document.activeElement = field;
  globalThis.document.documentElement = {
    attributes: new Set(["data-combat-entry-active"]),
    removeAttribute(name) { this.attributes.delete(name); },
    setAttribute(name) { this.attributes.add(name); },
  };
  dialog.dataset.entryActive = "true";
  dialog.style.setProperty("--workspace-entry-height", "400px");
  renderWorkspaceHost({
    header: "",
    body: "<form data-workspace-form=\"attack\"></form>",
    footer: "",
    error: "Проверьте ввод.",
  });
  assert.equal(globalThis.document.documentElement.attributes.has("data-combat-entry-active"), true);
  assert.equal(dialog.dataset.entryActive, "true");
  assert.equal(dialog.style.getPropertyValue("--workspace-entry-height"), "400px");
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  unsubscribe();
});

test("W1 a live damage workspace and its persisted hit project as one task", () => {
  const { unsubscribe } = installWorkspaceFixture();
  const sequenceId = "w1-dedup-sequence";
  const attackId = "w1-dedup-hit";
  const recorded = recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
    kind: "attack-action",
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "12",
    dmHitResult: "hit",
  }, "w1-record-dedup-hit");
  assert.equal(recorded.status, "applied");
  assert.equal(openNormalAttack({ sequenceId, attackId }).ok, true);
  minimizeWorkspace();

  const work = getUnfinishedPlayerWork(getState(), getWorkspaceSessions());
  assert.equal(work.filter((entry) => entry.kind === "historical-damage").length, 0);
  assert.equal(work.filter((entry) => entry.workspaceSessionId).length, 1);
  unsubscribe();
});
