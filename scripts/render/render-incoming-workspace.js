import { getDerivedStats } from "../calculations.js";
import { calculateDeflectionPreview } from "../combat/sara-combat.js";
import {
  buildDeflectionParameters,
  previewIncomingEvent,
} from "../actions/incoming-event.js";
import { parsePhysicalInteger } from "../combat/physical-input.js";
import { renderSaraEndBattleButton } from "./sara-hud.js";
import { incomingContextIsCurrent } from "../battle/incoming-event-draft.js";
import { getEffectiveTechniqueIds } from "../selectors/techniques.js";
import { previewIncomingReplyAttack } from "../actions/sara-combat.js";

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

function buildIncomingReplyPreviewRequest(draft, reply) {
  return {
    eventId: draft.eventId,
    battleId: draft.battleId,
    phaseAtOpen: draft.phaseAtOpen,
    ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
    replyKind: reply.replyKind,
    parentOperationId: reply.parentOperationId ?? null,
    continuationId: reply.continuationId ?? null,
    trigger: reply.trigger ?? null,
    attack: { ...reply.attack },
    damageRolls: [],
  };
}

export function renderIncomingReplyDamageControls(session, state) {
  const draft = session.incomingDraft;
  const reply = draft.replyDraft;
  if (draft.stage !== "reply-damage" || !reply) return "";
  const preview = previewIncomingReplyAttack(
    state, buildIncomingReplyPreviewRequest(draft, reply),
  );
  if (!preview.ok || !preview.attack.hitResult) return "";
  return Array.from({ length: preview.requiredDamageDice }, (_, index) =>
    field(index ? "replyDamage2" : "replyDamage1",
      index ? "Дополнительная кость критического урона" : "Физический урон",
      reply.damageRolls?.[index] ?? "", 'type="number" min="1" step="1"')).join("");
}

export function renderIncomingReplyHitControls(session) {
  const reply = session.incomingDraft.replyDraft;
  return reply?.attack.targetArmorClass == null || reply?.attack.targetArmorClass === ""
    ? `${button("incoming-reply-hit", "Попадание")}
      ${button("incoming-reply-miss", "Промах")}` : "";
}

export function renderIncomingPreview(session, state) {
  const draft = session.incomingDraft;
  const derived = getDerivedStats(state);
  if (["reply-input", "reply-damage"].includes(draft.stage) && draft.replyDraft?.replyKind) {
    const reply = draft.replyDraft;
    const result = previewIncomingReplyAttack(
      state, buildIncomingReplyPreviewRequest(draft, reply),
    );
    return result.ok
      ? `<p>Бросок: ${result.attack.chosenD20} + ${result.attack.attackBonusSnapshot} = <strong>${result.attack.attackTotal}</strong>;
        ${result.attack.hitResult ? "попадание" : "промах"}${result.attack.critical ? " · критическое" : ""}
        ${result.requiredDamageDice
          ? ` · требуется физических костей урона: ${result.requiredDamageDice}` : ""}</p>`
      : `<p role="status">${escapeHtml(result.reason)}</p>`;
  }
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
  if (["save-input", "save-consequence"].includes(draft.stage)) {
    const amendmentSelected = Boolean(draft.rollDraft.amendment);
    const preview = previewIncomingEvent(state, incomingSavePreviewRequest(session));
    if (!preview.ok) return `<p role="status">${escapeHtml(preview.reason)}</p>`;
    const roll = preview.calculated;
    if (draft.stage === "save-input") {
      return `<p>${escapeHtml(roll.label)}: ${roll.chosenD20} + ${roll.totalModifier} = <strong>${roll.total}</strong>
        ${roll.dc == null ? " · Сложность не указана" : ` · СЛ ${roll.dc}; ожидаемый исход ${roll.total >= roll.dc ? "успех" : "провал"}`}</p>`;
    }
    if (amendmentSelected) {
      const amendment = preview.amendmentPreview;
      const finalOutcomeSelected = ["success", "failure"].includes(draft.rollDraft.amendedOutcome);
      return `<p>Базовый итог: ${amendment.before.total} · провал. После поправки: ${roll.chosenD20} + ${roll.totalModifier} = <strong>${roll.total}</strong>.
        ${roll.dc == null ? "СЛ не указана — уточните исход у ведущего." :
          `СЛ ${roll.dc}; ожидаемый результат: ${roll.total >= roll.dc ? "успех" : "провал"}.`}
        Ци при применении: ${state.combat?.ki?.current ?? "—"} → ${Math.max(0, Number(state.combat?.ki?.current ?? 0) - 1)}; реакция не расходуется.
        ${finalOutcomeSelected && draft.rollDraft.hasDamage === true
          ? ` ${escapeHtml(preview.ruleExplanation ?? "")} Итог к применению: <strong>${preview.finalDamage}</strong>.`
          : finalOutcomeSelected ? "" : " Выберите окончательный исход ниже."}</p>`;
    }
    if (draft.outcome === "unknown") {
      return "<p>Уточните исход у ведущего. Поправка после неизвестного базового исхода недоступна.</p>";
    }
    return `<p>${escapeHtml(roll.label)}: ${roll.chosenD20} + ${roll.totalModifier} = <strong>${roll.total}</strong> · базовый исход: ${draft.rollDraft.baseOutcome}.
      ${draft.rollDraft.hasDamage === true
        ? `${escapeHtml(preview.ruleExplanation ?? "")} Итог к применению: <strong>${preview.finalDamage}</strong>.`
        : ""}</p>`;
  }
  return "";
}

function incomingSavePreviewRequest(session, { eligibilityOnly = false } = {}) {
  const draft = session.incomingDraft;
  const amendmentSelected = !eligibilityOnly && Boolean(draft.rollDraft.amendment);
  const outcome = eligibilityOnly ? "failure"
    : draft.stage === "save-input" ? "unknown"
      : amendmentSelected && !draft.rollDraft.amendedOutcome ? null
        : draft.outcome ?? "unknown";
  return {
    kind: "completed-save",
    battleId: draft.battleId,
    eventId: draft.eventId,
    phaseAtOpen: draft.phaseAtOpen,
    ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
    outcome,
    amendment: amendmentSelected ? {
      techniqueId: draft.rollDraft.amendment,
      baseOutcome: draft.rollDraft.baseOutcome,
    } : null,
    hasDamage: !eligibilityOnly && outcome != null && outcome !== "unknown" &&
      draft.rollDraft.hasDamage === true,
    damage: draft.rollDraft.damage,
    damageBasis: draft.rollDraft.damageBasis ?? "dm-final",
    effectProfile: draft.rollDraft.effectProfile,
    spellSaveSource: draft.source === "spell",
    roll: {
      id: draft.rollDraft.ability ?? "dexterity",
      firstD20: draft.rollDraft.firstD20,
      secondD20: draft.rollDraft.secondD20,
      rollMode: draft.rollDraft.rollMode ?? "advantage",
      dc: draft.rollDraft.dc,
    },
  };
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
  const selectedTechniques = new Set(getEffectiveTechniqueIds(state));
  const deflectAvailable = state.ui?.turn?.reactionUsed !== true &&
    (draft.source === "projectile"
      ? selectedTechniques.has("ll-monk:deflect-missile")
      : selectedTechniques.has("ll-monk:deflect-strike"));
  const ebbAvailable = Number(state.profile?.level) >= 6 &&
    state.ui?.turn?.reactionUsed !== true &&
    selectedTechniques.has("base:ebb-and-flow") &&
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
        ${ebbAvailable ? button("incoming-ebb-unarmed", "Ответить на промах вблизи · безоружный удар") : ""}
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
      {
      const amendmentSelected = Boolean(draft.rollDraft.amendment);
      const eligibilityPreview = previewIncomingEvent(
        state, incomingSavePreviewRequest(session, { eligibilityOnly: true }),
      );
      const canOfferAmendment = draft.rollDraft.baseOutcome === "failure" &&
        eligibilityPreview.ok &&
        eligibilityPreview.amendmentPreview?.availability === true;
      const needsFinalOutcome = amendmentSelected &&
        !["success", "failure"].includes(draft.rollDraft.amendedOutcome);
      const amendmentUnavailable = amendmentSelected &&
        (!eligibilityPreview.ok ||
          eligibilityPreview.amendmentPreview?.availability !== true);
      body = `<p>Выберите последствие спасброска.</p>
        ${draft.outcome === "unknown" ? "<p>Запись будет сохранена без исхода и без изменения HP.</p>" : ""}
        ${canOfferAmendment ? button("incoming-save-amendment",
          `Дух спокойствия · +${derived.abilityModifiers.wisdom} · 1 ци`) : ""}
        ${amendmentSelected ? `<p>Поправка выбрана. Окончательный исход остаётся за игроком.</p>
          ${button("incoming-save-amendment-decline", "Не использовать")}
          ${button("incoming-save-success", "Успех после поправки")}
          ${button("incoming-save-failure", "Провал после поправки")}` : ""}
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
      footer = `${button("incoming-apply-save",
        amendmentSelected ? "Применить результат · 1 ци"
          : draft.outcome === "unknown" ? "Записать без исхода" : "Применить результат",
        `class="btn btn--primary"${needsFinalOutcome || amendmentUnavailable ? " disabled" : ""}`)}
        ${button("incoming-back", "Назад")}${button("incoming-cancel", "Отмена")}`;
      break;
      }
    case "result":
      {
        const receipt = draft.appliedReceipt;
        const outcome = receipt?.outcome;
        const effects = outcome?.effects ?? {};
        if (receipt?.request?.kind === "completed-save") {
          const roll = effects.roll;
          const amendment = effects.amendment;
          body = `<p>Спасбросок записан: ${escapeHtml(roll?.label ?? "—")} ${roll?.total ?? "—"} ·
            ${roll?.manualOutcome ?? "исход неизвестен"}.</p>
            ${amendment ? `<p>Дух спокойствия: +${amendment.bonus} Мудрости; уплачено 1 ци
              (${amendment.kiBefore} → ${amendment.kiAfter}).</p>` : ""}
            <p>${effects.consequence?.status === "applied"
              ? `Применённый урон: ${effects.consequence.finalDamage}.`
              : effects.consequence?.status === "no-damage"
                ? "Урон не применялся." : "Последствие не применялось."}</p>
            <p>Временные HP ${outcome?.tempHpBefore ?? "—"} → ${outcome?.tempHpAfter ?? "—"};
              HP ${outcome?.hpBefore ?? "—"} → ${outcome?.hpAfter ?? "—"}.</p>`;
        } else {
          body = `<p>Входящее событие применено.</p>
            <p>Исходный урон: ${effects.incomingDamage ?? effects.finalDamage ?? "—"};
              уменьшение: ${effects.reduction ?? "—"}; остаток: ${effects.finalRemainder ?? effects.finalDamage ?? "—"}.</p>
            <p>Временные HP ${outcome?.tempHpBefore ?? "—"} → ${outcome?.tempHpAfter ?? "—"};
              HP ${outcome?.hpBefore ?? "—"} → ${outcome?.hpAfter ?? "—"}.</p>`;
        }
      }
      footer = `${draft.appliedReceipt?.kind === "incoming-event"
        ? (() => {
          const effects = draft.appliedReceipt?.outcome?.effects ?? {};
          return `${effects?.techniqueResult?.canCounterattack === true
            ? button("incoming-open-counter", "Контратаковать") : ""}
            ${effects?.techniqueResult?.canCatch === true &&
              state.monk?.techniqueRuntime?.deflectContinuation?.consumed !== true
              ? button("incoming-open-return", "Вернуть снаряд") : ""}`;
        })() : ""}${button("incoming-close", "Закрыть")}`;
      break;
    case "reply-input":
    case "reply-damage": {
      const reply = draft.replyDraft;
      const modeLabel = { normal: "Обычный", advantage: "Преимущество", disadvantage: "Помеха" };
      const attackPreview = previewIncomingReplyAttack(
        state, buildIncomingReplyPreviewRequest(draft, reply),
      );
      const showDamageInputs = draft.stage === "reply-damage" &&
        attackPreview.ok && attackPreview.attack.hitResult;
      body = `<section data-incoming-stage="${draft.stage}">
        <label>Режим броска<select data-workspace-field name="replyRollMode">
        ${Object.entries(modeLabel).map(([key, label]) =>
          `<option value="${key}" ${reply.attack.rollMode === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        ${field("replyFirstD20", "Первый физический к20", reply.attack.firstD20 ?? "", 'type="number" min="1" max="20" step="1"')}
        ${reply.attack.rollMode !== "normal" ? field("replySecondD20", "Второй физический к20", reply.attack.secondD20 ?? "", 'type="number" min="1" max="20" step="1"') : ""}
        ${field("replyTargetArmorClass", "КД цели (если известна)", reply.attack.targetArmorClass ?? "", 'type="number" min="1" max="99" step="1"')}
        <div data-incoming-reply-hit-controls>${renderIncomingReplyHitControls(session)}</div>
        ${field("replyTargetLabel", "Цель", reply.attack.targetLabel ?? "")}
        <div data-incoming-reply-damage>${showDamageInputs
          ? renderIncomingReplyDamageControls(session, state) : ""}</div>
        <div data-incoming-preview>${renderIncomingPreview(session, state)}</div>
        </section>`;
      footer = `${button("incoming-reply-submit",
        reply.replyKind === "missile-return" ? "Вернуть снаряд · 1 ци" : "Записать ответный удар",
        'class="btn btn--primary"')}
        ${button("incoming-reply-back", "Назад")}
        ${button("incoming-reply-cancel", "Отмена")}`;
      break;
    }
    case "reply-result": {
      const result = draft.appliedReceipt?.outcome ?? {};
      body = `<p>Ответный удар: ${result.hit ? "попадание" : "промах"}${result.critical ? " · критическое попадание" : ""}.</p>
        <p>Итог атаки: ${result.attackTotal ?? "—"}${result.hit ? ` · урон ${result.damageTotal}` : ""}</p>`;
      footer = button("incoming-close", "Закрыть");
      break;
    }
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
