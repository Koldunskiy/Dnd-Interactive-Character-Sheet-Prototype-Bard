import { getDerivedStats } from "../calculations.js";
import { ABILITY_KEYS, ABILITY_LABELS_RU, SKILL_ID_META } from "../rules.js";

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
    const choices = draft.kind === "saving-throw"
      ? ABILITY_KEYS.map((ability) => [ability, ABILITY_LABELS_RU[ability]])
      : [
          ...ABILITY_KEYS.map((ability) => [ability, ABILITY_LABELS_RU[ability]]),
          ...Object.entries(SKILL_ID_META).map(([skill, meta]) => [skill, meta.label]),
        ];
    return `<label class="workspace-field">Тип броска
        <select data-workspace-field="kind" name="kind">
          <option value="ability-check" ${draft.kind !== "saving-throw" ? "selected" : ""}>Проверка</option>
          <option value="saving-throw" ${draft.kind === "saving-throw" ? "selected" : ""}>Спасбросок</option>
        </select>
      </label>
      ${select("id", "Характеристика или навык", choices)}
      ${select("rollMode", "Режим броска", [
        ["normal", "Обычный"], ["advantage", "Преимущество"], ["disadvantage", "Помеха"],
      ])}
      ${number("firstD20", "Физический первый к20", 1, 20)}
      <div data-workspace-second-d20 ${draft.rollMode === "normal" ? "hidden" : ""}>
        ${number("secondD20", "Физический второй к20 (преимущество/помеха)", 1, 20)}
      </div>
      ${number("dc", "Сложность (если известна)", 1, 99)}
      ${number("incomingDamage", "Входящий урон (если применимо)", 0)}
      ${select("consequenceProfile", "Последствие спасброска", [
        ["none", "Не применять урон"], ["failure-full", "Урон только при провале"],
        ["save-half", "Половина при успехе"],
      ])}
      ${check("spellSaveSource", "Спасбросок от заклинания · преимущество Юань-ти")}
      <label class="workspace-field">Причина преимущества
        <input data-workspace-field="advantageReason" name="advantageReason" value="${escapeHtml(draft.advantageReason ?? "")}">
      </label>
      <label class="workspace-field">Причина помехи
        <input data-workspace-field="disadvantageReason" name="disadvantageReason" value="${escapeHtml(draft.disadvantageReason ?? "")}">
      </label>
      <p>Фиксируйте источник каждого преимущества и помехи по решению ведущего. Бросок не тратит действие.</p>`;
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
      ? renderRollResult(session)
    : `<p role="status">${escapeHtml(session.resultMessage ?? "Результат записан.")}</p>
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
  const footer = session.currentStep === "command-input"
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

function renderRollResult(session) {
  const record = session.rollRecord;
  if (!record) return `<p class="workspace-error" role="alert">Запись броска не найдена в текущем состоянии.</p>`;
  const pending = record.consequence?.status === "pending";
  const awaitingOutcome = record.consequence?.status === "awaiting-outcome";
  return `<p role="status">${escapeHtml(session.resultMessage ?? "Результат броска записан.")}</p>
    ${record.dc == null ? "" : `<p>Сложность ${record.dc} · ${record.dcResult ? "успех" : record.dcResult === false ? "провал" : "исход не определён"}.</p>`}
    ${pending || awaitingOutcome ? `<form data-workspace-form="roll-followup" novalidate>
      ${awaitingOutcome ? `<label class="workspace-field">Результат спасброска
        <select data-workspace-field="outcome" name="outcome" required>
          <option value="">Выберите</option><option value="success">Успех</option><option value="failure">Провал</option>
        </select></label>` : ""}
      ${pending ? `<label class="workspace-field">Учет последствия
        <select data-workspace-field="resolution" name="resolution" required>
          <option value="">Выберите</option><option value="apply-to-character">Применить к персонажу</option>
          <option value="tracked-elsewhere">Урон учтён вне листа</option>
        </select></label>` : ""}
    </form>` : ""}
    ${record.kind === "ability-check" && record.skillId === "persuasion" &&
      !record.appliedAmendments?.some((entry) => entry.techniqueId === "ll-monk:mantle-of-courtesy")
      ? `<button type="button" class="btn btn--utility" data-workspace-action="roll-amend-mantle" ${session.appliedUnsaved ? "disabled" : ""}>Применить «Мантию учтивости» · 1 ци</button>` : ""}
    ${record.kind === "ability-check" && record.skillId === "athletics" &&
      !record.appliedAmendments?.some((entry) => entry.techniqueId === "ll-monk:indomitable-spirit")
      ? `<button type="button" class="btn btn--utility" data-workspace-action="roll-amend-spirit" ${session.appliedUnsaved ? "disabled" : ""}>Применить «Несокрушимый дух» · 1 ци</button>` : ""}
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
}

function renderRollFooter(session) {
  const pending = session.rollRecord?.consequence?.status === "pending";
  const awaitingOutcome = session.rollRecord?.consequence?.status === "awaiting-outcome";
  return `${pending || awaitingOutcome
    ? `<button type="button" class="btn btn--primary" data-workspace-action="submit-roll-followup" ${session.appliedUnsaved ? "disabled" : ""}>Записать последствие</button>`
    : ""}
    <button type="button" class="btn btn--utility" data-workspace-action="done">Готово</button>`;
}
