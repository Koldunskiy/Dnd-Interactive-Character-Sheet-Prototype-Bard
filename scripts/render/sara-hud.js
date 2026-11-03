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
    effects: effects.map(({ name, source, duration, notes }) => ({
      name, source, duration, notes,
    })),
  };
}

export function renderSaraHud(model, { compact = false } = {}) {
  const format = (value) => escapeHtml(value ?? "—");
  const effects = model.effects.map((effect) => `<li>
    <strong>${format(effect.name)}</strong>
    ${[effect.source, effect.duration, effect.notes].filter((value) =>
      typeof value === "string" && value.trim()).map((value) =>
      `<span>${format(value)}</span>`).join("")}
  </li>`).join("");
  return `<section class="sara-hud${compact ? " sara-hud--compact" : ""}" aria-label="Показатели Сары">
    <div class="sara-hud__primary"><span>ХП <strong>${format(model.hp)}/${format(model.maxHp)}</strong></span>
      <span>КД <strong>${format(model.armorClass)}</strong></span>
      <span>Ци <strong>${format(model.ki?.current)}/${format(model.ki?.maximum)}</strong></span></div>
    ${Number(model.tempHp) > 0 ? `<span class="sara-hud__temp">Временные ХП ${format(model.tempHp)}</span>` : ""}
    ${compact ? "" : `<div class="sara-hud__secondary">
      <span>Приёмы <strong>${format(model.practiced?.current)}/${format(model.practiced?.maximum)}</strong></span>
      <span>Скорость <strong>${format(model.speed)} фт</strong></span>
      <span>Реакция <strong>${model.reactionAvailable ? "готова" : "потрачена"}</strong></span>
      ${model.concentration ? `<p>Концентрация: <strong>${format(model.concentration)}</strong></p>` : ""}
    </div>
    ${effects ? `<details class="sara-hud__effects"><summary>Эффекты · ${model.effects.length}</summary><ul>${effects}</ul></details>` : ""}`}
  </section>`;
}

export function updateSaraHudRegion(region, model, { compact = false } = {}) {
  if (!region) return;
  const markup = renderSaraHud(model, { compact });
  if (region.innerHTML === markup) return;
  const openDetails = [...region.querySelectorAll("details")].map((details) => details.open);
  region.innerHTML = markup;
  [...region.querySelectorAll("details")].forEach((details, index) => {
    if (openDetails[index] !== undefined) details.open = openDetails[index];
  });
}
