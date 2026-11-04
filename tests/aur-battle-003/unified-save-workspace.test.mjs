import test from "node:test";
import assert from "node:assert/strict";
import { getState } from "../../scripts/state.js";
import { createSavingThrowDraft, projectSavingThrow, buildCompletedSaveRequest } from "../../scripts/rolls/saving-throw-flow.js";
import { installWorkspaceFixture } from "./workspace-fixture.mjs";

test("unified save draft resolves known DC, preserves unresolved DC, and records manual evidence", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const state = getState();
  const draft = createSavingThrowDraft({ ability: "wisdom" });
  draft.firstD20 = "12";
  draft.dc = "10";
  let projection = projectSavingThrow(state, draft);
  assert.equal(projection.ok, true, projection.reason);
  assert.equal(projection.finalOutcome, "success");
  assert.equal(projection.finalOutcomeSource, "dc");
  draft.dc = "";
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.needsOutcome, true);
  assert.equal(projection.finalOutcome, null);
  draft.baseOutcomeMode = "manual";
  draft.baseManualOutcome = "failure";
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.finalOutcome, "failure");
  assert.equal(projection.finalOutcomeSource, "manual");
  const request = buildCompletedSaveRequest({ eventId: "test" }, projection, draft);
  assert.equal(request.baseOutcomeSource, "manual");
  assert.equal(request.baseManualOutcome, "failure");
  unsubscribe();
});

test("spell save draft defaults to the supported advantage mode", () => {
  assert.equal(createSavingThrowDraft({ source: "spell" }).rollMode, "advantage");
});
