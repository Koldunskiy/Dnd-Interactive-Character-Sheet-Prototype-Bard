from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent

INPUT_FILE = PROJECT_ROOT / "data" / "bard_spells_parsed.json"
OUTPUT_FILE = PROJECT_ROOT / "data" / "bard-spells.generated.js"

WHITESPACE_RE = re.compile(r"\s+")
SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")
LEGACY_ID_BY_SLUG = {
    "tasha-s-hideous-laughter": "tashas-hideous-laughter-2014",
    "raulothim-s-psychic-lance": "raulothims-psychic-lance-2014",
}


def normalize_inline(value: str) -> str:
    return WHITESPACE_RE.sub(" ", value).strip()


def truncate_sentence_safe(value: str, max_chars: int) -> str:
    text = normalize_inline(value)

    if len(text) <= max_chars:
        return text

    sentences = SENTENCE_END_RE.split(text)
    result: list[str] = []
    current_length = 0

    for sentence in sentences:
        next_length = current_length + len(sentence) + (1 if result else 0)

        if result and next_length > max_chars:
            break

        if not result and len(sentence) > max_chars:
            return sentence[: max_chars - 1].rstrip() + "…"

        result.append(sentence)
        current_length = next_length

    if not result:
        return text[: max_chars - 1].rstrip() + "…"

    summary = " ".join(result)

    if len(summary) < len(text):
        return summary.rstrip(".") + "…"

    return summary


def build_summary(spell: dict[str, Any]) -> str:
    paragraphs = [
        normalize_inline(part)
        for part in spell["full_description"].split("\n\n")
        if normalize_inline(part)
    ]

    if not paragraphs:
        return "Описание отсутствует."

    summary = truncate_sentence_safe(paragraphs[0], max_chars=340)

    if len(summary) < 140 and len(paragraphs) > 1:
        summary = truncate_sentence_safe(
            f"{summary} {paragraphs[1]}",
            max_chars=370,
        )

    return summary


def normalize_available_from_level(level: int) -> int:
    """Bard spell availability starts at character level 1 for cantrips."""

    if level == 0:
        return 1

    return max(1, 2 * level - 1)


def to_frontend_spell(source: dict[str, Any]) -> dict[str, Any]:
    level = int(source["level"])
    slug = source["slug"]

    spell_id = LEGACY_ID_BY_SLUG.get(
        slug,
        f"{slug}-2014",
    )

    return {
        "id": spell_id,
        "name": source["name_ru"],
        "originalName": source.get("name_en"),
        "source": "class",
        "sourceLabel": "Бард",
        "sourceBook": source.get("source"),
        "level": level,
        "school": source["school"],
        "ritual": bool(source["ritual"]),
        "concentration": bool(source["concentration"]),
        "castTime": source["casting_time"],
        "range": source["range_value"],
        "components": source["components"],
        "duration": source["duration"],
        "summary": build_summary(source),
        "description": source["full_description"],
        "upcast": source.get("upcast_text"),
        "classes": source.get("classes", []),
        "subclasses": source.get("subclasses", []),
        "availableFromLevel": normalize_available_from_level(level),
    }


def validate_spells(spells: list[dict[str, Any]]) -> None:
    spell_ids = [spell["id"] for spell in spells]

    duplicate_ids = sorted(
        {
            spell_id
            for spell_id in spell_ids
            if spell_ids.count(spell_id) > 1
        }
    )

    if duplicate_ids:
        raise ValueError(
            "Найдены дублирующиеся spell ID: "
            + ", ".join(duplicate_ids)
        )

    required_fields = {
        "id",
        "name",
        "level",
        "school",
        "castTime",
        "range",
        "components",
        "duration",
        "summary",
        "description",
        "availableFromLevel",
    }

    for spell in spells:
        missing = required_fields - spell.keys()

        if missing:
            raise ValueError(
                f"У {spell.get('id')!r} не хватает полей: "
                + ", ".join(sorted(missing))
            )

        if not spell["name"].strip():
            raise ValueError(
                f"У {spell['id']!r} пустое имя."
            )


def render_module(spells: list[dict[str, Any]]) -> str:
    payload = json.dumps(
        spells,
        ensure_ascii=False,
        indent=2,
    )

    return f"""// AUTO-GENERATED FILE.
// Source: data/bard_spells_parsed.json
// Builder: scripts/build_frontend_spell_library.py
// Do not edit manually.

export const BARD_SPELL_LIBRARY = {payload};

export const BARD_SPELL_LIBRARY_BY_ID = Object.fromEntries(
  BARD_SPELL_LIBRARY.map((spell) => [spell.id, spell]),
);
"""


def main() -> None:
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Не найден источник: {INPUT_FILE}"
        )

    payload = json.loads(INPUT_FILE.read_text(encoding="utf-8"))

    if payload.get("schema_version") != 1:
        raise ValueError(
            "Неподдерживаемая схема JSON: "
            f"{payload.get('schema_version')!r}"
        )

    spells = [
        to_frontend_spell(spell)
        for spell in payload.get("spells", [])
    ]

    if not spells:
        raise ValueError("В JSON нет заклинаний.")

    validate_spells(spells)

    OUTPUT_FILE.write_text(
        render_module(spells),
        encoding="utf-8",
    )

    by_level = {
        level: sum(spell["level"] == level for spell in spells)
        for level in range(10)
    }

    print(f"Сгенерировано заклинаний: {len(spells)}")

    for level, count in by_level.items():
        label = "Заговоры" if level == 0 else f"{level} уровень"
        print(f"  - {label}: {count}")

    print(f"Файл: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()