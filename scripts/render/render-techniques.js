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
  endAwakenThirdEye
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
import { setPanelMarkup } from "./sara-dom.js";
import { openSaraTechniqueApplication, getMinimizedWorkspaceSessions, resumeWorkspace } from "../workspace/controller.js";

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
      entitlementEventId: character.ui?.techniques?.entitlementEventId ?? "",
      mode: "mine"
    });
  }
  return techniqueViews.get(key);
}

function filterTechniqueCards(panel, view) {
  const query = view.searchQuery.trim().toLocaleLowerCase("ru");
  let visibleCount = 0;
  panel.querySelectorAll("[data-technique-card]").forEach((card) => {
    const matchesQuery = !query ||
      card.textContent.toLocaleLowerCase("ru").includes(query);
    const matchesSource = view.source === "all" || card.dataset.source === view.source;
    const matchesType = view.type === "all" || card.dataset.type === view.type;
    const matchesSelection = (view.mode !== "mine" && view.filter !== "selected") ||
      card.dataset.selected === "true";
    const matchesAvailability = view.filter !== "available" ||
      (card.dataset.available === "true" && card.dataset.selected !== "true");
    card.hidden = !(matchesQuery && matchesSource && matchesType &&
      matchesSelection && matchesAvailability);
    if (!card.hidden) visibleCount += 1;
  });
  const empty = panel.querySelector("[data-technique-empty]");
  if (empty) empty.hidden = visibleCount > 0;
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
  const isRollAmendment = ["ll-monk:mantle-of-courtesy", "ll-monk:indomitable-spirit"].includes(entry.id);
  const isUnroutedRollContinuation = entry.activation === "on-miss" &&
    entry.id === "ll-monk:seeking-strike";
  const useControl = !isStrikeFollowUp && !BATTLE_WORKSPACE_TECHNIQUES.has(entry.id) &&
    !isRollAmendment && !isUnroutedRollContinuation && isEffective && availability.available &&
    (entry.category !== "passive" || entry.id === "ll-monk:heavenly-step") && !draft
    ? `<button type="button" class="btn btn--utility" data-technique-use="${escapeHtml(entry.id)}"
        data-workspace-invoker="technique-use:${escapeHtml(entry.id)}">Открыть применение</button>`
    : "";
  const workspaceHint = isStrikeFollowUp
    ? `<p class="technique-card__status">Доступна как продолжение после подходящего попадания в боевом пульте.</p>`
    : isRollAmendment
      ? `<p class="technique-card__status">Доступна только как продолжение подходящего физического броска.</p>`
    : isUnroutedRollContinuation
      ? `<p class="technique-card__status">Требует записи подходящего промаха; отдельный запуск недоступен, так как продолжение промаха не подключено.</p>`
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
  const ordinaryIds = character.monk?.ordinaryTechniqueIds ?? [];
  const techniqueModes = [
    ["mine", "Мои техники"],
    ["catalog", "Каталог"],
    ["prepare", "Подготовка"],
  ];
  const signatureCount = Object.values(character.monk?.signatureTechniqueSlots ?? {})
    .filter(Boolean).length;
  const deferredTechniqueTasks = getMinimizedWorkspaceSessions()
    .filter((task) => task.workspaceType === "command" && task.scenarioId?.startsWith("monk-technique:"));
  const markup = `
    <header class="sara-tab-heading"><h2>Техники</h2></header>
    <p class="sara-technique-summary">Обычные: ${ordinaryIds.length}/${derivedTechniqueLimit(character)} · Избранные: ${signatureCount} · Ци: ${character.combat?.ki?.current ?? "—"}/${derived.monk.kiMaximum ?? "—"}</p>
    ${deferredTechniqueTasks.length ? `<section class="sara-status" aria-label="Отложенные применения">
      <h3>Отложенное применение</h3>${deferredTechniqueTasks.map((task) => `<button type="button" class="btn btn--utility"
        data-technique-resume-workspace="${escapeHtml(task.workspaceSessionId)}">${escapeHtml(task.label)}</button>`).join("")}
    </section>` : ""}
    <nav class="sara-subtabs" aria-label="Разделы техник">
      ${techniqueModes.map(([id, label]) => `<button type="button" class="btn"
        data-technique-tab="${id}" aria-selected="${view.mode === id}">${label}</button>`).join("")}
    </nav>
    <section class="sara-technique-catalog" data-technique-catalog-controls ${view.mode === "catalog" ? "" : "hidden"}>
      <label class="field-label">Поиск<input class="input" type="search" data-technique-view="searchQuery" value="${escapeHtml(query)}"></label>
      <div class="technique-controls">
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
      <details class="technique-card__status"><summary>Источники и происхождение</summary>
        <p>Зафиксированная версия: ${escapeHtml(MONK_RULESET_PROVENANCE.rulesetId)}; авторская пометка последнего найденного анонса — ${escapeHtml(MONK_RULESET_PROVENANCE.latestAuthorAnnouncement)}, версия страницы отдельно не подтверждена.</p>
        <p><a href="${MONK_RULESET_PROVENANCE.sources.core}" target="_blank" rel="noopener noreferrer">Основной каталог</a> · <a href="${MONK_RULESET_PROVENANCE.sources.expanded}" target="_blank" rel="noopener noreferrer">Дополнение</a>.</p>
      </details>
      <p class="technique-card__status">Каталог ${MONK_TECHNIQUES.length} техник. Записи старших уровней доступны для чтения, но не применения.</p>
    </section>
    <section class="sara-technique-preparation" data-technique-preparation-controls ${view.mode === "prepare" ? "" : "hidden"}>
    <div class="section-heading-row">
      <h3>Подготовка · ${ordinaryIds.length}/${derivedTechniqueLimit(character)} обычных</h3>
      ${entitlements.length && !draft ? `<label class="field-label">Основание<select class="input" data-technique-view="entitlementEventId">
        ${entitlements.map((event) => `<option value="${escapeHtml(event.id)}" ${event.id === entitlement?.id ? "selected" : ""}>${escapeHtml(event.type === "rest" ? "Долгий отдых" : `Уровень ${event.level}`)}</option>`).join("")}
      </select></label>` : ""}
      ${draft ? `<button type="button" class="btn btn--primary" data-technique-commit>Подтвердить замену</button>
        <button type="button" class="btn btn--utility" data-technique-cancel>Отменить черновик</button>` :
        `<button type="button" class="btn" data-technique-edit ${entitlement ? "" : "disabled"}>${entitlement ? "Редактировать выбор" : "Нет права на замену"}</button>`}
    </div>
    ${draft ? `<p class="technique-card__status">Предпросмотр не тратит право на замену. Изменения вступят в силу только после подтверждения.</p>` : ""}
    ${draftState && draftState.baseRevision !== context.stateRevision ? `<p class="technique-card__status" role="alert">Персонаж изменился. Черновик сохранён, но требует повторной проверки.
      <button type="button" class="btn btn--utility" data-technique-rebuild>Пересобрать черновик</button>
      <button type="button" class="btn btn--utility" data-technique-cancel>Отменить черновик</button></p>` : ""}
    ${draft ? `<div class="technique-controls technique-signatures">${renderSignatureSelects(character, draft)}</div>` : ""}
    ${draft ? `<div class="technique-controls">${renderTechniqueChoices(character, draft)}</div>` : ""}
    </section>
    ${thirdEye.awakenThirdEyePending ? `<section class="sara-status" role="status">
      <p>Требуется вручную подтвердить завершение минутной медитации. 8 Ki уже потрачены; прерывание не возмещает их.</p>
      <label class="sara-form-check"><input type="checkbox" data-awaken-complete-confirm>
        Подтверждаю завершение медитации</label>
      <button type="button" class="btn" data-awaken-complete>Подтвердить завершение медитации</button>
    </section>` : ""}
    ${thirdEye.awakenThirdEyeActive ? `<section class="sara-status" role="status">
      <p>Foresight действует до 8 часов. Текущий максимум ци уменьшен на 8; эффекты отмечаются вручную.</p>
      <label class="sara-form-check"><input type="checkbox" data-awaken-end-confirm>
        Подтверждаю завершение эффекта; потраченная ци не возвращается</label>
      <button type="button" class="btn btn--utility" data-awaken-end>Завершить эффект вручную</button>
    </section>` : ""}
    <div class="technique-list" data-technique-list>${entries.map((entry) => renderTechniqueCard(entry, character, draft)).join("")}</div>
    <p class="sara-empty-state" data-technique-empty hidden>Нет записей по текущему представлению. Проверьте подготовленные техники или фильтры.</p>
    <p class="technique-card__status" data-technique-editor-status role="status"></p>
    <details class="sara-details"><summary>Дополнительные стили и заговоры</summary>
      <section class="panel-section"><h3>Воинский адепт — стили</h3>
        <div class="technique-list">${WARRIOR_ADEPT_STYLES.map((style) => `<article class="technique-card"><h4>${escapeHtml(subchoiceLabel(style.id))}</h4><p>${escapeHtml(style.prerequisites.join("; ") || "без предварительных требований")}</p><p>${escapeHtml(style.text)}</p><details><summary>Оригинал и источник</summary><p>${escapeHtml(style.name)} · Alternate Monk</p></details></article>`).join("")}</div>
      </section>
      <p class="technique-card__status">Сияние божества: доступные заговоры — ${CLERIC_CANTRIPS.map((spell) => escapeHtml(spell.name)).join(", ")}.</p>
    </details>
  `;
  setPanelMarkup(panel, markup, "sara-velaris");
  panel.dataset.techniqueMode = view.mode;
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
      if (target.matches("[data-technique-use]")) {
        const opened = openSaraTechniqueApplication(target.dataset.techniqueUse, target);
        if (!opened.ok && status) status.textContent = opened.reason;
        return;
      }
      if (target.matches("[data-technique-resume-workspace]")) {
        const resumed = resumeWorkspace(target.dataset.techniqueResumeWorkspace);
        if (!resumed.ok && status) status.textContent = resumed.reason;
        return;
      }
      if (target.matches("[data-technique-tab]")) {
        getTechniqueView(currentState, key).mode = target.dataset.techniqueTab;
        renderTechniquesPanel(currentState);
        return;
      }
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
