import { ALTERNATE_MONK_RULESET_ID } from "../rules/alternate-monk.js";

export const SARA_BUILD_PATCH_ID = "sara-build-2026-10-31";

const OLD_DEFAULT_TECHNIQUES = [
  "ll-monk:crippling-strike",
  "ll-monk:deflect-strike",
  "ll-monk:step-of-the-wind",
  "ll-monk:heavenly-step",
  "ll-monk:deflect-missile",
  "ll-monk:mantle-of-courtesy",
  "ll-monk:mystic-regeneration"
];
const NEW_DEFAULT_TECHNIQUES = OLD_DEFAULT_TECHNIQUES
  .filter((id) => id !== "ll-monk:heavenly-step")
  .concat("ll-monk:slowing-strike");

function sorted(values) {
  return [...values].sort();
}

function sameSet(left, right) {
  return left.length === right.length &&
    sorted(left).every((value, index) => value === sorted(right)[index]);
}

function fingerprint(character) {
  return JSON.stringify({
    ordinaryTechniqueIds: character.monk?.ordinaryTechniqueIds ?? [],
    itemIdentities: (character.inventory?.items ?? []).map((item) => ({
      id: item?.id,
      name: item?.name,
      quantity: item?.quantity,
      equipped: item?.equipped
    })),
    markers: character.monk?.buildUpdateMarkers ?? {}
  });
}

export function proposeSaraBuildUpdate(character) {
  if (character?.profile?.id !== "sara-velaris" ||
      character.profile.rulesetId !== ALTERNATE_MONK_RULESET_ID) {
    return { status: "not-applicable" };
  }
  const markers = character.monk?.buildUpdateMarkers ?? {};
  const marker = markers[SARA_BUILD_PATCH_ID];
  if (marker) return { status: "already-current", marker };

  const currentIds = character.monk?.ordinaryTechniqueIds ?? [];
  let techniqueDelta = null;
  const conflicts = [];
  if (sameSet(currentIds, OLD_DEFAULT_TECHNIQUES)) {
    techniqueDelta = {
      remove: "ll-monk:heavenly-step",
      add: "ll-monk:slowing-strike",
      oldSelection: [...currentIds]
    };
  } else if (sameSet(currentIds, NEW_DEFAULT_TECHNIQUES)) {
    techniqueDelta = { alreadyApplied: true };
  } else {
    conflicts.push({
      kind: "custom-techniques",
      currentIds: [...currentIds],
      proposed: { remove: "ll-monk:heavenly-step", add: "ll-monk:slowing-strike" }
    });
  }

  const items = Array.isArray(character.inventory?.items) ? character.inventory.items : [];
  const insignia = items.filter((item) => item?.id === "insignia-of-claws");
  if (insignia.length > 1) {
    conflicts.push({ kind: "duplicate-insignia", count: insignia.length });
  } else if (insignia.length === 0) {
    const similarName = items.find((item) =>
      ["эмблема когтей", "insignia of claws"].includes(
        String(item?.name ?? "").trim().toLocaleLowerCase("ru")
      ));
    if (similarName) {
      conflicts.push({ kind: "ambiguous-insignia", itemId: similarName.id, itemName: similarName.name });
    }
  }

  const itemDelta = insignia.length === 0 && !conflicts.some((conflict) =>
    conflict.kind === "ambiguous-insignia" || conflict.kind === "duplicate-insignia")
    ? { addId: "insignia-of-claws", wearAfterAdding: true }
    : null;
  if (!techniqueDelta?.remove && !itemDelta && conflicts.length === 0) {
    return { status: "already-current" };
  }

  return {
    status: "proposal",
    patchId: SARA_BUILD_PATCH_ID,
    baseFingerprint: fingerprint(character),
    techniqueDelta,
    itemDelta,
    conflicts,
    preservedFieldsSummary: [
      "Текущие ресурсы",
      "Заметки и биография",
      "История отдыха",
      "Прочие предметы и пользовательские поля"
    ]
  };
}

export function applySaraBuildUpdate(character, proposal, decisions = {}) {
  if (proposal?.status !== "proposal" ||
      proposal.patchId !== SARA_BUILD_PATCH_ID ||
      proposal.baseFingerprint !== fingerprint(character)) {
    return { status: "rejected", reason: "Состояние Сары изменилось; обновите предварительный просмотр." };
  }
  const next = structuredClone(character);
  const markers = next.monk.buildUpdateMarkers ??= {};
  const patchMarker = {};

  if (proposal.techniqueDelta?.remove && decisions.techniques === "apply") {
    const ids = next.monk.ordinaryTechniqueIds;
    const removeIndex = ids.indexOf(proposal.techniqueDelta.remove);
    if (removeIndex < 0 || ids.includes(proposal.techniqueDelta.add)) {
      return { status: "rejected", reason: "Набор техник изменился и не совпадает с просмотренным обновлением." };
    }
    ids[removeIndex] = proposal.techniqueDelta.add;
    patchMarker.techniques = "applied";
  } else if (proposal.conflicts.some((conflict) => conflict.kind === "custom-techniques") &&
      decisions.techniques === "keep") {
    patchMarker.techniques = "kept";
  } else if (proposal.techniqueDelta?.alreadyApplied) {
    patchMarker.techniques = "already-current";
  }

  if (proposal.itemDelta && decisions.insignia === "add") {
    const currentItems = next.inventory?.items;
    if (!Array.isArray(currentItems) ||
        currentItems.some((item) => item?.id === "insignia-of-claws")) {
      return { status: "rejected", reason: "Инвентарь изменился; эмблема не добавлена." };
    }
    currentItems.push({
      id: "insignia-of-claws",
      type: "misc",
      name: "Эмблема когтей",
      quantity: 1,
      equipped: decisions.wearInsignia !== false,
      requiresAttunement: false,
      rarity: "uncommon",
      description: "При ношении даёт +1 к броскам попадания и урона безоружных атак и природного оружия; эти атаки считаются магическими. Не повышает СЛ техник, КД, лечение, снижение урона или характеристики оружейных атак.",
      appearance: "Брошь дома Веларис: овальный бронзовый щит со змеёй вокруг сливового аметиста, графитовой эмалью и потёртыми краями.",
      notes: "",
      tags: ["магическое"],
      weapon: null,
      armor: null
    });
    patchMarker.insignia = "added";
  } else if (!proposal.itemDelta && !proposal.conflicts.some((conflict) =>
    conflict.kind === "ambiguous-insignia" || conflict.kind === "duplicate-insignia")) {
    patchMarker.insignia = "already-owned";
  }

  const unresolvedConflicts = proposal.conflicts.filter((conflict) =>
    !(conflict.kind === "custom-techniques" && decisions.techniques === "keep"));
  if (unresolvedConflicts.length) {
    return { status: "rejected", reason: "Есть неразрешённые конфликты инвентаря или выбора техник." };
  }
  if (!Object.keys(patchMarker).length) {
    return { status: "rejected", reason: "Подтвердите хотя бы одно изменение или сохранение собственного набора." };
  }
  markers[SARA_BUILD_PATCH_ID] = patchMarker;
  return { status: "applied", state: next, marker: patchMarker };
}
