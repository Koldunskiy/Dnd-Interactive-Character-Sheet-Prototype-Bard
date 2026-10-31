import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import { recordAttackOutcome } from "../../scripts/actions/sara-combat.js";
import {
  getWorkspaceSessionForTests,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import { fireWorkspaceInput, installWorkspaceFixture } from "./workspace-fixture.mjs";

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
  const first = openNormalAttack({
    sequenceId, attackId: "w02-hit-one", mode: "historical-damage",
  });
  assert.equal(first.ok, true);
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
  unsubscribe();
});
