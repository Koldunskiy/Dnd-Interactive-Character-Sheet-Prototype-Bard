import { ABILITY_LABELS_RU, ABILITY_KEYS, SKILL_ID_META } from "../../rules.js";
import { getDerivedStats } from "../../calculations.js";
import {
  getEffectiveTechniqueIds,
  isTechniqueEffectivelySelected,
} from "../../selectors/techniques.js";

export function getSaraRollBreakdown(character, kind, id) {
  if (character?.profile?.id !== "sara-velaris") {
    return { ok: false, reason: "Для этого персонажа источник броска ещё не подключён." };
  }
  const derived = getDerivedStats(character);
  if (kind === "ability-check" && ABILITY_KEYS.includes(id)) {
    const value = Number(derived.abilityModifiers?.[id]);
    return {
      ok: true,
      ability: id,
      label: `Проверка: ${ABILITY_LABELS_RU[id]}`,
      totalModifier: value,
      sources: [{ id: "ability-modifier", label: ABILITY_LABELS_RU[id], value }],
    };
  }
  if (kind === "ability-check" && SKILL_ID_META[id]) {
    const skill = (character.skills ?? []).find((entry) => entry.id === id) ?? {};
    const ability = id === "persuasion" &&
      isTechniqueEffectivelySelected(character, "ll-monk:mantle-of-courtesy")
      ? "wisdom"
      : SKILL_ID_META[id].ability;
    const abilityModifier = Number(derived.abilityModifiers?.[ability]);
    const total = Number(derived.skills?.[id]);
    const proficiency = total - abilityModifier;
    return {
      ok: true,
      ability,
      skillId: id,
      label: SKILL_ID_META[id].label,
      totalModifier: total,
      sources: [
        { id: "ability-modifier", label: ABILITY_LABELS_RU[ability], value: abilityModifier },
        ...(proficiency ? [{
          id: "proficiency",
          label: skill.expertise ? "Экспертность" : "Владение",
          value: proficiency,
        }] : []),
      ],
    };
  }
  if (kind === "saving-throw" && ABILITY_KEYS.includes(id)) {
    const modifier = Number(derived.savingThrows?.[id]);
    const base = Number(derived.abilityModifiers?.[id]);
    const proficiency = modifier - base;
    return {
      ok: true,
      ability: id,
      savingThrow: true,
      label: `Спасбросок: ${ABILITY_LABELS_RU[id]}`,
      totalModifier: modifier,
      evasionAvailable: getEffectiveTechniqueIds(character).includes("base:evasion"),
      sources: [
        { id: "ability-modifier", label: ABILITY_LABELS_RU[id], value: base },
        ...(proficiency ? [{
          id: "proficiency",
          label: "Владение спасброском",
          value: proficiency,
        }] : []),
      ],
    };
  }
  return { ok: false, reason: "Выбранный параметр не найден." };
}
