import { applyDamagePools } from "../combat/damage-pools.js";
import { parsePhysicalInteger } from "../combat/physical-input.js";

function getRecordedOutcome(record) {
  if (record?.manualOutcome === "success" || record?.manualOutcome === "failure") {
    return record.manualOutcome;
  }
  if (typeof record?.dcResult === "boolean") {
    return record.dcResult ? "success" : "failure";
  }
  return null;
}

export function calculateRollConsequencePreview(record, character, input) {
  const outcome = getRecordedOutcome(record);
  if (!record || !outcome) {
    return { ok: false, reason: "Сначала запишите полученный исход броска." };
  }
  const damage = parsePhysicalInteger(input?.damage, 0, Number.MAX_SAFE_INTEGER, "Урон");
  if (!damage.ok) return damage;
  const damageBasis = input?.damageBasis;
  if (!["dm-final", "full-effect"].includes(damageBasis)) {
    return { ok: false, reason: "Уточните, это итоговый или полный урон эффекта." };
  }

  let finalDamage = damage.value;
  let evasionUsed = false;
  let ruleExplanation = "Применяется итоговый урон, сообщённый ведущим; повторного уменьшения нет.";
  let effectProfile = "dm-final";
  if (damageBasis === "full-effect") {
    if (record.kind !== "saving-throw") {
      return { ok: false, reason: "Для проверки навыка укажите итоговый урон от ведущего." };
    }
    effectProfile = input.effectProfile;
    if (!["failure-full", "save-half"].includes(effectProfile)) {
      return { ok: false, reason: "Выберите известный профиль урона эффекта." };
    }
    if (effectProfile === "failure-full") {
      finalDamage = outcome === "failure" ? damage.value : 0;
      ruleExplanation = outcome === "failure"
        ? "Урон возникает только при провале; «Увёртливость» к этому профилю не применяется."
        : "При успехе этот эффект не наносит урон.";
    } else {
      let evasionAvailable;
      if (typeof record.featureSnapshot?.evasionAvailable === "boolean") {
        evasionAvailable = record.featureSnapshot.evasionAvailable;
      } else if (record.consequenceProfile === "save-half" &&
          typeof record.evasionEligible === "boolean") {
        evasionAvailable = record.evasionEligible;
      } else {
        return {
          ok: false,
          reason: "Для этой старой записи нет надёжного снимка «Увёртливости». Уточните итоговый урон у ведущего.",
        };
      }
      evasionUsed = evasionAvailable && record.ability === "dexterity";
      if (evasionUsed) {
        finalDamage = outcome === "success" ? 0 : Math.floor(damage.value / 2);
        ruleExplanation = outcome === "success"
          ? "Спасбросок Ловкости успешен: «Увёртливость» уменьшает урон до 0."
          : `Спасбросок Ловкости провален: «Увёртливость» оставляет половину (${finalDamage}).`;
      } else {
        finalDamage = outcome === "success"
          ? Math.floor(damage.value / 2)
          : damage.value;
        ruleExplanation = outcome === "success"
          ? `Успешный спасбросок оставляет половину урона (${finalDamage}).`
          : "Без применимой «Увёртливости» провал означает полный урон.";
      }
    }
  }

  const hp = Number(character?.combat?.hp?.current);
  const tempHp = Number(character?.combat?.hp?.temp ?? 0);
  const pools = applyDamagePools(hp, tempHp, finalDamage);
  if (!pools.ok) return pools;
  return {
    ok: true,
    outcome,
    damageBasis,
    effectProfile,
    originalDamage: damage.value,
    ruleExplanation,
    finalDamage,
    evasionUsed,
    hpBefore: pools.hpBefore,
    hpAfter: pools.hpAfter,
    tempHpBefore: pools.tempHpBefore,
    tempHpAfter: pools.tempHpAfter,
  };
}
