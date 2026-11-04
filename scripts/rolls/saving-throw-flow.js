import { getSaraRollBreakdown } from "./providers/sara.js";
import { calculateCharacterRoll } from "./calculations.js";
import { previewIncomingSaveAmendment } from "./incoming-save-amendment.js";
import { calculateRollConsequencePreview } from "./consequences.js";

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const OUTCOMES = ["success", "failure", "unknown"];

export function createSavingThrowDraft(options = {}) {
  const source = ["spell", "other", "unknown"].includes(options.source) ? options.source : "unknown";
  return {
    ability: ABILITIES.includes(options.ability) ? options.ability : "strength",
    source,
    rollMode: source === "spell" ? "advantage" :
      ["normal", "advantage", "disadvantage"].includes(options.rollMode) ? options.rollMode : "normal",
    firstD20: "",
    secondD20: "",
    dc: "",
    baseOutcomeMode: "auto",
    baseManualOutcome: null,
    amendment: null,
    finalOutcomeMode: "auto",
    finalManualOutcome: null,
    hasDamage: null,
    damage: "",
    damageBasis: "dm-final",
    effectProfile: null,
  };
}

function resolveOutcome(mode, manual, total, dc) {
  if (mode === "manual") {
    return OUTCOMES.includes(manual)
      ? { outcome: manual, source: "manual" }
      : { outcome: null, source: "unresolved" };
  }
  if (dc == null) return { outcome: null, source: "unresolved" };
  return { outcome: total >= dc ? "success" : "failure", source: "dc" };
}

export function projectSavingThrow(state, saveDraft) {
  if (!saveDraft || !ABILITIES.includes(saveDraft.ability)) {
    return { ok: false, reason: "Выберите характеристику спасброска." };
  }
  if (!["spell", "other", "unknown"].includes(saveDraft.source) ||
      saveDraft.source === "spell" && saveDraft.rollMode !== "advantage") {
    return { ok: false, reason: "Источник или режим спасброска недопустим." };
  }
  const breakdown = getSaraRollBreakdown(state, "saving-throw", saveDraft.ability);
  if (!breakdown.ok) return breakdown;
  const base = calculateCharacterRoll({
    kind: "saving-throw",
    id: saveDraft.ability,
    firstD20: saveDraft.firstD20,
    secondD20: saveDraft.secondD20,
    rollMode: saveDraft.rollMode,
    dc: saveDraft.dc,
    spellSaveSource: saveDraft.source === "spell",
  }, breakdown);
  if (!base.ok) return base;
  delete base.recordedAt;
  base.baseOutcome = null;
  const baseResolved = resolveOutcome(saveDraft.baseOutcomeMode, saveDraft.baseManualOutcome, base.total, base.dc);
  base.baseOutcome = baseResolved.outcome;
  if (baseResolved.source === "manual" && baseResolved.outcome !== "unknown") {
    base.manualOutcome = baseResolved.outcome;
  }

  const amendmentAvailability = baseResolved.outcome === "failure"
    ? previewIncomingSaveAmendment(state, base, null)
    : null;
  let amendmentPreview = null;
  let finalRecord = base;
  let finalResolved = baseResolved;
  if (saveDraft.amendment) {
    if (baseResolved.outcome !== "failure") {
      return { ok: false, reason: "Поправка доступна только после известного провала." };
    }
    amendmentPreview = previewIncomingSaveAmendment(state, base, {
      techniqueId: saveDraft.amendment,
      baseOutcome: "failure",
    });
    if (!amendmentPreview.ok) return amendmentPreview;
    finalRecord = amendmentPreview.record;
    finalResolved = resolveOutcome(saveDraft.finalOutcomeMode, saveDraft.finalManualOutcome, finalRecord.total, base.dc);
    finalRecord.baseOutcome = baseResolved.outcome;
    finalRecord.manualOutcome = finalResolved.source === "manual" && finalResolved.outcome !== "unknown"
      ? finalResolved.outcome : null;
    finalRecord.dcResult = base.dc == null ? null : finalRecord.total >= base.dc;
  }
  const needsOutcome = finalResolved.outcome == null;
  const needsConsequenceChoice = !needsOutcome && finalResolved.outcome !== "unknown" &&
    saveDraft.hasDamage == null;
  let consequencePreview = null;
  if (!needsOutcome && finalResolved.outcome !== "unknown" && saveDraft.hasDamage === true) {
    const consequenceRecord = { ...finalRecord, manualOutcome: finalResolved.source === "manual" ? finalResolved.outcome : null,
      dcResult: finalResolved.source === "dc" ? finalResolved.outcome === "success" : null };
    consequencePreview = calculateRollConsequencePreview(consequenceRecord, state, {
      damage: saveDraft.damage,
      damageBasis: saveDraft.damageBasis,
      effectProfile: saveDraft.effectProfile,
    });
    if (!consequencePreview.ok) return consequencePreview;
  }
  return {
    ok: true, baseRecord: base, baseOutcome: baseResolved.outcome,
    baseOutcomeSource: baseResolved.source, amendmentAvailability, amendmentPreview,
    finalRecord, finalOutcome: finalResolved.outcome, finalOutcomeSource: finalResolved.source,
    needsOutcome, needsConsequenceChoice, consequencePreview,
    canCommit: !needsOutcome && !needsConsequenceChoice && (saveDraft.hasDamage !== true || Boolean(consequencePreview)),
  };
}

export function buildCompletedSaveRequest(identity, projection, saveDraft) {
  if (!projection?.ok) return null;
  const outcome = projection.finalOutcome ?? "unknown";
  const hasDamage = outcome !== "unknown" && saveDraft.hasDamage === true;
  return {
    kind: "completed-save",
    ...identity,
    outcome,
    baseOutcome: projection.baseOutcome,
    baseOutcomeSource: projection.baseOutcomeSource,
    finalOutcome: projection.finalOutcome,
    finalOutcomeSource: projection.finalOutcomeSource,
    baseManualOutcome: projection.baseOutcomeSource === "manual" ? saveDraft.baseManualOutcome : null,
    finalManualOutcome: projection.finalOutcomeSource === "manual" ? saveDraft.finalManualOutcome : null,
    amendment: saveDraft.amendment ? { techniqueId: saveDraft.amendment, baseOutcome: "failure" } : null,
    hasDamage,
    damage: hasDamage ? saveDraft.damage : null,
    damageBasis: hasDamage ? saveDraft.damageBasis : null,
    effectProfile: hasDamage && saveDraft.damageBasis === "full-effect" ? saveDraft.effectProfile : null,
    spellSaveSource: saveDraft.source === "spell",
    roll: {
      id: saveDraft.ability, firstD20: saveDraft.firstD20, secondD20: saveDraft.secondD20,
      rollMode: saveDraft.rollMode, dc: saveDraft.dc,
    },
  };
}
