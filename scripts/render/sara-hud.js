import { getDerivedStats } from "../calculations.js";
import { getActionBudget } from "../battle/model.js";
import { escapeHtml } from "./shared/spell-card.js";

export function getSaraHudModel(state, derived = getDerivedStats(state)) {
  const budget = getActionBudget(state);
  const effects = Array.isArray(state?.ui?.activeEffects)
    ? state.ui.activeEffects.filter((effect) =>
      effect && typeof effect === "object" && typeof effect.name === "string" &&
      effect.name.trim())
    : [];
  return {
    hp: derived.currentHitPoints,
    maxHp: derived.maxHitPoints,
    tempHp: derived.tempHitPoints,
    armorClass: derived.armorClass,
    ki: derived.ki,
    practiced: derived.practiced,
    speed: derived.monk?.speedFeet,
    reactionAvailable: budget.reactionAvailable,
    concentration: typeof state?.combat?.concentration === "string"
      ? state.combat.concentration.trim() : "",
    initiative: (() => {
      const battle = state?.battleConsole?.current;
      const initiative = battle?.initiative;
      if (!battle?.id || !["waiting", "own-turn", "paused"].includes(battle.phase) ||
          !initiative || !Number.isSafeInteger(initiative.total) ||
          !Number.isSafeInteger(initiative.rawD20)) return null;
      return {
        total: initiative.total,
        rawD20: initiative.rawD20,
        modifierSources: Array.isArray(initiative.sources) ? initiative.sources : [],
      };
    })(),
    effects: effects.map(({ name, source, duration, notes }) => ({
      name, source, duration, notes,
    })),
  };
}

export function renderSaraEndBattleButton(state, owner) {
  const battle = state?.battleConsole?.current;
  if (state?.profile?.id !== "sara-velaris" || !battle?.id ||
      !["waiting", "own-turn", "paused"].includes(battle.phase) ||
      typeof owner?.characterId !== "string" ||
      !Number.isInteger(owner.sessionGeneration)) return "";
  return `<button type="button" data-sara-end-battle data-workspace-action="end-battle" data-battle-id="${escapeHtml(battle.id)}"
    data-battle-owner="${escapeHtml(JSON.stringify([owner.characterId, owner.sessionGeneration]))}">Завершить бой</button>`;
}

export function renderSaraHud(model, {
  compact = false,
  presentation = "scene",
  section = "all",
} = {}) {
  const layout = ["scene", "header", "task"].includes(presentation) ? presentation : "scene";
  const format = (value) => escapeHtml(value ?? "—");
  const resource = (label, current, maximum, kind) => {
    const valid = typeof current === "number" && Number.isFinite(current) && current >= 0 &&
      typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0;
    const currentText = typeof current === "number" && Number.isFinite(current)
      ? format(current) : "—";
    const maximumText = typeof maximum === "number" && Number.isFinite(maximum)
      ? format(maximum) : "—";
    const valueText = `${currentText} / ${maximumText}`;
    const percent = valid ? (current >= maximum ? 100 : current / maximum * 100) : 0;
    const meterAttributes = valid
      ? `aria-valuemin="0" aria-valuemax="${maximum}" aria-valuenow="${Math.min(current, maximum)}"${current > maximum ? ` aria-valuetext="${escapeHtml(valueText)}"` : ""}`
      : "";
    return `<div class="sara-hud__resource sara-hud__resource--${kind}">
      <div class="sara-hud__resource-heading"><span>${label}</span><strong>${valueText}</strong></div>
      <div class="sara-hud__track"${valid ? ` role="meter" aria-label="${label}" ${meterAttributes}` : ` aria-label="${label}: нет корректных данных"`} style="--sara-resource-fill:${percent}%">
        <span class="sara-hud__fill"></span>
      </div>
      ${valid ? "" : `<span class="sara-hud__invalid">Нет корректных данных</span>`}
    </div>`;
  };
  const effects = (model.effects ?? []).map((effect) => `<li>
    <strong>${format(effect.name)}</strong>
    ${[effect.source, effect.duration, effect.notes].filter((value) =>
      typeof value === "string" && value.trim()).map((value) =>
      `<span>${format(value)}</span>`).join("")}
  </li>`).join("");
  const isHeader = layout === "header";
  const includeResources = section !== "status";
  const includeStatus = section !== "resources";
  const statusMarkup = !includeStatus
    ? ""
    : isHeader
      ? `<div class="sara-hud__secondary">
          <span>Отработано <strong>${format(model.practiced?.current)}/${format(model.practiced?.maximum)}</strong></span>
        </div>`
      : compact
        ? ""
        : `<div class="sara-hud__secondary">
            <span>КД <strong>${format(model.armorClass)}</strong></span>
            ${model.initiative
              ? `<span>Инициатива <strong>${format(model.initiative.total)}</strong></span>` : ""}
            <span>Приёмы <strong>${format(model.practiced?.current)}/${format(model.practiced?.maximum)}</strong></span>
            <span>Скорость <strong>${format(model.speed)} фт</strong></span>
            <span>Реакция <strong>${model.reactionAvailable ? "готова" : "потрачена"}</strong></span>
            ${model.concentration ? `<p>Концентрация: <strong>${format(model.concentration)}</strong></p>` : ""}
          </div>
          ${!isHeader && effects ? `<details class="sara-hud__effects"><summary>Эффекты · ${model.effects.length}</summary><ul>${effects}</ul></details>` : ""}`;
  return `<section class="sara-hud sara-hud--${layout}${compact ? " sara-hud--compact" : ""}" aria-label="Показатели Сары">
    ${includeResources ? `<div class="sara-hud__primary">${resource("ХП", model.hp, model.maxHp, "hp")}
      ${resource("Ци", model.ki?.current, model.ki?.maximum, "ki")}</div>
    ${typeof model.tempHp === "number" && Number.isFinite(model.tempHp) && model.tempHp > 0 ? `<span class="sara-hud__temp">Временные ХП <strong>${format(model.tempHp)}</strong></span>` : ""}` : ""}
    ${statusMarkup}
  </section>`;
}

export function updateSaraHudRegion(region, model, {
  compact = false,
  presentation = "scene",
  section = "all",
} = {}) {
  if (!region) return;
  const markup = renderSaraHud(model, { compact, presentation, section });
  if (region.innerHTML === markup) return;
  const openDetails = [...region.querySelectorAll("details")].map((details) => details.open);
  region.innerHTML = markup;
  [...region.querySelectorAll("details")].forEach((details, index) => {
    if (openDetails[index] !== undefined) details.open = openDetails[index];
  });
}
