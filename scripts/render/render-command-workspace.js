import { getDerivedStats } from "../calculations.js";
import { ABILITY_KEYS, ABILITY_LABELS_RU, SKILL_ID_META } from "../rules.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { calculateRollConsequencePreview } from "../rolls/consequences.js";
import { calculateCharacterRoll } from "../rolls/calculations.js";
import { getSaraRollBreakdown } from "../rolls/providers/sara.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function numberField(name, label, min = 1, max = null, value = "") {
  return `<label class="workspace-field">${label}
    <input data-workspace-field="${name}" name="${name}" type="number" min="${min}" value="${escapeHtml(value)}"
      ${max == null ? "" : `max="${max}"`} step="1" inputmode="numeric" required></label>`;
}

function checkbox(name, label, checked = false) {
  return `<label class="workspace-check"><input data-workspace-field="${name}"
    name="${name}" type="checkbox" ${checked ? "checked" : ""}> ${label}</label>`;
}

function selectField(name, label, options, value = "") {
  return `<label class="workspace-field">${label}<select data-workspace-field="${name}"
    name="${name}" required><option value="">Выберите</option>
    ${options.map(([optionValue, title]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(title)}</option>`).join("")}
    </select></label>`;
}

function renderCommandForm(session, state) {
  const id = session.scenarioId;
  const die = getDerivedStats(state).monk.martialDieSides;
  const draft = session.rawInputsByStep?.[session.currentStepKey] ?? {};
  const number = (name, label, min = 1, max = null) =>
    numberField(name, label, min, max, draft[name] ?? "");
  const check = (name, label) => checkbox(name, label, draft[name] === true);
  const select = (name, label, options) => selectField(name, label, options, draft[name] ?? "");
  if (id === "character-roll") {
    const kind = draft.kind === "saving-throw" ? "saving-throw" : "ability-check";
    const rollMode = ["normal", "advantage", "disadvantage"].includes(draft.rollMode)
      ? draft.rollMode : "normal";
    const choices = kind === "saving-throw"
      ? ABILITY_KEYS.map((ability) => [ability, ABILITY_LABELS_RU[ability]])
      : [
          ...ABILITY_KEYS.map((ability) => [ability, ABILITY_LABELS_RU[ability]]),
          ...Object.entries(SKILL_ID_META).map(([skill, meta]) => [skill, meta.label]),
        ];
    const effective = getEffectiveSelectedTechniqueIds(state);
    const rollBreakdown = getSaraRollBreakdown(state, kind, draft.id);
    const selectedLabel = rollBreakdown.ok ? rollBreakdown.label.toLocaleUpperCase("ru-RU") : "ФИЗИЧЕСКИЙ БРОСОК";
    return `<label class="workspace-field">Тип броска
        <select data-workspace-field="kind" name="kind">
          <option value="ability-check" ${kind === "ability-check" ? "selected" : ""}>Проверка характеристики или навыка</option>
          <option value="saving-throw" ${kind === "saving-throw" ? "selected" : ""}>Спасбросок</option>
        </select>
      </label>
      ${select("id", kind === "saving-throw" ? "Характеристика спасброска" : "Характеристика или навык", choices)}
      <fieldset class="workspace-roll-mode">
        <legend>Режим броска</legend>
        <div>
          ${[["normal", "Обычный"], ["advantage", "Преимущество"], ["disadvantage", "Помеха"]]
            .map(([value, label]) => `<button type="button" class="workspace-roll-mode__option"
              data-workspace-action="roll-mode-${value}" aria-pressed="${rollMode === value}">${label}</button>`).join("")}
        </div>
        <input type="hidden" data-workspace-field="rollMode" name="rollMode" value="${rollMode}">
      </fieldset>
      <div class="workspace-d20-inputs ${rollMode === "normal" ? "" : "workspace-d20-inputs--pair"}">
        ${number("firstD20", "Физический к20", 1, 20)}
        <div data-workspace-second-d20 ${rollMode === "normal" ? "hidden" : ""}>
          ${number("secondD20", "Второй физический к20", 1, 20)}
        </div>
      </div>
      ${kind === "saving-throw"
        ? check("spellSaveSource", "Спасбросок от заклинания · преимущество Юань-ти") : ""}
      <details class="workspace-roll-sources">
        <summary>Источники преимущества или помехи</summary>
        <label class="workspace-field">Причина преимущества
          <input data-workspace-field="advantageReason" name="advantageReason" value="${escapeHtml(draft.advantageReason ?? "")}">
        </label>
        <label class="workspace-field">Причина помехи
          <input data-workspace-field="disadvantageReason" name="disadvantageReason" value="${escapeHtml(draft.disadvantageReason ?? "")}">
        </label>
      </details>
      <section class="workspace-attack-result workspace-roll-result" aria-live="polite">
        <span class="workspace-attack-result__label" data-roll-label>${escapeHtml(selectedLabel)}</span>
        <output class="workspace-attack-result__total" data-roll-total>—</output>
        <span class="workspace-attack-result__formula" data-roll-formula></span>
        <span class="workspace-roll-result__selected" data-roll-selected></span>
        <span class="workspace-roll-result__modifiers" data-roll-modifiers></span>
        <span class="workspace-roll-result__mode" data-roll-mode-status></span>
        <span class="workspace-input-message" data-roll-validation role="status"></span>
      </section>
      ${kind === "ability-check" && draft.id === "persuasion" &&
        effective.has("ll-monk:mantle-of-courtesy")
        ? `<p>«Мантия учтивости» заменит выбранный к20 уровнем монаха и стоит 1 ци.</p>
          <button type="button" class="btn btn--utility" data-workspace-action="roll-amend-mantle-preview">Записать с «Мантией учтивости» · 1 ци</button>` : ""}
      ${kind === "ability-check" && draft.id === "athletics" &&
        effective.has("ll-monk:indomitable-spirit")
        ? `${check("timingConfirmed", "Подтверждаю: ведущий ещё не объявил исход проверки Атлетики.")}
          <p>«Несокрушимый дух» добавит модификатор Мудрости к итогу и стоит 1 ци.</p>
          <button type="button" class="btn btn--utility" data-workspace-action="roll-amend-spirit-preview">Записать с «Несокрушимым духом» · 1 ци</button>` : ""}
      <p>Итог использует текущие параметры персонажа. Бросок не тратит действие или ресурс.</p>`;
  }
  if (id === "resource-correction") {
    const resources = [
      ["hp-current", "Текущие HP"],
      ["hp-temp", "Временные HP"],
      ["ki", "Ци"],
      ["practiced", "Отработанные удары"],
      ...(state.spellcasting?.racialSpells ?? [])
        .filter((spell) => spell.source === "racial" && spell.mode === "limited-racial" && spell.uses)
        .map((spell) => [`racial-spell:${spell.id}`, `Применения: ${spell.nameRu ?? spell.id}`]),
    ];
    return `<p>Исправляет только сохранённый ресурс персонажа. Не создаёт предметы и не выполняет действие.</p>
      ${select("resourceId", "Ресурс", resources)}
      ${number("value", "Фактическое новое значение", 0)}`;
  }
  if (id.startsWith("pending-save:")) {
    const applicationId = id.slice("pending-save:".length);
    const application = state.monk?.combatAssistant?.pendingApplications?.find((entry) =>
      entry.id === applicationId);
    if (!application) return `<p class="workspace-error" role="alert">Ожидание спасброска больше не найдено.</p>`;
    return `<p>Родительское попадание ${escapeHtml(application.parentAttackId)} · СЛ ${application.dc} · спасбросок ${escapeHtml(application.saveAbility ?? "по правилу")}.</p>
      ${application.criticalDisadvantageReminder ? `<p>${escapeHtml(application.criticalDisadvantageReminder)}</p>` : ""}
      ${application.manualTimingNote ? `<p>${escapeHtml(application.manualTimingNote)}</p>` : ""}
      ${select("outcome", "Полученный от игрока/ведущего исход", [
        ["success", "Успех"], ["failure", "Провал"], ["unknown", "Оставить неизвестным"],
      ])}`;
  }
  if (id.startsWith("pending-roll:")) {
    const rollId = id.slice("pending-roll:".length);
    const roll = state.characterRolls?.records?.find((entry) => entry.id === rollId);
    if (!roll) return `<p class="workspace-error" role="alert">Ожидающий результат спасброска больше не найден.</p>`;
    return `<p>Спасбросок ${escapeHtml(roll.label ?? roll.ability ?? "")} · результат ${roll.dcResult ? "успех" : "провал"} · урон ${escapeHtml(String(roll.incomingDamage ?? "—"))}.</p>
      ${select("resolution", "Учет последствия", [
        ["apply-to-character", "Применить к персонажу"],
        ["tracked-elsewhere", "Урон учтён вне листа"],
      ])}`;
  }
  if (id === "mystic-regeneration") {
    return `<p>Физически бросьте кость Боевых искусств. Лечение не может превысить максимум HP; временные HP не выдаются.</p>
      ${number("dieResult", `Физический результат к${die}`, 1, die)}
      ${check("confirmNoHealing", "Подтверждаю применение без полезного лечения, если HP уже полные.")}`;
  }
  if (id.startsWith("racial-spell:")) {
    const spellId = id.slice("racial-spell:".length);
    return `<p>Расовое заклинание · применение и исход цели определяются вручную.</p>
      ${session.expectedConcentration
        ? check("replaceConcentration", `Заменить текущую концентрацию «${escapeHtml(session.expectedConcentration)}».`)
        : ""}
      ${check("confirmed", "Подтверждаю применение; цель и результат определяются вручную.")}`;
  }
  if (id === "step-of-the-wind") {
    return `${select("mode", "Выберите вариант", [["dash", "Рывок"], ["disengage", "Отход"]])}
      <p>Прыжок удваивается до конца текущего хода; расстояние определяет ведущий.</p>
      ${check("confirmed", "Подтверждаю применение выбранной техники.")}`;
  }
  if (id === "patient-defense") {
    return `<p>Бонусное действие · 1 ци. Эффект определяется выбранной техникой.</p>
      ${check("confirmed", "Подтверждаю применение.")}`;
  }
  if (id === "flurry") {
    return `<p>Шквал создаёт ${Number(state.profile?.level) >= 17 ? 3 : 2} удара; ци расходуется до первого броска и не возвращается при промахе.</p>
      ${check("confirmed", "Подтверждаю расход 1 ци и начало Шквала.")}`;
  }
  if (id === "bonus-unarmed") {
    return `<p>Один безоружный удар. Бонусное действие будет использовано при запуске последовательности.</p>
      ${check("triggerConfirmed", "Подтверждаю фактическое условие бонусной атаки Martial Arts.")}`;
  }
  if (id === "ebb-and-flow") {
    return `${select("mode", "Ответ после промаха вблизи", [
      ["unarmed", "Ответный безоружный удар"],
      ["dexterity-save", "Спасбросок Ловкости цели"],
    ])}
      ${check("triggerConfirmed", "Подтверждаю, что по мне промахнулись вблизи.")}`;
  }
  if (id === "opportunity-unarmed") {
    return `<p>Один безоружный ответ реакцией; это не действие «Атака» и не Extra Attack.</p>
      ${check("triggerConfirmed", "Подтверждаю провоцированный триггер по решению игрока/ведущего.")}`;
  }
  if (id === "dash" || id === "disengage") {
    return `<p>${id === "dash"
      ? "Рывок будет отмечен как использованное действие. Дистанция не моделируется."
      : "Отход будет отмечен как использованное действие. Цели и провоцированные атаки не моделируются."}</p>
      ${check("confirmed", "Подтверждаю ручное применение действия.")}`;
  }
  if (id === "deflect-strike") {
    return `${check("triggerConfirmed", "Подтверждаю подходящее попадание вблизи по решению игрока/ведущего.")}
      ${select("mode", "Вид входящей атаки", [
      ["weapon-melee", "Попадание рукопашным оружием"],
      ["other-melee", "Иное рукопашное попадание"],
    ])}
      ${number("incomingDamage", "Входящий урон", 0)}
      ${number("deflectRoll", `Физический результат к${die}`, 1, die)}
      ${number("finalAdjustedDamage", "Остаток после других поправок (необязательно)", 0)}
      ${select("applyDamageToSara", "Применить рассчитанный остаток к HP?", [
        ["true", "Да, применить с учётом временных HP"],
        ["false", "Нет, HP учитываются отдельно"],
      ])}`;
  }
  if (id === "deflect-missile") {
    return `${check("triggerConfirmed", "Подтверждаю подходящее дальнобойное попадание по решению игрока/ведущего.")}
      ${select("mode", "Вид входящей атаки", [
      ["weapon", "Дальнобойная атака оружием"],
      ["other-ranged", "Иная дальнобойная атака"],
    ])}
      ${number("incomingDamage", "Входящий урон", 0)}
      ${number("deflectRoll", `Физический результат к${die}`, 1, die)}
      ${check("freeHand", "Есть свободная рука")}
      ${check("physicalProjectile", "Это физический снаряд")}
      ${check("caught", "Подтверждаю попытку поймать снаряд")}
      ${select("applyDamageToSara", "Применить рассчитанный остаток к HP?", [
        ["true", "Да, применить с учётом временных HP"],
        ["false", "Нет, HP учитываются отдельно"],
      ])}
      <p>Режим «иное дальнобойное» доступен только на условиях техники; возврат стоит отдельно 1 ци.</p>`;
  }
  if (session.currentStep === "missile-return") {
    return `<p>Вернуть снаряд — отдельное продолжение той же реакции, стоимость 1 ци. Профиль возвращённого снаряда не включает бонус Амулета.</p>
      ${number("attackRoll", "Физический результат к20", 1, 20)}
      ${number("targetArmorClass", "КД цели (если известна)", 1, 99)}
      <label class="workspace-field">Если КД неизвестна
        <select data-workspace-field="dmHitResult" name="dmHitResult">
          <option value="">Не выбрано</option>
          <option value="hit" ${draft.dmHitResult === "hit" ? "selected" : ""}>Попадание</option>
          <option value="miss" ${draft.dmHitResult === "miss" ? "selected" : ""}>Промах</option>
        </select>
      </label>
      ${number("damage1", "Физический урон d1", 1)}
      ${number("damage2", "Физический урон d2 при критическом попадании", 1)}
      ${check("proficiencyConfirmed", "Подтверждаю владение простым оружием для возврата.")}`;
  }
  return `<p>Для этого сценария ещё не подключена форма ввода.</p>`;
}

function getRollPreviewInput(draft) {
  return {
    kind: draft.kind,
    id: draft.id,
    rollMode: draft.rollMode,
    firstD20: draft.firstD20,
    secondD20: draft.secondD20,
    spellSaveSource: draft.spellSaveSource === true,
    advantageReason: draft.advantageReason,
    disadvantageReason: draft.disadvantageReason,
  };
}

function formatRollModifier(value) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

export function renderWorkspaceRollPreview(session, state) {
  const root = document.getElementById("actionWorkspaceRoot");
  if (!root || session.currentStep !== "command-input" || session.scenarioId !== "character-roll") return;
  const draft = session.rawInputsByStep?.[session.currentStepKey] ?? {};
  const breakdown = getSaraRollBreakdown(state, draft.kind, draft.id);
  const preview = breakdown.ok
    ? calculateCharacterRoll(getRollPreviewInput(draft), breakdown)
    : { ok: false, reason: breakdown.reason };
  session.rollPreviewValid = preview.ok;
  const totalNode = root.querySelector("[data-roll-total]");
  const formulaNode = root.querySelector("[data-roll-formula]");
  const selectedNode = root.querySelector("[data-roll-selected]");
  const modifiersNode = root.querySelector("[data-roll-modifiers]");
  const modeNode = root.querySelector("[data-roll-mode-status]");
  const validationNode = root.querySelector("[data-roll-validation]");
  const labelNode = root.querySelector("[data-roll-label]");
  const modeLabels = {
    normal: "Обычный бросок",
    advantage: "Преимущество",
    disadvantage: "Помеха",
  };
  if (labelNode) labelNode.textContent = breakdown.ok
    ? breakdown.label.toLocaleUpperCase("ru-RU") : "ФИЗИЧЕСКИЙ БРОСОК";
  if (totalNode) totalNode.textContent = preview.ok ? String(preview.total) : "—";
  if (formulaNode) {
    formulaNode.textContent = preview.ok
      ? `${preview.chosenD20} ${formatRollModifier(preview.totalModifier)} = ${preview.total}` : "";
  }
  if (selectedNode) {
    selectedNode.textContent = preview.ok
      ? `Выбрана кость ${preview.chosenD20}${preview.rawD20Rolls.length > 1
        ? ` из ${preview.rawD20Rolls.join(" и ")}` : ""}.` : "";
  }
  if (modifiersNode) {
    modifiersNode.textContent = breakdown.ok
      ? breakdown.sources.map((source) =>
        `${source.label} ${formatRollModifier(source.value)}`).join(" · ") : "";
  }
  if (modeNode) {
    const reason = draft.rollMode === "advantage"
      ? draft.advantageReason : draft.rollMode === "disadvantage" ? draft.disadvantageReason : "";
    modeNode.textContent = `${modeLabels[draft.rollMode] ?? "Выберите режим броска."}${reason ? ` · ${reason}` : ""}`;
  }
  if (validationNode) {
    validationNode.textContent = preview.ok
      ? "Выберите исход после ответа ведущего." : preview.reason;
    validationNode.dataset.state = preview.ok ? "ready" : "invalid";
  }
  for (const button of root.querySelectorAll(
    '[data-workspace-action="record-roll"], [data-workspace-action$="-preview"]',
  )) {
    button.disabled = !preview.ok || session.submitting || session.appliedUnsaved;
  }
}

export function renderWorkspaceConsequencePreview(session, state) {
  const root = document.getElementById("actionWorkspaceRoot");
  if (!root || session.currentStep !== "roll-result" ||
      session.rollRecord?.consequence?.status !== "awaiting-damage-input") return;
  const draft = session.rawInputsByStep?.[session.currentStepKey] ?? {};
  const preview = calculateRollConsequencePreview(session.rollRecord, state, {
    damage: draft.damage,
    damageBasis: draft.damageBasis,
    effectProfile: draft.effectProfile,
  });
  const totalNode = root.querySelector("[data-consequence-total]");
  const ruleNode = root.querySelector("[data-consequence-rule]");
  const hpNode = root.querySelector("[data-consequence-hp]");
  if (totalNode) totalNode.textContent = preview.ok ? String(preview.finalDamage) : "—";
  if (ruleNode) ruleNode.textContent = preview.ok ? preview.ruleExplanation : preview.reason;
  if (hpNode) {
    hpNode.textContent = preview.ok
      ? `HP ${preview.hpBefore} → ${preview.hpAfter} · временные HP ${preview.tempHpBefore} → ${preview.tempHpAfter}`
      : "";
  }
}

function rollOutcomeButtons(action, disabled = false) {
  return `<button type="button" class="btn btn--utility" data-workspace-action="${action}"
      data-roll-outcome="failure" ${disabled ? "disabled" : ""}>Провал</button>
    <button type="button" class="btn btn--primary" data-workspace-action="${action}"
      data-roll-outcome="success" ${disabled ? "disabled" : ""}>Успех</button>`;
}

function renderConsequenceInput(record, state, session) {
  const draft = session.rawInputsByStep?.[session.currentStepKey] ?? {};
  const savingThrow = record.kind === "saving-throw";
  const input = {
    damage: draft.damage ?? "",
    damageBasis: draft.damageBasis ?? (savingThrow ? "" : "dm-final"),
    effectProfile: draft.effectProfile ?? "",
  };
  const preview = calculateRollConsequencePreview(record, state, input);
  return `<form class="workspace-roll-consequence" data-workspace-form="roll-consequence" novalidate>
      ${savingThrow
        ? `${selectField("damageBasis", "Основа урона", [
          ["dm-final", "Уже итоговый урон от мастера"],
          ["full-effect", "Полный урон эффекта"],
        ], input.damageBasis)}
          ${selectField("effectProfile", "Профиль полного урона", [
            ["failure-full", "Урон только при провале"],
            ["save-half", "Спасбросок для половины урона"],
          ], input.effectProfile)}`
        : `<p>Для проверки укажите только итоговый урон, сообщённый ведущим; защита спасброска не применяется.</p>
          <input type="hidden" data-workspace-field="damageBasis" name="damageBasis" value="dm-final">`}
      ${numberField("damage", savingThrow ? "Урон по хитам" : "Итоговый урон по хитам", 0, null, input.damage)}
      <section class="workspace-damage-result workspace-consequence-preview" aria-live="polite">
        <span class="workspace-attack-result__label">УРОН ПО ХИТАМ</span>
        <output class="workspace-damage-result__total" data-consequence-total>${preview.ok ? preview.finalDamage : "—"}</output>
        <span class="workspace-consequence-preview__rule" data-consequence-rule>${escapeHtml(preview.ok ? preview.ruleExplanation : preview.reason)}</span>
        <span data-consequence-hp>${preview.ok
          ? `HP ${preview.hpBefore} → ${preview.hpAfter} · временные HP ${preview.tempHpBefore} → ${preview.tempHpAfter}` : ""}</span>
      </section>
    </form>`;
}

export function renderCommandWorkspace(session, state) {
  const derived = getDerivedStats(state);
  const title = session.command?.titleRu ?? "Боевое действие";
  const unavailableReason = session.command?.availability?.enabled
    ? "" : session.command?.availability?.reasonRu ?? "Команда больше недоступна.";
  const header = `<div class="workspace-nav">
      <button type="button" class="btn btn--utility" data-workspace-action="back">Назад</button>
      <button type="button" class="btn btn--utility" data-workspace-action="minimize">Свернуть</button>
      <button type="button" class="btn btn--utility" data-workspace-action="close">Закрыть</button>
    </div>
    <div><h2 id="workspaceDialogTitle" tabindex="-1" data-workspace-title>${escapeHtml(title)}</h2>
      <p>${escapeHtml(session.stepLabel ?? "Подтверждение и ввод физических результатов")}</p></div>
    <div class="workspace-resources">
      <span>HP <b data-workspace-hp>${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}</b></span>
      <span>Ци <b data-workspace-ki>${state.combat?.ki?.current ?? "—"}</b></span>
    </div>`;
  const body = session.currentStep === "command-input"
    ? `<form data-workspace-form="command" novalidate>${renderCommandForm(session, state)}
        ${unavailableReason ? `<p class="workspace-error" role="status">${escapeHtml(unavailableReason)}</p>` : ""}
        ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
      </form>`
    : session.currentStep === "missile-return"
      ? `<form data-workspace-form="missile-return" novalidate>${renderCommandForm(session, state)}
          ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
        </form>`
    : session.currentStep === "roll-result"
      ? renderRollResult(session, state)
    : `<p role="status">${escapeHtml(session.resultMessage ?? "Результат записан.")}</p>
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
  const footer = session.currentStep === "command-input" && session.scenarioId === "character-roll"
    ? renderCharacterRollFooter(session)
    : session.currentStep === "command-input"
    ? `<button type="button" class="btn btn--primary" data-workspace-action="apply-command"
        ${session.submitting || session.appliedUnsaved || unavailableReason ? "disabled" : ""}>Подтвердить и записать</button>`
    : session.currentStep === "missile-return"
      ? `<button type="button" class="btn btn--primary" data-workspace-action="submit-missile-return"
          ${session.submitting || session.appliedUnsaved ? "disabled" : ""}>Вернуть снаряд · 1 ци</button>`
    : session.currentStep === "roll-result"
      ? renderRollFooter(session)
    : session.canReturnMissile
        ? `<button type="button" class="btn btn--primary" data-workspace-action="return-missile">Решить: вернуть пойманный снаряд · 1 ци</button>
          <button type="button" class="btn btn--utility" data-workspace-action="done">Не возвращать · завершить</button>`
        : session.canDeflectCounter
          ? `<button type="button" class="btn btn--primary" data-workspace-action="deflect-counter">Ответить одним безоружным ударом · та же реакция</button>
            <button type="button" class="btn btn--utility" data-workspace-action="done">Завершить без ответа</button>`
    : `<button type="button" class="btn btn--primary" data-workspace-action="done">Готово</button>`;
  const retry = session.appliedUnsaved
    ? `<p class="workspace-error" role="alert">Применено, но не сохранено.</p>
      <button type="button" class="btn btn--utility" data-workspace-action="retry-save">Повторить сохранение</button>` : "";
  return { header, body, footer: `${footer}${retry}` };
}

function renderRollResult(session, state) {
  const record = session.rollRecord;
  if (!record) return `<p class="workspace-error" role="alert">Запись броска не найдена в текущем состоянии.</p>`;
  const consequenceStatus = record.consequence?.status ?? null;
  const oldPending = consequenceStatus === "pending";
  const awaitingOutcome = consequenceStatus === "awaiting-outcome";
  const awaitingDamageDecision = consequenceStatus === "awaiting-damage-decision";
  const awaitingDamageInput = consequenceStatus === "awaiting-damage-input";
  const outcome = record.manualOutcome ??
    (typeof record.dcResult === "boolean" ? record.dcResult ? "success" : "failure" : null);
  const outcomeLabel = outcome === "success" ? "Успех" : outcome === "failure" ? "Провал" : "Ожидает ответа ведущего";
  const applied = consequenceStatus === "applied";
  const consequence = record.consequence ?? {};
  const previewInput = awaitingDamageInput ? renderConsequenceInput(record, state, session) : "";
  const abilityConsequenceOption = record.kind === "ability-check" && outcome &&
    consequenceStatus == null
    ? `<p>Последствие не задано автоматически. Если ведущий назвал урон, его можно учесть отдельно.</p>` : "";
  const amendmentCorrectionWarning = consequence.outcomeCorrectedAfterApplication
    ? `<p class="workspace-warning">Исход исправлен после применения урона. HP не пересчитаны; при необходимости исправьте их вручную.</p>` : "";
  const outcomeCorrection = outcome
    ? session.correctingOutcome
      ? `<section class="workspace-roll-outcome-correction" aria-label="Исправление исхода">
          <p>Исправление не перебрасывает кости и не пересчитывает уже применённые HP.</p>
          ${rollOutcomeButtons("roll-outcome", session.submitting || session.appliedUnsaved)}
          <button type="button" class="btn btn--utility" data-workspace-action="roll-cancel-outcome">Не менять</button>
        </section>`
      : `<button type="button" class="btn btn--utility" data-workspace-action="roll-edit-outcome"
          ${session.submitting || session.appliedUnsaved ? "disabled" : ""}>Исправить исход</button>`
    : "";
  return `<section class="workspace-roll-record">
      <p class="workspace-roll-record__outcome" role="status">Исход от ведущего: <strong>${outcomeLabel}</strong></p>
      <div class="workspace-attack-result">
        <span class="workspace-attack-result__label">${escapeHtml(record.label ?? "Итог броска")}</span>
        <output class="workspace-attack-result__total">${escapeHtml(String(record.total))}</output>
        <span class="workspace-attack-result__formula">${record.rawD20Rolls.join(" и ")} ${formatRollModifier(record.totalModifier)} = ${record.total}</span>
        <span>Выбран к20: ${record.chosenD20} · ${record.rollMode === "advantage" ? "преимущество" : record.rollMode === "disadvantage" ? "помеха" : "обычный бросок"}${record.advantageReason || record.disadvantageReason
          ? ` · причина: ${escapeHtml(record.rollMode === "advantage" ? record.advantageReason : record.disadvantageReason)}` : ""}</span>
      </div>
      ${record.dc == null ? "" : `<p>СЛ ${record.dc} · ${outcomeLabel}.</p>`}
      ${outcomeCorrection}
      ${awaitingDamageDecision ? `<section class="workspace-post-hit"><h3>Есть урон по хитам?</h3>
        <p>Успех спасброска сам по себе не означает отсутствие урона.</p></section>` : ""}
      ${awaitingOutcome ? `<p role="status">Исход ещё не получен. Запись сохранена и может быть продолжена позже.</p>` : ""}
      ${oldPending ? `<p>Исторический профиль: ${escapeHtml(String(record.consequenceProfile))} · урон ${escapeHtml(String(record.incomingDamage ?? "—"))}.</p>` : ""}
      ${awaitingDamageInput ? previewInput : ""}
      ${abilityConsequenceOption}
      ${applied ? `<section class="workspace-roll-consequence-result" role="status">
        <strong>Урон применён: ${escapeHtml(String(consequence.finalDamage ?? consequence.calculatedDamage ?? 0))}</strong>
        <p>${escapeHtml(consequence.ruleExplanation ?? "")}</p>
        <p>HP ${consequence.hpBefore ?? "—"} → ${consequence.hpAfter ?? "—"} · временные HP ${consequence.tempHpBefore ?? "—"} → ${consequence.tempHpAfter ?? "—"}.</p>
      </section>` : ""}
      ${consequenceStatus === "resolved-none" ? `<p class="workspace-roll-consequence-result" role="status">Отмечено: урона по хитам нет. Решение сохранено.</p>` : ""}
      ${consequenceStatus === "tracked-elsewhere" ? `<p class="workspace-roll-consequence-result" role="status">Последствие учтено вне листа; на HP листа не повлияло.</p>` : ""}
      ${amendmentCorrectionWarning}
      ${session.appliedUnsaved ? `<p class="workspace-error" role="alert">Применено, но не сохранено; повтор операции отключён.</p>` : ""}
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
    </section>`;
}

function renderCharacterRollFooter(session) {
  const disabled = session.submitting || session.appliedUnsaved || session.rollPreviewValid !== true;
  return `${rollOutcomeButtons("record-roll", disabled)}
    <button type="button" class="btn btn--utility" data-workspace-action="record-roll"
      data-roll-outcome="unknown" ${disabled ? "disabled" : ""}>Пока неизвестно</button>`;
}

function renderRollFooter(session) {
  const record = session.rollRecord;
  const status = record?.consequence?.status;
  const disabled = session.submitting || session.appliedUnsaved;
  if (!record) return `<button type="button" class="btn btn--utility" data-workspace-action="done">Готово</button>`;
  if (status === "awaiting-outcome" ||
      record.manualOutcome == null && record.dcResult == null) {
    return `${rollOutcomeButtons("roll-outcome", disabled)}
      <button type="button" class="btn btn--utility" data-workspace-action="roll-defer">Позже</button>`;
  }
  if (status === "awaiting-damage-decision") {
    return `<button type="button" class="btn btn--utility" data-workspace-action="roll-no-damage" ${disabled ? "disabled" : ""}>Нет урона</button>
      <button type="button" class="btn btn--primary" data-workspace-action="roll-has-damage" ${disabled ? "disabled" : ""}>Есть урон</button>
      <button type="button" class="btn btn--utility" data-workspace-action="roll-defer">Позже</button>`;
  }
  if (status === "awaiting-damage-input") {
    return `<button type="button" class="btn btn--primary" data-workspace-action="roll-apply-consequence" ${disabled ? "disabled" : ""}>Применить рассчитанный урон</button>
      <button type="button" class="btn btn--utility" data-workspace-action="roll-track-consequence" ${disabled ? "disabled" : ""}>Учесть вне листа</button>
      <button type="button" class="btn btn--utility" data-workspace-action="roll-defer">Позже</button>`;
  }
  if (status === "pending") {
    return `<button type="button" class="btn btn--primary" data-workspace-action="roll-apply-consequence" ${disabled ? "disabled" : ""}>Применить исторический урон</button>
      <button type="button" class="btn btn--utility" data-workspace-action="roll-track-consequence" ${disabled ? "disabled" : ""}>Урон учтён вне листа</button>`;
  }
  if (record.kind === "ability-check" && record.manualOutcome && !record.consequence) {
    return `<button type="button" class="btn btn--utility" data-workspace-action="roll-begin-damage">Добавить последствие</button>
      <button type="button" class="btn btn--utility" data-workspace-action="done">Готово</button>`;
  }
  return `<button type="button" class="btn btn--utility" data-workspace-action="done">Готово</button>`;
}
