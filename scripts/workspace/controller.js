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
  getBattlePhaseReason,
  continueDeflectMissile,
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
} from "../actions/sara-combat.js";
import { getSaraBattleCommandRegistry } from "../battle/command-registry.js";
import { getActiveBattle } from "../battle/model.js";
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
} from "../render/render-command-workspace.js";
import {
  renderAttackWorkspace,
  renderWorkspaceAttackPreview,
  renderWorkspaceDamagePreview,
} from "../render/render-attack-workspace.js";
import { getSessionContext, retryPersistedState, getState } from "../state.js";
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

const appInstanceId = createId("workspace-app");
let session = null;
const suspendedSessions = [];

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

function restoreParentSession() {
  while (suspendedSessions.length) {
    const parent = suspendedSessions.pop();
    if (!isWorkspaceOwnerCurrent(parent.owner) ||
        parent.owner.appInstanceId !== appInstanceId) continue;
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

function finishCurrentSession() {
  session = null;
  if (restoreParentSession()) return;
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
  if (/^rest-hit-die:/.test(commandId) ||
      /^rest-replacement-(offer|edit):/.test(commandId)) {
    const [kind, second, ...restParts] = commandId.split(":");
    const stage = kind === "rest-hit-die" ? "hit-die" : second;
    const restId = kind === "rest-hit-die" ? [second, ...restParts].join(":") : restParts.join(":");
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
        enabled: Boolean(valid && (kind !== "rest-hit-die" || diceAvailable)),
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
  const parent = [...suspendedSessions].reverse().find((entry) =>
    isWorkspaceOwnerCurrent(entry.owner) && entry.owner.appInstanceId === appInstanceId);
  session.completionLabel = parent
    ? `Вернуться к ${parent.command?.titleRu ?? "рабочей панели"}`
    : "Готово";
  const view = session.workspaceType === "command"
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
    ]),
  });
  session.forceWorkspaceBodyRender = false;
  const derived = getDerivedStats(state);
  const host = getWorkspaceHost();
  const hp = host?.querySelector("[data-workspace-hp]");
  const ki = host?.querySelector("[data-workspace-ki]");
  if (hp) hp.textContent = `${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}`;
  if (ki) ki.textContent = String(state.combat?.ki?.current ?? "—");
  if (session.currentStep === "attack-input") renderWorkspaceAttackPreview(session, state);
  if (session.currentStep === "damage-input") renderWorkspaceDamagePreview(session);
  if (session.workspaceType === "command" && session.scenarioId === "character-roll" &&
      session.currentStep === "command-input") renderWorkspaceRollPreview(session, state);
  if (session.workspaceType === "command" && session.scenarioId?.startsWith("potion-use:") &&
      session.currentStep === "command-input") renderWorkspacePotionPreview(session, state);
  if (session.workspaceType === "command" && session.currentStep === "roll-result") {
    renderWorkspaceConsequencePreview(session, state);
  }
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
  }
}

function findSequenceAndDamage(state, options = {}) {
  const explicitSequence = options.sequenceId
    ? getWorkspaceAttackSequence(state, options.sequenceId) : null;
  if (options.sequenceId && !explicitSequence) return { error: "Последовательность атаки не найдена." };
  if (options.attackId) {
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
    const pending = findAwaitingWorkspaceDamage(state, { sequenceId: explicitSequence.id });
    if (pending) {
      return {
        ...pending,
        historical: !sequenceCurrentForAttack(explicitSequence, state, explicitSequence.kind),
      };
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
  const nextAttack = selectedSequence?.resolvedAttacks?.length ?? 0;
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

export function openSaraBattleCommand(commandId, invoker = null, options = {}) {
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
    session.scenarioId = `rest-replacement:offer:${result.outcome.restId}`;
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
  refreshWorkspaceOwnerRevision();
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
  if (form.dataset.workspaceForm === "attack") {
    session.error = "Итог рассчитан. Выберите «Попадание» или «Промах» после ответа ведущего.";
    render();
  }
  if (form.dataset.workspaceForm === "damage") submitDamage();
  if (form.dataset.workspaceForm === "command") {
    if (session.scenarioId !== "character-roll") submitCommand();
  }
  if (form.dataset.workspaceForm === "roll-consequence") {
    setError("Проверьте расчёт и выберите способ учёта урона.");
    render();
  }
  if (form.dataset.workspaceForm === "missile-return") submitMissileReturn();
}

function nextAttack() {
  if (!session || session.appliedUnsaved || !requireOwner() ||
      !["checkpoint", "strike-input", "summary"].includes(session.currentStep) ||
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
      sequence.resolvedAttacks.length >= sequence.maximumAttacks ||
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
    session.scenarioId = `rest-replacement:edit:${session.command.restId}`;
    session.command = getCommandDescriptor(getState(), session.scenarioId);
    session.currentStepKey = stepKey("command-input", session.scenarioId);
    session.rawInputsByStep[session.currentStepKey] = {};
    session.error = "";
    render();
  } else if (action === "cancel-rest-replacement" &&
      session.command?.restStage === "edit") {
    session.scenarioId = `rest-replacement:offer:${session.command.restId}`;
    session.command = getCommandDescriptor(getState(), session.scenarioId);
    session.currentStepKey = stepKey("command-input", session.scenarioId);
    session.error = "";
    render();
  } else if (action === "decline-rest-replacement" &&
      session.command?.restStage === "offer" && requireOwner()) {
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
    session.appliedUnsaved = result.status === "applied" && result.persistence?.ok === false;
    render();
  } else if (action === "finish-short-rest" &&
      session.command?.restStage === "hit-die" && requireOwner()) {
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
    session.appliedUnsaved = result.status === "applied" && result.persistence?.ok === false;
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
      restoreFocus: !["session-changed", "character-transition", "character-picker", "character-reset"].includes(reason),
      discardEmbedded: ["session-changed", "character-transition", "character-picker", "character-reset"].includes(reason),
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
      const next = sequence.resolvedAttacks.length + 1;
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
  return entry.dirty === true && !entry.appliedUnsaved && !entry.submitting &&
    ["attack-input", "damage-input", "command-input", "strike-input"].includes(entry.currentStep);
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
  return getAllWorkspaceSessions().map((entry) => ({
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
    attackId: entry.currentStep === "damage-input" ? entry.attackId ?? null : null,
    stage: entry.currentStep ?? null,
    group: entry.appliedUnsaved ? "save-recovery"
      : entry.currentStep === "damage-input" ? "required"
        : isUnrecordedWorkspaceDraft(entry) ? "drafts" : "continuations",
  }));
}

export function getMinimizedWorkspaceSessions() {
  return getAllWorkspaceSessions()
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
      attackId: entry.currentStep === "damage-input" ? entry.attackId ?? null : null,
      stage: entry.currentStep ?? null,
      group: entry.appliedUnsaved ? "save-recovery"
        : entry.currentStep === "damage-input" ? "required"
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
