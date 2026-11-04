import { getDerivedStats } from "../calculations.js";
import { applyDamagePools } from "../combat/damage-pools.js";
import { calculateDeflectionPreview, parsePhysicalInteger } from "../combat/sara-combat.js";
import { applyMonkTechnique } from "./monk.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { closeRestWindow } from "../sara-functional.js";
import { getSessionContext, getState, isCurrentSession, updateSessionState } from "../state.js";
import { getSaraRollBreakdown } from "../rolls/providers/sara.js";
import { calculateCharacterRoll } from "../rolls/calculations.js";
import { calculateRollConsequencePreview } from "../rolls/consequences.js";
import { previewIncomingSaveAmendment } from "../rolls/incoming-save-amendment.js";
import { projectSavingThrow } from "../rolls/saving-throw-flow.js";

export function normalizeIncomingEventRequest(request, state = getState()) {
  if (!request || !["direct-damage", "deflection", "completed-save", "ebb-and-flow"].includes(request.kind)) {
    return { ok: false, reason: "Неизвестное входящее применение." };
  }
  if (typeof request.eventId !== "string" || !request.eventId.trim()) {
    return { ok: false, reason: "Для входящего события нужен event ID." };
  }
  const validBattleId = request.battleId === null ||
    (typeof request.battleId === "string" && Boolean(request.battleId.trim()));
  const validPhase = ["outside", "waiting", "own-turn"].includes(request.phaseAtOpen);
  const validTurn = request.ownTurnIdAtOpen === null ||
    (typeof request.ownTurnIdAtOpen === "string" && Boolean(request.ownTurnIdAtOpen.trim()));
  if (!validBattleId || !validPhase || !validTurn ||
      (request.battleId === null) !== (request.phaseAtOpen === "outside") ||
      (request.phaseAtOpen === "own-turn") !== (request.ownTurnIdAtOpen !== null)) {
    return { ok: false, reason: "Идентификаторы боя, фазы или хода некорректны либо несогласованы." };
  }
  const damage = request.kind === "ebb-and-flow"
    ? { ok: true, value: null }
    : request.kind === "completed-save" && request.hasDamage !== true
    ? { ok: true, value: null }
    : parsePhysicalInteger(request.damage, 0, Number.MAX_SAFE_INTEGER,
      request.kind === "completed-save" ? "Урон эффекта" : "Полученный урон");
  if (!damage.ok) return damage;
  if (request.kind === "direct-damage") {
    return { ok: true, request: {
      kind: request.kind, damage: damage.value, battleId: request.battleId ?? null,
      eventId: request.eventId ?? null, phaseAtOpen: request.phaseAtOpen ?? null,
      ownTurnIdAtOpen: request.ownTurnIdAtOpen ?? null,
    } };
  }
  if (request.kind === "ebb-and-flow") {
    if (request.mode !== "dexterity-save" || request.triggerConfirmed !== true) {
      return { ok: false, reason: "Подтвердите допустимый ответ Ebb & Flow." };
    }
    return {
      ok: true,
      request: {
        kind: "ebb-and-flow",
        mode: request.mode,
        triggerConfirmed: true,
        battleId: request.battleId,
        eventId: request.eventId,
        phaseAtOpen: request.phaseAtOpen,
        ownTurnIdAtOpen: request.ownTurnIdAtOpen,
      },
    };
  }
  if (request.kind === "completed-save") {
    const roll = request.roll;
    if (typeof request.hasDamage !== "boolean") {
      return { ok: false, reason: "Выберите наличие последствий спасброска." };
    }
    if (!roll || !["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"].includes(roll.id) ||
        !["success", "failure", "unknown"].includes(request.outcome)) {
      return { ok: false, reason: "Выберите характеристику и допустимый исход спасброска." };
    }
    if (Object.prototype.hasOwnProperty.call(request, "paidKi") ||
        Object.prototype.hasOwnProperty.call(request, "bonus")) {
      return { ok: false, reason: "Стоимость и бонус поправки определяются сервером." };
    }
    let amendment = null;
    if (request.amendment != null) {
      if (!request.amendment || typeof request.amendment !== "object" ||
          Array.isArray(request.amendment) ||
          Object.keys(request.amendment).length !== 2 ||
          request.amendment.techniqueId !== "base:spirit-of-tranquility" ||
          request.amendment.baseOutcome !== "failure" ||
          !["success", "failure"].includes(request.outcome)) {
        return { ok: false, reason: "Поправка Духа спокойствия содержит недопустимый выбор или исход." };
      }
      amendment = {
        techniqueId: "base:spirit-of-tranquility",
        baseOutcome: "failure",
      };
    }
    if (Object.prototype.hasOwnProperty.call(request, "baseOutcomeMode")) {
      const validSource = (value) => ["dc", "manual"].includes(value);
      if (!["auto", "manual"].includes(request.baseOutcomeMode) ||
          !["auto", "manual"].includes(request.finalOutcomeMode) ||
          !validSource(request.baseOutcomeSource) ||
          !validSource(request.finalOutcomeSource) ||
          !["success", "failure", "unknown"].includes(request.baseOutcome) ||
          !["success", "failure", "unknown"].includes(request.finalOutcome) ||
          request.outcome !== request.finalOutcome ||
          request.baseManualOutcome != null &&
            !["success", "failure", "unknown"].includes(request.baseManualOutcome) ||
          request.finalManualOutcome != null &&
            !["success", "failure", "unknown"].includes(request.finalManualOutcome) ||
          request.amendment == null &&
            (request.finalOutcome !== request.baseOutcome ||
              request.finalOutcomeSource !== request.baseOutcomeSource)) {
        return { ok: false, reason: "Evidence исхода спасброска недопустимо." };
      }
    }
    if (request.saveFlowVersion != null &&
        (request.saveFlowVersion !== 1 ||
          !["standalone-save", "incoming-spell-save"].includes(request.entryKind) ||
          !Object.prototype.hasOwnProperty.call(request, "baseOutcomeMode"))) {
      return { ok: false, reason: "Версия или тип нового save workflow недопустимы." };
    }
    const activeConsequence = request.outcome !== "unknown" && request.hasDamage === true;
    if (activeConsequence && !["dm-final", "full-effect"].includes(request.damageBasis)) {
      return { ok: false, reason: "Уточните основу урона спасброска." };
    }
    if (activeConsequence && request.damageBasis === "full-effect" &&
        !["failure-full", "save-half"].includes(request.effectProfile)) {
      return { ok: false, reason: "Выберите профиль полного урона эффекта." };
    }
    const breakdown = getSaraRollBreakdown(state, "saving-throw", roll.id);
    if (!breakdown.ok) return breakdown;
    const calculated = calculateCharacterRoll({
      kind: "saving-throw",
      id: roll.id,
      firstD20: roll.firstD20,
      secondD20: roll.secondD20,
      rollMode: roll.rollMode,
      dc: roll.dc,
      incomingDamage: request.hasDamage === true ? damage.value : null,
      spellSaveSource: request.spellSaveSource === true,
      consequenceProfile: request.hasDamage === true && request.damageBasis === "full-effect"
        ? request.effectProfile : "none",
    }, breakdown);
    if (!calculated.ok) return calculated;
    return {
      ok: true,
      calculated,
      request: {
        kind: "completed-save",
        battleId: request.battleId ?? null,
        eventId: request.eventId ?? null,
        phaseAtOpen: request.phaseAtOpen ?? null,
        ownTurnIdAtOpen: request.ownTurnIdAtOpen ?? null,
        outcome: request.outcome,
        amendment,
        hasDamage: request.hasDamage === true,
        damage: damage.value,
        damageBasis: activeConsequence ? request.damageBasis : null,
        effectProfile: activeConsequence && request.damageBasis === "full-effect"
          ? request.effectProfile : null,
        roll: {
          id: roll.id,
          firstD20: String(roll.firstD20),
          secondD20: roll.secondD20 == null ? null : String(roll.secondD20),
          rollMode: roll.rollMode,
          dc: roll.dc == null || String(roll.dc).trim() === "" ? null : String(roll.dc),
        },
        spellSaveSource: request.spellSaveSource === true,
        ...(Object.prototype.hasOwnProperty.call(request, "baseOutcomeMode") ? {
          baseOutcome: request.baseOutcome,
          baseOutcomeSource: request.baseOutcomeSource,
          finalOutcome: request.finalOutcome,
          finalOutcomeSource: request.finalOutcomeSource,
          baseOutcomeMode: request.baseOutcomeMode,
          finalOutcomeMode: request.finalOutcomeMode,
          baseManualOutcome: request.baseManualOutcome ?? null,
          finalManualOutcome: request.finalManualOutcome ?? null,
        } : {}),
        ...(request.saveFlowVersion === 1 ? {
          saveFlowVersion: 1,
          entryKind: request.entryKind,
        } : {}),
      },
    };
  }
  const derived = getDerivedStats(state);
  const die = parsePhysicalInteger(request.deflectRoll, 1, derived.monk.martialDieSides, "Результат кости Боевых искусств");
  if (!die.ok) return die;
  if (!["melee", "projectile"].includes(request.source)) {
    return { ok: false, reason: "Источник отражаемой атаки недопустим." };
  }
  const catchChoice = request.catchChoice ?? null;
  if (catchChoice != null && !["catch", "skip"].includes(catchChoice)) {
    return { ok: false, reason: "Выбор поимки недопустим." };
  }
  return {
    ok: true,
    request: {
      kind: request.kind,
      damage: damage.value,
      deflectRoll: die.value,
      source: request.source,
      catchChoice,
      battleId: request.battleId ?? null,
      eventId: request.eventId ?? null,
      phaseAtOpen: request.phaseAtOpen ?? null,
      ownTurnIdAtOpen: request.ownTurnIdAtOpen ?? null,
    },
  };
}

export function incomingEventRequestsMatch(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    const request = value.kind === "completed-save" &&
      !Object.prototype.hasOwnProperty.call(value, "amendment")
      ? { ...value, amendment: null }
      : value;
    return Object.fromEntries(Object.keys(request).sort()
      .map((key) => [key, canonicalize(request[key])]));
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function previewIncomingEvent(state, request) {
  const pendingAmendment = request?.kind === "completed-save" &&
    request.amendment != null && request.outcome == null;
  const normalized = normalizeIncomingEventRequest(pendingAmendment
    ? { ...request, outcome: "failure", hasDamage: false, damage: null }
    : request, state);
  if (!normalized.ok) return normalized;
  if (normalized.request.kind === "ebb-and-flow") return { ok: true };
  if (normalized.request.kind === "deflection") {
    return calculateDeflectionPreview(state, buildDeflectionParameters(normalized.request));
  }
  if (normalized.request.kind === "completed-save") {
    const baseRecord = {
      ...normalized.calculated,
      manualOutcome: normalized.request.amendment?.baseOutcome ?? normalized.request.outcome,
      baseOutcome: normalized.request.amendment?.baseOutcome ?? normalized.request.outcome,
      dcResult: normalized.request.amendment
        ? false : normalized.request.outcome === "success",
    };
    const amendmentPreview = previewIncomingSaveAmendment(
      state, baseRecord, normalized.request.amendment,
    );
    if (!amendmentPreview.ok) return amendmentPreview;
    const calculated = amendmentPreview.record;
    calculated.manualOutcome = pendingAmendment ? null : normalized.request.outcome;
    calculated.dcResult = pendingAmendment
      ? calculated.dc == null ? null : calculated.total >= calculated.dc
      : normalized.request.outcome === "success";
    if (pendingAmendment) {
      return {
        ok: true,
        finalDamage: null,
        calculated,
        amendmentPreview,
        outcomePending: true,
      };
    }
    if (normalized.request.outcome === "unknown" || !normalized.request.hasDamage) {
      return { ok: true, finalDamage: 0, calculated, amendmentPreview };
    }
    return {
      ...calculateRollConsequencePreview(calculated, state, {
      damage: normalized.request.damage,
      damageBasis: normalized.request.damageBasis,
      effectProfile: normalized.request.effectProfile,
      }),
      calculated,
      amendmentPreview,
    };
  }
  const hp = Number(state.combat?.hp?.current);
  const tempHp = Number(state.combat?.hp?.temp ?? 0);
  return applyDamagePools(hp, tempHp, normalized.request.damage);
}

export function buildDeflectionParameters(request) {
  const projectile = request.source === "projectile";
  const catching = projectile && request.catchChoice === "catch";
  return {
    kind: projectile ? "missile" : "strike",
    mode: projectile ? "weapon" : "weapon-melee",
    incomingDamage: request.damage,
    deflectRoll: request.deflectRoll,
    applyDamageToSara: true,
    freeHand: catching,
    physicalProjectile: projectile,
    caught: catching,
  };
}

export function readIncomingEventReceipt(state, operationId) {
  const summaries = state?.monk?.combatAssistant?.recentlyCompletedSummaries;
  return Array.isArray(summaries)
    ? summaries.find((entry) => entry.id === operationId && entry.kind === "incoming-event") ?? null
    : null;
}

export function commitIncomingEvent(context, request, operationId) {
  if (!isCurrentSession(context)) return { status: "rejected", reason: "stale-session" };
  if (typeof operationId !== "string" || !operationId.trim()) {
    return { status: "rejected", reason: "Для входящего применения нужен operation ID." };
  }
  const normalized = normalizeIncomingEventRequest(request, getState());
  if (!normalized.ok) return { status: "rejected", reason: normalized.reason };
  const current = getState();
  const existing = readIncomingEventReceipt(current, operationId);
  if (existing) {
    if (!incomingEventRequestsMatch(existing.request, normalized.request)) {
      return {
        status: "rejected",
        code: "operation-id-collision",
        reason: "ID входящего применения уже связан с другим запросом.",
      };
    }
    return { status: "replayed", receipt: structuredClone(existing) };
  }
  const battle = current.battleConsole?.current ?? null;
  if (normalized.request.battleId !== (battle?.id ?? null)) {
    return { status: "rejected", reason: "Бой изменился; входящее событие устарело." };
  }
  if (normalized.request.phaseAtOpen !== (battle?.phase ?? "outside") ||
      normalized.request.battleId !== (battle?.id ?? null) ||
      normalized.request.ownTurnIdAtOpen !== (battle?.ownTurnId ?? null)) {
    return { status: "rejected", reason: "Ход или событие изменились; входящее применение устарело." };
  }
  let receipt = null;
  const result = updateSessionState(context, (draft) => {
    const active = draft.battleConsole?.current ?? null;
    if ((active?.id ?? null) !== normalized.request.battleId ||
        active && (!["waiting", "own-turn"].includes(active.phase) ||
          active.phase !== normalized.request.phaseAtOpen ||
          (active.ownTurnId ?? null) !== normalized.request.ownTurnIdAtOpen)) {
      throw new Error("Сцена больше не принимает входящее событие.");
    }
    const hpBefore = Number(draft.combat?.hp?.current);
    const tempHpBefore = Number(draft.combat?.hp?.temp ?? 0);
    let outcome;
    if (normalized.request.kind === "direct-damage") {
      const pools = previewIncomingEvent(draft, normalized.request);
      if (!pools.ok) throw new Error(pools.reason);
      draft.combat.hp.current = pools.hpAfter;
      draft.combat.hp.temp = pools.tempHpAfter;
      closeRestWindow(draft, "incoming-damage");
      outcome = { finalDamage: normalized.request.damage, ...pools };
    } else if (normalized.request.kind === "completed-save") {
      const breakdown = getSaraRollBreakdown(draft, "saving-throw", normalized.request.roll.id);
      if (!breakdown.ok) throw new Error(breakdown.reason);
      const calculated = calculateCharacterRoll({
        kind: "saving-throw",
        id: normalized.request.roll.id,
        firstD20: normalized.request.roll.firstD20,
        secondD20: normalized.request.roll.secondD20,
        rollMode: normalized.request.roll.rollMode,
        dc: normalized.request.roll.dc,
        incomingDamage: normalized.request.hasDamage
          ? normalized.request.damage : null,
        spellSaveSource: normalized.request.spellSaveSource,
        consequenceProfile: normalized.request.hasDamage === true &&
          normalized.request.damageBasis === "full-effect"
          ? normalized.request.effectProfile : "none",
      }, breakdown);
      if (!calculated.ok) throw new Error(calculated.reason);
      if (Object.prototype.hasOwnProperty.call(normalized.request, "baseOutcomeMode")) {
        const saveDraft = {
          ability: normalized.request.roll.id,
          source: normalized.request.spellSaveSource ? "spell" : "unknown",
          rollMode: normalized.request.roll.rollMode,
          firstD20: normalized.request.roll.firstD20,
          secondD20: normalized.request.roll.secondD20,
          dc: normalized.request.roll.dc,
          baseOutcomeMode: normalized.request.baseOutcomeMode,
          baseManualOutcome: normalized.request.baseManualOutcome,
          amendment: normalized.request.amendment?.techniqueId ?? null,
          finalOutcomeMode: normalized.request.finalOutcomeMode,
          finalManualOutcome: normalized.request.finalManualOutcome,
          hasDamage: normalized.request.outcome === "unknown" ? false : normalized.request.hasDamage,
          damage: normalized.request.damage,
          damageBasis: normalized.request.damageBasis ?? "dm-final",
          effectProfile: normalized.request.effectProfile,
        };
        const projection = projectSavingThrow(draft, saveDraft);
        if (!projection.ok || projection.canCommit !== true ||
            projection.baseOutcome !== normalized.request.baseOutcome ||
            projection.baseOutcomeSource !== normalized.request.baseOutcomeSource ||
            projection.finalOutcome !== normalized.request.finalOutcome ||
            projection.finalOutcomeSource !== normalized.request.finalOutcomeSource ||
            normalized.request.outcome !== projection.finalOutcome) {
          throw new Error(projection.reason ?? "Исход спасброска не совпадает с повторным расчётом.");
        }
      }
      const amendmentBaseRecord = {
        ...calculated,
        manualOutcome: normalized.request.amendment?.baseOutcome ?? normalized.request.outcome,
        baseOutcome: normalized.request.amendment?.baseOutcome ?? normalized.request.outcome,
        dcResult: normalized.request.amendment ? false :
          normalized.request.outcome === "success",
        appliedAmendments: [],
      };
      const amendmentPreview = previewIncomingSaveAmendment(
        draft, amendmentBaseRecord, normalized.request.amendment,
      );
      if (!amendmentPreview.ok) throw new Error(amendmentPreview.reason);
      const known = normalized.request.outcome !== "unknown";
      const record = amendmentPreview.record;
      delete record.baseOutcome;
      record.recordedAt = new Date().toISOString();
      record.id = operationId;
      if (Object.prototype.hasOwnProperty.call(normalized.request, "baseOutcomeMode")) {
        record.baseOutcome = normalized.request.baseOutcome;
        record.finalOutcome = normalized.request.finalOutcome;
        record.baseOutcomeSource = normalized.request.baseOutcomeSource;
        record.finalOutcomeSource = normalized.request.finalOutcomeSource;
        record.baseTotal = calculated.total;
        record.adjustedTotal = amendmentPreview.record.total;
        record.baseManualOutcome = normalized.request.baseManualOutcome;
        record.finalManualOutcome = normalized.request.finalManualOutcome;
        record.override = normalized.request.baseOutcomeMode === "manual" ||
          normalized.request.finalOutcomeMode === "manual";
      }
      record.manualOutcome = known &&
        (!Object.prototype.hasOwnProperty.call(normalized.request, "baseOutcomeMode") ||
          normalized.request.finalOutcomeSource === "manual")
        ? normalized.request.outcome : null;
      record.dcResult = known &&
        (!Object.prototype.hasOwnProperty.call(normalized.request, "baseOutcomeMode") ||
          normalized.request.finalOutcomeSource === "dc")
        ? normalized.request.outcome === "success" : null;
      record.consequence = null;
      record.incomingEventId = normalized.request.eventId;
      record.appliedAmendments ??= [];
      const kiBefore = Number(draft.combat?.ki?.current);
      if (amendmentPreview.selected) {
        if (!Number.isInteger(kiBefore) || kiBefore < 1) {
          throw new Error("Для Духа спокойствия требуется 1 ци.");
        }
        draft.combat.ki.current = kiBefore - 1;
        const appliedAmendment = {
          techniqueId: normalized.request.amendment.techniqueId,
          paidKi: 1,
          before: amendmentPreview.before,
          after: {
            ...amendmentPreview.after,
            outcome: normalized.request.outcome,
          },
          appliedAt: new Date().toISOString(),
        };
        record.appliedAmendments.push(appliedAmendment);
      }
      let saveOutcome = { status: "not-applied", finalDamage: 0 };
      if (known && normalized.request.hasDamage) {
        saveOutcome = calculateRollConsequencePreview(record, draft, {
          damage: normalized.request.damage,
          damageBasis: normalized.request.damageBasis,
          effectProfile: normalized.request.effectProfile,
        });
        if (!saveOutcome.ok) throw new Error(saveOutcome.reason);
        draft.combat.hp.current = saveOutcome.hpAfter;
        draft.combat.hp.temp = saveOutcome.tempHpAfter;
        record.consequence = {
          status: "applied",
          profile: saveOutcome.effectProfile,
          damageBasis: saveOutcome.damageBasis,
          originalDamage: saveOutcome.originalDamage,
          finalDamage: saveOutcome.finalDamage,
          evasionUsed: saveOutcome.evasionUsed,
          ruleExplanation: saveOutcome.ruleExplanation,
          hpBefore: saveOutcome.hpBefore,
          hpAfter: saveOutcome.hpAfter,
          tempHpBefore: saveOutcome.tempHpBefore,
          tempHpAfter: saveOutcome.tempHpAfter,
          outcomeAtApplication: normalized.request.outcome,
          resolvedAt: new Date().toISOString(),
        };
        saveOutcome = record.consequence;
      } else if (known) {
        record.consequence = {
          status: "no-damage",
          finalDamage: 0,
          outcomeAtApplication: normalized.request.outcome,
          resolvedAt: new Date().toISOString(),
        };
        saveOutcome = record.consequence;
      }
      draft.characterRolls ??= { records: [] };
      draft.characterRolls.records ??= [];
      if (draft.characterRolls.records.some((entry) => entry.id === operationId)) {
        throw new Error("ID спасброска уже использован.");
      }
      const pendingStatuses = new Set([
        "pending", "awaiting-outcome", "awaiting-damage-decision", "awaiting-damage-input",
      ]);
      const records = [...draft.characterRolls.records, record];
      const pending = records.filter((entry) => pendingStatuses.has(entry.consequence?.status));
      const completed = records.filter((entry) => !pendingStatuses.has(entry.consequence?.status))
        .slice(-30);
      draft.characterRolls.records = [...completed, ...pending];
      closeRestWindow(draft, "incoming-save");
      outcome = {
        rollId: record.id,
        roll: record,
        consequence: saveOutcome,
        amendment: amendmentPreview.selected ? {
          techniqueId: normalized.request.amendment.techniqueId,
          bonus: amendmentPreview.bonus,
          paidKi: 1,
          kiBefore,
          kiAfter: Number(draft.combat.ki.current),
          before: amendmentPreview.before,
          after: record.appliedAmendments.at(-1).after,
        } : null,
      };
    } else if (normalized.request.kind === "ebb-and-flow") {
      if (draft.profile?.id !== "sara-velaris" || Number(draft.profile.level) < 6) {
        throw new Error("Ebb & Flow доступна с 6 уровня.");
      }
      if (draft.monk?.combatAssistant?.activeSequences?.some((sequence) =>
        sequence.incomingReply?.eventId === normalized.request.eventId &&
        sequence.incomingReply?.replyKind === "ebb-unarmed")) {
        throw new Error("На это входящее событие уже выбран безоружный ответ Ebb & Flow.");
      }
      if (draft.ui?.turn?.reactionUsed === true) {
        throw new Error("Реакция уже использована в этом ходу.");
      }
      draft.ui.turn.reactionUsed = true;
      outcome = {
        response: "dexterity-save",
        kiSpent: 0,
        onFailedSave: "prone-and-speed-zero-until-end-of-target-turn",
        largerTargetHasAdvantage: true,
      };
    } else {
      const techniqueId = normalized.request.source === "projectile"
        ? "ll-monk:deflect-missile" : "ll-monk:deflect-strike";
      if (!getEffectiveSelectedTechniqueIds(draft).has(techniqueId)) {
        throw new Error("Техника отражения не выбрана или сейчас недоступна.");
      }
      const deflection = buildDeflectionParameters(normalized.request);
      const preview = calculateDeflectionPreview(draft, deflection);
      if (!preview.ok) throw new Error(preview.reason);
      const applied = applyMonkTechnique(draft, techniqueId, {
        confirmed: true,
        operationId,
        sessionGeneration: context.sessionGeneration,
        applyDamageToSara: true,
        incomingDamage: normalized.request.damage,
        deflectRoll: normalized.request.deflectRoll,
        finalAdjustedDamage: preview.finalRemainder,
        mode: deflection.mode,
        freeHand: deflection.freeHand,
        physicalProjectile: deflection.physicalProjectile,
        caught: deflection.caught && preview.finalRemainder === 0,
      });
      if (!applied.ok) throw new Error(applied.reason);
      draft.combat.hp.current = preview.damagePools.hpAfter;
      draft.combat.hp.temp = preview.damagePools.tempHpAfter;
      closeRestWindow(draft, "incoming-deflection");
      outcome = {
        incomingDamage: preview.incomingDamage,
        finalDamage: preview.finalRemainder,
        reduction: preview.reduction,
        rawRemainder: preview.rawRemainder,
        finalRemainder: preview.finalRemainder,
        techniqueResult: applied.result,
      };
    }
    draft.monk.combatAssistant ??= {
      schemaVersion: 1, activeSequences: [], pendingApplications: [], recentlyCompletedSummaries: [],
    };
    const assistant = draft.monk.combatAssistant;
    assistant.recentlyCompletedSummaries ??= [];
    receipt = {
      id: operationId,
      kind: "incoming-event",
      eventId: request.eventId ?? null,
      battleId: normalized.request.battleId,
      request: structuredClone(normalized.request),
      outcome: {
        hpBefore,
        hpAfter: Number(draft.combat.hp.current),
        tempHpBefore,
        tempHpAfter: Number(draft.combat.hp.temp ?? 0),
        effects: outcome,
      },
    };
    assistant.recentlyCompletedSummaries =
      [...assistant.recentlyCompletedSummaries, receipt].slice(-20);
    return draft;
  }, {
    operationId,
    metadata: { kind: "incoming-event-applied", eventId: request.eventId ?? null },
  });
  return result.status === "applied"
    ? { ...result, receipt: structuredClone(receipt) }
    : result;
}
