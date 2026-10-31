import { escapeHtml } from "./shared/spell-card.js";
import { getActiveBattle, getActionBudget } from "../battle/model.js";
import { executeBattleCommand } from "../battle/commands.js";
import {
  getMinimizedWorkspaceSession,
  openSaraBattleCommand,
  resumeWorkspace,
} from "../workspace/controller.js";
import {
  BATTLE_CATEGORIES,
  getSelectedBattleCategory,
  projectSaraBattleCategories,
  selectBattleCategory,
} from "../battle/command-registry.js";
import { getDerivedStats } from "../calculations.js";
import { getState } from "../state.js";

function renderInitiative(battle) {
  const initiative = battle?.initiative;
  if (!initiative) return "";
  const details = initiative.sources.map((source) =>
    `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ");
  return `<p class="battle-console-initiative">Инициатива: <strong>${initiative.rawD20} + ${escapeHtml(details)} = ${initiative.total}</strong></p>
    <form class="battle-console-init-form" data-battle-form="correct-initiative">
      <label>Исправить физический к20
        <input name="rawD20" type="number" min="1" max="20" required inputmode="numeric" value="${initiative.rawD20}">
      </label>
      <button type="submit" class="btn btn--utility">Исправить инициативу</button>
    </form>`;
}

export function renderBattleConsole(state) {
  const battle = getActiveBattle(state);
  const derived = getDerivedStats(state);
  const assistant = state.monk?.combatAssistant ?? {};
  const pendingCombatCount =
    (assistant.activeSequences ?? []).reduce((count, sequence) =>
      count + (sequence.resolvedAttacks ?? []).filter((attack) =>
        attack.damageStatus === "awaiting-damage").length, 0) +
    (assistant.pendingApplications ?? []).filter((entry) =>
      !["success", "failure"].includes(entry.targetOutcome)).length;
  const pendingRollCount = (state.characterRolls?.records ?? []).filter((entry) =>
    ["pending", "awaiting-outcome"].includes(entry.consequence?.status)).length;
  const pendingSaveControls = (assistant.pendingApplications ?? [])
    .filter((entry) => !["success", "failure"].includes(entry.targetOutcome))
    .slice(-3).map((entry) => `<button type="button" class="btn btn--utility"
      data-battle-command-open="pending-save:${escapeHtml(entry.id)}">
      Продолжить спасбросок цели · СЛ ${escapeHtml(String(entry.dc ?? "—"))}</button>`).join("");
  const pendingRollControls = (state.characterRolls?.records ?? [])
    .filter((entry) => entry.kind === "saving-throw" &&
      entry.consequence?.status === "pending" && typeof entry.dcResult === "boolean")
    .slice(-3).map((entry) => `<button type="button" class="btn btn--utility"
      data-battle-command-open="pending-roll:${escapeHtml(entry.id)}">
      Продолжить последствие спасброска · ${escapeHtml(entry.label ?? "цель")}</button>`).join("");
  const turn = state.ui?.turn ?? {};
  const budget = getActionBudget(state);
  const minimizedWorkspace = getMinimizedWorkspaceSession();
  const phaseLabel = !battle ? "Нет активного боя" : ({
    waiting: "Ожидание",
    "own-turn": `Мой ход №${battle.ownTurnNumber}`,
    paused: "Приостановлен",
  }[battle.phase] ?? "Сцена боя");
  const categoryId = getSelectedBattleCategory(state.profile?.id);
  const { category, commands } = projectSaraBattleCategories(state, categoryId);
  const commandCards = commands.map((entry) => {
    if (entry.id === "movement-reference") {
        return `<article class="battle-command-card battle-command-card--reference">
          <h3>${escapeHtml(entry.titleRu)}</h3><p>${escapeHtml(entry.ruleReference)}</p>
          <span>${escapeHtml(entry.resourceCost)}</span>
        </article>`;
    }
    return `<article class="battle-command-card ${entry.availability.enabled ? "" : "is-unavailable"}">
        <button type="button" class="battle-command-card__open"
          data-battle-command-open="${escapeHtml(entry.id)}"
          ${entry.availability.enabled ? "" : "disabled"}>
          <span class="battle-command-card__title">${escapeHtml(entry.titleRu)}</span>
          <span class="battle-command-card__cost">${escapeHtml(entry.resourceCost)}</span>
        </button>
        <p>${escapeHtml(entry.trigger)}</p>
        ${entry.availability.reasonRu ? `<p class="battle-command-card__reason">${escapeHtml(entry.availability.reasonRu)}</p>` : ""}
        ${entry.navigationGroups.length > 1 ? `<small>Также: ${escapeHtml(entry.navigationGroups.filter((group) => group !== category.id).map((group) => BATTLE_CATEGORIES.find((item) => item.id === group)?.label ?? group).join(", "))}</small>` : ""}
    </article>`;
  }).join("");
  const categoryTabs = BATTLE_CATEGORIES.map((item, index) => {
    const active = item.id === category.id;
    return `<button type="button" role="tab" id="battle-category-${item.id}"
        aria-controls="battle-category-panel" aria-selected="${active}"
        tabindex="${active ? 0 : -1}" data-battle-category="${item.id}"
        data-category-index="${index}">${escapeHtml(item.label)}</button>`;
  }).join("");
  const statusControls = !battle ? `
    <form class="battle-console-init-form" data-battle-form="start">
        <label>Физический к20 инициативы
          <input name="rawD20" type="number" min="1" max="20" required inputmode="numeric">
        </label>
        <button type="submit" class="btn btn--primary">Начать сцену</button>
    </form>
    <p class="hint">Порядок ходов определяет ведущий. Сцена не восстанавливает ресурсы и не начинает ваш ход автоматически.</p>
  ` : battle.phase === "waiting" ? `
    <div class="battle-console-actions">
        <button type="button" class="btn btn--primary" data-battle-command="begin-own-turn">Начался мой ход</button>
        <button type="button" class="btn" data-battle-command="pause-battle">Приостановить</button>
        <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить сцену</button>
    </div>
  ` : battle.phase === "own-turn" ? `
    <div class="battle-console-actions">
        <button type="button" class="btn" data-battle-command="pause-battle">Приостановить</button>
        <button type="button" class="btn" data-battle-command="end-own-turn">Завершить мой ход</button>
        <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить сцену</button>
    </div>
  ` : `
    <div class="battle-console-actions">
        <button type="button" class="btn btn--primary" data-battle-command="resume-battle">Продолжить сцену</button>
        <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить сцену</button>
    </div>
  `;
  return `
    <section class="battle-console panel-section" aria-labelledby="battleConsoleTitle">
        <div class="section-heading-row">
          <div><div class="eyebrow">Личная сцена</div><h2 id="battleConsoleTitle" tabindex="-1">Боевой пульт</h2></div>
          <span class="battle-console-phase">${escapeHtml(phaseLabel)}</span>
        </div>
        <section class="battle-console-hud" aria-label="Ресурсы персонажа">
          <span>HP <strong>${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}</strong> · временные ${state.combat?.hp?.temp ?? 0}</span>
          <span>Ци <strong>${state.combat?.ki?.current ?? "—"}/${derived.monk.kiMaximum}</strong></span>
          <span>Отработанные удары <strong>${state.combat?.practiced?.current ?? 0}/${derived.monk.practicedMaximum}</strong></span>
          <span>Скорость <strong>${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт.</strong></span>
        </section>
        <div class="battle-console-budget" aria-label="Доступность ресурсов хода">
          ${[
            ["Действие", budget.actionAvailable],
            ["Бонусное действие", budget.bonusActionAvailable],
            ["Реакция", budget.reactionAvailable],
          ].map(([label, available]) =>
            `<span class="battle-budget-item"><strong>${label}</strong> · ${available ? "доступно" : "использовано"}</span>`).join("")}
        </div>
        ${renderInitiative(battle)}
        ${minimizedWorkspace ? `<button type="button" class="btn btn--primary" data-workspace-resume="${escapeHtml(minimizedWorkspace.workspaceSessionId)}">${escapeHtml(minimizedWorkspace.label)}</button>` : ""}
        ${pendingSaveControls || pendingRollControls ? `<div class="battle-console-pending-controls" aria-label="Ожидающие результаты">${pendingSaveControls}${pendingRollControls}</div>` : ""}
        ${pendingCombatCount || pendingRollCount ? `<p class="battle-console-pending" role="status">Незавершённые события боя: ${pendingCombatCount} · последствия проверок: ${pendingRollCount}</p>` : ""}
        <button type="button" class="btn btn--utility" data-battle-command-open="character-roll">Бросок · проверка или спасбросок</button>
        <div class="battle-category-tabs" role="tablist" aria-label="Категории боевых команд">${categoryTabs}</div>
        <section id="battle-category-panel" role="tabpanel" aria-labelledby="battle-category-${category.id}"
          class="battle-category-panel" data-battle-category-panel="${category.id}">
          <h3>${escapeHtml(category.label)}</h3>
          <div class="battle-command-grid">${commandCards || `<p>Для этой категории нет команд.</p>`}</div>
        </section>
        ${statusControls}
        <p class="battle-console-status" data-battle-status role="status"></p>
    </section>
  `;
}

export function bindBattleConsole(root = document) {
  if (root.dataset.battleConsoleBound === "true") return;
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const categoryButton = event.target.closest("[data-battle-category]");
    if (categoryButton && root.contains(categoryButton)) {
      selectBattleCategory(getState().profile?.id, categoryButton.dataset.battleCategory);
      root.innerHTML = renderBattleConsole(getState());
      root.querySelector(`[data-battle-category="${categoryButton.dataset.battleCategory}"]`)?.focus({ preventScroll: true });
      return;
    }
    const commandButton = event.target.closest("[data-battle-command-open]");
    if (commandButton && root.contains(commandButton) && !commandButton.disabled) {
      const result = openSaraBattleCommand(commandButton.dataset.battleCommandOpen, commandButton);
      if (!result.ok) {
        const status = root.querySelector("[data-battle-status]");
        if (status) status.textContent = result.reason;
      }
      return;
    }
    const resumeShortcut = event.target.closest("[data-workspace-resume]");
    if (resumeShortcut && root.contains(resumeShortcut)) {
      const result = resumeWorkspace(resumeShortcut.dataset.workspaceResume);
      if (!result.ok) {
        const status = root.querySelector("[data-battle-status]");
        if (status) status.textContent = result.reason;
      }
      return;
    }
    const button = event.target.closest("[data-battle-command]");
    if (!button || !root.contains(button) || !button.isConnected) return;
    const result = executeBattleCommand(button.dataset.battleCommand);
    const status = root.querySelector("[data-battle-status]");
    if (status && result.status !== "applied") {
      status.textContent = `Действие не выполнено: ${result.reason ?? "ошибка сохранения"}.`;
    }
  });
  root.addEventListener("keydown", (event) => {
    const tab = event.target.closest("[role='tab'][data-battle-category]");
    if (!tab || !root.contains(tab) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...root.querySelectorAll("[role='tab'][data-battle-category]")];
    const current = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next]?.click();
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
    }
  });
  root.dataset.battleConsoleBound = "true";
}
