import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import {
  disposeWorkspaceOwner,
  getWorkspaceSessionForTests,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

function cleanup(unsubscribe) {
  unsubscribe();
  disposeWorkspaceOwner(getSessionContext(), "test-cleanup");
}

test("player-first attacks, natural exceptions, damage, and optional techniques use the production controller", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  openNormalAttack();
  try {
    assert.doesNotMatch(dialog.body.innerHTML, /name="(?:targetLabel|targetArmorClass|dmHitResult)"/);
    assert.match(dialog.body.innerHTML, /data-attack-total/);
    assert.match(dialog.footer.innerHTML, /data-workspace-action="attack-hit"/);
    assert.match(dialog.footer.innerHTML, /data-workspace-action="attack-miss"/);
    assert.doesNotMatch(dialog.footer.innerHTML, /submit-attack|Записать физический бросок/);
    assert.equal(dialog.attackTotal.textContent, "—");

    const revision = getSessionContext().stateRevision;
    const originalMarkup = dialog.body.innerHTML;
    fireWorkspaceInput(dialog, "firstD20", "14");
    assert.equal(dialog.attackTotal.textContent, "24");
    assert.match(dialog.attackFormula.textContent, /14 \+ 10 = 24/);
    assert.equal(dialog.body.innerHTML, originalMarkup);
    assert.equal(getSessionContext().stateRevision, revision);

    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "advantage", firstD20: "14", secondD20: "",
      confirmSeparateAction: false,
    });
    fireWorkspaceAction(dialog, "attack-hit");
    assert.equal(dialog.attackTotal.textContent, "—");
    assert.match(dialog.attackValidation.textContent, /Второй к20/);
    assert.equal((getState().monk?.combatAssistant?.activeSequences ?? []).length, 0);

    fireWorkspaceAction(dialog, "attack-mode-normal");
    fireWorkspaceInput(dialog, "firstD20", "14");
    fireWorkspaceInput(dialog, "firstD20", "7");
    fireWorkspaceAction(dialog, "attack-mode-advantage");
    fireWorkspaceInput(dialog, "secondD20", "16");
    assert.equal(dialog.attackTotal.textContent, "26");
    assert.match(dialog.attackStatus.textContent, /выбран 16/);
    fireWorkspaceAction(dialog, "attack-mode-disadvantage");
    assert.equal(dialog.attackTotal.textContent, "17");
    assert.match(dialog.attackStatus.textContent, /выбран 7/);
    fireWorkspaceAction(dialog, "attack-mode-normal");
    assert.equal(dialog.attackTotal.textContent, "17");
    fireWorkspaceInput(dialog, "firstD20", "14");
    assert.equal(dialog.attackTotal.textContent, "24");
    assert.equal(getSessionContext().stateRevision, revision);

    const attackId = getWorkspaceSessionForTests().attackId;
    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "normal",
      firstD20: "14",
      secondD20: "16",
      targetLabel: "Старая цель",
      targetArmorClass: "99",
      dmHitResult: "miss",
      confirmSeparateAction: false,
    });
    let enterPrevented = false;
    dialog.fire("submit", {
      target: dialog.forms.attack,
      preventDefault() { enterPrevented = true; },
    });
    assert.equal(enterPrevented, true);
    assert.equal((getState().monk?.combatAssistant?.activeSequences ?? []).length, 0);
    assert.match(dialog.body.innerHTML, /Выберите «Попадание» или «Промах»/);
    fireWorkspaceAction(dialog, "attack-hit");
    const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
      entry.id === getWorkspaceSessionForTests().sequenceId);
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].hitResult, "hit");
    assert.equal(sequence.resolvedAttacks[0].hitResolutionSource, "dm");
    assert.equal(sequence.resolvedAttacks[0].optionalTargetLabel, "");
    assert.equal(getState().ui.turn.actionUsed, true);

    const oldAction = {
      dataset: { workspaceAction: "attack-miss", workspaceAttackId: attackId },
      closest(selector) { return selector === "[data-workspace-action]" ? this : null; },
    };
    dialog.fire("click", { target: oldAction });
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].hitResult, "hit");
    assert.doesNotMatch(dialog.body.innerHTML, /name="(?:techniqueId|paymentMode|effect|practicedConditions)"/);
    assert.match(dialog.body.innerHTML, /data-damage-total/);

    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceAction(dialog, "submit-damage");
    const recorded = getState().monk.combatAssistant.activeSequences.find((entry) =>
      entry.id === sequence.id).resolvedAttacks[0];
    assert.equal(recorded.damageStatus, "recorded");
    assert.match(dialog.footer.innerHTML, /Без техники → следующий удар/);
    assert.match(dialog.footer.innerHTML, /Выбрать необязательную технику/);
    const kiBeforeSkip = getState().combat.ki.current;
    const practicedBeforeSkip = getState().combat.practiced.current;
    fireWorkspaceAction(dialog, "no-technique-continue");
    assert.equal(getState().combat.ki.current, kiBeforeSkip);
    assert.equal(getState().combat.practiced.current, practicedBeforeSkip);
    assert.equal(recorded.techniqueApplicationId, null);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");

    const firstSequenceId = sequence.id;
    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "normal", firstD20: "20", confirmSeparateAction: false,
    });
    fireWorkspaceAction(dialog, "attack-miss");
    let activeSequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === firstSequenceId);
    assert.equal(activeSequence.resolvedAttacks.length, 1);
    assert.match(dialog.body.innerHTML, /По обычному правилу это натуральная 20 и попадание/);
    assert.match(dialog.body.innerHTML, /Подтверждаю исключение, назначенное мастером/);
    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "normal", firstD20: "20", dmExceptionConfirmed: true,
      confirmSeparateAction: false,
    });
    fireWorkspaceAction(dialog, "attack-miss");
    activeSequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === firstSequenceId);
    assert.equal(activeSequence.resolvedAttacks[1].hitResult, "miss");
    assert.equal(activeSequence.resolvedAttacks[1].critical, true);
    assert.equal(activeSequence.resolvedAttacks[1].damageStatus, "not-applicable");
    assert.equal(activeSequence.resolvedAttacks[1].hitResolutionSource, "dm");

    disposeWorkspaceOwner(getSessionContext(), "test-complete-sequence");
    openNormalAttack();
    const exceptionSequenceId = getWorkspaceSessionForTests().sequenceId;
    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "normal", firstD20: "1", confirmSeparateAction: true,
    });
    fireWorkspaceAction(dialog, "attack-hit");
    assert.equal(getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === exceptionSequenceId), undefined);
    assert.match(dialog.body.innerHTML, /По обычному правилу это натуральная 1 и промах/);
    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "normal", firstD20: "1", dmExceptionConfirmed: true,
      confirmSeparateAction: true,
    });
    fireWorkspaceAction(dialog, "attack-hit");
    activeSequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === exceptionSequenceId);
    assert.equal(activeSequence.resolvedAttacks[0].hitResult, "hit");
    assert.equal(activeSequence.resolvedAttacks[0].critical, false);
    assert.equal(activeSequence.resolvedAttacks[0].hitResolutionSource, "dm");
    assert.equal(activeSequence.resolvedAttacks[0].damageStatus, "awaiting-damage");

    const exceptionAttackId = getWorkspaceSessionForTests().attackId;
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceAction(dialog, "submit-damage");
    assert.deepEqual(getWorkspaceSessionForTests().strikeParent, {
      sequenceId: exceptionSequenceId,
      attackId: exceptionAttackId,
    });
    fireWorkspaceAction(dialog, "open-strike");
    assert.equal(getWorkspaceSessionForTests().currentStep, "strike-input");
    assert.match(dialog.body.innerHTML, /Мощный удар/);
    assert.match(dialog.body.innerHTML, /Ошеломляющий удар/);
    assert.match(dialog.body.innerHTML, /Калечащий удар/);
    assert.match(dialog.body.innerHTML, /Замедляющий удар/);
    assert.doesNotMatch(dialog.body.innerHTML, /name="damage1"/);
    assert.doesNotMatch(dialog.body.innerHTML, /Эффект «Калечащего удара»/);

    const kiBeforeTechnique = getState().combat.ki.current;
    fireWorkspaceInput(dialog, "techniqueId", "ll-monk:empowered-strike", "text");
    dialog.forms.strike = new FixtureForm("strike", {
      techniqueId: "ll-monk:empowered-strike", paymentMode: "ki",
    });
    assert.match(dialog.footer.innerHTML, /Применить за 1 ци/);
    fireWorkspaceAction(dialog, "apply-strike");
    const appliedAttack = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === exceptionSequenceId).resolvedAttacks
      .find((entry) => entry.id === exceptionAttackId);
    assert.ok(appliedAttack.techniqueApplicationId, dialog.body.innerHTML);
    assert.equal(getState().combat.ki.current, kiBeforeTechnique - 1);
    assert.match(dialog.status.textContent, /Техника применена/);
    fireWorkspaceAction(dialog, "apply-strike");
    assert.equal(getState().combat.ki.current, kiBeforeTechnique - 1);
    assert.match(dialog.body.innerHTML, /результат мастера ожидается/);
    fireWorkspaceAction(dialog, "no-technique-continue");
    assert.equal(getState().combat.ki.current, kiBeforeTechnique - 1);
    assert.equal(getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === exceptionSequenceId).resolvedAttacks[0]
      .techniqueApplicationId, appliedAttack.techniqueApplicationId);

    const actionUsedBeforeSecondAttack = getState().ui.turn.actionUsed;
    const criticalAttackId = getWorkspaceSessionForTests().attackId;
    dialog.forms.attack = new FixtureForm("attack", {
      rollMode: "normal", firstD20: "20", confirmSeparateAction: false,
    });
    fireWorkspaceAction(dialog, "attack-hit");
    const completedSequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === exceptionSequenceId);
    assert.equal(completedSequence.resolvedAttacks.length, 2);
    assert.equal(completedSequence.resolvedAttacks[1].id, criticalAttackId);
    assert.equal(completedSequence.resolvedAttacks[1].critical, true);
    assert.equal(completedSequence.resolvedAttacks[1].damageStatus, "awaiting-damage");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3", damage2: "8" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceInput(dialog, "damage2", "8");
    assert.equal(dialog.damageTotal.textContent, "17");
    assert.match(dialog.damageFormula.textContent, /3 \+ 8 \+ 6 = 17/);
    fireWorkspaceAction(dialog, "submit-damage");
    const damagedSequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === exceptionSequenceId);
    assert.equal(damagedSequence.resolvedAttacks[1].damageTotalBeforeTargetModifiers, 17);
    assert.equal(getState().ui.turn.actionUsed, actionUsedBeforeSecondAttack);
    assert.match(dialog.footer.innerHTML, /Завершить без техники/);
    const kiBeforeFinalTechnique = getState().combat.ki.current;
    fireWorkspaceAction(dialog, "open-strike");
    dialog.forms.strike = new FixtureForm("strike", {
      techniqueId: "ll-monk:stunning-strike",
      paymentMode: "ki",
    });
    fireWorkspaceAction(dialog, "apply-strike");
    const pendingSave = getState().monk.combatAssistant.pendingApplications.at(-1);
    assert.equal(pendingSave.targetOutcome, "unknown");
    assert.equal(getState().combat.ki.current, kiBeforeFinalTechnique - 1);
    fireWorkspaceAction(dialog, "no-technique-continue");
    assert.equal(getWorkspaceSessionForTests().currentStep, "summary");
    assert.match(dialog.footer.innerHTML, /data-workspace-action="finish-workspace"/);
    const phaseBeforeFinish = getState().battleConsole?.current?.phase ?? null;
    const actionBeforeFinish = getState().ui.turn.actionUsed;
    const kiBeforeFinish = getState().combat.ki.current;
    fireWorkspaceAction(dialog, "finish-workspace");
    assert.equal(dialog.open, false);
    assert.equal(getState().battleConsole?.current?.phase ?? null, phaseBeforeFinish);
    assert.equal(getState().ui.turn.actionUsed, actionBeforeFinish);
    assert.equal(getState().combat.ki.current, kiBeforeFinish);
  } finally {
    cleanup(unsubscribe);
  }
});
