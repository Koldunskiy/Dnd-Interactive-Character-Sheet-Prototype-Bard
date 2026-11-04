import { getDerivedStats } from "../calculations.js";
import { getEffectiveTechniqueIds } from "../selectors/techniques.js";

export const SPIRIT_OF_TRANQUILITY_ID = "base:spirit-of-tranquility";

function validBaseRecord(record) {
  return record && record.kind === "saving-throw" &&
    Number.isInteger(record.chosenD20) &&
    Number.isFinite(record.totalModifier) &&
    Number.isFinite(record.total) &&
    Array.isArray(record.rawD20Rolls) &&
    Array.isArray(record.modifierSnapshot) &&
    (record.appliedAmendments == null || Array.isArray(record.appliedAmendments)) &&
    record.rawD20Rolls.length > 0;
}

function validateSelection(selection) {
  if (selection == null) return { ok: true, selected: false };
  if (!selection || typeof selection !== "object" || Array.isArray(selection) ||
      Object.keys(selection).length !== 2 ||
      selection.techniqueId !== SPIRIT_OF_TRANQUILITY_ID ||
      selection.baseOutcome !== "failure") {
    return {
      ok: false,
      selected: true,
      reason: "Выберите допустимую поправку после известного провала спасброска.",
    };
  }
  return { ok: true, selected: true };
}

export function previewIncomingSaveAmendment(state, baseRecord, selection = null) {
  const parsedSelection = validateSelection(selection);
  if (!parsedSelection.ok) {
    return {
      ok: false, availability: false, reason: parsedSelection.reason,
      selected: true, paidKi: 0, bonus: 0, before: null, after: null, record: null,
    };
  }
  if (!validBaseRecord(baseRecord)) {
    return {
      ok: false, availability: false, reason: "Базовая запись спасброска недопустима.",
      selected: parsedSelection.selected, paidKi: 0, bonus: 0,
      before: null, after: null, record: null,
    };
  }

  const record = structuredClone(baseRecord);
  const level = Number(state?.profile?.level);
  const hasFeature = getEffectiveTechniqueIds(state)
    .includes(SPIRIT_OF_TRANQUILITY_ID);
  const recordBaseOutcome = record.baseOutcome ?? record.manualOutcome ?? null;
  let availabilityReason = null;
  if (state?.profile?.id !== "sara-velaris") {
    availabilityReason = "Дух спокойствия доступен только Саре.";
  } else if (!Number.isInteger(level) || level < 9 || !hasFeature) {
    availabilityReason = "Дух спокойствия доступен монаху Сары с 9 уровня.";
  } else if (record.kind !== "saving-throw") {
    availabilityReason = "Дух спокойствия применяется только к спасброску.";
  } else if ((record.baseOutcome != null && record.manualOutcome != null &&
      record.baseOutcome !== record.manualOutcome) ||
      recordBaseOutcome !== "failure" ||
      selection?.baseOutcome != null && selection.baseOutcome !== recordBaseOutcome) {
    availabilityReason = "Дух спокойствия можно выбрать только после известного провала.";
  } else if (record.appliedAmendments?.some((entry) =>
    entry.techniqueId === SPIRIT_OF_TRANQUILITY_ID)) {
    availabilityReason = "Дух спокойствия уже применён к этой записи.";
  } else if (!Number.isInteger(Number(state?.combat?.ki?.current)) ||
      Number(state.combat.ki.current) < 1) {
    availabilityReason = "Для Духа спокойствия требуется 1 ци.";
  }

  const availability = availabilityReason == null;
  const before = {
    chosenD20: record.chosenD20,
    modifier: record.totalModifier,
    total: record.total,
    outcome: recordBaseOutcome,
  };
  if (!parsedSelection.selected) {
    return {
      ok: true,
      availability,
      reason: availabilityReason,
      selected: false,
      paidKi: 0,
      bonus: 0,
      before,
      after: { ...before },
      record,
    };
  }
  if (!availability) {
    return {
      ok: false, availability: false, reason: availabilityReason,
      selected: true, paidKi: 0, bonus: 0, before, after: null, record,
    };
  }

  const bonus = Number(getDerivedStats(state).abilityModifiers?.wisdom);
  if (!Number.isFinite(bonus)) {
    return {
      ok: false, availability: false,
      reason: "Не удалось определить модификатор Мудрости.",
      selected: true, paidKi: 0, bonus: 0, before, after: null, record,
    };
  }
  record.totalModifier += bonus;
  record.total += bonus;
  record.modifierSnapshot.push({
    id: SPIRIT_OF_TRANQUILITY_ID,
    label: "Дух спокойствия — Мудрость",
    value: bonus,
  });
  return {
    ok: true,
    availability: true,
    reason: null,
    selected: true,
    paidKi: 1,
    bonus,
    before,
    after: {
      chosenD20: record.chosenD20,
      modifier: record.totalModifier,
      total: record.total,
      outcome: null,
    },
    record,
  };
}
