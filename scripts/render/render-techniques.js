import {
  MONK_TECHNIQUES,
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

const pendingDrafts = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getSessionKey(context) {
  return `${context.characterId}:${context.sessionGeneration}`;
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
  const ordinaryChecked = draft?.ordinaryTechniqueIds.includes(entry.id) ?? isSelected;
  const disabled = !availability.available && !isSelected;
  const source = entry.sourceId === "laserllama-core" ? "Core" : "Expanded";
  const editControl = draft
    ? `<label><input type="checkbox" data-technique-draft="${escapeHtml(entry.id)}" ${ordinaryChecked ? "checked" : ""} ${disabled ? "disabled" : ""}> Обычный выбор</label>`
    : `<span class="technique-card__status">${isSelected ? "Выбрана" : availability.available ? "Доступна" : escapeHtml(availability.reason)}</span>`;
  const useControl = isSelected && availability.available &&
    (entry.category !== "passive" || entry.id === "ll-monk:heavenly-step") && !draft
    ? `<button type="button" class="btn btn--utility" data-technique-use="${escapeHtml(entry.id)}">Применить вручную</button>`
    : "";
  return `
    <article class="technique-card" data-available="${availability.available}">
      <h3>${escapeHtml(entry.nameRu)} <span>(${escapeHtml(entry.nameEn)})</span></h3>
      <p class="technique-card__meta">${source} · уровень ${entry.minimumMonkLevel} · ${escapeHtml(entry.activation)} · ${escapeHtml(entry.payment)}</p>
      <p class="technique-card__description">${escapeHtml(entry.description)}</p>
      ${editControl}
      ${useControl}
    </article>
  `;
}

function renderSignatureSelects(character, draft) {
  const level = Number(character.profile?.level ?? 1);
  return [3, 5, 9].filter((slotLevel) => level >= slotLevel).map((slotLevel) => {
    const slot = `open-hand:${slotLevel}`;
    const currentId = draft?.signatureTechniqueSlots[slot] ?? character.monk.signatureTechniqueSlots[slot] ?? "";
    const choices = MONK_TECHNIQUES.filter((entry) =>
      (entry.eligibleStrike || entry.id === currentId) && entry.minimumMonkLevel <= level);
    return `<label class="field-label">${slot}<select class="input" data-signature-slot="${slot}" ${draft ? "" : "disabled"}>
      ${choices.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === currentId ? "selected" : ""}>${escapeHtml(entry.nameRu)}</option>`).join("")}
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
        <legend>Divine Light — выберите два разных заговора</legend>
        ${[0, 1].map((index) => `<label class="field-label">Заговор ${index + 1}
          <select class="input" data-technique-choice="divine-light:${index}">
            <option value="">Выберите</option>
            ${CLERIC_CANTRIPS.map((spell) => `<option value="${escapeHtml(spell.id)}" ${selected[index] === spell.id ? "selected" : ""}>${escapeHtml(spell.name)}</option>`).join("")}
          </select>
        </label>`).join("")}
      </fieldset>`;
    }
    if (id === "ll-monk:warrior-adept") {
      return `<label class="field-label technique-choice">Warrior Adept — выберите один стиль
        <select class="input" data-technique-choice="warrior-adept">
          <option value="">Выберите стиль</option>
          ${WARRIOR_ADEPT_STYLES.map((style) => `<option value="${escapeHtml(style.id)}" ${choice.styleId === style.id ? "selected" : ""}>${escapeHtml(style.name)}</option>`).join("")}
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
  const racial = MONK_RACIAL_SPELLS.map((spell) => {
    const savedSpell = state.spellcasting?.racialSpells?.find((entry) =>
      entry.id === spell.id && entry.source === spell.source && entry.mode === spell.mode);
    const uses = savedSpell?.uses;
    return `
    <article class="technique-card">
      <h3>${escapeHtml(spell.name)}</h3>
      <p class="technique-card__meta">${escapeHtml(spell.mode)} · ${escapeHtml(spell.action)} · ${escapeHtml(spell.range)}</p>
      <p class="technique-card__description">${escapeHtml(spell.description)}</p>
      <p>${escapeHtml(spell.damage ?? spell.duration ?? "Без лимита применений")}</p>
      ${uses ? `<p>Осталось: ${escapeHtml(uses.current)} / ${escapeHtml(uses.max)}</p>` : ""}
      <button type="button" class="btn btn--utility" data-racial-spell-use="${escapeHtml(spell.id)}"
        ${uses && Number(uses.current) < 1 ? "disabled" : ""}>Подтвердить применение</button>
    </article>`;
  }).join("");
  return `
    <section class="panel-section">
      <h2 class="section-title">Монах Открытой ладони</h2>
      <p>Кость Martial Arts: ${escapeHtml(derived.monk.martialDie)} · СЛ техник: ${derived.monk.techniqueSaveDc} · безоружная атака ${derived.unarmedAttackBonus >= 0 ? "+" : ""}${derived.unarmedAttackBonus}, ${escapeHtml(derived.unarmedDamage)}.</p>
      <label class="field-label"><span>Текущее ци</span><input class="input" type="number" min="0" max="${ki}" step="1" data-bind="combat.ki.current" value="${escapeHtml(currentKi)}"></label>
      <label class="field-label"><span>Practiced</span><input class="input" type="number" min="0" max="${derived.monk.practicedMaximum}" step="1" data-bind="combat.practiced.current" value="${escapeHtml(state.combat.practiced.current)}"></label>
      <label class="field-label"><span>Оставшиеся Hit Dice d10</span><input class="input" type="number" min="0" max="${derived.level}" step="1" data-bind="combat.hitDice.remaining" value="${escapeHtml(state.combat.hitDice?.remaining ?? derived.level)}"></label>
      <p class="sara-ki-note">Warrior’s Spirit: восстановите 1 ци вручную в начале своего хода в бою, если не Incapacitated, не выше максимума. Автоматического начисления нет.</p>
      <div class="technique-controls">
        <button type="button" class="btn btn--utility" data-sara-action="bonus-unarmed">Отметить бонусный безоружный удар</button>
        <button type="button" class="btn btn--utility" data-sara-action="flurry">Flurry of Blows · 1 Ki</button>
        ${derived.level >= 6 ? `<button type="button" class="btn btn--utility" data-sara-action="ebb-and-flow">Ebb & Flow · реакция на melee-промах</button>` : ""}
      </div>
      <p>Бонусный безоружный удар требует подтверждения условия Martial Arts. Flurry даёт ${derived.level >= 17 ? 3 : 2} безоружных удара и не требует действия Attack. Приложение не определяет попадания.</p>
      <h3>Расовая магия Yuan-ti (MotM; тексты 2014)</h3>
      <div class="technique-list">${racial}</div>
      ${divineLight.length ? `<h3>Заговоры Divine Light</h3><div class="technique-list">${divineLight.map((cantrip) => `
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
      const context = getSessionContext();
      const actionId = combatActionTarget.dataset.saraAction;
      const confirmed = window.confirm(actionId === "ebb-and-flow"
        ? "Подтвердите, что видимая melee-атака промахнулась."
        : actionId === "bonus-unarmed"
          ? "Подтвердите допустимое условие Martial Arts для бонусного безоружного удара."
          : "Подтвердите применение Flurry of Blows за 1 Ki.");
      if (!confirmed) return;
      const input = { confirmed: true };
      if (actionId === "ebb-and-flow") {
        input.mode = window.prompt("Выберите ответ: unarmed или dexterity-save.") ?? "";
      }
      combatActionTarget.dataset.processing = "true";
      combatActionTarget.disabled = true;
      const result = applySaraCombatAction(context, actionId, input);
      if (combatActionTarget.isConnected) {
        combatActionTarget.dataset.processing = "false";
        combatActionTarget.disabled = false;
      }
      const status = root.querySelector("[data-sara-combat-status]");
      if (result.status !== "applied") {
        if (status) status.textContent = result.reason;
      } else if (!result.persistence.ok && status) {
        status.textContent = "Действие применено в памяти, но сохранение не удалось. Повторите сохранение.";
      }
      return;
    }
    const target = event.target.closest("[data-racial-spell-use]");
    if (!target || !root.contains(target) || !target.isConnected ||
        document.querySelector(".page")?.dataset.screen !== "sheet" ||
        target.closest("[hidden]") || target.dataset.processing === "true") return;
    const spell = MONK_RACIAL_SPELLS.find((entry) => entry.id === target.dataset.racialSpellUse);
    if (!spell) return;
    const context = getSessionContext();
    const character = getState();
    if (character.profile?.id !== "sara-velaris") return;
    const currentConcentration = String(character.combat?.concentration ?? "");
    const replaceConcentration = Boolean(spell.concentration && currentConcentration);
    target.dataset.processing = "true";
    target.disabled = true;
    try {
      if (replaceConcentration &&
          !window.confirm(`Заменить текущую концентрацию «${currentConcentration}» на ${spell.name}?`)) return;
      if (!window.confirm(`Подтвердите условия применения ${spell.name}. Цели и спасброски приложение не определяет.`)) return;
      const result = castSaraRacialSpell(context, spell.id, {
        confirmed: true,
        replaceConcentration,
        expectedConcentration: currentConcentration
      });
      const status = root.querySelector("[data-sara-combat-status]");
      if (result.status !== "applied") {
        if (status) status.textContent = result.reason;
      } else if (!result.persistence.ok && status) {
        status.textContent = "Заклинание применено в памяти, но сохранение не удалось. Повторите сохранение.";
      }
    } finally {
      if (target.isConnected) {
        target.dataset.processing = "false";
        target.disabled = false;
      }
    }
    if (techniqueId === "ll-monk:gentling-touch") {
      input.extraKi = promptNumber("Сколько дополнительных Ki добавить к базовой стоимости 1 (от 0 до модификатора Мудрости)?");
      if (input.extraKi == null) {
        releaseTarget();
        return;
      }
      input.targetCurrentHp = promptNumber("Введите текущие HP цели для ручного сравнения с порогом.");
      if (input.targetCurrentHp == null) {
        releaseTarget();
        return;
      }
    }
    if (["ll-monk:gale-rush", "ll-monk:tremor-strike"].includes(techniqueId)) {
      input.kiCost = promptNumber("Сколько Ki потратить (от 1 до модификатора Мудрости)?");
      if (input.kiCost == null) {
        releaseTarget();
        return;
      }
    }
    if (techniqueId === "ll-monk:empty-body") {
      input.mode = window.prompt("Выберите режим: invisibility (4 Ki) или astral-projection (8 Ki).") ?? "";
    }
    if (techniqueId === "ll-monk:conjure-previous-life") {
      input.transferredKi = promptNumber("Сколько дополнительных текущих Ki передать призванному? Минимум 0, базовая стоимость 5 Ki.");
      if (input.transferredKi == null) {
        releaseTarget();
        return;
      }
      const currentConcentration = String(getState().combat?.concentration ?? "");
      input.expectedConcentration = currentConcentration;
      input.replaceConcentration = !currentConcentration ||
        window.confirm(`Заменить текущую концентрацию «${currentConcentration}» призывом?`);
      if (!input.replaceConcentration) {
        releaseTarget();
        return;
      }
    }
    if (techniqueId === "ll-monk:awaken-the-third-eye" &&
        !window.confirm("Подтвердите начало 1-минутной медитации. 8 Ki будут потрачены сейчас; завершение надо будет подтвердить отдельно, возмещения при прерывании нет.")) {
      releaseTarget();
      return;
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
  const context = getSessionContext();
  const sessionKey = getSessionKey(context);
  const draftState = pendingDrafts.get(sessionKey);
  const draft = draftState?.baseRevision === context.stateRevision ? draftState.draft : null;
  const ui = character.ui?.techniques ?? {};
  const query = ui.searchQuery ?? "";
  const sourceFilter = ui.source ?? "all";
  const typeFilter = ui.type ?? "all";
  const chosen = selectedIds(character);
  const entries = MONK_TECHNIQUES.filter((entry) => {
    const availability = getTechniqueAvailability(character, entry);
    const queryMatch = !query || [entry.nameEn, entry.nameRu, entry.description]
      .some((value) => value.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")));
    const selectedMatch = ui.filter !== "selected" || chosen.has(entry.id);
    const availableMatch = ui.filter !== "available" || (!chosen.has(entry.id) && availability.available);
    return queryMatch && selectedMatch && availableMatch &&
      (sourceFilter === "all" || entry.sourceId === `laserllama-${sourceFilter}`) &&
      (typeFilter === "all" || entry.category === typeFilter);
  });
  const entitlements = (character.monk?.replacementEntitlements ?? [])
    .filter((event) => !event.consumed);
  const entitlementId = ui.entitlementEventId;
  const entitlement = entitlements.find((event) => event.id === entitlementId) ?? entitlements[0] ?? null;
  const continuation = character.monk?.techniqueRuntime?.deflectContinuation;
  const thirdEye = character.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"] ?? {};
  panel.innerHTML = `
    <h2>Техники монаха</h2>
    <p>Каталог ${MONK_TECHNIQUES.length} техник: Core ${MONK_TECHNIQUES.filter((entry) => entry.sourceId === "laserllama-core").length}, Expanded ${MONK_TECHNIQUES.filter((entry) => entry.sourceId === "laserllama-expanded").length}. Техники старших уровней доступны для чтения, но не применения.</p>
    <p class="technique-card__status">Зафиксированный ruleset ${escapeHtml(MONK_RULESET_PROVENANCE.rulesetId)}; авторская пометка последнего найденного анонса — ${escapeHtml(MONK_RULESET_PROVENANCE.latestAuthorAnnouncement)}, версия страницы отдельно не подтверждена. Источники: <a href="${MONK_RULESET_PROVENANCE.sources.core}" target="_blank" rel="noopener noreferrer">Core</a> · <a href="${MONK_RULESET_PROVENANCE.sources.expanded}" target="_blank" rel="noopener noreferrer">Expanded</a>.</p>
    <div class="technique-controls">
      <label class="field-label">Поиск<input class="input" type="search" data-bind="ui.techniques.searchQuery" value="${escapeHtml(query)}"></label>
      <label class="field-label">Выбор<select class="input" data-bind="ui.techniques.filter">
        <option value="all" ${ui.filter === "all" ? "selected" : ""}>Все</option>
        <option value="selected" ${ui.filter === "selected" ? "selected" : ""}>Выбраны</option>
        <option value="available" ${ui.filter === "available" ? "selected" : ""}>Доступны</option>
      </select></label>
      <label class="field-label">Источник<select class="input" data-bind="ui.techniques.source">
        <option value="all" ${sourceFilter === "all" ? "selected" : ""}>Core + Expanded</option>
        <option value="core" ${sourceFilter === "core" ? "selected" : ""}>Core</option>
        <option value="expanded" ${sourceFilter === "expanded" ? "selected" : ""}>Expanded</option>
      </select></label>
      <label class="field-label">Тип<select class="input" data-bind="ui.techniques.type">
        <option value="all" ${typeFilter === "all" ? "selected" : ""}>Все типы</option>
        <option value="active" ${typeFilter === "active" ? "selected" : ""}>Активные</option>
        <option value="passive" ${typeFilter === "passive" ? "selected" : ""}>Пассивные</option>
        <option value="choice" ${typeFilter === "choice" ? "selected" : ""}>Выбор</option>
      </select></label>
    </div>
    <div class="section-heading-row">
      <h3>Выбор техник · ${character.monk.ordinaryTechniqueIds.length}/${character.monk.ordinaryTechniqueIds.length + Math.max(0, derivedTechniqueLimit(character) - character.monk.ordinaryTechniqueIds.length)} обычных</h3>
      ${entitlements.length && !draft ? `<label class="field-label">Основание<select class="input" data-bind="ui.techniques.entitlementEventId">
        ${entitlements.map((event) => `<option value="${escapeHtml(event.id)}" ${event.id === entitlement?.id ? "selected" : ""}>${escapeHtml(event.type === "rest" ? "Долгий отдых" : `Уровень ${event.level}`)}</option>`).join("")}
      </select></label>` : ""}
      ${draft ? `<button type="button" class="btn" data-technique-commit>Подтвердить замену</button>
        <button type="button" class="btn btn--utility" data-technique-cancel>Отменить черновик</button>` :
        `<button type="button" class="btn" data-technique-edit ${entitlement ? "" : "disabled"}>${entitlement ? "Редактировать черновик" : "Нет права на замену"}</button>`}
    </div>
    ${draft ? `<p class="technique-card__status">Черновик не применяется в бою до подтверждения. Основание: ${escapeHtml(entitlement?.type ?? "событие")}.</p>` : ""}
    ${draft ? `<div class="technique-controls technique-signatures">${renderSignatureSelects(character, draft)}</div>` : ""}
    ${draft ? `<div class="technique-controls">${renderTechniqueChoices(character, draft)}</div>` : ""}
    ${continuation?.kind === "missile-return" ? `<section class="panel-section">
      <h3>Возврат пойманного снаряда · та же реакция</h3>
      <p>Потратьте 1 Ki. Дальность 20/60; возврат доступен только для оружейного режима и при владении этим оружием.</p>
      <label class="field-label">Бросок d20<input class="input" type="number" min="1" max="20" step="1" data-missile-attack-roll></label>
      <label class="field-label">КД цели<input class="input" type="number" step="1" data-missile-target-ac></label>
      <button type="button" class="btn btn--utility" data-missile-return="${escapeHtml(continuation.id)}">Совершить возвратную атаку</button>
    </section>` : ""}
    ${thirdEye.awakenThirdEyePending ? `<section class="panel-section">
      <p>Требуется вручную подтвердить завершение минутной медитации. 8 Ki уже потрачены; прерывание не возмещает их.</p>
      <button type="button" class="btn" data-awaken-complete>Подтвердить завершение медитации</button>
    </section>` : ""}
    ${thirdEye.awakenThirdEyeActive ? `<section class="panel-section">
      <p>Foresight действует до 8 часов. Текущий максимум ци уменьшен на 8; эффекты отмечаются вручную.</p>
      <button type="button" class="btn btn--utility" data-awaken-end>Завершить эффект вручную</button>
    </section>` : ""}
    <div class="technique-list">${entries.map((entry) => renderTechniqueCard(entry, character, draft)).join("")}</div>
    <p class="technique-card__status" data-technique-editor-status role="status"></p>
    <section class="panel-section"><h3>Воинский адепт — стили</h3>
      <div class="technique-list">${WARRIOR_ADEPT_STYLES.map((style) => `<article class="technique-card"><h4>${escapeHtml(style.name)}</h4><p>${escapeHtml(style.prerequisites.join("; ") || "без prerequisites")}</p><p>${escapeHtml(style.text)}</p></article>`).join("")}</div>
    </section>
    <p class="technique-card__status">Divine Light: допустимые заговоры — ${CLERIC_CANTRIPS.map((spell) => escapeHtml(spell.name)).join(", ")}.</p>
  `;
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
        const currentEntitlement = available.find((item) => item.id === currentState.ui?.techniques?.entitlementEventId) ?? available[0];
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
      if (target.matches("[data-awaken-complete]")) {
        if (!window.confirm("Подтвердите, что минутная медитация завершена. Эффекты Foresight отмечаются вручную.")) return;
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
        if (!window.confirm("Завершить эффект третьего глаза? Потраченная ци не восстанавливается.")) return;
        const result = endAwakenThirdEye(
          currentContext,
          globalThis.crypto?.randomUUID?.() ?? `third-eye-end-${Date.now()}`
        );
        if (result.status !== "applied" && status) status.textContent = result.reason;
        else if (result.status === "applied" && !result.persistence.ok && status) {
          status.textContent = "Эффект завершён в памяти, но сохранение не удалось.";
        }
      }
      if (target.matches("[data-technique-use]")) {
        if (target.dataset.processing === "true") return;
        target.dataset.processing = "true";
        target.disabled = true;
        const techniqueId = target.dataset.techniqueUse;
        const entry = MONK_TECHNIQUES.find((item) => item.id === techniqueId);
        const releaseTarget = () => {
          if (target.isConnected) {
            target.dataset.processing = "false";
            target.disabled = false;
          }
        };
        if (!entry || !window.confirm(`Подтвердите условия применения «${entry.nameRu}». Попадание/спасбросок и результат цели приложение не определяет.`)) {
          releaseTarget();
          return;
        }
        const input = {
          operationId: globalThis.crypto?.randomUUID?.() ??
            `technique-${Date.now()}-${Math.random().toString(16).slice(2)}`
        };
        if (entry.eligibleStrike &&
            techniqueId !== "ll-monk:crushing-strike" &&
            Number(getState().combat?.practiced?.current) > 0 &&
            window.confirm("Оплатить эту Strike одним применением Practiced вместо обычной стоимости Ki?")) {
          if (!window.confirm("Подтвердите: сейчас ваш ход, и эта техника применяется после подтверждённого безоружного попадания.")) {
            releaseTarget();
            return;
          }
          input.paymentMode = "practiced";
          input.ownTurnConfirmed = true;
          input.unarmedHitConfirmed = true;
        }
        const promptNumber = (message) => {
          const value = window.prompt(message);
          return value == null ? null : Number(value);
        };
        if (techniqueId === "ll-monk:mystic-regeneration") {
          const martialDieSides = getDerivedStats(getState()).monk.martialDieSides;
          input.dieResult = promptNumber(`Введите физический результат кости d${martialDieSides}.`);
          if (input.dieResult == null) {
            releaseTarget();
            return;
          }
          if (getDerivedStats(getState()).currentHitPoints >= getDerivedStats(getState()).maxHitPoints) {
            input.confirmNoHealing = window.confirm("Хиты полные. Применить технику без полезного лечения и потратить ресурс?");
            if (!input.confirmNoHealing) {
              releaseTarget();
              return;
            }
          }
        }
        if (techniqueId === "ll-monk:deflect-strike" || techniqueId === "ll-monk:deflect-missile") {
          input.incomingDamage = promptNumber("Укажите входящий урон (целое число 0 или больше).");
          if (input.incomingDamage == null) {
            releaseTarget();
            return;
          }
          const martialDieSides = getDerivedStats(getState()).monk.martialDieSides;
          input.deflectRoll = promptNumber(`Введите физический результат кости d${martialDieSides}.`);
          if (input.deflectRoll == null) {
            releaseTarget();
            return;
          }
          if (techniqueId === "ll-monk:deflect-strike") {
            input.mode = window.prompt("Тип атаки: weapon-melee или other-melee.") ?? "";
          } else {
            input.mode = window.prompt("Тип атаки: weapon, other-ranged или spell.") ?? "";
            input.caught = window.confirm("Урон снижен до 0, у вас свободна рука, и это физический снаряд, который вы поймали?");
            input.freeHand = input.caught;
            input.physicalProjectile = input.caught;
          }
          input.applyDamageToSara = window.confirm("Применить рассчитанный остаток урона к HP Сары?");
        }
        if (techniqueId === "ll-monk:step-of-the-wind") {
          input.mode = window.prompt("Выберите Dash или Disengage: dash / disengage.") ?? "";
        }
        if (techniqueId === "ll-monk:heavenly-step") {
          input.stopOnSurface = window.confirm("Подтвердите, что вы остановились на стене, жидкости или потолке и тратите 1 Ki, чтобы оставаться там до начала следующего хода.");
          if (!input.stopOnSurface) {
            releaseTarget();
            return;
          }
        }
        if (techniqueId === "ll-monk:mantle-of-courtesy") {
          input.otherModifiers = promptNumber("Введите дополнительные модификаторы проверки (целое число, можно отрицательное).");
          if (input.otherModifiers == null) {
            releaseTarget();
            return;
          }
        }
        if (techniqueId === "ll-monk:crushing-strike") {
          input.kiCost = promptNumber("Сколько Ki оплатить (от 1 до модификатора Мудрости)?");
          if (input.kiCost == null) {
            releaseTarget();
            return;
          }
        }
        const applied = executeMonkTechnique(currentContext, techniqueId, input);
        releaseTarget();
        if (applied.status !== "applied") {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent = applied.reason ?? "Техника не применена.";
        } else if (!applied.persistence.ok && status) {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent = "Техника применена в памяти, но сохранение не удалось. Повторите сохранение.";
        } else if (applied.outcome?.result?.returnUnsupported) {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent = "Снаряд пойман, но возврат после этого режима атаки не поддерживается.";
        } else if (applied.outcome?.result?.reducedDamage != null) {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) {
            const result = applied.outcome.result;
            currentStatus.textContent = `Остаток урона: ${result.reducedDamage}. ${
              result.canCatch ? "Снаряд пойман; возвратная атака доступна ниже." :
              result.remainingDamage === 0 ? "Можно совершить безоружный ответ в рамках той же реакции." : ""
            }`;
          }
        } else if (applied.outcome?.result?.addedDamage) {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent =
            `Crushing Strike: добавлено ${applied.outcome.result.addedDamage}; бросьте урон вручную.`;
        }
        return;
      }
      if (target.matches("[data-technique-commit]")) {
        const pending = pendingDrafts.get(key);
        if (!pending) return;
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
        if (!attackRollInput?.value || !armorClassInput?.value) {
          if (status) status.textContent = "Введите бросок d20 и КД цели.";
          return;
        }
        if (!window.confirm("Подтвердите, что пойманный снаряд является простым оружием, которым Сара владеет; приложение не определяет попадание автоматически.")) return;
        const result = continueDeflectMissile(
          currentContext,
          target.dataset.missileReturn,
          Number(attackRollInput.value),
          Number(armorClassInput.value),
          { proficiencyConfirmed: true }
        );
        if (result.status !== "applied") {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent = result.reason;
        } else {
          const currentStatus = panel.querySelector("[data-technique-editor-status]");
          if (currentStatus) currentStatus.textContent =
            `${result.outcome.total} против КД ${armorClassInput.value}: ${result.outcome.hits ? "попадание" : "промах"}. Затрачено 1 Ki; реакция повторно не используется.`;
        }
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
}

export function hasChangedTechniqueDraft(context) {
  const pending = pendingDrafts.get(getSessionKey(context));
  if (!pending) return false;
  const draft = pending.draft;
  return JSON.stringify(draft.ordinaryTechniqueIds) !== JSON.stringify(draft.baseOrdinaryTechniqueIds) ||
    JSON.stringify(draft.signatureTechniqueSlots) !== JSON.stringify(draft.baseSignatureTechniqueSlots) ||
    JSON.stringify(draft.techniqueChoices) !== JSON.stringify(draft.baseTechniqueChoices);
}
