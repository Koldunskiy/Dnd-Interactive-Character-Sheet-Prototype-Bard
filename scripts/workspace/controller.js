import { getDerivedStats } from "../calculations.js";
import { getSaraHudModel, updateSaraHudRegion, renderSaraEndBattleButton } from "../render/sara-hud.js";
import {
  buildRestReplacementCommandId,
  parseRestCommandId,
} from "./rest-command.js";
import {
  getWorkspaceAttackSequence,
  getCurrentWorkspaceStrikeParent,
  findAwaitingWorkspaceDamage,
  getWorkspaceAttackContext,
  getNormalAttackFingerprint,
  getWorkspaceAttackFingerprint,
  getNormalAttackSequence,
  findAwaitingNormalDamage,
  isWorkspaceOwnerCurrent,
  calculateWorkspaceAttackPreview,
  calculateWorkspaceDamagePreview,
  submitWorkspaceAttack,
  submitWorkspaceSequenceAttack,
  submitWorkspaceDamage,
  markWorkspaceDamageOutside,
  abandonWorkspaceSequence,
} from "./attack-adapter.js";
import {
  applySaraCombatAction,
  castSaraRacialSpell,
  executeMonkTechnique,
  getBattlePhaseReason,
  declineDeflectMissileReturn,
  recordSaraIncomingDamage,
} from "../actions/monk.js";
import {
  commitDeflection,
  commitRegeneration,
  correctSaraResource,
  applyTechniqueToHit,
  recordTargetSaveOutcome,
  recordBasicSaraAction,
  startAttackSequence,
  getUsedAttackSlots,
  beginSeekingStrike,
  resolveSeekingStrike,
  applyGentlingTouchToAttackSlot,
} from "../actions/sara-combat.js";
import { getSaraBattleCommandRegistry } from "../battle/command-registry.js";
import { getActiveBattle } from "../battle/model.js";
import { executeBattleCommand } from "../battle/commands.js";
import {
  createIncomingEventDraft,
  incomingContextIsCurrent,
} from "../battle/incoming-event-draft.js";
import {
  renderIncomingCatchControls,
  renderIncomingPreview,
  renderIncomingWorkspace,
} from "../render/render-incoming-workspace.js";
import {
  commitIncomingEvent,
  normalizeIncomingEventRequest,
  previewIncomingEvent,
  readIncomingEventReceipt,
} from "../actions/incoming-event.js";
import {
  amendCharacterRoll,
  correctCharacterRollOutcome,
  isRollConsequencePending,
  recordAndAmendCharacterRoll,
  recordCharacterRoll,
  resolveCharacterRollConsequence,
} from "../rolls/commands.js";
import { getSaraRollBreakdown } from "../rolls/providers/sara.js";
import {
  closeWorkspaceHost,
  focusWorkspaceHeading,
  getWorkspaceHost,
  initWorkspaceHost,
  minimizeWorkspaceHost,
  openWorkspaceHost,
  renderWorkspaceHost,
  updateWorkspaceResources,
  workspaceHostIsOpen,
  workspaceHostIsEmbedded,
} from "./host.js";
import {
  renderCommandWorkspace,
  renderWorkspaceConsequencePreview,
  renderWorkspaceRollPreview,
  renderWorkspacePotionPreview,
  renderWorkspaceHitDiePreview,
  updateRestReplacementSubchoices,
} from "../render/render-command-workspace.js";
import {
  renderAttackWorkspace,
  renderWorkspaceAttackPreview,
  renderWorkspaceDamagePreview,
} from "../render/render-attack-workspace.js";
import {
  getSessionContext,
  isCurrentSession,
  retryPersistedState,
  getState,
} from "../state.js";
import { MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import { POTIONS } from "../sara-functional.js";
import {
  completeSaraRest,
  declineSaraRestReplacement,
  finishSaraShortRest,
  replaceSaraRestTechnique,
  spendSaraHitDie,
  useSaraPotion,
} from "../actions/sara-functional.js";
import {
  getEffectiveSelectedTechniqueIds,
  getTechniqueAvailability,
  isTechniqueEffectivelySelected,
} from "../selectors/techniques.js";
import {
  pendingSeeking,
  readSeekingHistory,
} from "../combat/seeking-history.js";

const appInstanceId = createId("workspace-app");
let session = null;
const suspendedSessions = [];
const endBattleRequests = new Set();
const uncertainEndBattles = new Set();
const END_BATTLE_CONFIRMATION = "Завершить бой? Неприменённый ввод будет отменён. Уже записанные результаты сохранятся.";

function reportEndBattleVerificationRequired() {
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed", {
    detail: { verificationRequired: true },
  }));
}

function ownerMatches(owner, context = getSessionContext()) {
  return owner?.characterId === context.characterId &&
    owner?.sessionGeneration === context.sessionGeneration &&
    owner.characterId === "sara-velaris";
}

function hasEndedBattleEvidence(battleId) {
  const state = getState();
  return state.battleConsole?.history?.some((entry) =>
    entry.id === battleId && entry.phase === "ended") === true;
}

function endBattleEvidence(owner, battleId) {
  if (!ownerMatches(owner)) return "verification-required";
  if (hasEndedBattleEvidence(battleId)) return "ended";
  const current = getState().battleConsole?.current;
  if (current?.id === battleId && ["waiting", "own-turn", "paused"].includes(current.phase)) {
    return "not-applied";
  }
  return "verification-required";
}

function cleanupEndedBattleUi(owner, battleId, detail) {
  if (!ownerMatches(owner)) return false;
  const current = getState().battleConsole?.current;
  if (current?.id && current.id !== battleId) return false;
  if (current?.id === battleId && ["waiting", "own-turn", "paused"].includes(current.phase)) {
    return false;
  }
  disposeWorkspaceOwner(owner, "battle-ended");
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed", { detail }));
  return true;
}

export function requestEndBattle({ owner, battleId }, { confirm = (message) =>
  window.confirm(message) } = {}) {
  const key = JSON.stringify([owner?.characterId, owner?.sessionGeneration, battleId]);
  const validate = () => {
    if (!ownerMatches(owner)) return "Владелец боя изменился.";
    const battle = getState().battleConsole?.current;
    if (!battle || battle.id !== battleId ||
        !["waiting", "own-turn", "paused"].includes(battle.phase)) return "Этот бой больше не активен.";
    return "";
  };
  if (uncertainEndBattles.has(key)) {
    if (!ownerMatches(owner)) {
      uncertainEndBattles.delete(key);
      reportEndBattleVerificationRequired();
      return { status: "verification-required", cleanupSkipped: true, staleContext: true };
    }
    const evidence = endBattleEvidence(owner, battleId);
    if (evidence === "ended") {
      uncertainEndBattles.delete(key);
      const currentBattle = getState().battleConsole?.current;
      if (!ownerMatches(owner) ||
          currentBattle?.id && currentBattle.id !== battleId) {
        return { status: "rejected", reason: "Контекст боя изменился; новые панели не закрыты.", cleanupSkipped: true, staleContext: true };
      }
      const cleanupPerformed = cleanupEndedBattleUi(owner, battleId, {
        reason: "battle-ended", persistenceUnconfirmed: true,
      });
      return cleanupPerformed
        ? { status: "applied", persistenceUnconfirmed: true }
        : { status: "rejected", reason: "Контекст боя изменился; новые панели не закрыты.", cleanupSkipped: true, staleContext: true };
    }
    if (evidence === "not-applied") {
      uncertainEndBattles.delete(key);
      return { status: "rejected", reason: "Бой не был завершён. Проверьте состояние и повторите запрос." };
    }
    reportEndBattleVerificationRequired();
    return { status: "verification-required" };
  }
  const invalid = validate();
  if (invalid) return { status: "rejected", reason: invalid };
  if (endBattleRequests.has(key)) return { status: "rejected", reason: "Завершение боя уже выполняется." };
  endBattleRequests.add(key);
  try {
    if (!confirm(END_BATTLE_CONFIRMATION)) return { status: "cancelled" };
    const changed = validate();
    if (changed) return { status: "rejected", reason: changed };
    if (session && owner.characterId === session.owner.characterId &&
        owner.sessionGeneration === session.owner.sessionGeneration && session.submitting) {
      return { status: "rejected", reason: "Дождитесь завершения текущей операции." };
    }
    let result;
    try {
      result = executeBattleCommand("end-battle");
    } catch (error) {
      if (!ownerMatches(owner)) {
        uncertainEndBattles.delete(key);
        reportEndBattleVerificationRequired();
        return { status: "verification-required", cleanupSkipped: true, staleContext: true };
      }
      uncertainEndBattles.add(key);
      if (endBattleEvidence(owner, battleId) === "ended") {
        uncertainEndBattles.delete(key);
        const cleanupPerformed = cleanupEndedBattleUi(owner, battleId, {
          reason: "battle-ended", persistenceUnconfirmed: true,
        });
        if (!cleanupPerformed) {
          return {
            status: "applied",
            persistenceUnconfirmed: true,
            cleanupSkipped: true,
            staleContext: true,
            warning: error instanceof Error ? error.message : String(error),
          };
        }
        return {
          status: "applied",
          persistenceUnconfirmed: true,
          cleanupSkipped: false,
          staleContext: false,
          warning: error instanceof Error ? error.message : String(error),
        };
      }
      reportEndBattleVerificationRequired();
      return { status: "verification-required" };
    }
    if (result.status !== "applied" || result.changed === false) {
      return { status: "rejected", reason: result.reason ?? "Бой не был завершён." };
    }
    const persistence = result.persistence ?? result.persistenceResult ?? { ok: true };
    const cleanupPerformed = cleanupEndedBattleUi(owner, battleId, {
      reason: "battle-ended", persistenceFailed: persistence.ok === false,
    });
    return {
      status: "applied",
      persistence,
      cleanupSkipped: !cleanupPerformed,
      staleContext: !cleanupPerformed,
    };
  } finally {
    endBattleRequests.delete(key);
  }
}

function createId(prefix) {
  return globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function stepKey(step, attackId = null) {
  return `${step}:${attackId ?? "none"}`;
}

function suspendCurrentSession() {
  if (!session) return true;
  if (session.submitting || session.appliedUnsaved) return false;
  if (!suspendedSessions.includes(session)) {
    session.suspended = true;
    suspendedSessions.push(session);
  }
  session = null;
  return true;
}

function restoreParentSession({ validateBattleContext = false } = {}) {
  while (suspendedSessions.length) {
    const parent = suspendedSessions.pop();
    if (!isWorkspaceOwnerCurrent(parent.owner) ||
        parent.owner.appInstanceId !== appInstanceId) continue;
    if (validateBattleContext && parent.workspaceType === "attack" && parent.battleContext) {
      const currentBattle = getState().battleConsole?.current ?? null;
      if ((parent.battleContext.battleId ?? null) !== (currentBattle?.id ?? null) ||
          parent.battleContext.ownTurnId !== currentBattle?.ownTurnId) continue;
    }
    if (parent.workspaceType === "command" && parent.currentStep === "command-input" &&
        !parent.appliedUnsaved) {
      const currentCommand = getCommandDescriptor(getState(), parent.scenarioId);
      if (!currentCommand?.availability.enabled) continue;
    }
    session = parent;
    if (session.workspaceType === "attack") rehydrateFromState(getState());
    session.suspended = false;
    session.minimized = false;
    render();
    if (!openWorkspaceHost(findInvoker(parent.returnTarget?.key))) {
      session = null;
      return false;
    }
    const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
    if (body) body.scrollTop = parent.internalScrollByStep[parent.currentStepKey] ?? 0;
    focusWorkspaceHeading();
    return true;
  }
  return false;
}

function finishCurrentSession(options = {}) {
  session = null;
  if (restoreParentSession(options)) return;
  closeWorkspaceHost();
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
}

function getStepDraft() {
  session.rawInputsByStep[session.currentStepKey] ??= {};
  return session.rawInputsByStep[session.currentStepKey];
}

function parseForm(form) {
  const values = {};
  for (const control of form.elements) {
    if (!control.name) continue;
    if (control.type === "radio" && !control.checked) continue;
    values[control.name] = control.type === "checkbox" ? control.checked : control.value;
  }
  return values;
}

function getSequence(state = getState()) {
  return session?.sequenceId ? getWorkspaceAttackSequence(state, session.sequenceId) : null;
}

function getRelevantFingerprint(state, sequenceId, firstAttempt) {
  return session?.sequenceKind && session.sequenceKind !== "attack-action"
    ? getWorkspaceAttackFingerprint(state, sequenceId, session.sequenceKind, firstAttempt)
    : getNormalAttackFingerprint(state, sequenceId, firstAttempt);
}

function getCommandDescriptor(state, commandId) {
  if (commandId === "completed-rest") {
    return {
      id: commandId,
      scenarioId: commandId,
      titleRu: "Завершённый отдых",
      navigationGroups: [],
      activationBudget: "none",
      resourceCost: "Завершённый игровой отдых",
      trigger: "Выберите завершённый короткий или продолжительный отдых.",
      availability: { enabled: true, reasonCode: null, reasonRu: "" },
    };
  }
  const restCommand = parseRestCommandId(commandId);
  if (restCommand) {
    const { stage, restId } = restCommand;
    const kind = stage === "hit-die" ? "rest-hit-die" : "rest-replacement";
    const runtime = state.monk?.functionalRuntime?.rest;
    const valid = runtime?.id === restId &&
      (kind === "rest-hit-die" && runtime.kind === "short" &&
        runtime.phase === "hit-dice" ||
       kind === "rest-replacement" && runtime.kind === "long" &&
        ["replacement-offer", "replacement-edit"].includes(runtime.phase));
    const derived = getDerivedStats(state);
    const diceAvailable = Number(state.combat?.hitDice?.remaining) > 0 &&
      Number(state.combat?.hp?.current) < derived.maxHitPoints &&
      (!state.battleConsole?.current || state.battleConsole.current.phase === "ended");
    return {
      id: commandId,
      scenarioId: commandId,
      restId,
      restStage: kind === "rest-hit-die" ? "hit-die"
        : stage === "offer" ? "offer" : "edit",
      titleRu: kind === "rest-hit-die" ? "Кость хитов · короткий отдых"
        : stage === "offer" ? "Замена техники после отдыха" : "Выбрать замену техники",
      navigationGroups: [],
      activationBudget: "none",
      resourceCost: kind === "rest-hit-die" ? "Одна кость хитов" : "Одно право замены",
      trigger: kind === "rest-hit-die"
        ? `Кость хитов к${state.combat?.hitDie ?? "?"} + текущий модификатор Телосложения.`
        : "Можно заменить ровно одну обычную технику; Signature Strike не изменяется.",
      availability: {
        enabled: Boolean(valid),
        canSpend: Boolean(diceAvailable),
        reasonCode: !valid ? "rest-window-unavailable" : !diceAvailable ? "hit-die-unavailable" : null,
        reasonRu: !valid ? "Окно отдыха уже закрыто или заменено."
          : kind === "rest-hit-die" && !diceAvailable
            ? Number(state.combat?.hitDice?.remaining) <= 0 ? "Нет оставшихся костей хитов."
              : Number(state.combat?.hp?.current) >= derived.maxHitPoints ? "HP полные; кость хитов тратить не нужно."
                : "Лечение костями хитов недоступно во время боя."
            : "",
      },
    };
  }
  if (commandId.startsWith("potion-use:")) {
    const [, potionId, ...encodedItemId] = commandId.split(":");
    const itemId = decodeURIComponent(encodedItemId.join(":"));
    const potion = POTIONS[potionId];
    const item = state.inventory?.items?.find((entry) => entry.id === itemId);
    const manifest = state.inventory?.starterManifest;
    const bound = manifest?.bindings?.[potionId] === itemId;
    const battle = state.battleConsole?.current;
    const battleReason = battle && battle.phase !== "ended"
      ? battle.phase !== "own-turn" ? "Зелье можно применить только в свой ход."
        : state.ui?.turn?.actionUsed ? "Действие уже использовано в этом ходу." : ""
      : "";
    const enabled = Boolean(potion && item?.consumable?.kind === "healing-potion" &&
      item.consumable.potionId === potionId && bound && Number.isSafeInteger(item.quantity) &&
      item.quantity > 0 && !battleReason);
    return {
      id: commandId,
      scenarioId: commandId,
      potionId,
      itemId,
      titleRu: potion?.name ?? "Зелье лечения",
      navigationGroups: [],
      activationBudget: "action",
      resourceCost: "Одна порция",
      trigger: "Введите сумму физических костей; зелье и поддерживаемое лечение будут применены атомарно.",
      availability: {
        enabled,
        reasonCode: !item || !bound ? "potion-binding-unavailable" : !item?.quantity
          ? "potion-out-of-stock" : battleReason ? "turn-budget-unavailable" : null,
        reasonRu: !bound ? "Предмет больше не привязан к этой порции зелья."
          : !item || item.consumable?.potionId !== potionId
            ? "Профиль предмета не соответствует зелью."
            : !item.quantity ? "В инвентаре нет этой порции."
              : battleReason,
      },
    };
  }
  if (commandId.startsWith("monk-technique:")) {
    const techniqueId = commandId.slice("monk-technique:".length);
    const technique = MONK_TECHNIQUE_BY_ID.get(techniqueId);
    if (!technique || technique.category === "passive" || technique.eligibleStrike ||
        ["on-miss", "after-roll"].includes(technique.activation) ||
        ["ll-monk:mantle-of-courtesy", "ll-monk:indomitable-spirit"].includes(techniqueId)) {
      return null;
    }
    const selected = isTechniqueEffectivelySelected(state, techniqueId);
    const availability = getTechniqueAvailability(state, technique);
    const battleRouted = ["ll-monk:step-of-the-wind", "ll-monk:patient-defense",
      "ll-monk:mystic-regeneration", "ll-monk:deflect-strike", "ll-monk:deflect-missile"]
      .includes(techniqueId);
    const activation = technique.activation;
    const turn = state.ui?.turn ?? {};
    const budgetUsed = state.battleConsole?.current?.phase === "own-turn" &&
      ((["action", "replace-attack"].includes(activation) && turn.actionUsed) ||
       (activation === "bonus-action" && turn.bonusActionUsed) ||
       (activation === "reaction" && turn.reactionUsed));
    const phaseReason = getBattlePhaseReason(state, activation);
    const enabled = !battleRouted && selected && availability.available &&
      !budgetUsed && !phaseReason;
    return {
      id: commandId,
      scenarioId: commandId,
      techniqueId,
      technique,
      titleRu: technique.nameRu,
      navigationGroups: [],
      activationBudget: activation,
      resourceCost: technique.payment,
      trigger: technique.trigger,
      parentRequirement: null,
      availability: {
        enabled,
        reasonCode: !selected ? "technique-not-selected" : budgetUsed ? "turn-budget-used" : null,
        reasonRu: battleRouted
          ? "Используйте существующую команду боевого пульта."
          : !selected
            ? "Техника не выбрана или сейчас не действует."
            : phaseReason
              ? phaseReason
            : !availability.available
              ? availability.reason
              : budgetUsed ? "Это действие уже использовано в текущем ходу." : "",
      },
    };
  }
  if (commandId === "incoming-damage") {
    return {
      id: commandId,
      scenarioId: commandId,
      titleRu: "Записать полученный урон",
      navigationGroups: [],
      activationBudget: "none",
      resourceCost: "Без расхода реакции",
      trigger: "Введите урон, полученный от ведущего; временные HP учитываются автоматически.",
      parentRequirement: null,
      availability: { enabled: true, reasonCode: null, reasonRu: "" },
    };
  }
  if (commandId.startsWith("pending-save:")) {
    const applicationId = commandId.slice("pending-save:".length);
    const application = state.monk?.combatAssistant?.pendingApplications?.find((entry) =>
      entry.id === applicationId && !["success", "failure"].includes(entry.targetOutcome));
    if (!application) return null;
    return {
      id: commandId,
      scenarioId: commandId,
      titleRu: "Результат спасброска цели",
      navigationGroups: [],
      activationBudget: "none",
      resourceCost: "Без расхода",
      trigger: "Записать полученный от игрока/ведущего исход без повторной оплаты.",
      parentRequirement: application.parentAttackId,
      availability: { enabled: true, reasonCode: null, reasonRu: "" },
    };
  }
  if (commandId.startsWith("pending-roll:")) {
    const rollId = commandId.slice("pending-roll:".length);
    const roll = state.characterRolls?.records?.find((entry) =>
      entry.id === rollId && isRollConsequencePending(entry));
    if (!roll) return null;
    return {
      id: commandId,
      scenarioId: commandId,
      titleRu: roll.consequence.status === "awaiting-outcome"
        ? roll.kind === "saving-throw" ? "Исход спасброска" : "Исход проверки"
        : "Последствие спасброска",
      navigationGroups: [],
      activationBudget: "none",
      resourceCost: "Без расхода",
      trigger: roll.consequence.status === "awaiting-outcome"
        ? "Записать полученный от ведущего исход без повторного броска."
        : "Указать наличие урона, применить его или отметить учёт вне листа.",
      parentRequirement: roll.id,
      availability: { enabled: true, reasonCode: null, reasonRu: "" },
    };
  }
  return getSaraBattleCommandRegistry(state).find((entry) => entry.id === commandId) ?? null;
}

function sequenceCurrentForAttack(
  sequence,
  state,
  sequenceKind = session?.sequenceKind ?? sequence?.kind ?? "attack-action",
) {
  if (!sequence || sequence.kind !== sequenceKind ||
      sequence.status !== "open" ||
      Number(sequence.turnMarker) !== Number(state.ui?.turn?.turnNumber ?? 1)) return false;
  const battle = state.battleConsole?.current;
  if (sequence.battleId) {
    const phaseValid = ["reaction-unarmed", "returned-projectile"].includes(sequence.kind)
      ? ["waiting", "own-turn"].includes(battle?.phase)
      : battle?.phase === "own-turn";
    return battle?.id === sequence.battleId && phaseValid &&
      (!sequence.ownTurnId || battle.ownTurnId === sequence.ownTurnId);
  }
  return !battle || (["reaction-unarmed", "returned-projectile"].includes(sequence.kind)
    ? ["waiting", "own-turn"].includes(battle.phase)
    : battle.phase === "own-turn");
}

function setStep(step, attackId = session.attackId, customKey = null) {
  const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (body && session.currentStepKey) {
    session.internalScrollByStep[session.currentStepKey] = body.scrollTop;
  }
  session.currentStep = step;
  session.attackId = attackId;
  session.currentStepKey = customKey ?? stepKey(step, attackId);
  session.stepLabel = ({
    "attack-input": "Физический бросок · проверка попадания",
    "damage-input": "Физические кости урона",
    checkpoint: "Результат записан · выберите продолжение",
    "strike-input": "Необязательная техника после записанного урона",
    summary: "Записанные удары и оставшиеся задачи",
    "command-result": "Результат записан",
    "missile-return": "Продолжение после отражения снаряда · отдельное решение",
    "confirm-close": "Подтверждение закрытия без отката",
  })[step] ?? "Действие «Атака»";
  session.error = "";
  session.confirmationRequired = false;
  render();
  const nextBody = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (nextBody) nextBody.scrollTop = session.internalScrollByStep[session.currentStepKey] ?? 0;
  focusWorkspaceHeading();
}

function render() {
  if (!session) return;
  const state = getState();
  if (session.workspaceType === "incoming") {
    syncIncomingPreviewFingerprint(session.incomingDraft, state);
  }
  const sceneControls = document.querySelector("[data-sara-task-scene-controls]");
  const sceneMarkup = renderSaraEndBattleButton(state, session.owner);
  if (sceneControls && sceneControls.innerHTML !== sceneMarkup) sceneControls.innerHTML = sceneMarkup;
  const parent = [...suspendedSessions].reverse().find((entry) =>
    isWorkspaceOwnerCurrent(entry.owner) && entry.owner.appInstanceId === appInstanceId);
  session.completionLabel = parent
    ? `Вернуться к ${parent.command?.titleRu ?? "рабочей панели"}`
    : "Готово";
  const view = session.workspaceType === "incoming"
    ? renderIncomingWorkspace({ ...session, owner: getSessionContext() }, state)
    : session.workspaceType === "command"
      ? renderCommandWorkspace(session, state)
      : renderAttackWorkspace(session, state);
  renderWorkspaceHost({
    ...view,
    status: session.status ?? "",
    error: session.error ?? "",
    forceBody: session.forceWorkspaceBodyRender === true,
    viewKey: JSON.stringify([
      session.workspaceSessionId,
      session.currentStepKey,
      Boolean(session.appliedUnsaved),
      session.workspaceType === "incoming" ? session.incomingDraft.stage : null,
      session.workspaceType === "incoming" && session.incomingDraft.stage === "save-input"
        ? session.incomingDraft.rollDraft.rollMode : null,
      session.workspaceType === "incoming" && session.incomingDraft.stage === "save-consequence"
        ? [session.incomingDraft.rollDraft.damageBasis, session.incomingDraft.rollDraft.effectProfile,
          session.incomingDraft.rollDraft.hasDamage] : null,
    ]),
  });
  session.forceWorkspaceBodyRender = false;
  const derived = getDerivedStats(state);
  updateSaraHudRegion(
    document.querySelector("[data-sara-task-dock] [data-sara-task-hud]"),
    getSaraHudModel(state, derived),
  );
  const host = getWorkspaceHost();
  const hp = host?.querySelector("[data-workspace-hp]");
  const ki = host?.querySelector("[data-workspace-ki]");
  if (hp) hp.textContent = `${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}`;
  if (ki) ki.textContent = String(state.combat?.ki?.current ?? "—");
  if (session.currentStep === "attack-input") renderWorkspaceAttackPreview(session, state);
  if (session.currentStep === "damage-input") renderWorkspaceDamagePreview(session);
  if (session.workspaceType === "incoming") {
    const preview = getWorkspaceHost()?.querySelector("[data-incoming-preview]");
    if (preview) preview.innerHTML = renderIncomingPreview(session, state);
  }
  if (session.workspaceType === "command" && session.scenarioId === "character-roll" &&
      session.currentStep === "command-input") renderWorkspaceRollPreview(session, state);
  if (session.workspaceType === "command" && session.scenarioId?.startsWith("potion-use:") &&
      session.currentStep === "command-input") renderWorkspacePotionPreview(session, state);
  if (session.workspaceType === "command" && session.currentStep === "roll-result") {
    renderWorkspaceConsequencePreview(session, state);
  }
}

function incomingReceiptEvidence(state, operationId, normalizedRequest, provenNotApplied = false) {
  const receipt = readIncomingEventReceipt(state, operationId);
  if (!receipt) return { status: provenNotApplied ? "not-applied" : "unknown" };
  if (JSON.stringify(receipt.request) !== JSON.stringify(normalizedRequest)) {
    return { status: "unknown", reason: "Receipt не совпадает с исходным запросом." };
  }
  return { status: "applied", receipt };
}

function captureIncomingOperation(active, draft) {
  return {
    session: active,
    draft,
    eventId: draft.eventId,
    owner: {
      characterId: active.owner.characterId,
      sessionGeneration: active.owner.sessionGeneration,
    },
  };
}

function incomingOperationIsCurrent(captured) {
  const currentOwner = getSessionContext();
  return session === captured.session &&
    session?.incomingDraft === captured.draft &&
    captured.draft.eventId === captured.eventId &&
    session.owner.characterId === captured.owner.characterId &&
    session.owner.sessionGeneration === captured.owner.sessionGeneration &&
    currentOwner.characterId === captured.owner.characterId &&
    currentOwner.sessionGeneration === captured.owner.sessionGeneration &&
    isCurrentSession(captured.owner);
}

function incomingRequestForDraft(draft) {
  const identity = {
    battleId: draft.battleId,
    eventId: draft.eventId,
    phaseAtOpen: draft.phaseAtOpen,
    ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
  };
  if (draft.stage === "damage") {
    return {
      kind: "direct-damage",
      damage: draft.rawDamage,
      ...identity,
    };
  }
  if (draft.stage === "deflect") {
    return {
      kind: "deflection",
      damage: draft.rawDamage,
      deflectRoll: draft.rawDeflectRoll,
      source: draft.source,
      catchChoice: draft.catchChoice,
      ...identity,
    };
  }
  if (draft.stage === "save-consequence") {
    return {
      kind: "completed-save",
      ...identity,
      outcome: draft.outcome,
      hasDamage: draft.outcome !== "unknown" && draft.rollDraft.hasDamage === true,
      damage: draft.rollDraft.damage,
      damageBasis: draft.rollDraft.damageBasis ?? "dm-final",
      effectProfile: draft.rollDraft.effectProfile,
      spellSaveSource: draft.source === "spell",
      roll: {
        id: draft.rollDraft.ability,
        firstD20: draft.rollDraft.firstD20,
        secondD20: draft.rollDraft.secondD20,
        rollMode: draft.rollDraft.rollMode,
        dc: draft.rollDraft.dc,
      },
    };
  }
  if (draft.stage === "miss-response" && draft.outcome === "miss") {
    return {
      kind: "ebb-and-flow",
      mode: "dexterity-save",
      triggerConfirmed: true,
      ...identity,
    };
  }
  return null;
}

function incomingPreviewFingerprint(draft, state) {
  const request = incomingRequestForDraft(draft);
  if (!request) return null;
  const preview = previewIncomingEvent(state, request);
  return JSON.stringify(preview);
}

function syncIncomingPreviewFingerprint(draft, state, requireConfirmation = false) {
  const fingerprint = incomingPreviewFingerprint(draft, state);
  if (requireConfirmation && draft.previewFingerprint &&
      fingerprint !== draft.previewFingerprint) {
    draft.previewConfirmationRequired = true;
  }
  draft.previewFingerprint = fingerprint;
  return fingerprint;
}

function clearIncomingPending(draft, active) {
  delete draft.pendingOperationId;
  delete draft.pendingNormalizedRequest;
  delete draft.pendingReturnStage;
  active.appliedUnsaved = false;
}

function commitIncomingRequest(active, draft, request, operationId, returnStage) {
  const captured = captureIncomingOperation(active, draft);
  if (!incomingOperationIsCurrent(captured)) return true;
  const initialContext = getSessionContext();
  const state = getState();
  if (!incomingContextIsCurrent(draft, state, initialContext)) {
    if (incomingOperationIsCurrent(captured)) {
      draft.stage = "expired";
      draft.error = "Контекст боя изменился.";
      render();
    }
    return true;
  }
  const preview = previewIncomingEvent(state, request);
  if (!incomingOperationIsCurrent(captured)) return true;
  if (!preview.ok) {
    draft.error = preview.reason;
    if (incomingOperationIsCurrent(captured)) render();
    return true;
  }
  const fingerprint = JSON.stringify(preview);
  if (draft.previewConfirmationRequired ||
      draft.previewFingerprint && draft.previewFingerprint !== fingerprint) {
    draft.previewConfirmationRequired = false;
    draft.previewFingerprint = fingerprint;
    draft.error = "Предварительный результат изменился. Проверьте обновлённый расчёт и подтвердите ещё раз.";
    if (incomingOperationIsCurrent(captured)) render();
    return true;
  }
  const normalized = normalizeIncomingEventRequest(request, state);
  if (!incomingOperationIsCurrent(captured)) return true;
  if (!normalized.ok) {
    draft.error = normalized.reason;
    if (incomingOperationIsCurrent(captured)) render();
    return true;
  }
  const commitContext = getSessionContext();
  const commitState = getState();
  if (!incomingOperationIsCurrent(captured) ||
      commitContext.characterId !== captured.owner.characterId ||
      commitContext.sessionGeneration !== captured.owner.sessionGeneration ||
      !incomingContextIsCurrent(draft, commitState, commitContext)) return true;
  if (commitContext.stateRevision !== initialContext.stateRevision) {
    const refreshedPreview = previewIncomingEvent(commitState, request);
    if (!incomingOperationIsCurrent(captured)) return true;
    if (!refreshedPreview.ok || JSON.stringify(refreshedPreview) !== fingerprint) {
      draft.previewConfirmationRequired = false;
      draft.previewFingerprint = JSON.stringify(refreshedPreview);
      draft.error = refreshedPreview.reason ??
        "Предварительный результат изменился. Проверьте обновлённый расчёт и подтвердите ещё раз.";
      if (incomingOperationIsCurrent(captured)) render();
      return true;
    }
  }
  const commitNormalized = normalizeIncomingEventRequest(request, commitState);
  if (!incomingOperationIsCurrent(captured)) return true;
  if (!commitNormalized.ok) {
    draft.error = commitNormalized.reason;
    render();
    return true;
  }
  draft.pendingOperationId = operationId;
  draft.pendingNormalizedRequest = structuredClone(commitNormalized.request);
  draft.pendingReturnStage = returnStage;
  active.submitting = true;
  try {
    const result = commitIncomingEvent(commitContext, request, operationId);
    if (!incomingOperationIsCurrent(captured)) return true;
    if (result.status === "applied" || result.status === "replayed") {
      if (!incomingOperationIsCurrent(captured)) return true;
      const evidence = incomingReceiptEvidence(
        getState(), operationId, draft.pendingNormalizedRequest,
      );
      if (!incomingOperationIsCurrent(captured)) return true;
      if (evidence.status === "applied") {
        draft.appliedReceipt = evidence.receipt;
        draft.stage = result.persistence?.ok === false ? "save-recovery" : "result";
        active.appliedUnsaved = result.persistence?.ok === false;
        active.status = active.appliedUnsaved
          ? "Применено в памяти; повторите сохранение."
          : "Входящее событие записано.";
      } else {
        draft.stage = "verification";
        draft.error = evidence.reason ?? "Не удалось подтвердить receipt операции.";
        active.appliedUnsaved = true;
      }
    } else if (result.reason === "duplicate-operation") {
      draft.stage = "verification";
      draft.error = result.reason;
      active.appliedUnsaved = true;
    } else if (result.code === "operation-id-collision") {
      draft.stage = "verification";
      active.appliedUnsaved = true;
      draft.error = result.reason;
    } else {
      if (!incomingOperationIsCurrent(captured)) return true;
      const evidence = incomingReceiptEvidence(
        getState(), operationId, draft.pendingNormalizedRequest, true,
      );
      if (!incomingOperationIsCurrent(captured)) return true;
      if (evidence.status === "applied") {
        draft.appliedReceipt = evidence.receipt;
        draft.stage = result.persistence?.ok === false ? "save-recovery" : "result";
        active.appliedUnsaved = result.persistence?.ok === false;
      } else {
        clearIncomingPending(draft, active);
        draft.stage = returnStage;
        draft.error = result.reason ?? "Входящее событие не применено.";
      }
    }
  } catch (error) {
    if (!incomingOperationIsCurrent(captured)) return true;
    let evidence = { status: "unknown" };
    let inspectionError = null;
    try {
      if (!incomingOperationIsCurrent(captured)) return true;
      evidence = incomingReceiptEvidence(
        getState(), operationId, draft.pendingNormalizedRequest,
      );
      if (!incomingOperationIsCurrent(captured)) return true;
    } catch (verificationError) {
      inspectionError = verificationError;
    }
    if (!incomingOperationIsCurrent(captured)) return true;
    if (evidence.status === "applied") {
      draft.appliedReceipt = evidence.receipt;
      draft.stage = "save-recovery";
      active.appliedUnsaved = true;
    } else {
      draft.stage = "verification";
      active.appliedUnsaved = true;
    }
    const reason = inspectionError ?? evidence.reason ?? error;
    draft.error = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (incomingOperationIsCurrent(captured)) active.submitting = false;
  }
  if (incomingOperationIsCurrent(captured)) render();
  return true;
}

function handleIncomingAction(action) {
  const active = session;
  const draft = active.incomingDraft;
  const state = getState();
  if (!draft || active.workspaceType !== "incoming") return false;
  if (active.submitting || draft.stage === "verification" &&
      !["incoming-verify"].includes(action)) return true;
  if (!action.startsWith("incoming-ebb")) draft.error = "";
  if (action === "incoming-cancel") {
    if (draft.appliedReceipt || draft.stage === "verification" || active.appliedUnsaved) return true;
    session = null;
    if (!restoreParentSession({ validateBattleContext: true })) {
      closeWorkspaceHost({ restoreFocus: false });
      document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
    }
    return true;
  }
  if (action === "incoming-close") {
    if (draft.stage === "verification" || active.appliedUnsaved) return true;
    finishCurrentSession({ validateBattleContext: true });
    return true;
  }
  if (action === "incoming-back") {
    if (draft.appliedReceipt) return true;
    const previous = {
      source: "outcome",
      damage: draft.source === "spell" ? "spell-choice" : "source",
      deflect: "damage",
      "spell-choice": "source",
      "save-input": "spell-choice",
      "save-consequence": "save-input",
    }[draft.stage];
    if (previous) draft.stage = previous;
    if (!action.startsWith("incoming-ebb")) draft.error = "";
    render();
    return true;
  }
  if (action === "incoming-retry-save") {
    if (draft.stage !== "save-recovery" || !draft.pendingOperationId ||
        !draft.pendingNormalizedRequest) return true;
    const captured = captureIncomingOperation(active, draft);
    if (!incomingOperationIsCurrent(captured)) return true;
    let evidence;
    try {
      evidence = incomingReceiptEvidence(
        getState(), draft.pendingOperationId, draft.pendingNormalizedRequest,
      );
    } catch (error) {
      if (!incomingOperationIsCurrent(captured)) return true;
      draft.error = error instanceof Error ? error.message : String(error);
      if (incomingOperationIsCurrent(captured)) render();
      return true;
    }
    if (!incomingOperationIsCurrent(captured)) return true;
    if (evidence.status !== "applied") {
      draft.stage = "verification";
      draft.error = evidence.reason ?? "Не удалось подтвердить receipt применённой операции.";
      if (incomingOperationIsCurrent(captured)) render();
      return true;
    }
    draft.appliedReceipt = evidence.receipt;
    active.submitting = true;
    try {
      const saved = retryPersistedState();
      if (!incomingOperationIsCurrent(captured)) return true;
      if (!saved.ok) {
        draft.error = saved.reason ?? "Не удалось сохранить результат.";
      } else {
        if (!incomingOperationIsCurrent(captured)) return true;
        const savedEvidence = incomingReceiptEvidence(
          getState(), draft.pendingOperationId, draft.pendingNormalizedRequest,
        );
        if (!incomingOperationIsCurrent(captured)) return true;
        if (savedEvidence.status !== "applied") {
          active.appliedUnsaved = false;
          draft.stage = "verification";
          draft.error = savedEvidence.reason ??
            "Сохранение выполнено, но применение не подтверждено.";
        } else {
          draft.appliedReceipt = savedEvidence.receipt;
          active.appliedUnsaved = false;
          draft.stage = "result";
          active.status = "Сохранение выполнено.";
        }
      }
    } catch (error) {
      if (!incomingOperationIsCurrent(captured)) return true;
      draft.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (incomingOperationIsCurrent(captured)) active.submitting = false;
    }
    if (incomingOperationIsCurrent(captured)) render();
    return true;
  }
  if (action === "incoming-verify") {
    const captured = captureIncomingOperation(active, draft);
    if (!incomingOperationIsCurrent(captured)) return true;
    try {
      const evidence = draft.pendingOperationId && draft.pendingNormalizedRequest
        ? incomingReceiptEvidence(
          getState(), draft.pendingOperationId, draft.pendingNormalizedRequest,
        )
        : { status: "unknown", reason: "Нет сохранённого запроса для проверки." };
      if (!incomingOperationIsCurrent(captured)) return true;
      if (evidence.status === "applied") {
        draft.appliedReceipt = evidence.receipt;
        draft.stage = "save-recovery";
        active.appliedUnsaved = true;
        active.submitting = true;
        try {
          const saved = retryPersistedState();
          if (!incomingOperationIsCurrent(captured)) return true;
          if (saved.ok) {
            const savedEvidence = incomingReceiptEvidence(
              getState(), draft.pendingOperationId, draft.pendingNormalizedRequest,
            );
            if (!incomingOperationIsCurrent(captured)) return true;
            if (savedEvidence.status === "applied") {
              draft.appliedReceipt = savedEvidence.receipt;
              active.appliedUnsaved = false;
              draft.stage = "result";
            } else {
              active.appliedUnsaved = false;
              draft.stage = "verification";
              draft.error = savedEvidence.reason ??
                "Сохранение выполнено, но применение не подтверждено.";
            }
          } else {
            draft.error = saved.reason ?? "Не удалось сохранить результат.";
          }
        } finally {
          if (incomingOperationIsCurrent(captured)) active.submitting = false;
        }
      } else {
        draft.stage = "verification";
        draft.error = evidence.reason ?? "Receipt отсутствует; исход операции неизвестен.";
      }
    } catch (error) {
      if (!incomingOperationIsCurrent(captured)) return true;
      draft.error = error instanceof Error ? error.message : String(error);
    }
    if (incomingOperationIsCurrent(captured)) render();
    return true;
  }
  if (action === "incoming-save-success" || action === "incoming-save-failure") {
    draft.outcome = action === "incoming-save-success" ? "success" : "failure";
    draft.rollDraft.hasDamage = false;
    draft.stage = "save-consequence";
  } else if (action === "incoming-save-unknown") {
    draft.outcome = "unknown";
    draft.rollDraft.hasDamage = false;
    draft.stage = "save-consequence";
  } else if (action === "incoming-set-has-damage") {
    draft.rollDraft.hasDamage = true;
  } else if (action === "incoming-set-no-damage") {
    draft.rollDraft.hasDamage = false;
  }
  else if (action === "incoming-hit") draft.stage = "source";
  else if (action === "incoming-miss") {
    draft.outcome = "miss";
    draft.stage = "miss-response";
  } else   if (action === "incoming-finish-miss") {
    finishCurrentSession({ validateBattleContext: true });
    return true;
  } else if (action === "incoming-ebb-save") {
    const liveOwner = getSessionContext();
    if (!isCurrentSession(active.owner) ||
        liveOwner.characterId !== active.owner.characterId ||
        liveOwner.sessionGeneration !== active.owner.sessionGeneration ||
        !incomingContextIsCurrent(draft, state, liveOwner)) {
      draft.stage = "expired";
      draft.error = "Контекст боя изменился.";
    } else {
      const request = {
        kind: "ebb-and-flow",
        mode: "dexterity-save",
        triggerConfirmed: true,
        battleId: draft.battleId,
        eventId: draft.eventId,
        phaseAtOpen: draft.phaseAtOpen,
        ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
      };
      return commitIncomingRequest(active, draft, request, draft.operationIds.reply, "miss-response");
    }
  } else if (action.startsWith("incoming-source-")) {
    const source = action.slice("incoming-source-".length);
    if (!["melee", "projectile", "spell"].includes(source)) return true;
    draft.source = source;
    draft.stage = source === "spell" ? "spell-choice" : "damage";
  } else if (action === "incoming-spell-damage") {
    draft.source = "spell";
    draft.stage = "damage";
  } else if (action === "incoming-spell-save") {
    draft.source = "spell";
    draft.rollDraft = {
      ...draft.rollDraft,
      kind: "saving-throw",
      ability: draft.rollDraft.ability ?? "dexterity",
      rollMode: draft.rollDraft.rollMode ?? "advantage",
      firstD20: draft.rollDraft.firstD20 ?? "",
    };
    draft.stage = "save-input";
  } else if (action === "incoming-open-deflect") {
    draft.stage = "deflect";
  } else if (action === "incoming-catch") {
    draft.catchChoice = "catch";
  } else if (action === "incoming-skip-catch") {
    draft.catchChoice = "skip";
  } else if (action === "incoming-apply-damage" ||
      action === "incoming-apply-deflection" || action === "incoming-apply-save") {
    if (active.submitting) return true;
    const liveOwner = getSessionContext();
    if (!isCurrentSession(active.owner) ||
        liveOwner.characterId !== active.owner.characterId ||
        liveOwner.sessionGeneration !== active.owner.sessionGeneration ||
        !incomingContextIsCurrent(draft, state, liveOwner)) {
      draft.stage = "expired";
      draft.error = "Контекст боя или владельца изменился.";
      render();
      return true;
    }
    const operationId = action === "incoming-apply-save"
      ? draft.operationIds.save : draft.operationIds.apply;
    const returnStage = draft.stage;
    const request = action === "incoming-apply-save"
      ? {
        kind: "completed-save",
        battleId: draft.battleId,
        eventId: draft.eventId,
        phaseAtOpen: draft.phaseAtOpen,
        ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
        outcome: draft.outcome,
        hasDamage: draft.outcome !== "unknown" && draft.rollDraft.hasDamage === true,
        damage: draft.rollDraft.damage,
        damageBasis: draft.rollDraft.damageBasis ?? "dm-final",
        effectProfile: draft.rollDraft.effectProfile,
        spellSaveSource: draft.source === "spell",
        roll: {
          id: draft.rollDraft.ability,
          firstD20: draft.rollDraft.firstD20,
          secondD20: draft.rollDraft.secondD20,
          rollMode: draft.rollDraft.rollMode,
          dc: draft.rollDraft.dc,
        },
      }
      : action === "incoming-apply-damage" ? {
        kind: "direct-damage", damage: draft.rawDamage,
        battleId: draft.battleId, eventId: draft.eventId,
        phaseAtOpen: draft.phaseAtOpen, ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
      }
      : {
        kind: "deflection", damage: draft.rawDamage,
        deflectRoll: draft.rawDeflectRoll, source: draft.source,
        catchChoice: draft.catchChoice, battleId: draft.battleId,
        eventId: draft.eventId, phaseAtOpen: draft.phaseAtOpen,
        ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
      };
    return commitIncomingRequest(active, draft, request, operationId, returnStage);
  }
  render();
  return true;
}

function clearAttackInputFeedback({ hideNaturalException = false } = {}) {
  const root = getWorkspaceHost();
  const error = root?.querySelector(".workspace-error");
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
  if (hideNaturalException) {
    const exception = root?.querySelector("[data-natural-exception]");
    if (exception) exception.hidden = true;
  }
}

function updateInput(field) {
  if (!session || session.submitting) return;
  if (session.workspaceType === "incoming") {
    const draft = session.incomingDraft;
    if (field.name === "incomingDamage") draft.rawDamage = field.value;
    else if (field.name === "deflectRoll") draft.rawDeflectRoll = field.value;
    else if (field.name === "saveDamage") draft.rollDraft.damage = field.value;
    else if (["saveAbility", "firstD20", "secondD20", "rollMode", "dc",
      "saveDamage", "damageBasis", "effectProfile"].includes(field.name)) {
      draft.rollDraft[field.name] = field.type === "checkbox" ? field.checked : field.value;
      if (field.name === "saveAbility") draft.rollDraft.ability = field.value;
    }
    session.dirty = true;
    const structural = ["rollMode", "damageBasis", "effectProfile", "saveAbility"].includes(field.name);
    if (structural) {
      draft.error = "";
      const fieldName = field.name;
      render();
      const control = getWorkspaceHost()?.querySelector(
        `[data-workspace-field][name="${fieldName}"]`,
      );
      if (control?.isConnected) control.focus({ preventScroll: true });
      else focusWorkspaceHeading();
      return;
    }
    draft.error = "";
    const preview = getWorkspaceHost()?.querySelector("[data-incoming-preview]");
    if (preview) preview.innerHTML = renderIncomingPreview(session, getState());
    syncIncomingPreviewFingerprint(draft, getState());
    const catchControls = getWorkspaceHost()?.querySelector("[data-incoming-catch-controls]");
    if (catchControls) catchControls.innerHTML = renderIncomingCatchControls(session, getState());
    return;
  }
  const draft = getStepDraft();
  const previousValue = draft[field.name];
  draft[field.name] = field.type === "checkbox" ? field.checked : field.value;
  if (session.currentStep === "strike-input" &&
      ((field.name === "techniqueId" && previousValue !== field.value) ||
       (field.name === "paymentMode" && previousValue !== field.value))) {
    draft.paymentMode = field.name === "techniqueId" ? "ki" : field.value;
    draft.effect = "";
    draft.practicedConditions = false;
  }
  if (session.currentStep === "attack-input" &&
      ["firstD20", "secondD20", "rollMode", "profileId"].includes(field.name)) {
    session.naturalExceptionOutcome = null;
    draft.dmExceptionConfirmed = false;
    clearAttackInputFeedback({ hideNaturalException: true });
  } else if (session.currentStep === "attack-input") {
    clearAttackInputFeedback();
  }
  if (session.workspaceType === "command" && field.name === "kind") {
    draft.id = "strength";
  } else if (session.workspaceType === "command" &&
      field.name === "spellSaveSource" && field.checked) {
    draft.kind = "saving-throw";
    draft.rollMode = "advantage";
  }
  session.dirty = true;
  session.error = "";
  const liveError = getWorkspaceHost()?.querySelector("[data-workspace-error]");
  if (liveError) {
    liveError.textContent = "";
    liveError.hidden = true;
  }
  if (field.name === "rollMode") {
    const secondRoll = getWorkspaceHost()?.querySelector("[data-workspace-second-d20]");
    const secondInput = secondRoll?.querySelector('input[name="secondD20"]');
    const needsSecond = field.value === "advantage" || field.value === "disadvantage";
    if (secondRoll) secondRoll.hidden = !needsSecond;
    if (secondInput) secondInput.required = needsSecond;
  }
  if (session.workspaceType === "command" && session.currentStep === "roll-result" &&
      field.name === "damageBasis") {
    session.forceWorkspaceBodyRender = true;
    render();
    getWorkspaceHost()?.querySelector('[data-workspace-field="damageBasis"]')
      ?.focus({ preventScroll: true });
    return;
  }
  if (session.currentStep === "attack-input") {
    renderWorkspaceAttackPreview(session, getState());
  } else if (session.currentStep === "seeking-input" && field.name === "rollMode") {
    render();
  } else if (session.currentStep === "damage-input") {
    renderWorkspaceDamagePreview(session);
  } else if (session.workspaceType === "command" &&
      session.scenarioId === "character-roll" && session.currentStep === "command-input" &&
      ["kind", "spellSaveSource"].includes(field.name)) {
    render();
  } else if (session.workspaceType === "command" &&
      session.scenarioId === "character-roll" && session.currentStep === "command-input") {
    renderWorkspaceRollPreview(session, getState());
  } else if (session.workspaceType === "command" && session.currentStep === "roll-result") {
    renderWorkspaceConsequencePreview(session, getState());
  } else if (session.currentStep === "strike-input" &&
      ["techniqueId", "paymentMode"].includes(field.name)) {
    render();
  } else if (session.workspaceType === "command" &&
      ["kind", "spellSaveSource"].includes(field.name)) {
    render();
  } else if (session.workspaceType === "command" &&
      session.scenarioId?.startsWith("potion-use:")) {
    renderWorkspacePotionPreview(session, getState());
  } else if (session.workspaceType === "command" &&
      session.command?.restStage === "edit" && field.name === "add") {
    updateRestReplacementSubchoices(session, getState(), { refreshFields: true });
  } else if (session.workspaceType === "command" &&
      session.command?.restStage === "edit" && field.name === "cantrip1") {
    updateRestReplacementSubchoices(session, getState());
  } else if (session.workspaceType === "command" &&
      session.command?.restStage === "hit-die" && field.name === "roll") {
    renderWorkspaceHitDiePreview(session, getState());
  }
}

function findSequenceAndDamage(state, options = {}) {
  const pendingSeekingTasks = (state.monk?.combatAssistant?.activeSequences ?? [])
    .flatMap((sequence) => (sequence.resolvedAttacks ?? [])
      .flatMap((attack) => {
        if (attack.seekingAmendments === undefined &&
            attack.seekingAmendment == null) return [];
        try {
          const amendment = pendingSeeking(
            readSeekingHistory(attack, { actionId: sequence.id, attackId: attack.id }),
          );
          return amendment ? [{ sequence, attack, seeking: true, amendment }] : [];
        } catch {
          return [{ sequence, attack, seekingConflict: true }];
        }
      }));
  const explicitSequence = options.sequenceId
    ? getWorkspaceAttackSequence(state, options.sequenceId) : null;
  if (options.sequenceId && !explicitSequence) return { error: "Последовательность атаки не найдена." };
  if (options.attackId) {
    const seeking = pendingSeekingTasks.find((entry) => entry.sequence.id === options.sequenceId &&
      entry.attack.id === options.attackId);
    if (seeking?.seekingConflict) {
      return { error: "История Seeking Strike противоречива. Запись сохранена; новое применение заблокировано." };
    }
    if (seeking) return seeking;
    const pending = findAwaitingWorkspaceDamage(state, {
      sequenceId: options.sequenceId ?? null,
      attackId: options.attackId,
    });
    if (!pending) return { error: "Выбранный удар больше не ожидает записи урона." };
    return {
      sequence: pending.sequence,
      attack: pending.attack,
      historical: !sequenceCurrentForAttack(pending.sequence, state, pending.sequence.kind),
    };
  }
  if (explicitSequence) {
    const seeking = pendingSeekingTasks.find((entry) => entry.sequence.id === explicitSequence.id);
    if (seeking?.seekingConflict) {
      return { error: "История Seeking Strike противоречива. Запись сохранена; новое применение заблокировано." };
    }
    if (seeking) return seeking;
    const pending = findAwaitingWorkspaceDamage(state, { sequenceId: explicitSequence.id });
    if (pending) {
      return {
        ...pending,
        historical: !sequenceCurrentForAttack(explicitSequence, state, explicitSequence.kind),
      };
    }
    if (pendingSeekingTasks.length) {
      return { error: "Укажите точную последовательность и удар для незавершённого Seeking Strike." };
    }
    return { sequence: explicitSequence };
  }
  const openSequence = (state.monk?.combatAssistant?.activeSequences ?? []).find((entry) =>
    entry.kind === "attack-action" && entry.status === "open");
  if (openSequence) {
    const pending = findAwaitingNormalDamage(state, { sequenceId: openSequence.id });
    return pending
      ? { ...pending, historical: !sequenceCurrentForAttack(openSequence, state) }
      : { sequence: openSequence };
  }
  const pending = findAwaitingNormalDamage(state);
  return pending ? { ...pending, historical: true } : {};
}

function canOpenNewSequence(state) {
  const battle = state.battleConsole?.current;
  return !battle || battle.phase === "own-turn";
}

export function openNormalAttack({ sequenceId = null, attackId = null, mode = "current", invoker = null } = {}) {
  const state = getState();
  const owner = getWorkspaceAttackContext();
  if (state.profile?.id !== "sara-velaris") return { ok: false, reason: "Эта атака доступна только в листе Сары." };
  if (!["current", "historical-damage"].includes(mode)) {
    return { ok: false, reason: "Неизвестный режим рабочей панели атаки." };
  }
  if (!isWorkspaceOwnerCurrent(owner)) {
    return { ok: false, reason: "Сеанс персонажа изменился. Рабочая панель не открыта." };
  }
  const explicitTarget = Boolean(sequenceId || attackId);
  const selected = findSequenceAndDamage(state, { sequenceId, attackId });
  if (selected.error) return { ok: false, reason: selected.error };
  const selectedSequence = selected.sequence ?? null;
  if (attackId && selected.attack?.id !== attackId) {
    return { ok: false, reason: "Удар не относится к выбранной последовательности." };
  }
  const historicalOnly = mode === "historical-damage";
  const historical = historicalOnly || selected.historical === true;
  if (!selectedSequence && !canOpenNewSequence(state)) {
    return { ok: false, reason: "Обычную атаку можно начать только в свой ход." };
  }
  if (historicalOnly && !selected.attack) {
    return { ok: false, reason: "Для исторического восстановления выберите удар, ожидающий записи урона." };
  }
  const currentOwnerSession = session &&
    session.owner.characterId === owner.characterId &&
    session.owner.sessionGeneration === owner.sessionGeneration &&
    session.owner.appInstanceId === appInstanceId;
  if (session && !currentOwnerSession) {
    return { ok: false, reason: "Рабочая панель относится к другому сеансу персонажа." };
  }
  if (currentOwnerSession && session.workspaceType === "attack") {
    if (!explicitTarget) {
      const currentSequence = getSequence(state);
      const sameLiveTurnDraft = !session.isExistingSequence &&
        session.currentStep === "attack-input" && !session.readOnly &&
        session.turnMarker === Number(state.ui?.turn?.turnNumber ?? 1) &&
        session.battleContext.battleId === (state.battleConsole?.current?.id ?? null) &&
        session.battleContext.ownTurnId === (state.battleConsole?.current?.ownTurnId ?? null) &&
        canOpenNewSequence(state);
      if (sameLiveTurnDraft || sequenceCurrentForAttack(currentSequence, state)) {
        return resumeWorkspace(session.workspaceSessionId);
      }
      if (session.dirty) {
        return { ok: false, reason: "Старый ввод сохранён отдельно. Продолжите его или закройте перед новой атакой." };
      }
      if (!suspendCurrentSession()) {
        return { ok: false, reason: "Сначала завершите сохранение текущего результата." };
      }
    }
    else {
      const sameSequence = selectedSequence?.id === session.sequenceId;
      const sameAttack = selected.attack
        ? selected.attack.id === session.attackId
        : sameSequence && !session.selectedDamage;
      if (sameSequence && sameAttack && session.historicalOnly === historicalOnly) {
        return resumeWorkspace(session.workspaceSessionId);
      }
    }
  }
  if (session && currentOwnerSession && session.dirty) {
    return { ok: false, reason: "Сначала завершите или сверните незаписанный ввод текущего удара." };
  }
  if (session && !suspendCurrentSession()) {
    return { ok: false, reason: "Сначала завершите сохранение текущего результата." };
  }
  if (!initWorkspaceHost({ onAction: handleAction, onInput: updateInput, onSubmit: handleSubmit })) {
    return { ok: false, reason: "Рабочая панель не смонтирована." };
  }
  const selectedAttack = selected.attack ?? null;
  const nextAttack = getUsedAttackSlots(selectedSequence);
  const attackIdForDraft = selectedAttack?.id ??
    selectedSequence?.resolvedAttacks?.[nextAttack]?.id ?? createId("sara-attack");
  const firstAttempt = !selectedSequence;
  const sequenceKind = selectedSequence?.kind ?? "attack-action";
  const available = !selectedSequence ||
    sequenceCurrentForAttack(selectedSequence, state, sequenceKind);
  session = {
    workspaceSessionId: createId("attack-workspace"),
    workspaceType: "attack",
    owner: { ...owner, appInstanceId },
    battleContext: {
      battleId: state.battleConsole?.current?.id ?? null,
      ownTurnId: state.battleConsole?.current?.ownTurnId ?? null,
    },
    turnMarker: Number(state.ui?.turn?.turnNumber ?? 1),
    sequenceId: selectedSequence?.id ?? createId("sara-normal-attack"),
    sequenceKind,
    command: selectedSequence ? getCommandDescriptor(state, sequenceKind) : null,
    attackId: attackIdForDraft,
    seekingTask: selected.seeking ? {
      actionId: selectedSequence.id,
      attackId: selectedAttack.id,
      amendmentId: selected.amendment.paidOperationId,
    } : null,
    seekingOriginalRollMode: selected.seeking
      ? selected.amendment.original.rollMode : null,
    currentStep: selected.seeking ? "seeking-input" : selectedAttack ? "damage-input"
      : !historical && (!selectedSequence || available &&
        selectedSequence.status === "open" && nextAttack < selectedSequence.maximumAttacks)
        ? "attack-input" : "summary",
    currentStepKey: "",
    rawInputsByStep: {},
    operationIdsByIntent: {},
    relevantPreviewFingerprint: "",
    naturalExceptionOutcome: null,
    strikeParent: selectedAttack ? {
      sequenceId: selectedSequence.id,
      attackId: selectedAttack.id,
    } : null,
    dirty: false,
    submitting: false,
    minimized: false,
    deferredReconcile: false,
    appliedUnsaved: false,
    internalScrollByStep: {},
    returnTarget: null,
    mode: historical ? "historical-damage" : "current",
    historicalOnly,
    capabilities: {
      canRecordAttack: !historical && (!selectedSequence ||
        available && selectedSequence.status === "open" &&
        nextAttack < selectedSequence.maximumAttacks),
      canRecordDamage: Boolean(selectedAttack &&
        selectedAttack.damageStatus === "awaiting-damage"),
      canContinueSequence: !historicalOnly && Boolean(selectedSequence &&
        available && selectedSequence.status === "open" &&
        nextAttack < selectedSequence.maximumAttacks),
    },
    readOnly: historical || !available && !selected.seeking,
    isExistingSequence: Boolean(selectedSequence),
    firstAttempt,
    confirmationRequired: false,
    error: "",
    status: historicalOnly ? "Историческое восстановление: можно записать только ожидающий урон."
      : !available ? "Ход завершён. Оставшиеся атаки нельзя продолжить; сохранённые результаты доступны для просмотра." : "",
    selectedDamage: selectedAttack ? { sequence: selectedSequence, attack: selectedAttack } : null,
  };
  session.currentStepKey = selected.seeking
    ? stepKey("seeking-input", `${selectedAttack.id}:${selected.amendment.paidOperationId}`)
    : stepKey(session.currentStep, session.attackId);
  session.stepLabel = ({
    "attack-input": "Физический бросок · проверка попадания",
    "damage-input": "Физические кости урона",
    "seeking-input": "Seeking Strike · физический повторный бросок",
    "gentling-input": "Gentling Touch · замена слота Attack",
    checkpoint: "Результат записан · выберите продолжение",
    "strike-input": "Необязательная техника после записанного урона",
    summary: "Записанные удары и оставшиеся задачи",
  })[session.currentStep] ?? "Действие «Атака»";
  session.rawInputsByStep[session.currentStepKey] ??= {};
  session.relevantPreviewFingerprint = getNormalAttackFingerprint(state, session.sequenceId, firstAttempt);
  if (invoker) {
    invoker.dataset.workspaceInvoker = "normal-attack";
    session.returnTarget = { key: "normal-attack", top: invoker.getBoundingClientRect?.().top ?? null };
  }
  render();
  if (!openWorkspaceHost(invoker)) {
    session = null;
    return { ok: false, reason: "Не удалось открыть рабочую панель." };
  }
  return { ok: true, sessionId: session.workspaceSessionId };
}

export function openIncomingAttack(invoker = null, options = {}) {
  const state = getState();
  const owner = getSessionContext();
  if (state.profile?.id !== "sara-velaris" || !isWorkspaceOwnerCurrent(owner)) {
    return { ok: false, reason: "Входящее событие доступно только в активном сеансе Сары." };
  }
  const battle = state.battleConsole?.current ?? null;
  if (battle && !["waiting", "own-turn"].includes(battle.phase)) {
    return { ok: false, reason: "Входящее событие недоступно в этой фазе боя." };
  }
  const allowed = {
    source: ["melee", "projectile", "spell"].includes(options.source) ? options.source : null,
    mode: options.mode === "direct-damage" ? "direct-damage" : null,
  };
  if (session?.appliedUnsaved) {
    return { ok: false, reason: "Сначала повторите сохранение уже применённого результата." };
  }
  if (session && !suspendCurrentSession()) {
    return { ok: false, reason: "Сначала завершите сохранение текущего результата." };
  }
  if (!initWorkspaceHost({ onAction: handleAction, onInput: updateInput, onSubmit: handleSubmit })) {
    restoreParentSession();
    return { ok: false, reason: "Рабочая панель не смонтирована." };
  }
  const draft = createIncomingEventDraft(state, owner, allowed);
  if (allowed.source) draft.stage = "damage";
  session = {
    workspaceSessionId: createId("incoming-event"),
    workspaceType: "incoming",
    owner: { ...owner, appInstanceId },
    incomingDraft: draft,
    currentStep: "incoming",
    currentStepKey: `incoming:${draft.eventId}`,
    rawInputsByStep: {},
    operationIdsByIntent: {},
    dirty: false,
    submitting: false,
    minimized: false,
    appliedUnsaved: false,
    internalScrollByStep: {},
    returnTarget: invoker ? { key: "incoming-event" } : null,
  };
  render();
  if (!openWorkspaceHost(invoker)) {
    session = null;
    restoreParentSession();
    return { ok: false, reason: "Не удалось открыть входящее событие." };
  }
  return { ok: true, sessionId: session.workspaceSessionId };
}

export function openSaraBattleCommand(commandId, invoker = null, options = {}) {
  if (commandId === "deflect-strike" || commandId === "deflect-missile") {
    return openIncomingAttack(invoker, {
      source: commandId === "deflect-missile" ? "projectile" : "melee",
    });
  }
  if (commandId === "incoming-damage") {
    return openIncomingAttack(invoker, { mode: "direct-damage" });
  }
  if (commandId === "normal-attack") {
    return openNormalAttack({ sequenceId: options.sequenceId ?? null, invoker });
  }
  const state = getState();
  const owner = getWorkspaceAttackContext();
  const command = getCommandDescriptor(state, commandId);
  const pendingRollRecord = commandId.startsWith("pending-roll:")
    ? state.characterRolls?.records?.find((entry) =>
      entry.id === commandId.slice("pending-roll:".length)) ?? null
    : null;
  if (!command) return { ok: false, reason: "Неизвестная команда боевого пульта." };
  if (commandId === "character-roll" && options.rollPreset != null) {
    const preset = options.rollPreset;
    if (!getSaraRollBreakdown(
      state,
      preset.kind ?? "ability-check",
      preset.id ?? "strength",
    ).ok) {
      return { ok: false, reason: "Выбранный шаблон проверки недоступен." };
    }
  }
  if (!command.availability.enabled) {
    return { ok: false, reason: command.availability.reasonRu || "Команда сейчас недоступна." };
  }
  if (!isWorkspaceOwnerCurrent(owner)) {
    return { ok: false, reason: "Сеанс персонажа изменился. Команда не открыта." };
  }
  const sameOwner = session &&
    session.owner.characterId === owner.characterId &&
    session.owner.sessionGeneration === owner.sessionGeneration &&
    session.owner.appInstanceId === appInstanceId;
  if (session && !sameOwner) {
    return { ok: false, reason: "Рабочая панель относится к другому сеансу персонажа." };
  }
  if (sameOwner) {
    if (session.workspaceType === "command" && session.scenarioId === commandId) {
      if (commandId === "character-roll" && options.rollPreset != null) {
        const preset = options.rollPreset;
        const existing = session.rawInputsByStep?.[session.currentStepKey] ?? {};
        const kind = preset.kind ?? "ability-check";
        const id = preset.id ?? "strength";
        if (!getSaraRollBreakdown(state, kind, id).ok) {
          return { ok: false, reason: "Выбранный шаблон проверки недоступен." };
        }
        if (existing.kind !== kind || existing.id !== id) {
          return { ok: false, reason: "Уже открыт другой черновик проверки. Он сохранён; возобновите его или закройте перед сменой шаблона." };
        }
      }
      return resumeWorkspace(session.workspaceSessionId);
    }
    if (!suspendCurrentSession()) {
      return { ok: false, reason: "Сначала завершите сохранение текущего результата." };
    }
  }
  if (!initWorkspaceHost({ onAction: handleAction, onInput: updateInput, onSubmit: handleSubmit })) {
    return { ok: false, reason: "Рабочая панель не смонтирована." };
  }
  session = {
    workspaceSessionId: createId("battle-command"),
    workspaceType: "command",
    scenarioId: commandId,
    command,
    owner: { ...owner, appInstanceId },
    battleContext: {
      battleId: state.battleConsole?.current?.id ?? null,
      ownTurnId: state.battleConsole?.current?.ownTurnId ?? null,
    },
    turnMarker: Number(state.ui?.turn?.turnNumber ?? 1),
    sequenceId: createId(`sara-${commandId}`),
    sequenceKind: commandId,
    attackId: createId("sara-attack"),
    currentStep: pendingRollRecord ? "roll-result" : "command-input",
    currentStepKey: stepKey(pendingRollRecord ? "roll-result" : "command-input", commandId),
    rawInputsByStep: {},
    operationIdsByIntent: {},
    relevantPreviewFingerprint: "",
    dirty: false,
    submitting: false,
    minimized: false,
    deferredReconcile: false,
    appliedUnsaved: false,
    internalScrollByStep: {},
    returnTarget: null,
    expectedConcentration: String(state.combat?.concentration ?? ""),
    rollRecord: pendingRollRecord,
    resultMessage: pendingRollRecord ? `${pendingRollRecord.label}: итог ${pendingRollRecord.total}.` : "",
    capabilities: {
      canRecordAttack: false,
      canRecordDamage: false,
      canContinueSequence: false,
    },
    stepLabel: "Подтверждение условий и запись результата",
    error: "",
    status: "",
  };
  if (commandId === "character-roll") {
    const preset = options.rollPreset ?? {};
    session.rawInputsByStep[session.currentStepKey] = {
      kind: preset.kind ?? "ability-check",
      id: preset.id ?? "strength",
      rollMode: "normal",
      firstD20: "",
      secondD20: "",
      spellSaveSource: false,
      advantageReason: "",
      disadvantageReason: "",
      timingConfirmed: false,
    };
  }
  if (commandId === "completed-rest" &&
      ["short", "long"].includes(options.restKind)) {
    session.rawInputsByStep[session.currentStepKey] = { kind: options.restKind };
  }
  if (commandId.startsWith("potion-use:")) {
    session.rawInputsByStep[session.currentStepKey] = { target: "self" };
  }
  if (invoker) {
    invoker.dataset.workspaceInvoker = `battle-command-${commandId}`;
    session.returnTarget = {
      key: `battle-command-${commandId}`,
      top: invoker.getBoundingClientRect?.().top ?? null,
    };
  }
  render();
  if (!openWorkspaceHost(invoker)) {
    session = null;
    return { ok: false, reason: "Не удалось открыть рабочую панель." };
  }
  return { ok: true, sessionId: session.workspaceSessionId };
}

export function openSaraTechniqueApplication(techniqueId, invoker = null) {
  const commandId = `monk-technique:${techniqueId}`;
  if (invoker) invoker.dataset.workspaceInvoker = `technique-use:${techniqueId}`;
  return openSaraBattleCommand(commandId, invoker);
}

export function minimizeWorkspace() {
  if (!session) return false;
  const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (body) session.internalScrollByStep[session.currentStepKey] = body.scrollTop;
  session.minimized = true;
  minimizeWorkspaceHost();
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
  return true;
}

export function prepareWorkspaceTabTransition(fromTab, toTab) {
  if (fromTab === "melee" && toTab !== "melee" &&
      workspaceHostIsEmbedded() && workspaceHostIsOpen()) {
    minimizeWorkspace();
  }
}

export function requestCloseWorkspace() {
  if (!session) return false;
  const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (body) session.internalScrollByStep[session.currentStepKey] = body.scrollTop;
  session.returnStep = session.currentStep;
  session.returnStepKey = session.currentStepKey;
  setStep("confirm-close", session.attackId);
  return true;
}

export function resumeWorkspace(workspaceSessionId) {
  const target = session?.workspaceSessionId === workspaceSessionId
    ? session
    : suspendedSessions.find((entry) => entry.workspaceSessionId === workspaceSessionId);
  if (!target || !isWorkspaceOwnerCurrent(target.owner) ||
      target.owner.appInstanceId !== appInstanceId) {
    return { ok: false, reason: "Рабочая панель относится к другому сеансу персонажа." };
  }
  if (target !== session) {
    if (session && !suspendCurrentSession()) {
      return { ok: false, reason: "Сначала завершите сохранение текущего результата." };
    }
    const index = suspendedSessions.indexOf(target);
    if (index >= 0) suspendedSessions.splice(index, 1);
    session = target;
  }
  session.suspended = false;
  session.minimized = false;
  const state = getState();
  if (session.workspaceType === "attack") rehydrateFromState(state);
  render();
  if (!openWorkspaceHost(findInvoker(session.returnTarget?.key))) {
    return { ok: false, reason: "Не удалось возобновить рабочую панель." };
  }
  session.minimized = false;
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
  const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (body) body.scrollTop = session.internalScrollByStep[session.currentStepKey] ?? 0;
  return { ok: true, sessionId: session.workspaceSessionId };
}

function findInvoker(key) {
  return [...document.querySelectorAll("[data-workspace-invoker]")]
    .find((node) => node.dataset.workspaceInvoker === key && node.isConnected) ?? null;
}

function rehydrateFromState(state) {
  if (!session) return;
  if (session.currentStep === "gentling-input") {
    const intent = session.gentlingIntent;
    const sequence = state.monk?.combatAssistant?.activeSequences
      ?.find((entry) => entry.id === intent?.actionId);
    const battle = state.battleConsole?.current ?? null;
    const validTurn = sequence && (battle
      ? battle.id === intent.battleContext?.battleId &&
        battle.ownTurnId === intent.battleContext?.ownTurnId &&
        battle.phase === "own-turn"
      : !sequence.battleId && intent.battleContext?.battleId == null);
    const slots = sequence ? getUsedAttackSlots(sequence) : -1;
    const valid = intent && intent.actionId === session.sequenceId &&
      sequence?.kind === "attack-action" && sequence.status === "open" &&
      validTurn && Number(sequence.turnMarker) ===
        Number(state.ui?.turn?.turnNumber ?? 1) &&
      intent.slotNumber === slots + 1 &&
      slots < sequence.maximumAttacks;
    if (!valid) {
      session.readOnly = true;
      session.error = "Контекст Gentling Touch истёк или изменился. Ввод сохранён для проверки; применение недоступно.";
      return;
    }
    session.readOnly = false;
    session.currentStepKey = intent.draftKey;
    session.rawInputsByStep[intent.draftKey] ??= {
      extraKi: "0", targetHp: "", sum: "",
    };
    const ki = Number(state.combat?.ki?.current ?? 0);
    session.error = ki < 1
      ? "Недостаточно ци; ввод сохранён и станет доступен после восстановления ресурса."
      : "";
    return;
  }
  if (session.currentStep === "attack-input") {
    const battle = state.battleConsole?.current ?? null;
    const contextExpired = session.turnMarker !== Number(state.ui?.turn?.turnNumber ?? 1) ||
      session.battleContext.battleId !== (battle?.id ?? null) ||
      session.battleContext.ownTurnId !== (battle?.ownTurnId ?? null);
    if (contextExpired) {
      session.readOnly = true;
      session.capabilities.canRecordAttack = false;
      session.capabilities.canContinueSequence = false;
      session.status = "Ход завершён. Старый ввод сохранён для просмотра и не может стать новой атакой.";
      session.error = session.status;
      return;
    }
  }
  const sequence = getSequence(state);
  if (!sequence) {
    if (!session.isExistingSequence && session.currentStep === "attack-input") {
      const currentFingerprint = getRelevantFingerprint(state, session.sequenceId, true);
      if (currentFingerprint !== session.relevantPreviewFingerprint) {
        session.confirmationRequired = true;
        session.relevantPreviewFingerprint = currentFingerprint;
      }
      session.rawInputsByStep[session.currentStepKey] ??= {};
      if (!canOpenNewSequence(state)) {
        session.readOnly = true;
        session.capabilities.canRecordAttack = false;
        session.capabilities.canContinueSequence = false;
        session.error = "Боевой контекст изменился. Введённые кости сохранены, но новый удар не начат.";
      }
      return;
    }
    session.readOnly = true;
    session.error = "Последовательность больше не найдена; новая атака не создаётся автоматически.";
    session.currentStep = "summary";
    session.currentStepKey = stepKey("summary", session.attackId);
    return;
  }
  const targetAttack = sequence.resolvedAttacks.find((entry) => entry.id === session.attackId);
  if (session.currentStep === "seeking-input") {
    let amendment = null;
    try {
      const history = readSeekingHistory(targetAttack, {
        actionId: sequence.id,
        attackId: targetAttack?.id,
      });
      amendment = history.find((entry) =>
        entry.paidOperationId === session.seekingTask?.amendmentId) ??
        (!session.seekingTask ? pendingSeeking(history) : null);
    } catch {
      session.readOnly = true;
      session.error = "История Seeking Strike противоречива. Запись сохранена; новое применение заблокировано.";
      return;
    }
    if (amendment?.status !== "awaiting-replacement") {
      session.readOnly = true;
      session.error = "Оплаченная замена уже разрешена или недоступна.";
      return;
    }
    session.seekingTask ??= {
      actionId: sequence.id,
      attackId: targetAttack.id,
      amendmentId: amendment.paidOperationId,
    };
    session.readOnly = false;
    session.selectedDamage = null;
    session.currentStepKey = stepKey("seeking-input",
      `${targetAttack.id}:${amendment.paidOperationId}`);
    session.rawInputsByStep[session.currentStepKey] ??= {};
    return;
  }
  if (targetAttack?.damageStatus === "awaiting-damage") {
    session.selectedDamage = { sequence, attack: targetAttack };
    session.currentStep = "damage-input";
    session.currentStepKey = stepKey("damage-input", targetAttack.id);
    session.capabilities.canRecordDamage = true;
    return;
  }
  const pending = findAwaitingWorkspaceDamage(state, { sequenceId: sequence.id });
  if (pending) {
    session.selectedDamage = pending;
    session.attackId = pending.attack.id;
    session.currentStep = "damage-input";
    session.currentStepKey = stepKey("damage-input", pending.attack.id);
    session.capabilities.canRecordDamage = true;
    return;
  }
  const resolvedAttack = sequence.resolvedAttacks.find((entry) => entry.id === session.attackId);
  if (resolvedAttack && ["checkpoint", "strike-input"].includes(session.currentStep) &&
      resolvedAttack.damageStatus !== "awaiting-damage") {
    session.selectedDamage = null;
    const currentSequence = sequenceCurrentForAttack(sequence, state);
    const canContinue = !session.historicalOnly && currentSequence &&
      getUsedAttackSlots(sequence) < sequence.maximumAttacks;
    session.capabilities.canContinueSequence = canContinue;
    session.capabilities.canRecordAttack = canContinue;
    session.strikeParent = getCurrentWorkspaceStrikeParent(state, sequence.id, resolvedAttack.id)
      ? { sequenceId: sequence.id, attackId: resolvedAttack.id }
      : null;
    if (session.currentStep === "strike-input" && !session.strikeParent) {
      session.currentStep = "summary";
      session.currentStepKey = stepKey("summary", resolvedAttack.id);
      session.readOnly = true;
    }
    return;
  }
  session.selectedDamage = null;
  const currentSequence = sequenceCurrentForAttack(sequence, state);
  const canContinue = !session.historicalOnly && currentSequence &&
    getUsedAttackSlots(sequence) < sequence.maximumAttacks;
  session.capabilities.canContinueSequence = canContinue;
  session.capabilities.canRecordAttack = canContinue;
  if (sequence.status === "open" && canContinue) {
    const existingDraftIsValid = session.currentStep === "attack-input" &&
      !sequence.resolvedAttacks.some((entry) => entry.id === session.attackId);
    if (!existingDraftIsValid) session.attackId = createId("sara-attack");
    session.currentStep = "attack-input";
    session.currentStepKey = stepKey("attack-input", session.attackId);
    session.rawInputsByStep[session.currentStepKey] ??= {};
  } else {
    session.currentStep = "summary";
    session.currentStepKey = stepKey("summary", session.attackId);
    session.readOnly = true;
    if (!currentSequence) {
      session.status = "Ход или боевая сцена изменились. Оставшиеся атаки не продолжены.";
    }
  }
  const currentFingerprint = getRelevantFingerprint(
    state, session.sequenceId, getUsedAttackSlots(sequence) === 0,
  );
  if (session.currentStep === "attack-input" &&
      currentFingerprint !== session.relevantPreviewFingerprint) {
    session.confirmationRequired = true;
    session.relevantPreviewFingerprint = currentFingerprint;
  }
}

function operationId(intent) {
  session.operationIdsByIntent[intent] ??= createId(`workspace-${intent}`);
  return session.operationIdsByIntent[intent];
}

function requireOwner() {
  return Boolean(session && session.owner.appInstanceId === appInstanceId &&
    isWorkspaceOwnerCurrent(session.owner));
}

function requireCurrentOwnerSession() {
  if (!session || session.owner.appInstanceId !== appInstanceId) return false;
  const current = getSessionContext();
  return current.characterId === session.owner.characterId &&
    current.sessionGeneration === session.owner.sessionGeneration;
}

function refreshWorkspaceOwnerRevision() {
  if (!session) return;
  const current = getSessionContext();
  if (current.characterId === session.owner.characterId &&
      current.sessionGeneration === session.owner.sessionGeneration) {
    session.owner = { ...session.owner, stateRevision: current.stateRevision };
  }
}

function setError(reason) {
  session.error = ({
    "stale-session": "Сеанс персонажа изменился. Операция не отправлена.",
    "stale-revision": "Состояние персонажа изменилось. Проверьте расчёт и подтвердите его снова.",
    "duplicate-operation": "Этот результат уже был записан.",
  })[reason] ?? reason ?? "Операция не выполнена.";
}

function submitAttack(outcome, button = null) {
  if (!session || session.workspaceType !== "attack" ||
      session.currentStep !== "attack-input" ||
      !["hit", "miss"].includes(outcome) ||
      session.submitting || session.appliedUnsaved || session.readOnly) return;
  if (button && button.dataset.workspaceAttackId !== session.attackId) return;
  const state = getState();
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="attack"]');
  if (!form) return;
  const parsed = parseForm(form);
  const previous = session.rawInputsByStep[session.currentStepKey] ?? {};
  const raw = {
    profileId: parsed.profileId ?? previous.profileId ?? "unarmed",
    rollMode: parsed.rollMode || previous.rollMode || "normal",
    firstD20: parsed.firstD20 ?? previous.firstD20 ?? "",
    secondD20: parsed.secondD20 ?? previous.secondD20 ?? "",
    confirmSeparateAction: parsed.confirmSeparateAction === true,
    dmExceptionConfirmed: parsed.dmExceptionConfirmed === true,
  };
  session.rawInputsByStep[session.currentStepKey] = raw;
  session.dirty = true;
  session.error = "";
  const values = {
    profileId: raw.profileId,
    rollMode: raw.rollMode,
    firstD20: raw.firstD20,
    secondD20: raw.secondD20,
    dmHitResult: outcome,
    confirmSeparateAction: raw.confirmSeparateAction,
  };
  const preview = calculateWorkspaceAttackPreview(state, values);
  if (!preview.ok) {
    setError(preview.reason);
    render();
    return;
  }
  const ordinaryOutcome = preview.naturalMiss ? "miss" : preview.critical ? "hit" : null;
  if (ordinaryOutcome && ordinaryOutcome !== outcome) {
    if (session.naturalExceptionOutcome !== outcome) {
      session.naturalExceptionOutcome = outcome;
      raw.dmExceptionConfirmed = false;
      session.error = "";
      render();
      return;
    }
    if (raw.dmExceptionConfirmed !== true) {
      setError(preview.naturalMiss
        ? "По обычному правилу это натуральная 1 и промах. Подтвердите, что мастер назначил исключение."
        : "По обычному правилу это натуральная 20 и попадание. Подтвердите, что мастер назначил исключение.");
      render();
      return;
    }
  } else {
    session.naturalExceptionOutcome = null;
  }
  const sequence = getSequence(state);
  if (!sequence && !canOpenNewSequence(state)) {
    session.readOnly = true;
    setError("Сейчас нельзя начать новую обычную атаку вне своего хода.");
    render();
    return;
  }
  if (sequence && !sequenceCurrentForAttack(sequence, state)) {
    setError("Последовательность больше не является текущей. Введённые кости сохранены; новый удар не начат.");
    session.readOnly = true;
    render();
    return;
  }
  const nextFingerprint = getRelevantFingerprint(state, session.sequenceId, !sequence);
  if (nextFingerprint !== session.relevantPreviewFingerprint || session.confirmationRequired) {
    if (nextFingerprint !== session.relevantPreviewFingerprint) {
      session.relevantPreviewFingerprint = nextFingerprint;
      session.confirmationRequired = true;
      session.error = "Профиль или боевой контекст изменился. Проверьте новый расчёт и выберите исход ещё раз.";
      render();
      return;
    }
    session.confirmationRequired = false;
  }
  const currentAttackId = session.attackId;
  const intent = `attack:${currentAttackId}`;
  session.submitting = true;
  session.deferredReconcile = false;
  const result = session.sequenceKind === "attack-action"
    ? submitWorkspaceAttack(
      session.owner, session.sequenceId, currentAttackId, values, operationId(intent),
    )
    : submitWorkspaceSequenceAttack(
      session.owner, session.sequenceId, currentAttackId, session.sequenceKind, values, operationId(intent),
    );
  session.submitting = false;
  const after = getState();
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  session.dirty = false;
  session.naturalExceptionOutcome = null;
  session.firstAttempt = false;
  session.isExistingSequence = true;
  session.appliedUnsaved = result.persistence?.ok === false;
  const sequenceAfter = getWorkspaceAttackSequence(after, session.sequenceId);
  const attack = sequenceAfter?.resolvedAttacks?.find((entry) => entry.id === currentAttackId);
  if (!attack) {
    session.readOnly = true;
    setError("Атака применена, но запись не найдена в текущем состоянии.");
    render();
    return;
  }
  const canContinue = !session.historicalOnly &&
    sequenceCurrentForAttack(sequenceAfter, after) &&
    getUsedAttackSlots(sequenceAfter) < sequenceAfter.maximumAttacks;
  session.capabilities.canContinueSequence = canContinue;
  session.capabilities.canRecordAttack = canContinue;
  session.relevantPreviewFingerprint = getRelevantFingerprint(after, session.sequenceId, false);
  if (attack.hitResult === "hit" && attack.damageStatus === "awaiting-damage") {
    session.selectedDamage = { sequence: sequenceAfter, attack };
    setStep("damage-input", attack.id);
  } else {
    session.selectedDamage = null;
    setStep("checkpoint", attack.id);
    session.capabilities.canRecordDamage = false;
  }
}

function submitDamage() {
  if (!session || session.currentStep !== "damage-input" ||
      session.submitting || session.appliedUnsaved || !requireOwner()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="damage"]');
  if (!form || !session.selectedDamage) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  const { sequence, attack } = session.selectedDamage;
  if (attack.damageStatus !== "awaiting-damage") {
    setError("Этот урон уже разрешён; повторная запись не выполняется.");
    render();
    return;
  }
  const rolls = attack.critical
    ? [values.damage1 ?? "", values.damage2 ?? ""]
    : [values.damage1 ?? ""];
  const preview = calculateWorkspaceDamagePreview(attack.profileSnapshot, rolls, attack.critical);
  if (!preview.ok) {
    setError(preview.reason);
    render();
    return;
  }
  session.submitting = true;
  const result = submitWorkspaceDamage(
    session.owner,
    sequence.id,
    attack.id,
    rolls,
    operationId(`damage:${attack.id}`),
  );
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const after = getState();
  const recordedParent = getCurrentWorkspaceStrikeParent(after, sequence.id, attack.id);
  session.appliedUnsaved = result.persistence?.ok === false;
  session.dirty = false;
  session.selectedDamage = null;
  session.strikeParent = recordedParent
    ? { sequenceId: sequence.id, attackId: attack.id }
    : null;
  session.status = session.appliedUnsaved ? "Урон применён, но ещё не сохранён." : "Физический урон записан.";
  setStep("checkpoint", attack.id);
}

function applyStrikeToCurrentHit() {
  if (!session || session.currentStep !== "strike-input" || session.submitting ||
      session.appliedUnsaved || !requireOwner()) return;
  const parentRef = session.strikeParent;
  const state = getState();
  const parent = parentRef
    ? getCurrentWorkspaceStrikeParent(state, parentRef.sequenceId, parentRef.attackId) : null;
  if (!parent || parent.sequence.id !== session.sequenceId) {
    setError("Попадание больше не является текущим. Техника не применена.");
    render();
    return;
  }
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="strike"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  const techniqueId = values.techniqueId;
  const technique = MONK_TECHNIQUE_BY_ID.get(techniqueId);
  if (!technique || !getEffectiveSelectedTechniqueIds(state).has(techniqueId)) {
    setError("Выберите технику, которая сейчас выбрана и доступна.");
    render();
    return;
  }
  if (technique.id === "ll-monk:crippling-strike" &&
      !["blinded", "deafened", "unable-to-speak"].includes(values.effect)) {
    setError("Выберите эффект «Калечащего удара».");
    render();
    return;
  }
  const paymentMode = values.paymentMode || "ki";
  if (!["ki", "practiced"].includes(paymentMode)) {
    setError("Выберите допустимый способ оплаты.");
    render();
    return;
  }
  const battle = state.battleConsole?.current;
  const ownTurn = !battle || battle.phase === "own-turn";
  const runtime = state.monk?.techniqueRuntime ?? {};
  if (paymentMode === "practiced" &&
      (!technique.practicedStrikesEligible || !ownTurn ||
       Number(state.combat?.practiced?.current) < 1 ||
       runtime.practicedUsedThisTurn === true ||
       values.practicedConditions !== true)) {
    setError("Practiced требует подходящую технику, свой ход, доступный заряд и подтверждение безоружного попадания.");
    render();
    return;
  }
  const { sequence, attack } = parent;
  session.submitting = true;
  const result = applyTechniqueToHit(getWorkspaceAttackContext(), sequence.id, attack.id, values.techniqueId, {
    confirmed: true,
    paymentMode,
    ownTurnConfirmed: paymentMode === "practiced" && ownTurn,
    unarmedHitConfirmed: paymentMode === "practiced" && values.practicedConditions === true,
    effect: values.effect || undefined,
  }, operationId(`strike:${attack.id}`));
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const after = getState();
  const updatedSequence = getWorkspaceAttackSequence(after, sequence.id);
  const updatedAttack = updatedSequence?.resolvedAttacks.find((entry) => entry.id === attack.id);
  if (!updatedAttack?.techniqueApplicationId) {
    session.readOnly = true;
    setError("Техника применена, но её запись не найдена в текущем состоянии.");
    render();
    return;
  }
  const application = (after.monk?.combatAssistant?.pendingApplications ?? [])
    .find((entry) => entry.id === updatedAttack.techniqueApplicationId);
  session.dirty = false;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.error = "";
  session.status = result.persistence?.ok === false
    ? "Техника применена, но не сохранена."
    : `Техника применена · ${application?.paymentAmount ?? "—"} ${application?.paymentKind === "practiced" ? "заряд Practiced потрачен" : "ци потрачено"} · результат мастера ожидается.`;
  setStep("checkpoint", attack.id);
}

function startCommandAttack(kind, values, { parentFeature = null } = {}) {
  const operation = operationId(`start:${session.scenarioId}`);
  const result = startAttackSequence(session.owner, {
    kind,
    sequenceId: session.sequenceId,
    parentId: session.parentSequenceId ?? operation,
    confirmed: values.confirmed === true,
    triggerConfirmed: values.triggerConfirmed === true,
    parentFeature,
  }, operation);
  if (result.status !== "applied") return result;
  refreshWorkspaceOwnerRevision();
  const after = getState();
  const sequence = getWorkspaceAttackSequence(after, session.sequenceId);
  if (!sequence) return { status: "rejected", reason: "Последовательность применена, но не найдена в состоянии персонажа." };
  session.workspaceType = "attack";
  session.sequenceKind = kind;
  if (parentFeature === "deflect-counter") {
    session.command = { ...session.command, titleRu: "Ответный удар после полного отражения" };
  }
  session.isExistingSequence = true;
  session.firstAttempt = false;
  session.readOnly = false;
  session.historicalOnly = false;
  session.capabilities = {
    canRecordAttack: true,
    canRecordDamage: false,
    canContinueSequence: sequence.maximumAttacks > 1,
  };
  session.status = result.persistence?.ok === false
    ? "Ресурс применён, но ещё не сохранён."
    : "Ресурс оплачен. Запишите физические броски последовательности.";
  session.relevantPreviewFingerprint = getRelevantFingerprint(after, sequence.id, false);
  session.rawInputsByStep[stepKey("attack-input", session.attackId)] = {};
  session.dirty = false;
  setStep("attack-input", session.attackId);
  session.appliedUnsaved = result.persistence?.ok === false;
  return result;
}

function commandOutcomeSummary(result) {
  if (result.outcome?.resourceId) {
    const outcome = result.outcome;
    return `${outcome.label}: ${outcome.previous} → ${outcome.current}.`;
  }
  if (result.record?.chosenD20 != null) {
    return `${result.record.label}: к20 ${result.record.rawD20Rolls.join(" и ")}; итог ${result.record.total}` +
      (result.record.dc == null ? "" : ` против СЛ ${result.record.dc}: ${result.record.dcResult ? "успех" : "провал"}.`);
  }
  const outcome = result.outcome ?? {};
  if (outcome.usefulHealing != null) {
    return `Полезное лечение: ${outcome.usefulHealing} HP; HP ${outcome.hpAfter}/${getDerivedStats(getState()).maxHitPoints}; ци ${outcome.kiAfter}.`;
  }
  if (outcome.absorbedByTemp != null) {
    return `Получено урона: ${outcome.damage}; временные HP поглотили ${outcome.absorbedByTemp}; HP ${outcome.hpAfter}.`;
  }
  if (outcome.rawReduction != null || outcome.rawRemainder != null) {
    return `Сырое снижение: ${outcome.rawReduction ?? outcome.rawRemainder}; остаток после поправок: ${outcome.finalRemainder ?? outcome.remainingDamage ?? "—"}.`;
  }
  if (outcome.spellId) return `Заклинание применено: ${outcome.spellId}. Исход цели определяется вручную.`;
  if (outcome.techniqueResult?.reducedDamage != null) {
    return `Снижение урона: ${outcome.techniqueResult.reducedDamage}; осталось: ${outcome.techniqueResult.remainingDamage}.`;
  }
  if (outcome.response === "dexterity-save") return "Реакция потрачена; выполните спасбросок Ловкости цели вручную.";
  return "Результат записан.";
}

function getWhitelistedRollInput(values) {
  return {
    kind: values.kind,
    id: values.id,
    rollMode: values.rollMode,
    firstD20: values.firstD20,
    secondD20: values.secondD20,
    spellSaveSource: values.spellSaveSource === true,
    advantageReason: typeof values.advantageReason === "string" ? values.advantageReason : "",
    disadvantageReason: typeof values.disadvantageReason === "string" ? values.disadvantageReason : "",
  };
}

function finishRollMutation(result) {
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return false;
  }
  refreshWorkspaceOwnerRevision();
  session.dirty = false;
  session.rollRecord = result.record;
  session.resultMessage = `${result.record.label}: к20 ${result.record.rawD20Rolls.join(" и ")}; итог ${result.record.total}.`;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.status = session.appliedUnsaved ? "Применено, но не сохранено." : "";
  session.error = "";
  session.currentStep = "roll-result";
  session.currentStepKey = stepKey("roll-result", session.scenarioId);
  session.stepLabel = "Результат броска · исход и последствие";
  session.parentOperationId = session.operationIdsByIntent.lastRollOperation ?? null;
  render();
  return true;
}

function submitCharacterRoll(outcome) {
  if (!session || session.workspaceType !== "command" ||
      session.scenarioId !== "character-roll" || session.currentStep !== "command-input" ||
      session.submitting || session.appliedUnsaved ||
      !["success", "failure", "unknown"].includes(outcome)) return;
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="command"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  const currentCommand = getCommandDescriptor(getState(), "character-roll");
  if (!currentCommand?.availability.enabled) {
    setError(currentCommand?.availability.reasonRu || "Команда броска больше недоступна.");
    render();
    return;
  }
  session.submitting = true;
  const operation = operationId("record-character-roll");
  session.operationIdsByIntent.lastRollOperation = operation;
  const result = recordCharacterRoll(getWhitelistedRollInput(values), {
    owner: getSessionContext(),
    operationId: operation,
    outcome: outcome === "unknown" ? null : outcome,
    askForDamage: true,
  });
  finishRollMutation(result);
}

function submitRollWithAmendment(techniqueId) {
  if (!session || session.workspaceType !== "command" ||
      session.scenarioId !== "character-roll" || session.currentStep !== "command-input" ||
      session.submitting || session.appliedUnsaved) return;
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="command"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  session.submitting = true;
  const operation = operationId(`record-roll-${techniqueId}`);
  session.operationIdsByIntent.lastRollOperation = operation;
  const result = recordAndAmendCharacterRoll(
    getWhitelistedRollInput(values),
    techniqueId,
    {
      owner: getSessionContext(),
      operationId: operation,
      timingConfirmed: values.timingConfirmed === true,
    },
  );
  finishRollMutation(result);
}

function submitRollOutcome(outcome) {
  if (session?.currentStep === "command-input" && session.scenarioId === "character-roll") {
    submitCharacterRoll(outcome);
    return;
  }
  const record = session?.rollRecord;
  if (!session || session.currentStep !== "roll-result" || !record ||
      (!session.correctingOutcome &&
        (record.manualOutcome != null || record.dcResult != null)) ||
      !["success", "failure"].includes(outcome) ||
      session.submitting || session.appliedUnsaved) return;
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  session.submitting = true;
  const result = correctCharacterRollOutcome(record.id, outcome, {
    owner: getSessionContext(),
    operationId: createId("roll-outcome"),
  });
  session.submitting = false;
  if (result.status === "applied") session.correctingOutcome = false;
  updateRollResult(result);
}

function submitRollConsequence(resolution) {
  const record = session?.rollRecord;
  if (!session || session.currentStep !== "roll-result" || !record ||
      session.submitting || session.appliedUnsaved) return;
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  let input = null;
  if (["apply-to-character", "tracked-elsewhere"].includes(resolution) &&
      record.consequence?.status === "awaiting-damage-input") {
    const form = getWorkspaceHost()?.querySelector('[data-workspace-form="roll-consequence"]');
    if (!form) {
      setError("Форма оценки урона больше не открыта.");
      render();
      return;
    }
    input = parseForm(form);
    session.rawInputsByStep[session.currentStepKey] = input;
  }
  session.submitting = true;
  const result = resolveCharacterRollConsequence(
    record.id,
    resolution,
    input,
    {
      owner: getSessionContext(),
      operationId: operationId(`roll-consequence-${record.id}-${resolution}`),
    },
  );
  session.submitting = false;
  updateRollResult(result);
}

function submitCommand() {
  if (!session || session.workspaceType !== "command" ||
      session.currentStep !== "command-input" || session.submitting ||
      session.appliedUnsaved || !requireOwner()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="command"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  if (typeof form.checkValidity === "function" && !form.checkValidity()) {
    setError("Заполните обязательные поля и проверьте допустимые диапазоны.");
    form.reportValidity?.();
    render();
    return;
  }
  const state = getState();
  const currentCommand = getCommandDescriptor(state, session.scenarioId);
  if (!currentCommand || !currentCommand.availability.enabled) {
    setError(currentCommand?.availability.reasonRu || "Команда больше недоступна.");
    render();
    return;
  }
  session.submitting = true;
  let result;
  const id = session.scenarioId;
  const activeRest = getState().monk?.functionalRuntime?.rest;
  const operation = session.command?.restStage === "hit-die"
    ? operationId(`hit-die:${session.command.restId}:${Number(activeRest?.hitDiceSpent ?? 0) + 1}`)
    : operationId(`apply:${id}`);
  if (id === "mystic-regeneration") {
    result = commitRegeneration(session.owner, values.dieResult, operation, {
      confirmNoHealing: values.confirmNoHealing === true,
      allowOutsideCombat: !getActiveBattle(state),
    });
  } else if (id.startsWith("racial-spell:")) {
    result = castSaraRacialSpell(session.owner, id.slice("racial-spell:".length), {
      confirmed: values.confirmed === true,
      replaceConcentration: values.replaceConcentration === true,
      expectedConcentration: session.expectedConcentration,
      operationId: operation,
    });
  } else if (id === "dash" || id === "disengage") {
    result = values.confirmed === true
      ? recordBasicSaraAction(session.owner, id, operation)
      : { status: "rejected", reason: "Подтвердите ручное применение действия." };
  } else if (id === "step-of-the-wind" || id === "patient-defense") {
    result = executeMonkTechnique(session.owner,
      id === "step-of-the-wind" ? "ll-monk:step-of-the-wind" : "ll-monk:patient-defense", {
        confirmed: values.confirmed === true,
        mode: values.mode,
        operationId: operation,
      });
  } else if (id.startsWith("monk-technique:")) {
    const techniqueId = id.slice("monk-technique:".length);
    result = executeMonkTechnique(session.owner, techniqueId, {
      ...values,
      confirmed: true,
      replaceConcentration: values.replaceConcentration === true,
      expectedConcentration: values.expectedConcentration,
      stopOnSurface: values.stopOnSurface === true,
      meditationConfirmed: values.meditationConfirmed === true,
      confirmNoHealing: values.confirmNoHealing === true,
      freeHand: values.freeHand === true,
      physicalProjectile: values.physicalProjectile === true,
      caught: values.caught === true,
      applyDamageToSara: values.applyDamageToSara === "true",
      operationId: operation,
    });
  } else if (id === "flurry") {
    result = startCommandAttack("flurry", values);
  } else if (id === "bonus-unarmed") {
    result = startCommandAttack("bonus-unarmed", values);
  } else if (id === "opportunity-unarmed") {
    result = startCommandAttack("reaction-unarmed", values, { parentFeature: "opportunity-attack" });
  } else if (id === "ebb-and-flow") {
    if (values.triggerConfirmed !== true) {
      result = { status: "rejected", reason: "Подтвердите видимый промах рукопашной атаки." };
    } else if (values.mode === "unarmed") {
      result = startCommandAttack("reaction-unarmed", values, { parentFeature: "ebb-and-flow" });
    } else {
      result = applySaraCombatAction(session.owner, id, {
        ...values,
        confirmed: true,
        triggerConfirmed: true,
        operationId: operation,
      });
    }
  } else if (id === "deflect-strike" || id === "deflect-missile") {
    if (values.triggerConfirmed !== true) {
      session.submitting = false;
      setError("Подтвердите подходящее попадание по решению игрока или ведущего.");
      render();
      return;
    }
    const deflection = {
      kind: id === "deflect-missile" ? "missile" : "strike",
      mode: values.mode,
      incomingDamage: values.incomingDamage,
      deflectRoll: values.deflectRoll,
      finalAdjustedDamage: values.finalAdjustedDamage === "" ? undefined : values.finalAdjustedDamage,
      applyDamageToSara: values.applyDamageToSara === "true",
      freeHand: values.freeHand === true,
      physicalProjectile: values.physicalProjectile === true,
      caught: values.caught === true,
    };
    result = commitDeflection(session.owner, deflection, operation);
  } else if (id.startsWith("pending-save:")) {
    result = recordTargetSaveOutcome(
      session.owner, id.slice("pending-save:".length), values.outcome, operation,
    );
  } else if (id.startsWith("pending-roll:")) {
    result = resolveCharacterRollConsequence(
      id.slice("pending-roll:".length), values.resolution,
    );
  } else if (id === "character-roll") {
    result = {
      status: "rejected",
      reason: "Выберите «Успех», «Провал» или «Пока неизвестно» после физического броска.",
    };
  } else if (id === "incoming-damage") {
    result = recordSaraIncomingDamage(session.owner, values.damage, {
      confirmed: values.confirmed === true,
      operationId: operation,
    });
  } else if (id === "resource-correction") {
    result = correctSaraResource(session.owner, values.resourceId, values.value, operation);
  } else if (id.startsWith("potion-use:")) {
    result = useSaraPotion(session.owner, {
      id: operation,
      potionId: currentCommand.potionId,
      itemId: currentCommand.itemId,
      target: values.target,
      sum: values.sum,
      intentionalWaste: values.intentionalWaste === true,
    });
  } else if (id === "completed-rest") {
    session.pendingRestId ??= createId("rest");
    result = completeSaraRest(session.owner, {
      id: operation,
      restId: session.pendingRestId,
      kind: values.kind,
    });
  } else if (session.command?.restStage === "hit-die") {
    result = spendSaraHitDie(session.owner, {
      id: operation,
      restId: session.command.restId,
      roll: values.roll,
    });
  } else if (session.command?.restStage === "edit") {
    const choices = values.add === "ll-monk:divine-light"
      ? { clericCantripIds: [values.cantrip1, values.cantrip2] }
      : values.add === "ll-monk:warrior-adept"
        ? { styleId: values.styleId } : {};
    result = replaceSaraRestTechnique(session.owner, {
      id: operation,
      restId: currentCommand.restId,
      remove: values.remove,
      add: values.add,
      choices,
    });
  } else {
    result = { status: "rejected", reason: "Для этой команды ещё нет подключённого исполнителя." };
  }
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  if (session.workspaceType === "attack") {
    session.dirty = false;
    session.appliedUnsaved = result.persistence?.ok === false;
    render();
    return;
  }
  session.dirty = false;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.resultMessage = id.startsWith("monk-technique:")
    ? techniqueOutcomeSummary(result, currentCommand.titleRu, state)
    : commandOutcomeSummary(result);
  session.error = "";
  session.status = result.persistence?.ok === false ? "Применено, но не сохранено." : "";
  session.currentStep = id === "character-roll" ? "roll-result" : "command-result";
  if (id === "completed-rest" && result.outcome?.phase === "hit-dice") {
    session.scenarioId = `rest-hit-die:${result.outcome.restId}`;
    session.command = getCommandDescriptor(getState(), session.scenarioId);
    session.currentStep = "command-input";
    session.resultMessage = `Короткий отдых завершён. Ци восстановлена до ${result.outcome.ki}; лечение костями хитов необязательно.`;
    session.rawInputsByStep[stepKey("command-input", session.scenarioId)] = {};
  } else if (id === "completed-rest" && result.outcome?.phase === "replacement-offer") {
    session.scenarioId = buildRestReplacementCommandId("offer", result.outcome.restId);
    session.command = getCommandDescriptor(getState(), session.scenarioId);
    session.currentStep = "command-input";
    session.resultMessage = "Продолжительный отдых завершён. Доступно одно право замены обычной техники.";
  } else if (session.command?.restStage === "hit-die") {
    const hitDiceSpent = Number(getState().monk?.functionalRuntime?.rest?.hitDiceSpent ?? 0);
    session.resultMessage = `Кость ${result.outcome.roll} + Телосложение ${result.outcome.constitutionModifier >= 0 ? "+" : ""}${result.outcome.constitutionModifier}: полезное лечение ${result.outcome.usefulHealing} HP; осталось ${result.outcome.remaining}.`;
    session.currentStep = "command-input";
    session.currentStepKey = stepKey("command-input", `${id}:${hitDiceSpent + 1}`);
    session.command = getCommandDescriptor(getState(), id);
    session.rawInputsByStep[session.currentStepKey] = {};
  }
  session.rollRecord = id === "character-roll" ? result.record : null;
  if (!["completed-rest"].includes(id) && session.command?.restStage !== "hit-die") {
    session.currentStepKey = stepKey(session.currentStep, session.scenarioId);
  } else if (id === "completed-rest") {
    session.currentStepKey = stepKey(session.currentStep, session.scenarioId);
  }
  session.canReturnMissile = result.outcome?.techniqueResult?.canCatch === true &&
    id === "deflect-missile" && values.mode === "weapon";
  session.canDeflectCounter = result.outcome?.techniqueResult?.canCounterattack === true &&
    id === "deflect-strike";
  session.parentOperationId = operation;
  session.returnContinuationId = operation;
  session.dirty = false;
  render();
}

function techniqueOutcomeSummary(result, title, before) {
  const outcome = result.outcome?.result ?? {};
  const after = getState();
  const details = [];
  if (before.combat?.ki?.current !== after.combat?.ki?.current) {
    details.push(`Ци ${before.combat.ki.current} → ${after.combat.ki.current}`);
  }
  if (before.combat?.hp?.current !== after.combat?.hp?.current) {
    details.push(`HP ${before.combat.hp.current} → ${after.combat.hp.current}`);
  }
  if (outcome.remainingDamage != null) details.push(`неучтённый остаток урона ${outcome.remainingDamage}`);
  if (outcome.damageDice) details.push(`бросьте физически ${outcome.damageDice}`);
  if (outcome.requiresManualSave) details.push("результат спасброска цели ожидается");
  if (outcome.requiresManualTargetResult) details.push("результат цели нужно внести вручную");
  if (outcome.requiresManualDamageRoll) details.push("добавочный урон нужно бросить и записать вручную");
  if (outcome.meditationPending) details.push("завершение медитации ожидает отдельной отметки");
  if (outcome.saveBonus != null) details.push(`бонус спасброска ${outcome.saveBonus}`);
  if (outcome.movementFeet != null) details.push(`перемещение ${outcome.movementFeet} футов`);
  if (outcome.knockoutThreshold != null) details.push(`порог текущих HP цели ${outcome.knockoutThreshold}`);
  if (outcome.duration) details.push(`длительность: ${outcome.duration}`);
  return `${title}: применено.${details.length ? ` ${details.join("; ")}.` : ""}`;
}

function openMissileReturnForm() {
  if (!session || session.appliedUnsaved || !requireOwner()) return;
  const state = getState();
  const token = state.monk?.techniqueRuntime?.deflectContinuation;
  if (!token || token.id !== session.returnContinuationId) {
    setError("Продолжение отражения снаряда больше недоступно.");
    render();
    return;
  }
  session.currentStep = "missile-return";
  session.currentStepKey = stepKey("missile-return", session.returnContinuationId);
  session.stepLabel = "Вернуть пойманный снаряд за отдельную стоимость 1 ци?";
  session.rawInputsByStep[session.currentStepKey] ??= {};
  session.error = "";
  render();
}

function declineMissileReturn() {
  if (!session?.canReturnMissile || session.appliedUnsaved ||
      session.submitting || !requireOwner()) return;
  session.submitting = true;
  const result = declineDeflectMissileReturn(
    session.owner,
    session.returnContinuationId,
  );
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  session.canReturnMissile = false;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.resultMessage = "Возврат снаряда отклонён. Дополнительная стоимость не потрачена.";
  if (session.appliedUnsaved) {
    session.status = "Решение применено, но не сохранено.";
    render();
    return;
  }
  if (session.dirty && session.workspaceType === "command" &&
      ["command-input", "missile-return"].includes(session.returnStep ?? session.currentStep)) {
    session.rawInputsByStep[session.returnStepKey ?? session.currentStepKey] = {};
    session.dirty = false;
  }
  finishCurrentSession();
}

function startDeflectCounter() {
  if (!session?.canDeflectCounter || session.appliedUnsaved) return;
  session.parentSequenceId = session.parentOperationId;
  const result = startCommandAttack("reaction-unarmed", {
    confirmed: true,
    triggerConfirmed: true,
  }, { parentFeature: "deflect-counter" });
  if (result.status !== "applied") {
    session.error = result.reason ?? "Ответный удар не начат.";
    render();
    return;
  }
  session.canDeflectCounter = false;
}

function submitMissileReturn() {
  if (!session || session.currentStep !== "missile-return" ||
      session.submitting || session.appliedUnsaved || !requireOwner()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="missile-return"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  session.submitting = true;
  const sequenceId = session.sequenceId;
  const result = submitWorkspaceSequenceAttack(session.owner, sequenceId,
      `${sequenceId}:returned-attack`, "returned-projectile", {
        parentId: session.returnContinuationId,
        proficiencyConfirmed: values.proficiencyConfirmed === true,
        profileId: "returnedProjectile",
        rollMode: "normal",
        firstD20: values.attackRoll,
        targetArmorClass: values.targetArmorClass,
        dmHitResult: values.dmHitResult || null,
      }, operationId(`returned-projectile-attack:${session.returnContinuationId}`));
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const after = getState();
  const sequence = getWorkspaceAttackSequence(after, sequenceId);
  const attack = sequence?.resolvedAttacks?.[0];
  if (!attack) {
    session.readOnly = true;
    setError("Возвращённая атака применена, но запись последовательности не найдена.");
    render();
    return;
  }
  session.workspaceType = "attack";
  session.sequenceKind = "returned-projectile";
  session.isExistingSequence = true;
  session.firstAttempt = false;
  session.attackId = attack.id;
  session.dirty = false;
  session.dirty = false;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.canReturnMissile = false;
  session.selectedDamage = attack.damageStatus === "awaiting-damage"
    ? { sequence, attack } : null;
  session.currentStep = attack.damageStatus === "awaiting-damage"
    ? "damage-input" : "checkpoint";
  session.currentStepKey = stepKey(session.currentStep, attack.id);
  session.capabilities.canRecordDamage = attack.damageStatus === "awaiting-damage";
  session.capabilities.canRecordAttack = false;
  session.capabilities.canContinueSequence = false;
  session.resultMessage = `Возвращённый снаряд: ${attack.hitResult === "hit" ? "попадание" : "промах"}${attack.critical ? " (критическое)" : ""}.`;
  render();
}

function markDamageOutside() {
  if (!session || session.submitting || session.appliedUnsaved ||
      session.currentStep !== "damage-input" || !session.selectedDamage ||
      !requireOwner()) return;
  const { sequence, attack } = session.selectedDamage;
  session.submitting = true;
  const result = markWorkspaceDamageOutside(
    session.owner,
    sequence.id,
    attack.id,
    operationId(`outside:${attack.id}`),
  );
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const after = getState();
  const recordedParent = getCurrentWorkspaceStrikeParent(after, sequence.id, attack.id);
  session.appliedUnsaved = result.persistence?.ok === false;
  session.selectedDamage = null;
  session.strikeParent = recordedParent
    ? { sequenceId: sequence.id, attackId: attack.id }
    : null;
  session.dirty = false;
  session.status = session.appliedUnsaved ? "Урон учтён вне приложения, изменение не сохранено." : "Урон учтён вне приложения.";
  setStep("checkpoint", attack.id);
  session.capabilities.canRecordDamage = false;
}

function handleSubmit(form) {
  if (!session) return;
  if (session.workspaceType === "incoming") {
    session.incomingDraft.error = "Используйте кнопки входящего процесса.";
    render();
    return;
  }
  if (form.dataset.workspaceForm === "attack") {
    session.error = "Итог рассчитан. Выберите «Попадание» или «Промах» после ответа ведущего.";
    render();
  }
  if (form.dataset.workspaceForm === "damage") submitDamage();
  if (form.dataset.workspaceForm === "seeking") submitSeekingStrike();
  if (form.dataset.workspaceForm === "gentling") submitGentlingTouch();
  if (form.dataset.workspaceForm === "command") {
    if (session.scenarioId !== "character-roll") submitCommand();
  }
  if (form.dataset.workspaceForm === "roll-consequence") {
    setError("Проверьте расчёт и выберите способ учёта урона.");
    render();
  }
  if (form.dataset.workspaceForm === "missile-return") submitMissileReturn();
}

function beginSeekingStrikeRoute(button = null) {
  if (!session || session.workspaceType !== "attack" ||
      session.currentStep !== "checkpoint" || session.submitting ||
      session.appliedUnsaved || session.historicalOnly || !requireCurrentOwnerSession()) return;
  const attack = getSequence()?.resolvedAttacks?.find((entry) => entry.id === session.attackId);
  if (!attack || attack.hitResult !== "miss") return;
  let history;
  try {
    history = readSeekingHistory(attack, {
      actionId: session.sequenceId,
      attackId: attack.id,
    });
  } catch (error) {
    setError("История Seeking Strike противоречива. Запись сохранена; новое применение заблокировано.");
    render();
    return;
  }
  const basisKey = JSON.stringify([
    session.sequenceId, attack.id, attack.hitResult, attack.rollMode,
    attack.rawD20Rolls, attack.chosenD20, attack.attackTotal,
    history.at(-1)?.paidOperationId ?? null, history.at(-1)?.status ?? null,
  ]);
  if (button?.dataset.seekingBasis &&
      button.dataset.seekingBasis !== encodeURIComponent(basisKey)) {
    setError("Результат атаки изменился. Обновите панель перед новым применением.");
    render();
    return;
  }
  const oldIntent = session.seekingBeginIntent;
  const beginIntent = oldIntent?.actionId === session.sequenceId &&
      oldIntent.attackId === attack.id && oldIntent.basisKey === basisKey
    ? oldIntent
    : (session.seekingBeginIntent = {
      operationId: createId("seeking-invocation"),
      actionId: session.sequenceId,
      attackId: attack.id,
      basisKey,
    });
  const taskSession = session;
  const taskIdentity = `${session.sequenceId}:${attack.id}:${beginIntent.operationId}`;
  const currentOwner = getSessionContext();
  if (currentOwner.characterId !== session.owner.characterId ||
      currentOwner.sessionGeneration !== session.owner.sessionGeneration) {
    setError("Сеанс персонажа изменился. Операция не отправлена.");
    render();
    return;
  }
  session.owner = { ...session.owner, stateRevision: currentOwner.stateRevision };
  session.submitting = true;
  let result;
  let caughtUnexpectedError = false;
  try {
    result = beginSeekingStrike(session.owner, session.sequenceId, attack.id,
      beginIntent.operationId);
  } catch (error) {
    caughtUnexpectedError = true;
    console.error("Seeking Strike begin failed unexpectedly", error);
    if (session === taskSession) {
      const currentAttack = getSequence()?.resolvedAttacks?.find((entry) =>
        entry.id === attack.id);
      let verification = "not-applied";
      try {
        verification = currentAttack && readSeekingHistory(currentAttack, {
          actionId: taskSession.sequenceId, attackId: attack.id,
        }).some((entry) => entry.paidOperationId === beginIntent.operationId)
          ? "applied" : "not-applied";
      } catch (verificationError) {
        console.error("Could not verify Seeking payment after handler failure", verificationError);
        verification = "unknown";
      }
      session.appliedUnsaved = verification !== "not-applied";
      setError(verification === "applied"
        ? "Seeking Strike применён, но обработка завершилась с ошибкой. Сохраните запись; повторная оплата заблокирована."
        : verification === "unknown"
          ? "Исход Seeking Strike не подтверждён из-за ошибки проверки. Повторная оплата заблокирована; проверьте запись и сохраните состояние."
          : "Не удалось выполнить Seeking Strike. Оплата не обнаружена; операция не повторялась.");
    }
    return;
  } finally {
    if (session === taskSession &&
        `${taskSession.sequenceId}:${taskSession.attackId}:${taskSession.seekingBeginIntent?.operationId}` === taskIdentity) {
      session.submitting = false;
      if (caughtUnexpectedError) render();
    }
  }
  if (session !== taskSession) return;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const canonicalAttack = getSequence()?.resolvedAttacks?.find((entry) => entry.id === attack.id);
  let invocation;
  try {
    invocation = readSeekingHistory(canonicalAttack, {
      actionId: session.sequenceId,
      attackId: attack.id,
    }).find((entry) => entry.paidOperationId === beginIntent.operationId);
  } catch {
    invocation = null;
  }
  if (result.replayed === true && !invocation) {
    setError("Записанное применение не найдено; новая оплата не выполнена.");
    render();
    return;
  }
  if (!invocation || invocation.status !== "awaiting-replacement") {
    session.appliedUnsaved = result.replayed ? session.appliedUnsaved
      : result.persistence?.ok === false;
    session.error = "Это применение уже разрешено; повторный ввод не открыт.";
    render();
    return;
  }
  session.appliedUnsaved = result.replayed === true
    ? session.appliedUnsaved : result.persistence?.ok === false;
  session.seekingTask = {
    actionId: session.sequenceId,
    attackId: attack.id,
    amendmentId: invocation.paidOperationId,
  };
  session.seekingOriginalRollMode = invocation.original.rollMode;
  session.error = "";
  const key = stepKey("seeking-input", `${attack.id}:${invocation.paidOperationId}`);
  session.rawInputsByStep[key] ??= {};
  setStep("seeking-input", attack.id, key);
  render();
}

function submitSeekingStrike() {
  if (!session || session.currentStep !== "seeking-input" ||
      session.submitting || session.appliedUnsaved || session.readOnly ||
      !requireCurrentOwnerSession()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="seeking"]');
  if (!form) return;
  if (!form.checkValidity()) {
    form.reportValidity?.();
    return;
  }
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  const task = session.seekingTask;
  const attack = getSequence()?.resolvedAttacks?.find((entry) => entry.id === task?.attackId);
  let amendment;
  try {
    amendment = attack && readSeekingHistory(attack, {
      actionId: task.actionId,
      attackId: task.attackId,
    }).find((entry) => entry.paidOperationId === task.amendmentId);
  } catch {
    amendment = null;
  }
  if (!amendment || amendment.status !== "awaiting-replacement" ||
      task.actionId !== session.sequenceId || task.attackId !== session.attackId) {
    setError("Оплаченная замена не найдена в сохранённой атаке.");
    render();
    return;
  }
  const currentOwner = getSessionContext();
  if (currentOwner.characterId !== session.owner.characterId ||
      currentOwner.sessionGeneration !== session.owner.sessionGeneration) {
    setError("Сеанс персонажа изменился. Операция не отправлена.");
    render();
    return;
  }
  session.owner = { ...session.owner, stateRevision: currentOwner.stateRevision };
  const taskSession = session;
  const taskIdentity = `${task.actionId}:${task.attackId}:${task.amendmentId}`;
  session.submitting = true;
  let result;
  let caughtUnexpectedError = false;
  try {
    result = resolveSeekingStrike(session.owner, session.sequenceId, session.attackId,
      { ...values, amendmentId: task.amendmentId },
      `seeking-result:${task.amendmentId}`);
  } catch (error) {
    caughtUnexpectedError = true;
    console.error("Seeking Strike submit failed unexpectedly", error);
    if (session === taskSession) {
      const currentAttack = getWorkspaceAttackSequence(getState(), task.actionId)
        ?.resolvedAttacks?.find((entry) => entry.id === task.attackId);
      let verification = "not-applied";
      try {
        verification = currentAttack && readSeekingHistory(currentAttack, {
          actionId: task.actionId, attackId: task.attackId,
        }).find((entry) => entry.paidOperationId === task.amendmentId)
          ?.status === "resolved" ? "applied" : "not-applied";
      } catch (verificationError) {
        console.error("Could not verify Seeking result after handler failure", verificationError);
        verification = "unknown";
      }
      session.appliedUnsaved = verification !== "not-applied";
      setError(verification === "applied"
        ? "Замена записана, но обработка завершилась с ошибкой. Сохраните результат."
        : verification === "unknown"
          ? "Исход замены не подтверждён из-за ошибки проверки. Повтор заблокирован; проверьте запись и сохраните состояние."
          : "Не удалось выполнить замену; исходная оплаченная задача сохранена.");
    }
    return;
  } finally {
    if (session === taskSession &&
        `${taskSession.seekingTask?.actionId}:${taskSession.seekingTask?.attackId}:${taskSession.seekingTask?.amendmentId}` === taskIdentity) {
      session.submitting = false;
      if (caughtUnexpectedError) render();
    }
  }
  if (session !== taskSession) return;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const after = getState();
  const updatedSequence = getWorkspaceAttackSequence(after, session.sequenceId);
  const updatedAttack = updatedSequence?.resolvedAttacks?.find((entry) => entry.id === session.attackId);
  if (!updatedAttack) {
    setError("Результат Seeking Strike применён, но атака не найдена.");
    session.readOnly = true;
    render();
    return;
  }
  session.dirty = false;
  if (result.replayed !== true) {
    session.appliedUnsaved = result.persistence?.ok === false;
  }
  session.selectedDamage = updatedAttack.damageStatus === "awaiting-damage"
    ? { sequence: updatedSequence, attack: updatedAttack } : null;
  session.currentStep = updatedAttack.damageStatus === "awaiting-damage"
    ? "damage-input" : "checkpoint";
  session.currentStepKey = stepKey(session.currentStep, updatedAttack.id);
  session.capabilities.canRecordDamage = updatedAttack.damageStatus === "awaiting-damage";
  session.capabilities.canContinueSequence = !updatedAttack.historicalResolution &&
    getUsedAttackSlots(updatedSequence) < updatedSequence.maximumAttacks;
  render();
}

function beginGentlingTouchRoute() {
  if (!session || session.workspaceType !== "attack" ||
      !["attack-input", "checkpoint"].includes(session.currentStep) ||
      session.sequenceKind !== "attack-action" ||
      session.submitting || session.appliedUnsaved || session.historicalOnly ||
      !requireCurrentOwnerSession() ||
      !getEffectiveSelectedTechniqueIds(getState()).has("ll-monk:gentling-touch")) return;
  let sequence = getWorkspaceAttackSequence(getState(), session.sequenceId);
  if (!sequence) {
    const taskSession = session;
    const taskIdentity = session.sequenceId;
    const currentOwner = getSessionContext();
    if (currentOwner.characterId !== session.owner.characterId ||
        currentOwner.sessionGeneration !== session.owner.sessionGeneration) {
      setError("Сеанс персонажа изменился. Операция не отправлена.");
      render();
      return;
    }
    session.owner = { ...session.owner, stateRevision: currentOwner.stateRevision };
    session.submitting = true;
    let started;
    let caughtUnexpectedError = false;
    try {
      started = startAttackSequence(session.owner, {
        kind: "attack-action",
        sequenceId: session.sequenceId,
      }, operationId(`gentling-sequence:${session.sequenceId}`));
    } catch (error) {
      caughtUnexpectedError = true;
      console.error("Gentling sequence creation failed unexpectedly", error);
      if (session === taskSession) {
        let verification = "not-applied";
        try {
          verification = getWorkspaceAttackSequence(getState(), taskIdentity)
            ? "applied" : "not-applied";
        } catch (verificationError) {
          console.error("Could not verify Gentling sequence after handler failure", verificationError);
          verification = "unknown";
        }
        session.appliedUnsaved = verification !== "not-applied";
        setError(verification === "applied"
          ? "Последовательность создана, но обработка завершилась с ошибкой. Сохраните состояние."
          : verification === "unknown"
            ? "Создание последовательности не подтверждено из-за ошибки проверки. Повтор заблокирован; проверьте состояние."
            : "Не удалось создать последовательность Gentling Touch; создание не обнаружено.");
      }
      return;
    } finally {
      if (session === taskSession && session.sequenceId === taskIdentity) {
        session.submitting = false;
        if (caughtUnexpectedError) render();
      }
    }
    if (session !== taskSession) return;
    if (started.status !== "applied") {
      setError(started.reason);
      render();
      return;
    }
    refreshWorkspaceOwnerRevision();
    sequence = getWorkspaceAttackSequence(getState(), session.sequenceId);
    session.isExistingSequence = true;
  }
  if (!sequence || sequence.kind !== "attack-action" ||
      getUsedAttackSlots(sequence) >= sequence.maximumAttacks) return;
  const slotNumber = getUsedAttackSlots(sequence) + 1;
  const returnTo = {
    step: session.currentStep,
    attackId: session.attackId,
    stepKey: session.currentStepKey,
  };
  const intent = {
    operationId: createId("gentling-slot"),
    actionId: sequence.id,
    slotNumber,
    draftKey: stepKey("gentling-input",
      `${sequence.id}:slot:${slotNumber}:${createId("gentling-draft")}`),
    battleContext: {
      battleId: sequence.battleId ?? null,
      ownTurnId: sequence.ownTurnId ?? null,
      turnMarker: sequence.turnMarker,
    },
    returnTo,
  };
  session.gentlingIntent = intent;
  session.error = "";
  session.rawInputsByStep[intent.draftKey] = {
    extraKi: "0", targetHp: "", sum: "",
  };
  setStep("gentling-input", session.attackId, intent.draftKey);
}

function submitGentlingTouch() {
  if (!session || session.workspaceType !== "attack" ||
      session.currentStep !== "gentling-input" ||
      session.submitting || session.appliedUnsaved || !requireCurrentOwnerSession()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="gentling"]');
  if (!form) return;
  if (!form.checkValidity()) {
    form.reportValidity?.();
    return;
  }
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
  const intent = session.gentlingIntent;
  const sequence = getWorkspaceAttackSequence(getState(), intent?.actionId);
  const slot = getUsedAttackSlots(sequence) + 1;
  if (!intent || sequence?.id !== session.sequenceId ||
      intent.slotNumber !== slot || sequence.status !== "open") {
    session.readOnly = true;
    setError("Слот Gentling Touch изменился. Ввод сохранён; повторное применение заблокировано.");
    render();
    return;
  }
  const currentOwner = getSessionContext();
  if (currentOwner.characterId !== session.owner.characterId ||
      currentOwner.sessionGeneration !== session.owner.sessionGeneration) {
    setError("Сеанс персонажа изменился. Операция не отправлена.");
    render();
    return;
  }
  session.owner = { ...session.owner, stateRevision: currentOwner.stateRevision };
  const taskSession = session;
  const taskIdentity = `${intent.actionId}:${intent.slotNumber}:${intent.operationId}`;
  session.submitting = true;
  let result;
  let caughtUnexpectedError = false;
  try {
    result = applyGentlingTouchToAttackSlot(session.owner, session.sequenceId,
      values, intent.operationId);
  } catch (error) {
    caughtUnexpectedError = true;
    console.error("Gentling Touch submit failed unexpectedly", error);
    if (session === taskSession) {
      let verification = "not-applied";
      try {
        verification = getWorkspaceAttackSequence(getState(), intent.actionId)
          ?.replacementResults?.some((entry) =>
            entry.operationId === intent.operationId)
          ? "applied" : "not-applied";
      } catch (verificationError) {
        console.error("Could not verify Gentling result after handler failure", verificationError);
        verification = "unknown";
      }
      session.appliedUnsaved = verification !== "not-applied";
      setError(verification === "applied"
        ? "Gentling Touch применён, но обработка завершилась с ошибкой. Сохраните результат."
        : verification === "unknown"
          ? "Исход Gentling Touch не подтверждён из-за ошибки проверки. Повтор заблокирован; проверьте запись и сохраните состояние."
          : "Не удалось завершить Gentling Touch; результат не обнаружен и операция не повторялась.");
    }
    return;
  } finally {
    if (session === taskSession &&
        `${taskSession.gentlingIntent?.actionId}:${taskSession.gentlingIntent?.slotNumber}:${taskSession.gentlingIntent?.operationId}` === taskIdentity) {
      session.submitting = false;
        if (caughtUnexpectedError) render();
    }
  }
  if (session !== taskSession) return;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  const sequenceAfter = getWorkspaceAttackSequence(getState(), session.sequenceId);
  session.dirty = false;
  if (result.replayed !== true) {
    session.appliedUnsaved = result.persistence?.ok === false;
  }
  session.gentlingIntent = null;
  session.capabilities.canContinueSequence = Boolean(sequenceAfter &&
    sequenceAfter.status === "open" &&
    getUsedAttackSlots(sequenceAfter) < sequenceAfter.maximumAttacks);
  if (session.appliedUnsaved) {
    session.currentStep = "summary";
    session.currentStepKey = stepKey("summary", session.sequenceId);
    session.capabilities.canRecordAttack = false;
  } else if (session.capabilities.canContinueSequence) {
    const nextId = createId("sara-attack");
    session.attackId = nextId;
    session.rawInputsByStep[stepKey("attack-input", nextId)] ??= {};
    session.currentStep = "attack-input";
    session.currentStepKey = stepKey("attack-input", nextId);
    session.capabilities.canRecordAttack = true;
  } else {
    session.currentStep = "summary";
    session.currentStepKey = stepKey("summary", session.sequenceId);
    session.capabilities.canRecordAttack = false;
  }
  render();
}

function nextAttack() {
  if (!session || session.appliedUnsaved || !requireOwner() ||
      !["checkpoint", "strike-input", "summary"].includes(session.currentStep) ||
      !session.capabilities.canContinueSequence || session.historicalOnly) return;
  const state = getState();
  const sequence = getSequence(state);
  if (!sequenceCurrentForAttack(sequence, state) ||
      getUsedAttackSlots(sequence) >= sequence.maximumAttacks) {
    session.readOnly = true;
    setError("Текущая последовательность больше не допускает новый удар.");
    render();
    return;
  }
  const unresolved = findAwaitingWorkspaceDamage(state, { sequenceId: sequence.id });
  if (unresolved) {
    session.selectedDamage = unresolved;
    setStep("damage-input", unresolved.attack.id);
    return;
  }
  const newAttackId = createId("sara-attack");
  session.rawInputsByStep[stepKey("attack-input", newAttackId)] = {};
  session.strikeParent = null;
  session.relevantPreviewFingerprint = getRelevantFingerprint(state, sequence.id, false);
  session.dirty = false;
  session.capabilities.canRecordAttack = true;
  setStep("attack-input", newAttackId);
}

function selectAttackMode(mode) {
  if (!session || session.workspaceType !== "attack" ||
      session.currentStep !== "attack-input" ||
      !["normal", "advantage", "disadvantage"].includes(mode) ||
      session.submitting) return;
  const draft = getStepDraft();
  draft.rollMode = mode;
  draft.dmExceptionConfirmed = false;
  session.naturalExceptionOutcome = null;
  clearAttackInputFeedback({ hideNaturalException: true });
  session.dirty = true;
  session.error = "";
  const root = getWorkspaceHost();
  const secondRoll = root?.querySelector("[data-workspace-second-d20]");
  const secondInput = secondRoll?.querySelector('input[name="secondD20"]');
  const needsSecond = mode === "advantage" || mode === "disadvantage";
  if (secondRoll) secondRoll.hidden = !needsSecond;
  if (secondInput) secondInput.required = needsSecond;
  for (const button of root?.querySelectorAll('[data-workspace-action^="attack-mode-"]') ?? []) {
    button.setAttribute("aria-pressed", String(button.dataset.workspaceAction === `attack-mode-${mode}`));
  }
  renderWorkspaceAttackPreview(session, getState());
}

function selectRollMode(mode) {
  if (!session || session.workspaceType !== "command" ||
      session.scenarioId !== "character-roll" ||
      session.currentStep !== "command-input" ||
      !["normal", "advantage", "disadvantage"].includes(mode) ||
      session.submitting) return;
  const draft = getStepDraft();
  draft.rollMode = mode;
  if (mode === "normal") draft.secondD20 = "";
  session.dirty = true;
  session.error = "";
  const root = getWorkspaceHost();
  const secondRoll = root?.querySelector("[data-workspace-second-d20]");
  const secondInput = secondRoll?.querySelector('input[name="secondD20"]');
  const needsSecond = mode !== "normal";
  if (secondRoll) secondRoll.hidden = !needsSecond;
  if (secondInput) {
    secondInput.required = needsSecond;
    if (!needsSecond) secondInput.value = "";
  }
  for (const button of root?.querySelectorAll('[data-workspace-action^="roll-mode-"]') ?? []) {
    button.setAttribute("aria-pressed", String(button.dataset.workspaceAction === `roll-mode-${mode}`));
  }
  const modeInput = root?.querySelector('input[name="rollMode"]');
  if (modeInput) modeInput.value = mode;
  renderWorkspaceRollPreview(session, getState());
}

function openStrikeInput() {
  if (!session || session.currentStep !== "checkpoint" ||
      session.appliedUnsaved || session.historicalOnly || !requireOwner()) return;
  const parent = getCurrentWorkspaceStrikeParent(getState(), session.sequenceId, session.attackId);
  const effective = getEffectiveSelectedTechniqueIds(getState());
  if (!parent || ![
    "ll-monk:empowered-strike",
    "ll-monk:stunning-strike",
    "ll-monk:crippling-strike",
    "ll-monk:slowing-strike",
  ].some((id) => effective.has(id))) return;
  session.strikeParent = { sequenceId: parent.sequence.id, attackId: parent.attack.id };
  const key = stepKey("strike-input", parent.attack.id);
  session.rawInputsByStep[key] ??= {};
  setStep("strike-input", parent.attack.id);
}

function continueWithoutTechnique() {
  if (!session || !["checkpoint", "strike-input"].includes(session.currentStep) ||
      session.appliedUnsaved || session.historicalOnly || !requireOwner()) return;
  if (session.currentStep === "strike-input") {
    delete session.rawInputsByStep[session.currentStepKey];
    session.dirty = false;
    session.error = "";
  }
  if (session.capabilities.canContinueSequence) {
    nextAttack();
  } else {
    setStep("summary", session.attackId);
  }
}

function confirmClose() {
  if (!session || session.submitting) return;
  if (session.appliedUnsaved) {
    setError("Сначала повторите сохранение. Применённый результат не будет повторён или отброшен.");
    render();
    return;
  }
  finishCurrentSession();
}

function closeAttackRemainder() {
  const sequence = getSequence();
  if (!session || !sequence || sequence.status !== "open" ||
      getUsedAttackSlots(sequence) >= sequence.maximumAttacks ||
      session.submitting || session.appliedUnsaved || !requireOwner()) return;
  session.submitting = true;
  const result = abandonWorkspaceSequence(
    session.owner,
    sequence.id,
    operationId(`abandon:${sequence.id}`),
  );
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  session.appliedUnsaved = result.persistence?.ok === false;
  if (session.appliedUnsaved) {
    setError("Остаток закрыт в памяти, но не сохранён. Повторите сохранение перед выходом.");
    render();
    return;
  }
  finishCurrentSession();
}

function retrySave() {
  if (!session?.appliedUnsaved || !requireOwner()) return;
  const result = retryPersistedState();
  if (!result.ok) {
    session.status = "Сохранение не удалось; операция не повторялась.";
    render();
    return;
  }
  session.appliedUnsaved = false;
  session.status = "Сохранение выполнено.";
  render();
}

function updateRollResult(result) {
  if (result.status !== "applied") {
    session.submitting = false;
    setError(result.reason);
    render();
    return;
  }
  refreshWorkspaceOwnerRevision();
  session.submitting = false;
  session.rollRecord = result.record;
  session.dirty = false;
  session.resultMessage = `${result.record.label}: к20 ${result.record.rawD20Rolls.join(" и ")}; итог ${result.record.total}` +
    (result.record.dc == null ? "" : ` против СЛ ${result.record.dc}: ${result.record.dcResult ? "успех" : "провал"}.`);
  session.appliedUnsaved = result.persistence?.ok === false;
  session.error = "";
  session.status = session.appliedUnsaved ? "Применено, но не сохранено." : "";
  session.error = "";
  render();
}

function applyRollAmendment(techniqueId) {
  if (!session || session.appliedUnsaved) return;
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  if (!session.rollRecord && session.currentStep === "command-input") {
    submitRollWithAmendment(techniqueId);
    return;
  }
  if (!session.rollRecord || session.submitting) return;
  session.submitting = true;
  updateRollResult(amendCharacterRoll(session.rollRecord.id, techniqueId, {
    owner: getSessionContext(),
    operationId: operationId(`amend-roll-${techniqueId}`),
  }));
  session.submitting = false;
}

function submitRollFollowup() {
  if (!session?.rollRecord || session.appliedUnsaved || !requireOwner()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="roll-followup"]');
  if (!form) return;
  const values = parseForm(form);
  const record = session.rollRecord;
  const result = record.consequence?.status === "awaiting-outcome"
    ? correctCharacterRollOutcome(record.id, values.outcome, {
      owner: getSessionContext(),
      operationId: operationId(`legacy-roll-outcome-${values.outcome}`),
    })
    : record.consequence?.status === "pending"
      ? resolveCharacterRollConsequence(record.id, values.resolution, null, {
        owner: getSessionContext(),
        operationId: operationId(`legacy-roll-consequence-${values.resolution}`),
      })
      : { status: "rejected", reason: "Последствие уже разрешено или больше не ожидается." };
  updateRollResult(result);
}

function handleAction(action, button = null) {
  if (action === "end-battle") {
    let owner;
    try {
      const identity = JSON.parse(button?.dataset.battleOwner ?? "");
      if (!Array.isArray(identity) || identity.length !== 2 ||
          typeof identity[0] !== "string" || !Number.isInteger(identity[1])) throw new Error();
      owner = { characterId: identity[0], sessionGeneration: identity[1] };
    } catch {
      const error = getWorkspaceHost()?.querySelector("[data-workspace-error]");
      if (error) { error.hidden = false; error.textContent = "Не удалось проверить владельца кнопки завершения боя."; }
      return;
    }
    const result = requestEndBattle({ owner, battleId: button?.dataset.battleId });
    if (result.status === "rejected" || result.status === "verification-required") {
      const error = getWorkspaceHost()?.querySelector("[data-workspace-error]");
      if (error) {
        error.hidden = false;
        error.textContent = result.status === "verification-required"
          ? "Не удалось подтвердить завершение боя. Повторное выполнение не выполнялось."
          : result.reason;
      }
    }
    return;
  }
  if (session?.workspaceType === "incoming" && action.startsWith("incoming-")) {
    handleIncomingAction(action, button);
    return;
  }
  if (!session) return;
  if (action === "minimize") {
    minimizeWorkspace();
  } else if (action === "close") {
    requestCloseWorkspace();
  } else if (action === "stay") {
    session.currentStep = session.returnStep ?? "summary";
    session.currentStepKey = session.returnStepKey ?? stepKey(session.currentStep, session.attackId);
    session.returnStep = null;
    session.returnStepKey = null;
    session.error = "";
    render();
    const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
    if (body) body.scrollTop = session.internalScrollByStep[session.currentStepKey] ?? 0;
    focusWorkspaceHeading();
  } else if (action === "confirm-close") {
    confirmClose();
  } else if (action === "submit-attack") {
    session.error = "Выберите исход атаки кнопкой «Попадание» или «Промах».";
    render();
  } else if (action === "attack-hit") {
    submitAttack("hit", button);
  } else if (action === "attack-miss") {
    submitAttack("miss", button);
  } else if (action.startsWith("attack-mode-")) {
    selectAttackMode(action.slice("attack-mode-".length));
  } else if (action.startsWith("roll-mode-")) {
    selectRollMode(action.slice("roll-mode-".length));
  } else if (action === "record-roll") {
    submitRollOutcome(button?.dataset.rollOutcome);
  } else if (action === "roll-outcome") {
    submitRollOutcome(button?.dataset.rollOutcome);
  } else if (action === "roll-edit-outcome") {
    if (session.currentStep === "roll-result" && session.rollRecord &&
        (session.rollRecord.manualOutcome != null || session.rollRecord.dcResult != null) &&
        !session.appliedUnsaved) {
      session.correctingOutcome = true;
      render();
    }
  } else if (action === "roll-cancel-outcome") {
    session.correctingOutcome = false;
    render();
  } else if (action === "roll-amend-mantle-preview" || action === "roll-amend-mantle") {
    applyRollAmendment("ll-monk:mantle-of-courtesy");
  } else if (action === "roll-amend-spirit-preview" || action === "roll-amend-spirit") {
    applyRollAmendment("ll-monk:indomitable-spirit");
  } else if (action === "roll-no-damage") {
    submitRollConsequence("no-damage");
  } else if (action === "roll-has-damage" || action === "roll-begin-damage") {
    submitRollConsequence("has-damage");
  } else if (action === "roll-apply-consequence") {
    submitRollConsequence("apply-to-character");
  } else if (action === "roll-track-consequence") {
    submitRollConsequence("tracked-elsewhere");
  } else if (action === "roll-defer") {
    minimizeWorkspace();
  } else if (action === "submit-damage") {
    submitDamage();
  } else if (action === "apply-command") {
    submitCommand();
  } else if (action === "edit-rest-replacement" &&
      session.command?.restStage === "offer") {
    session.scenarioId = buildRestReplacementCommandId("edit", session.command.restId);
    session.command = getCommandDescriptor(getState(), session.scenarioId);
    session.currentStepKey = stepKey("command-input", session.scenarioId);
    session.rawInputsByStep[session.currentStepKey] = {};
    session.error = "";
    render();
  } else if (action === "cancel-rest-replacement" &&
      session.command?.restStage === "edit") {
    session.scenarioId = buildRestReplacementCommandId("offer", session.command.restId);
    session.command = getCommandDescriptor(getState(), session.scenarioId);
    session.currentStepKey = stepKey("command-input", session.scenarioId);
    session.error = "";
    render();
  } else if (action === "decline-rest-replacement" &&
      session.currentStep === "command-input" &&
      session.command?.restStage === "offer" && !session.submitting &&
      !session.appliedUnsaved && requireOwner()) {
    const restId = session.command.restId;
    session.submitting = true;
    const result = declineSaraRestReplacement(session.owner, {
      id: operationId(`decline-rest:${restId}`),
      restId,
    });
    session.submitting = false;
    if (result.status !== "applied") setError(result.reason);
    else {
      refreshWorkspaceOwnerRevision();
      session.resultMessage = "Замена техники отклонена. Остальные последствия отдыха сохранены.";
      session.currentStep = "command-result";
      session.currentStepKey = stepKey("command-result", restId);
    }
    if (result.status === "applied") {
      session.appliedUnsaved = result.persistence?.ok === false;
    }
    render();
  } else if (action === "finish-short-rest" &&
      session.currentStep === "command-input" &&
      session.command?.restStage === "hit-die" && !session.submitting &&
      !session.appliedUnsaved && requireOwner()) {
    const restId = session.command.restId;
    session.submitting = true;
    const result = finishSaraShortRest(session.owner, {
      id: operationId(`finish-short-rest:${restId}`),
      restId,
    });
    session.submitting = false;
    if (result.status !== "applied") setError(result.reason);
    else {
      refreshWorkspaceOwnerRevision();
      session.resultMessage = "Лечение короткого отдыха завершено.";
      session.currentStep = "command-result";
      session.currentStepKey = stepKey("command-result", restId);
    }
    if (result.status === "applied") {
      session.appliedUnsaved = result.persistence?.ok === false;
    }
    render();
  } else if (action === "return-missile") {
    openMissileReturnForm();
  } else if (action === "decline-return-missile") {
    declineMissileReturn();
  } else if (action === "deflect-counter") {
    startDeflectCounter();
  } else if (action === "submit-missile-return") {
    submitMissileReturn();
  } else if (action === "apply-strike") {
    applyStrikeToCurrentHit();
  } else if (action === "begin-seeking") {
    beginSeekingStrikeRoute(button);
  } else if (action === "begin-gentling") {
    beginGentlingTouchRoute();
  } else if (action === "submit-seeking") {
    submitSeekingStrike();
  } else if (action === "submit-gentling") {
    submitGentlingTouch();
  } else if (action === "cancel-contextual" &&
      session.currentStep === "gentling-input" && !session.submitting &&
      !session.appliedUnsaved) {
    session.dirty = false;
    const returnTo = session.gentlingIntent?.returnTo;
    session.gentlingIntent = null;
    session.currentStep = returnTo?.step ??
      (getUsedAttackSlots(getSequence()) > 0 ? "checkpoint" : "attack-input");
    session.attackId = returnTo?.attackId ?? session.attackId;
    session.currentStepKey = returnTo?.stepKey ??
      stepKey(session.currentStep, session.attackId);
    render();
  } else if (action === "open-strike") {
    openStrikeInput();
  } else if (action === "no-technique-continue") {
    continueWithoutTechnique();
  } else if (action === "submit-roll-followup") {
    submitRollFollowup();
  } else if (action === "roll-amend-mantle") {
    applyRollAmendment("ll-monk:mantle-of-courtesy");
  } else if (action === "roll-amend-spirit") {
    applyRollAmendment("ll-monk:indomitable-spirit");
  } else if (action === "done") {
    confirmClose();
  } else if (action === "close-attack-remainder") {
    closeAttackRemainder();
  } else if (action === "outside-damage") {
    markDamageOutside();
  } else if (action === "next-attack") {
    nextAttack();
  } else if (action === "summary") {
    setStep("summary", session.attackId);
  } else if (action === "finish-workspace") {
    if (session.currentStep === "summary" && !session.submitting &&
        !session.appliedUnsaved) finishCurrentSession();
  } else if (action === "retry-save") {
    retrySave();
  } else if (action === "back") {
    if (session.currentStep === "damage-input" || session.currentStep === "attack-input") {
      minimizeWorkspace();
    } else if (session.currentStep === "checkpoint") {
      minimizeWorkspace();
    } else {
      minimizeWorkspace();
    }
  }
}

function handleHostAction(action, button) {
  handleAction(action, button);
}

export function reconcileWorkspaceAfterStateChange(state, metadata = null) {
  if (!session) return;
  if (!isWorkspaceOwnerCurrent(session.owner) || session.owner.appInstanceId !== appInstanceId) {
    disposeWorkspaceOwner(session.owner, "session-changed");
    return;
  }
  if (session.submitting) {
    session.deferredReconcile = true;
    updateWorkspaceResources(state, getDerivedStats(state).maxHitPoints);
    return;
  }
  if (session.workspaceType === "incoming") {
    if (!session.submitting) {
      syncIncomingPreviewFingerprint(session.incomingDraft, state, true);
    }
    if (metadata?.kind === "persistence-retry" && metadata.persistenceResult?.ok &&
        session.appliedUnsaved && session.incomingDraft.pendingOperationId &&
        session.incomingDraft.pendingNormalizedRequest) {
      try {
        const evidence = incomingReceiptEvidence(
          state,
          session.incomingDraft.pendingOperationId,
          session.incomingDraft.pendingNormalizedRequest,
        );
        if (evidence.status === "applied") {
          session.incomingDraft.appliedReceipt = evidence.receipt;
          session.appliedUnsaved = false;
          session.incomingDraft.stage = "result";
          session.status = "Сохранение выполнено.";
        } else {
          session.incomingDraft.stage = "verification";
          session.incomingDraft.error = evidence.reason ??
            "Сохранение выполнено, но применение не подтверждено.";
        }
      } catch (error) {
        session.incomingDraft.stage = "verification";
        session.incomingDraft.error = error instanceof Error ? error.message : String(error);
      }
    } else if (session.incomingDraft.stage !== "verification" &&
        !session.incomingDraft.appliedReceipt &&
        !incomingContextIsCurrent(session.incomingDraft, state, getSessionContext())) {
      session.incomingDraft.stage = "expired";
    }
    if (workspaceHostIsOpen()) render();
    return;
  }
  if (session.workspaceType === "attack") rehydrateFromState(state);
  if (metadata?.kind === "persistence-retry" && metadata.persistenceResult?.ok) {
    session.appliedUnsaved = false;
    session.status = "Сохранение выполнено.";
  }
  if (workspaceHostIsOpen()) {
    const host = getWorkspaceHost();
    const hp = host?.querySelector("[data-workspace-hp]");
    const ki = host?.querySelector("[data-workspace-ki]");
    const derived = getDerivedStats(state);
    if (hp) hp.textContent = `${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}`;
    if (ki) ki.textContent = String(state.combat?.ki?.current ?? "—");
  }
  if (session.workspaceType === "command" && session.currentStep === "command-input") {
    session.command = getCommandDescriptor(state, session.scenarioId) ?? session.command;
    if (workspaceHostIsOpen()) render();
    return;
  }
  if (!session.readOnly && session.currentStep === "attack-input") {
    const currentFingerprint = getRelevantFingerprint(
      state, session.sequenceId, session.firstAttempt,
    );
    if (currentFingerprint !== session.relevantPreviewFingerprint) {
      session.confirmationRequired = true;
      session.relevantPreviewFingerprint = currentFingerprint;
      if (workspaceHostIsOpen()) {
        const warning = getWorkspaceHost()?.querySelector(".workspace-warning");
        if (warning) warning.textContent =
          "Профиль или боевой контекст изменился. Проверьте обновлённый расчёт перед записью.";
        renderWorkspaceAttackPreview(session, state);
      }
    } else if (workspaceHostIsOpen()) {
      renderWorkspaceAttackPreview(session, state);
    }
  }
  if (session.currentStep === "damage-input" && workspaceHostIsOpen()) {
    renderWorkspaceDamagePreview(session);
  }
}

export function hasDirtyWorkspaceDraft(owner = null) {
  return getAllWorkspaceSessions().some((entry) => entry.dirty &&
    (!owner || (owner.characterId === entry.owner.characterId &&
      owner.sessionGeneration === entry.owner.sessionGeneration)));
}

export function hasUnsavedWorkspaceOperation(owner = null) {
  return getAllWorkspaceSessions().some((entry) => entry.appliedUnsaved &&
    (!owner || (owner.characterId === entry.owner.characterId &&
      owner.sessionGeneration === entry.owner.sessionGeneration)));
}

export function prepareWorkspaceCharacterTransition(target, continuation = null) {
  const sessions = getAllWorkspaceSessions();
  if (!sessions.length) return { ok: true };
  if (sessions.some((entry) => entry.appliedUnsaved)) {
    const saved = retryPersistedState();
    if (!saved.ok) return { ok: false, reason: "Изменение применено, но не сохранено. Переключение персонажа отменено." };
    for (const entry of sessions) entry.appliedUnsaved = false;
  }
  if (sessions.some((entry) => entry.dirty) &&
      !window.confirm("Есть незавершённый ввод. Остаться — Отмена. Закрыть без применения и перейти к другому персонажу?")) {
    return { ok: false, reason: "Переход отменён." };
  }
  if (continuation && session) session.pendingTransition = { target, continuation };
  return { ok: true };
}

export function disposeWorkspaceOwner(owner, reason = "disposed") {
  if (!owner) return false;
  const matchesOwner = (entry) => entry.owner.characterId === owner.characterId &&
    entry.owner.sessionGeneration === owner.sessionGeneration;
  const before = suspendedSessions.length + (session ? 1 : 0);
  for (let index = suspendedSessions.length - 1; index >= 0; index -= 1) {
    if (matchesOwner(suspendedSessions[index])) suspendedSessions.splice(index, 1);
  }
  if (session && matchesOwner(session)) {
    session.status = reason;
    session = null;
    closeWorkspaceHost({
      restoreFocus: !["session-changed", "character-transition", "character-picker", "character-reset", "battle-ended"].includes(reason),
      discardEmbedded: ["session-changed", "character-transition", "character-picker", "character-reset", "battle-ended"].includes(reason),
    });
  }
  return before !== suspendedSessions.length + (session ? 1 : 0);
}

export function isWorkspaceOpen() {
  return workspaceHostIsOpen();
}

function getWorkspaceSessionLabel(entry) {
  if (entry.appliedUnsaved) return "Сохранить применённый результат";
  if (entry.readOnly) return "Устаревшая рабочая панель · только просмотр";
  if (entry.currentStep === "attack-input" && entry.sequenceId) {
    const sequence = getWorkspaceAttackSequence(getState(), entry.sequenceId);
    if (sequence) {
      const next = getUsedAttackSlots(sequence) + 1;
      return `Продолжить атаку · удар ${next} из ${sequence.maximumAttacks}`;
    }
  }
  return entry.workspaceType === "command" && entry.currentStep === "roll-result"
      ? entry.rollRecord?.consequence?.status === "awaiting-outcome"
        ? "Указать исход броска" : "Продолжить последствие броска"
      : entry.currentStep === "damage-input" ? "Продолжить запись урона"
      : entry.currentStep === "attack-input" ? "Продолжить действие «Атака»"
        : "Продолжить рабочую панель атаки";
}

function getAllWorkspaceSessions() {
  return [...new Set([...(session ? [session] : []), ...suspendedSessions])];
}

function isUnrecordedWorkspaceDraft(entry) {
  if (entry.workspaceType === "incoming") return false;
  return entry.dirty === true && !entry.appliedUnsaved && !entry.submitting &&
    ["attack-input", "damage-input", "command-input", "strike-input",
      "seeking-input", "gentling-input"].includes(entry.currentStep);
}

export function discardWorkspaceDraft(workspaceSessionId) {
  const entry = getAllWorkspaceSessions().find((candidate) =>
    candidate.workspaceSessionId === workspaceSessionId);
  if (!entry || !isUnrecordedWorkspaceDraft(entry)) {
    return { ok: false, reason: "Эта панель больше не содержит удаляемого черновика." };
  }
  if (entry.rawInputsByStep && entry.currentStepKey) {
    entry.rawInputsByStep[entry.currentStepKey] = {};
  }
  entry.dirty = false;
  if (entry === session) {
    session = null;
    if (!restoreParentSession()) {
      closeWorkspaceHost({ restoreFocus: false });
      document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
    }
  } else {
    const index = suspendedSessions.indexOf(entry);
    if (index >= 0) suspendedSessions.splice(index, 1);
  }
  return { ok: true };
}

export function getWorkspaceSessions() {
  return getAllWorkspaceSessions().filter((entry) => entry.workspaceType !== "incoming").map((entry) => ({
    workspaceSessionId: entry.workspaceSessionId,
    label: getWorkspaceSessionLabel(entry),
    workspaceType: entry.workspaceType,
    scenarioId: entry.scenarioId ?? null,
    dirty: entry.dirty === true,
    draft: isUnrecordedWorkspaceDraft(entry),
    appliedUnsaved: entry.appliedUnsaved === true,
    minimized: entry.minimized === true,
    suspended: entry.suspended === true,
    sequenceId: entry.sequenceId ?? null,
    attackId: ["damage-input", "seeking-input"].includes(entry.currentStep)
      ? entry.attackId ?? null : null,
    stage: entry.currentStep ?? null,
    group: entry.appliedUnsaved ? "save-recovery"
      : ["damage-input", "seeking-input"].includes(entry.currentStep) ? "required"
        : isUnrecordedWorkspaceDraft(entry) ? "drafts" : "continuations",
  }));
}

export function getActiveWorkspaceSession() {
  if (!session || session.minimized || session.suspended) return null;
  return {
    workspaceSessionId: session.workspaceSessionId,
    appliedUnsaved: session.appliedUnsaved === true,
    workspaceType: session.workspaceType,
  };
}

export function getMinimizedWorkspaceSessions() {
  return getAllWorkspaceSessions()
    .filter((entry) => entry.workspaceType !== "incoming")
    .filter((entry) => entry.minimized || entry.suspended)
    .map((entry) => ({
      workspaceSessionId: entry.workspaceSessionId,
      label: getWorkspaceSessionLabel(entry),
      workspaceType: entry.workspaceType,
      scenarioId: entry.scenarioId ?? null,
      dirty: entry.dirty === true,
      draft: isUnrecordedWorkspaceDraft(entry),
      appliedUnsaved: entry.appliedUnsaved === true,
      minimized: entry.minimized === true,
      suspended: entry.suspended === true,
      sequenceId: entry.sequenceId ?? null,
      attackId: ["damage-input", "seeking-input"].includes(entry.currentStep)
        ? entry.attackId ?? null : null,
      stage: entry.currentStep ?? null,
      group: entry.appliedUnsaved ? "save-recovery"
        : ["damage-input", "seeking-input"].includes(entry.currentStep) ? "required"
          : isUnrecordedWorkspaceDraft(entry) ? "drafts" : "continuations",
    }));
}

export function getMinimizedWorkspaceSession() {
  return getMinimizedWorkspaceSessions()[0] ?? null;
}

export function initActionWorkspace() {
  return initWorkspaceHost({
    onAction: handleHostAction,
    onInput: updateInput,
    onSubmit: handleSubmit,
  });
}

export function getWorkspaceSessionForTests() {
  return session ? structuredClone(session) : null;
}
