import { parsePhysicalInteger } from "../combat/physical-input.js";

export function calculateCharacterRoll(input, breakdown) {
  if (!breakdown || !["ability-check", "saving-throw"].includes(input?.kind)) {
    return { ok: false, reason: "Выберите проверку характеристики, навык или спасбросок." };
  }
  if (input.kind === "ability-check" && !breakdown.ability) {
    return { ok: false, reason: "Для проверки не определена характеристика." };
  }
  if (input.kind === "saving-throw" && !breakdown.savingThrow) {
    return { ok: false, reason: "Не удалось определить спасбросок." };
  }
  if (input.skillId && !breakdown.skillId) {
    return { ok: false, reason: "Выбранный навык не подходит этому броску." };
  }
  const selected = input.d20InputMode === "selected";
  if (input.d20InputMode != null && !selected) {
    return { ok: false, reason: "Неизвестный способ ввода к20." };
  }
  if (selected ? input.rollMode !== "preselected"
      : !["normal", "advantage", "disadvantage"].includes(input.rollMode)) {
    return { ok: false, reason: "Способ ввода и режим броска не согласованы." };
  }
  if (selected && input.secondD20 != null && String(input.secondD20).trim() !== "") {
    return { ok: false, reason: "Для выбранного результата укажите только один к20." };
  }
  if (input.spellSaveSource === true &&
      (input.kind !== "saving-throw" || (!selected && input.rollMode !== "advantage"))) {
    return {
      ok: false,
      reason: "Сопротивление магии Юань-ти применимо к спасброску от заклинания: выберите преимущество.",
    };
  }
  const first = parsePhysicalInteger(input.firstD20, 1, 20,
    selected ? "Выбранный физический к20" : "Первый к20");
  if (!first.ok) return first;
  const rawRolls = [first.value];
  if (!selected && input.rollMode !== "normal") {
    const second = parsePhysicalInteger(input.secondD20, 1, 20, "Второй к20");
    if (!second.ok) return second;
    rawRolls.push(second.value);
  }
  const chosenD20 = selected ? first.value
    : input.rollMode === "advantage" ? Math.max(...rawRolls)
      : input.rollMode === "disadvantage" ? Math.min(...rawRolls) : first.value;
  const modifier = breakdown.totalModifier;
  const total = chosenD20 + modifier;
  const dc = input.dc == null || String(input.dc).trim() === ""
    ? null
    : parsePhysicalInteger(input.dc, 1, 99, "Сложность");
  if (dc && !dc.ok) return dc;
  const incomingDamage = input.incomingDamage == null ||
    String(input.incomingDamage).trim() === ""
    ? null
    : parsePhysicalInteger(input.incomingDamage, 0, Number.MAX_SAFE_INTEGER, "Урон события");
  if (incomingDamage && !incomingDamage.ok) return incomingDamage;
  const consequenceProfile = input.consequenceProfile ?? "none";
  if (!["none", "failure-full", "save-half"].includes(consequenceProfile)) {
    return { ok: false, reason: "Выберите применимый профиль последствий." };
  }
  if ((consequenceProfile !== "none") &&
      (input.kind !== "saving-throw" || incomingDamage?.value == null)) {
    return { ok: false, reason: "Для последствий спасброска укажите урон и тип его применения." };
  }
  return {
    ok: true,
    kind: input.kind,
    ability: breakdown.ability,
    skillId: breakdown.skillId ?? null,
    label: breakdown.label,
    rawD20Rolls: rawRolls,
    chosenD20,
    rollMode: input.rollMode,
    ...(selected ? { d20InputMode: "selected" } : {}),
    modifierSnapshot: structuredClone(breakdown.sources),
    totalModifier: modifier,
    total,
    dc: dc?.value ?? null,
    dcResult: dc ? total >= dc.value : null,
    incomingDamage: incomingDamage?.value ?? null,
    consequenceProfile,
    evasionEligible: breakdown.evasionAvailable === true &&
      breakdown.ability === "dexterity" && consequenceProfile === "save-half",
    featureSnapshot: input.kind === "saving-throw"
      ? { evasionAvailable: breakdown.evasionAvailable === true }
      : null,
    spellSaveSource: input.spellSaveSource === true && input.kind === "saving-throw",
    advantageReason: input.advantageReason?.trim() || null,
    disadvantageReason: input.disadvantageReason?.trim() || null,
    recordedAt: new Date().toISOString(),
  };
}
