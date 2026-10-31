export function applyDamagePools(hp, tempHp, finalIncomingDamage) {
  const values = [hp, tempHp, finalIncomingDamage];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    return { ok: false, reason: "Хиты, временные хиты и урон должны быть неотрицательными целыми числами." };
  }
  const absorbedByTemp = Math.min(tempHp, finalIncomingDamage);
  const remainingForHp = finalIncomingDamage - absorbedByTemp;
  return {
    ok: true,
    hpBefore: hp,
    tempHpBefore: tempHp,
    damage: finalIncomingDamage,
    absorbedByTemp,
    remainingForHp,
    hpAfter: Math.max(0, hp - remainingForHp),
    tempHpAfter: tempHp - absorbedByTemp
  };
}

export function applyHealing(hp, maximum, amount) {
  if (![hp, maximum, amount].every(Number.isInteger) ||
      hp < 0 || maximum < 0 || amount < 0 || hp > maximum) {
    return { ok: false, reason: "Хиты, максимум и лечение должны быть допустимыми неотрицательными целыми числами." };
  }
  const hpAfter = Math.min(maximum, hp + amount);
  return { ok: true, hpBefore: hp, hpAfter, healing: hpAfter - hp };
}
