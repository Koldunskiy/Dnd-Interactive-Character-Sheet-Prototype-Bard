import { escapeHtml } from "./shared/spell-card.js";
import { executeBattleCommand } from "../battle/commands.js";
import {
  getActiveWorkspaceSession,
  getMinimizedWorkspaceSessions,
  getWorkspaceSessions,
  openNormalAttack,
  openSaraBattleCommand,
  resumeWorkspace,
  discardWorkspaceDraft,
  requestEndBattle,
  openIncomingAttack,
} from "../workspace/controller.js";
import {
  BATTLE_CATEGORIES,
  getSaraBattleCommandRegistry,
} from "../battle/command-registry.js";
import { getDerivedStats } from "../calculations.js";
import { buildRestHitDieCommandId, buildRestReplacementCommandId } from "../workspace/rest-command.js";
import { getState, getSessionContext } from "../state.js";
import {
  getPlayerHubViewModel,
  getSavedPlayerRecords,
} from "../battle/player-hub.js";
import { getSaraInitiativeSnapshot } from "../battle/providers/sara.js";
import {
  getSaraHudModel,
  renderSaraHud,
  updateSaraHudRegion,
  renderSaraEndBattleButton,
} from "./sara-hud.js";
import {
  dispatchSceneUi,
  getSceneUiState,
  resetSceneUi,
} from "../battle/scene-ui-state.js";

function renderInitiative(battle) {
  const initiative = battle?.initiative;
  if (!initiative) return "";
  const details = initiative.sources.map((source) =>
    `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ");
  return `<details class="battle-console-initiative">
    <summary>Инициатива: <strong>${initiative.rawD20} + ${escapeHtml(details)} = ${initiative.total}</strong></summary>
  </details>`;
}

function renderBattleCommandCard(entry) {
  if (entry.id === "movement-reference") {
    return `<article class="battle-command-card battle-command-card--reference">
      <h3 class="battle-command-card__title">${escapeHtml(entry.titleRu)}</h3>
      <div class="battle-command-card__chips">${entry.displayCostTokens
        .map((token) => `<span class="battle-command-card__chip">${escapeHtml(token)}</span>`).join("")}</div>
      <p>${escapeHtml(entry.ruleReference)}</p>
    </article>`;
  }
  return `<article class="battle-command-card ${entry.availability.enabled ? "" : "is-unavailable"}">
    <h3 class="battle-command-card__title">${escapeHtml(entry.titleRu)}</h3>
    <p>${escapeHtml(entry.displaySummaryRu ?? entry.trigger)}</p>
    <div class="battle-command-card__chips">${entry.displayCostTokens
      .map((token) => `<span class="battle-command-card__chip">${escapeHtml(token)}</span>`).join("")}</div>
    ${entry.availability.reasonRu
      ? `<p class="battle-command-card__reason">${escapeHtml(entry.availability.reasonRu)}</p>` : ""}
    ${entry.ruleReference && entry.ruleReference !== entry.trigger
      ? `<details class="battle-command-card__details"><summary>Подробнее</summary><p>${escapeHtml(entry.ruleReference)}</p></details>` : ""}
    ${entry.navigationGroups.length > 1
      ? `<small>Также: ${escapeHtml(entry.navigationGroups
        .filter((group) => group !== "movement")
        .map((group) => BATTLE_CATEGORIES.find((item) => item.id === group)?.label ?? group)
        .join(", "))}</small>` : ""}
    <button type="button" class="battle-command-card__open"
      data-battle-command-open="${escapeHtml(entry.id)}"
      ${entry.availability.enabled ? "" : "disabled"}>Открыть</button>
  </article>`;
}

function renderPlayerWork(work) {
  if (work.appliedUnsaved) {
    return `<section class="combat-save-recovery__item" role="alert">
      <strong>Результат применён, но не сохранён</strong>
      <p>Повторное применение отключено. Возобновите панель и повторите сохранение.</p>
      <button type="button" class="btn btn--utility"
        data-workspace-resume="${escapeHtml(work.workspaceSessionId)}">Открыть сохранение</button>
    </section>`;
  }
  if (work.kind === "historical-damage") {
    return `<article class="battle-work-item"><h4>${escapeHtml(work.label)}</h4>
      <small>Попадание записано · урон ещё не учтён</small><button type="button" class="primary"
      data-battle-open-historical-damage="${escapeHtml(work.sequenceId)}"
      data-battle-attack-id="${escapeHtml(work.attackId)}">Продолжить</button></article>`;
  }
  if (work.kind === "pending-seeking") {
    return `<article class="battle-work-item"><h4>${escapeHtml(work.label)}</h4>
      <small>1 ци уже уплачена · требуется физический повторный бросок</small>
      <button type="button" class="primary" data-battle-open-seeking="${escapeHtml(work.sequenceId)}"
        data-battle-attack-id="${escapeHtml(work.attackId)}">Продолжить</button></article>`;
  }
  if (work.kind === "sequence-continuation") {
    return `<article class="battle-work-item"><h4>${escapeHtml(work.label)}</h4>
      <small>Последовательность ударов ещё открыта</small><button type="button" class="primary"
        data-battle-resume-sequence="${escapeHtml(work.sequenceId)}">Продолжить</button></article>`;
  }
  if (work.commandId) {
    return `<article class="battle-work-item"><h4>${escapeHtml(work.label)}</h4>
      <small>${work.group === "awaiting-answer" ? "Ожидается исход от ведущего" : "Последствие ещё не записано"}</small>
      <button type="button" data-battle-command-open="${escapeHtml(work.commandId)}">
        ${work.group === "awaiting-answer" ? "Записать исход" : "Продолжить"}</button></article>`;
  }
  if (work.workspaceSessionId) {
    return `<article class="battle-work-item"><h4>${escapeHtml(work.label)}</h4>
      <small>${work.appliedUnsaved ? "Результат применён, требуется сохранить" :
        work.draft ? "Не записанный ввод" : "Рабочая панель приостановлена"}</small>
      <div class="battle-work-item__actions"><button type="button" class="primary"
        data-workspace-resume="${escapeHtml(work.workspaceSessionId)}">${work.draft ? "Вернуться" : "Продолжить"}</button>
        ${work.draft ? `<button type="button" data-workspace-discard="${escapeHtml(work.workspaceSessionId)}">Удалить черновик</button>` : ""}</div></article>`;
  }
  return "";
}

function renderSavedRecords(records, owner) {
  const ownerAttrs = `data-record-character="${escapeHtml(owner.characterId ?? "")}"
    data-record-generation="${escapeHtml(owner.sessionGeneration ?? "")}"`;
  const attacks = records.sequences.flatMap((sequence) => sequence.attacks.map((attack) => ({
    sequence, attack,
  })));
  const items = [];
  for (const { sequence, attack } of attacks) {
    const seeking = attack.seeking.map((entry) => `<p>Seeking · ${escapeHtml(entry.amendmentId)} ·
      ${entry.status === "awaiting-replacement" ? "ожидается замена" : "результат записан"}
      ${entry.kiPaid === 1 ? "· 1 ци уплачена" : ""}</p>
      ${entry.status === "awaiting-replacement" ? `<button type="button" ${ownerAttrs}
        data-saved-seeking-sequence="${escapeHtml(sequence.sequenceId)}"
        data-saved-seeking-attack="${escapeHtml(attack.attackId)}"
        data-saved-seeking-amendment="${escapeHtml(entry.amendmentId)}">Записать оплаченный результат</button>` : ""}`).join("");
    const damageAction = attack.damageStatus === "awaiting-damage"
      ? `<button type="button" ${ownerAttrs} data-saved-damage-sequence="${escapeHtml(sequence.sequenceId)}"
        data-saved-damage-attack="${escapeHtml(attack.attackId)}">Записать урон</button>` : "";
    items.push(`<article class="saved-record">
      <strong>${escapeHtml(sequence.kind)} · ${escapeHtml(sequence.status)} · использовано ${sequence.usedSlots}/${sequence.maximumAttacks}</strong>
      <p>Удар ${escapeHtml(attack.slotNumber ?? "—")}: ${escapeHtml(attack.hitResult ?? "исход не записан")},
        ${attack.recordedDamage == null ? "урон не записан" : `урон ${escapeHtml(attack.recordedDamage)}`}</p>
      ${attack.seekingConflict ? `<p role="alert">История Seeking противоречива; изменение недоступно.</p>` : seeking}
      ${attack.seekingConflict ? "" : damageAction}</article>`);
  }
  for (const application of records.applications) {
    items.push(`<article class="saved-record"><strong>Применённая техника · ${escapeHtml(application.techniqueId ?? "—")}</strong>
      <p>СЛ ${escapeHtml(application.dc ?? "—")} · исход цели ${escapeHtml(application.targetOutcome ?? "unknown")}</p>
      ${!["success", "failure"].includes(application.targetOutcome)
        ? `<button type="button" ${ownerAttrs} data-saved-application="${escapeHtml(application.applicationId)}">Открыть исход цели</button>` : ""}</article>`);
  }
  for (const roll of records.rolls) {
    items.push(`<article class="saved-record"><strong>${escapeHtml(roll.label ?? roll.kind ?? "Бросок")}</strong>
      <p>${escapeHtml(roll.total ?? roll.outcome ?? "Результат сохранён")}
        ${roll.consequencePending ? "· последствие не записано" : ""}</p>
      ${roll.consequencePending ? `<button type="button" ${ownerAttrs} data-saved-roll="${escapeHtml(roll.rollId)}">Открыть запись</button>` : ""}</article>`);
  }
  for (const sequence of records.sequences.filter((entry) => entry.status === "open" &&
      !entry.attacks.some((attack) => attack.damageStatus === "awaiting-damage" ||
        attack.seeking.some((invocation) => invocation.status === "awaiting-replacement")))) {
    items.push(`<article class="saved-record"><strong>${escapeHtml(sequence.kind)} · последовательность открыта</strong>
      <button type="button" ${ownerAttrs} data-saved-sequence="${escapeHtml(sequence.sequenceId)}">Продолжить последовательность</button></article>`);
  }
  return `<section class="battle-saved-records" aria-label="Сохранённые записи"><h3>Сохранённые записи</h3>
    ${items.length ? items.join("") : "<p>Сохранённых записей нет.</p>"}
    <button type="button" data-battle-menu="tools">Назад к инструментам</button></section>`;
}

function buildBattleConsole(state, uiState = { panel: "home", initiativeDraft: { rawD20: "", battleId: null }, error: "" }) {
  let endBattleOwner = null;
  try {
    const identity = JSON.parse(uiState.ownerKey ?? "");
    if (Array.isArray(identity) && identity.length === 2) {
      endBattleOwner = { characterId: identity[0], sessionGeneration: identity[1] };
    }
  } catch {}
  const endBattleButton = renderSaraEndBattleButton(state, endBattleOwner);
  const workspaceSessions = getWorkspaceSessions();
  const activeWorkspace = getActiveWorkspaceSession() ??
    workspaceSessions.find((entry) => !entry.minimized && !entry.suspended);
  const view = getPlayerHubViewModel(state, workspaceSessions);
  const derived = getDerivedStats(state);
  const commands = getSaraBattleCommandRegistry(state);
  const initiativeSnapshot = getSaraInitiativeSnapshot(state);
  const saraHud = renderSaraHud(getSaraHudModel(state, derived));
  const savedRecords = getSavedPlayerRecords(state);
  const savedRecordsPanel = uiState.panel === "saved-records"
    ? renderSavedRecords(savedRecords, getSessionContext()) : "";
  const minimized = getMinimizedWorkspaceSessions();
  const phaseLabels = {
    outside: "Исследование",
    waiting: "Бой · Ожидание своего хода",
    "own-turn": `Бой · Мой ход №${view.battle?.ownTurnNumber ?? "—"}`,
    paused: "Сцена приостановлена",
  };
  const budget = view.phase === "own-turn" && view.budget ? `<section class="combat-budget" aria-label="Бюджет хода">
    ${[
      ["action", "Действие", view.budget.actionAvailable],
      ["bonus", "Бонусное", view.budget.bonusActionAvailable],
    ].map(([, label, available]) =>
      `<span class="combat-budget__item ${available ? "is-available" : "is-spent"}">
        ${label}<b>${available ? "Доступно" : "Потрачено"}</b></span>`).join("")}
  </section>` : "";

  let phaseBody = "";
  let primaryFooter = "";
  const selectedCategory = uiState.panel;
  const menuGroups = {
    action: "action",
    bonus: "bonus",
  };
  const selectedGroup = menuGroups[selectedCategory];
  const menuEntries = view.phase === "own-turn" && selectedGroup
      ? commands.filter((entry) => entry.navigationGroups.includes(selectedGroup) &&
        entry.activationBudget !== "none")
      : [];
  const navigation = "";
  const savedRest = state.monk?.functionalRuntime?.rest;
  const restResumeId = savedRest?.kind === "short" && savedRest.phase === "hit-dice"
    ? buildRestHitDieCommandId(savedRest.id)
    : savedRest?.kind === "long" && ["replacement-offer", "replacement-edit"].includes(savedRest.phase)
      ? buildRestReplacementCommandId(savedRest.phase === "replacement-edit" ? "edit" : "offer", savedRest.id)
      : null;
  const sceneMenu = `<details class="battle-scene-menu">
    <summary>Меню сцены</summary>
    ${view.phase !== "outside" ? `<button type="button" data-battle-scene-action="correct-initiative">Исправить инициативу</button>` : ""}
    ${view.phase === "outside" ? "" : `<button type="button" data-battle-scene-action="initiative-info">Инициатива</button>`}
    <button type="button" data-battle-scene-action="tools">Дополнительные инструменты</button>
  </details>`;
  const initiativeSources = uiState.panel === "initiative-correct"
    ? view.battle?.initiative?.sources ?? []
    : initiativeSnapshot.ok ? initiativeSnapshot.sources : [];
  const initiativeModifier = initiativeSources.reduce((total, source) => total + source.value, 0);
  const initiativeRaw = uiState.initiativeDraft?.rawD20 ?? "";
  const initiativePreview = /^\d+$/.test(initiativeRaw) &&
    Number(initiativeRaw) >= 1 && Number(initiativeRaw) <= 20
    ? String(Number(initiativeRaw) + initiativeModifier) : "—";
  const initiativeForm = (mode) => `<form class="battle-console-init-form"
    data-battle-form="${mode === "start" ? "start" : "correct-initiative"}"
    data-owner="${escapeHtml(uiState.ownerKey ?? "")}" data-scene="${escapeHtml(uiState.sceneKey ?? "")}"
    data-battle-id="${escapeHtml(view.battle?.id ?? "")}">
    <header><strong>${mode === "start" ? "Начало боя" : "Исправление инициативы"}</strong>${endBattleButton}</header>
    <div class="battle-console-init-fields"><label>Физический к20 инициативы<input name="rawD20" type="number" min="1" max="20"
      step="1" required inputmode="numeric" data-initiative-entry data-modifier="${initiativeModifier}"
      value="${escapeHtml(uiState.initiativeDraft?.rawD20 ?? "")}"></label></div>
    <div class="battle-console-init-actions"><output data-initiative-total aria-live="polite">${initiativePreview}</output>
    ${uiState.error ? `<p role="alert">${escapeHtml(uiState.error)}</p>` : ""}
    <button type="submit" class="btn btn--primary">${mode === "start" ? "В бой" : "Сохранить"}</button>
    <button type="button" data-battle-menu="home">Отмена</button></div></form>`;
  const toolsPanel = uiState.panel === "tools" ? `<section class="battle-secondary-tools">
    ${renderInitiative(view.battle)}
    <button type="button" data-battle-incoming-direct>Получить урон</button>
    <button type="button" data-battle-command-open="completed-rest">Записать завершённый отдых</button>
    ${restResumeId ? `<button type="button" data-battle-command-open="${escapeHtml(restResumeId)}">Продолжить сохранённое восстановление</button>` : ""}
    <button type="button" data-battle-roll-shortcut="all">Проверка или спасбросок</button>
    <button type="button" data-battle-scene-action="saved-records">Сохранённые записи</button>
    <button type="button" data-battle-menu="home">Назад</button>
  </section>` : "";
  if (view.phase === "outside") {
    const outsideAbilities = commands.filter((entry) =>
      entry.id.startsWith("racial-spell:") || entry.id === "mystic-regeneration");
    const home = `<div class="battle-quick-rolls">
      <button type="button" data-roll-preset="ability-check">Проверка</button>
      <button type="button" data-roll-preset="saving-throw">Спасбросок</button>
      <button type="button" data-battle-menu="abilities">Способности</button>
      <button type="button" data-battle-navigate="inventory">Инвентарь</button>
      <button type="button" data-battle-command-open="completed-rest">Отдых</button>
    </div>`;
    const abilities = `<section><div class="battle-command-grid">${outsideAbilities.map(renderBattleCommandCard).join("")}</div>
      <button type="button" data-battle-navigate="techniques">Все техники</button>
      <button type="button" data-battle-menu="home">Назад</button></section>`;
    phaseBody = `${uiState.panel === "initiative-start" ? initiativeForm("start")
      : uiState.panel === "abilities" ? abilities : uiState.panel === "home" ? home : ""}
      ${toolsPanel}${savedRecordsPanel}`;
    primaryFooter = uiState.panel === "home" ? `<button type="button" class="btn btn--primary"
      data-battle-scene-action="initiative">Начать бой</button>` : "";
  } else if (view.phase === "waiting") {
    phaseBody = `${uiState.panel === "initiative-correct" ? initiativeForm("correct") : `<div class="battle-quick-rolls">
      <button type="button" data-battle-menu="incoming">По мне атакуют</button>
      <button type="button" data-roll-preset="saving-throw">Спасбросок</button>
      <button type="button" data-roll-preset="ability-check">Проверка</button>
      <button type="button" data-battle-command-open="opportunity-unarmed">Провоцированная атака</button></div>
      ${toolsPanel}${savedRecordsPanel}`}`;
    primaryFooter = uiState.panel === "initiative-correct" ? "" : `<button type="button" class="btn btn--primary"
      data-battle-command="begin-own-turn">Мой ход</button>`;
  } else if (view.phase === "own-turn") {
    const panel = uiState.panel === "action" || uiState.panel === "bonus" ? `<section class="battle-menu-panel">
      <div class="battle-command-grid">${menuEntries.map(renderBattleCommandCard).join("") ||
        "<p>Нет доступных команд в этой категории.</p>"}</div>
      <button type="button" data-battle-menu="home">Назад к ходу</button></section>` : "";
    const home = `<div class="battle-quick-rolls">
      <button type="button" data-battle-command-open="normal-attack">Атаковать</button>
      <button type="button" data-battle-menu="action">Другое действие</button>
      <button type="button" data-battle-menu="bonus">Бонусное действие</button>
      <button type="button" data-battle-menu="incoming">По мне атакуют</button>
      <button type="button" data-battle-command-open="opportunity-unarmed">Провоцированная атака</button></div>`;
    phaseBody = `${uiState.panel === "initiative-correct" ? initiativeForm("correct")
      : uiState.panel === "home" ? home : panel}
      ${toolsPanel}${savedRecordsPanel}`;
    primaryFooter = uiState.panel === "initiative-correct" ? "" : `<button type="button" class="btn btn--primary"
      data-battle-command="end-own-turn">Завершить ход</button>`;
  } else {
    const resumable = ["waiting", "own-turn"].includes(view.battle?.phaseBeforePause);
    phaseBody = `${uiState.panel === "initiative-correct" ? initiativeForm("correct") : `<section class="battle-player-home">
      <p>${resumable
        ? "Текущий контекст сохранён. Продолжение не восстанавливает ресурсы и не создаёт новый ход."
        : "Контекст приостановленной сцены повреждён. Продолжить её безопасно нельзя."}</p>
      <div class="battle-secondary-tools">
        ${renderInitiative(view.battle)}
      </div>
    </section>`}    ${toolsPanel}${savedRecordsPanel}`;
    primaryFooter = uiState.panel === "initiative-correct" ? "" : `${resumable ? `<button type="button" class="btn btn--primary"
      data-battle-command="resume-battle">Продолжить прежний ход</button>` : ""}
      `;
  }

  const minimizedIds = new Set(minimized.map((entry) => entry.workspaceSessionId));
  const unfinished = view.unfinishedWork.filter((entry) =>
    !entry.workspaceSessionId || !minimizedIds.has(entry.workspaceSessionId));
  const saveRecovery = activeWorkspace?.appliedUnsaved
    ? [] : [...unfinished, ...minimized].filter((entry) => entry.appliedUnsaved);
  const minimizedWithoutRecovery = minimized.filter((entry) => !entry.appliedUnsaved);
  const visibleUnfinished = unfinished.filter((entry) => !entry.appliedUnsaved);
  const groupedWork = [...visibleUnfinished, ...minimizedWithoutRecovery];
  const requiredWork = groupedWork.filter((entry) => entry.group === "required");
  const externalAnswers = groupedWork.filter((entry) => entry.group === "awaiting-answer");
  const continuations = groupedWork.filter((entry) => entry.group === "continuations");
  const drafts = groupedWork.filter((entry) => entry.group === "drafts" && entry.draft);
  const renderWorkGroup = (title, entries) => entries.length
    ? `<section class="battle-work-group"><h3>${title}</h3>
        <div class="battle-unfinished-list">${entries.map(renderPlayerWork).join("")}</div></section>`
    : "";
  const visibleWorkCount = visibleUnfinished.length + minimizedWithoutRecovery.length;
  const workPanel = visibleWorkCount ? `<details class="battle-unfinished-work">
    <summary>Требует внимания · ${visibleWorkCount}</summary>
    ${renderWorkGroup("Обязательные последствия", requiredWork)}
    ${renderWorkGroup("Ожидается ответ", externalAnswers)}
    ${renderWorkGroup("Доступные продолжения", continuations)}
    ${renderWorkGroup("Черновики", drafts)}
    ${requiredWork.length + externalAnswers.length + continuations.length + drafts.length === 0
      ? "<p>Нет ожидающих результатов или черновиков.</p>" : ""}
  </details>` : "";
  const workspaceHostMarkup = `<div class="combat-workspace-host" data-combat-workspace-root
      role="region" aria-label="Активная рабочая панель" ${activeWorkspace ? "" : "hidden"}>
    <header class="action-workspace__header"><div data-workspace-header></div></header>
    <p class="workspace-live-error" data-workspace-error role="alert" hidden></p>
    <section class="action-workspace__body" data-workspace-body aria-label="Текущий этап"></section>
    <footer class="action-workspace__footer"><div data-workspace-footer></div>
      <p data-workspace-status role="status" aria-live="polite"></p></footer>
  </div>`;
  const mainAction = activeWorkspace ? "" : primaryFooter;
  return {
    phase: view.phase,
    activeWorkspace: Boolean(activeWorkspace),
    hud: `<header class="sara-app-head">
      <div class="sara-app-head__title"><h2 id="battleConsoleTitle" tabindex="-1">
        ${escapeHtml(phaseLabels[view.phase])}</h2>${endBattleButton}</div>
    </header>${sceneMenu}`,
    metrics: saraHud,
    budget,
    navigation,
    phaseBody,
    pending: `${saveRecovery.length ? `<section class="combat-save-recovery" aria-label="Требуется повторное сохранение">
      ${saveRecovery.map(renderPlayerWork).join("")}</section>` : ""}
      ${workPanel}`,
    turnControls: `${mainAction ? `<footer class="combat-primary-footer">${mainAction}</footer>` : ""}
      <p class="battle-console-status" data-battle-status role="status"></p>`,
    workspaceHostMarkup,
  };
}

export function renderBattleConsole(state, uiState = {
  panel: "home",
  initiativeDraft: { rawD20: "", battleId: null },
}) {
  const regions = buildBattleConsole(state, uiState);
  const hasPermanentSaraDock = typeof document !== "undefined" &&
    document.querySelector?.("[data-sara-task-dock]");
  return `<section class="sara-combat-shell combat-turn-card panel-section"
      data-player-scene-phase="${regions.phase}"
      data-battle-render-context="${escapeHtml(battleContextKey(state))}"
    data-battle-owner="${escapeHtml(uiState.ownerKey ?? "")}"
    aria-labelledby="battleConsoleTitle">
    <div data-sara-hud>
      <div data-sara-hud-heading>${regions.hud}</div>
      <div data-sara-home-hud>${regions.metrics}</div>
    </div>
    <div data-sara-budget ${regions.activeWorkspace ? "hidden" : ""}>${regions.budget}</div>
    <div data-sara-navigation ${regions.activeWorkspace ? "hidden" : ""}>${regions.navigation}</div>
    <div data-sara-task-region data-combat-task-region
      class="${regions.activeWorkspace ? "combat-active-task" : "combat-home-task"}">
      <div data-sara-idle-content ${regions.activeWorkspace ? "hidden" : ""}>
        <div data-sara-phase-content>${regions.phaseBody}</div>
      </div>
      ${hasPermanentSaraDock ? "" : regions.workspaceHostMarkup}
    </div>
    <div data-sara-pending-work ${regions.activeWorkspace ? "hidden" : ""}>${regions.pending}</div>
    <div data-sara-turn-controls ${regions.activeWorkspace ? "hidden" : ""}>${regions.turnControls}</div>
  </section>`;
}

export function updateBattleConsole(root, state, { forceUi = false } = {}) {
  const context = getSessionContext();
  const owner = {
    characterId: context.characterId,
    sessionGeneration: context.sessionGeneration,
  };
  const uiState = getSceneUiState(root, owner, battleContextKey(state));
  const shell = root.querySelector(".sara-combat-shell");
  if (!shell) {
    root.innerHTML = renderBattleConsole(state, uiState);
    return;
  }
  shell.dataset.battleOwner = uiState.ownerKey;

  const regions = buildBattleConsole(state, uiState);
  const nextContext = battleContextKey(state);
  const contextChanged = shell.dataset.battleRenderContext !== nextContext;
  if (contextChanged || forceUi && !["initiative-start", "initiative-correct"].includes(uiState.panel)) {
    clearInitiativePresentation(root);
  }
  const phaseRegionSelectors = [
    "[data-sara-hud-heading]",
    "[data-sara-budget]",
    "[data-sara-navigation]",
    "[data-sara-pending-work]",
    "[data-sara-turn-controls]",
    "[data-sara-phase-content]",
  ];
  const activeElement = document.activeElement;
  const focusInPhaseRegion = phaseRegionSelectors.some((selector) =>
    shell.querySelector(selector)?.contains(activeElement));
  if (contextChanged) {
    for (const selector of phaseRegionSelectors) {
      const region = shell.querySelector(selector);
      if (region) deferredBattleRegionMarkup.delete(region);
    }
    if (forceUi) {
      for (const selector of [
        "[data-sara-phase-content]",
        "[data-sara-navigation]",
        "[data-sara-turn-controls]",
      ]) {
        const region = shell.querySelector(selector);
        if (region) deferredBattleRegionMarkup.delete(region);
      }
    }
  }
  const updateRegion = (selector, markup) => {
    const region = shell.querySelector(selector);
    if (!region) return;
    if (region.innerHTML === markup) {
      deferredBattleRegionMarkup.delete(region);
      return;
    }
    const forceable = [
      "[data-sara-phase-content]",
      "[data-sara-navigation]",
      "[data-sara-turn-controls]",
    ].includes(selector);
    if (!contextChanged && !(forceUi && forceable) && region.contains(document.activeElement)) {
      deferredBattleRegionMarkup.set(region, markup);
      return;
    }
    region.innerHTML = markup;
    deferredBattleRegionMarkup.delete(region);
  };
  updateRegion("[data-sara-hud-heading]", regions.hud);
  updateSaraHudRegion(
    shell.querySelector("[data-sara-home-hud]"),
    getSaraHudModel(state),
  );
  updateRegion("[data-sara-budget]", regions.budget);
  const navigation = shell.querySelector("[data-sara-navigation]");
  updateRegion("[data-sara-navigation]", regions.navigation);
  updateRegion("[data-sara-pending-work]", regions.pending);
  updateRegion("[data-sara-turn-controls]", regions.turnControls);
  updateRegion("[data-sara-phase-content]", regions.phaseBody);
  const initiativeInput = shell.querySelector("[data-initiative-entry]");
  const initiativeTotal = shell.querySelector("[data-initiative-total]");
  if (initiativeInput && initiativeTotal) {
    const snapshot = uiState.panel === "initiative-correct"
      ? null : getSaraInitiativeSnapshot(state);
    const sources = uiState.panel === "initiative-correct"
      ? state.battleConsole?.current?.initiative?.sources ?? []
      : snapshot?.sources ?? [];
    const modifier = sources.reduce((total, source) => total + source.value, 0);
    initiativeInput.dataset.modifier = String(modifier);
    const die = Number(initiativeInput.value);
    initiativeTotal.textContent = (snapshot === null || snapshot.ok) &&
      Number.isInteger(die) && die >= 1 && die <= 20
      ? String(die + modifier) : "—";
  }
  for (const selector of [
    "[data-sara-budget]",
    "[data-sara-navigation]",
    "[data-sara-pending-work]",
    "[data-sara-turn-controls]",
  ]) {
    const region = shell.querySelector(selector);
    if (region) region.hidden = regions.activeWorkspace;
  }
  const idle = shell.querySelector("[data-sara-idle-content]");
  const taskRegion = shell.querySelector("[data-sara-task-region]");
  const workspace = shell.querySelector("[data-combat-workspace-root]");
  if (idle) idle.hidden = regions.activeWorkspace;
  if (taskRegion) taskRegion.className = regions.activeWorkspace
    ? "combat-active-task" : "combat-home-task";
  if (workspace) workspace.hidden = !regions.activeWorkspace;
  shell.dataset.playerScenePhase = regions.phase;
  shell.dataset.battleRenderContext = nextContext;
  if (contextChanged && focusInPhaseRegion && activeElement?.isConnected === false) {
    shell.querySelector("#battleConsoleTitle")?.focus({ preventScroll: true });
  }
}

export function battleContextKey(state) {
  const battle = state.battleConsole?.current;
  return JSON.stringify([
    battle?.id ?? null,
    battle?.phase ?? "outside",
    battle?.ownTurnId ?? null,
  ]);
}

const deferredBattleRegionMarkup = new Map();
const navigationCallbacks = new WeakMap();
const initiativePresentationCleanup = new WeakMap();

function clearInitiativePresentation(root) {
  initiativePresentationCleanup.get(root)?.();
  initiativePresentationCleanup.delete(root);
}

export function clearBattleConsolePresentation(root) {
  clearInitiativePresentation(root);
}

function activateInitiativePresentation(root, input) {
  clearInitiativePresentation(root);
  const form = input.closest("form");
  const viewport = globalThis.visualViewport;
  if (!form || !viewport) return;
  form.dataset.initiativePresentation = "true";
  const shell = root.querySelector(".sara-combat-shell");
  if (shell) shell.dataset.initiativePresenting = "true";
  const update = () => {
    form.style.position = "fixed";
    form.style.top = `${viewport.offsetTop}px`;
    form.style.left = "0";
    form.style.right = "0";
    form.style.height = `${viewport.height}px`;
    form.style.zIndex = "1100";
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  const observer = globalThis.MutationObserver
    ? new globalThis.MutationObserver(() => {
      if (!root.isConnected || !root.contains(form) || form.closest?.("[hidden]")) {
        clearInitiativePresentation(root);
      }
    })
    : null;
  observer?.observe(root, { childList: true, subtree: true });
  if (root.parentElement) {
    observer?.observe(root.parentElement, { childList: true });
    observer?.observe(root.parentElement, { attributes: true, attributeFilter: ["hidden"] });
  }
  initiativePresentationCleanup.set(root, () => {
    observer?.disconnect();
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    delete form.dataset.initiativePresentation;
    if (shell) delete shell.dataset.initiativePresenting;
    for (const property of ["position", "top", "left", "right", "height", "z-index"]) {
      form.style.removeProperty(property);
    }
  });
}

function flushDeferredBattleRegions(root) {
  for (const [region, markup] of deferredBattleRegionMarkup) {
    if (!root.contains(region)) {
      deferredBattleRegionMarkup.delete(region);
      continue;
    }
    if (region.contains(document.activeElement)) continue;
    region.innerHTML = markup;
    deferredBattleRegionMarkup.delete(region);
  }
}

export function bindBattleConsole(root = document, { onNavigate } = {}) {
  if (typeof onNavigate === "function") navigationCallbacks.set(root, onNavigate);
  const sessionContext = getSessionContext();
  const currentState = getState();
  const shell = root.querySelector(".sara-combat-shell");
  if (shell) {
    shell.dataset.battleOwner = JSON.stringify([
      sessionContext.characterId ?? null,
      sessionContext.sessionGeneration ?? null,
    ]);
    shell.dataset.battleRenderContext = battleContextKey(currentState);
  }
  if (root.dataset.battleConsoleBound === "true") return;
  const context = () => {
    const current = getSessionContext();
    return {
      owner: { characterId: current.characterId, sessionGeneration: current.sessionGeneration },
      sceneKey: battleContextKey(getState()),
    };
  };
  const rerender = (forceUi = false) => {
    updateBattleConsole(root, getState(), { forceUi });
  };
  const changePanel = (panel) => {
    if (!["initiative-start", "initiative-correct"].includes(panel)) {
      clearInitiativePresentation(root);
    }
    const { owner, sceneKey } = context();
    dispatchSceneUi(root, owner, sceneKey, { type: "set-panel", panel });
    rerender(true);
  };
  const reportFailure = (message) => {
    const status = root.querySelector("[data-battle-status]");
    if (status) status.textContent = message;
  };
  const runBattleCommand = (command) => {
    if (command === "end-battle") {
      const state = getState();
      const context = getSessionContext();
      const result = requestEndBattle({
        owner: { characterId: context.characterId, sessionGeneration: context.sessionGeneration },
        battleId: state.battleConsole?.current?.id,
      });
      if (result.status === "rejected") reportFailure(result.reason);
      else if (result.status === "verification-required") reportFailure("Не удалось подтвердить завершение боя. Повторное выполнение не выполнялось.");
      if (result.status === "applied") rerender();
      return result.status === "applied";
    }
    const result = executeBattleCommand(command);
    if (result.status !== "applied") {
      reportFailure(`Действие не выполнено: ${result.reason ?? "ошибка сохранения"}.`);
      return false;
    }
    rerender();
    return true;
  };
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!root.contains(event.target)) return;
    const endButton = event.target.closest("[data-sara-end-battle]");
    if (endButton && root.contains(endButton)) {
      if (endButton.disabled || endButton.closest("[hidden]")) return;
      let owner;
      try {
        const identity = JSON.parse(endButton.dataset.battleOwner);
        if (!Array.isArray(identity) || identity.length !== 2 ||
            typeof identity[0] !== "string" || !Number.isInteger(identity[1])) throw new Error();
        owner = { characterId: identity[0], sessionGeneration: identity[1] };
      } catch {
        reportFailure("Не удалось проверить владельца кнопки завершения боя.");
        return;
      }
      const result = requestEndBattle({ owner, battleId: endButton.dataset.battleId });
      if (result.status === "rejected") reportFailure(result.reason);
      else if (result.status === "verification-required") reportFailure("Не удалось подтвердить завершение боя. Повторное выполнение не выполнялось.");
      return;
    }
    const shell = root.querySelector(".sara-combat-shell");
    const liveContext = context();
    const liveOwnerKey = JSON.stringify([
      liveContext.owner.characterId ?? null,
      liveContext.owner.sessionGeneration ?? null,
    ]);
    if (shell && (shell.dataset.battleOwner !== liveOwnerKey ||
        shell.dataset.battleRenderContext !== liveContext.sceneKey)) {
      rerender();
      return;
    }
    const savedControl = event.target.closest("[data-saved-damage-sequence], [data-saved-seeking-sequence], [data-saved-application], [data-saved-roll], [data-saved-sequence]");
    if (savedControl && root.contains(savedControl)) {
      if (savedControl.disabled) return;
      if (savedControl.dataset.recordCharacter !== String(liveContext.owner.characterId ?? "") ||
          savedControl.dataset.recordGeneration !== String(liveContext.owner.sessionGeneration ?? "")) {
        reportFailure("Эта запись относится к прежнему сеансу персонажа.");
        return;
      }
      const workspace = getActiveWorkspaceSession();
      if (workspace?.submitting) {
        reportFailure("Сначала завершите сохранение текущего результата.");
        return;
      }
      if (workspace?.appliedUnsaved) {
        reportFailure("Сначала повторите сохранение применённого результата.");
        return;
      }
      if (workspace?.verificationRequired || workspace?.stage === "verification") {
        reportFailure("Сначала проверьте результат текущего действия.");
        return;
      }
      if (workspace?.dirty) {
        reportFailure("Сначала завершите или отмените текущий ввод.");
        return;
      }
      const records = getSavedPlayerRecords(getState());
      let result;
      if (savedControl.dataset.savedDamageSequence) {
        const { savedDamageSequence: sequenceId, savedDamageAttack: attackId } = savedControl.dataset;
        const parent = records.sequences.find((entry) => entry.sequenceId === sequenceId);
        if (!parent?.attacks.some((entry) => entry.attackId === attackId && entry.damageStatus === "awaiting-damage")) {
          reportFailure("Выбранный удар больше не ожидает записи урона.");
          return;
        }
        result = openNormalAttack({ sequenceId, attackId, mode: "historical-damage", invoker: savedControl });
      } else if (savedControl.dataset.savedSeekingSequence) {
        const { savedSeekingSequence: sequenceId, savedSeekingAttack: attackId,
          savedSeekingAmendment: amendmentId } = savedControl.dataset;
        const parent = records.sequences.find((entry) => entry.sequenceId === sequenceId);
        const attack = parent?.attacks.find((entry) => entry.attackId === attackId);
        if (!attack || attack.seekingConflict ||
            !attack.seeking.some((entry) => entry.amendmentId === amendmentId && entry.status === "awaiting-replacement")) {
          reportFailure("Выбранная оплаченная запись изменилась или противоречива.");
          return;
        }
        result = openNormalAttack({ sequenceId, attackId, invoker: savedControl });
      } else if (savedControl.dataset.savedApplication) {
        const applicationId = savedControl.dataset.savedApplication;
        if (!records.applications.some((entry) => entry.applicationId === applicationId)) {
          reportFailure("Запись исхода цели не найдена.");
          return;
        }
        result = openSaraBattleCommand(`pending-save:${applicationId}`, savedControl);
      } else if (savedControl.dataset.savedRoll) {
        const rollId = savedControl.dataset.savedRoll;
        if (!records.rolls.some((entry) => entry.rollId === rollId)) {
          reportFailure("Запись броска не найдена.");
          return;
        }
        result = openSaraBattleCommand(`pending-roll:${rollId}`, savedControl);
      } else {
        const sequenceId = savedControl.dataset.savedSequence;
        if (!records.sequences.some((entry) => entry.sequenceId === sequenceId && entry.status === "open")) {
          reportFailure("Последовательность больше недоступна.");
          return;
        }
        result = openNormalAttack({ sequenceId, invoker: savedControl });
      }
      if (!result?.ok) reportFailure(result?.reason ?? "Не удалось открыть выбранную запись.");
      return;
    }
    const directDamageButton = event.target.closest("[data-battle-incoming-direct]");
    if (directDamageButton && root.contains(directDamageButton)) {
      const result = openIncomingAttack(directDamageButton, { mode: "direct-damage" });
      if (!result.ok) reportFailure(result.reason);
      return;
    }
    const menuButton = event.target.closest("[data-battle-menu]");
    if (menuButton && root.contains(menuButton) && !menuButton.disabled) {
      if (menuButton.dataset.battleMenu === "incoming") {
        const result = openIncomingAttack(menuButton);
        if (!result.ok) reportFailure(result.reason);
        return;
      }
      changePanel(menuButton.dataset.battleMenu);
      return;
    }
    const sceneAction = event.target.closest("[data-battle-scene-action]");
    if (sceneAction && root.contains(sceneAction) && !sceneAction.disabled) {
      const { owner, sceneKey } = context();
      const battle = getState().battleConsole?.current;
      const action = sceneAction.dataset.battleSceneAction;
      if (action === "tools" || action === "initiative-info") {
        dispatchSceneUi(root, owner, sceneKey, { type: "set-panel", panel: "tools" });
      } else if (action === "saved-records") {
        dispatchSceneUi(root, owner, sceneKey, { type: "set-panel", panel: "saved-records" });
      } else if (action === "initiative") {
        dispatchSceneUi(root, owner, sceneKey, {
          type: "open-initiative", mode: "start", rawD20: "", battleId: null,
        });
      } else if (action === "correct-initiative" && battle?.id && battle.initiative) {
        dispatchSceneUi(root, owner, sceneKey, {
          type: "open-initiative", mode: "correct",
          rawD20: String(battle.initiative.rawD20), battleId: battle.id,
        });
      }
      rerender(true);
      return;
    }
    const discardButton = event.target.closest("[data-workspace-discard]");
    if (discardButton && root.contains(discardButton)) {
      const result = discardWorkspaceDraft(discardButton.dataset.workspaceDiscard);
      if (!result.ok) {
        reportFailure(result.reason);
      } else {
        rerender();
      }
      return;
    }
    const navigationButton = event.target.closest("[data-battle-navigate]");
    if (navigationButton && root.contains(navigationButton) && !navigationButton.disabled) {
      const tabId = navigationButton.dataset.battleNavigate;
      if (!["inventory", "techniques"].includes(tabId)) {
        reportFailure("Недопустимый раздел навигации.");
        return;
      }
      const navigate = navigationCallbacks.get(root);
      if (!navigate) {
        reportFailure("Навигация недоступна: callback вкладок не подключён.");
        return;
      }
      try {
        navigate(tabId);
      } catch (error) {
        reportFailure(`Не удалось открыть раздел: ${error instanceof Error ? error.message : String(error)}.`);
      }
      return;
    }
    const rollPresetButton = event.target.closest("[data-roll-preset]");
    if (rollPresetButton && root.contains(rollPresetButton) && !rollPresetButton.disabled) {
      const kind = rollPresetButton.dataset.rollPreset;
      const result = openSaraBattleCommand("character-roll", rollPresetButton, {
        rollPreset: { kind, id: "strength" },
      });
      if (!result.ok) reportFailure(result.reason);
      return;
    }
    if (event.target.closest("[data-battle-end-turn]")) {
      runBattleCommand("end-own-turn");
      return;
    }
    const rollShortcut = event.target.closest("[data-battle-roll-shortcut]");
    if (rollShortcut && root.contains(rollShortcut)) {
      const presetType = rollShortcut.dataset.battleRollShortcut;
      const rollPreset = presetType === "all" ? {}
        : { kind: presetType, id: rollShortcut.dataset.rollId };
      const result = openSaraBattleCommand("character-roll", rollShortcut, { rollPreset });
      if (!result.ok) reportFailure(result.reason);
      return;
    }
    const historicalDamage = event.target.closest("[data-battle-open-historical-damage]");
    if (historicalDamage && root.contains(historicalDamage)) {
      const result = openNormalAttack({
        sequenceId: historicalDamage.dataset.battleOpenHistoricalDamage,
        attackId: historicalDamage.dataset.battleAttackId,
        mode: "historical-damage",
        invoker: historicalDamage,
      });
      if (!result.ok) reportFailure(result.reason);
      return;
    }
    const seekingTask = event.target.closest("[data-battle-open-seeking]");
    if (seekingTask && root.contains(seekingTask)) {
      const result = openNormalAttack({
        sequenceId: seekingTask.dataset.battleOpenSeeking,
        attackId: seekingTask.dataset.battleAttackId,
        invoker: seekingTask,
      });
      if (!result.ok) reportFailure(result.reason);
      return;
    }
    const sequenceButton = event.target.closest("[data-battle-resume-sequence]");
    if (sequenceButton && root.contains(sequenceButton)) {
      const result = openNormalAttack({
        sequenceId: sequenceButton.dataset.battleResumeSequence,
        invoker: sequenceButton,
      });
      if (!result.ok) reportFailure(result.reason);
      return;
    }
    const commandButton = event.target.closest("[data-battle-command-open]");
    if (commandButton && root.contains(commandButton) && !commandButton.disabled) {
      const result = openSaraBattleCommand(commandButton.dataset.battleCommandOpen, commandButton);
      if (!result.ok) {
        reportFailure(result.reason);
      }
      return;
    }
    const resumeShortcut = event.target.closest("[data-workspace-resume]");
    if (resumeShortcut && root.contains(resumeShortcut)) {
      const result = resumeWorkspace(resumeShortcut.dataset.workspaceResume);
      if (!result.ok) {
        reportFailure(result.reason);
      }
      return;
    }
    const button = event.target.closest("[data-battle-command]");
    if (button && root.contains(button) && !button.disabled) {
      runBattleCommand(button.dataset.battleCommand);
    }
  });
  root.addEventListener("focusout", () => queueMicrotask(() => flushDeferredBattleRegions(root)));
  root.addEventListener("focusin", (event) => {
    const input = event.target?.closest?.("[data-initiative-entry]");
    if (input && root.contains(input)) activateInitiativePresentation(root, input);
  });
  root.addEventListener("focusout", (event) => {
    if (!event.target?.matches?.("[data-initiative-entry]")) return;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!active?.closest?.("[data-battle-form]")) clearInitiativePresentation(root);
    });
  });
  root.addEventListener("input", (event) => {
    const input = event.target.closest("[data-initiative-entry]");
    if (!input || !root.contains(input)) return;
    const { owner, sceneKey } = context();
    dispatchSceneUi(root, owner, sceneKey, { type: "set-draft", rawD20: input.value });
    const die = Number(input.value);
    const modifier = Number(input.dataset.modifier);
    const total = root.querySelector("[data-initiative-total]");
    if (total) total.textContent = Number.isInteger(die) && die >= 1 && die <= 20 &&
      Number.isFinite(modifier) ? String(die + modifier) : "—";
  });
  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !root.contains(form) ||
        !["start", "correct-initiative"].includes(form.dataset.battleForm)) return;
    event.preventDefault();
    const command = form.dataset.battleForm === "start"
      ? "start-battle"
      : "correct-initiative";
    const currentContext = context();
    const battle = getState().battleConsole?.current;
    const uiState = getSceneUiState(root, currentContext.owner, currentContext.sceneKey);
    const rawD20 = form.elements.rawD20.value;
    const validDie = /^\d+$/.test(rawD20) && Number(rawD20) >= 1 && Number(rawD20) <= 20;
    const stale = form.dataset.owner !== JSON.stringify([
      currentContext.owner.characterId ?? null,
      currentContext.owner.sessionGeneration ?? null,
    ]) || form.dataset.scene !== currentContext.sceneKey ||
      (command === "correct-initiative" &&
        (form.dataset.battleId !== battle?.id || uiState.initiativeDraft.battleId !== battle?.id));
    if (stale || !validDie) {
      const error = stale
        ? "Форма устарела. Откройте её заново в текущей сцене."
        : "Введите целое число от 1 до 20.";
      dispatchSceneUi(root, currentContext.owner, currentContext.sceneKey, {
        type: "set-error", error,
      });
      rerender(true);
      return;
    }
    const result = executeBattleCommand(command, {
      rawD20,
    });
    const status = root.querySelector("[data-battle-status]");
    if (status && result.status !== "applied") {
      const reason = result.reason ?? "ошибка сохранения";
      dispatchSceneUi(root, currentContext.owner, currentContext.sceneKey, {
        type: "set-error", error: reason,
      });
      status.textContent = `${command === "start-battle" ? "Сцену не удалось начать" : "Инициативу не удалось исправить"}: ${reason}.`;
    } else {
      const updated = getState();
      const updatedContext = getSessionContext();
      const updatedOwner = {
        characterId: updatedContext.characterId,
        sessionGeneration: updatedContext.sessionGeneration,
      };
      dispatchSceneUi(root, updatedOwner, battleContextKey(updated), {
        type: "set-panel", panel: "home",
      });
      rerender(true);
    }
  });
  root.dataset.battleConsoleBound = "true";
}
