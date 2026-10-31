import {
  MONK_TECHNIQUES,
  MONK_TECHNIQUE_BY_ID,
  WARRIOR_ADEPT_STYLES,
  CLERIC_CANTRIPS,
  MONK_RULESET_PROVENANCE
} from "../../data/monk-techniques.js";
import { getTechniqueAvailability } from "../selectors/techniques.js";
import { applyTechniqueDraft, createTechniqueDraft } from "../technique-editor.js";
import {
  getSessionContext,
  getState,
  updateSessionState
} from "../state.js";
import {
  completeAwakenThirdEyeMeditation,
  endAwakenThirdEye,
  executeMonkTechnique
} from "../actions/monk.js";
import { getDerivedStats } from "../calculations.js";
import {
  activationLabel,
  paymentLabel,
  sourceLabel,
  subchoiceLabel,
  techniqueTitle
} from "../presentation/ru.js";
import { isTechniqueEffectivelySelected } from "../selectors/techniques.js";

const pendingDrafts = new Map();
const techniqueViews = new Map();
const BATTLE_WORKSPACE_TECHNIQUES = new Set([
  "ll-monk:step-of-the-wind",
  "ll-monk:patient-defense",
  "ll-monk:mystic-regeneration",
  "ll-monk:deflect-strike",
  "ll-monk:deflect-missile",
]);

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
  const isStrikeFollowUp = Boolean(entry.eligibleStrike);
  const useControl = !isStrikeFollowUp && !BATTLE_WORKSPACE_TECHNIQUES.has(entry.id) &&
    isEffective && availability.available &&
    (entry.category !== "passive" || entry.id === "ll-monk:heavenly-step") && !draft
    ? `<button type="button" class="btn btn--utility" data-technique-use="${escapeHtml(entry.id)}">Применить</button>`
    : "";
  const workspaceHint = isStrikeFollowUp
    ? `<p class="technique-card__status">Доступна как продолжение после подходящего попадания в боевом пульте.</p>`
    : BATTLE_WORKSPACE_TECHNIQUES.has(entry.id)
      ? `<p class="technique-card__status">Боевой сценарий доступен через категории боевого пульта.</p>` : "";
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
      ${workspaceHint}
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
      const result = executeMonkTechnique(context, techniqueId, input);
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
