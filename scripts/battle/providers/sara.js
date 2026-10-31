import { getDerivedStats } from "../../calculations.js";

export function getSaraInitiativeSnapshot(character) {
  if (character?.profile?.id !== "sara-velaris") {
    return { ok: false, reason: "Источник инициативы для персонажа не подключён." };
  }
  const derived = getDerivedStats(character);
  const dexterity = Number(derived.abilityModifiers?.dexterity);
  const configuredExtra = Number(character.combat?.initiativeBonusExtra ?? 0);
  if (!Number.isFinite(dexterity) || !Number.isFinite(configuredExtra)) {
    return { ok: false, reason: "Не удалось определить источники модификатора инициативы." };
  }
  const sources = [{ id: "dexterity", label: "Ловкость", value: dexterity }];
  if (configuredExtra !== 0) {
    sources.push({
      id: "configured-extra",
      label: "Дополнительный модификатор инициативы",
      value: configuredExtra,
    });
  }
  return { ok: true, sources };
}
