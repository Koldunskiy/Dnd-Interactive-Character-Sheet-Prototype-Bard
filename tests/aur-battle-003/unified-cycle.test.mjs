import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { renderCommandWorkspace } from "../../scripts/render/render-command-workspace.js";
import { getSaraBattleCommandRegistry } from "../../scripts/battle/command-registry.js";
import {
  getEndTurnAdvice,
  getPlayerScenePhase,
  getOwnTurnContinuationTasks,
} from "../../scripts/battle/player-hub.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";
import {
  getMinimizedWorkspaceSessions,
  getWorkspaceSessionForTests,
  openNormalAttack,
  openSaraBattleCommand,
} from "../../scripts/workspace/controller.js";
import { getSessionContext, getState, updateSessionState } from "../../scripts/state.js";
import { beginOwnTurn, startBattle } from "../../scripts/battle/transitions.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";

test("outside Battle hub presents the unified phase and frequent player checks", () => {
  const markup = renderBattleConsole(structuredClone(sara));
  assert.match(markup, /data-player-scene-phase="outside"/);
  assert.match(markup, /Вне боя/);
  assert.match(markup, /Убеждение/);
  assert.match(markup, /Атлетика/);
  assert.match(markup, /Восприятие/);
});

test("declining a caught projectile is distinct from opening its paid return", () => {
  const session = {
    scenarioId: "deflect-missile",
    currentStep: "command-result",
    currentStepKey: "command-result:deflect-missile",
    command: { titleRu: "Отражение снарядов", availability: { enabled: true } },
    canReturnMissile: true,
    resultMessage: "Снаряд пойман.",
  };
  const view = renderCommandWorkspace(session, structuredClone(sara));
  assert.match(view.footer, /data-workspace-action="return-missile"/);
  assert.match(view.footer, /data-workspace-action="decline-return-missile"/);
  assert.doesNotMatch(view.footer, /data-workspace-action="done"/);
});

test("phase selectors keep ended scenes outside and advise only on supported follow-ups", () => {
  const character = structuredClone(sara);
  character.battleConsole ??= { current: null, history: [] };
  character.monk.combatAssistant ??= { activeSequences: [], pendingApplications: [] };
  character.battleConsole.current = { id: "ended", phase: "ended" };
  character.ui.turn.actionUsed = true;
  assert.equal(getPlayerScenePhase(character), "outside");
  const racialSpell = getSaraBattleCommandRegistry(character)
    .find((entry) => entry.id === "racial-spell:poison-spray-2014");
  assert.equal(racialSpell.availability.enabled, true);

  character.battleConsole.current = {
    id: "battle",
    phase: "own-turn",
    ownTurnId: "turn",
  };
  character.monk.combatAssistant.activeSequences = [{
    id: "open-attack",
    kind: "attack-action",
    status: "open",
    maximumAttacks: 2,
    resolvedAttacks: [{}],
    turnMarker: character.ui.turn.turnNumber,
    battleId: "battle",
    ownTurnId: "turn",
  }];
  const continuations = getOwnTurnContinuationTasks(character);
  assert.equal(continuations.length, 1);
  assert.equal(continuations[0].remaining, 1);
  const advice = getEndTurnAdvice(character);
  assert.ok(advice.some((item) => item.sequenceId === "open-attack"));
  assert.ok(advice.some((item) => item.menu === "bonus"));
  assert.ok(advice.every((item) => item.kind !== "reaction"));

  character.battleConsole.current.phase = "waiting";
  assert.equal(getPlayerScenePhase(character), "waiting");
  character.battleConsole.current.phase = "paused";
  assert.equal(getPlayerScenePhase(character), "paused");
  character.battleConsole.current.phase = "ended";
  assert.equal(getPlayerScenePhase(character), "outside");
});

test("a child workflow returns to its parent's preserved dirty attack draft", () => {
  const fixture = installWorkspaceFixture();
  try {
    updateSessionState(getSessionContext(), (draft) => {
      const started = startBattle(draft, { rawD20: "10" }, { id: "unified-test-battle" });
      if (!started.ok) throw new Error(started.reason);
      const turn = beginOwnTurn(draft, { id: "unified-test-turn" });
      if (!turn.ok) throw new Error(turn.reason);
      return draft;
    });
    const parent = openNormalAttack();
    assert.equal(parent.ok, true);
    fixture.dialog.forms.attack = new FixtureForm("attack", {
      firstD20: "",
      rollMode: "normal",
    });
    fireWorkspaceInput(fixture.dialog, "firstD20", "17");
    const child = openSaraBattleCommand("character-roll");
    assert.equal(child.ok, true);
    assert.ok(getMinimizedWorkspaceSessions()
      .some((entry) => entry.workspaceSessionId === parent.sessionId && entry.suspended));

    fireWorkspaceAction(fixture.dialog, "done");
    const restored = getWorkspaceSessionForTests();
    assert.equal(restored.workspaceSessionId, parent.sessionId);
    assert.equal(restored.rawInputsByStep[restored.currentStepKey].firstD20, "17");
    fireWorkspaceAction(fixture.dialog, "close");
    fireWorkspaceAction(fixture.dialog, "confirm-close");
    assert.equal(getState().battleConsole.current.phase, "own-turn");
    assert.equal(getState().ui.turn.actionUsed, false);

    const kiBeforeDeflection = getState().combat.ki.current;
    const deflect = openSaraBattleCommand("deflect-missile");
    assert.equal(deflect.ok, true);
    fixture.dialog.forms.command = new FixtureForm("command", {
      triggerConfirmed: true,
      mode: "weapon",
      incomingDamage: "12",
      deflectRoll: "10",
      finalAdjustedDamage: "",
      applyDamageToSara: "false",
      freeHand: true,
      physicalProjectile: true,
      caught: true,
    });
    fireWorkspaceAction(fixture.dialog, "apply-command");
    assert.match(fixture.dialog.footer.innerHTML,
      /data-workspace-action="decline-return-missile"/);
    fireWorkspaceAction(fixture.dialog, "decline-return-missile");
    assert.equal(getState().monk.techniqueRuntime.deflectContinuation, undefined,
      getWorkspaceSessionForTests()?.error);
    assert.equal(getState().combat.ki.current, kiBeforeDeflection);
    assert.equal(getState().ui.turn.reactionUsed, true);
    assert.equal(fixture.dialog.open, false);

    const hpBeforeDamage = getState().combat.hp.current;
    const tempBeforeDamage = getState().combat.hp.temp;
    const incoming = openSaraBattleCommand("incoming-damage");
    assert.equal(incoming.ok, true);
    fixture.dialog.forms.command = new FixtureForm("command", {
      damage: "5",
      confirmed: true,
    });
    fireWorkspaceAction(fixture.dialog, "apply-command");
    assert.equal(getState().combat.hp.current,
      Math.max(0, hpBeforeDamage - Math.max(0, 5 - tempBeforeDamage)));
    assert.equal(getState().ui.turn.reactionUsed, true);
    fireWorkspaceAction(fixture.dialog, "done");

    assert.equal(executeBattleCommand("end-battle").status, "applied");
    const hpBeforeRegeneration = getState().combat.hp.current;
    const kiBeforeRegeneration = getState().combat.ki.current;
    const actionFlagBeforeRegeneration = getState().ui.turn.actionUsed;
    const regeneration = openSaraBattleCommand("mystic-regeneration");
    assert.equal(regeneration.ok, true);
    fixture.dialog.forms.command = new FixtureForm("command", {
      dieResult: "2",
      confirmNoHealing: false,
    });
    fireWorkspaceAction(fixture.dialog, "apply-command");
    assert.ok(getState().combat.hp.current >= hpBeforeRegeneration);
    assert.equal(getState().combat.ki.current, kiBeforeRegeneration - 2);
    assert.equal(getState().ui.turn.actionUsed, actionFlagBeforeRegeneration);
    assert.equal(getState().battleConsole.current, null);
    fireWorkspaceAction(fixture.dialog, "done");
  } finally {
    fixture.unsubscribe();
  }
});
