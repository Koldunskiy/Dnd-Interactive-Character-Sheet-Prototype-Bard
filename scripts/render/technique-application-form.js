import { getDerivedStats } from "../calculations.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function numberField(name, label, { min, max, required = true } = {}, draft = {}) {
  return `<label class="field-label">${label}<input class="input" data-workspace-field="${name}" type="number" name="${name}"
    value="${escapeHtml(draft[name] ?? "")}" ${min != null ? `min="${min}"` : ""} ${max != null ? `max="${max}"` : ""}
    step="1" inputmode="numeric" ${required ? "required" : ""}></label>`;
}

function checkbox(name, label, draft, required = false) {
  return `<label class="sara-form-check"><input data-workspace-field="${name}" type="checkbox" name="${name}"
    ${draft[name] === true ? "checked" : ""} ${required ? "required" : ""}> ${label}</label>`;
}

export function renderTechniqueApplicationFields(entry, character, draft = {}) {
  const die = Number(getDerivedStats(character).monk.martialDieSides);
  const number = (name, label, options) => numberField(name, label, options, draft);
  if (entry.id === "ll-monk:deflect-strike") {
    return `<label class="field-label">Вид атаки<select class="input" data-workspace-field="mode" name="mode" required>
      <option value="">Выберите</option><option value="weapon-melee" ${draft.mode === "weapon-melee" ? "selected" : ""}>Рукопашная атака оружием</option>
      <option value="other-melee" ${draft.mode === "other-melee" ? "selected" : ""}>Другая рукопашная атака</option></select></label>
      ${number("incomingDamage", "Входящий урон", { min: 0 })}
      ${number("deflectRoll", `Физический результат к${die}`, { min: 1, max: die })}
      ${number("finalAdjustedDamage", "Итоговый остаток после других поправок (необязательно)", { min: 0, required: false })}
      <fieldset><legend>Применить остаток к моим хитам?</legend>
        <label><input data-workspace-field="applyDamageToSara" type="radio" name="applyDamageToSara" value="true" ${draft.applyDamageToSara === "true" ? "checked" : ""} required> Да</label>
        <label><input data-workspace-field="applyDamageToSara" type="radio" name="applyDamageToSara" value="false" ${draft.applyDamageToSara === "false" ? "checked" : ""} required> Нет, хиты отслеживаются отдельно</label></fieldset>`;
  }
  if (entry.id === "ll-monk:deflect-missile") {
    return `<label class="field-label">Вид атаки<select class="input" data-workspace-field="mode" name="mode" required>
      <option value="">Выберите</option><option value="weapon" ${draft.mode === "weapon" ? "selected" : ""}>Дальнобойная атака оружием</option>
      <option value="other-ranged" ${draft.mode === "other-ranged" ? "selected" : ""}>Другая дальнобойная атака</option>
      <option value="spell" ${draft.mode === "spell" ? "selected" : ""}>Атака заклинанием</option></select></label>
      ${number("incomingDamage", "Входящий урон", { min: 0 })}
      ${number("deflectRoll", `Физический результат к${die}`, { min: 1, max: die })}
      ${number("finalAdjustedDamage", "Итоговый остаток после других поправок (необязательно)", { min: 0, required: false })}
      ${checkbox("freeHand", "Свободная рука", draft)}
      ${checkbox("physicalProjectile", "Физический снаряд", draft)}
      ${checkbox("caught", "Поймать снаряд", draft)}
      <fieldset><legend>Применить остаток к моим хитам?</legend>
        <label><input data-workspace-field="applyDamageToSara" type="radio" name="applyDamageToSara" value="true" ${draft.applyDamageToSara === "true" ? "checked" : ""} required> Да</label>
        <label><input data-workspace-field="applyDamageToSara" type="radio" name="applyDamageToSara" value="false" ${draft.applyDamageToSara === "false" ? "checked" : ""} required> Нет, хиты отслеживаются отдельно</label></fieldset>`;
  }
  if (entry.id === "ll-monk:mystic-regeneration") {
    const derived = getDerivedStats(character);
    return `${number("dieResult", `Физический результат к${die}`, { min: 1, max: die })}
      ${derived.currentHitPoints >= derived.maxHitPoints
        ? checkbox("confirmNoHealing", "Подтверждаю расход 2 ци и действия без полезного лечения", draft, true)
        : ""}`;
  }
  if (entry.id === "ll-monk:step-of-the-wind") {
    return `<label class="field-label">Бонусное действие<select class="input" data-workspace-field="mode" name="mode" required>
      <option value="">Выберите</option><option value="dash" ${draft.mode === "dash" ? "selected" : ""}>Рывок</option>
      <option value="disengage" ${draft.mode === "disengage" ? "selected" : ""}>Отход</option>
      </select></label>`;
  }
  if (entry.id === "ll-monk:mantle-of-courtesy") {
    return number("otherModifiers", "Другие модификаторы проверки", { min: -99, max: 99 });
  }
  if (entry.id === "ll-monk:gentling-touch") {
    const wisdom = getDerivedStats(character).abilityModifiers.wisdom;
    return `${number("extraKi", `Дополнительная ци (0–${wisdom})`, { min: 0, max: wisdom })}
      ${number("targetCurrentHp", "Текущие хиты цели для сравнения с порогом", { min: 0 })}`;
  }
  if (["ll-monk:gale-rush", "ll-monk:tremor-strike", "ll-monk:crushing-strike"].includes(entry.id)) {
    const wisdom = getDerivedStats(character).abilityModifiers.wisdom;
    return number("kiCost", `Ци для этого режима (1–${wisdom})`, { min: 1, max: wisdom });
  }
  if (entry.id === "ll-monk:empty-body") {
    return `<label class="field-label">Режим<select class="input" data-workspace-field="mode" name="mode" required>
      <option value="">Выберите</option><option value="invisibility" ${draft.mode === "invisibility" ? "selected" : ""}>Невидимость · 4 ци</option>
      <option value="astral-projection" ${draft.mode === "astral-projection" ? "selected" : ""}>Астральная проекция · 8 ци</option></select></label>`;
  }
  if (entry.id === "ll-monk:conjure-previous-life") {
    const concentration = String(character.combat?.concentration ?? "");
    return `${number("transferredKi", "Дополнительная ци призванному (от 0)", { min: 0, required: false })}
      ${concentration ? checkbox("replaceConcentration", `Заменить концентрацию «${escapeHtml(concentration)}»`, draft, true) : ""}
      <input data-workspace-field="expectedConcentration" type="hidden" name="expectedConcentration" value="${escapeHtml(draft.expectedConcentration ?? concentration)}">`;
  }
  if (entry.id === "ll-monk:heavenly-step") {
    return checkbox("stopOnSurface", "Подтверждаю остановку на стене, жидкости или потолке; эффект до начала следующего хода", draft, true);
  }
  if (entry.id === "ll-monk:awaken-the-third-eye") {
    return checkbox("meditationConfirmed", "Начать минутную медитацию; 8 ци тратятся сейчас и не возвращаются при прерывании", draft, true);
  }
  return "";
}
