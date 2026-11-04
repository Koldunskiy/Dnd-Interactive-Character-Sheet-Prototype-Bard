import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import {
  applyTechniqueToHit,
  recordAttackOutcome,
} from "../../scripts/actions/sara-combat.js";
import {
  getWorkspaceSessionForTests,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("W-02 validates explicit targets and protects a dirty draft when switching hits", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const sequenceId = "w02-sequence";
  for (const attackId of ["w02-hit-one", "w02-hit-two"]) {
    const result = recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
      kind: "attack-action",
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "12",
      dmHitResult: "hit",
    }, `w02-${attackId}`);
    assert.equal(result.status, "applied");
  }
  const kiBeforeTechnique = getState().combat.ki.current;
  const technique = applyTechniqueToHit(
    getSessionContext(), sequenceId, "w02-hit-one", "ll-monk:empowered-strike",
    { confirmed: true, paymentMode: "ki" }, "w02-history-technique",
  );
  assert.equal(technique.status, "applied");
  assert.equal(getState().combat.ki.current, kiBeforeTechnique - 1);
  const first = openNormalAttack({
    sequenceId, attackId: "w02-hit-one", mode: "historical-damage",
  });
  assert.equal(first.ok, true);
  assert.match(dialog.body.innerHTML, /К этому удару уже применена техника/);
  const targetSession = getWorkspaceSessionForTests();

  const missingSequence = openNormalAttack({ sequenceId: "missing-sequence" });
  assert.equal(missingSequence.ok, false);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, targetSession.workspaceSessionId);
  const missingAttack = openNormalAttack({
    sequenceId, attackId: "missing-attack", mode: "historical-damage",
  });
  assert.equal(missingAttack.ok, false);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, targetSession.workspaceSessionId);

  const exact = openNormalAttack({
    sequenceId, attackId: "w02-hit-one", mode: "historical-damage",
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.sessionId, first.sessionId);
  fireWorkspaceInput(dialog, "damage1", "5");

  const otherValidHit = openNormalAttack({
    sequenceId, attackId: "w02-hit-two", mode: "historical-damage",
  });
  assert.equal(otherValidHit.ok, false);
  assert.match(otherValidHit.reason, /незаписанный ввод/);
  assert.equal(getWorkspaceSessionForTests().attackId, "w02-hit-one");
  dialog.forms.damage = new FixtureForm("damage", { damage1: "5" });
  fireWorkspaceInput(dialog, "damage1", "5");
  fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0].damageStatus, "recorded");
  unsubscribe();
});
