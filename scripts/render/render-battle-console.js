import { escapeHtml } from "./shared/spell-card.js";
import { executeBattleCommand } from "../battle/commands.js";
import {
  getMinimizedWorkspaceSessions,
  getWorkspaceSessions,
  openNormalAttack,
  openSaraBattleCommand,
  resumeWorkspace,
} from "../workspace/controller.js";
import {
  BATTLE_CATEGORIES,
  getSaraBattleCommandRegistry,
  selectBattleCategory,
} from "../battle/command-registry.js";
import { getDerivedStats } from "../calculations.js";
import { getState } from "../state.js";
import {
  getEndTurnAdvice,
  getPlayerHubViewModel,
} from "../battle/player-hub.js";
import { getSaraInitiativeSnapshot } from "../battle/providers/sara.js";

let selectedMenu = null;
let incomingEventsOpen = false;
let turnReviewOpen = false;

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
    <button type="button" class="battle-command-card__open"
      data-battle-command-open="${escapeHtml(entry.id)}"
      ${entry.availability.enabled ? "" : "disabled"}>
      <span class="battle-command-card__title">${escapeHtml(entry.titleRu)}</span>
    </button>
    <div class="battle-command-card__chips">${entry.displayCostTokens
      .map((token) => `<span class="battle-command-card__chip">${escapeHtml(token)}</span>`).join("")}</div>
    <p>${escapeHtml(entry.displaySummaryRu ?? entry.trigger)}</p>
    ${entry.availability.reasonRu
      ? `<p class="battle-command-card__reason">${escapeHtml(entry.availability.reasonRu)}</p>` : ""}
    ${entry.ruleReference && entry.ruleReference !== entry.trigger
      ? `<details class="battle-command-card__details"><summary>Подробнее</summary><p>${escapeHtml(entry.ruleReference)}</p></details>` : ""}
    ${entry.navigationGroups.length > 1
      ? `<small>Также: ${escapeHtml(entry.navigationGroups
        .filter((group) => group !== "movement")
        .map((group) => BATTLE_CATEGORIES.find((item) => item.id === group)?.label ?? group)
        .join(", "))}</small>` : ""}
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
    return `<button type="button" class="btn btn--utility"
      data-battle-open-historical-damage="${escapeHtml(work.sequenceId)}"
      data-battle-attack-id="${escapeHtml(work.attackId)}">${escapeHtml(work.label)}</button>`;
  }
  if (work.commandId) {
    return `<button type="button" class="btn btn--utility"
      data-battle-command-open="${escapeHtml(work.commandId)}">${escapeHtml(work.label)}</button>`;
  }
  if (work.workspaceSessionId) {
    return `<button type="button" class="btn btn--utility"
      data-workspace-resume="${escapeHtml(work.workspaceSessionId)}">${escapeHtml(work.label)}</button>`;
  }
  return "";
}

export function renderBattleConsole(state) {
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
    turnReviewOpen = false;
  }
  const currentHp = Math.max(0, Number(state.combat?.hp?.current ?? 0));
  const maxHp = Math.max(0, Number(derived.maxHitPoints ?? 0));
  const currentKi = Math.max(0, Number(state.combat?.ki?.current ?? 0));
  const maxKi = Math.max(0, Number(derived.monk.kiMaximum ?? 0));
  const resources = `<section class="battle-console-hud" aria-label="Ресурсы персонажа">
    <div class="battle-console-resource" aria-label="HP ${currentHp} из ${maxHp}; временные ${state.combat?.hp?.temp ?? 0}">
      <div class="battle-console-resource__label"><strong>HP</strong><span>${currentHp}/${maxHp}</span></div>
      <div class="battle-console-resource__track" aria-hidden="true"><span style="width:${maxHp ? Math.min(100, currentHp / maxHp * 100) : 0}%"></span></div>
      <small>Временные HP: ${state.combat?.hp?.temp ?? 0}</small>
    </div>
    <div class="battle-console-resource" aria-label="Ци ${currentKi} из ${maxKi}">
      <div class="battle-console-resource__label"><strong>Ци</strong><span>${currentKi}/${maxKi}</span></div>
      <div class="battle-console-resource__track battle-console-resource__track--ki" aria-hidden="true"><span style="width:${maxKi ? Math.min(100, currentKi / maxKi * 100) : 0}%"></span></div>
    </div>
    <span class="battle-console-practiced">Practiced <strong>${state.combat?.practiced?.current ?? 0}/${derived.monk.practicedMaximum}</strong></span>
  </section>`;
  const budget = view.budget ? `<section class="combat-budget" aria-label="Бюджет хода">
    ${[
      ["action", "Действие", view.budget.actionAvailable],
      ["bonus", "Бонусное", view.budget.bonusActionAvailable],
      ["reaction", "Реакция", view.budget.reactionAvailable],
    ].map(([id, label, available]) => view.phase === "own-turn"
      ? `<button type="button" class="combat-budget__item ${available ? "is-available" : "is-spent"}"
          data-battle-menu="${id}" aria-pressed="${selectedMenu === id}">
          <strong>${label}</strong><span>${available ? "Доступно" : "Потрачено"}</span>
        </button>`
      : `<span class="combat-budget__item ${available ? "is-available" : "is-spent"}">
          <strong>${label}</strong><span>${available ? "Доступно" : "Потрачено"}</span>
        </span>`).join("")}
    ${view.phase === "own-turn" ? `<button type="button" class="combat-budget__item"
      data-battle-menu="movement" aria-pressed="${selectedMenu === "movement"}">
      <strong>Перемещение</strong><span>${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт.</span>
    </button>` : ""}
  </section>` : "";

  let phaseBody = "";
  let primaryFooter = "";
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
      <details class="battle-secondary-tools"><summary>Управление сценой</summary>
        <div class="battle-console-actions">
          <button type="button" class="btn btn--utility" data-battle-command="pause-battle">Приостановить</button>
          <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить бой</button>
        </div>
      </details>
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-command="begin-own-turn">Начался мой ход</button>`;
  } else if (view.phase === "own-turn") {
    const sequenceCards = view.continuations.map((task) => `<button type="button"
      class="btn btn--primary battle-continuation"
      data-battle-resume-sequence="${escapeHtml(task.sequenceId)}">
      ${escapeHtml(task.label)} · осталось ${task.remaining}</button>`).join("");
    const menuGroups = {
      action: "action",
      bonus: "bonus",
      movement: "movement",
      reaction: "reaction",
    };
    const selectedGroup = menuGroups[selectedMenu];
    const menuEntries = selectedGroup
      ? commands.filter((entry) => entry.navigationGroups.includes(selectedGroup) &&
        (selectedGroup === "movement" || entry.activationBudget !== "none"))
      : [];
    phaseBody = `<section class="battle-player-home">
      ${sequenceCards.length ? `<section class="battle-continuations"><h4>Продолжить начатое</h4>${sequenceCards}</section>` : ""}
      <div class="battle-quick-rolls">
        <button type="button" class="btn btn--primary" data-battle-command-open="normal-attack"
          ${commands.find((entry) => entry.id === "normal-attack")?.availability.enabled ? "" : "disabled"}>
          Обычная атака</button>
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="all">Проверка или спасбросок</button>
      </div>
      <p class="battle-console-guidance">Восстановление «Духа воина» отмечается вручную.</p>
      <details class="battle-secondary-tools"><summary>Дополнительные инструменты</summary>
        <button type="button" class="btn btn--utility" data-battle-command-open="resource-correction">Исправить ресурс вручную</button>
        <p>Скорость: ${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт.</p>
      </details>
      ${selectedMenu ? `<section class="battle-menu-panel" aria-label="${escapeHtml(BATTLE_CATEGORIES.find((item) => item.id === selectedGroup)?.label ?? "Команды")}">
        <div class="battle-menu-heading"><h4>${escapeHtml(BATTLE_CATEGORIES.find((item) => item.id === selectedGroup)?.label ?? "Команды")}</h4>
          <button type="button" class="btn btn--utility" data-battle-menu-close>Готово</button></div>
        <div class="battle-command-grid">${menuEntries.map(renderBattleCommandCard).join("") ||
          "<p>Нет доступных команд в этой категории.</p>"}</div>
      </section>` : ""}
      ${turnReviewOpen ? renderTurnReview(getEndTurnAdvice(state, getWorkspaceSessions())) : ""}
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-end-turn>Завершить мой ход</button>`;
  } else {
    phaseBody = `<section class="battle-player-home">
      <p>Текущий контекст сохранён. Продолжение не восстанавливает ресурсы и не создаёт новый ход.</p>
      <div class="battle-secondary-tools">
        ${renderInitiative(view.battle)}
        <details><summary>Управление сценой</summary>
        <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить бой</button>
        </details>
      </div>
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-command="resume-battle">Продолжить сцену</button>`;
  }

  const minimizedIds = new Set(minimized.map((entry) => entry.workspaceSessionId));
  const unfinished = view.unfinishedWork.filter((entry) =>
    !entry.workspaceSessionId || !minimizedIds.has(entry.workspaceSessionId));
  const saveRecovery = activeWorkspace?.appliedUnsaved
    ? [] : [...unfinished, ...minimized].filter((entry) => entry.appliedUnsaved);
  const minimizedWithoutRecovery = minimized.filter((entry) => !entry.appliedUnsaved);
  const visibleUnfinished = unfinished.filter((entry) => !entry.appliedUnsaved);
  const workPanel = unfinished.length + minimized.length ? `<details class="battle-unfinished-work"
      ${!activeWorkspace ? "open" : ""}>
    <summary>Незавершённое и история · ${unfinished.length + minimized.length}</summary>
    <div class="battle-unfinished-list">${visibleUnfinished.map(renderPlayerWork).join("") ||
      "<p>Нет ожидающих результатов или черновиков.</p>"}</div>
    ${minimizedWithoutRecovery.length ? `<div class="battle-unfinished-list" aria-label="Рабочие панели">
      ${minimizedWithoutRecovery.map(renderPlayerWork).join("")}</div>` : ""}
  </details>` : "";
  const workspaceHostMarkup = `<div class="combat-workspace-host" data-combat-workspace-root
      role="region" aria-label="Активная рабочая панель" hidden>
    <header class="action-workspace__header"><div data-workspace-header></div></header>
    <p class="workspace-live-error" data-workspace-error role="alert" hidden></p>
    <section class="action-workspace__body" data-workspace-body aria-label="Текущий этап"></section>
    <footer class="action-workspace__footer"><div data-workspace-footer></div>
      <p data-workspace-status role="status" aria-live="polite"></p></footer>
  </div>`;
  const taskRegion = activeWorkspace
    ? `<div class="combat-active-task" aria-label="Текущее действие" data-combat-task-region></div>`
    : `<div class="combat-home-task" data-combat-task-region>${phaseBody}</div>`;
  const mainAction = activeWorkspace ? "" : primaryFooter;
  return `<section class="battle-console battle-player-console combat-turn-card panel-section"
    data-player-scene-phase="${view.phase}" aria-labelledby="battleConsoleTitle">
    <header class="combat-turn-card__header">
      <h2 id="battleConsoleTitle" tabindex="-1">${escapeHtml(state.profile?.name ?? "Сара")}</h2>
      <span class="battle-console-phase">${escapeHtml(phaseLabels[view.phase])}</span>
      ${resources}
    </header>
    ${budget}
    ${taskRegion}
    ${saveRecovery.length ? `<section class="combat-save-recovery" aria-label="Требуется повторное сохранение">
      ${saveRecovery.map(renderPlayerWork).join("")}</section>` : ""}
    ${workPanel}
    ${mainAction ? `<footer class="battle-primary-footer">${mainAction}</footer>` : ""}
    <p class="battle-console-status" data-battle-status role="status"></p>
  </section>${workspaceHostMarkup}`;
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

function renderTurnReview(advice) {
  return `<section class="battle-turn-review" aria-label="Проверка завершения хода">
    <h4>Можно закончить ход</h4>
    <p>Но ещё есть возможности. Использовать их не обязательно.</p>
    <div class="battle-turn-review__options">${advice.map((item) => {
      if (item.sequenceId) {
        return `<button type="button" class="btn btn--utility"
          data-battle-resume-sequence="${escapeHtml(item.sequenceId)}">${escapeHtml(item.label)}</button>`;
      }
      if (item.menu) {
        return `<button type="button" class="btn btn--utility"
          data-battle-menu="${escapeHtml(item.menu)}">${escapeHtml(item.label)}</button>`;
      }
      if (item.workspaceSessionId) {
        return `<button type="button" class="btn btn--utility"
          data-workspace-resume="${escapeHtml(item.workspaceSessionId)}">${escapeHtml(item.label)}</button>`;
      }
      return `<p>${escapeHtml(item.label)}</p>`;
    }).join("")}</div>
    <div class="battle-console-actions">
      <button type="button" class="btn btn--utility" data-battle-turn-review-close>Вернуться</button>
      <button type="button" class="btn btn--primary" data-battle-end-turn-confirm>Завершить всё равно</button>
    </div>
  </section>`;
}

export function bindBattleConsole(root = document) {
  if (root.dataset.battleConsoleBound === "true") return;
  const rerender = () => {
    root.innerHTML = renderBattleConsole(getState());
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
    turnReviewOpen = false;
    rerender();
    return true;
  };
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const menuButton = event.target.closest("[data-battle-menu]");
    if (menuButton && root.contains(menuButton)) {
      selectedMenu = menuButton.dataset.battleMenu;
      turnReviewOpen = false;
      rerender();
      return;
    }
    if (event.target.closest("[data-battle-menu-close]")) {
      selectedMenu = null;
      rerender();
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
    if (event.target.closest("[data-battle-turn-review-close]")) {
      turnReviewOpen = false;
      rerender();
      return;
    }
    if (event.target.closest("[data-battle-end-turn]")) {
      const advice = getEndTurnAdvice(getState(), getWorkspaceSessions());
      if (advice.length) {
        turnReviewOpen = true;
        rerender();
      } else {
        runBattleCommand("end-own-turn");
      }
      return;
    }
    if (event.target.closest("[data-battle-end-turn-confirm]")) {
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
    root.addEventListener("input", (event) => {
      const input = event.target.closest("[data-initiative-entry]");
      if (!input || !root.contains(input)) return;
      const die = Number(input.value);
      const modifier = Number(input.dataset.modifier);
      const total = root.querySelector("[data-initiative-total]");
      if (total) total.textContent = Number.isInteger(die) && die >= 1 && die <= 20 &&
        Number.isFinite(modifier) ? String(die + modifier) : "—";
    });
    const status = root.querySelector("[data-battle-status]");
    if (status && result.status !== "applied") {
      status.textContent = `${command === "start-battle" ? "Сцену не удалось начать" : "Инициативу не удалось исправить"}: ${result.reason ?? "ошибка сохранения"}.`;
    } else {
      incomingEventsOpen = false;
      turnReviewOpen = false;
      rerender();
    }
  });
  root.dataset.battleConsoleBound = "true";
}
