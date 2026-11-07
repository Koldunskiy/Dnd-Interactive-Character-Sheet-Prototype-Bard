import test from "node:test";
import assert from "node:assert/strict";
import { getSavedPlayerRecords } from "../../scripts/battle/player-hub.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { getSessionContext } from "../../scripts/state.js";

test("saved records are a read-only projection of completed and incomplete canonical records", () => {
  const character = {
    profile: { id: "sara-velaris" },
    monk: { combatAssistant: {
      activeSequences: [
        { id: "seq-complete", kind: "attack-action", status: "complete", maximumAttacks: 1,
          resolvedAttacks: [{ id: "attack-complete", slotNumber: 1, hitResult: "hit",
            damageStatus: "recorded", damageTotal: 7 }] },
        { id: "seq-pending", kind: "attack-action", status: "closed", maximumAttacks: 2,
          resolvedAttacks: [{ id: "attack-pending", slotNumber: 1, hitResult: "hit",
            damageStatus: "awaiting-damage", attackBonusSnapshot: 10 }] },
      ],
      pendingApplications: [{ id: "app-exact", parentAttackId: "attack-complete",
        techniqueId: "gentling-touch", dc: 15, targetOutcome: "unknown" }],
    } },
    characterRolls: { records: [{ id: "roll-exact", kind: "ability-check",
      label: "Проверка", total: 14, outcome: "success",
      consequence: { status: "pending" } }] },
  };
  const original = structuredClone(character);
  const projection = getSavedPlayerRecords(character);
  assert.deepEqual(projection.sequences.map((entry) => entry.sequenceId),
    ["seq-complete", "seq-pending"]);
  assert.equal(projection.sequences[0].attacks[0].recordedDamage, 7);
  assert.equal(projection.sequences[1].attacks[0].damageStatus, "awaiting-damage");
  assert.equal(projection.applications[0].applicationId, "app-exact");
  assert.equal(projection.applications[0].targetOutcome, "unknown");
  assert.equal(projection.rolls[0].rollId, "roll-exact");
  assert.equal(projection.rolls[0].consequencePending, true);
  assert.deepEqual(character, original);
});

test("history renderer has an empty state and no queue language", () => {
  const markup = renderBattleConsole({ profile: { id: "sara-velaris" } }, {
    panel: "saved-records",
    ownerKey: '["sara",1]',
  });
  assert.match(markup, /Сохранённых записей нет\./);
  assert.doesNotMatch(markup, /Требует внимания|Обязательные последствия|Черновики|Нет ожидающих задач/);
});

test("history renderer preserves completed summaries and emits exact escaped record addresses", () => {
  const character = {
    profile: { id: "sara-velaris" },
    monk: { combatAssistant: {
      activeSequences: [{ id: 'seq"<x>', kind: "attack-action", status: "closed",
        maximumAttacks: 1, resolvedAttacks: [{ id: "attack-2", slotNumber: 1,
          hitResult: "hit", damageStatus: "awaiting-damage" }] }],
      pendingApplications: [{ id: "app-2", techniqueId: "technique", dc: 15,
        targetOutcome: "success" }],
    } },
    characterRolls: { records: [{ id: "roll-2", label: "Проверка", total: 18,
      consequence: { status: "applied" } }] },
  };
  const markup = renderBattleConsole(character, {
    panel: "saved-records",
    ownerKey: '["sara",3]',
  });
  assert.match(markup, /data-saved-damage-sequence="seq&quot;&lt;x&gt;"/);
  assert.match(markup, /data-saved-damage-attack="attack-2"/);
  assert.match(markup, new RegExp(`data-record-generation="${getSessionContext().sessionGeneration ?? ""}"`));
  assert.match(markup, /attack-action · closed/);
  assert.match(markup, /app-2|technique/);
  assert.match(markup, /Проверка/);
  assert.doesNotMatch(markup, /data-saved-application="app-2"/);
  assert.doesNotMatch(markup, /data-saved-roll="roll-2"/);
});
