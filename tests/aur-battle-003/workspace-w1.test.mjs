import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState, updateState } from "../../scripts/state.js";
import {
  closeAttackSequence,
  markAttackDamageOutside,
  recordAttackDamage,
  recordAttackOutcome,
} from "../../scripts/actions/sara-combat.js";
import {
  getWorkspaceSessions,
  getWorkspaceSessionForTests,
  minimizeWorkspace,
  openNormalAttack,
  discardWorkspaceDraft,
} from "../../scripts/workspace/controller.js";
import {
  installWorkspaceFixture,
  FixtureForm,
  fireWorkspaceAction,
} from "./workspace-fixture.mjs";
import { closeWorkspaceHost, renderWorkspaceHost } from "../../scripts/workspace/host.js";
import { getUnfinishedPlayerWork } from "../../scripts/battle/player-hub.js";
import { renderMeleePanel } from "../../scripts/render/render-melee.js";
import {
  bindBattleConsole,
  renderBattleConsole,
  updateBattleConsole,
} from "../../scripts/render/render-battle-console.js";
import { FixtureInput, FixtureNode } from "./workspace-fixture.mjs";
import { sara } from "../../data/sara.js";

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
  const outside = markAttackDamageOutside(
    getSessionContext(), sequenceId, attackId, "w1-legacy-outside",
  );
  assert.equal(outside.status, "applied");
  assert.equal(recordAttackDamage(
    getSessionContext(), sequenceId, attackId, ["4"], "w1-legacy-later-numeric",
  ).status, "rejected");
  unsubscribe();
});

test("W1 historical numeric damage uses the recorded profile after current stats change", () => {
  const { unsubscribe } = installWorkspaceFixture();
  const sequenceId = "w1-snapshot-sequence";
  const attackId = "w1-snapshot-hit";
  assert.equal(recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
    kind: "attack-action",
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "12",
    dmHitResult: "hit",
  }, "w1-record-snapshot-hit").status, "applied");
  const savedProfile = structuredClone(
    getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].profileSnapshot,
  );
  updateState((state) => {
    state.abilities.dexterity = 10;
    return state;
  });
  const result = recordAttackDamage(
    getSessionContext(), sequenceId, attackId, ["4"], "w1-record-snapshot-damage",
  );
  assert.equal(result.status, "applied");
  const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  assert.equal(attack.damageModifierSnapshot, savedProfile.damageModifier);
  assert.equal(
    attack.damageTotalBeforeTargetModifiers,
    4 + savedProfile.damageModifier,
  );
  assert.equal(markAttackDamageOutside(
    getSessionContext(), sequenceId, attackId, "w1-snapshot-late-outside",
  ).status, "rejected");
  assert.equal(getUnfinishedPlayerWork(getState(), [])
    .filter((entry) => entry.kind === "historical-damage").length, 0);
  unsubscribe();
});

test("W1 a closed sequence retains its unresolved damage obligation", () => {
  const { unsubscribe } = installWorkspaceFixture();
  const sequenceId = "w1-closed-pending-sequence";
  assert.equal(recordAttackOutcome(getSessionContext(), sequenceId, "w1-closed-hit", {
    kind: "attack-action",
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "12",
    dmHitResult: "hit",
  }, "w1-record-closed-pending").status, "applied");
  assert.equal(closeAttackSequence(
    getSessionContext(), sequenceId, "w1-close-pending-sequence",
  ).status, "applied");
  assert.equal(getUnfinishedPlayerWork(getState(), [])
    .filter((entry) => entry.kind === "historical-damage").length, 1);
  unsubscribe();
});

test("W1 next attack receives a fresh identity and empty dice input", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  assert.equal(openNormalAttack().ok, true);
  const firstAttackId = getWorkspaceSessionForTests().attackId;
  dialog.forms.attack = new FixtureForm("attack", {
    rollMode: "normal",
    firstD20: "8",
    secondD20: "20",
  });
  fireWorkspaceAction(dialog, "attack-miss");
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  fireWorkspaceAction(dialog, "next-attack");
  const next = getWorkspaceSessionForTests();
  assert.notEqual(next.attackId, firstAttackId);
  assert.deepEqual(next.rawInputsByStep[next.currentStepKey], {});
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
  closeWorkspaceHost({ restoreFocus: false });
  assert.equal(globalThis.document.documentElement.attributes.has("data-combat-entry-active"), false);
  assert.equal(dialog.dataset.entryActive, undefined);
  unsubscribe();
});

test("W1 real Sara renderer updates preserve the connected focused workspace input", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const panel = new FixtureNode();
  panel.documentRoot = true;
  const shell = new FixtureNode();
  const regions = new Map([
    ["[data-sara-hud]", new FixtureNode()],
    ["[data-sara-hud-heading]", new FixtureNode()],
    ["[data-sara-home-hud]", new FixtureNode()],
    ["[data-sara-budget]", new FixtureNode()],
    ["[data-sara-navigation]", new FixtureNode()],
    ["[data-sara-phase-content]", new FixtureNode()],
    ["[data-sara-pending-work]", new FixtureNode()],
    ["[data-sara-turn-controls]", new FixtureNode()],
  ]);
  const taskRegion = new FixtureNode();
  const idle = new FixtureNode();
  idle.appendChild(regions.get("[data-sara-phase-content]"));
  taskRegion.appendChild(idle);
  taskRegion.appendChild(dialog);
  shell.appendChild(regions.get("[data-sara-hud]"));
  shell.appendChild(regions.get("[data-sara-budget]"));
  shell.appendChild(taskRegion);
  shell.appendChild(regions.get("[data-sara-pending-work]"));
  shell.appendChild(regions.get("[data-sara-turn-controls]"));
  shell.querySelector = (selector) => selector === "[data-sara-task-region]" ||
    selector === "[data-combat-task-region]" ? taskRegion
    : selector === "[data-sara-idle-content]" ? idle
      : selector === "[data-combat-workspace-root]" ? dialog
        : regions.get(selector) ?? null;
  panel.appendChild(shell);
  panel.querySelector = (selector) => selector === ".sara-combat-shell" ? shell : null;

  const getElementById = globalThis.document.getElementById.bind(globalThis.document);
  globalThis.document.getElementById = (id) =>
    id === "meleePanel" ? panel : getElementById(id);
  assert.equal(openNormalAttack().ok, true);

  const input = new FixtureInput("firstD20", "16");
  dialog.body.appendChild(input);
  const form = new FixtureNode();
  form.dataset.workspaceForm = "attack";
  form.contains = (node) => node === input;
  dialog.body.querySelector = (selector) =>
    selector === "[data-workspace-form]" ? form : null;
  input.focus();
  assert.equal(form.contains(globalThis.document.activeElement), true);
  assert.match(dialog.body.innerHTML, /data-workspace-form="attack"/);

  const workspaceBefore = dialog;
  const stateBefore = getState();
  updateState((state) => {
    state.ui.melee ??= {};
    state.ui.melee.w1RenderPulse = !state.ui.melee.w1RenderPulse;
    return state;
  });
  renderMeleePanel(getState(), {});

  assert.equal(panel.querySelector(".sara-combat-shell"), shell);
  assert.equal(shell.querySelector("[data-combat-workspace-root]"), workspaceBefore);
  assert.equal(workspaceBefore.contains(input), true);
  assert.equal(input.isConnected, true);
  assert.equal(globalThis.document.activeElement, input);
  assert.equal(input.value, "16");
  assert.notEqual(getState(), stateBefore);
  const markup = renderBattleConsole(getState());
  assert.match(markup, /class="[^"]*sara-combat-shell[^"]*combat-turn-card/);
  assert.ok(markup.indexOf("data-sara-task-region") <
    markup.indexOf("data-combat-workspace-root"));
  assert.ok(markup.indexOf("data-combat-workspace-root") < markup.lastIndexOf("</section>"));

  bindBattleConsole(panel);
  bindBattleConsole(panel);
  assert.equal(panel.listeners.get("click").length, 1);
  const menuButton = new FixtureNode();
  menuButton.dataset.battleMenu = "action";
  menuButton.closest = (selector) =>
    selector === "[data-battle-menu]" ? menuButton : null;
  panel.appendChild(menuButton);
  panel.fire("click", { target: menuButton });
  assert.equal(panel.listeners.get("click").length, 1);
  assert.equal(shell.querySelector("[data-combat-workspace-root]"), workspaceBefore);
  unsubscribe();
});

test("W1 phase changes replace focused combat controls immediately and discard queued old markup", async () => {
  const { unsubscribe } = installWorkspaceFixture();
  updateState((state) => {
    state.battleConsole ??= { current: null, history: [] };
    state.battleConsole.current = {
      id: "w1-deferred-update",
      phase: "own-turn",
      ownTurnNumber: 1,
      ownTurnId: "w1-deferred-turn",
    };
    state.ui.turn ??= {};
    state.ui.turn.actionUsed = false;
    return state;
  });
  const panel = new FixtureNode();
  panel.documentRoot = true;
  const shell = new FixtureNode();
  const phase = new FixtureNode();
  const regions = new Map([
    ["[data-sara-hud]", new FixtureNode()],
    ["[data-sara-hud-heading]", new FixtureNode()],
    ["[data-sara-home-hud]", new FixtureNode()],
    ["[data-sara-budget]", new FixtureNode()],
    ["[data-sara-navigation]", new FixtureNode()],
    ["[data-sara-phase-content]", phase],
    ["[data-sara-pending-work]", new FixtureNode()],
    ["[data-sara-turn-controls]", new FixtureNode()],
  ]);
  const taskRegion = new FixtureNode();
  const idle = new FixtureNode();
  idle.appendChild(phase);
  taskRegion.appendChild(idle);
  shell.appendChild(regions.get("[data-sara-hud]"));
  shell.appendChild(regions.get("[data-sara-budget]"));
  shell.appendChild(regions.get("[data-sara-navigation]"));
  shell.appendChild(taskRegion);
  shell.appendChild(regions.get("[data-sara-pending-work]"));
  shell.appendChild(regions.get("[data-sara-turn-controls]"));
  shell.querySelector = (selector) => selector === "[data-sara-task-region]" ||
    selector === "[data-combat-task-region]" ? taskRegion
    : selector === "[data-sara-idle-content]" ? idle
      : regions.get(selector) ?? null;
  panel.appendChild(shell);
  panel.querySelector = (selector) => selector === ".sara-combat-shell" ? shell : null;
  bindBattleConsole(panel);
  updateBattleConsole(panel, getState());
  const focusedButton = new FixtureNode();
  phase.appendChild(focusedButton);
  globalThis.document.activeElement = focusedButton;
  const before = phase.innerHTML;
  updateState((state) => {
    state.battleConsole.current.phase = "waiting";
    return state;
  });
  updateBattleConsole(panel, getState());
  const waitingMarkup = phase.innerHTML;
  assert.notEqual(waitingMarkup, before);
  assert.match(waitingMarkup, /По мне атакуют/);
  assert.equal(phase.contains(focusedButton), false);
  updateState((state) => {
    state.battleConsole.current.phase = "paused";
    return state;
  });
  updateBattleConsole(panel, getState());
  const pausedMarkup = phase.innerHTML;
  assert.notEqual(pausedMarkup, waitingMarkup);
  assert.match(pausedMarkup, /контекст приостановленной сцены повреждён/i);

  globalThis.document.activeElement = null;
  panel.fire("focusout", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(phase.innerHTML, pausedMarkup);
  assert.doesNotMatch(phase.innerHTML, /По мне атакуют/);
  unsubscribe();
});

test("W1 pending-task grouping follows consequence status, not Russian label wording", () => {
  const state = structuredClone(sara);
  state.characterRolls ??= { records: [] };
  state.characterRolls.records = [
    { id: "w1-awaiting-answer", label: "Переименованный результат", consequence: { status: "awaiting-outcome" } },
    { id: "w1-required", label: "Указать исход — изменённая подпись", consequence: { status: "awaiting-damage-input" } },
  ];
  const work = getUnfinishedPlayerWork(state, []);
  assert.equal(work.find((entry) => entry.id === "roll:w1-awaiting-answer").group, "awaiting-answer");
  assert.equal(work.find((entry) => entry.id === "roll:w1-required").group, "required");
});

test("W1 discarding an unrecorded draft removes only workspace input", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  assert.equal(openNormalAttack().ok, true);
  const session = getWorkspaceSessionForTests();
  const workspaceId = session.workspaceSessionId;
  const field = {
    name: "firstD20",
    type: "number",
    value: "17",
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  field.parentElement = dialog;
  dialog.fire("input", { target: field });
  assert.equal(getWorkspaceSessionForTests().dirty, true);
  minimizeWorkspace();

  assert.deepEqual(discardWorkspaceDraft(workspaceId), { ok: true });
  assert.equal(getWorkspaceSessions().some((entry) => entry.workspaceSessionId === workspaceId), false);
  assert.equal(getState().ui.turn.actionUsed, false);
  assert.equal(getState().monk.combatAssistant?.activeSequences?.length ?? 0, 0);
  assert.equal(dialog.open, false);
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

  const state = getState();
  const matching = [{
    workspaceSessionId: "matching-active",
    sequenceId,
    attackId,
    stage: "damage-input",
    dirty: true,
  }];
  assert.equal(getUnfinishedPlayerWork(state, matching)
    .filter((entry) => entry.kind === "historical-damage").length, 0);
  assert.equal(getUnfinishedPlayerWork(state, [{
    ...matching[0], minimized: true,
  }]).filter((entry) => entry.kind === "historical-damage").length, 0);
  assert.equal(getUnfinishedPlayerWork(state, [{
    ...matching[0], suspended: true,
  }]).filter((entry) => entry.kind === "historical-damage").length, 0);
  assert.equal(getUnfinishedPlayerWork(state, [])
    .filter((entry) => entry.kind === "historical-damage").length, 1);
  assert.equal(getUnfinishedPlayerWork(state, [{
    ...matching[0], attackId: "different-hit",
  }]).filter((entry) => entry.kind === "historical-damage").length, 1);
  unsubscribe();
});
