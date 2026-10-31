import { getDerivedStats } from "../calculations.js";
import {
  getWorkspaceAttackContext,
  getNormalAttackFingerprint,
  getNormalAttackSequence,
  findAwaitingNormalDamage,
  isWorkspaceOwnerCurrent,
  calculateWorkspaceDamagePreview,
  submitWorkspaceAttack,
  submitWorkspaceDamage,
  markWorkspaceDamageOutside,
  abandonWorkspaceSequence,
} from "./attack-adapter.js";
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
  renderAttackWorkspace,
  renderWorkspaceAttackPreview,
  renderWorkspaceDamagePreview,
} from "../render/render-attack-workspace.js";
import { retryPersistedState, getState } from "../state.js";

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
  return session?.sequenceId ? getNormalAttackSequence(state, session.sequenceId) : null;
}

function sequenceCurrentForAttack(sequence, state) {
  if (!sequence || sequence.kind !== "attack-action" ||
      sequence.status !== "open" ||
      Number(sequence.turnMarker) !== Number(state.ui?.turn?.turnNumber ?? 1)) return false;
  const battle = state.battleConsole?.current;
  if (sequence.battleId) {
    return battle?.id === sequence.battleId &&
      battle.phase === "own-turn" && battle.ownTurnId === sequence.ownTurnId;
  }
  return !battle || battle.phase === "own-turn";
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
    summary: "Записанные удары и оставшиеся задачи",
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
  const view = renderAttackWorkspace(session, state);
  renderWorkspaceHost({ ...view, status: session.status ?? "" });
  const derived = getDerivedStats(state);
  const hp = document.querySelector("#actionWorkspaceRoot [data-workspace-hp]");
  const ki = document.querySelector("#actionWorkspaceRoot [data-workspace-ki]");
  if (hp) hp.textContent = `${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}`;
  if (ki) ki.textContent = String(state.combat?.ki?.current ?? "—");
  if (session.currentStep === "attack-input") renderWorkspaceAttackPreview(session, state);
  if (session.currentStep === "damage-input") renderWorkspaceDamagePreview(session);
}

function updateInput(field) {
  if (!session || session.submitting) return;
  const draft = getStepDraft();
  draft[field.name] = field.type === "checkbox" ? field.checked : field.value;
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
    return { sequence: pending.sequence, attack: pending.attack, historical: true };
  }
  if (explicitSequence) {
    const pending = findAwaitingNormalDamage(state, { sequenceId: explicitSequence.id });
    if (pending) return { ...pending, historical: true };
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
  const rollPanel = document.getElementById("characterRollsRoot");
  if (rollPanel && !rollPanel.hidden) {
    return { ok: false, reason: "Сначала закройте панель проверки или сверните её безопасно." };
  }
  if (session && session.owner.characterId === owner.characterId &&
      session.owner.sessionGeneration === owner.sessionGeneration) {
    if (workspaceHostIsOpen()) return { ok: true, sessionId: session.workspaceSessionId };
    return resumeWorkspace(session.workspaceSessionId);
  }
  if (!initWorkspaceHost({ onAction: handleAction, onInput: updateInput, onSubmit: handleSubmit })) {
    return { ok: false, reason: "Рабочая панель не смонтирована." };
  }
  const selected = findSequenceAndDamage(state, { sequenceId, attackId });
  if (selected.error) return { ok: false, reason: selected.error };
  const selectedSequence = selected.sequence ?? null;
  const historical = mode === "historical-damage" || selected.historical === true;
  if (!selectedSequence && !canOpenNewSequence(state)) {
    return { ok: false, reason: "Обычную атаку можно начать только в свой ход." };
  }
  const selectedAttack = selected.attack ?? null;
  const nextAttack = selectedSequence?.resolvedAttacks?.length ?? 0;
  const attackIdForDraft = selectedAttack?.id ??
    selectedSequence?.resolvedAttacks?.[nextAttack]?.id ?? createId("sara-attack");
  const firstAttempt = !selectedSequence;
  const available = !selectedSequence || sequenceCurrentForAttack(selectedSequence, state);
  session = {
    workspaceSessionId: createId("attack-workspace"),
    owner: { ...owner, appInstanceId },
    battleContext: {
      battleId: state.battleConsole?.current?.id ?? null,
      ownTurnId: state.battleConsole?.current?.ownTurnId ?? null,
    },
    sequenceId: selectedSequence?.id ?? createId("sara-normal-attack"),
    attackId: attackIdForDraft,
    currentStep: selectedAttack ? "damage-input"
      : !historical && (!selectedSequence || available &&
        selectedSequence.status === "open" && nextAttack < selectedSequence.maximumAttacks)
        ? "attack-input" : "summary",
    currentStepKey: "",
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
    readOnly: historical || !available,
    historicalMode: historical || !available,
    isExistingSequence: Boolean(selectedSequence),
    firstAttempt,
    confirmationRequired: false,
    error: "",
    status: historical ? "Историческое попадание: можно записать только ожидающий урон."
      : !available ? "Ход завершён. Оставшиеся атаки нельзя продолжить; сохранённые результаты доступны для просмотра." : "",
    selectedDamage: selectedAttack ? { sequence: selectedSequence, attack: selectedAttack } : null,
  };
  session.currentStepKey = stepKey(session.currentStep, session.attackId);
  session.stepLabel = ({
    "attack-input": "Физический бросок · проверка попадания",
    "damage-input": "Физические кости урона",
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
  rehydrateFromState(state);
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
      const currentFingerprint = getNormalAttackFingerprint(state, session.sequenceId, true);
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
    return;
  }
  const pending = findAwaitingNormalDamage(state, { sequenceId: sequence.id });
  if (pending) {
    session.selectedDamage = pending;
    session.attackId = pending.attack.id;
    session.currentStep = "damage-input";
    session.currentStepKey = stepKey("damage-input", pending.attack.id);
    return;
  }
  session.selectedDamage = null;
  if (sequence.status === "open" && sequenceCurrentForAttack(sequence, state) &&
      sequence.resolvedAttacks.length < sequence.maximumAttacks) {
    session.attackId = createId("sara-attack");
    session.currentStep = "attack-input";
    session.currentStepKey = stepKey("attack-input", session.attackId);
    session.rawInputsByStep[session.currentStepKey] ??= {};
  } else {
    session.currentStep = "summary";
    session.currentStepKey = stepKey("summary", session.attackId);
    session.readOnly = true;
  }
  session.relevantPreviewFingerprint = getNormalAttackFingerprint(
    state, session.sequenceId, !sequence.resolvedAttacks.length,
  );
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

function submitAttack() {
  if (!session || session.submitting || session.appliedUnsaved || session.readOnly) return;
  const state = getState();
  if (!requireOwner()) {
    setError("stale-session");
    render();
    return;
  }
  const form = getWorkspaceHost()?.querySelector('[data-workspace-form="attack"]');
  if (!form) return;
  const values = parseForm(form);
  session.rawInputsByStep[session.currentStepKey] = values;
  session.dirty = true;
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
  const nextFingerprint = getNormalAttackFingerprint(state, session.sequenceId, !sequence);
  if (nextFingerprint !== session.relevantPreviewFingerprint || session.confirmationRequired) {
    if (nextFingerprint !== session.relevantPreviewFingerprint) {
      session.relevantPreviewFingerprint = nextFingerprint;
      session.confirmationRequired = true;
      session.error = "Профиль или боевой контекст изменился. Проверьте новый расчёт и нажмите запись ещё раз.";
      render();
      return;
    }
    session.confirmationRequired = false;
  }
  const currentAttackId = session.attackId;
  const intent = `attack:${currentAttackId}`;
  session.submitting = true;
  session.deferredReconcile = false;
  const result = submitWorkspaceAttack(
    session.owner,
    session.sequenceId,
    currentAttackId,
    values,
    operationId(intent),
  );
  session.submitting = false;
  const after = getState();
  if (result.status !== "applied") {
    setError(result.reason);
    render();
    return;
  }
  session.dirty = false;
  session.firstAttempt = false;
  session.isExistingSequence = true;
  session.appliedUnsaved = result.persistence?.ok === false;
  const sequenceAfter = getNormalAttackSequence(after, session.sequenceId);
  const attack = sequenceAfter?.resolvedAttacks?.find((entry) => entry.id === currentAttackId);
  if (!attack) {
    setError("Атака применена, но запись не найдена в текущем состоянии.");
    render();
    return;
  }
  session.relevantPreviewFingerprint = getNormalAttackFingerprint(after, session.sequenceId, false);
  if (attack.hitResult === "hit" && attack.damageStatus === "awaiting-damage") {
    session.selectedDamage = { sequence: sequenceAfter, attack };
    setStep("damage-input", attack.id);
  } else {
    session.selectedDamage = null;
    setStep("checkpoint", attack.id);
  }
}

function submitDamage() {
  if (!session || session.submitting || session.appliedUnsaved || !requireOwner()) return;
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
  session.appliedUnsaved = result.persistence?.ok === false;
  session.dirty = false;
  session.selectedDamage = null;
  setStep("checkpoint", attack.id);
}

function markDamageOutside() {
  if (!session || session.submitting || session.appliedUnsaved ||
      !session.selectedDamage || !requireOwner()) return;
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
  session.appliedUnsaved = result.persistence?.ok === false;
  session.selectedDamage = null;
  session.dirty = false;
  setStep("checkpoint", attack.id);
}

function handleSubmit(form) {
  if (form.dataset.workspaceForm === "attack") submitAttack();
  if (form.dataset.workspaceForm === "damage") submitDamage();
}

function nextAttack() {
  if (!session || session.appliedUnsaved || !requireOwner()) return;
  const state = getState();
  const sequence = getSequence(state);
  if (!sequenceCurrentForAttack(sequence, state) ||
      sequence.resolvedAttacks.length >= sequence.maximumAttacks) {
    session.readOnly = true;
    setError("Текущая последовательность больше не допускает новый удар.");
    render();
    return;
  }
  const unresolved = findAwaitingNormalDamage(state, { sequenceId: sequence.id });
  if (unresolved) {
    session.selectedDamage = unresolved;
    setStep("damage-input", unresolved.attack.id);
    return;
  }
  const newAttackId = createId("sara-attack");
  session.rawInputsByStep[stepKey("attack-input", newAttackId)] = {};
  session.relevantPreviewFingerprint = getNormalAttackFingerprint(state, sequence.id, false);
  session.dirty = false;
  setStep("attack-input", newAttackId);
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

function handleAction(action) {
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
    submitAttack();
  } else if (action === "submit-damage") {
    submitDamage();
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

function handleSubmitFromAction(action) {
  if (action === "submit-attack") submitAttack();
}

function handleHostAction(action) {
  if (action === "submit-attack") handleSubmitFromAction(action);
  else handleAction(action);
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
  if (!session.readOnly && session.currentStep === "attack-input") {
    const currentFingerprint = getNormalAttackFingerprint(
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
