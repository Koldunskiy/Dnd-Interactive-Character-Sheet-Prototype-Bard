import { getDerivedStats } from "../calculations.js";
import { MONK_RACIAL_SPELLS } from "../../data/monk-support-spells.js";
import { MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import { getSaraAttackCount } from "../actions/sara-combat.js";
import { getActiveBattle, getActionBudget } from "./model.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";

export const BATTLE_CATEGORIES = Object.freeze([
  Object.freeze({ id: "action", label: "Действие" }),
  Object.freeze({ id: "bonus", label: "Бонусное" }),
  Object.freeze({ id: "movement", label: "Движение" }),
  Object.freeze({ id: "reaction", label: "Реакции" }),
]);

const categoryById = new Map(BATTLE_CATEGORIES.map((entry) => [entry.id, entry]));
const selectedCategories = new Map();

function isInOwnTurn(state) {
  const battle = getActiveBattle(state);
  return !battle || battle.phase === "own-turn";
}

function isReactionWindow(state) {
  const battle = getActiveBattle(state);
  return !battle || ["waiting", "own-turn"].includes(battle.phase);
}

function command(id, titleRu, navigationGroups, activationBudget, resourceCost, trigger, ruleReference, availability) {
  const activationCostLabel = ({
    action: "Действие",
    "bonus-action": "Бонусное действие",
    reaction: "Реакция",
  })[activationBudget];
  return Object.freeze({
    id,
    scenarioId: id,
    titleRu,
    navigationGroups: Object.freeze(navigationGroups),
    activationBudget,
    resourceCost: activationCostLabel
      ? resourceCost === activationCostLabel
        ? resourceCost
        : `${activationCostLabel} · ${resourceCost}`
      : resourceCost,
    trigger,
    effectiveSelectionRequirement: id.startsWith("racial-spell:")
      ? "Сохранённая запись расового заклинания"
      : id.startsWith("deflect-") || ["mystic-regeneration", "step-of-the-wind", "patient-defense"].includes(id)
        ? `Эффективно выбрана техника: ${id}`
        : null,
    parentRequirement: null,
    ruleReference,
    availability,
  });
}

function getDefinitions(state, derived, effective, budget) {
  const level = Number(state.profile?.level ?? 1);
  const selected = (id) => effective.has(id);
  const actionPhase = isInOwnTurn(state);
  const reactionPhase = isReactionWindow(state);
  const openAction = (enabled, reasonRu = "") => ({
    enabled: enabled && actionPhase,
    reasonCode: !actionPhase ? "not-own-turn" : enabled ? null : "unavailable",
    reasonRu: !actionPhase ? "Действия доступны только в свой ход." : reasonRu,
  });
  const openReaction = (enabled, reasonRu = "") => ({
    enabled: enabled && reactionPhase && budget.reactionAvailable,
    reasonCode: !reactionPhase ? "reaction-window-closed"
      : !budget.reactionAvailable ? "reaction-used" : enabled ? null : "unavailable",
    reasonRu: !reactionPhase ? "Реакция недоступна в приостановленной сцене."
      : !budget.reactionAvailable ? "Реакция уже использована в этом ходу." : reasonRu,
  });
  const racialSpells = MONK_RACIAL_SPELLS.map((spell) => {
    const saved = state.spellcasting?.racialSpells?.find((entry) =>
      entry.id === spell.id && entry.source === spell.source && entry.mode === spell.mode);
    const uses = saved?.uses;
    const hasUses = !uses || Number.isInteger(Number(uses.current)) && Number(uses.current) > 0;
    const availability = openAction(Boolean(saved) && hasUses && budget.actionAvailable,
      !saved ? "Расовое заклинание отсутствует в активном листе."
        : !hasUses ? "Применение восстановится после долгого отдыха."
          : !budget.actionAvailable ? "Действие уже использовано." : "");
    if (spell.concentration && state.combat?.concentration && availability.enabled) {
      availability.reasonRu = `Потребуется явно заменить концентрацию «${state.combat.concentration}».`;
    }
    return command(
      `racial-spell:${spell.id}`,
      spell.nameRu ?? spellTitleRu(spell.id),
      ["action"],
      "action",
      spell.mode === "limited-racial" ? `1 применение за долгий отдых · ${uses?.current ?? 0} осталось` : "Без расходуемого применения",
      `${spell.range ?? "Дальность по записи"} · компоненты: ${(spell.components ?? []).join(", ")} · ${spell.description}`,
      spell.description,
      availability,
    );
  });

  const step = MONK_TECHNIQUE_BY_ID.get("ll-monk:step-of-the-wind");
  const regeneration = MONK_TECHNIQUE_BY_ID.get("ll-monk:mystic-regeneration");
  const deflectStrike = MONK_TECHNIQUE_BY_ID.get("ll-monk:deflect-strike");
  const deflectMissile = MONK_TECHNIQUE_BY_ID.get("ll-monk:deflect-missile");
  const patientDefense = MONK_TECHNIQUE_BY_ID.get("ll-monk:patient-defense");
  const normalSequenceOpen = (state.monk?.combatAssistant?.activeSequences ?? []).some((sequence) =>
    sequence.kind === "attack-action" && sequence.status === "open");

  return [
    command("character-roll", "Проверка или спасбросок", ["action"], "none", "Без расхода",
      "Физические кости и модификаторы текущего листа; бросок не тратит действие.",
      "Личный бросок персонажа",
      { enabled: true, reasonCode: null, reasonRu: "" }),
    command("resource-correction", "Исправить ресурс вручную", ["action"], "none", "Без расхода",
      "Только исправление фактического значения в активном листе; не выдаёт расходуемые предметы.",
      "Корректировка сохранённого ресурса",
      { enabled: true, reasonCode: null, reasonRu: "" }),
    command("normal-attack", "Обычная безоружная атака", ["action"], "action", `${getSaraAttackCount(state)} ${pluralAttack(getSaraAttackCount(state))}`,
      "Физический к20; попадание и урон записываются отдельно.", "Действие «Атака» · безоружный профиль",
      openAction(budget.actionAvailable || normalSequenceOpen,
        budget.actionAvailable || normalSequenceOpen ? "" : "Действие уже использовано.")),
    command("mystic-regeneration", "Мистическая регенерация", ["action"], "action", regeneration?.payment ?? "Стоимость не задана",
      "Техника должна быть выбрана; физическая кость Боевых искусств.", regeneration?.description ?? "",
      openAction(selected("ll-monk:mystic-regeneration") && budget.actionAvailable &&
        Number(state.combat?.ki?.current) >= 2,
      !selected("ll-monk:mystic-regeneration") ? "Техника не выбрана или сейчас недоступна."
        : !budget.actionAvailable ? "Действие уже использовано."
          : "Недостаточно ци для применения.")),
    ...racialSpells,
    command("dash", "Рывок", ["action", "movement"], "action", "Действие",
      "Отметьте действие; фактическое перемещение и расстояние определяются за столом.", "Базовое действие Dash",
      openAction(budget.actionAvailable, budget.actionAvailable ? "" : "Действие уже использовано.")),
    command("disengage", "Отход", ["action", "movement"], "action", "Действие",
      "Отметьте действие; эффект провоцированных атак определяется за столом.", "Базовое действие Disengage",
      openAction(budget.actionAvailable, budget.actionAvailable ? "" : "Действие уже использовано.")),
    command("flurry", "Шквал ударов", ["bonus"], "bonus-action", "1 ци",
      "Нужно подтвердить применение; действие «Атака» заранее не требуется.", "Flurry of Blows",
      {
        enabled: level >= 2 && budget.bonusActionAvailable && Number(state.combat?.ki?.current) >= 1 && actionPhase,
        reasonCode: level < 2 ? "level"
          : !actionPhase ? "not-own-turn"
            : !budget.bonusActionAvailable ? "bonus-used"
              : Number(state.combat?.ki?.current) < 1 ? "ki" : null,
        reasonRu: level < 2 ? "Доступно со 2 уровня."
          : !actionPhase ? "Бонусное действие доступно только в свой ход."
            : !budget.bonusActionAvailable ? "Бонусное действие уже использовано."
              : Number(state.combat?.ki?.current) < 1 ? "Недостаточно ци." : "",
      }),
    command("bonus-unarmed", "Бонусный безоружный удар", ["bonus"], "bonus-action", "Без ци",
      "Требуется подтверждённое условие Martial Arts.", "Бонусная атака Martial Arts",
      {
        enabled: level >= 2 && budget.bonusActionAvailable && actionPhase,
        reasonCode: level < 2 ? "level" : !actionPhase ? "not-own-turn" : !budget.bonusActionAvailable ? "bonus-used" : null,
        reasonRu: level < 2 ? "Доступно со 2 уровня."
          : !actionPhase ? "Бонусное действие доступно только в свой ход."
            : !budget.bonusActionAvailable ? "Бонусное действие уже использовано." : "",
      }),
    command("step-of-the-wind", "Шаг ветра · Рывок или Отход", ["bonus", "movement"], "bonus-action",
      step?.payment ?? "Стоимость не задана", "Требуется выбранная эффективная техника; удваивает длину прыжка до конца хода.",
      step?.description ?? "",
      {
        enabled: selected("ll-monk:step-of-the-wind") && budget.bonusActionAvailable && actionPhase,
        reasonCode: !selected("ll-monk:step-of-the-wind") ? "not-selected"
          : !actionPhase ? "not-own-turn" : !budget.bonusActionAvailable ? "bonus-used" : null,
        reasonRu: !selected("ll-monk:step-of-the-wind") ? "Техника не выбрана или сейчас недоступна."
          : !actionPhase ? "Доступно только в свой ход."
            : !budget.bonusActionAvailable ? "Бонусное действие уже использовано." : "",
      }),
    command("patient-defense", "Терпеливая оборона", ["bonus"], "bonus-action",
      patientDefense?.payment ?? "Стоимость не задана", "Применяется только при выбранной эффективной технике.",
      patientDefense?.description ?? "",
      {
        enabled: selected("ll-monk:patient-defense") && budget.bonusActionAvailable &&
          Number(state.combat?.ki?.current) >= 1 && actionPhase,
        reasonCode: !selected("ll-monk:patient-defense") ? "not-selected"
          : !actionPhase ? "not-own-turn"
            : !budget.bonusActionAvailable ? "bonus-used"
              : Number(state.combat?.ki?.current) < 1 ? "ki" : null,
        reasonRu: !selected("ll-monk:patient-defense") ? "Техника не выбрана или сейчас недоступна."
          : !actionPhase ? "Доступно только в свой ход."
            : !budget.bonusActionAvailable ? "Бонусное действие уже использовано."
              : Number(state.combat?.ki?.current) < 1 ? "Недостаточно ци." : "",
      }),
    command("movement-reference", "Обычное перемещение", ["movement"], "movement", "Без отдельного счётчика",
      "Скорость берётся из текущих характеристик; карта и пройденное расстояние не моделируются.",
      `${derived.monk?.speedFeet ?? state.profile?.speedFeet ?? "—"} фт. · перемещение и остаток определяются за столом.`,
      { enabled: true, reasonCode: null, reasonRu: "" }),
    command("deflect-strike", "Отражение удара", ["reaction"], "reaction",
      deflectStrike?.payment ?? "Стоимость не задана", "При попадании подходящей атакой вблизи; требуется выбранная эффективная техника и физическая кость.",
      deflectStrike?.description ?? "",
      openReaction(selected("ll-monk:deflect-strike"),
        selected("ll-monk:deflect-strike") ? "" : "Техника не выбрана или сейчас недоступна.")),
    command("deflect-missile", "Отражение снарядов", ["reaction"], "reaction",
      deflectMissile?.payment ?? "Стоимость не задана", "При попадании видимой дальнобойной атакой; режим и условия снаряда подтверждаются вручную.",
      deflectMissile?.description ?? "",
      openReaction(selected("ll-monk:deflect-missile"),
        selected("ll-monk:deflect-missile") ? "" : "Техника не выбрана или сейчас недоступна.")),
    command("ebb-and-flow", "Прилив и отлив", ["reaction"], "reaction", "Без ци",
      "После промаха вблизи; выберите ответный безоружный удар или спасбросок Ловкости цели.",
      "Правило Open Hand · с 6 уровня",
      openReaction(level >= 6, level >= 6 ? "" : "Доступно с 6 уровня.")),
    command("opportunity-unarmed", "Провоцированная атака", ["reaction"], "reaction", "Без ци",
      "Требуется подтверждение триггера игроком или ведущим; автоматическое отслеживание целей отсутствует.",
      "Один ответный безоружный удар; не действие Attack.",
      openReaction(true)),
  ];
}

function spellTitleRu(id) {
  return ({
    "poison-spray-2014": "Ядовитые брызги",
    "animal-friendship-2014": "Дружба с животными",
    "suggestion-2014": "Внушение",
  })[id] ?? id;
}

function pluralAttack(count) {
  return count === 1 ? "удар" : "удара";
}

export function getSaraBattleCommandRegistry(state) {
  const derived = getDerivedStats(state);
  const effective = getEffectiveSelectedTechniqueIds(state);
  const budget = getActionBudget(state);
  return getDefinitions(state, derived, effective, budget);
}

export function projectSaraBattleCategories(state, categoryId = getSelectedBattleCategory(state.profile?.id)) {
  const category = categoryById.get(categoryId) ?? BATTLE_CATEGORIES[0];
  const commands = getSaraBattleCommandRegistry(state)
    .filter((entry) => entry.navigationGroups.includes(category.id));
  return { category, commands };
}

export function getSelectedBattleCategory(characterId = "sara-velaris") {
  return categoryById.has(selectedCategories.get(characterId))
    ? selectedCategories.get(characterId) : "action";
}

export function selectBattleCategory(characterId, categoryId) {
  if (!categoryById.has(categoryId)) return false;
  selectedCategories.set(characterId, categoryId);
  return true;
}
