import { getDerivedStats } from "../calculations.js";
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
  continueDeflectMissile,
} from "../actions/monk.js";
import {
  commitDeflection,
  commitRegeneration,
  correctSaraResource,
  applyTechniqueToHit,
  recordTargetSaveOutcome,
  recordBasicSaraAction,
  startAttackSequence,
} from "../actions/sara-combat.js";
import { getSaraBattleCommandRegistry } from "../battle/command-registry.js";
import {
  amendCharacterRoll,
  correctCharacterRollOutcome,
  recordCharacterRoll,
  resolveCharacterRollConsequence,
} from "../rolls/commands.js";
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
} from "./host.js";
import {
  renderCommandWorkspace,
} from "../render/render-command-workspace.js";
import {
  renderAttackWorkspace,
  renderWorkspaceAttackPreview,
  renderWorkspaceDamagePreview,
} from "../render/render-attack-workspace.js";
import { retryPersistedState, getState } from "../state.js";
import { MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";

const appInstanceId = createId("workspace-app");
let session = null;

function createId(prefix) {
  return globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stepKey(step, attackId = null) {
  return `${step}:${attackId ?? "none"}`;
}

function getStepDraft() {
  session.rawInputsByStep[session.currentStepKey] ??= {};
  return session.rawInputsByStep[session.currentStepKey];
}

function parseForm(form) {
  const values = {};
  for (const control of form.elements) {
    if (!control.name) continue;
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
      entry.id === rollId && entry.kind === "saving-throw" &&
      entry.consequence?.status === "pending" && typeof entry.dcResult === "boolean");
    if (!roll) return null;
    return {
      id: commandId,
      scenarioId: commandId,
      titleRu: "Последствие спасброска",
      navigationGroups: [],
      activationBudget: "none",
      resourceCost: "Без расхода",
      trigger: "Применить урон с учётом временных HP или отметить учёт вне листа.",
      parentRequirement: roll.id,
      availability: { enabled: true, reasonCode: null, reasonRu: "" },
    };
  }
  return getSaraBattleCommandRegistry(state).find((entry) => entry.id === commandId) ?? null;
}

function sequenceCurrentForAttack(sequence, state) {
  if (!sequence || sequence.kind !== (session?.sequenceKind ?? "attack-action") ||
      sequence.status !== "open" ||
      Number(sequence.turnMarker) !== Number(state.ui?.turn?.turnNumber ?? 1)) return false;
  const battle = state.battleConsole?.current;
  if (sequence.battleId) {
    const phaseValid = sequence.kind === "reaction-unarmed"
      ? ["waiting", "own-turn"].includes(battle?.phase)
      : battle?.phase === "own-turn";
    return battle?.id === sequence.battleId && phaseValid &&
      (!sequence.ownTurnId || battle.ownTurnId === sequence.ownTurnId);
  }
  return !battle || (sequence.kind === "reaction-unarmed"
    ? ["waiting", "own-turn"].includes(battle.phase)
    : battle.phase === "own-turn");
}

function setStep(step, attackId = session.attackId) {
  const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (body && session.currentStepKey) {
    session.internalScrollByStep[session.currentStepKey] = body.scrollTop;
  }
  session.currentStep = step;
  session.attackId = attackId;
  session.currentStepKey = stepKey(step, attackId);
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
  const view = session.workspaceType === "command"
    ? renderCommandWorkspace(session, state)
    : renderAttackWorkspace(session, state);
  renderWorkspaceHost({ ...view, status: session.status ?? "" });
  const derived = getDerivedStats(state);
  const hp = document.querySelector("#actionWorkspaceRoot [data-workspace-hp]");
  const ki = document.querySelector("#actionWorkspaceRoot [data-workspace-ki]");
  if (hp) hp.textContent = `${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}`;
  if (ki) ki.textContent = String(state.combat?.ki?.current ?? "—");
  if (session.currentStep === "attack-input") renderWorkspaceAttackPreview(session, state);
  if (session.currentStep === "damage-input") renderWorkspaceDamagePreview(session);
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
      ["firstD20", "secondD20", "rollMode"].includes(field.name)) {
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
    draft.id = "strength";
    draft.rollMode = "advantage";
  }
  session.dirty = true;
  session.error = "";
  if (field.name === "rollMode") {
    const secondRoll = getWorkspaceHost()?.querySelector("[data-workspace-second-d20]");
    const secondInput = secondRoll?.querySelector('input[name="secondD20"]');
    const needsSecond = field.value === "advantage" || field.value === "disadvantage";
    if (secondRoll) secondRoll.hidden = !needsSecond;
    if (secondInput) secondInput.required = needsSecond;
  }
  if (session.currentStep === "attack-input") {
    renderWorkspaceAttackPreview(session, getState());
  } else if (session.currentStep === "damage-input") {
    renderWorkspaceDamagePreview(session);
  } else if (session.currentStep === "strike-input" &&
      ["techniqueId", "paymentMode"].includes(field.name)) {
    render();
  } else if (session.workspaceType === "command" &&
      ["kind", "spellSaveSource"].includes(field.name)) {
    render();
  }
}

function findSequenceAndDamage(state, options = {}) {
  const explicitSequence = options.sequenceId
    ? getNormalAttackSequence(state, options.sequenceId) : null;
  if (options.sequenceId && !explicitSequence) return { error: "Последовательность обычной атаки не найдена." };
  if (options.attackId) {
    const pending = findAwaitingNormalDamage(state, {
      sequenceId: options.sequenceId ?? null,
      attackId: options.attackId,
    });
    if (!pending) return { error: "Выбранный удар больше не ожидает записи урона." };
    return {
      sequence: pending.sequence,
      attack: pending.attack,
      historical: !sequenceCurrentForAttack(pending.sequence, state),
    };
  }
  if (explicitSequence) {
    const pending = findAwaitingNormalDamage(state, { sequenceId: explicitSequence.id });
    if (pending) {
      return { ...pending, historical: !sequenceCurrentForAttack(explicitSequence, state) };
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
  if (currentOwnerSession) {
    if (session.workspaceType === "command") {
      if (session.scenarioId === "normal-attack") {
        return { ok: false, reason: "Сначала завершите текущую команду рабочего пространства." };
      }
      if (session.dirty || session.appliedUnsaved) {
        return { ok: false, reason: "Сначала завершите или отмените незаписанный ввод текущего сценария." };
      }
      return { ok: false, reason: "Сначала закройте текущую команду рабочего пространства." };
    }
    if (!explicitTarget) return resumeWorkspace(session.workspaceSessionId);
    const sameSequence = selectedSequence?.id === session.sequenceId;
    const sameAttack = selected.attack
      ? selected.attack.id === session.attackId
      : sameSequence && !session.selectedDamage;
    const sameMode = session.historicalOnly === historicalOnly;
    if (sameSequence && sameAttack && sameMode) {
      return resumeWorkspace(session.workspaceSessionId);
    }
    if (session.dirty || session.appliedUnsaved) {
      return { ok: false, reason: "Сначала завершите или отмените незаписанный ввод текущего удара." };
    }
  }
  if (!initWorkspaceHost({ onAction: handleAction, onInput: updateInput, onSubmit: handleSubmit })) {
    return { ok: false, reason: "Рабочая панель не смонтирована." };
  }
  const selectedAttack = selected.attack ?? null;
  const nextAttack = selectedSequence?.resolvedAttacks?.length ?? 0;
  const attackIdForDraft = selectedAttack?.id ??
    selectedSequence?.resolvedAttacks?.[nextAttack]?.id ?? createId("sara-attack");
  const firstAttempt = !selectedSequence;
  const available = !selectedSequence || sequenceCurrentForAttack(selectedSequence, state);
  session = {
    workspaceSessionId: createId("attack-workspace"),
    workspaceType: "attack",
    owner: { ...owner, appInstanceId },
    battleContext: {
      battleId: state.battleConsole?.current?.id ?? null,
      ownTurnId: state.battleConsole?.current?.ownTurnId ?? null,
    },
    sequenceId: selectedSequence?.id ?? createId("sara-normal-attack"),
    sequenceKind: "attack-action",
    attackId: attackIdForDraft,
    currentStep: selectedAttack ? "damage-input"
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
    readOnly: historical || !available,
    isExistingSequence: Boolean(selectedSequence),
    firstAttempt,
    confirmationRequired: false,
    error: "",
    status: historicalOnly ? "Историческое восстановление: можно записать только ожидающий урон."
      : !available ? "Ход завершён. Оставшиеся атаки нельзя продолжить; сохранённые результаты доступны для просмотра." : "",
    selectedDamage: selectedAttack ? { sequence: selectedSequence, attack: selectedAttack } : null,
  };
  session.currentStepKey = stepKey(session.currentStep, session.attackId);
  session.stepLabel = ({
    "attack-input": "Физический бросок · проверка попадания",
    "damage-input": "Физические кости урона",
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

export function openSaraBattleCommand(commandId, invoker = null) {
  if (commandId === "normal-attack") return openNormalAttack({ invoker });
  const state = getState();
  const owner = getWorkspaceAttackContext();
  const command = getCommandDescriptor(state, commandId);
  if (!command) return { ok: false, reason: "Неизвестная команда боевого пульта." };
  if (!command.availability.enabled) {
    return { ok: false, reason: command.availability.reasonRu || "Команда сейчас недоступна." };
  }
  if (!isWorkspaceOwnerCurrent(owner)) {
    return { ok: false, reason: "Сеанс персонажа изменился. Команда не открыта." };
  }
  if (session && session.owner.characterId === owner.characterId &&
      session.owner.sessionGeneration === owner.sessionGeneration) {
    if (session.workspaceType === "command" && session.scenarioId === commandId) {
      return resumeWorkspace(session.workspaceSessionId);
    }
    if (session.dirty || session.appliedUnsaved) {
      return { ok: false, reason: "Сначала завершите или отмените незаписанный ввод текущего сценария." };
    }
    return { ok: false, reason: "Сначала сверните или завершите текущую последовательность." };
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
    sequenceId: createId(`sara-${commandId}`),
    sequenceKind: commandId,
    attackId: createId("sara-attack"),
    currentStep: "command-input",
    currentStepKey: stepKey("command-input", commandId),
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
    session.rawInputsByStep[session.currentStepKey] = {
      kind: "ability-check",
      id: "strength",
      rollMode: "normal",
      consequenceProfile: "none",
      firstD20: "",
      secondD20: "",
      dc: "",
      incomingDamage: "",
      spellSaveSource: false,
      advantageReason: "",
      disadvantageReason: "",
    };
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

export function minimizeWorkspace() {
  if (!session) return false;
  const body = getWorkspaceHost()?.querySelector("[data-workspace-body]");
  if (body) session.internalScrollByStep[session.currentStepKey] = body.scrollTop;
  session.minimized = true;
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
  minimizeWorkspaceHost();
  return true;
}

export function requestCloseWorkspace() {
  if (!session) return false;
  session.returnStep = session.currentStep;
  session.returnStepKey = session.currentStepKey;
  setStep("confirm-close", session.attackId);
  return true;
}

export function resumeWorkspace(workspaceSessionId) {
  if (!session || session.workspaceSessionId !== workspaceSessionId ||
      !isWorkspaceOwnerCurrent(session.owner) || session.owner.appInstanceId !== appInstanceId) {
    return { ok: false, reason: "Рабочая панель относится к другому сеансу персонажа." };
  }
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
      sequence.resolvedAttacks.length < sequence.maximumAttacks;
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
    sequence.resolvedAttacks.length < sequence.maximumAttacks;
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
    state, session.sequenceId, !sequence.resolvedAttacks.length,
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
    sequenceAfter.resolvedAttacks.length < sequenceAfter.maximumAttacks;
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

function submitCommand() {
  if (!session || session.workspaceType !== "command" || session.submitting ||
      session.appliedUnsaved || !requireOwner()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="command"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
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
  const operation = operationId(`apply:${id}`);
  if (id === "mystic-regeneration") {
    result = commitRegeneration(session.owner, values.dieResult, operation, {
      confirmNoHealing: values.confirmNoHealing === true,
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
    result = recordCharacterRoll(values);
  } else if (id === "resource-correction") {
    result = correctSaraResource(session.owner, values.resourceId, values.value, operation);
  } else {
    result = { status: "rejected", reason: "Для этой команды ещё нет подключённого исполнителя." };
  }
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  if (session.workspaceType === "attack") {
    session.dirty = false;
    session.appliedUnsaved = result.persistence?.ok === false;
    render();
    return;
  }
  session.dirty = false;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.resultMessage = commandOutcomeSummary(result);
  session.error = "";
  session.status = result.persistence?.ok === false ? "Применено, но не сохранено." : "";
  session.currentStep = id === "character-roll" ? "roll-result" : "command-result";
  session.rollRecord = id === "character-roll" ? result.record : null;
  session.currentStepKey = stepKey(session.currentStep, session.scenarioId);
  session.canReturnMissile = result.outcome?.techniqueResult?.canCatch === true &&
    id === "deflect-missile" && values.mode === "weapon";
  session.canDeflectCounter = result.outcome?.techniqueResult?.canCounterattack === true &&
    id === "deflect-strike";
  session.parentOperationId = operation;
  session.returnContinuationId = operation;
  session.dirty = false;
  render();
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
  const result = continueDeflectMissile(session.owner, session.returnContinuationId,
    values.attackRoll, values.targetArmorClass,
    {
      dmHitResult: values.dmHitResult || null,
      damageRolls: [values.damage1, ...(values.damage2 ? [values.damage2] : [])],
      proficiencyConfirmed: values.proficiencyConfirmed === true,
    });
  session.submitting = false;
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  session.dirty = false;
  session.appliedUnsaved = result.persistence?.ok === false;
  session.canReturnMissile = false;
  session.resultMessage = result.outcome.hits
    ? `Снаряд возвращён: попадание${result.outcome.critical ? " (критическое)" : ""}; урон ${result.outcome.damageTotalBeforeTargetModifiers ?? "ожидает результата цели"}.`
    : "Снаряд возвращён: промах.";
  session.currentStep = "command-result";
  session.currentStepKey = stepKey("command-result", session.returnContinuationId);
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
  if (form.dataset.workspaceForm === "attack") {
    session.error = "Итог рассчитан. Выберите «Попадание» или «Промах» после ответа ведущего.";
    render();
  }
  if (form.dataset.workspaceForm === "damage") submitDamage();
  if (form.dataset.workspaceForm === "command") submitCommand();
  if (form.dataset.workspaceForm === "missile-return") submitMissileReturn();
}

function nextAttack() {
  if (!session || session.appliedUnsaved || !requireOwner() ||
      !["checkpoint", "strike-input"].includes(session.currentStep) ||
      !session.capabilities.canContinueSequence || session.historicalOnly) return;
  const state = getState();
  const sequence = getSequence(state);
  if (!sequenceCurrentForAttack(sequence, state) ||
      sequence.resolvedAttacks.length >= sequence.maximumAttacks) {
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
  const sequence = getSequence();
  if (sequence?.status === "open" &&
      sequence.resolvedAttacks.length < sequence.maximumAttacks) {
    if (!requireOwner() || session.appliedUnsaved) {
      setError("Сначала сохраните применённое изменение.");
      render();
      return;
    }
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
    session.appliedUnsaved = result.persistence?.ok === false;
    if (session.appliedUnsaved) {
      setError("Последовательность закрыта в памяти, но не сохранена. Повторите сохранение перед закрытием панели.");
      render();
      return;
    }
  }
  session = null;
  document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
  closeWorkspaceHost();
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
    setError(result.reason);
    render();
    return;
  }
  session.rollRecord = result.record;
  session.resultMessage = `${result.record.label}: к20 ${result.record.rawD20Rolls.join(" и ")}; итог ${result.record.total}` +
    (result.record.dc == null ? "" : ` против СЛ ${result.record.dc}: ${result.record.dcResult ? "успех" : "провал"}.`);
  session.appliedUnsaved = result.persistence?.ok === false;
  session.error = "";
  session.status = session.appliedUnsaved ? "Применено, но не сохранено." : "";
  render();
}

function applyRollAmendment(techniqueId) {
  if (!session?.rollRecord || session.appliedUnsaved || !requireOwner()) return;
  updateRollResult(amendCharacterRoll(session.rollRecord.id, techniqueId));
}

function submitRollFollowup() {
  if (!session?.rollRecord || session.appliedUnsaved || !requireOwner()) return;
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="roll-followup"]');
  if (!form) return;
  const values = parseForm(form);
  const record = session.rollRecord;
  const result = record.consequence?.status === "awaiting-outcome"
    ? correctCharacterRollOutcome(record.id, values.outcome)
    : record.consequence?.status === "pending"
      ? resolveCharacterRollConsequence(record.id, values.resolution)
      : { status: "rejected", reason: "Последствие уже разрешено или больше не ожидается." };
  updateRollResult(result);
}

function handleAction(action, button = null) {
  if (!session) return;
  if (action === "minimize") {
    minimizeWorkspace();
  } else if (action === "close") {
    requestCloseWorkspace();
  } else if (action === "stay") {
    setStep(session.returnStep ?? "summary", session.attackId);
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
  } else if (action === "submit-damage") {
    submitDamage();
  } else if (action === "apply-command") {
    submitCommand();
  } else if (action === "return-missile") {
    openMissileReturnForm();
  } else if (action === "deflect-counter") {
    startDeflectCounter();
  } else if (action === "submit-missile-return") {
    submitMissileReturn();
  } else if (action === "apply-strike") {
    applyStrikeToCurrentHit();
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
    if (session.currentStep === "command-result" && session.canReturnMissile) {
      openMissileReturnForm();
    } else {
      confirmClose();
    }
  } else if (action === "outside-damage") {
    markDamageOutside();
  } else if (action === "next-attack") {
    nextAttack();
  } else if (action === "summary") {
    setStep("summary", session.attackId);
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
  if (metadata?.kind === "persistence-retry" && metadata.persistenceResult?.ok) {
    session.appliedUnsaved = false;
    session.status = "Сохранение выполнено.";
  }
  if (workspaceHostIsOpen()) {
    const hp = document.querySelector("#actionWorkspaceRoot [data-workspace-hp]");
    const ki = document.querySelector("#actionWorkspaceRoot [data-workspace-ki]");
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
        const warning = document.querySelector("#actionWorkspaceRoot .workspace-warning");
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
  return Boolean(session && session.dirty &&
    (!owner || (owner.characterId === session.owner.characterId &&
      owner.sessionGeneration === session.owner.sessionGeneration)));
}

export function hasUnsavedWorkspaceOperation(owner = null) {
  return Boolean(session && session.appliedUnsaved &&
    (!owner || (owner.characterId === session.owner.characterId &&
      owner.sessionGeneration === session.owner.sessionGeneration)));
}

export function prepareWorkspaceCharacterTransition(target, continuation = null) {
  if (!session) return { ok: true };
  if (session.appliedUnsaved) {
    const saved = retryPersistedState();
    if (!saved.ok) return { ok: false, reason: "Изменение применено, но не сохранено. Переключение персонажа отменено." };
    session.appliedUnsaved = false;
  }
  if (session.dirty && !window.confirm("Есть незавершённый ввод. Остаться — Отмена. Закрыть без применения и перейти к другому персонажу?")) {
    return { ok: false, reason: "Переход отменён." };
  }
  if (continuation) session.pendingTransition = { target, continuation };
  return { ok: true };
}

export function disposeWorkspaceOwner(owner, reason = "disposed") {
  if (!session || !owner ||
      owner.characterId !== session.owner.characterId ||
      owner.sessionGeneration !== session.owner.sessionGeneration) return false;
  session.status = reason;
  session = null;
  closeWorkspaceHost({
    restoreFocus: !["session-changed", "character-transition", "character-picker", "character-reset"].includes(reason),
  });
  return true;
}

export function isWorkspaceOpen() {
  return workspaceHostIsOpen();
}

export function getMinimizedWorkspaceSession() {
  if (!session || !session.minimized) return null;
  return {
    workspaceSessionId: session.workspaceSessionId,
    label: session.currentStep === "damage-input" ? "Продолжить запись урона"
      : session.currentStep === "attack-input" ? "Продолжить действие «Атака»"
        : "Продолжить рабочую панель атаки",
  };
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
