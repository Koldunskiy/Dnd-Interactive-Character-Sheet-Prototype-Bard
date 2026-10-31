import {
  CLERIC_CANTRIPS,
  MONK_TECHNIQUE_BY_ID,
  WARRIOR_ADEPT_STYLES
} from "../data/monk-techniques.js";

const SIGNATURE_LEVELS = [3, 5, 9];

export function createTechniqueDraft(character, context, entitlementEvent) {
  return {
    characterId: context.characterId,
    sessionGeneration: context.sessionGeneration,
    baseRevision: context.stateRevision,
    entitlementEventId: entitlementEvent.id,
    entitlementEvent: structuredClone(entitlementEvent),
    baseOrdinaryTechniqueIds: [...(character.monk?.ordinaryTechniqueIds ?? [])],
    baseSignatureTechniqueSlots: structuredClone(character.monk?.signatureTechniqueSlots ?? {}),
    baseTechniqueChoices: structuredClone(character.monk?.techniqueChoices ?? {}),
    ordinaryTechniqueIds: [...(character.monk?.ordinaryTechniqueIds ?? [])],
    signatureTechniqueSlots: structuredClone(character.monk?.signatureTechniqueSlots ?? {}),
    techniqueChoices: structuredClone(character.monk?.techniqueChoices ?? {})
  };
}

function getChosenIds(draft) {
  return [...draft.ordinaryTechniqueIds, ...Object.values(draft.signatureTechniqueSlots)];
}

function countDifferences(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: [...afterSet].filter((id) => !beforeSet.has(id)),
    removed: [...beforeSet].filter((id) => !afterSet.has(id))
  };
}

function styleRequirementFailure(styleId, character) {
  const style = WARRIOR_ADEPT_STYLES.find((entry) => entry.id === styleId);
  if (!style) return "Выберите один из семи опубликованных стилей.";
  const abilities = character.abilities ?? {};
  const skills = new Set((character.skills ?? []).filter((entry) => entry.proficient || entry.expertise).map((entry) => entry.id));
  for (const requirement of style.prerequisites) {
    if (requirement === "DEX 13" && Number(abilities.dexterity) < 13) return "Для этого стиля требуется DEX 13.";
    if (requirement === "STR 11" && Number(abilities.strength) < 11) return "Для этого стиля требуется STR 11.";
    if (requirement === "STR 11 или DEX 11" && Number(abilities.strength) < 11 && Number(abilities.dexterity) < 11) {
      return "Для этого стиля требуется STR 11 или DEX 11.";
    }
    if (requirement === "Владение Восприятием" && !skills.has("perception")) return "Для этого стиля требуется базовое владение Восприятием.";
    if (requirement === "Акробатика" && !skills.has("acrobatics")) return "Для этого стиля требуется базовое владение Акробатикой.";
  }
  return null;
}

export function validateTechniqueDraft(character, draft, context) {
  const reasons = [];
  if (context.characterId !== draft.characterId ||
      context.sessionGeneration !== draft.sessionGeneration ||
      context.stateRevision !== draft.baseRevision) {
    reasons.push("Сессия или ревизия изменилась; обновите черновик.");
    return reasons;
  }
  const event = draft.entitlementEvent;
  const recordedEvent = (character.monk?.replacementEntitlements ?? [])
    .find((entry) => entry.id === event?.id && !entry.consumed);
  if (!event?.id || event.id !== draft.entitlementEventId ||
      !recordedEvent ||
      event.type !== recordedEvent.type ||
      (recordedEvent.level != null && Number(event.level) !== Number(recordedEvent.level)) ||
      (character.monk?.replacementEvents ?? []).some((entry) => entry.id === event.id && entry.consumed)) {
    reasons.push("Право на замену отсутствует или уже использовано.");
  }
  if (recordedEvent?.type === "rest" &&
      (Number(recordedEvent.createdAtLevel) < 10 ||
       Number(character.monk?.ordinaryReplacementCredit) !== 1)) {
    reasons.push("Замена после отдыха доступна только после подтверждённой 10-минутной практики Open Hand с 10 уровня.");
  }
  if (recordedEvent?.type === "level-up" &&
      Number(character.profile?.level) !== Number(recordedEvent.level)) {
    reasons.push("Право повышения уровня относится не к текущему оформленному уровню.");
  }
  if (!Array.isArray(draft.ordinaryTechniqueIds) || !draft.signatureTechniqueSlots ||
      typeof draft.signatureTechniqueSlots !== "object") {
    return [...reasons, "Черновик выбора имеет неверную форму."];
  }

  const allIds = getChosenIds(draft);
  const beforeIds = [
    ...(character.monk?.ordinaryTechniqueIds ?? []),
    ...Object.values(character.monk?.signatureTechniqueSlots ?? {})
  ];
  if (new Set(allIds).size !== allIds.length) reasons.push("Нельзя выбрать одну технику в нескольких слотах.");
  for (const id of allIds) {
    const entry = MONK_TECHNIQUE_BY_ID.get(id);
    if (!entry) {
      reasons.push(`Неизвестная техника: ${id}.`);
    } else if (entry.minimumMonkLevel > Number(character.profile?.level ?? 1)) {
      reasons.push(`${entry.nameRu}: требуется уровень ${entry.minimumMonkLevel}.`);
    }
  }

  const level = Number(character.profile?.level ?? 1);
  const ordinaryLimit = level === 1 ? 0 : level <= 4 ? 3 : level <= 6 ? 4 :
    level <= 8 ? 5 : level <= 10 ? 6 : level <= 12 ? 7 : level <= 14 ? 8 :
      level <= 17 ? 9 : 10;
  if (draft.ordinaryTechniqueIds.length > ordinaryLimit) reasons.push(`Обычных техник может быть не больше ${ordinaryLimit}.`);
  const slots = draft.signatureTechniqueSlots;
  const signatureBefore = character.monk?.signatureTechniqueSlots ?? {};
  for (const slotLevel of SIGNATURE_LEVELS) {
    const slot = `open-hand:${slotLevel}`;
    if (level >= slotLevel && !slots[slot]) reasons.push(`Заполните обязательный слот ${slot}.`);
    if (level < slotLevel && slots[slot]) reasons.push(`Слот ${slot} ещё не открыт.`);
  }
  for (const [slot, id] of Object.entries(slots)) {
    if (!SIGNATURE_LEVELS.map((value) => `open-hand:${value}`).includes(slot)) reasons.push(`Неизвестный слот: ${slot}.`);
    if (id && !MONK_TECHNIQUE_BY_ID.has(id)) continue;
    if (id && id !== signatureBefore[slot] &&
        !MONK_TECHNIQUE_BY_ID.get(id).eligibleStrike) {
      reasons.push(`${id} нельзя поместить в слот Signature Strike.`);
    }
  }

  const before = character.monk?.ordinaryTechniqueIds ?? [];
  const after = draft.ordinaryTechniqueIds;
  const ordinaryChanges = countDifferences(before, after);
  const signatureChanges = Object.keys({ ...signatureBefore, ...slots }).filter((key) => signatureBefore[key] !== slots[key]);
  if (event.type === "rest") {
    if (ordinaryChanges.added.length !== 1 || ordinaryChanges.removed.length !== 1 || signatureChanges.length) {
      reasons.push("Отдых разрешает ровно одну обычную замену; Signature Strike менять нельзя.");
    }
  } else if (event.type === "level-up") {
    if (Number(event.level) !== Number(character.monk?.processedLevel ?? level) + 1) {
      reasons.push("Уровни оформляются только последовательно, по одному.");
    }
    const previousLevel = Number(character.monk?.processedLevel ?? level - 1);
    const previousLimit = previousLevel === 1 ? 0 : previousLevel <= 4 ? 3 : previousLevel <= 6 ? 4 :
      previousLevel <= 8 ? 5 : previousLevel <= 10 ? 6 : previousLevel <= 12 ? 7 :
        previousLevel <= 14 ? 8 : previousLevel <= 17 ? 9 : 10;
    const addedSignature = signatureChanges.filter((slot) => !signatureBefore[slot] && slots[slot]);
    const addedSignatureIds = new Set(addedSignature.map((slot) => slots[slot]).filter(Boolean));
    const relocatedToSignature = ordinaryChanges.removed
      .filter((id) => addedSignatureIds.has(id));
    const discretionaryRemovals = ordinaryChanges.removed.length - relocatedToSignature.length;
    const earnedSlots = ordinaryLimit - previousLimit;
    if (earnedSlots < 0) reasons.push("Число обычных слотов не может уменьшаться при повышении уровня.");
    if (draft.ordinaryTechniqueIds.length !== before.length + earnedSlots) {
      reasons.push(`На этом уровне итоговое число обычных техник должно быть ${before.length + earnedSlots}.`);
    }
    const expectedAdditions = earnedSlots + relocatedToSignature.length + discretionaryRemovals;
    if (discretionaryRemovals > 1 || ordinaryChanges.added.length !== expectedAdditions) {
      reasons.push("Повышение уровня допускает только одну дополнительную замену сверх новых и перенесённых слотов.");
    }
    const changedExistingSignatures = signatureChanges.filter((slot) => signatureBefore[slot] && slots[slot]);
    const expectedSlot = `open-hand:${event.level}`;
    if (Number(event.level) === 3 || Number(event.level) === 5 || Number(event.level) === 9) {
      if (!addedSignature.includes(expectedSlot)) reasons.push(`Повышение до ${event.level} уровня открывает слот ${expectedSlot}.`);
    }
    if (addedSignature.some((slot) => slot !== expectedSlot) || changedExistingSignatures.length > 1) {
      reasons.push("Повышение уровня разрешает только новый достигнутый слот и не более одной замены Signature Strike.");
    }
  } else {
    reasons.push("Неизвестное основание выбора техник.");
  }

  const newSelections = [...ordinaryChanges.added, ...signatureChanges.map((slot) => slots[slot]).filter(Boolean)];
  for (const id of newSelections) {
    const entry = MONK_TECHNIQUE_BY_ID.get(id);
    if (entry?.prerequisites?.some((requiredId) => !allIds.includes(requiredId))) {
      reasons.push(`${entry.nameRu}: обязательная техника не выбрана в итоговом наборе.`);
    }
  }

  for (const id of newSelections) {
    const choices = draft.techniqueChoices?.[id] ?? {};
    if (id === "ll-monk:divine-light") {
      const selected = choices.clericCantripIds;
      if (!Array.isArray(selected) || selected.length !== 2 ||
          new Set(selected).size !== 2 ||
          selected.some((choice) => !CLERIC_CANTRIPS.some((spell) => spell.id === choice))) {
        reasons.push("Divine Light требует ровно два разных заговора из опубликованного списка.");
      }
    }
    if (id === "ll-monk:warrior-adept") {
      const styleId = choices.styleId;
      if (!styleId) reasons.push("Warrior Adept требует ровно один стиль.");
      else {
        const issue = styleRequirementFailure(styleId, character);
        if (issue) reasons.push(issue);
      }
    }
  }
  return reasons;
}

export function applyTechniqueDraft(character, draft, context) {
  const reasons = validateTechniqueDraft(character, draft, context);
  if (reasons.length) return { status: "rejected", reasons };
  const next = structuredClone(character);
  next.monk.ordinaryTechniqueIds = [...draft.ordinaryTechniqueIds];
  next.monk.signatureTechniqueSlots = structuredClone(draft.signatureTechniqueSlots);
  next.monk.techniqueChoices = structuredClone(draft.techniqueChoices);
  next.monk.replacementEvents ??= [];
  next.monk.replacementEvents.push({ id: draft.entitlementEventId, type: draft.entitlementEvent.type, consumed: true });
  next.monk.replacementEntitlements ??= [];
  next.monk.replacementEntitlements = next.monk.replacementEntitlements.map((event) =>
    event.id === draft.entitlementEventId ? { ...event, consumed: true } : event);
  if (draft.entitlementEvent.type === "rest") next.monk.ordinaryReplacementCredit = 0;
  if (draft.entitlementEvent.type === "level-up") next.monk.processedLevel = Number(draft.entitlementEvent.level);
  return { status: "applied", state: next };
}
