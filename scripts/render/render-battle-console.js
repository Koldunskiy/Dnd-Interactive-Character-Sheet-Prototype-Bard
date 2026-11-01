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
  const view = getPlayerHubViewModel(state, getWorkspaceSessions());
  const derived = getDerivedStats(state);
  const commands = getSaraBattleCommandRegistry(state);
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
  const resources = `<section class="battle-console-hud" aria-label="Ресурсы персонажа">
    <span>HP <strong>${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}</strong> · временные ${state.combat?.hp?.temp ?? 0}</span>
    <span>Ци <strong>${state.combat?.ki?.current ?? "—"}/${derived.monk.kiMaximum}</strong></span>
    <span>Practiced <strong>${state.combat?.practiced?.current ?? 0}/${derived.monk.practicedMaximum}</strong></span>
    <span>Скорость <strong>${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт.</strong></span>
  </section>`;

  let phaseBody = "";
  let primaryFooter = "";
  if (view.phase === "outside") {
    const outsideAbilities = commands.filter((entry) =>
      entry.id.startsWith("racial-spell:") || entry.id === "mystic-regeneration");
    phaseBody = `<section class="battle-player-home">
      <h3>Вне боя</h3>
      <details class="battle-start">
        <summary>Начинается бой?</summary>
        <form class="battle-console-init-form" data-battle-form="start">
          <label>Физический к20 инициативы
            <input name="rawD20" type="number" min="1" max="20" required inputmode="numeric">
          </label>
          <button type="submit" class="btn btn--primary">Начать бой</button>
        </form>
        <p class="hint">Порядок ходов определяет ведущий. Ваш ход начнётся только после подтверждения.</p>
      </details>
      <h3>Частые проверки</h3>
      <div class="battle-quick-rolls">
        ${[
          ["persuasion", "Убеждение"],
          ["athletics", "Атлетика"],
          ["perception", "Восприятие"],
        ].map(([id, label]) => `<button type="button" class="btn btn--utility"
          data-battle-roll-shortcut="ability-check" data-roll-id="${id}">${label}</button>`).join("")}
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="all">Все броски</button>
      </div>
      <details class="battle-outside-abilities" open>
        <summary>Подготовленные способности и расовые заклинания</summary>
        <div class="battle-command-grid">${outsideAbilities.map(renderBattleCommandCard).join("")}</div>
      </details>
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-roll-shortcut="all">Все броски</button>`;
  } else if (view.phase === "waiting") {
    const initiative = view.battle?.initiative;
    phaseBody = `<section class="battle-player-home">
      <h3>Ожидание своего хода</h3>
      ${renderInitiative(view.battle)}
      <p class="battle-console-guidance">Следи за событиями. Решение о начале твоего хода принимает ведущий.</p>
      <p class="battle-reaction-status">Реакция: <strong>${view.budget?.reactionAvailable === false || state.ui?.turn?.reactionUsed === true
        ? "использована" : "доступна"}</strong></p>
      <div class="battle-quick-rolls">
        <button type="button" class="btn btn--utility" data-battle-incoming-events>По мне атаковали</button>
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="saving-throw"
          data-roll-id="dexterity">Мой спасбросок</button>
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="all">Проверка</button>
      </div>
      ${incomingEventsOpen ? renderIncomingEvents(commands) : ""}
      <div class="battle-console-actions">
        <button type="button" class="btn btn--utility" data-battle-command="pause-battle">Приостановить</button>
        <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить бой</button>
      </div>
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-command="begin-own-turn">Начался мой ход</button>`;
  } else if (view.phase === "own-turn") {
    const tiles = [
      ["action", "Действие", view.budget.actionAvailable],
      ["bonus", "Бонусное", view.budget.bonusActionAvailable],
      ["reaction", "Реакция", view.budget.reactionAvailable],
    ].map(([id, label, available]) => `<button type="button"
      class="battle-resource-tile ${selectedMenu === id ? "is-selected" : ""}"
      data-battle-menu="${id}" aria-pressed="${selectedMenu === id}">
      <span>${label}</span><strong>${available ? "1" : "0"}</strong></button>`).join("");
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
      <h3>Мой ход</h3>
      <div class="battle-resource-tiles" aria-label="Доступность ресурсов">${tiles}</div>
      <button type="button" class="battle-movement-entry" data-battle-menu="movement"
        aria-pressed="${selectedMenu === "movement"}">Перемещение · ${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт.</button>
      ${sequenceCards ? `<section class="battle-continuations"><h4>Продолжить начатое</h4>${sequenceCards}</section>` : ""}
      <div class="battle-quick-rolls">
        <button type="button" class="btn btn--primary" data-battle-command-open="normal-attack"
          ${commands.find((entry) => entry.id === "normal-attack")?.availability.enabled ? "" : "disabled"}>
          Обычная атака</button>
        <button type="button" class="btn btn--utility" data-battle-roll-shortcut="all">Проверка или спасбросок</button>
        <button type="button" class="btn btn--utility" data-battle-command-open="resource-correction">Исправить ресурс вручную</button>
      </div>
      <p class="battle-console-guidance">Восстановление «Духа воина» отмечается вручную.</p>
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
      <h3>Сцена приостановлена</h3>
      <p>Текущий контекст сохранён. Продолжение не восстанавливает ресурсы и не создаёт новый ход.</p>
      ${renderInitiative(view.battle)}
      <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить бой</button>
    </section>`;
    primaryFooter = `<button type="button" class="btn btn--primary"
      data-battle-command="resume-battle">Продолжить сцену</button>`;
  }

  const minimizedIds = new Set(minimized.map((entry) => entry.workspaceSessionId));
  const unfinished = view.unfinishedWork.filter((entry) =>
    !entry.workspaceSessionId || !minimizedIds.has(entry.workspaceSessionId));
  const workPanel = `<details class="battle-unfinished-work">
    <summary>Незавершённое и история · ${unfinished.length + minimized.length}</summary>
    <div class="battle-unfinished-list">${unfinished.map(renderPlayerWork).join("") ||
      "<p>Нет ожидающих результатов или черновиков.</p>"}</div>
    ${minimized.length ? `<div class="battle-unfinished-list" aria-label="Рабочие панели">
      ${minimized.map(renderPlayerWork).join("")}</div>` : ""}
  </details>`;
  return `<section class="battle-console battle-player-console panel-section"
    data-player-scene-phase="${view.phase}" aria-labelledby="battleConsoleTitle">
    <div class="battle-player-heading">
      <div><div class="eyebrow">Личная сцена</div><h2 id="battleConsoleTitle" tabindex="-1">Боевой пульт</h2></div>
      <span class="battle-console-phase">${escapeHtml(phaseLabels[view.phase])}</span>
    </div>
    ${resources}
    ${phaseBody}
    ${workPanel}
    <footer class="battle-primary-footer">${primaryFooter}</footer>
    <p class="battle-console-status" data-battle-status role="status"></p>
  </section>`;
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
