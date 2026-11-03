import { getDerivedStats } from "../calculations.js";
import {
  changeQuantity,
  completeRest,
  declineRestReplacement,
  finishShortRest,
  previewPotion,
  replaceRestTechnique,
  spendHitDie,
  usePotion,
} from "../sara-functional.js";
import { executeBattleBoundaryInDraft } from "../battle/commands.js";
import { commitFunctionalSessionOperation } from "../state.js";
import {
  createTechniqueDraft,
  validateTechniqueDraft,
} from "../technique-editor.js";

function commit(owner, request, kind, execute) {
  return commitFunctionalSessionOperation(owner, request.id, execute, {
    metadata: { kind, functionalOperationId: request.id },
  });
}

export function changeSaraItemQuantity(owner, request) {
  return commit(owner, request, "sara-quantity",
    (state) => changeQuantity(state, request));
}

export function previewSaraPotion(state, request) {
  return previewPotion(state, request, getDerivedStats);
}

export function useSaraPotion(owner, request) {
  return commit(owner, request, "sara-potion",
    (state) => usePotion(state, request, getDerivedStats));
}

export function completeSaraRest(owner, request) {
  return commit(owner, request, "sara-rest",
    (state) => completeRest(state, request, getDerivedStats,
      (draft, kind) => executeBattleBoundaryInDraft(draft, `${kind}-rest`)));
}

export function spendSaraHitDie(owner, request) {
  return commit(owner, request, "sara-hit-die",
    (state) => spendHitDie(state, request, getDerivedStats));
}

export function finishSaraShortRest(owner, request) {
  return commit(owner, request, "sara-finish-short-rest",
    (state) => finishShortRest(state, request));
}

export function declineSaraRestReplacement(owner, request) {
  return commit(owner, request, "sara-decline-rest-replacement",
    (state) => declineRestReplacement(state, request));
}

export function replaceSaraRestTechnique(owner, request) {
  return commit(owner, request, "sara-rest-replacement", (state) =>
    replaceRestTechnique(state, request, (candidate, { remove, add, entitlement }) => {
      const context = {
        characterId: owner.characterId,
        sessionGeneration: owner.sessionGeneration,
        stateRevision: owner.stateRevision,
      };
      const before = structuredClone(candidate);
      const replacedIndex = before.monk.ordinaryTechniqueIds.indexOf(add);
      if (replacedIndex < 0) {
        return { ok: false, reason: "Новая техника не найдена в наборе замены." };
      }
      before.monk.ordinaryTechniqueIds[replacedIndex] = remove;
      const draft = createTechniqueDraft(before, context, entitlement);
      draft.ordinaryTechniqueIds = [...candidate.monk.ordinaryTechniqueIds];
      draft.signatureTechniqueSlots = structuredClone(candidate.monk.signatureTechniqueSlots ?? {});
      draft.techniqueChoices = structuredClone(candidate.monk.techniqueChoices ?? {});
      const differences = validateTechniqueDraft(before, draft, context);
      if (differences.length) return { ok: false, reason: differences.join(" ") };
      if (!draft.ordinaryTechniqueIds.includes(add) || draft.ordinaryTechniqueIds.includes(remove)) {
        return { ok: false, reason: "Замена не соответствует выбранной обычной технике." };
      }
      return { ok: true };
    }));
}
