import { getDerivedStats } from "../calculations.js";
import {
  calculateWorkspaceAttackPreview,
  calculateWorkspaceDamagePreview,
} from "../workspace/attack-adapter.js";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function field(name, label, value, { type = "text", min = null, max = null, required = false } = {}) {
  return `<label class="workspace-field">${label}
    <input data-workspace-field="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"
      ${min == null ? "" : `min="${min}"`} ${max == null ? "" : `max="${max}"`}
      ${type === "number" ? 'step="1" inputmode="numeric"' : ""}
      ${required ? "required" : ""}>
  </label>`;
}

function currentInputs(session) {
  return session.rawInputsByStep[session.currentStepKey] ?? {};
}

function renderAttackForm(session, state) {
  const values = currentInputs(session);
  const actionUsed = !session.isExistingSequence && state.ui?.turn?.actionUsed === true;
  const preview = calculateWorkspaceAttackPreview(state, {
    ...values,
    rollMode: values.rollMode || "normal",
  });
  const profile = getDerivedStats(state).saraAttackProfiles.unarmed;
  const previewText = preview.ok
    ? `Выбранный к20: ${preview.chosenD20}; атака ${preview.attackBonusSnapshot >= 0 ? "+" : ""}${preview.attackBonusSnapshot}; итого ${preview.attackTotal}. ` +
      (preview.hitResult == null
        ? preview.naturalMiss ? "Естественная 1 — промах." :
          preview.critical ? "Естественная 20 — попадание и критический урон." :
            "Укажите КД или решение мастера."
        : `${preview.hitResult ? "Попадание" : "Промах"} · ${preview.hitResolutionSource === "known-ac" ? "по КД" : "решение мастера"}.`)
    : preview.reason;
  return `<form data-workspace-form="attack" novalidate>
    <p>Безоружная атака: ${profile.attackBonus >= 0 ? "+" : ""}${profile.attackBonus}; урон ${escapeHtml(profile.damageDice)} ${profile.damageModifier >= 0 ? "+" : ""}${profile.damageModifier}.</p>
    ${field("targetLabel", "Цель (необязательно)", values.targetLabel ?? "")}
    <label class="workspace-field">Режим броска
      <select data-workspace-field="rollMode" name="rollMode">
        <option value="normal" ${values.rollMode !== "advantage" && values.rollMode !== "disadvantage" ? "selected" : ""}>Обычный</option>
        <option value="advantage" ${values.rollMode === "advantage" ? "selected" : ""}>Преимущество</option>
        <option value="disadvantage" ${values.rollMode === "disadvantage" ? "selected" : ""}>Помеха</option>
      </select>
    </label>
    ${field("firstD20", "Физический результат первого к20", values.firstD20 ?? "", {
      type: "number", min: 1, max: 20, required: true,
    })}
    <div data-workspace-second-d20 ${values.rollMode === "advantage" || values.rollMode === "disadvantage" ? "" : "hidden"}>
      ${field("secondD20", "Физический результат второго к20", values.secondD20 ?? "", {
        type: "number", min: 1, max: 20,
        required: values.rollMode === "advantage" || values.rollMode === "disadvantage",
      })}
    </div>
    ${field("targetArmorClass", "КД цели (необязательно)", values.targetArmorClass ?? "", {
      type: "number", min: 1, max: 99,
    })}
    <label class="workspace-field">Решение мастера, если КД неизвестна
      <select data-workspace-field="dmHitResult" name="dmHitResult">
        <option value="" ${!values.dmHitResult ? "selected" : ""}>Не указано</option>
        <option value="hit" ${values.dmHitResult === "hit" ? "selected" : ""}>Попадание</option>
        <option value="miss" ${values.dmHitResult === "miss" ? "selected" : ""}>Промах</option>
      </select>
    </label>
    ${actionUsed ? `<label class="workspace-check"><input data-workspace-field="confirmSeparateAction" name="confirmSeparateAction" type="checkbox" ${values.confirmSeparateAction ? "checked" : ""}> Подтверждаю отдельное дополнительное действие или ручную корректировку</label>` : ""}
    <p class="workspace-preview" data-workspace-preview role="status">${escapeHtml(previewText)}</p>
    ${session.confirmationRequired ? `<p class="workspace-warning" role="alert">Расчёт или доступность изменились. Проверьте обновлённый результат и явно подтвердите его.</p>` : ""}
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
    ${session.readOnly && !session.error ? `<p class="workspace-warning">Эта запись доступна только для просмотра или восстановления уже ожидающего урона.</p>` : ""}
  </form>`;
}

function renderDamageForm(session, state) {
  const located = session.selectedDamage;
  const attack = located?.attack;
  if (!attack) return `<p class="workspace-error">Удар больше не ожидает записи урона.</p>`;
  const snapshot = attack.profileSnapshot;
  const dieSides = Number(String(snapshot?.damageDice ?? "").match(/d(\d+)/)?.[1]);
  const hasTrustedProfile = Number.isInteger(dieSides) && dieSides > 0 &&
    Number.isFinite(Number(snapshot?.damageModifier));
  const values = currentInputs(session);
  if (!hasTrustedProfile) {
    return `<p class="workspace-warning">Для этого старого попадания нет достоверного снимка профиля. Текущие характеристики не используются как исторический факт.</p>
      <button type="button" class="btn btn--utility" data-workspace-action="outside-damage">Урон учтён вне приложения</button>
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
  }
  const diceCount = attack.critical ? 2 : 1;
  return `<form data-workspace-form="damage" novalidate>
    <p>${escapeHtml(attack.optionalTargetLabel || "Цель не указана")} · к20 ${escapeHtml(attack.rawD20Rolls.join(" / "))} + ${escapeHtml(String(attack.attackBonusSnapshot))} = ${escapeHtml(String(attack.attackTotal))}</p>
    ${attack.techniqueApplicationId ? "<p>К этому удару уже применена техника; повторная оплата не выполняется.</p>" : ""}
    <p>Профиль удара: ${escapeHtml(snapshot.damageDice)} ${snapshot.damageModifier >= 0 ? "+" : ""}${escapeHtml(String(snapshot.damageModifier))}. ${attack.critical ? "Критическое попадание: две отдельные физические кости; постоянный модификатор учитывается один раз." : ""}</p>
    ${Array.from({ length: diceCount }, (_, index) => field(
      `damage${index + 1}`,
      `Физический результат к${dieSides} урона ${index + 1}`,
      values[`damage${index + 1}`] ?? "",
      { type: "number", min: 1, max: dieSides, required: true },
    )).join("")}
    <p class="workspace-preview" data-workspace-damage-preview role="status"></p>
    <p>Урон до сопротивлений и других поправок цели.</p>
    <button type="button" class="btn btn--utility" data-workspace-action="outside-damage">Урон учтён вне приложения</button>
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
  </form>`;
}

function renderAttackRecord(attack) {
  return `<article class="workspace-record">
    <h3>${attack.hitResult === "hit" ? "Попадание" : "Промах"}${attack.critical ? " · критическое попадание" : ""}</h3>
    <p>${escapeHtml(attack.optionalTargetLabel || "Цель не указана")} · к20 ${escapeHtml(attack.rawD20Rolls.join(" / "))} + ${escapeHtml(String(attack.attackBonusSnapshot))} = ${escapeHtml(String(attack.attackTotal))}</p>
    ${attack.damageStatus === "awaiting-damage" ? "<p>Ожидает записи урона.</p>" : ""}
    ${attack.damageStatus === "recorded-outside-app" ? "<p>Урон учтён вне приложения.</p>" : ""}
    ${attack.damageTotalBeforeTargetModifiers != null
      ? `<p>Урон: ${escapeHtml(String(attack.damageTotalBeforeTargetModifiers))} до поправок цели.</p>` : ""}
    ${attack.techniqueApplicationId ? "<p>Техника к этому попаданию уже применена.</p>" : ""}
  </article>`;
}

export function renderAttackWorkspace(session, state) {
  const derived = getDerivedStats(state);
  const sequence = session.sequenceId
    ? (state.monk?.combatAssistant?.activeSequences ?? []).find((entry) =>
      entry.id === session.sequenceId && entry.kind === "attack-action")
    : null;
  const heading = session.currentStep === "attack-input" ? "Действие «Атака»"
    : session.currentStep === "damage-input" ? "Записать урон"
      : session.currentStep === "confirm-close" ? "Закрыть рабочую панель"
        : session.currentStep === "summary" ? "Итог действия «Атака»" : "Продолжение атаки";
  const header = `<div class="workspace-nav">
      <button type="button" class="btn btn--utility" data-workspace-action="back">Назад</button>
      <button type="button" class="btn btn--utility" data-workspace-action="minimize">Свернуть</button>
      <button type="button" class="btn btn--utility" data-workspace-action="close">Закрыть</button>
    </div>
    <div><h2 id="workspaceDialogTitle" tabindex="-1" data-workspace-title>${heading}</h2><p>${escapeHtml(session.stepLabel)}</p></div>
    <div class="workspace-resources">
      <span>HP <b data-workspace-hp>${state.combat?.hp?.current ?? "—"}/${derived.maxHitPoints}</b></span>
      <span>Ци <b data-workspace-ki>${state.combat?.ki?.current ?? "—"}</b></span>
    </div>`;
  let body = "";
  let footer = "";
  if (session.currentStep === "attack-input") {
    body = renderAttackForm(session, state);
    footer = `<button type="button" class="btn btn--primary" data-workspace-action="submit-attack" ${session.submitting || session.appliedUnsaved || session.readOnly ? "disabled" : ""}>${session.confirmationRequired ? "Подтвердить расчёт и записать" : "Записать физический бросок"}</button>`;
  } else if (session.currentStep === "damage-input") {
    body = renderDamageForm(session, state);
    footer = `<button type="button" class="btn btn--primary" data-workspace-action="submit-damage" ${session.submitting || session.appliedUnsaved || !session.selectedDamage?.attack?.profileSnapshot ? "disabled" : ""}>Записать урон</button>`;
  } else if (session.currentStep === "confirm-close") {
    const abandonment = sequence?.status === "open" && sequence.resolvedAttacks.length < sequence.maximumAttacks;
    body = `<p>${abandonment
      ? "Оставшиеся удары будут закрыты. Уже записанные удары, расходы и ожидающие результаты сохранятся."
      : session.dirty ? "Есть незавершённый ввод." : "Закрыть только эту рабочую панель?"}</p>
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
    footer = `<button type="button" class="btn btn--utility" data-workspace-action="stay">Остаться</button>
      <button type="button" class="btn btn--primary" data-workspace-action="confirm-close">${abandonment ? "Закрыть оставшиеся удары" : "Закрыть без применения"}</button>`;
  } else {
    const attacks = sequence?.resolvedAttacks ?? [];
    body = `${attacks.map(renderAttackRecord).join("")}
      ${session.currentStep === "checkpoint" && sequence?.status === "open"
        ? `<p>Запись удара завершена. Следующий удар использует новый ввод физических костей.</p>
          <p>Техники пока доступны в существующей части вкладки «Бой». Сверните панель, чтобы применить их.</p>`
        : ""}
      ${sequence?.status === "abandoned" ? "<p>Последовательность закрыта; новые удары не добавляются.</p>" : ""}
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
    if (session.currentStep === "checkpoint" && sequence?.status === "open" &&
        sequence.resolvedAttacks.length < sequence.maximumAttacks) {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="next-attack">Следующий удар · ${sequence.resolvedAttacks.length + 1} из ${sequence.maximumAttacks}</button>
        <button type="button" class="btn btn--utility" data-workspace-action="summary">Завершить ввод атак</button>`;
    } else {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="summary">К итогам</button>`;
    }
  }
  const appliedUnsaved = session.appliedUnsaved
    ? `<p class="workspace-error" role="alert">Изменение применено в памяти, но не сохранено.</p>
      <button type="button" class="btn btn--utility" data-workspace-action="retry-save">Повторить сохранение</button>` : "";
  return {
    header,
    body,
    footer: `${footer}${appliedUnsaved}`,
  };
}

export function renderWorkspaceAttackPreview(session, state) {
  const node = document.querySelector("#actionWorkspaceRoot [data-workspace-preview]");
  if (!node) return;
  const inputs = session.rawInputsByStep[session.currentStepKey] ?? {};
  const preview = calculateWorkspaceAttackPreview(state, {
    ...inputs,
    rollMode: inputs.rollMode || "normal",
  });
  if (!preview.ok) {
    node.textContent = preview.reason;
    return;
  }
  const outcome = preview.hitResult == null
    ? preview.naturalMiss ? "Естественная 1 — промах."
      : preview.critical ? "Естественная 20 — попадание; урон критический."
        : "Укажите КД или решение мастера."
    : `${preview.hitResult ? "Попадание" : "Промах"} · ${preview.hitResolutionSource === "known-ac" ? "по КД" : "решение мастера"}.`;
  node.textContent = `Выбранный к20 ${preview.chosenD20} + ${preview.attackBonusSnapshot} = ${preview.attackTotal}. ${outcome}`;
}

export function renderWorkspaceDamagePreview(session) {
  const node = document.querySelector("#actionWorkspaceRoot [data-workspace-damage-preview]");
  const attack = session.selectedDamage?.attack;
  if (!node || !attack?.profileSnapshot) return;
  const values = session.rawInputsByStep[session.currentStepKey] ?? {};
  const rolls = Array.from({ length: attack.critical ? 2 : 1 }, (_, index) =>
    values[`damage${index + 1}`] ?? "");
  const calculated = calculateWorkspaceDamagePreview(
    attack.profileSnapshot,
    rolls,
    attack.critical,
  );
  node.textContent = calculated.ok
    ? `Итого: ${calculated.damageRolls.join(" + ")} + ${calculated.damageModifierSnapshot} = ${calculated.damageTotalBeforeTargetModifiers}.`
    : calculated.reason;
}
