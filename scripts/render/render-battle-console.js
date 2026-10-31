import { escapeHtml } from "./shared/spell-card.js";
import { getActiveBattle } from "../battle/model.js";
import { executeBattleCommand } from "../battle/commands.js";
import { isTechniqueEffectivelySelected } from "../selectors/techniques.js";
import {
  getMinimizedWorkspaceSession,
  openNormalAttack,
  resumeWorkspace,
} from "../workspace/controller.js";

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
  const canFlurry = Number(state.profile?.level) >= 2;
  const canRegenerate = isTechniqueEffectivelySelected(state, "ll-monk:mystic-regeneration");
  const hasRacialMagic = Array.isArray(state.spellcasting?.racialSpells) &&
    state.spellcasting.racialSpells.length > 0;
  const assistant = state.monk?.combatAssistant ?? {};
  const pendingCombatCount =
    (assistant.activeSequences ?? []).reduce((count, sequence) =>
      count + (sequence.resolvedAttacks ?? []).filter((attack) =>
        attack.damageStatus === "awaiting-damage").length, 0) +
    (assistant.pendingApplications ?? []).filter((entry) =>
      !["success", "failure"].includes(entry.targetOutcome)).length;
  const pendingRollCount = (state.characterRolls?.records ?? []).filter((entry) =>
    ["pending", "awaiting-outcome"].includes(entry.consequence?.status)).length;
  const turn = state.ui?.turn ?? {};
  const minimizedWorkspace = getMinimizedWorkspaceSession();
  const budgetItem = (label, used) =>
    `<span class="battle-budget-item"><strong>${label}</strong> · ${used ? "использовано" : "доступно"}</span>`;
  const phaseLabel = !battle ? "Нет активного боя" : ({
    waiting: "Ожидание",
    "own-turn": `Мой ход №${battle.ownTurnNumber}`,
    paused: "Приостановлен",
  }[battle.phase] ?? "Сцена боя");
  return `
    <section class="battle-console panel-section" aria-labelledby="battleConsoleTitle">
      <div class="section-heading-row">
        <div><div class="eyebrow">Личная сцена</div><h2 id="battleConsoleTitle" tabindex="-1">Боевой пульт</h2></div>
        <span class="battle-console-phase">${escapeHtml(phaseLabel)}</span>
      </div>
        <div class="battle-console-budget" aria-label="Доступность ресурсов хода">
          ${budgetItem("Действие", turn.actionUsed === true)}
          ${budgetItem("Бонусное действие", turn.bonusActionUsed === true)}
          ${budgetItem("Реакция", turn.reactionUsed === true)}
        </div>
      ${renderInitiative(battle)}
      ${minimizedWorkspace ? `<button type="button" class="btn btn--primary" data-workspace-resume="${escapeHtml(minimizedWorkspace.workspaceSessionId)}">${escapeHtml(minimizedWorkspace.label)}</button>` : ""}
      ${pendingCombatCount ? `<button type="button" class="btn btn--utility battle-console-pending" data-battle-open-pending>Бой: незавершённые события · ${pendingCombatCount}</button>` : ""}
      ${pendingRollCount ? `<button type="button" class="btn btn--utility battle-console-pending" data-open-character-roll-panel>Спасброски: незавершённые последствия · ${pendingRollCount}</button>` : ""}
      ${!battle ? `
        <form class="battle-console-init-form" data-battle-form="start">
          <label>Физический к20 инициативы
            <input name="rawD20" type="number" min="1" max="20" required inputmode="numeric">
          </label>
          <button type="submit" class="btn btn--primary">Начать сцену</button>
        </form>
        <p class="hint">Порядок ходов определяет ведущий. Сцена не восстанавливает ресурсы и не начинает ваш ход автоматически.</p>
      ` : battle.phase === "waiting" ? `
        <div class="battle-console-actions">
          <button type="button" class="btn" data-open-character-roll-panel>Мой спасбросок / проверка</button>
          <button type="button" class="btn btn--primary" data-battle-command="begin-own-turn">Начался мой ход</button>
          <button type="button" class="btn" data-battle-command="pause-battle">Приостановить</button>
          <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить сцену</button>
        </div>
      ` : battle.phase === "own-turn" ? `
        <nav class="battle-command-menu" aria-label="Команды боя">
          <button type="button" class="btn btn--primary" data-battle-open-attack data-workspace-invoker="normal-attack">Атака</button>
          ${canFlurry ? `<button type="button" class="btn" data-battle-open-flurry>Шквал · 1 ци</button>
            <button type="button" class="btn" data-battle-open-bonus-attack>Бонусный удар</button>` : ""}
          ${canRegenerate ? `<button type="button" class="btn" data-battle-open-regeneration>Мистическая регенерация</button>` : ""}
          <button type="button" class="btn" data-open-character-roll-panel>Проверка / спасбросок</button>
          <button type="button" class="btn" data-battle-tab="techniques">Техники</button>
          <button type="button" class="btn" data-battle-tab="inventory">Предметы</button>
          ${hasRacialMagic ? `<button type="button" class="btn" data-battle-open-magic>Магия</button>` : ""}
        </nav>
        <div class="battle-console-actions">
          <button type="button" class="btn" data-battle-command="pause-battle">Приостановить</button>
          <button type="button" class="btn" data-battle-command="end-own-turn">Завершить мой ход</button>
          <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить сцену</button>
        </div>
        <p class="hint">Атаки, техники, предметы и расовые заклинания остаются в существующих карточках ниже.</p>
      ` : `
        <div class="battle-console-actions">
          <button type="button" class="btn btn--primary" data-battle-command="resume-battle">Продолжить сцену</button>
          <button type="button" class="btn btn--utility" data-battle-command="end-battle">Завершить сцену</button>
        </div>
      `}
      <p class="battle-console-status" data-battle-status role="status"></p>
    </section>
  `;
}

export function bindBattleConsole(root = document) {
  if (root.dataset.battleConsoleBound === "true") return;
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const attackShortcut = event.target.closest("[data-battle-open-attack]");
    if (attackShortcut && root.contains(attackShortcut)) {
      const result = openNormalAttack({ invoker: attackShortcut });
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
    const flurryShortcut = event.target.closest("[data-battle-open-flurry]");
    if (flurryShortcut && root.contains(flurryShortcut)) {
      root.querySelector("[data-sara-action='flurry']")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      return;
    }
    const bonusShortcut = event.target.closest("[data-battle-open-bonus-attack]");
    if (bonusShortcut && root.contains(bonusShortcut)) {
      const form = root.querySelector('form[data-attack-kind="bonus-unarmed"]');
      if (form) root.querySelector(`[data-attack-form-open="${form.dataset.actionId}"]`)?.click();
      return;
    }
    const regenerationShortcut = event.target.closest("[data-battle-open-regeneration]");
    if (regenerationShortcut && root.contains(regenerationShortcut)) {
      root.querySelector('[data-technique-form-open="ll-monk:mystic-regeneration"]')?.click();
      return;
    }
    const magicShortcut = event.target.closest("[data-battle-open-magic]");
    if (magicShortcut && root.contains(magicShortcut)) {
      root.querySelector("[data-racial-form-open]")?.click();
      return;
    }
    const pendingShortcut = event.target.closest("[data-battle-open-pending]");
    if (pendingShortcut && root.contains(pendingShortcut)) {
      document.querySelector("#saraCombatTasks")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    const tabShortcut = event.target.closest("[data-battle-tab]");
    if (tabShortcut && root.contains(tabShortcut)) {
      document.querySelector(`[data-tab="${tabShortcut.dataset.battleTab}"]`)?.click();
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
