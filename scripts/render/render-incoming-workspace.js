import { getDerivedStats } from "../calculations.js";
import { calculateDeflectionPreview } from "../combat/sara-combat.js";
import { buildDeflectionParameters } from "../actions/incoming-event.js";
import { parsePhysicalInteger } from "../combat/physical-input.js";
import { renderSaraEndBattleButton } from "./sara-hud.js";
import { incomingContextIsCurrent } from "../battle/incoming-event-draft.js";
import { getSaraRollBreakdown } from "../rolls/providers/sara.js";
import { calculateCharacterRoll } from "../rolls/calculations.js";
import { calculateRollConsequencePreview } from "../rolls/consequences.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";

const ABILITIES = [
  ["strength", "Сила"], ["dexterity", "Ловкость"], ["constitution", "Телосложение"],
  ["intelligence", "Интеллект"], ["wisdom", "Мудрость"], ["charisma", "Харизма"],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function button(action, label, attrs = "") {
  return `<button type="button" data-workspace-action="${action}" ${attrs}>${label}</button>`;
}

function field(name, label, value, attrs = "") {
  return `<label>${escapeHtml(label)}<input data-workspace-field name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${attrs}></label>`;
}

export function renderIncomingPreview(session, state) {
  const draft = session.incomingDraft;
  const derived = getDerivedStats(state);
  if (draft.stage === "outcome") {
    return `<p class="incoming-event__armor-class">КД <strong>${derived.armorClass}</strong></p>`;
  }
  if (draft.stage === "deflect") {
    const preview = calculateDeflectionPreview(state, buildDeflectionParameters({
      source: draft.source, damage: draft.rawDamage, deflectRoll: draft.rawDeflectRoll,
      catchChoice: draft.catchChoice,
    }));
    return preview.ok
      ? `<p>Снижение: ${preview.reduction}; остаток: ${preview.rawRemainder}; к применению: <strong>${preview.finalRemainder}</strong></p>
        <p>Временные HP ${preview.damagePools.tempHpBefore} → ${preview.damagePools.tempHpAfter}; HP ${preview.damagePools.hpBefore} → ${preview.damagePools.hpAfter}</p>`
      : `<p role="status">${escapeHtml(preview.reason)}</p>`;
  }
  if (draft.stage === "damage") {
    const parsed = parsePhysicalInteger(draft.rawDamage, 0, Number.MAX_SAFE_INTEGER, "Полученный урон");
    if (!parsed.ok) return `<p role="status">${escapeHtml(parsed.reason)}</p>`;
    const tempHp = Math.min(Number(state.combat?.hp?.temp ?? 0), parsed.value);
    return `<p>Урон: ${parsed.value}; временные HP ${state.combat?.hp?.temp ?? 0} → ${Number(state.combat?.hp?.temp ?? 0) - tempHp};
      HP ${state.combat?.hp?.current ?? "—"} → ${Math.max(0, Number(state.combat?.hp?.current ?? 0) - (parsed.value - tempHp))}</p>`;
  }
  if (draft.stage === "save-input") {
    const breakdown = getSaraRollBreakdown(state, "saving-throw",
      draft.rollDraft.ability ?? "dexterity");
    if (!breakdown.ok) return `<p role="status">${escapeHtml(breakdown.reason)}</p>`;
    const result = calculateCharacterRoll({
      kind: "saving-throw",
      id: draft.rollDraft.ability ?? "dexterity",
      firstD20: draft.rollDraft.firstD20,
      secondD20: draft.rollDraft.secondD20,
      rollMode: draft.rollDraft.rollMode ?? "advantage",
      dc: draft.rollDraft.dc,
      spellSaveSource: draft.source === "spell",
    }, breakdown);
    return result.ok
      ? `<p>${escapeHtml(breakdown.label)}: ${result.chosenD20} + ${result.totalModifier} = <strong>${result.total}</strong>
        ${result.dc == null ? " · Сложность не указана" : ` · СЛ ${result.dc}`}</p>`
      : `<p role="status">${escapeHtml(result.reason)}</p>`;
  }
  if (draft.stage === "save-consequence" && draft.outcome !== "unknown" &&
      draft.rollDraft.hasDamage === true) {
    const breakdown = getSaraRollBreakdown(state, "saving-throw", draft.rollDraft.ability);
    if (!breakdown.ok) return `<p role="status">${escapeHtml(breakdown.reason)}</p>`;
    const roll = calculateCharacterRoll({
      kind: "saving-throw",
      id: draft.rollDraft.ability,
      firstD20: draft.rollDraft.firstD20,
      secondD20: draft.rollDraft.secondD20,
      rollMode: draft.rollDraft.rollMode ?? "advantage",
      dc: draft.rollDraft.dc,
      spellSaveSource: draft.source === "spell",
    }, breakdown);
    if (!roll.ok) return `<p role="status">${escapeHtml(roll.reason)}</p>`;
    const consequence = calculateRollConsequencePreview({
      ...roll,
      manualOutcome: draft.outcome,
      dcResult: draft.outcome === "success",
      featureSnapshot: { evasionAvailable: breakdown.evasionAvailable === true },
    }, state, {
      damage: draft.rollDraft.damage,
      damageBasis: draft.rollDraft.damageBasis ?? "dm-final",
      effectProfile: draft.rollDraft.effectProfile,
    });
    return consequence.ok
      ? `<p>${escapeHtml(consequence.ruleExplanation)} Итог к применению: <strong>${consequence.finalDamage}</strong></p>`
      : `<p role="status">${escapeHtml(consequence.reason)}</p>`;
  }
  return "";
}

export function renderIncomingCatchControls(session, state) {
  const draft = session.incomingDraft;
  if (draft.stage !== "deflect" || draft.source !== "projectile") return "";
  const preview = calculateDeflectionPreview(state, buildDeflectionParameters({
    source: draft.source, damage: draft.rawDamage, deflectRoll: draft.rawDeflectRoll,
    catchChoice: draft.catchChoice,
  }));
  if (!preview.ok || preview.rawRemainder !== 0) return "";
  return `${button("incoming-catch", draft.catchChoice === "catch" ? "✓ Поймать" : "Поймать")}
    ${button("incoming-skip-catch", draft.catchChoice === "skip" ? "✓ Не ловить" : "Не ловить")}`;
}

export function renderIncomingWorkspace(session, state) {
  const draft = session.incomingDraft;
  const derived = getDerivedStats(state);
  const title = "Входящее событие";
  const selectedTechniques = getEffectiveSelectedTechniqueIds(state);
  const deflectAvailable = state.ui?.turn?.reactionUsed !== true &&
    (draft.source === "projectile"
      ? selectedTechniques.has("ll-monk:deflect-missile")
      : selectedTechniques.has("ll-monk:deflect-strike"));
  const ebbAvailable = Number(state.profile?.level) >= 6 &&
    state.ui?.turn?.reactionUsed !== true &&
    ["waiting", "own-turn"].includes(state.battleConsole?.current?.phase);
  let body = "";
  let footer = "";
  if (draft.stage !== "verification" &&
      !incomingContextIsCurrent(draft, state, session.owner) && !draft.appliedReceipt) {
    draft.stage = "expired";
  }
  switch (draft.stage) {
    case "outcome":
      body = `${renderIncomingPreview(session, state)}
        <p>Выберите исход вражеской атаки.</p>`;
      footer = `${button("incoming-hit", "Попадание", 'class="btn btn--primary"')}
        ${button("incoming-miss", "Промах")}
        ${button("incoming-cancel", "Отмена")}`;
      break;
    case "source":
      body = "<p>Какой источник атаки попал?</p>";
      footer = `${button("incoming-source-melee", "Удар вблизи")}
        ${button("incoming-source-projectile", "Дальнобойная атака снарядом")}
        ${button("incoming-source-spell", "Заклинание")}
        ${button("incoming-back", "Назад")}${button("incoming-cancel", "Отмена")}`;
      break;
    case "miss-response":
      body = "<p>Промах не меняет HP.</p>";
      footer = `${button("incoming-finish-miss", "Завершить событие")}
        ${ebbAvailable ? button("incoming-ebb-save", "Ответить на промах вблизи · спасбросок цели") : ""}
        ${button("incoming-back", "Назад")}`;
      break;
    case "damage":
      body = `<p>КД <strong>${derived.armorClass}</strong></p>
        ${field("incomingDamage", "Полученный урон", draft.rawDamage, 'type="number" min="0" step="1" inputmode="numeric"')}
        <div data-incoming-preview>${renderIncomingPreview(session, state)}</div>`;
      footer = `${button("incoming-apply-damage", "Принять урон", 'class="btn btn--primary"')}
        ${["melee", "projectile"].includes(draft.source) && deflectAvailable
          ? button("incoming-open-deflect", "Использовать отражение") : ""}
        ${draft.source === "spell" ? button("incoming-spell-save", "Пройти спасбросок") : ""}
        ${draft.source === "spell" ? button("incoming-spell-damage", "Получить урон") : ""}
        ${draft.mode === "direct-damage" ? "" : button("incoming-back", "Назад")}
        ${button("incoming-cancel", "Отмена")}`;
      break;
    case "deflect":
      body = `<p>КД ${derived.armorClass}</p>
        ${field("incomingDamage", "Входящий урон", draft.rawDamage, 'type="number" min="0" step="1" inputmode="numeric"')}
        ${field("deflectRoll", `Кость Боевых искусств (1–${derived.monk.martialDieSides})`,
    draft.rawDeflectRoll, `type="number" min="1" max="${derived.monk.martialDieSides}" step="1" inputmode="numeric"`)}
        <div data-incoming-catch-controls>${renderIncomingCatchControls(session, state)}</div>
        <div data-incoming-preview>${renderIncomingPreview(session, state)}</div>`;
      footer = `${button("incoming-apply-deflection", "Применить отражение", 'class="btn btn--primary"')}
        ${button("incoming-back", "Назад")}${button("incoming-cancel", "Отмена")}`;
      break;
    case "spell-choice":
      body = "<p>Выберите, как разрешено заклинание.</p>";
      footer = `${button("incoming-spell-damage", "Получить урон")}
        ${button("incoming-spell-save", "Пройти спасбросок")}
        ${button("incoming-back", "Назад")}${button("incoming-cancel", "Отмена")}`;
      break;
    case "save-input":
      body = `<label>Спасбросок<select data-workspace-field name="saveAbility">${ABILITIES.map(([key, label]) =>
        `<option value="${key}" ${draft.rollDraft.ability === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        ${field("firstD20", "Первый физический к20", draft.rollDraft.firstD20 ?? "", 'type="number" min="1" max="20" step="1"')}
        <label>Режим<select data-workspace-field name="rollMode">${["normal", "advantage", "disadvantage"].map((mode) =>
        `<option value="${mode}" ${draft.rollDraft.rollMode === mode ? "selected" : ""}>${mode}</option>`).join("")}</select></label>
        ${draft.rollDraft.rollMode !== "normal" ? field("secondD20", "Второй физический к20", draft.rollDraft.secondD20 ?? "", 'type="number" min="1" max="20" step="1"') : ""}
        ${field("dc", "Сложность (если известна)", draft.rollDraft.dc ?? "", 'type="number" min="1" max="99" step="1"')}
        <div data-incoming-preview>${renderIncomingPreview(session, state)}</div>`;
      footer = `${button("incoming-save-success", "Успех")}
        ${button("incoming-save-failure", "Провал")}
        ${button("incoming-save-unknown", "Исход пока неизвестен")}
        ${button("incoming-back", "Назад")}${button("incoming-cancel", "Отмена")}`;
      break;
    case "save-consequence":
      body = `<p>Выберите последствие спасброска.</p>
        ${draft.outcome === "unknown" ? "<p>Запись будет сохранена без исхода и без изменения HP.</p>" : ""}
        ${draft.outcome !== "unknown" ? `${button("incoming-set-no-damage", "Без урона")}
          ${button("incoming-set-has-damage", "Есть урон")}` : ""}
        ${draft.rollDraft.hasDamage === true && draft.outcome !== "unknown" ? `
        ${field("saveDamage", "Урон (0 допустим)", draft.rollDraft.damage ?? "", 'type="number" min="0" step="1"')}
        <label>Основа урона<select data-workspace-field name="damageBasis">
          <option value="dm-final" ${draft.rollDraft.damageBasis !== "full-effect" ? "selected" : ""}>Итоговый урон от ведущего</option>
          <option value="full-effect" ${draft.rollDraft.damageBasis === "full-effect" ? "selected" : ""}>Полный урон эффекта</option></select></label>
        ${draft.rollDraft.damageBasis === "full-effect" ? `<label>Профиль эффекта<select data-workspace-field name="effectProfile">
          <option value="failure-full" ${draft.rollDraft.effectProfile !== "save-half" ? "selected" : ""}>Полный урон при провале</option>
          <option value="save-half" ${draft.rollDraft.effectProfile === "save-half" ? "selected" : ""}>Половина при успехе</option></select></label>` : ""}` : ""}`;
      body += `<div data-incoming-preview>${renderIncomingPreview(session, state)}</div>`;
      footer = `${button("incoming-apply-save", draft.outcome === "unknown" ? "Записать без исхода" : "Применить результат", 'class="btn btn--primary"')}
        ${button("incoming-back", "Назад")}${button("incoming-cancel", "Отмена")}`;
      break;
    case "result":
      {
        const receipt = draft.appliedReceipt?.outcome;
        const effects = receipt?.effects ?? {};
        body = `<p>Входящее событие применено.</p>
          <p>Исходный урон: ${effects.incomingDamage ?? effects.finalDamage ?? "—"};
            уменьшение: ${effects.reduction ?? "—"}; остаток: ${effects.finalRemainder ?? effects.finalDamage ?? "—"}.</p>
          <p>Временные HP ${receipt?.tempHpBefore ?? "—"} → ${receipt?.tempHpAfter ?? "—"};
            HP ${receipt?.hpBefore ?? "—"} → ${receipt?.hpAfter ?? "—"}.</p>`;
      }
      footer = `${button("incoming-close", "Закрыть")}`;
      break;
    case "save-recovery":
      body = "<p>Результат применён в памяти; сохранение не подтверждено.</p>";
      footer = `${button("incoming-retry-save", "Повторить сохранение")}`;
      break;
    case "verification":
      body = `<p role="alert">Результат не подтверждён: ${escapeHtml(draft.error || "проверьте состояние.")} Повторное применение заблокировано.</p>`;
      footer = `${button("incoming-verify", "Проверить receipt")}`;
      break;
    case "expired":
      body = "<p>Контекст события изменился. Просмотр доступен, применение заблокировано.</p>";
      footer = `${button("incoming-close", "Закрыть")}`;
      break;
    default:
      body = "<p>Неизвестный этап входящего события.</p>";
      footer = `${button("incoming-cancel", "Отмена")}`;
  }
  const headerControls = draft.stage === "result" || draft.stage === "save-recovery" ||
    draft.stage === "verification" || draft.stage === "expired"
    ? button("incoming-close", "Закрыть")
    : `${draft.stage !== "outcome" && draft.stage !== "miss-response"
      ? button("incoming-back", "Назад") : ""}
      ${draft.appliedReceipt ? "" : button("incoming-cancel", "Отмена")}`;
  return {
    header: `<div class="incoming-workspace__heading"><strong data-workspace-title>${title}</strong>${headerControls}</div>`,
    body: `<section class="incoming-workspace" data-incoming-stage="${draft.stage}">${body}</section>`,
    footer: `<div class="incoming-workspace__actions">${footer}</div>`,
    viewKey: JSON.stringify([session.workspaceSessionId, draft.stage]),
    status: draft.error,
  };
}
