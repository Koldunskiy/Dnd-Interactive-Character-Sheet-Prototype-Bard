import { getDerivedStats } from "../calculations.js";
import {
  calculateWorkspaceAttackPreview,
  calculateWorkspaceDamagePreview,
  buildWorkspaceSeekingParentBasis,
  previewWorkspaceCompletedSeekingStrike,
  getCurrentWorkspaceStrikeParent,
  getSaraAttackCount,
  previewWorkspaceCompletedGentlingTouch,
} from "../workspace/attack-adapter.js";
import { gentlingPreview } from "../sara-functional.js";
import { MONK_TECHNIQUES, MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { getWorkspaceHost } from "../workspace/host.js";
import { getEligibleAttackProfiles } from "../combat/attack-profile-eligibility.js";
import { getUsedAttackSlots } from "../actions/sara-combat.js";
import { pendingSeeking, readSeekingHistory } from "../combat/seeking-history.js";

const STRIKE_SAVE_ABILITIES = Object.freeze({
  "ll-monk:empowered-strike": "Сила",
  "ll-monk:stunning-strike": "Телосложение",
  "ll-monk:crippling-strike": "Телосложение",
  "ll-monk:slowing-strike": "Мудрость",
});

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

function formatSigned(value) {
  const amount = Number(value);
  return amount < 0 ? `− ${Math.abs(amount)}` : `+ ${amount}`;
}

function strikeChoices(state, attack = null) {
  const effective = getEffectiveSelectedTechniqueIds(state);
  return MONK_TECHNIQUES.filter((entry) => entry.eligibleStrike && effective.has(entry.id) &&
    ["ll-monk:empowered-strike", "ll-monk:stunning-strike",
      "ll-monk:crippling-strike", "ll-monk:slowing-strike"].includes(entry.id) &&
    (!attack || entry.unarmedOnly !== true || attack.profileId === "unarmed"));
}

function techniqueUnavailableReason(state, sequence, attack, technique, paymentMode = "ki") {
  const runtime = state.monk?.techniqueRuntime ?? {};
  if (technique.limit === "once-per-turn" && runtime[technique.id]?.usedThisTurn) {
    return "Уже применена в этом ходу.";
  }
  if (technique.limit === "once-per-short-or-long-rest" &&
      runtime[technique.id]?.usedUntilRest) return "Уже применена после отдыха.";
  if (paymentMode !== "practiced" &&
      Number(state.combat?.ki?.current) < Number(technique.payment.match(/\d+/)?.[0] ?? 0)) {
    return "Недостаточно ци.";
  }
  if (paymentMode === "practiced" && !technique.practicedStrikesEligible) {
    return "Эта техника не подходит для Practiced.";
  }
  if (paymentMode === "practiced" &&
      (["reaction-unarmed", "returned-projectile"].includes(sequence.kind) ||
       state.battleConsole?.current && state.battleConsole.current.phase !== "own-turn")) {
    return "Practiced доступен только в свой ход.";
  }
  if (technique.unarmedOnly && attack.profileId !== "unarmed") {
    return "Требуется безоружное попадание.";
  }
  if (attack.profileId !== "unarmed" &&
      !(attack.profileSnapshot?.attackKind === "weapon" &&
        attack.profileSnapshot?.melee === true &&
        attack.profileSnapshot?.martialArtsEligible === true)) {
    return "Требуется попадание безоружной атакой или подходящим melee Martial Arts оружием.";
  }
  if (paymentMode === "practiced" && technique.practicedStrikesEligible) {
    if (Number(state.combat?.practiced?.current) < 1) return "Нет применений Practiced.";
    if (runtime.practicedUsedThisTurn) return "Practiced уже использован в этом ходу.";
  }
  return "";
}

function renderAttackForm(session, state) {
  const values = currentInputs(session);
  const sequence = (state.monk?.combatAssistant?.activeSequences ?? [])
    .find((entry) => entry.id === session.sequenceId);
  const actionUsed = state.ui?.turn?.actionUsed === true &&
    (!session.isExistingSequence || sequence?.actionFlagApplied !== true);
  const allProfiles = getDerivedStats(state).saraAttackProfiles;
  const profiles = Object.fromEntries(getEligibleAttackProfiles(
    session.sequenceKind ?? "attack-action", allProfiles, state,
  ));
  const profileId = values.profileId ?? "unarmed";
  const profile = profiles[profileId] ?? profiles.unarmed;
  const preview = calculateWorkspaceAttackPreview(state, {
    profileId,
    rollMode: values.rollMode || "normal",
    firstD20: values.firstD20 ?? "",
    secondD20: values.secondD20 ?? "",
  });
  const attackNumber = getUsedAttackSlots(sequence) + 1;
  const maximumAttacks = sequence?.maximumAttacks ?? getSaraAttackCount(state);
  const hasNaturalException = session.naturalExceptionOutcome === "hit" ||
    session.naturalExceptionOutcome === "miss";
  const naturalExceptionText = preview.ok && preview.naturalMiss &&
      session.naturalExceptionOutcome === "hit"
    ? "По обычному правилу это натуральная 1 и промах. Подтвердите, что мастер назначил исключение."
    : preview.ok && preview.critical && session.naturalExceptionOutcome === "miss"
      ? "По обычному правилу это натуральная 20 и попадание. Подтвердите, что мастер назначил исключение."
      : "";
  return `<form data-workspace-form="attack" novalidate>
    ${Object.keys(profiles).length > 1 ? `<label class="workspace-field">Профиль атаки
      <select data-workspace-field="profileId" name="profileId">
        ${Object.entries(profiles).map(([id, entry]) => `<option value="${escapeHtml(id)}"
          ${id === profileId ? "selected" : ""}>${escapeHtml(id === "unarmed" ? "Безоружная атака" : entry.name ?? id)}</option>`).join("")}
      </select>
    </label>` : ""}
    <fieldset class="workspace-roll-mode">
      <legend>Режим броска</legend>
      <div role="group" aria-label="Режим броска">
        ${[
          ["normal", "Обычно"],
          ["advantage", "Преимущество"],
          ["disadvantage", "Помеха"],
        ].map(([mode, label]) => `<button type="button" class="workspace-roll-mode__option"
          data-workspace-action="attack-mode-${mode}" aria-pressed="${(values.rollMode || "normal") === mode}">${label}</button>`).join("")}
      </div>
    </fieldset>
    <div class="workspace-entry-core">
      <div class="workspace-entry-fields ${values.rollMode === "advantage" || values.rollMode === "disadvantage" ? "workspace-entry-fields--pair" : ""}">
      ${field("firstD20", "К20", values.firstD20 ?? "", {
        type: "number", min: 1, max: 20, required: true,
      })}
      <div data-workspace-second-d20 ${values.rollMode === "advantage" || values.rollMode === "disadvantage" ? "" : "hidden"}>
        ${field("secondD20", "Второй физический к20", values.secondD20 ?? "", {
          type: "number", min: 1, max: 20,
          required: values.rollMode === "advantage" || values.rollMode === "disadvantage",
        })}
      </div>
      </div>
      <section class="workspace-entry-result workspace-attack-result" aria-label="Итог атаки">
      <span class="workspace-attack-result__label">Итог</span>
      <output class="workspace-attack-result__total" data-attack-total aria-live="polite">—</output>
      <span class="workspace-attack-result__formula" data-attack-formula></span>
      <p class="workspace-attack-result__status" data-attack-status role="status"></p>
      </section>
    </div>
    <div class="workspace-entry-validation"><p class="workspace-input-message" data-attack-validation role="status"></p>
    ${actionUsed ? `<label class="workspace-check"><input data-workspace-field="confirmSeparateAction" name="confirmSeparateAction" type="checkbox" ${values.confirmSeparateAction ? "checked" : ""}> Подтверждаю отдельное дополнительное действие или ручную корректировку</label>` : ""}
    ${hasNaturalException ? `<div class="workspace-natural-exception" data-natural-exception>
      <p>${naturalExceptionText}</p>
      <label class="workspace-check"><input data-workspace-field="dmExceptionConfirmed" name="dmExceptionConfirmed" type="checkbox" ${values.dmExceptionConfirmed ? "checked" : ""}>
        Подтверждаю исключение, назначенное мастером</label>
    </div>` : ""}
    ${session.confirmationRequired ? `<p class="workspace-warning" role="alert">Расчёт или доступность изменились. Проверьте обновлённый результат и явно подтвердите его.</p>` : ""}
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
    ${session.readOnly && !session.error ? `<p class="workspace-warning">Эта запись доступна только для просмотра или восстановления уже ожидающего урона.</p>` : ""}
    </div>
    <details class="workspace-entry-details"><summary>Расчёт и параметры</summary>
      <p>${escapeHtml(profile.name ?? (profileId === "unarmed" ? "Безоружная атака" : profileId))}
        ${formatSigned(profile.attackBonus)} · урон ${escapeHtml(profile.damageDice)} ${formatSigned(profile.damageModifier)}.</p>
    </details>
  </form>`;
}

function renderDamageForm(session, state) {
  const located = session.selectedDamage;
  const attack = located?.attack;
  if (!attack) return `<p class="workspace-error">Удар больше не ожидает записи урона.</p>`;
  const snapshot = attack.profileSnapshot;
  const values = currentInputs(session);
  const dieSides = Number(String(snapshot?.damageDice ?? "").match(/d(\d+)/)?.[1]);
  const hasTrustedProfile = Number.isInteger(dieSides) && dieSides > 0 &&
    Number.isFinite(Number(snapshot?.damageModifier));
  if (!hasTrustedProfile) {
    return `<p class="workspace-warning">Для этого старого попадания нет достоверного снимка профиля. Текущие характеристики не используются как исторический факт.</p>
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
  }
  const diceCount = attack.critical && attack.hitResult === "hit" ? 2 : 1;
  return `<form data-workspace-form="damage" novalidate>
    ${session.pendingSeekingIntent ? "<p>1 ци списывается только при записи замены вместе с уроном, не при открытии этой формы.</p>" : ""}
    <p class="workspace-damage-origin">Попадание: ${recordedAttackFormula(attack)}</p>
    <section class="workspace-entry-options" aria-label="Кости урона">
      <span>${escapeHtml(snapshot.damageDice)} ${formatSigned(snapshot.damageModifier)}${attack.critical ? " · критическое попадание: две отдельные кости" : ""}</span>
    </section>
    <div class="workspace-entry-core">
      <div class="workspace-entry-fields ${diceCount > 1 ? "workspace-entry-fields--pair" : ""}">
    ${Array.from({ length: diceCount }, (_, index) => field(
      `damage${index + 1}`,
      `Физический результат к${dieSides} урона ${index + 1}`,
      values[`damage${index + 1}`] ?? "",
      { type: "number", min: 1, max: dieSides, required: true },
    )).join("")}
      </div>
      <section class="workspace-entry-result workspace-damage-result" aria-label="Итог физического урона">
      <span class="workspace-attack-result__label">Урон · итог</span>
      <output class="workspace-damage-result__total" data-damage-total aria-live="polite">—</output>
      <span class="workspace-attack-result__formula" data-damage-formula></span>
      <p class="workspace-attack-result__status" data-workspace-damage-preview role="status"></p>
      </section>
    </div>
    <div class="workspace-entry-validation">
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
    </div>
    <details class="workspace-entry-details"><summary>Профиль и поправки цели</summary>
      <p class="workspace-confirmed-hit">Попадание подтверждено · удар ${attackNumber(state, session)}</p>
      ${attack.techniqueApplicationId ? "<p>К этому удару уже применена техника; повторная оплата не выполняется.</p>" : ""}
      <p>Профиль удара: ${escapeHtml(snapshot.damageDice)} ${formatSigned(snapshot.damageModifier)}. ${attack.critical ? "Критическое попадание: постоянный модификатор учитывается один раз." : ""}</p>
      <p>Урон до сопротивлений и других поправок цели.</p>
    </details>
  </form>`;
}

function renderSeekingForm(session) {
  const values = currentInputs(session);
  const mode = values.rollMode ?? session.seekingOriginalRollMode ??
    session.selectedDamage?.attack?.rollMode ?? "normal";
  return `<form data-workspace-form="seeking">
    <label class="workspace-field">Режим броска
      <select data-workspace-field="rollMode" name="rollMode" required>
        <option value="normal" ${mode === "normal" ? "selected" : ""}>Обычный</option>
        <option value="advantage" ${mode === "advantage" ? "selected" : ""}>Преимущество</option>
        <option value="disadvantage" ${mode === "disadvantage" ? "selected" : ""}>Помеха</option>
      </select>
    </label>
    ${field("firstD20", "Новый физический к20", values.firstD20 ?? "", {
      type: "number", min: 1, max: 20, required: true,
    })}
    ${mode === "normal" ? "" : field("secondD20", "Второй физический к20", values.secondD20 ?? "", {
      type: "number", min: 1, max: 20, required: true,
    })}
    ${field("targetArmorClass", "КД цели (необязательно)", values.targetArmorClass ?? "", {
      type: "number", min: 1, max: 99,
    })}
    <label class="workspace-field">Ручной исход без известной КД
      <select data-workspace-field="dmHitResult" name="dmHitResult">
        <option value="" ${!values.dmHitResult ? "selected" : ""}>Не указан</option>
        <option value="hit" ${values.dmHitResult === "hit" ? "selected" : ""}>Попадание</option>
        <option value="miss" ${values.dmHitResult === "miss" ? "selected" : ""}>Промах</option>
      </select>
    </label>
    <label class="workspace-check"><input data-workspace-field="dmExceptionConfirmed"
      name="dmExceptionConfirmed" type="checkbox" ${values.dmExceptionConfirmed ? "checked" : ""}>
      Подтверждаю исключение ведущего для натурального результата</label>
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
  </form>`;
}

function renderGentlingForm(session, state) {
  const projection = getWorkspaceGentlingProjection(session, state);
  const values = currentInputs(session);
  const preview = projection.completedPreview;
  const result = preview?.ok ? preview.result : null;
  const mechanics = projection.mechanics;
  const outcome = result
    ? result.thresholdMet
      ? `Порог достигнут: ${result.sum} ≥ ${result.targetHp}.`
      : `Порог не достигнут: ${result.sum} < ${result.targetHp}. При записи будут потрачены ${result.cost} ци и один слот Attack.`
    : preview?.reason ?? "Укажите HP цели и физическую сумму.";
  return `<form data-workspace-form="gentling">
    <h3>Gentling Touch · слот ${session.gentlingIntent?.slotNumber ?? 1}/${projection.maximumAttacks}</h3>
    <p>Замена одного свободного слота действия Attack. Ки и слот расходуются только при записи результата.</p>
    ${field("extraKi", "Дополнительная ци", values.extraKi ?? "0", {
      type: "number", min: 0, max: projection.maximumExtraKi, required: true,
    })}
    ${field("targetHp", "Текущие HP цели", values.targetHp ?? "", {
      type: "number", min: 0, required: true,
    })}
    ${field("sum", "Физическая сумма костей Боевых искусств", values.sum ?? "", {
      type: "number", min: mechanics?.dice ?? 5,
      max: mechanics ? mechanics.dice * mechanics.sides : null, required: true,
    })}
    <p data-gentling-mechanics>${mechanics
      ? `Бросьте: ${mechanics.dice}d${mechanics.sides} · допустимая сумма ${mechanics.dice}..${mechanics.dice * mechanics.sides} · стоимость ${mechanics.cost} ци.`
      : "Дополнительная ци должна быть целым числом в пределах Wisdom."}</p>
    <p data-gentling-preview role="status">${escapeHtml(outcome)}</p>
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
  </form>`;
}

export function getWorkspaceGentlingProjection(session, state) {
  const values = currentInputs(session);
  const derived = getDerivedStats(state);
  const maximumExtraKi = Math.max(0, derived.abilityModifiers.wisdom);
  const extra = Number(String(values.extraKi ?? "0").trim());
  const validExtra = Number.isSafeInteger(extra) && extra >= 0 &&
    extra <= Math.max(0, derived.abilityModifiers.wisdom);
  let mechanics = null;
  if (validExtra) {
    try {
      mechanics = gentlingPreview({
        extraKi: extra,
        targetHp: 0,
        sum: 5 + extra,
        martialDieSides: derived.monk.martialDieSides,
        wisdomModifier: derived.abilityModifiers.wisdom,
      });
    } catch {
      mechanics = null;
    }
  }
  if (!mechanics) {
    try {
      mechanics = gentlingPreview({
        extraKi: 0,
        targetHp: 0,
        sum: 5,
        martialDieSides: derived.monk.martialDieSides,
        wisdomModifier: derived.abilityModifiers.wisdom,
      });
    } catch {
      mechanics = null;
    }
  }
  const intent = session.gentlingIntent;
  const completedPreview = intent
    ? previewWorkspaceCompletedGentlingTouch(state, {
      sequenceId: intent.sequenceId,
      sequenceKind: "attack-action",
      battleId: intent.battleId,
      phaseAtOpen: intent.phaseAtOpen,
      ownTurnId: intent.ownTurnId,
      turnMarker: intent.turnMarker,
      expectedSequenceExists: intent.expectedSequenceExists,
      expectedUsedSlots: intent.expectedUsedSlots,
      expectedMechanicsBasis: intent.expectedMechanicsBasis,
      confirmSeparateAction: intent.confirmSeparateAction,
      extraKi: values.extraKi ?? "",
      targetHp: values.targetHp ?? "",
      sum: values.sum ?? "",
    })
    : null;
  const sequence = state.monk?.combatAssistant?.activeSequences?.find((entry) =>
    entry.id === intent?.sequenceId);
  return {
    maximumExtraKi,
    maximumAttacks: sequence?.maximumAttacks ?? getSaraAttackCount(state),
    mechanics,
    completedPreview,
  };
}

export function updateWorkspaceGentlingProjection(session, state) {
  const projection = getWorkspaceGentlingProjection(session, state);
  const root = getWorkspaceHost();
  const setConstraint = (name, value, attribute) => {
    const input = root?.querySelector(`[data-workspace-field][name="${name}"]`);
    if (!input) return;
    if (value == null) {
      input.removeAttribute?.(attribute);
      if (attribute === "max") input.max = "";
    } else {
      input.setAttribute?.(attribute, String(value));
      input[attribute] = String(value);
    }
  };
  setConstraint("extraKi", 0, "min");
  setConstraint("extraKi", projection.maximumExtraKi, "max");
  setConstraint("targetHp", 0, "min");
  setConstraint("targetHp", null, "max");
  setConstraint("sum", projection.mechanics?.dice ?? 5, "min");
  setConstraint("sum", projection.mechanics
    ? projection.mechanics.dice * projection.mechanics.sides : null, "max");
  const mechanicsNode = root?.querySelector("[data-gentling-mechanics]");
  if (mechanicsNode) mechanicsNode.textContent = projection.mechanics
    ? `Бросьте: ${projection.mechanics.dice}d${projection.mechanics.sides} · допустимая сумма ${projection.mechanics.dice}..${projection.mechanics.dice * projection.mechanics.sides} · стоимость ${projection.mechanics.cost} ци.`
    : "Дополнительная ци должна быть целым числом в пределах Wisdom.";
  const completed = projection.completedPreview;
  const previewNode = root?.querySelector("[data-gentling-preview]");
  if (previewNode) {
    previewNode.textContent = completed?.ok
      ? completed.result.thresholdMet
        ? `Порог достигнут: ${completed.result.sum} ≥ ${completed.result.targetHp}.`
        : `Порог не достигнут: ${completed.result.sum} < ${completed.result.targetHp}. При записи будут потрачены ${completed.result.cost} ци и один слот Attack.`
      : completed?.reason ?? "Укажите HP цели и физическую сумму.";
  }
  return renderAttackWorkspace(session, state).footer;
}

function attackNumber(state, session) {
  const sequence = (state.monk?.combatAssistant?.activeSequences ?? [])
    .find((entry) => entry.id === session.sequenceId);
  const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === session.attackId);
  return attack?.slotNumber ??
    (sequence?.resolvedAttacks?.findIndex((entry) => entry.id === session.attackId) ?? -1) + 1;
}

function recordedAttackFormula(attack) {
  const rolls = Array.isArray(attack.rawD20Rolls) ? attack.rawD20Rolls : [];
  if (!rolls.length || !Number.isFinite(Number(attack.attackTotal)) ||
      !Number.isFinite(Number(attack.attackBonusSnapshot))) {
    return "Записанный итог атаки недоступен.";
  }
  return `к20 ${escapeHtml(rolls.join(" / "))} ${formatSigned(attack.attackBonusSnapshot)} = ${escapeHtml(String(attack.attackTotal))}`;
}

function renderStrikeForm(session, state) {
  const parent = getCurrentWorkspaceStrikeParent(
    state, session.strikeParent?.sequenceId, session.strikeParent?.attackId,
  );
  if (!parent) {
    return `<p class="workspace-warning">Для этой записи нельзя применить новую технику: попадание больше не является текущим или техника уже применена.</p>`;
  }
  const values = currentInputs(session);
  const choices = strikeChoices(state, parent.attack);
  if (!choices.length) {
    return `<p class="workspace-warning">Нет выбранных и доступных техник для этого попадания.</p>`;
  }
  const selected = choices.find((entry) => entry.id === values.techniqueId);
  const unavailable = selected
    ? techniqueUnavailableReason(state, parent.sequence, parent.attack, selected, values.paymentMode || "ki") : "";
  const dc = getDerivedStats(state).monk.techniqueSaveDc;
  const ability = STRIKE_SAVE_ABILITIES[selected?.id] ?? "";
  const payment = selected?.payment?.replaceAll("Ki", "ци") ?? "";
  const battle = state.battleConsole?.current;
  const practicedAllowed = Boolean(selected?.practicedStrikesEligible &&
    (!battle || battle.phase === "own-turn"));
  const practicedUnavailable = selected
    ? techniqueUnavailableReason(state, parent.sequence, parent.attack, selected, "practiced")
    : "";
  return `<form data-workspace-form="strike" novalidate>
    <p>После записанного урона · необязательная техника · без нового действия.</p>
    <label class="workspace-field">Выберите технику
      <select data-workspace-field="techniqueId" name="techniqueId" required>
        <option value="">Без выбора</option>
        ${choices.map((entry) => `<option value="${escapeHtml(entry.id)}" ${values.techniqueId === entry.id ? "selected" : ""}>${escapeHtml(entry.nameRu)} · ${STRIKE_SAVE_ABILITIES[entry.id]} · СЛ ${dc} · ${escapeHtml(entry.payment.replaceAll("Ki", "ци"))}</option>`).join("")}
      </select>
    </label>
    ${selected ? `<p>${escapeHtml(selected.nameRu)} · ${escapeHtml(payment)}${ability ? ` · спасбросок ${ability}, СЛ ${dc}` : ""}</p>
      ${selected.description ? `<p>${escapeHtml(selected.description)}</p>` : ""}
      ${unavailable ? `<p class="workspace-warning">${escapeHtml(unavailable)}</p>` : ""}
      <label class="workspace-field">Оплата
        <select data-workspace-field="paymentMode" name="paymentMode">
          <option value="ki" ${values.paymentMode !== "practiced" ? "selected" : ""}>Ци · ${escapeHtml(payment)}</option>
          ${selected.practicedStrikesEligible ? `<option value="practiced" ${values.paymentMode === "practiced" ? "selected" : ""} ${!practicedAllowed || practicedUnavailable ? "disabled" : ""}>Practiced · 0 ци${practicedUnavailable ? ` · ${escapeHtml(practicedUnavailable)}` : ""}</option>` : ""}
        </select>
      </label>
      ${selected.id === "ll-monk:crippling-strike" ? `<label class="workspace-field">Эффект «Калечащего удара»
        <select data-workspace-field="effect" name="effect" required>
          <option value="">Выберите эффект</option>
          <option value="blinded" ${values.effect === "blinded" ? "selected" : ""}>Ослепление</option>
          <option value="deafened" ${values.effect === "deafened" ? "selected" : ""}>Глухота</option>
          <option value="unable-to-speak" ${values.effect === "unable-to-speak" ? "selected" : ""}>Невозможность говорить</option>
        </select>
      </label>` : ""}
      ${values.paymentMode === "practiced" ? `<label class="workspace-check"><input data-workspace-field="practicedConditions"
        name="practicedConditions" type="checkbox" ${values.practicedConditions ? "checked" : ""}>
        Подтверждаю свой ход и безоружное попадание для Practiced</label>` : ""}` : ""}
    ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}
  </form>`;
}

function canApplyStrike(session, state) {
  const parent = getCurrentWorkspaceStrikeParent(
    state, session.strikeParent?.sequenceId, session.strikeParent?.attackId,
  );
  const values = currentInputs(session);
  const technique = MONK_TECHNIQUE_BY_ID.get(values.techniqueId);
  if (!parent || !technique ||
      !getEffectiveSelectedTechniqueIds(state).has(technique.id) ||
      techniqueUnavailableReason(state, parent.sequence, parent.attack, technique, values.paymentMode || "ki")) {
    return false;
  }
  if (technique.id === "ll-monk:crippling-strike" &&
      !["blinded", "deafened", "unable-to-speak"].includes(values.effect)) return false;
  return values.paymentMode !== "practiced" || values.practicedConditions === true;
}

function renderAttackRecord(attack, state, attackIndex, maximumAttacks) {
  const application = (state.monk?.combatAssistant?.pendingApplications ?? [])
    .find((entry) => entry.id === attack.techniqueApplicationId);
  return `<article class="workspace-record">
    <h3>Удар ${attack.slotNumber ?? attackIndex + 1}/${maximumAttacks} · ${attack.hitResult === "hit" ? "попадание" : "промах"}${attack.critical && attack.hitResult === "hit" ? " · критическое" : ""}</h3>
    ${attack.optionalTargetLabel ? `<p>${escapeHtml(attack.optionalTargetLabel)}</p>` : ""}
    <p>${recordedAttackFormula(attack)}</p>
    ${attack.damageStatus === "awaiting-damage" ? "<p>Ожидает записи урона.</p>" : ""}
    ${attack.damageStatus === "recorded-outside-app" ? "<p>Урон учтён вне приложения.</p>" : ""}
    ${attack.damageTotalBeforeTargetModifiers != null
      ? `<p>Урон записан: ${escapeHtml(String(attack.damageTotalBeforeTargetModifiers))} до поправок цели.</p>` : ""}
    ${application ? `<p>Техника применена · ${application.paymentAmount} ${application.paymentKind === "practiced" ? "заряд Practiced" : "ци потрачено"} · ${application.targetOutcome === "unknown" ? "результат мастера ожидается" : "результат записан"}.</p>` : ""}
  </article>`;
}

export function renderAttackWorkspace(session, state) {
  const derived = getDerivedStats(state);
  const sequence = session.sequenceId
    ? (state.monk?.combatAssistant?.activeSequences ?? []).find((entry) =>
      entry.id === session.sequenceId)
    : null;
  const commandTitle = session.command?.titleRu ?? "Действие «Атака»";
  const attackCount = sequence?.maximumAttacks ?? getSaraAttackCount(state, session.sequenceKind);
  const currentAttackNumber = session.currentStep === "attack-input"
    ? getUsedAttackSlots(sequence) + 1
    : attackNumber(state, session);
  const activeProfileId = session.rawInputsByStep?.[session.currentStepKey]?.profileId ?? "unarmed";
  const activeProfileName = derived.saraAttackProfiles?.[activeProfileId]?.name ??
    (activeProfileId === "unarmed" ? "безоружный" : activeProfileId);
  const heading = session.workspaceType === "attack" && session.currentStep === "attack-input"
    ? `Удар ${currentAttackNumber}/${attackCount} · ${activeProfileName}`
    : session.workspaceType === "attack" && session.currentStep === "damage-input"
      ? `Урон · удар ${currentAttackNumber}/${attackCount}`
    : session.currentStep === "attack-input" ? commandTitle
    : session.currentStep === "damage-input" ? "Записать урон"
      : session.currentStep === "seeking-input" ? "Seeking Strike · новый физический результат"
        : session.currentStep === "gentling-input" ? "Gentling Touch · занять слот"
      : session.currentStep === "strike-input" ? "Необязательная техника"
      : session.currentStep === "confirm-close" ? "Закрыть рабочую панель"
        : session.currentStep === "summary" ? `Итог: ${commandTitle}` : "Продолжение атаки";
  const header = session.workspaceType === "attack"
    ? `<div class="workspace-task-heading"><h2 id="workspaceDialogTitle" tabindex="-1"
        data-workspace-title>${escapeHtml(heading)}</h2>
        ${(session.pendingAttackIntent || session.pendingSeekingIntent) &&
          session.currentStep === "damage-input" &&
          !session.readOnly && !session.submitting && !session.appliedUnsaved
          ? `<button type="button" class="btn btn--utility" data-workspace-action="back">Назад</button>`
          : ""}
        </div>`
    : `<div class="workspace-nav">
      <button type="button" class="btn btn--utility" data-workspace-action="back">Назад</button>
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
    const disabled = session.submitting || session.appliedUnsaved || session.readOnly;
    footer = `<div class="workspace-task-actions workspace-task-actions--split">
      <button type="button" class="primary" data-workspace-action="attack-hit" data-workspace-attack-id="${escapeHtml(session.attackId)}" ${disabled ? "disabled" : ""}>${session.confirmationRequired ? "Проверить и подтвердить: попадание" : "Попадание"}</button>
      <button type="button" data-workspace-action="attack-miss" data-workspace-attack-id="${escapeHtml(session.attackId)}" ${disabled ? "disabled" : ""}>${session.confirmationRequired ? "Проверить и подтвердить: промах" : "Промах"}</button>
    </div>`;
    if (["attack-action", "flurry", "bonus-unarmed"].includes(session.sequenceKind) &&
        !session.readOnly && !session.submitting && !session.appliedUnsaved &&
        !session.historicalOnly && !session.selectedDamage) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="cancel-attack-draft">Отмена текущего удара</button>`;
    }
    const canBeginGentling = getEffectiveSelectedTechniqueIds(state)
      .has("ll-monk:gentling-touch") && session.sequenceKind === "attack-action" &&
      Number(state.combat?.ki?.current) >= 1 &&
      (!sequence || sequence.status === "open" &&
        getUsedAttackSlots(sequence) < sequence.maximumAttacks);
    if (canBeginGentling) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="begin-gentling"
        ${disabled ? "disabled" : ""}>Gentling Touch · занять слот Attack</button>`;
    }
  } else if (session.currentStep === "damage-input") {
    body = renderDamageForm(session, state);
    const attack = session.selectedDamage?.attack;
    const snapshot = attack?.profileSnapshot;
    const damageInputs = currentInputs(session);
    const damageRolls = attack?.critical
      ? [damageInputs.damage1 ?? "", damageInputs.damage2 ?? ""]
      : [damageInputs.damage1 ?? ""];
    const validDamage = Boolean(attack && snapshot &&
      calculateWorkspaceDamagePreview(snapshot, damageRolls, attack.critical).ok);
    footer = `<div class="workspace-task-actions">
      <button type="button" class="primary" data-workspace-action="submit-damage"
        ${session.submitting || session.appliedUnsaved ||
          session.readOnly && (session.pendingAttackIntent || session.pendingSeekingIntent) ||
          !validDamage ? "disabled" : ""}>${session.pendingAttackIntent ? "Записать атаку и урон" : session.pendingSeekingIntent ? "Записать замену и урон" : "Записать урон"}</button>
      ${session.pendingAttackIntent || session.pendingSeekingIntent ? "" : `<button type="button" data-workspace-action="outside-damage"
        ${session.submitting || session.appliedUnsaved ? "disabled" : ""}>Урон учтён вне приложения</button>`}
    </div>`;
    if (session.pendingAttackIntent && !session.readOnly &&
        !session.submitting && !session.appliedUnsaved) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="cancel-attack-draft">Отмена текущего удара</button>`;
    }
    if (session.pendingSeekingIntent && !session.readOnly &&
        !session.submitting && !session.appliedUnsaved) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="cancel-seeking-draft">Отмена Seeking Strike</button>`;
    }
  } else if (session.currentStep === "seeking-input") {
    body = renderSeekingForm(session);
    const seekingValues = currentInputs(session);
    const seekingPreview = session.seekingIntent
      ? previewWorkspaceCompletedSeekingStrike(state, {
        actionId: session.seekingIntent.actionId,
        attackId: session.seekingIntent.attackId,
        invocationId: session.seekingIntent.invocationId,
        battleId: session.seekingIntent.battleId,
        phaseAtOpen: session.seekingIntent.phaseAtOpen,
        ownTurnId: session.seekingIntent.ownTurnId,
        turnMarker: session.seekingIntent.turnMarker,
        expectedParentBasis: session.seekingIntent.expectedParentBasis,
        replacement: {
          rollMode: seekingValues.rollMode ?? session.seekingOriginalRollMode ?? "normal",
          firstD20: seekingValues.firstD20 ?? "",
          secondD20: seekingValues.secondD20 ?? "",
          targetArmorClass: seekingValues.targetArmorClass ?? "",
          dmHitResult: seekingValues.dmHitResult || null,
          dmExceptionConfirmed: seekingValues.dmExceptionConfirmed === true,
        },
        damageRolls: [],
      })
      : null;
    const canSubmitSeeking = Boolean(session.seekingIntent
      ? seekingPreview?.ok
      : String(seekingValues.firstD20 ?? "").trim());
    footer = `<button type="button" class="primary" data-workspace-action="submit-seeking"
      ${session.submitting || session.appliedUnsaved || session.readOnly || !canSubmitSeeking ? "disabled" : ""}>${seekingPreview?.stage === "damage" ? "Указать урон замены" : session.seekingIntent ? "Записать замену результата" : "Записать новый бросок"}</button>
      ${session.seekingIntent && !session.readOnly && !session.submitting && !session.appliedUnsaved
        ? `<button type="button" class="btn btn--utility" data-workspace-action="cancel-seeking-draft">Отмена Seeking Strike</button>` : ""}`;
  } else if (session.currentStep === "gentling-input") {
    body = renderGentlingForm(session, state);
    const projection = getWorkspaceGentlingProjection(session, state);
    const preview = projection.completedPreview;
    const canApply = preview?.ok === true && preview.stage === "complete";
    const cost = preview?.ok ? preview.result.cost : projection.mechanics?.cost ?? 1;
    footer = `<button type="button" class="primary" data-workspace-action="submit-gentling"
      ${session.submitting || session.appliedUnsaved || session.readOnly || !canApply ? "disabled" : ""}>Записать результат · ${cost} ци</button>
      <button type="button" data-workspace-action="cancel-contextual"
        ${session.submitting || session.appliedUnsaved || session.readOnly ? "disabled" : ""}>Отмена</button>`;
  } else if (session.currentStep === "strike-input") {
    body = renderStrikeForm(session, state);
    const technique = MONK_TECHNIQUE_BY_ID.get(currentInputs(session).techniqueId);
    const paymentMode = currentInputs(session).paymentMode || "ki";
    const paymentLabel = paymentMode === "practiced"
      ? "1 Practiced"
      : technique?.payment.replaceAll("Ki", "ци") ?? "";
    footer = `<button type="button" class="btn btn--primary" data-workspace-action="no-technique-continue" ${session.submitting || session.appliedUnsaved ? "disabled" : ""}>Без техники → ${session.capabilities.canContinueSequence ? "следующий удар" : "завершить"}</button>
      <button type="button" class="btn btn--utility" data-workspace-action="apply-strike" ${session.submitting || session.appliedUnsaved || !canApplyStrike(session, state) ? "disabled" : ""}>${technique ? `Применить за ${escapeHtml(paymentLabel)}` : "Выберите технику"}</button>`;
  } else if (session.currentStep === "confirm-close") {
    const hasRemainder = sequence?.status === "open" &&
      getUsedAttackSlots(sequence) < sequence.maximumAttacks;
    body = `<p>${session.historicalOnly
      ? "Закрыть панель. Сохранённая запись останется доступна в «Сохранённых записях»."
      : hasRemainder
      ? "У этой атаки ещё есть удары. Можно продолжить или закрыть остаток; уже записанные результаты и расходы сохранятся."
      : session.dirty ? "Есть незавершённый ввод." : "Закрыть только эту рабочую панель?"}</p>
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
    footer = hasRemainder
      ? `<button type="button" class="btn btn--primary" data-workspace-action="stay">Продолжить</button>
        <button type="button" class="btn btn--utility" data-workspace-action="close-attack-remainder">Закрыть остаток</button>`
      : `<button type="button" class="btn btn--utility" data-workspace-action="stay">Вернуться</button>
        <button type="button" class="btn btn--primary" data-workspace-action="confirm-close">${session.dirty ? "Закрыть без применения" : "Готово"}</button>`;
  } else {
    const attacks = sequence?.resolvedAttacks ?? [];
    const currentIndex = attacks.findIndex((attack) => attack.id === session.attackId);
    const displayedIndex = currentIndex >= 0 ? currentIndex : attacks.length - 1;
    const currentAttack = attacks[displayedIndex];
    const previousAttacks = attacks.filter((_, index) => index !== displayedIndex);
    const historyRecords = [
      ...previousAttacks.map((attack) => ({
        slotNumber: attack.slotNumber ?? attacks.indexOf(attack) + 1,
        markup: renderAttackRecord(attack, state, attacks.indexOf(attack),
          sequence?.maximumAttacks ?? attacks.length),
      })),
      ...(sequence?.replacementResults ?? []).map((result) => ({
        slotNumber: result.slotNumber,
        markup: `<article class="workspace-record"><h3>Удар ${result.slotNumber}/${sequence.maximumAttacks} · Gentling Touch</h3>
          <p>${result.dice} костей d${result.sides} · сумма ${result.sum} · цель ${result.targetHp} HP</p>
          <p>${result.thresholdMet ? "Порог достигнут." : "Порог не достигнут."}</p></article>`,
      })),
    ].sort((a, b) => a.slotNumber - b.slotNumber);
    const strikeParent = session.currentStep === "checkpoint" && !session.historicalOnly
      ? getCurrentWorkspaceStrikeParent(
        state, session.strikeParent?.sequenceId, session.strikeParent?.attackId,
      )
      : null;
    body = `${currentAttack
      ? `<section class="workspace-current-result" aria-label="Текущий результат">
          ${renderAttackRecord(currentAttack, state, displayedIndex,
            sequence?.maximumAttacks ?? attacks.length)}
        </section>` : ""}
      ${historyRecords.length ? `<details class="workspace-history"><summary>Предыдущие результаты · ${historyRecords.length}</summary>
        ${historyRecords.map((record) => record.markup).join("")}</details>` : ""}
      ${session.currentStep === "checkpoint" && strikeParent
        ? `<section class="workspace-post-hit"><h3>Урон записан</h3><p>Техника необязательна. Можно продолжить без оплаты.</p></section>`
        : session.currentStep === "checkpoint" && session.capabilities.canContinueSequence
          ? "<p>Результат записан. Следующий удар использует новый ввод физических костей.</p>"
          : session.currentStep === "checkpoint" ? "<p>Результат записан. Новые атаки в этом режиме не добавляются.</p>" : ""}
      ${sequence?.status === "abandoned" ? "<p>Последовательность закрыта; новые удары не добавляются.</p>" : ""}
      ${session.error ? `<p class="workspace-error" role="alert">${escapeHtml(session.error)}</p>` : ""}`;
    if (session.currentStep === "checkpoint" && strikeParent) {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="no-technique-continue" ${session.appliedUnsaved ? "disabled" : ""}>${session.capabilities.canContinueSequence ? "Без техники → следующий удар" : "Завершить без техники"}</button>
        ${strikeChoices(state, strikeParent.attack).length ? `<button type="button" class="btn btn--utility" data-workspace-action="open-strike" ${session.appliedUnsaved ? "disabled" : ""}>Выбрать необязательную технику</button>` : ""}`;
    } else if (session.currentStep === "checkpoint" && session.appliedUnsaved) {
      footer = "<p>Продолжение доступно после сохранения результата.</p>";
    } else if (session.currentStep === "checkpoint" && session.capabilities.canContinueSequence) {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="next-attack">Следующий удар · ${getUsedAttackSlots(sequence) + 1} из ${sequence.maximumAttacks}</button>
        <button type="button" class="btn btn--utility" data-workspace-action="summary">Завершить ввод атак</button>`;
    } else if (session.currentStep === "summary" && sequence?.status === "open" &&
        session.capabilities.canContinueSequence && !session.readOnly) {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="next-attack">Продолжить следующий удар</button>
        <button type="button" class="btn btn--utility" data-workspace-action="close-attack-remainder">Закрыть остаток</button>`;
    } else if (session.currentStep === "summary") {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="finish-workspace"
        ${session.submitting || session.appliedUnsaved ? "disabled" : ""}>${escapeHtml(session.completionLabel ?? "Готово")}</button>`;
    } else {
      footer = `<button type="button" class="btn btn--primary" data-workspace-action="summary">К итогам</button>`;
    }
    let currentSeekingHistory = [];
    if (currentAttack) {
      try {
        currentSeekingHistory = readSeekingHistory(currentAttack, {
          actionId: sequence.id,
          attackId: currentAttack.id,
        });
      } catch {
        currentSeekingHistory = [];
      }
    }
    const seekingPending = pendingSeeking(currentSeekingHistory);
    const seekingBasis = currentAttack
      ? encodeURIComponent(buildWorkspaceSeekingParentBasis(
        sequence, currentAttack, currentSeekingHistory,
      )) : "";
    if (session.currentStep === "checkpoint" && !session.appliedUnsaved &&
        currentAttack?.hitResult === "miss" &&
        getEffectiveSelectedTechniqueIds(state).has("ll-monk:seeking-strike") &&
        (currentAttack.profileId === "unarmed" ||
          currentAttack.profileSnapshot?.martialArtsEligible === true) &&
        !seekingPending &&
        !currentAttack.historicalResolution) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="begin-seeking" data-seeking-basis="${escapeHtml(seekingBasis)}">Seeking Strike · 1 ци</button>`;
    }
    const activeSequence = sequence?.kind === "attack-action" &&
      sequence.status === "open";
    const canBeginNormalGentling = !sequence && session.currentStep === "attack-input" &&
      session.sequenceKind === "attack-action" && !session.readOnly;
    if (["attack-input", "checkpoint"].includes(session.currentStep) && activeSequence &&
        Number(state.combat?.ki?.current) >= 1 &&
        getUsedAttackSlots(sequence) < sequence.maximumAttacks &&
        getEffectiveSelectedTechniqueIds(state).has("ll-monk:gentling-touch")) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="begin-gentling">Gentling Touch · заменить слот</button>`;
    } else if (canBeginNormalGentling &&
        Number(state.combat?.ki?.current) >= 1 &&
        getEffectiveSelectedTechniqueIds(state).has("ll-monk:gentling-touch")) {
      footer += `<button type="button" class="btn btn--utility" data-workspace-action="begin-gentling">Gentling Touch · занять первый слот</button>`;
    }
  }
  const appliedUnsaved = session.appliedUnsaved
    ? `<section class="workspace-save-recovery" role="alert"><strong>Изменение применено, но не сохранено</strong>
      <p>Результат показан выше. Не применяйте действие повторно.</p></section>
      <button type="button" class="btn btn--utility" data-workspace-action="retry-save">Повторить сохранение</button>` : "";
  return {
    header,
    body,
    footer: session.appliedUnsaved ? appliedUnsaved : footer,
  };
}

export function renderWorkspaceAttackPreview(session, state) {
  const root = getWorkspaceHost();
  const totalNode = root?.querySelector("[data-attack-total]");
  const formulaNode = root?.querySelector("[data-attack-formula]");
  const statusNode = root?.querySelector("[data-attack-status]");
  const validationNode = root?.querySelector("[data-attack-validation]");
  if (!totalNode || !formulaNode || !statusNode || !validationNode) return;
  const inputs = session.rawInputsByStep[session.currentStepKey] ?? {};
  const preview = calculateWorkspaceAttackPreview(state, {
    profileId: inputs.profileId ?? "unarmed",
    firstD20: inputs.firstD20 ?? "",
    secondD20: inputs.secondD20 ?? "",
    rollMode: inputs.rollMode || "normal",
  });
  if (!preview.ok) {
    totalNode.textContent = "—";
    formulaNode.textContent = "";
    statusNode.textContent = "";
    statusNode.dataset.state = "pending";
    validationNode.textContent = preview.reason;
    validationNode.dataset.state = "invalid";
    updateAttackControls(session, false, false);
    return;
  }
  const formula = `${preview.chosenD20} ${formatSigned(preview.attackBonusSnapshot)} = ${preview.attackTotal}`;
  const rolls = preview.rawD20Rolls.length > 1
    ? `К20 ${preview.rawD20Rolls.join(" и ")} · выбран ${preview.chosenD20}.`
    : `К20 ${preview.chosenD20}.`;
  const natural = preview.naturalMiss
    ? "Натуральная 1 — по обычному правилу промах."
    : preview.critical
      ? "Натуральная 20 — критическое попадание по обычному правилу."
      : "Исход определяет ведущий.";
  totalNode.textContent = String(preview.attackTotal);
  formulaNode.textContent = formula;
  statusNode.textContent = `${rolls} ${natural}`;
  statusNode.dataset.state = preview.naturalMiss ? "natural-miss"
    : preview.critical ? "critical" : "pending";
  validationNode.textContent = "";
  validationNode.dataset.state = "";
  const inputsMatch = inputs.rollMode === "advantage" || inputs.rollMode === "disadvantage"
    ? inputs.secondD20 !== undefined && String(inputs.secondD20).trim() !== ""
    : true;
  updateAttackControls(session, true, inputsMatch);
}

export function renderWorkspaceDamagePreview(session) {
  const root = getWorkspaceHost();
  const node = root?.querySelector("[data-workspace-damage-preview]");
  const totalNode = root?.querySelector("[data-damage-total]");
  const formulaNode = root?.querySelector("[data-damage-formula]");
  const attack = session.selectedDamage?.attack;
  if (!node || !totalNode || !formulaNode || !attack?.profileSnapshot) return;
  const values = session.rawInputsByStep[session.currentStepKey] ?? {};
  const rolls = Array.from({ length: attack.critical ? 2 : 1 }, (_, index) =>
    values[`damage${index + 1}`] ?? "");
  const calculated = calculateWorkspaceDamagePreview(
    attack.profileSnapshot,
    rolls,
    attack.critical,
  );
  if (!calculated.ok) {
    totalNode.textContent = "—";
    formulaNode.textContent = "";
    node.textContent = calculated.reason;
    node.dataset.state = "invalid";
    return;
  }
  totalNode.textContent = String(calculated.damageTotalBeforeTargetModifiers);
  formulaNode.textContent = `${calculated.damageRolls.join(" + ")} ${formatSigned(calculated.damageModifierSnapshot)} = ${calculated.damageTotalBeforeTargetModifiers}`;
  node.textContent = "";
  node.dataset.state = "valid";
}

function updateAttackControls(session, valid, complete) {
  const root = getWorkspaceHost();
  if (!root) return;
  const disabled = !valid || !complete || session.submitting || session.appliedUnsaved ||
    session.readOnly;
  for (const outcome of ["hit", "miss"]) {
    const button = root.querySelector(`[data-workspace-action="attack-${outcome}"]`);
    if (button) button.disabled = disabled;
  }
}
