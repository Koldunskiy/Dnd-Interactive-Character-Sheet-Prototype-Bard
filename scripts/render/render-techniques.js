import {
  MONK_TECHNIQUES,
  MONK_TECHNIQUE_BY_ID,
  WARRIOR_ADEPT_STYLES,
  CLERIC_CANTRIPS,
  MONK_RULESET_PROVENANCE
} from "../../data/monk-techniques.js";
import { MONK_RACIAL_SPELLS } from "../../data/monk-support-spells.js";
import { getTechniqueAvailability } from "../selectors/techniques.js";
import { applyTechniqueDraft, createTechniqueDraft } from "../technique-editor.js";
import {
  getSessionContext,
  getState,
  updateSessionState
} from "../state.js";
import {
  applySaraCombatAction,
  castSaraRacialSpell,
  completeAwakenThirdEyeMeditation,
  continueDeflectMissile,
  endAwakenThirdEye,
  executeMonkTechnique
} from "../actions/monk.js";
import { getDerivedStats } from "../calculations.js";
import {
  activationLabel,
  paymentLabel,
  sourceLabel,
  spellTitle,
  subchoiceLabel,
  techniqueTitle
} from "../presentation/ru.js";
import { isTechniqueEffectivelySelected } from "../selectors/techniques.js";
import {
  applySaraBuildUpdate,
  proposeSaraBuildUpdate
} from "../migrations/sara-build-20261031.js";
import {
  applyTechniqueToHit,
  closeAttackSequence,
  commitDeflection,
  commitRegeneration,
  markAttackDamageOutside,
  recordAttackDamage,
  recordAttackOutcome,
  recordTargetSaveOutcome,
  startAttackSequence
} from "../actions/sara-combat.js";

const pendingDrafts = new Map();
const techniqueViews = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getSessionKey(context) {
  return `${context.characterId}:${context.sessionGeneration}`;
}

function getTechniqueView(character, key) {
  if (!techniqueViews.has(key)) {
    techniqueViews.set(key, {
      searchQuery: character.ui?.techniques?.searchQuery ?? "",
      source: character.ui?.techniques?.source ?? "all",
      type: character.ui?.techniques?.type ?? "all",
      filter: character.ui?.techniques?.filter ?? "all",
      entitlementEventId: character.ui?.techniques?.entitlementEventId ?? ""
    });
  }
  return techniqueViews.get(key);
}

function filterTechniqueCards(panel, view) {
  const query = view.searchQuery.trim().toLocaleLowerCase("ru");
  panel.querySelectorAll("[data-technique-card]").forEach((card) => {
    const matchesQuery = !query ||
      card.textContent.toLocaleLowerCase("ru").includes(query);
    const matchesSource = view.source === "all" || card.dataset.source === view.source;
    const matchesType = view.type === "all" || card.dataset.type === view.type;
    const matchesSelection = view.filter !== "selected" || card.dataset.selected === "true";
    const matchesAvailability = view.filter !== "available" ||
      (card.dataset.available === "true" && card.dataset.selected !== "true");
    card.hidden = !(matchesQuery && matchesSource && matchesType &&
      matchesSelection && matchesAvailability);
  });
}

function selectedIds(character) {
  return new Set([
    ...(character.monk?.ordinaryTechniqueIds ?? []),
    ...Object.values(character.monk?.signatureTechniqueSlots ?? {})
  ]);
}

function renderTechniqueCard(entry, character, draft) {
  const availability = getTechniqueAvailability(character, entry);
  const isSelected = selectedIds(character).has(entry.id);
  const isEffective = isTechniqueEffectivelySelected(character, entry.id);
  const ordinaryChecked = draft?.ordinaryTechniqueIds.includes(entry.id) ?? isSelected;
  const disabled = !availability.available && !isSelected;
  const source = sourceLabel(entry.sourceId);
  const editControl = draft
    ? `<label><input type="checkbox" data-technique-draft="${escapeHtml(entry.id)}" ${ordinaryChecked ? "checked" : ""} ${disabled ? "disabled" : ""}> Обычный выбор</label>`
    : `<span class="technique-card__status">${isSelected ? isEffective ? "Выбрана · действует" : `Сохранена, но недоступна: ${escapeHtml(availability.reason ?? "проверьте требования")}` : availability.available ? "Доступна" : escapeHtml(availability.reason)}</span>`;
  const useControl = isEffective && availability.available &&
    (entry.category !== "passive" || entry.id === "ll-monk:heavenly-step") && !draft
    ? `<button type="button" class="btn btn--utility" data-technique-use="${escapeHtml(entry.id)}">Применить</button>`
    : "";
  return `
    <article class="technique-card" data-technique-card data-available="${availability.available}"
      data-source="${entry.sourceId === "laserllama-core" ? "core" : "expanded"}"
      data-type="${escapeHtml(entry.category)}" data-selected="${isSelected}">
      <h3>${escapeHtml(techniqueTitle(entry))}</h3>
      <p class="technique-card__meta">${source} · уровень ${entry.minimumMonkLevel} · ${escapeHtml(activationLabel(entry.activation))} · ${escapeHtml(paymentLabel(entry.payment))}</p>
      <p class="technique-card__description">${escapeHtml(entry.trigger)}</p>
      <details><summary>Подробнее</summary>
        <p class="technique-card__description">${escapeHtml(entry.description)}</p>
        <p><strong>Оригинал и источник:</strong> ${escapeHtml(entry.nameEn)} · ${escapeHtml(entry.sourceRevision)}</p>
      </details>
      ${editControl}
      ${useControl}
      ${useControl ? `<form class="sara-combat-form" data-technique-form="${escapeHtml(entry.id)}" hidden>
        <h4>Применение: ${escapeHtml(techniqueTitle(entry))}</h4>
        ${renderTechniqueFormFields(entry, character)}
        ${entry.eligibleStrike ? `<label class="field-label">Оплата
          <select class="input" name="paymentMode">
            <option value="ki">Ци</option>
            <option value="practiced" ${Number(character.combat?.practiced?.current) > 0 ? "" : "disabled"}>Отработанный удар</option>
          </select>
        </label>
        <label class="sara-form-check"><input type="checkbox" name="practicedConditions"> Подтверждаю: сейчас мой ход и техника применяется после безоружного попадания</label>` : ""}
        <label class="sara-form-check"><input type="checkbox" name="confirmed" required> Подтверждаю условия применения; броски и результат цели определяются физически и мастером</label>
        <p class="sara-form-error" data-form-error role="alert"></p>
        <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-technique-form-cancel>Отмена</button>
          <button type="submit" class="btn">Применить</button></div>
      </form>` : ""}
    </article>
  `;
}

function numberField(name, label, { min, max, required = true } = {}) {
  return `<label class="field-label">${label}<input class="input" type="number" name="${name}"
    ${min != null ? `min="${min}"` : ""} ${max != null ? `max="${max}"` : ""}
    step="1" inputmode="numeric" ${required ? "required" : ""}></label>`;
}

function renderTechniqueFormFields(entry, character) {
  const die = Number(getDerivedStats(character).monk.martialDieSides);
  if (entry.id === "ll-monk:deflect-strike") {
    return `<label class="field-label">Вид атаки<select class="input" name="mode" required>
      <option value="">Выберите</option><option value="weapon-melee">Рукопашная атака оружием</option>
      <option value="other-melee">Другая рукопашная атака</option></select></label>
      ${numberField("incomingDamage", "Входящий урон", { min: 0 })}
      ${numberField("deflectRoll", `Физический результат к${die}`, { min: 1, max: die })}
      ${numberField("finalAdjustedDamage", "Итоговый остаток после других поправок (необязательно)", { min: 0, required: false })}
      <fieldset><legend>Применить остаток к моим хитам?</legend>
        <label><input type="radio" name="applyDamageToSara" value="true" required> Да</label>
        <label><input type="radio" name="applyDamageToSara" value="false" required> Нет, хиты отслеживаются отдельно</label></fieldset>`;
  }
  if (entry.id === "ll-monk:deflect-missile") {
    return `<label class="field-label">Вид атаки<select class="input" name="mode" required>
      <option value="">Выберите</option><option value="weapon">Дальнобойная атака оружием</option>
      <option value="other-ranged">Другая дальнобойная атака</option><option value="spell">Атака заклинанием</option></select></label>
      ${numberField("incomingDamage", "Входящий урон", { min: 0 })}
      ${numberField("deflectRoll", `Физический результат к${die}`, { min: 1, max: die })}
      ${numberField("finalAdjustedDamage", "Итоговый остаток после других поправок (необязательно)", { min: 0, required: false })}
      <label class="sara-form-check"><input type="checkbox" name="freeHand"> Свободная рука</label>
      <label class="sara-form-check"><input type="checkbox" name="physicalProjectile"> Физический снаряд</label>
      <label class="sara-form-check"><input type="checkbox" name="caught"> Подтверждаю, что снаряд пойман</label>
      <fieldset><legend>Применить остаток к моим хитам?</legend>
        <label><input type="radio" name="applyDamageToSara" value="true" required> Да</label>
        <label><input type="radio" name="applyDamageToSara" value="false" required> Нет, хиты отслеживаются отдельно</label></fieldset>`;
  }
  if (entry.id === "ll-monk:mystic-regeneration") {
    return `${numberField("dieResult", `Физический результат к${die}`, { min: 1, max: die })}
      ${getDerivedStats(character).currentHitPoints >= getDerivedStats(character).maxHitPoints
        ? `<label class="sara-form-check"><input type="checkbox" name="confirmNoHealing"> Подтверждаю расход 2 ци и действия без полезного лечения</label>`
        : ""}`;
  }
  if (entry.id === "ll-monk:step-of-the-wind") {
    return `<label class="field-label">Бонусное действие<select class="input" name="mode" required>
      <option value="">Выберите</option><option value="dash">Рывок</option><option value="disengage">Отход</option>
      </select></label>`;
  }
  if (entry.id === "ll-monk:mantle-of-courtesy") {
    return numberField("otherModifiers", "Другие модификаторы проверки", { min: -99, max: 99 });
  }
  if (entry.id === "ll-monk:gentling-touch") {
    return `${numberField("extraKi", "Дополнительная ци (0–модификатор Мудрости)", { min: 0, max: getDerivedStats(character).abilityModifiers.wisdom })}
      ${numberField("targetCurrentHp", "Текущие хиты цели для сравнения с порогом", { min: 0 })}`;
  }
  if (["ll-monk:gale-rush", "ll-monk:tremor-strike", "ll-monk:crushing-strike"].includes(entry.id)) {
    return numberField("kiCost", "Ци для этого режима (1–модификатор Мудрости)", {
      min: 1,
      max: getDerivedStats(character).abilityModifiers.wisdom
    });
  }
  if (entry.id === "ll-monk:empty-body") {
    return `<label class="field-label">Режим<select class="input" name="mode" required>
      <option value="">Выберите</option><option value="invisibility">Невидимость · 4 ци</option>
      <option value="astral-projection">Астральная проекция · 8 ци</option></select></label>`;
  }
  if (entry.id === "ll-monk:conjure-previous-life") {
    const concentration = String(character.combat?.concentration ?? "");
    return `${numberField("transferredKi", "Дополнительная ци призванному (от 0)", { min: 0, required: false })}
      ${concentration ? `<label class="sara-form-check"><input type="checkbox" name="replaceConcentration"> Заменить концентрацию «${escapeHtml(concentration)}»</label>` : ""}
      <input type="hidden" name="expectedConcentration" value="${escapeHtml(concentration)}">`;
  }
  if (entry.id === "ll-monk:heavenly-step") {
    return `<label class="sara-form-check"><input type="checkbox" name="stopOnSurface" required> Подтверждаю остановку на стене, жидкости или потолке; эффект до начала следующего хода</label>`;
  }
  if (entry.id === "ll-monk:awaken-the-third-eye") {
    return `<label class="sara-form-check"><input type="checkbox" name="meditationConfirmed" required> Начать минутную медитацию; 8 ци тратятся сейчас и не возвращаются при прерывании</label>`;
  }
  return `<p>Проверьте полный текст правила и вручную выполните требуемые броски и решения мастера.</p>`;
}

function renderBattleTechniqueForm(techniqueId, state) {
  const entry = MONK_TECHNIQUE_BY_ID.get(techniqueId);
  if (!entry || !isTechniqueEffectivelySelected(state, techniqueId)) return "";
  return `<form class="sara-combat-form" data-battle-technique-form="${escapeHtml(techniqueId)}">
    <h4>${escapeHtml(techniqueTitle(entry))}</h4>
    ${renderTechniqueFormFields(entry, state)}
    <label class="sara-form-check"><input type="checkbox" name="confirmed" required>
      Подтверждаю условия применения; броски и цель определяются физически и мастером</label>
    <p class="sara-form-error" data-form-error role="alert"></p>
    <button type="submit" class="btn btn--utility">Применить из боевого листа</button>
  </form>`;
}

function renderSaraActionForm(actionId) {
  if (actionId === "flurry") {
    return `<form class="sara-combat-form" data-sara-action-form="flurry" hidden>
      <p>Начало сразу потратит 1 ци и отметит бонусное действие; два безоружных удара при 12 уровне.</p>
      <label class="sara-form-check"><input type="checkbox" name="confirmed" required> Подтверждаю расход 1 ци и начало Шквала</label>
      <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-sara-form-cancel>Отмена</button>
        <button type="submit" class="btn">Начать шквал — 1 ци</button></div></form>`;
  }
  if (actionId === "bonus-unarmed") {
    return `<form class="sara-combat-form" data-sara-action-form="bonus-unarmed" hidden>
      <label class="sara-form-check"><input type="checkbox" name="triggerConfirmed" required> Подтверждаю условие бонусной атаки Боевых искусств</label>
      <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-sara-form-cancel>Отмена</button>
        <button type="submit" class="btn">Записать бонусную атаку</button></div></form>`;
  }
  return `<form class="sara-combat-form" data-sara-action-form="ebb-and-flow" hidden>
    <p>Подтвердите видимый промах рукопашной атаки. Эффект цели разрешается вручную.</p>
    <label class="field-label">Ответ<select class="input" name="mode" required>
      <option value="">Выберите</option><option value="unarmed">Ответный безоружный удар</option>
      <option value="dexterity-save">Спасбросок Ловкости цели · СЛ 16</option></select></label>
    <label class="sara-form-check"><input type="checkbox" name="missConfirmed" required> Видимая рукопашная атака промахнулась</label>
    <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-sara-form-cancel>Отмена</button>
      <button type="submit" class="btn">Применить «Прилив и отлив»</button></div></form>`;
}

function newUiId(prefix) {
  return globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderAttackRollForm(sequenceId, attackId, attackNumber, total, kind, currentActionUsed) {
  const startKind = attackNumber === 1 &&
    ["attack-action", "bonus-unarmed", "reaction-unarmed"].includes(kind) ? kind : "";
  return `<form class="sara-combat-form" data-sara-attack-submit
      data-action-id="${escapeHtml(sequenceId)}" data-attack-id="${escapeHtml(attackId)}"
      data-attack-kind="${startKind}" hidden>
    <h4>${kind === "attack-action" ? `Действие «Атака» — удар ${attackNumber} из ${total}` : kind === "bonus-unarmed" ? "Бонусный безоружный удар" : kind === "reaction-unarmed" ? "Ответный безоружный удар" : `Атака — удар ${attackNumber} из ${total}`}</h4>
    <p>Безоружная атака: ${escapeHtml(String(getDerivedStats(getState()).saraAttackProfiles.unarmed.attackBonus))}; урон ${escapeHtml(getDerivedStats(getState()).saraAttackProfiles.unarmed.damageDice)} +${escapeHtml(String(getDerivedStats(getState()).saraAttackProfiles.unarmed.damageModifier))}.</p>
    ${["bonus-unarmed", "reaction-unarmed"].includes(kind) && attackNumber === 1
      ? `<label class="sara-form-check"><input type="checkbox" name="triggerConfirmed" required> Подтверждаю условие этой атаки</label>` : ""}
    <label class="field-label">Цель (необязательно)<input class="input" type="text" name="targetLabel" maxlength="60"></label>
    <label class="field-label">Режим<select class="input" name="rollMode" required>
      <option value="normal">Обычный</option><option value="advantage">Преимущество</option><option value="disadvantage">Помеха</option></select></label>
    <label class="field-label">Результат к20<input class="input" type="number" min="1" max="20" step="1" inputmode="numeric" name="firstD20" required></label>
    <label class="field-label">Второй к20 (для преимущества/помехи)<input class="input" type="number" min="1" max="20" step="1" inputmode="numeric" name="secondD20"></label>
    <label class="field-label">КД цели (необязательно)<input class="input" type="number" min="1" max="99" step="1" inputmode="numeric" name="targetArmorClass"></label>
    <label class="field-label">Если КД неизвестна или мастер исправляет результат<select class="input" name="dmHitResult">
      <option value="">Не указано</option><option value="hit">Мастер подтверждает попадание</option>
      <option value="miss">Мастер подтверждает промах</option></select></label>
    ${currentActionUsed && startKind ? `<label class="sara-form-check"><input type="checkbox" name="confirmSeparateAction"> Подтверждаю отдельное дополнительное действие или ручную корректировку</label>` : ""}
    <p class="sara-form-error" data-form-error role="alert"></p>
    <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-sara-form-cancel>Отмена</button>
      <button type="submit" class="btn">Подтвердить попадание / записать промах</button></div>
  </form>`;
}

function renderAttackSequence(state, derived) {
  const sequences = state.monk?.combatAssistant?.activeSequences ?? [];
  const activeSequence = sequences.find((entry) => entry.status === "open");
  const displayedSequence = activeSequence ??
    [...sequences].reverse().find((entry) => entry.status === "complete" || entry.status === "abandoned");
  const attackActionId = activeSequence?.id ?? newUiId("attack-sequence");
  const attackNumber = (activeSequence?.resolvedAttacks?.length ?? 0) + 1;
  const maxAttacks = activeSequence?.maximumAttacks ?? (derived.level >= 5 ? 2 : 1);
  const details = displayedSequence?.resolvedAttacks?.map((attack) => `
    <article class="sara-attack-record">
      <h4>Удар ${escapeHtml(String(attack.chosenD20))} · ${attack.hitResult === "hit" ? "попадание" : "промах"}
        ${attack.critical ? " · критическое попадание" : ""}</h4>
      <p>${escapeHtml(attack.optionalTargetLabel || "Цель не указана")} · ${escapeHtml(attack.rawD20Rolls.join(" / "))} + ${escapeHtml(String(attack.attackBonusSnapshot))} = ${escapeHtml(String(attack.attackTotal))}</p>
      ${attack.critical && attack.profileId === "unarmed" ? `<p>Удар открытой ладони: цель совершает с помехой спасбросок, вызванный этой атакой.</p>` : ""}
      ${attack.hitResult === "hit" && attack.damageStatus === "awaiting-damage" ? `
        <form class="sara-combat-form" data-sara-damage-submit data-action-id="${escapeHtml(displayedSequence.id)}" data-attack-id="${escapeHtml(attack.id)}">
          ${Array.from({ length: attack.critical ? 2 : 1 }, (_, index) =>
            numberField(`damage${index + 1}`, `Физический результат к${derived.monk.martialDieSides} урона ${index + 1}`, {
              min: 1, max: derived.monk.martialDieSides
            })).join("")}
          <p>Урон до сопротивлений и других поправок цели.</p>
          <p class="sara-form-error" data-form-error role="alert"></p>
          <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-mark-damage-outside="${escapeHtml(attack.id)}" data-action-id="${escapeHtml(displayedSequence.id)}">Урон учтён вне приложения</button>
            <button type="submit" class="btn">Записать урон</button></div>
        </form>` : attack.damageTotalBeforeTargetModifiers != null
        ? `<p>Урон: ${escapeHtml(String(attack.damageTotalBeforeTargetModifiers))} до поправок цели.</p>` : ""}
      ${attack.hitResult === "hit" && attack.profileId === "unarmed" &&
        !attack.techniqueApplicationId && sequenceStillCurrent(state, displayedSequence)
        ? renderStrikeForm(state, displayedSequence.id, attack.id) : ""}
    </article>`).join("") ?? "";
  const nextAttackForm = activeSequence
    ? attackNumber <= maxAttacks
      ? `<button type="button" class="btn btn--utility" data-attack-form-open="${escapeHtml(attackActionId)}">Ввести удар ${attackNumber}</button>
        ${renderAttackRollForm(attackActionId, `${attackActionId}:${attackNumber}`, attackNumber, maxAttacks, activeSequence.kind, Boolean(state.ui?.turn?.actionUsed))}`
      : ""
    : `<button type="button" class="btn" data-attack-form-open="${escapeHtml(attackActionId)}">Атака — ${maxAttacks} удара</button>
      ${renderAttackRollForm(attackActionId, `${attackActionId}:1`, 1, maxAttacks, "attack-action", Boolean(state.ui?.turn?.actionUsed))}
      ${(() => {
        const bonusId = newUiId("bonus-unarmed");
        return `<button type="button" class="btn btn--utility" data-attack-form-open="${escapeHtml(bonusId)}">Бонусный безоружный удар</button>
          ${renderAttackRollForm(bonusId, `${bonusId}:1`, 1, 1, "bonus-unarmed", false)}`;
      })()}`;
  const currentPending = state.monk?.combatAssistant?.pendingApplications ?? [];
  const pending = currentPending.map((application) => `
    <form class="sara-combat-form sara-save-outcome" data-save-outcome="${escapeHtml(application.id)}">
      <p>${escapeHtml(application.techniqueId)} · СЛ ${escapeHtml(String(application.dc))} · спасбросок ${escapeHtml(application.saveAbility ?? "по правилу")}</p>
      ${application.criticalDisadvantageReminder ? `<p>${escapeHtml(application.criticalDisadvantageReminder)}</p>` : ""}
      ${application.manualTimingNote ? `<p>${escapeHtml(application.manualTimingNote)}</p>` : ""}
      <label class="field-label">Результат цели<select class="input" name="outcome" required>
        <option value="">Неизвестен</option><option value="success">Успех</option><option value="failure">Провал</option><option value="unknown">Оставить неизвестным</option></select></label>
      <button type="submit" class="btn btn--utility">Записать результат без повторной оплаты</button>
    </form>`).join("");
  return `<section class="panel-section sara-attack-assistant">
    <h3>Физические броски</h3>
    ${activeSequence ? `<p>Последовательность ${escapeHtml(activeSequence.kind)}: ${activeSequence.resolvedAttacks.length}/${activeSequence.maximumAttacks} атак. Закрытие не отменяет уже записанные действия и расходы.</p>` : ""}
    ${details}
    ${nextAttackForm}
    ${activeSequence ? `<button type="button" class="btn btn--utility" data-sequence-close="${escapeHtml(activeSequence.id)}">Закрыть последовательность</button>` : ""}
    ${pending ? `<h4>Ожидаемые спасброски</h4>${pending}` : ""}
  </section>`;
}

function sequenceStillCurrent(state, sequence) {
  return Number(sequence?.turnMarker ?? -1) === Number(state.ui?.turn?.turnNumber ?? 1);
}

function renderStrikeForm(state, actionId, attackId) {
  const effective = new Set(getDerivedStats(state).effectiveTechniqueIds ?? []);
  const choices = MONK_TECHNIQUES.filter((entry) =>
    entry.eligibleStrike && effective.has(entry.id) &&
    ["ll-monk:empowered-strike", "ll-monk:stunning-strike",
      "ll-monk:crippling-strike", "ll-monk:slowing-strike"].includes(entry.id));
  if (!choices.length) return "";
  return `<form class="sara-combat-form" data-sara-strike-submit
      data-action-id="${escapeHtml(actionId)}" data-attack-id="${escapeHtml(attackId)}">
    <h4>Техника после попадания</h4>
    <label class="field-label">Техника<select class="input" name="techniqueId" required>
      <option value="">Выберите</option>${choices.map((entry) =>
        `<option value="${escapeHtml(entry.id)}">${escapeHtml(techniqueTitle(entry))}</option>`).join("")}
    </select></label>
    <label class="field-label">Оплата<select class="input" name="paymentMode" required>
      <option value="ki">Ци</option><option value="practiced" ${Number(state.combat?.practiced?.current) > 0 ? "" : "disabled"}>Отработанный удар · свой ход</option>
    </select></label>
    <label class="field-label">Эффект «Калечащего удара»<select class="input" name="effect">
      <option value="">Не применяется</option><option value="blinded">Ослепление</option>
      <option value="deafened">Глухота</option><option value="unable-to-speak">Невозможность говорить</option></select></label>
    <label class="sara-form-check"><input type="checkbox" name="practicedConditions"> Подтверждаю свой ход и безоружное попадание для оплаты отработанным ударом</label>
    <p class="sara-form-error" data-form-error role="alert"></p>
    <button type="submit" class="btn">Применить технику к этому попаданию</button>
  </form>`;
}

function renderSignatureSelects(character, draft) {
  const level = Number(character.profile?.level ?? 1);
  return [3, 5, 9].filter((slotLevel) => level >= slotLevel).map((slotLevel) => {
    const slot = `open-hand:${slotLevel}`;
    const currentId = draft?.signatureTechniqueSlots[slot] ?? character.monk.signatureTechniqueSlots[slot] ?? "";
    const choices = MONK_TECHNIQUES.filter((entry) =>
      (entry.eligibleStrike || entry.id === currentId) && entry.minimumMonkLevel <= level);
    return `<label class="field-label">Техника подкласса · уровень ${slotLevel}<select class="input" data-signature-slot="${slot}" ${draft ? "" : "disabled"}>
      ${choices.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === currentId ? "selected" : ""}>${escapeHtml(techniqueTitle(entry))}</option>`).join("")}
    </select></label>`;
  }).join("");
}

function renderTechniqueChoices(character, draft) {
  const before = selectedIds(character);
  const changedChoices = [
    ...draft.ordinaryTechniqueIds,
    ...Object.values(draft.signatureTechniqueSlots)
  ].filter((id) => !before.has(id));
  return changedChoices.map((id) => {
    const choice = draft.techniqueChoices[id] ?? {};
    if (id === "ll-monk:divine-light") {
      const selected = choice.clericCantripIds ?? [];
      return `<fieldset class="technique-choice">
        <legend>Сияние божества — выберите два разных заговора</legend>
        ${[0, 1].map((index) => `<label class="field-label">Заговор ${index + 1}
          <select class="input" data-technique-choice="divine-light:${index}">
            <option value="">Выберите</option>
            ${CLERIC_CANTRIPS.map((spell) => `<option value="${escapeHtml(spell.id)}" ${selected[index] === spell.id ? "selected" : ""}>${escapeHtml(spell.name)}</option>`).join("")}
          </select>
        </label>`).join("")}
      </fieldset>`;
    }
    if (id === "ll-monk:warrior-adept") {
      return `<label class="field-label technique-choice">Воинский адепт — выберите один стиль
        <select class="input" data-technique-choice="warrior-adept">
          <option value="">Выберите стиль</option>
          ${WARRIOR_ADEPT_STYLES.map((style) => `<option value="${escapeHtml(style.id)}" ${choice.styleId === style.id ? "selected" : ""}>${escapeHtml(subchoiceLabel(style.id))}</option>`).join("")}
        </select>
      </label>`;
    }
    return "";
  }).join("");
}

export function renderSaraCombatPanel(state, derived) {
  const ki = derived.monk.kiMaximum;
  const currentKi = state.combat.ki.current;
  const divineLightIds = state.monk?.ordinaryTechniqueIds?.includes("ll-monk:divine-light") ||
    Object.values(state.monk?.signatureTechniqueSlots ?? {}).includes("ll-monk:divine-light")
    ? state.monk?.techniqueChoices?.["ll-monk:divine-light"]?.clericCantripIds ?? []
    : [];
  const divineLight = divineLightIds.map((id) =>
    CLERIC_CANTRIPS.find((cantrip) => cantrip.id === id)).filter(Boolean);
  const battleTechniques = [
    "ll-monk:deflect-strike",
    "ll-monk:deflect-missile",
    "ll-monk:mystic-regeneration"
  ].map((id) => renderBattleTechniqueForm(id, state)).filter(Boolean);
  const buildProposal = proposeSaraBuildUpdate(state);
  const buildUpdate = buildProposal.status === "proposal" ? `
    <section class="panel-section sara-build-update">
      <h3>Обновить согласованный билд Сары</h3>
      ${buildProposal.techniqueDelta?.remove
        ? `<p>Техники: Небесный шаг → Замедляющий удар</p>`
        : buildProposal.conflicts.some((conflict) => conflict.kind === "custom-techniques")
          ? `<p>Ваш текущий набор техник отличается. Он не будет заменён без отдельного подтверждения.</p>`
          : ""}
      ${buildProposal.itemDelta ? `<p>Предметы: добавить Эмблему когтей</p>
        <p>Безоружные атаки при ношении эмблемы: +${derived.saraAttackProfiles.unarmed.attackBonus}, ${escapeHtml(derived.saraAttackProfiles.unarmed.damageDice)} +${derived.saraAttackProfiles.unarmed.damageModifier}</p>
        <label class="field-label"><input type="checkbox" data-sara-insignia-wear checked> Носить после добавления</label>` : ""}
      ${buildProposal.conflicts.map((conflict) => `<p role="alert">${conflict.kind === "ambiguous-insignia"
        ? `Предмет «${escapeHtml(conflict.itemName)}» похож на эмблему, но не распознан по идентификатору.`
        : conflict.kind === "custom-techniques"
          ? "Сохраните свой набор или пересоберите его в редакторе."
          : "Обнаружена неоднозначность дубликатов Эмблемы когтей."}</p>`).join("")}
      <p>Сохраняются текущие ресурсы, заметки, история и прочие вещи.</p>
      <button type="button" class="btn" data-sara-build-update="apply">
        ${buildProposal.conflicts.some((conflict) => conflict.kind === "custom-techniques")
          ? buildProposal.itemDelta ? "Сохранить мой набор и добавить Эмблему когтей" : "Сохранить мой набор"
          : "Применить обновление"}
      </button>
      <p class="technique-card__status" data-sara-build-status role="status"></p>
    </section>` : "";
  const racial = MONK_RACIAL_SPELLS.map((spell) => {
    const savedSpell = state.spellcasting?.racialSpells?.find((entry) =>
      entry.id === spell.id && entry.source === spell.source && entry.mode === spell.mode);
    const uses = savedSpell?.uses;
    return `
    <article class="technique-card">
      <h3>${escapeHtml(spellTitle(spell.name))}</h3>
      <p class="technique-card__meta">${spell.mode === "cantrip" ? "Заговор" : spell.mode === "at-will-racial" ? "Без ограничений" : "1 раз за долгий отдых"} · Действие · ${escapeHtml(spell.range)}</p>
      <p class="technique-card__description">${escapeHtml(spell.description)}</p>
      <p>${escapeHtml(spell.damage ?? spell.duration ?? "Без лимита применений")}</p>
      ${uses ? `<p>Осталось: ${escapeHtml(uses.current)} / ${escapeHtml(uses.max)}</p>` : ""}
      <details><summary>Оригинал и источник</summary><p>${escapeHtml(spell.name)} · Yuan-ti MotM · правила заклинаний 2014 года</p></details>
      <button type="button" class="btn btn--utility" data-racial-form-open="${escapeHtml(spell.id)}"
        ${uses && Number(uses.current) < 1 ? "disabled" : ""}>Открыть форму применения</button>
      <form class="sara-combat-form" data-racial-spell-form="${escapeHtml(spell.id)}"
        data-current-concentration="${escapeHtml(state.combat?.concentration ?? "")}" hidden>
        <label class="sara-form-check"><input type="checkbox" name="confirmed" required>
          Подтверждаю применение; цель, спасбросок и результат определяются вручную</label>
        ${spell.concentration && state.combat?.concentration
          ? `<label class="sara-form-check"><input type="checkbox" name="replaceConcentration" required>
            Заменить текущую концентрацию «${escapeHtml(state.combat.concentration)}»</label>` : ""}
        <p class="sara-form-error" data-form-error role="alert"></p>
        <div class="sara-form-actions"><button type="button" class="btn btn--utility" data-racial-form-cancel>Отмена</button>
          <button type="submit" class="btn">Применить заклинание</button></div>
      </form>
    </article>`;
  }).join("");
  return `
    <section class="panel-section">
      <h2 class="section-title">Боевые искусства · Открытая ладонь</h2>
      <p>Кость Боевых искусств: ${escapeHtml(derived.monk.martialDie)} · СЛ техник: ${derived.monk.techniqueSaveDc} · безоружная атака ${derived.unarmedAttackBonus >= 0 ? "+" : ""}${derived.unarmedAttackBonus}, ${escapeHtml(derived.unarmedDamage)}.</p>
      <label class="field-label"><span>Текущая ци</span><input class="input" type="number" min="0" max="${ki}" step="1" data-bind="combat.ki.current" value="${escapeHtml(currentKi)}"></label>
      <label class="field-label"><span>Отработанные удары</span><input class="input" type="number" min="0" max="${derived.monk.practicedMaximum}" step="1" data-bind="combat.practiced.current" value="${escapeHtml(state.combat.practiced.current)}"></label>
      <label class="field-label"><span>Оставшиеся кости хитов к10</span><input class="input" type="number" min="0" max="${derived.level}" step="1" data-bind="combat.hitDice.remaining" value="${escapeHtml(state.combat.hitDice?.remaining ?? derived.level)}"></label>
      <p class="sara-ki-note">Воинский дух: в начале своего хода в бою вручную восстановите 1 ци, если не недееспособны, не выше максимума. Автоматического начисления нет.</p>
      ${renderAttackSequence(state, derived)}
      ${battleTechniques.length ? `<section class="panel-section">
        <h3>Реакция и восстановление</h3>${battleTechniques.join("")}
      </section>` : ""}
      <div class="technique-controls">
        <button type="button" class="btn btn--utility" data-sara-action="flurry">Шквал — 1 ци</button>
        ${derived.level >= 6 ? `<button type="button" class="btn btn--utility" data-sara-action="ebb-and-flow">Прилив и отлив · реакция</button>` : ""}
      </div>
      <div class="sara-action-forms">${renderSaraActionForm("flurry")}${derived.level >= 6 ? renderSaraActionForm("ebb-and-flow") : ""}</div>
      <p>Бонусный безоружный удар требует подходящего условия Боевых искусств. Шквал даёт ${derived.level >= 17 ? 3 : 2} безоружных удара и не требует действия «Атака». Приложение не определяет попадания.</p>
      ${buildUpdate}
      <h3>Расовая магия Yuan-ti (MotM; тексты 2014)</h3>
      <div class="technique-list">${racial}</div>
      ${divineLight.length ? `<h3>Заговоры «Сияния божества»</h3><div class="technique-list">${divineLight.map((cantrip) => `
        <article class="technique-card">
          <h4>${escapeHtml(cantrip.name)}</h4>
          <p class="technique-card__description">${escapeHtml(cantrip.text)}</p>
        </article>`).join("")}</div>` : ""}
      <p class="technique-card__status" data-sara-combat-status role="status"></p>
    </section>
  `;
}

export function bindSaraCombatControls() {
  const root = document.getElementById("meleePanel");
  if (!root || root.dataset.racialControlsBound) return;
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const combatActionTarget = event.target.closest("[data-sara-action]");
    if (combatActionTarget && root.contains(combatActionTarget) &&
        combatActionTarget.isConnected && !combatActionTarget.closest("[hidden]") &&
        combatActionTarget.dataset.processing !== "true") {
      const actionId = combatActionTarget.dataset.saraAction;
      const form = root.querySelector(`[data-sara-action-form="${actionId}"]`);
      if (form) {
        form.hidden = false;
        form.querySelector("input, select, button")?.focus();
      }
      return;
    }
    if (event.target.closest("[data-sara-form-cancel], [data-racial-form-cancel]")) {
      const form = event.target.closest("form");
      if (form) {
        form.hidden = true;
        form.closest(".technique-card, .panel-section")?.querySelector("button")?.focus();
      }
      return;
    }
    const racialOpen = event.target.closest("[data-racial-form-open]");
    if (racialOpen && root.contains(racialOpen)) {
      const form = racialOpen.closest(".technique-card")?.querySelector("[data-racial-spell-form]");
      if (form) {
        form.hidden = false;
        form.querySelector("input, select, button")?.focus();
      }
      return;
    }
    const attackFormOpen = event.target.closest("[data-attack-form-open]");
    if (attackFormOpen && root.contains(attackFormOpen)) {
      const form = root.querySelectorAll("[data-sara-attack-submit]");
      const matchingForm = [...form].find((item) =>
        item.dataset.actionId === attackFormOpen.dataset.attackFormOpen);
      if (matchingForm) {
        matchingForm.hidden = false;
        matchingForm.querySelector("input, select")?.focus();
      }
      return;
    }
    const markDamageTarget = event.target.closest("[data-mark-damage-outside]");
    if (markDamageTarget && root.contains(markDamageTarget)) {
      const result = markAttackDamageOutside(
        getSessionContext(),
        markDamageTarget.dataset.actionId,
        markDamageTarget.dataset.markDamageOutside,
        newUiId("damage-outside")
      );
      const status = markDamageTarget.closest("form")?.querySelector("[data-form-error]");
      if (result.status !== "applied" && status) status.textContent = result.reason;
      return;
    }
    const closeSequenceTarget = event.target.closest("[data-sequence-close]");
    if (closeSequenceTarget && root.contains(closeSequenceTarget)) {
      const result = closeAttackSequence(
        getSessionContext(),
        closeSequenceTarget.dataset.sequenceClose,
        newUiId("sequence-close")
      );
      const status = root.querySelector("[data-sara-combat-status]");
      if (result.status !== "applied" && status) status.textContent = result.reason;
      return;
    }
    const buildUpdateTarget = event.target.closest("[data-sara-build-update]");
    if (buildUpdateTarget && root.contains(buildUpdateTarget)) {
      const context = getSessionContext();
      const character = getState();
      const proposal = proposeSaraBuildUpdate(character);
      const wear = root.querySelector("[data-sara-insignia-wear]")?.checked !== false;
      const decisions = {
        techniques: proposal.conflicts?.some((conflict) => conflict.kind === "custom-techniques")
          ? "keep"
          : proposal.techniqueDelta?.remove ? "apply" : undefined,
        insignia: proposal.itemDelta ? "add" : undefined,
        wearInsignia: wear
      };
      const result = updateSessionState(context, (draft) => {
        const applied = applySaraBuildUpdate(draft, proposal, decisions);
        if (applied.status !== "applied") throw new Error(applied.reason);
        return applied.state;
      }, {
        operationId: `sara-build-update:${proposal.patchId ?? "missing"}`,
        metadata: { kind: "sara-build-update", patchId: proposal.patchId }
      });
      const status = root.querySelector("[data-sara-build-status]");
      if (result.status !== "applied") {
        if (status) status.textContent = result.reason ?? "Обновление не применено.";
      } else if (!result.persistence.ok && status) {
        status.textContent = "Обновление применено в памяти, но не сохранено. Повторите сохранение; повторно применять изменения не нужно.";
      }
      return;
    }
  });
  root.addEventListener("submit", (event) => {
    const attackForm = event.target.closest("[data-sara-attack-submit]");
    const damageForm = event.target.closest("[data-sara-damage-submit]");
    const strikeForm = event.target.closest("[data-sara-strike-submit]");
    const saveOutcomeForm = event.target.closest("[data-save-outcome]");
    const battleTechniqueForm = event.target.closest("[data-battle-technique-form]");
    if (attackForm || damageForm || strikeForm || saveOutcomeForm || battleTechniqueForm) {
      event.preventDefault();
      const form = attackForm ?? damageForm ?? strikeForm ?? saveOutcomeForm ?? battleTechniqueForm;
      if (form.dataset.processing === "true") return;
      form.dataset.processing = "true";
      const submit = form.querySelector("[type='submit']");
      if (submit) submit.disabled = true;
      const values = new FormData(form);
      const context = getSessionContext();
      const operationId = newUiId("sara-combat");
      let result;
      if (attackForm) {
        result = recordAttackOutcome(
          context,
          attackForm.dataset.actionId,
          attackForm.dataset.attackId,
          {
            kind: attackForm.dataset.attackKind || undefined,
            profileId: "unarmed",
            targetLabel: values.get("targetLabel"),
            rollMode: values.get("rollMode"),
            firstD20: values.get("firstD20"),
            secondD20: values.get("secondD20"),
            targetArmorClass: values.get("targetArmorClass"),
            dmHitResult: values.get("dmHitResult") || undefined,
            triggerConfirmed: values.has("triggerConfirmed"),
            confirmSeparateAction: values.has("confirmSeparateAction")
          },
          operationId
        );
      } else if (damageForm) {
        const damageRolls = [...form.querySelectorAll("input[name^='damage']")]
          .map((input) => input.value);
        result = recordAttackDamage(
          context,
          damageForm.dataset.actionId,
          damageForm.dataset.attackId,
          damageRolls,
          operationId
        );
      } else if (strikeForm) {
        const paymentMode = values.get("paymentMode");
        const practicedConfirmed = values.has("practicedConditions");
        result = applyTechniqueToHit(
          context,
          strikeForm.dataset.actionId,
          strikeForm.dataset.attackId,
          values.get("techniqueId"),
          {
            confirmed: true,
            paymentMode,
            ownTurnConfirmed: paymentMode === "practiced" && practicedConfirmed,
            unarmedHitConfirmed: paymentMode === "practiced" && practicedConfirmed,
            effect: values.get("effect") || undefined
          },
          operationId
        );
      } else if (battleTechniqueForm) {
        const techniqueId = battleTechniqueForm.dataset.battleTechniqueForm;
        if (techniqueId === "ll-monk:mystic-regeneration") {
          result = commitRegeneration(
            context,
            values.get("dieResult"),
            operationId,
            { confirmNoHealing: values.has("confirmNoHealing") }
          );
        } else {
          result = commitDeflection(context, {
            kind: techniqueId === "ll-monk:deflect-missile" ? "missile" : "melee",
            mode: values.get("mode"),
            incomingDamage: values.get("incomingDamage"),
            deflectRoll: values.get("deflectRoll"),
            finalAdjustedDamage: values.get("finalAdjustedDamage"),
            freeHand: values.has("freeHand"),
            physicalProjectile: values.has("physicalProjectile"),
            caught: values.has("caught"),
            applyDamageToSara: values.get("applyDamageToSara") === "true"
          }, operationId);
        }
      } else {
        result = recordTargetSaveOutcome(
          context,
          saveOutcomeForm.dataset.saveOutcome,
          values.get("outcome"),
          operationId
        );
      }
      if (form.isConnected) {
        form.dataset.processing = "false";
        if (submit) submit.disabled = false;
      }
      if (result.status !== "applied") {
        const status = form.querySelector("[data-form-error]") ??
          root.querySelector("[data-sara-combat-status]");
        if (status) status.textContent = result.reason ?? "Операция не применена.";
      } else {
        const status = root.querySelector("[data-sara-combat-status]");
        if (status) status.textContent = result.persistence?.ok === false
          ? "Изменение применено в памяти, но сохранение не удалось. Повторите сохранение; операция повторно не применяется."
          : "Результат записан.";
      }
      return;
    }
    const racialForm = event.target.closest("[data-racial-spell-form]");
    const actionForm = event.target.closest("[data-sara-action-form]");
    if (!racialForm && !actionForm) return;
    event.preventDefault();
    const form = racialForm ?? actionForm;
    if (form.dataset.processing === "true") return;
    form.dataset.processing = "true";
    const submit = form.querySelector("[type='submit']");
    if (submit) submit.disabled = true;
    const values = new FormData(form);
    const context = getSessionContext();
    let result;
    if (racialForm) {
      const spellId = racialForm.dataset.racialSpellForm;
      const expectedConcentration = racialForm.dataset.currentConcentration ?? "";
      result = castSaraRacialSpell(context, spellId, {
        confirmed: values.has("confirmed"),
        replaceConcentration: values.has("replaceConcentration"),
        expectedConcentration,
        operationId: globalThis.crypto?.randomUUID?.() ??
          `racial-spell-${Date.now()}-${Math.random().toString(16).slice(2)}`
      });
    } else {
      const actionId = actionForm.dataset.saraActionForm;
      const operationId = globalThis.crypto?.randomUUID?.() ??
        `sara-action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (actionId === "flurry") {
        const sequenceId = globalThis.crypto?.randomUUID?.() ??
          `sara-sequence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        result = startAttackSequence(context, {
          kind: actionId,
          sequenceId,
          confirmed: values.has("confirmed")
        }, operationId);
      } else if (values.get("mode") === "unarmed") {
        result = startAttackSequence(context, {
          kind: "reaction-unarmed",
          sequenceId: globalThis.crypto?.randomUUID?.() ??
            `ebb-response-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          triggerConfirmed: values.has("missConfirmed")
        }, operationId);
      } else {
        result = applySaraCombatAction(context, actionId, {
          confirmed: values.has("missConfirmed"),
          mode: values.get("mode")
        });
      }
    }
    form.dataset.processing = "false";
    if (submit) submit.disabled = false;
    const status = form.querySelector("[data-form-error]") ??
      root.querySelector("[data-sara-combat-status]");
    if (result.status !== "applied") {
      if (status) status.textContent = result.reason ?? "Операция не применена.";
      return;
    }
    form.hidden = true;
    if (status) {
      status.textContent = result.persistence?.ok === false
        ? "Применено в памяти, но сохранение не удалось. Повторите сохранение; действие повторно применять не нужно."
        : "Применено. Физические броски и результат цели отмечаются вручную.";
    }
  });
  root.dataset.racialControlsBound = "true";
}

export function renderTechniquesPanel(character) {
  const panel = document.getElementById("techniquesPanel");
  if (!panel) return;
  if (character.profile?.id !== "sara-velaris") {
    panel.replaceChildren();
    return;
  }
  const derived = getDerivedStats(character);
  const context = getSessionContext();
  const sessionKey = getSessionKey(context);
  const draftState = pendingDrafts.get(sessionKey);
  const draft = draftState?.draft ?? null;
  const draftIsStale = Boolean(draftState && draftState.baseRevision !== context.stateRevision);
  const view = getTechniqueView(character, sessionKey);
  const query = view.searchQuery;
  const sourceFilter = view.source;
  const typeFilter = view.type;
  const entries = MONK_TECHNIQUES;
  const entitlements = (character.monk?.replacementEntitlements ?? [])
    .filter((event) => !event.consumed);
  const entitlementId = view.entitlementEventId;
  const entitlement = entitlements.find((event) => event.id === entitlementId) ?? entitlements[0] ?? null;
  const continuation = character.monk?.techniqueRuntime?.deflectContinuation;
  const thirdEye = character.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"] ?? {};
  panel.innerHTML = `
    <h2>Техники монаха</h2>
    <p>Каталог ${MONK_TECHNIQUES.length} техник: основной каталог ${MONK_TECHNIQUES.filter((entry) => entry.sourceId === "laserllama-core").length}, дополнение ${MONK_TECHNIQUES.filter((entry) => entry.sourceId === "laserllama-expanded").length}. Техники старших уровней доступны для чтения, но не применения.</p>
    <details class="technique-card__status"><summary>Оригинал и источник</summary><p>Зафиксированная версия: ${escapeHtml(MONK_RULESET_PROVENANCE.rulesetId)}; авторская пометка последнего найденного анонса — ${escapeHtml(MONK_RULESET_PROVENANCE.latestAuthorAnnouncement)}, версия страницы отдельно не подтверждена.</p><p><a href="${MONK_RULESET_PROVENANCE.sources.core}" target="_blank" rel="noopener noreferrer">Основной каталог</a> · <a href="${MONK_RULESET_PROVENANCE.sources.expanded}" target="_blank" rel="noopener noreferrer">Дополнение</a>.</p></details>
    <div class="technique-controls">
      <label class="field-label">Поиск<input class="input" type="search" data-technique-view="searchQuery" value="${escapeHtml(query)}"></label>
      <label class="field-label">Выбор<select class="input" data-technique-view="filter">
        <option value="all" ${view.filter === "all" ? "selected" : ""}>Все</option>
        <option value="selected" ${view.filter === "selected" ? "selected" : ""}>Выбраны</option>
        <option value="available" ${view.filter === "available" ? "selected" : ""}>Доступны</option>
      </select></label>
      <label class="field-label">Источник<select class="input" data-technique-view="source">
        <option value="all" ${sourceFilter === "all" ? "selected" : ""}>Все источники</option>
        <option value="core" ${sourceFilter === "core" ? "selected" : ""}>Основной каталог</option>
        <option value="expanded" ${sourceFilter === "expanded" ? "selected" : ""}>Дополнение</option>
      </select></label>
      <label class="field-label">Тип<select class="input" data-technique-view="type">
        <option value="all" ${typeFilter === "all" ? "selected" : ""}>Все типы</option>
        <option value="active" ${typeFilter === "active" ? "selected" : ""}>Активные</option>
        <option value="passive" ${typeFilter === "passive" ? "selected" : ""}>Пассивные способности</option>
        <option value="choice" ${typeFilter === "choice" ? "selected" : ""}>Выбор</option>
      </select></label>
    </div>
    <div class="section-heading-row">
      <h3>Выбор техник · ${character.monk.ordinaryTechniqueIds.length}/${character.monk.ordinaryTechniqueIds.length + Math.max(0, derivedTechniqueLimit(character) - character.monk.ordinaryTechniqueIds.length)} обычных</h3>
      ${entitlements.length && !draft ? `<label class="field-label">Основание<select class="input" data-technique-view="entitlementEventId">
        ${entitlements.map((event) => `<option value="${escapeHtml(event.id)}" ${event.id === entitlement?.id ? "selected" : ""}>${escapeHtml(event.type === "rest" ? "Долгий отдых" : `Уровень ${event.level}`)}</option>`).join("")}
      </select></label>` : ""}
      ${draft ? `<button type="button" class="btn" data-technique-commit>Подтвердить замену</button>
        <button type="button" class="btn btn--utility" data-technique-cancel>Отменить черновик</button>` :
        `<button type="button" class="btn" data-technique-edit ${entitlement ? "" : "disabled"}>${entitlement ? "Редактировать черновик" : "Нет права на замену"}</button>`}
    </div>
    ${draft ? `<p class="technique-card__status">Черновик не применяется в бою до подтверждения. Основание: ${escapeHtml(entitlement?.type ?? "событие")}.</p>` : ""}
    ${draftState && draftState.baseRevision !== context.stateRevision ? `<p class="technique-card__status" role="alert">Персонаж изменился. Черновик сохранён, но требует повторной проверки.
      <button type="button" class="btn btn--utility" data-technique-rebuild>Пересобрать черновик</button>
      <button type="button" class="btn btn--utility" data-technique-cancel>Отменить черновик</button></p>` : ""}
    ${draft ? `<div class="technique-controls technique-signatures">${renderSignatureSelects(character, draft)}</div>` : ""}
    ${draft ? `<div class="technique-controls">${renderTechniqueChoices(character, draft)}</div>` : ""}
    ${continuation?.kind === "missile-return" ? `<section class="panel-section">
      <h3>Возврат пойманного снаряда · та же реакция</h3>
      <p>Потратьте 1 Ki. Дальность 20/60; возврат доступен только для оружейного режима и при владении этим оружием.</p>
      <label class="field-label">Бросок d20<input class="input" type="number" min="1" max="20" step="1" data-missile-attack-roll></label>
      <label class="field-label">КД цели (необязательно)<input class="input" type="number" min="1" max="99" step="1" data-missile-target-ac></label>
      <label class="field-label">Результат мастера, если КД неизвестна<select class="input" data-missile-dm-hit>
        <option value="">Не указано</option><option value="hit">Попадание</option><option value="miss">Промах</option>
      </select></label>
      <p>При попадании укажите физический результат кости урона${derived.monk.martialDieSides} (две кости при критическом попадании); при промахе оставьте поля пустыми.</p>
      ${numberField("returnedDamage1", "Физический результат первой кости урона", {
        min: 1, max: derived.monk.martialDieSides, required: false
      })}
      ${numberField("returnedDamage2", "Физический результат второй кости при критическом попадании", {
        min: 1, max: derived.monk.martialDieSides, required: false
      })}
      <label class="sara-form-check"><input type="checkbox" data-missile-proficiency-confirm required>
        Подтверждаю простое оружие и владение им</label>
      <button type="button" class="btn btn--utility" data-missile-return="${escapeHtml(continuation.id)}">Совершить возвратную атаку</button>
    </section>` : ""}
    ${thirdEye.awakenThirdEyePending ? `<section class="panel-section">
      <p>Требуется вручную подтвердить завершение минутной медитации. 8 Ki уже потрачены; прерывание не возмещает их.</p>
      <label class="sara-form-check"><input type="checkbox" data-awaken-complete-confirm>
        Подтверждаю завершение медитации</label>
      <button type="button" class="btn" data-awaken-complete>Подтвердить завершение медитации</button>
    </section>` : ""}
    ${thirdEye.awakenThirdEyeActive ? `<section class="panel-section">
      <p>Foresight действует до 8 часов. Текущий максимум ци уменьшен на 8; эффекты отмечаются вручную.</p>
      <label class="sara-form-check"><input type="checkbox" data-awaken-end-confirm>
        Подтверждаю завершение эффекта; потраченная ци не возвращается</label>
      <button type="button" class="btn btn--utility" data-awaken-end>Завершить эффект вручную</button>
    </section>` : ""}
    <div class="technique-list">${entries.map((entry) => renderTechniqueCard(entry, character, draft)).join("")}</div>
    <p class="technique-card__status" data-technique-editor-status role="status"></p>
    <section class="panel-section"><h3>Воинский адепт — стили</h3>
      <div class="technique-list">${WARRIOR_ADEPT_STYLES.map((style) => `<article class="technique-card"><h4>${escapeHtml(subchoiceLabel(style.id))}</h4><p>${escapeHtml(style.prerequisites.join("; ") || "без предварительных требований")}</p><p>${escapeHtml(style.text)}</p><details><summary>Оригинал и источник</summary><p>${escapeHtml(style.name)} · Alternate Monk</p></details></article>`).join("")}</div>
    </section>
    <p class="technique-card__status">Сияние божества: доступные заговоры — ${CLERIC_CANTRIPS.map((spell) => escapeHtml(spell.name)).join(", ")}.</p>
  `;
  filterTechniqueCards(panel, view);
  if (draftIsStale) {
    panel.querySelectorAll("[data-technique-draft], [data-signature-slot], [data-technique-choice], [data-technique-commit]")
      .forEach((control) => { control.disabled = true; });
  }
  if (!panel.dataset.viewBound) {
    panel.addEventListener("input", (event) => {
      const field = event.target.closest("[data-technique-view='searchQuery']");
      if (!field || event.isComposing || event.target.isComposing) return;
      const currentContext = getSessionContext();
      const currentView = getTechniqueView(getState(), getSessionKey(currentContext));
      currentView.searchQuery = field.value;
      filterTechniqueCards(panel, currentView);
    });
    panel.addEventListener("compositionend", (event) => {
      const field = event.target.closest("[data-technique-view='searchQuery']");
      if (!field) return;
      const currentView = getTechniqueView(getState(), getSessionKey(getSessionContext()));
      currentView.searchQuery = field.value;
      filterTechniqueCards(panel, currentView);
    });
    panel.addEventListener("change", (event) => {
      const field = event.target.closest("select[data-technique-view]");
      if (!field) return;
      const currentContext = getSessionContext();
      const currentView = getTechniqueView(getState(), getSessionKey(currentContext));
      currentView[field.dataset.techniqueView] = field.value;
      renderTechniquesPanel(getState());
    });
    panel.dataset.viewBound = "true";
  }
  if (!panel.dataset.editorBound) {
    panel.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target || !panel.contains(target) || !target.isConnected ||
          document.querySelector(".page")?.dataset.screen !== "sheet" ||
          target.closest("[hidden]")) return;
      const currentContext = getSessionContext();
      const currentState = getState();
      const key = getSessionKey(currentContext);
      const status = panel.querySelector("[data-technique-editor-status]");
      if (target.matches("[data-technique-edit]")) {
        const available = (currentState.monk?.replacementEntitlements ?? []).filter((item) => !item.consumed);
        const currentView = getTechniqueView(currentState, key);
        const currentEntitlement = available.find((item) => item.id === currentView.entitlementEventId) ?? available[0];
        if (!currentEntitlement) return;
        pendingDrafts.set(key, {
          baseRevision: currentContext.stateRevision,
          draft: createTechniqueDraft(currentState, currentContext, currentEntitlement)
        });
        renderTechniquesPanel(currentState);
        return;
      }
      if (target.matches("[data-technique-cancel]")) {
        pendingDrafts.delete(key);
        renderTechniquesPanel(currentState);
        return;
      }
      if (target.matches("[data-technique-rebuild]")) {
        const available = (currentState.monk?.replacementEntitlements ?? [])
          .filter((item) => !item.consumed);
        const selectedEntitlement = available.find((item) =>
          item.id === pendingDrafts.get(key)?.draft?.entitlementEventId);
        const entitlement = selectedEntitlement ?? available[0];
        if (!entitlement) {
          if (status) status.textContent = "Право на замену больше недоступно; черновик сохранён. Отмените его или выберите другое доступное право.";
          return;
        }
        pendingDrafts.set(key, {
          baseRevision: currentContext.stateRevision,
          draft: createTechniqueDraft(currentState, currentContext, entitlement)
        });
        renderTechniquesPanel(currentState);
        return;
      }
      if (target.matches("[data-technique-form-cancel]")) {
        const form = target.closest("[data-technique-form]");
        if (form) form.hidden = true;
        panel.querySelector(`[data-technique-use="${CSS.escape(form?.dataset.techniqueForm ?? "")}"]`)?.focus();
        return;
      }
      if (target.matches("[data-technique-use]")) {
        const techniqueId = target.dataset.techniqueUse;
        const form = panel.querySelector(`[data-technique-form="${CSS.escape(techniqueId)}"]`);
        if (form) {
          form.hidden = false;
          form.querySelector("input, select, button")?.focus();
        }
        return;
      }
      if (target.matches("[data-awaken-complete]")) {
        if (!panel.querySelector("[data-awaken-complete-confirm]")?.checked) {
          if (status) status.textContent = "Подтвердите завершение медитации.";
          return;
        }
        const result = completeAwakenThirdEyeMeditation(
          currentContext,
          globalThis.crypto?.randomUUID?.() ?? `third-eye-complete-${Date.now()}`
        );
        if (result.status !== "applied" && status) status.textContent = result.reason;
        else if (result.status === "applied" && !result.persistence.ok && status) {
          status.textContent = "Медитация завершена в памяти, но сохранение не удалось.";
        }
      }
      if (target.matches("[data-awaken-end]")) {
        if (!panel.querySelector("[data-awaken-end-confirm]")?.checked) {
          if (status) status.textContent = "Подтвердите завершение эффекта третьего глаза.";
          return;
        }
        const result = endAwakenThirdEye(
          currentContext,
          globalThis.crypto?.randomUUID?.() ?? `third-eye-end-${Date.now()}`
        );
        if (result.status !== "applied" && status) status.textContent = result.reason;
        else if (result.status === "applied" && !result.persistence.ok && status) {
          status.textContent = "Эффект завершён в памяти, но сохранение не удалось.";
        }
      }
      if (target.matches("[data-technique-commit]")) {
        const pending = pendingDrafts.get(key);
        if (!pending) return;
        if (pending.baseRevision !== currentContext.stateRevision) {
          if (status) status.textContent =
            "Персонаж изменился. Черновик сохранён, но требует повторной проверки.";
          return;
        }
        const result = applyTechniqueDraft(currentState, pending.draft, currentContext);
        if (result.status !== "applied") {
          if (status) status.textContent = result.reasons.join(" ");
          return;
        }
        const applied = updateSessionState(currentContext, () => result.state, {
          operationId: `technique-draft:${pending.draft.entitlementEventId}`
        });
        if (applied.status !== "applied") {
          if (status) status.textContent = applied.reason;
          return;
        }
        pendingDrafts.delete(key);
        if (!applied.persistence.ok && status) status.textContent = "Выбор применён в памяти, но не сохранён. Повторите сохранение.";
      }
      if (target.matches("[data-missile-return]")) {
        const attackRollInput = panel.querySelector("[data-missile-attack-roll]");
        const armorClassInput = panel.querySelector("[data-missile-target-ac]");
        const dmHitInput = panel.querySelector("[data-missile-dm-hit]");
        const proficiencyConfirmation = panel.querySelector("[data-missile-proficiency-confirm]");
        if (!proficiencyConfirmation?.checked) {
          if (status) status.textContent = "Подтвердите владение простым оружием.";
          return;
        }
        if (!attackRollInput?.value) {
          if (status) status.textContent = "Введите физический результат d20.";
          return;
        }
        const damageRolls = [...panel.querySelectorAll("input[name^='returnedDamage']")]
          .map((input) => input.value).filter((value) => value !== "");
        const result = continueDeflectMissile(
          currentContext,
          target.dataset.missileReturn,
          attackRollInput.value,
          armorClassInput?.value || null,
          {
            proficiencyConfirmed: true,
            dmHitResult: dmHitInput?.value || null,
            damageRolls
          }
        );
        if (result.status !== "applied") {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent = result.reason;
        } else {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent =
            `${result.outcome.total} против КД ${armorClassInput?.value || "решения мастера"}: ${result.outcome.hits ? "попадание" : "промах"}${
              result.outcome.damageTotalBeforeTargetModifiers == null
                ? "" : `, урон ${result.outcome.damageTotalBeforeTargetModifiers} до поправок цели`
            }. Затрачено 1 Ki; реакция повторно не используется.`;
        }
      }
    });
    panel.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-technique-form]");
      if (!form || !panel.contains(form)) return;
      event.preventDefault();
      const techniqueId = form.dataset.techniqueForm;
      const values = new FormData(form);
      const input = {
        operationId: globalThis.crypto?.randomUUID?.() ??
          `technique-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        confirmed: values.has("confirmed"),
        mode: values.get("mode") || undefined,
        incomingDamage: values.get("incomingDamage"),
        deflectRoll: values.get("deflectRoll"),
        finalAdjustedDamage: values.get("finalAdjustedDamage"),
        applyDamageToSara: values.get("applyDamageToSara") === "true",
        freeHand: values.has("freeHand"),
        physicalProjectile: values.has("physicalProjectile"),
        caught: values.has("caught"),
        dieResult: values.get("dieResult"),
        confirmNoHealing: values.has("confirmNoHealing"),
        otherModifiers: values.get("otherModifiers"),
        extraKi: values.get("extraKi"),
        targetCurrentHp: values.get("targetCurrentHp"),
        kiCost: values.get("kiCost"),
        transferredKi: values.get("transferredKi"),
        expectedConcentration: values.get("expectedConcentration"),
        replaceConcentration: values.has("replaceConcentration"),
        stopOnSurface: values.has("stopOnSurface"),
        paymentMode: values.get("paymentMode") || "ki"
      };
      if (input.paymentMode === "practiced") {
        input.ownTurnConfirmed = values.has("practicedConditions");
        input.unarmedHitConfirmed = values.has("practicedConditions");
      }
      const button = form.querySelector("[type='submit']");
      if (button?.dataset.processing === "true") return;
      if (button) {
        button.dataset.processing = "true";
        button.disabled = true;
      }
      const context = getSessionContext();
      const status = form.querySelector("[data-form-error]");
      const result = techniqueId === "ll-monk:mystic-regeneration"
        ? commitRegeneration(context, input.dieResult, input.operationId, {
            confirmNoHealing: input.confirmNoHealing
          })
        : techniqueId === "ll-monk:deflect-strike" || techniqueId === "ll-monk:deflect-missile"
          ? commitDeflection(context, {
              ...input,
              kind: techniqueId === "ll-monk:deflect-missile" ? "missile" : "melee"
            }, input.operationId)
          : MONK_TECHNIQUE_BY_ID.get(techniqueId)?.eligibleStrike
            ? { status: "rejected", reason: "Сначала запишите подтверждённое попадание в боевой последовательности; Strike нельзя оплачивать из предварительного просмотра каталога." }
            : executeMonkTechnique(context, techniqueId, input);
      if (button) {
        button.dataset.processing = "false";
        button.disabled = false;
      }
      if (result.status !== "applied") {
        if (status) status.textContent = result.reason ?? "Техника не применена.";
        return;
      }
      form.hidden = true;
      const summary = result.outcome?.outcome ?? result.outcome?.result ?? result.outcome ?? {};
      if (status) {
        status.textContent = result.persistence?.ok === false
          ? "Применено в памяти, но сохранение не удалось. Повторите сохранение; действие повторно применять не нужно."
          : `Применено. ${summary.remainingDamage != null ? `Остаток урона: ${summary.remainingDamage}.` : ""}`;
      }
    });
    panel.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) ||
          !target.isConnected || document.querySelector(".page")?.dataset.screen !== "sheet" ||
          target.closest("[hidden]")) return;
      const context = getSessionContext();
      const pending = pendingDrafts.get(getSessionKey(context));
      if (!pending || pending.baseRevision !== context.stateRevision) return;
      if (target.matches("[data-technique-draft]")) {
        const id = target.dataset.techniqueDraft;
        const values = pending.draft.ordinaryTechniqueIds;
        pending.draft.ordinaryTechniqueIds = target.checked
          ? [...values, id]
          : values.filter((value) => value !== id);
      } else if (target.matches("[data-signature-slot]")) {
        pending.draft.signatureTechniqueSlots[target.dataset.signatureSlot] = target.value;
      } else if (target.matches("[data-technique-choice]")) {
        const [choiceId, index] = target.dataset.techniqueChoice.split(":");
        pending.draft.techniqueChoices[`ll-monk:${choiceId}`] ??= {};
        if (choiceId === "divine-light") {
          const choices = [...(pending.draft.techniqueChoices["ll-monk:divine-light"].clericCantripIds ?? [])];
          choices[Number(index)] = target.value;
          pending.draft.techniqueChoices["ll-monk:divine-light"].clericCantripIds = choices;
        } else if (choiceId === "warrior-adept") {
          pending.draft.techniqueChoices["ll-monk:warrior-adept"].styleId = target.value;
        }
      }
    });
    panel.dataset.editorBound = "true";
  }
}

function derivedTechniqueLimit(character) {
  const level = Number(character.profile?.level ?? 1);
  return level === 1 ? 0 : level <= 4 ? 3 : level <= 6 ? 4 :
    level <= 8 ? 5 : level <= 10 ? 6 : level <= 12 ? 7 : level <= 14 ? 8 :
      level <= 17 ? 9 : 10;
}

export function clearTechniqueDrafts(characterId) {
  for (const key of pendingDrafts.keys()) {
    if (key.startsWith(`${characterId}:`)) pendingDrafts.delete(key);
  }
  for (const key of techniqueViews.keys()) {
    if (key.startsWith(`${characterId}:`)) techniqueViews.delete(key);
  }
}

export function hasChangedTechniqueDraft(context) {
  const pending = pendingDrafts.get(getSessionKey(context));
  if (!pending) return false;
  const draft = pending.draft;
  return JSON.stringify(draft.ordinaryTechniqueIds) !== JSON.stringify(draft.baseOrdinaryTechniqueIds) ||
    JSON.stringify(draft.signatureTechniqueSlots) !== JSON.stringify(draft.baseSignatureTechniqueSlots) ||
    JSON.stringify(draft.techniqueChoices) !== JSON.stringify(draft.baseTechniqueChoices);
}
