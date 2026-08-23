from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


INPUT_FILE = Path("bard_spells.md")
OUTPUT_FILE = Path("bard_spells_parsed.json")

LEVEL_HEADER_RE = re.compile(
    r"^## (?:(?P<cantrip>Заговоры)|Заклинания (?P<level>[1-9]) уровня)\s*$",
    re.MULTILINE,
)

SPELL_HEADER_RE = re.compile(
    r"^### (?P<name_ru>.+?)"
    r"(?: \[(?P<name_en>[^\]]+)\])?"
    r"(?: (?P<source>[A-ZА-ЯЁ0-9]+))?\s*$",
    re.MULTILINE,
)

SCHOOL_LINE_RE = re.compile(
    r"^(?:(?P<level>[1-9]) уровень|Заговор), "
    r"(?P<school>[а-яё]+)"
    r"(?P<ritual> \(ритуал\))?\s*$",
    re.MULTILINE,
)

FIELD_RE = re.compile(
    r"^\*\*(?P<field>"
    r"Время накладывания|"
    r"Дистанция|"
    r"Компоненты|"
    r"Длительность|"
    r"Классы|"
    r"Подклассы"
    r"):\*\* "
    r"(?P<value>.+?)\s*$",
    re.MULTILINE,
)

UPCAST_MARKER_RE = re.compile(
    r"\n\*\*На больших уровнях\.\*\*\s*",
    re.MULTILINE,
)

MARKDOWN_SEPARATOR_RE = re.compile(
    r"(?m)^---\s*$",
)

WHITESPACE_RE = re.compile(r"[ \t]+\n")
MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class SpellData:
    """Canonical spell data parsed from bard_spells.md."""

    slug: str
    name_ru: str
    name_en: str | None
    source: str | None
    level: int
    school: str
    ritual: bool
    casting_time: str
    range_value: str
    components: str
    duration: str
    concentration: bool
    classes: list[str]
    subclasses: list[str]
    full_description: str
    upcast_text: str | None
    needs_summary: bool


def normalize_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = WHITESPACE_RE.sub("\n", value)
    value = MULTI_NEWLINE_RE.sub("\n\n", value)
    return value.strip()


def make_slug(value: str) -> str:
    transliteration = str.maketrans(
        {
            "а": "a",
            "б": "b",
            "в": "v",
            "г": "g",
            "д": "d",
            "е": "e",
            "ё": "e",
            "ж": "zh",
            "з": "z",
            "и": "i",
            "й": "y",
            "к": "k",
            "л": "l",
            "м": "m",
            "н": "n",
            "о": "o",
            "п": "p",
            "р": "r",
            "с": "s",
            "т": "t",
            "у": "u",
            "ф": "f",
            "х": "h",
            "ц": "ts",
            "ч": "ch",
            "ш": "sh",
            "щ": "shch",
            "ъ": "",
            "ы": "y",
            "ь": "",
            "э": "e",
            "ю": "yu",
            "я": "ya",
        }
    )

    normalized = value.lower().translate(transliteration)
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def normalize_duration(value: str) -> tuple[str, bool]:
    concentration = value.lower().startswith("концентрация")

    value = re.sub(
        r"^Концентрация,\s*",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(
        r"^вплоть до\s+",
        "до ",
        value,
        flags=re.IGNORECASE,
    )
    value = value.replace("Мгновенная", "Мгновенно")

    return value.strip(), concentration


def split_upcast_text(description: str) -> tuple[str, str | None]:
    parts = UPCAST_MARKER_RE.split(description, maxsplit=1)

    if len(parts) == 1:
        return parts[0].strip(), None

    return parts[0].strip(), parts[1].strip()


def parse_list(value: str) -> list[str]:
    return [
        item.strip()
        for item in value.split(",")
        if item.strip()
    ]


def extract_fields(block: str) -> tuple[dict[str, str], str]:
    fields: dict[str, str] = {}

    for match in FIELD_RE.finditer(block):
        fields[match.group("field")] = normalize_text(
            match.group("value")
        )

    body_start = 0
    last_field_match = None

    for match in FIELD_RE.finditer(block):
        last_field_match = match

    if last_field_match is not None:
        body_start = last_field_match.end()

    body = normalize_text(block[body_start:])

    return fields, body


def split_spell_blocks(markdown: str) -> Iterable[tuple[int, str]]:
    level_matches = list(LEVEL_HEADER_RE.finditer(markdown))

    if not level_matches:
        raise ValueError(
            "Не найдены заголовки уровней: ## Заговоры / ## Заклинания N уровня."
        )

    for level_index, level_match in enumerate(level_matches):
        level = 0 if level_match.group("cantrip") else int(
            level_match.group("level")
        )

        section_start = level_match.end()
        section_end = (
            level_matches[level_index + 1].start()
            if level_index + 1 < len(level_matches)
            else len(markdown)
        )

        section = markdown[section_start:section_end]
        spell_matches = list(SPELL_HEADER_RE.finditer(section))

        for spell_index, spell_match in enumerate(spell_matches):
            block_start = spell_match.end()
            block_end = (
                spell_matches[spell_index + 1].start()
                if spell_index + 1 < len(spell_matches)
                else len(section)
            )

            block = section[block_start:block_end]
            block = MARKDOWN_SEPARATOR_RE.sub("", block)
            yield level, spell_match.group(0), normalize_text(block)


def parse_spell(
    section_level: int,
    header: str,
    block: str,
) -> SpellData:
    header_match = SPELL_HEADER_RE.match(header)

    if header_match is None:
        raise ValueError(f"Некорректный заголовок: {header!r}")

    name_ru = header_match.group("name_ru").strip()
    name_en = header_match.group("name_en")
    source = header_match.group("source")

    school_match = SCHOOL_LINE_RE.search(block)

    if school_match is None:
        raise ValueError(
            f"Не найдена строка уровня и школы у {name_ru!r}."
        )

    detected_level = (
        0
        if school_match.group(0).startswith("Заговор")
        else int(school_match.group("level"))
    )

    if detected_level != section_level:
        raise ValueError(
            f"Несовпадение уровня у {name_ru!r}: "
            f"раздел={section_level}, строка={detected_level}."
        )

    school = school_match.group("school").capitalize()
    ritual = bool(school_match.group("ritual"))

    block_without_school = normalize_text(
        block[:school_match.start()] + block[school_match.end():]
    )

    fields, description = extract_fields(block_without_school)

    required_fields = {
        "Время накладывания",
        "Дистанция",
        "Компоненты",
        "Длительность",
        "Классы",
    }

    missing_fields = required_fields - fields.keys()

    if missing_fields:
        missing = ", ".join(sorted(missing_fields))
        raise ValueError(
            f"У {name_ru!r} отсутствуют поля: {missing}."
        )

    duration, concentration = normalize_duration(
        fields["Длительность"]
    )

    full_description, upcast_text = split_upcast_text(description)

    return SpellData(
        slug=make_slug(name_en or name_ru),
        name_ru=name_ru,
        name_en=name_en,
        source=source,
        level=section_level,
        school=school,
        ritual=ritual,
        casting_time=fields["Время накладывания"],
        range_value=fields["Дистанция"],
        components=fields["Компоненты"],
        duration=duration,
        concentration=concentration,
        classes=parse_list(fields["Классы"]),
        subclasses=parse_list(fields.get("Подклассы", "")),
        full_description=full_description,
        upcast_text=upcast_text,
        needs_summary=len(full_description) > 460,
    )


def validate_spells(spells: list[SpellData]) -> None:
    if not spells:
        raise ValueError("Парсер не нашёл ни одного заклинания.")

    slugs = [spell.slug for spell in spells]
    duplicate_slugs = {
        slug
        for slug in slugs
        if slugs.count(slug) > 1
    }

    if duplicate_slugs:
        raise ValueError(
            "Повторяющиеся slug: "
            + ", ".join(sorted(duplicate_slugs))
        )

    levels = {spell.level for spell in spells}

    expected_levels = set(range(10))
    missing_levels = expected_levels - levels

    if missing_levels:
        raise ValueError(
            "В документе не найдены уровни: "
            + ", ".join(str(level) for level in sorted(missing_levels))
        )


def build_report(spells: list[SpellData]) -> str:
    by_level = {
        level: sum(spell.level == level for spell in spells)
        for level in range(10)
    }

    concentration_count = sum(
        spell.concentration
        for spell in spells
    )

    ritual_count = sum(
        spell.ritual
        for spell in spells
    )

    needs_summary_count = sum(
        spell.needs_summary
        for spell in spells
    )

    lines = [
        f"Всего заклинаний: {len(spells)}",
        "По уровням:",
    ]

    for level, count in by_level.items():
        label = "Заговоры" if level == 0 else f"{level} уровень"
        lines.append(f"  - {label}: {count}")

    lines.extend(
        [
            f"Концентрация: {concentration_count}",
            f"Ритуалы: {ritual_count}",
            (
                "Нужна ручная выжимка для poker-карты: "
                f"{needs_summary_count}"
            ),
        ]
    )

    return "\n".join(lines)


def main() -> None:
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Не найден файл: {INPUT_FILE.resolve()}"
        )

    markdown = normalize_text(
        INPUT_FILE.read_text(encoding="utf-8")
    )

    spells = [
        parse_spell(level, header, block)
        for level, header, block in split_spell_blocks(markdown)
    ]

    validate_spells(spells)

    payload = {
        "schema_version": 1,
        "source_file": INPUT_FILE.name,
        "spell_count": len(spells),
        "spells": [asdict(spell) for spell in spells],
    }

    OUTPUT_FILE.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(build_report(spells))
    print(f"JSON: {OUTPUT_FILE.resolve()}")


if __name__ == "__main__":
    main()