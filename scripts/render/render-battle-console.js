import { escapeHtml } from "./shared/spell-card.js";
import { executeBattleCommand } from "../battle/commands.js";
import {
  getMinimizedWorkspaceSessions,
  getWorkspaceSessions,
  openNormalAttack,
  openSaraBattleCommand,
  resumeWorkspace,
  discardWorkspaceDraft,
} from "../workspace/controller.js";
import {
  BATTLE_CATEGORIES,
  getSaraBattleCommandRegistry,
} from "../battle/command-registry.js";
import { getDerivedStats } from "../calculations.js";
import { buildRestHitDieCommandId, buildRestReplacementCommandId } from "../workspace/rest-command.js";
import { getState } from "../state.js";
import {
  getPlayerHubViewModel,
} from "../battle/player-hub.js";
import { getSaraInitiativeSnapshot } from "../battle/providers/sara.js";

let selectedMenu = null;
let incomingEventsOpen = false;

function renderInitiative(battle) {
  const initiative = battle?.initiative;
  if (!initiative) return "";
  const details = initiative.sources.map((source) =>
    `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ");
  return `<details class="battle-console-initiative">
    <summary>Инициатива: <strong>${initiative.rawD20} + ${escapeHtml(details)} = ${initiative.total}</strong></summary>
    <form class="battle-console-init-form" data-battle-form="correct-initiative">
      <label>Исправить физический к20
        <input name="rawD20" type="number" min="1" max="20" required inputmode="numeric" value="${initiative.rawD20}">
      </label>
      <button type="submit" class="btn btn--utility">Исправить инициативу</button>
    </form>
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

function buildBattleConsole(state) {
  const workspaceSessions = getWorkspaceSessions();
  const activeWorkspace = workspaceSessions.find((entry) =>
    !entry.minimized && !entry.suspended);
  const view = getPlayerHubViewModel(state, workspaceSessions);
  const derived = getDerivedStats(state);
  const commands = getSaraBattleCommandRegistry(state);
  const initiativeSnapshot = getSaraInitiativeSnapshot(state);
  const initiativeModifier = initiativeSnapshot.ok
    ? initiativeSnapshot.sources.reduce((total, source) => total + source.value, 0)
    : null;
  const minimized = getMinimizedWorkspaceSessions();
  const phaseLabels = {
    outside: "Вне боя",
    waiting: "Ожидание своего хода",
    "own-turn": `Мой ход №${view.battle?.ownTurnNumber ?? "—"}`,
    paused: "Сцена приостановлена",
  };
  if (view.phase !== "own-turn") {
    selectedMenu = null;
  }
  const budget = view.budget ? `<section class="combat-budget" aria-label="Бюджет хода">
    ${[
      ["action", "Действие", view.budget.actionAvailable],
      ["bonus", "Бонусное", view.budget.bonusActionAvailable],
      ["reaction", "Реакция", view.budget.reactionAvailable],
    ].map(([, label, available]) =>
      `<span class="combat-budget__item ${available ? "is-available" : "is-spent"}">
        ${label}<b>${available ? "Доступно" : "Потрачено"}</b></span>`).join("")}
  </section>` : "";

  let phaseBody = "";
  let commandContent = "";
  let primaryFooter = "";
  const selectedCategory = selectedMenu ?? "action";
  const menuGroups = {
    action: "action",
    bonus: "bonus",
    reaction: "reaction",
    other: "other",
  };
  const selectedGroup = menuGroups[selectedCategory];
  const menuEntries = selectedGroup === "other"
    ? commands.filter((entry) => entry.navigationGroups.includes("movement") ||
      entry.activationBudget === "none" || entry.id === "resource-correction")
    : view.phase === "own-turn"
      ? commands.filter((entry) => entry.navigationGroups.includes(selectedGroup) &&
        entry.activationBudget !== "none")
      : [];
  const navigation = view.phase === "own-turn" ? `<nav class="battle-category-tabs"
    aria-label="Категории команд">
    ${[["action", "Действие"], ["bonus", "Бонусное"], ["reaction", "Реакция"], ["other", "Другое"]]
      .map(([id, label]) => `<button type="button" data-battle-menu="${id}"
        aria-pressed="${selectedCategory === id}">${label}</button>`).join("")}
  </nav>` : "";
  if (view.phase === "outside") {
    const outsideAbilities = commands.filter((entry) =>
      entry.id.startsWith("racial-spell:") || entry.id === "mystic-regeneration");
    phaseBody = `<section class="battle-player-home">
      <section class="battle-start">
        <h3>Инициатива</h3>
        <p>${initiativeSnapshot.ok
          ? initiativeSnapshot.sources.map((source) =>
            `${escapeHtml(source.label)} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ")
          : escapeHtml(initiativeSnapshot.reason)}</p>
        <form class="battle-console-init-form" data-battle-form="start">
          <label>Физический к20 инициативы
            <input name="rawD20" type="number" min="1" max="20" required inputmode="numeric"
              data-initiative-entry data-modifier="${initiativeModifier ?? ""}">
          </label>
          <output class="battle-console-init-total" data-initiative-total aria-live="polite">—</output>
          <button type="submit" class="btn btn--primary">Начать бой</button>
        </form>
        <p class="hint">Порядок ходов определяет ведущий. Ваш ход начнётся только после подтверждения.</p>
      </section>
      <h3>Проверки</h3>
      <div class="battle-quick-rolls">
        ${[
          ["persuasion", "Убеждение"],
          ["athletics", "Атлетика"],
          ["perception", "Восприятие"],
        ].map(([id, label]) => `<button type="button" class="btn btn--utility"
          data-battle-roll-shortcut="ability-check" data-roll-id="${id}">${label}</button>`).join("")}
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="all">Все броски</button>
      </div>
      <details class="battle-outside-abilities">
        <summary>Подготовленные способности и расовые заклинания</summary>
        <div class="battle-command-grid">${outsideAbilities.map(renderBattleCommandCard).join("")}</div>
      </details>
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-roll-shortcut="all">Все броски</button>`;
  } else if (view.phase === "waiting") {
    const initiative = view.battle?.initiative;
    phaseBody = `<section class="battle-player-home">
      ${renderInitiative(view.battle)}
      <p class="battle-console-guidance">Следи за событиями. Решение о начале твоего хода принимает ведущий.</p>
      <div class="battle-quick-rolls">
        <button type="button" class="btn btn--utility" data-battle-incoming-events>По мне атаковали</button>
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="saving-throw"
          data-roll-id="dexterity">Мой спасбросок</button>
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="all">Проверка</button>
      </div>
      ${incomingEventsOpen ? renderIncomingEvents(commands) : ""}
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-command="begin-own-turn">Начать свой ход</button>
      <button type="button" class="btn btn--utility"
        data-battle-command="end-battle">Закончить бой</button>`;
  } else if (view.phase === "own-turn") {
    commandContent = `<section class="battle-menu-panel" aria-label="${selectedGroup === "other"
      ? "Другое" : escapeHtml(BATTLE_CATEGORIES.find((item) => item.id === selectedGroup)?.label ?? "Команды")}">
      <div class="battle-command-grid">${menuEntries.map(renderBattleCommandCard).join("") ||
        "<p>Нет доступных команд в этой категории.</p>"}</div>
    </section>
    <details class="battle-secondary-tools"><summary>Броски и дополнительные инструменты</summary>
      <button type="button" data-battle-roll-shortcut="all">Проверка или спасбросок</button>
      <p>Скорость: ${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт.</p>
      <p>«Дух воина» восстанавливает 1 ци в начале вашего хода в бою, если вы не недееспособны. Приложение не определяет это состояние автоматически.</p>
    </details>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-end-turn>Закончить свой ход</button>
      <button type="button" class="btn btn--utility"
        data-battle-command="end-battle">Закончить бой</button>`;
  } else {
    const resumable = ["waiting", "own-turn"].includes(view.battle?.phaseBeforePause);
    phaseBody = `<section class="battle-player-home">
      <p>${resumable
        ? "Текущий контекст сохранён. Продолжение не восстанавливает ресурсы и не создаёт новый ход."
        : "Контекст приостановленной сцены повреждён. Продолжить её безопасно нельзя."}</p>
      <div class="battle-secondary-tools">
        ${renderInitiative(view.battle)}
      </div>
    </section>`;
    primaryFooter = `${resumable ? `<button type="button" class="btn btn--primary"
      data-battle-command="resume-battle">Продолжить прежний ход</button>` : ""}
      <button type="button" class="btn btn--utility"
        data-battle-command="end-battle">Закончить бой</button>`;
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
  const savedRest = state.monk?.functionalRuntime?.rest;
  const restResumeId = savedRest?.kind === "short" && savedRest.phase === "hit-dice"
    ? buildRestHitDieCommandId(savedRest.id)
    : savedRest?.kind === "long" && ["replacement-offer", "replacement-edit"].includes(savedRest.phase)
      ? buildRestReplacementCommandId(savedRest.phase === "replacement-edit" ? "edit" : "offer", savedRest.id)
      : null;
  const restTasks = `<section class="battle-secondary-tools" aria-label="Отдых">
    <button type="button" class="btn btn--utility" data-battle-command-open="completed-rest">
      Записать завершённый отдых</button>
    ${restResumeId ? `<button type="button" class="btn btn--utility"
      data-battle-command-open="${escapeHtml(restResumeId)}">Продолжить сохранённое восстановление</button>` : ""}
  </section>`;
  const mainAction = activeWorkspace ? "" : primaryFooter;
  return {
    phase: view.phase,
    activeWorkspace: Boolean(activeWorkspace),
    hud: `<header class="sara-app-head">
      <div class="sara-app-head__title"><h2 id="battleConsoleTitle" tabindex="-1">
        ${escapeHtml(phaseLabels[view.phase])}</h2></div>
    </header>`,
    budget,
    navigation,
    phaseBody: `${phaseBody}${commandContent}${restTasks}`,
    pending: `${saveRecovery.length ? `<section class="combat-save-recovery" aria-label="Требуется повторное сохранение">
      ${saveRecovery.map(renderPlayerWork).join("")}</section>` : ""}
      ${workPanel}`,
    turnControls: `${mainAction ? `<footer class="combat-primary-footer">${mainAction}</footer>` : ""}
      <p class="battle-console-status" data-battle-status role="status"></p>`,
    workspaceHostMarkup,
  };
}

export function renderBattleConsole(state) {
  const regions = buildBattleConsole(state);
  const hasPermanentSaraDock = typeof document !== "undefined" &&
    document.querySelector?.("[data-sara-task-dock]");
  return `<section class="sara-combat-shell combat-turn-card panel-section"
      data-player-scene-phase="${regions.phase}"
      data-battle-render-context="${escapeHtml(battleContextKey(state))}"
      aria-labelledby="battleConsoleTitle">
    <div data-sara-hud>${regions.hud}</div>
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

export function updateBattleConsole(root, state) {
  const shell = root.querySelector(".sara-combat-shell");
  if (!shell) {
    root.innerHTML = renderBattleConsole(state);
    return;
  }

  const regions = buildBattleConsole(state);
  const nextContext = battleContextKey(state);
  const contextChanged = shell.dataset.battleRenderContext !== nextContext;
  const phaseRegionSelectors = [
    "[data-sara-hud]",
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
  }
  const updateRegion = (selector, markup) => {
    const region = shell.querySelector(selector);
    if (!region) return;
    if (region.innerHTML === markup) {
      deferredBattleRegionMarkup.delete(region);
      return;
    }
    if (!contextChanged && region.contains(document.activeElement)) {
      deferredBattleRegionMarkup.set(region, markup);
      return;
    }
    region.innerHTML = markup;
    deferredBattleRegionMarkup.delete(region);
  };
  updateRegion("[data-sara-hud]", regions.hud);
  updateRegion("[data-sara-budget]", regions.budget);
  const navigation = shell.querySelector("[data-sara-navigation]");
  if (!contextChanged && regions.phase === "own-turn" && navigation) {
    for (const button of navigation.querySelectorAll("[data-battle-menu]")) {
      button.setAttribute("aria-pressed", String(button.dataset.battleMenu === (selectedMenu ?? "action")));
    }
  } else {
    updateRegion("[data-sara-navigation]", regions.navigation);
  }
  updateRegion("[data-sara-pending-work]", regions.pending);
  updateRegion("[data-sara-turn-controls]", regions.turnControls);
  updateRegion("[data-sara-phase-content]", regions.phaseBody);
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

function renderIncomingEvents(commands) {
  const choices = [
    ["deflect-strike", "Попадание вблизи", "Подходящее рукопашное попадание"],
    ["deflect-missile", "Попадание снарядом", "Подходящая дальнобойная атака"],
    ["ebb-and-flow", "Промах вблизи", "Прилив и отлив"],
    ["opportunity-unarmed", "Цель покинула досягаемость", "Провоцированная атака"],
  ];
  return `<section class="battle-incoming-events" aria-label="Выбор входящего события">
    <h4>Какое событие произошло?</h4>
    <div class="battle-quick-rolls">${choices.map(([id, label, detail]) => {
      const command = commands.find((entry) => entry.id === id);
      return `<button type="button" class="btn btn--utility" data-battle-command-open="${id}"
        ${command?.availability.enabled ? "" : "disabled"}>${label}<small>${detail}</small></button>`;
    }).join("")}
      <button type="button" class="btn btn--utility" data-battle-roll-shortcut="saving-throw"
        data-roll-id="dexterity">Записать спасбросок</button>
      <button type="button" class="btn btn--utility" data-battle-command-open="incoming-damage">
        Записать полученный урон без реакции</button>
      <button type="button" class="btn btn--utility" data-battle-incoming-close>Закрыть выбор</button>
    </div>
  </section>`;
}

export function bindBattleConsole(root = document) {
  if (root.dataset.battleConsoleBound === "true") return;
  const rerender = () => {
    updateBattleConsole(root, getState());
  };
  const reportFailure = (message) => {
    const status = root.querySelector("[data-battle-status]");
    if (status) status.textContent = message;
  };
  const runBattleCommand = (command) => {
    const result = executeBattleCommand(command);
    if (result.status !== "applied") {
      reportFailure(`Действие не выполнено: ${result.reason ?? "ошибка сохранения"}.`);
      return false;
    }
    incomingEventsOpen = false;
    rerender();
    return true;
  };
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const menuButton = event.target.closest("[data-battle-menu]");
    if (menuButton && root.contains(menuButton)) {
      selectedMenu = menuButton.dataset.battleMenu;
      rerender();
      return;
    }
    if (event.target.closest("[data-battle-menu-close]")) {
      selectedMenu = null;
      rerender();
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
    if (event.target.closest("[data-battle-incoming-events]")) {
      incomingEventsOpen = true;
      rerender();
      return;
    }
    if (event.target.closest("[data-battle-incoming-close]")) {
      incomingEventsOpen = false;
      rerender();
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
    if (button && root.contains(button)) {
      runBattleCommand(button.dataset.battleCommand);
    }
  });
  root.addEventListener("focusout", () => queueMicrotask(() => flushDeferredBattleRegions(root)));
  root.addEventListener("input", (event) => {
    const input = event.target.closest("[data-initiative-entry]");
    if (!input || !root.contains(input)) return;
    const die = Number(input.value);
    const modifier = Number(input.dataset.modifier);
    const total = root.querySelector("[data-initiative-total]");
    if (total) total.textContent = Number.isInteger(die) && die >= 1 && die <= 20 &&
      Number.isFinite(modifier) ? String(die + modifier) : "—";
  });
  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) ||
        !["start", "correct-initiative"].includes(form.dataset.battleForm)) return;
    event.preventDefault();
    const command = form.dataset.battleForm === "start"
      ? "start-battle"
      : "correct-initiative";
    const result = executeBattleCommand(command, {
      rawD20: form.elements.rawD20.value,
    });
    const status = root.querySelector("[data-battle-status]");
    if (status && result.status !== "applied") {
      status.textContent = `${command === "start-battle" ? "Сцену не удалось начать" : "Инициативу не удалось исправить"}: ${result.reason ?? "ошибка сохранения"}.`;
    } else {
      incomingEventsOpen = false;
      rerender();
    }
  });
  root.dataset.battleConsoleBound = "true";
}
