#!/usr/bin/env python3
"""
Функциональный лист Аурелии для D&D 5e (правила 2014).

Установка:
    py -m pip install reportlab

Запуск:
    py generate_aurelia_character_sheet.py

Результат:
    aurelia_character_sheet_level_11.pdf

Архитектура:
- 4 страницы A4.
- Полностью русские подписи.
- Нет KeepTogether внутри Table.
- Таблицы с текстом не имеют фиксированного rowHeight.
- Вложенные таблицы внутри секций используют CARD_INNER_WIDTH.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT_FILENAME = "aurelia_character_sheet_level_11.pdf"

PAGE_WIDTH, PAGE_HEIGHT = A4

MARGIN_X = 8.5 * mm
MARGIN_TOP = 14.0 * mm
MARGIN_BOTTOM = 13.0 * mm

CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

CARD_PADDING_X = 1.8 * mm
CARD_PADDING_Y = 1.55 * mm
CARD_INNER_WIDTH = CONTENT_WIDTH - 2 * CARD_PADDING_X

BLACK = colors.HexColor("#111111")
DARK_GRAY = colors.HexColor("#303030")
MID_GRAY = colors.HexColor("#858585")
VERY_LIGHT_GRAY = colors.HexColor("#F7F7F7")
WHITE = colors.white

Proficiency = Literal["none", "proficient", "expertise"]


@dataclass(frozen=True)
class Ability:
    """Характеристика персонажа."""

    key: str
    name: str
    score: int

    @property
    def modifier(self) -> int:
        """Модификатор характеристики."""

        return (self.score - 10) // 2


@dataclass(frozen=True)
class Skill:
    """Полные данные навыка."""

    name: str
    ability_key: str
    proficiency: Proficiency
    source: str | None = None


@dataclass(frozen=True)
class Spell:
    """Оперативная карточка заклинания."""

    name: str
    level: int
    casting_time: str
    range_text: str
    duration: str
    concentration: bool
    save_or_attack: str
    components: str
    material: str
    effect: str
    upcast: str = ""
    source: str = ""


@dataclass(frozen=True)
class Cantrip:
    """Оперативная карточка заговора."""

    name: str
    casting_time: str
    range_text: str
    duration: str
    save_or_attack: str
    components: str
    material: str
    effect: str
    source: str = ""


ABILITIES: dict[str, Ability] = {
    "strength": Ability("strength", "Сила", 8),
    "dexterity": Ability("dexterity", "Ловкость", 18),
    "constitution": Ability("constitution", "Телосложение", 19),
    "intelligence": Ability("intelligence", "Интеллект", 10),
    "wisdom": Ability("wisdom", "Мудрость", 10),
    "charisma": Ability("charisma", "Харизма", 18),
}

LEVEL = 11
MAX_HP = 102
HIT_DICE = "11к8"

PROFICIENCY_BONUS = 4
JACK_OF_ALL_TRADES = PROFICIENCY_BONUS // 2

ARMOR_CLASS = 18
INITIATIVE = ABILITIES["dexterity"].modifier + JACK_OF_ALL_TRADES

SPEED = "30 фт"
SPEED_AFTER_ATTACK = "40 фт"

SPELL_SAVE_DC = (
    8
    + PROFICIENCY_BONUS
    + ABILITIES["charisma"].modifier
)
SPELL_ATTACK_BONUS = (
    PROFICIENCY_BONUS
    + ABILITIES["charisma"].modifier
)

COUNTERSPELL_CHECK = (
    ABILITIES["charisma"].modifier
    + JACK_OF_ALL_TRADES
)

CONCENTRATION_SAVE_BONUS = ABILITIES["constitution"].modifier

SUN_BLADE_ATTACK = (
    ABILITIES["dexterity"].modifier
    + PROFICIENCY_BONUS
    + 2
)
SUN_BLADE_DAMAGE = "1к8 +8 излучением"
SUN_BLADE_CRIT_DAMAGE = "2к8 +8 излучением"
SUN_BLADE_UNDEAD_DAMAGE = "2к8 +8 излучением"
SUN_BLADE_UNDEAD_CRIT_DAMAGE = "4к8 +8 излучением"

BARD_INSPIRATION_COUNT = ABILITIES["charisma"].modifier
BARD_INSPIRATION_DIE = "к10"

THIEVES_TOOLS_BONUS = (
    ABILITIES["dexterity"].modifier
    + 2 * PROFICIENCY_BONUS
)

SPELL_SLOTS: dict[int, int] = {
    1: 4,
    2: 3,
    3: 3,
    4: 3,
    5: 2,
    6: 1,
}


SKILLS: list[Skill] = [
    Skill("Атлетика", "strength", "none"),
    Skill("Акробатика", "dexterity", "expertise", "background"),
    Skill("Ловкость рук", "dexterity", "proficient", "class"),
    Skill("Скрытность", "dexterity", "none", "class"),
    Skill("Магия", "intelligence", "none"),
    Skill("История", "intelligence", "none"),
    Skill("Расследование", "intelligence", "none"),
    Skill("Природа", "intelligence", "none"),
    Skill("Религия", "intelligence", "none"),
    Skill("Уход за животными", "wisdom", "none"),
    Skill("Проницательность", "wisdom", "none", "class"),
    Skill("Медицина", "wisdom", "none"),
    Skill("Восприятие", "wisdom", "none", "class"),
    Skill("Выживание", "wisdom", "none"),
    Skill("Обман", "charisma", "expertise", "class"),
    Skill("Запугивание", "charisma", "none"),
    Skill("Выступление", "charisma", "expertise", "background"),
    Skill("Убеждение", "charisma", "expertise", "class"),
]


CANTRIPS: list[Cantrip] = [
    Cantrip(
        name="Злая насмешка",
        casting_time="Действие",
        range_text="60 фт",
        duration="Мгновенно",
        save_or_attack="Мудрость СЛ 16",
        components="В",
        material="—",
        effect=(
            "Провал: 3к4 психического урона; следующая атака цели "
            "до конца её следующего хода — с помехой."
        ),
        source="Бард",
    ),
    Cantrip(
        name="Сообщение",
        casting_time="Действие",
        range_text="120 фт",
        duration="1 раунд",
        save_or_attack="—",
        components="В, С, М",
        material="Короткий кусок медной проволоки; фокус покрывает.",
        effect=(
            "Шепни сообщение цели; она может ответить. Обычно проходит "
            "через преграду до 1 фт, свинец блокирует."
        ),
        source="Бард",
    ),
    Cantrip(
        name="Волшебная рука",
        casting_time="Действие",
        range_text="30 фт",
        duration="1 минута",
        save_or_attack="—",
        components="В, С",
        material="—",
        effect=(
            "Манипулирует предметами, открывает дверь, достаёт вещь. "
            "Лимит предмета: 10 фунтов."
        ),
        source="Бард",
    ),
    Cantrip(
        name="Фокусы",
        casting_time="Действие",
        range_text="10 фт",
        duration="До 1 часа",
        save_or_attack="—",
        components="В, С",
        material="—",
        effect=(
            "Мелкие сценические эффекты: звук, запах, чистка, метка, "
            "пламя, безделушка."
        ),
        source="Бард",
    ),
    Cantrip(
        name="Малая иллюзия",
        casting_time="Действие",
        range_text="30 фт",
        duration="1 минута",
        save_or_attack="—",
        components="С, М",
        material="Немного овечьей шерсти; фокус покрывает.",
        effect=(
            "Звук или неподвижный образ до куба 5 фт. "
            "Физическое взаимодействие раскрывает иллюзию."
        ),
        source="Наследие Малболга",
    ),
    Cantrip(
        name="Расщепление разума",
        casting_time="Действие",
        range_text="60 фт",
        duration="Мгновенно",
        save_or_attack="Интеллект СЛ 16",
        components="В",
        material="—",
        effect=(
            "Провал: 3к6 психического урона. До конца следующего хода "
            "Аурелии цель вычитает 1к4 из следующего спасброска."
        ),
        source="Магические тайны",
    ),
]


SPELLS: list[Spell] = [
    Spell(
        name="Лечащее слово",
        level=1,
        casting_time="Бонусное действие",
        range_text="60 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="—",
        components="В",
        material="—",
        effect=(
            "Существо, которое слышит тебя, восстанавливает 1к4 +4 HP. "
            "Не действует на нежить и конструкты."
        ),
        upcast="+1к4 за уровень ячейки выше 1.",
    ),
    Spell(
        name="Диссонирующий шёпот",
        level=1,
        casting_time="Действие",
        range_text="60 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="Мудрость СЛ 16",
        components="В",
        material="—",
        effect=(
            "Провал: 3к6 психического урона; цель реакцией уходит от тебя "
            "насколько позволяет скорость. Успех: половина урона, без движения."
        ),
        upcast="+1к6 за уровень ячейки выше 1.",
    ),
    Spell(
        name="Удержание личности",
        level=2,
        casting_time="Действие",
        range_text="60 фт",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Мудрость СЛ 16",
        components="В, С, М",
        material="Маленький прямой кусок железа; фокус покрывает.",
        effect=(
            "Только гуманоид. Провал: парализован. В конце каждого хода "
            "цель повторяет спасбросок. Попадание в 5 фт по цели — крит."
        ),
        upcast="+1 гуманоид за уровень ячейки выше 2.",
    ),
    Spell(
        name="Разбрасывание карт",
        level=2,
        casting_time="Действие",
        range_text="Конус 15 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="Ловкость СЛ 16",
        components="В, С, М",
        material="Колода карт; не расходуется.",
        effect=(
            "Провал: 2к10 силового урона и ослеплён до конца следующего "
            "хода цели. Успех: половина урона, без ослепления."
        ),
        upcast="+1к10 за уровень ячейки выше 2.",
    ),
    Spell(
        name="Малое восстановление",
        level=2,
        casting_time="Действие",
        range_text="Касание",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="—",
        components="В, С",
        material="—",
        effect=(
            "Снимает одно состояние: ослеплён, оглохший, парализован, "
            "отравлен; либо одну болезнь."
        ),
    ),
    Spell(
        name="Слепота/Глухота",
        level=2,
        casting_time="Действие",
        range_text="30 фт",
        duration="1 минута",
        concentration=False,
        save_or_attack="Телосложение СЛ 16",
        components="В",
        material="—",
        effect=(
            "Провал: ослеплён или оглохший по выбору. В конце каждого "
            "своего хода цель повторяет спасбросок."
        ),
        upcast="+1 цель за уровень ячейки выше 2.",
    ),
    Spell(
        name="Гипнотический узор",
        level=3,
        casting_time="Действие",
        range_text="Куб 30 фт в 120 фт",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Мудрость СЛ 16",
        components="С, М",
        material=(
            "Светящаяся палочка благовоний или фосфор; "
            "фокус покрывает."
        ),
        effect=(
            "Провал: очарован, недееспособен, скорость 0. Эффект заканчивается "
            "при уроне или если союзник действием выводит цель из оцепенения."
        ),
    ),
    Spell(
        name="Рассеивание магии",
        level=3,
        casting_time="Действие",
        range_text="120 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="Проверка Харизмы +6",
        components="В, С",
        material="—",
        effect=(
            "Автоматически завершает заклинание 3 уровня или ниже. "
            "Выше: проверка Харизмы СЛ 10 + уровень заклинания."
        ),
        upcast=(
            "Ячейка выше: автоматически завершает заклинания "
            "соответствующего уровня или ниже."
        ),
    ),
    Spell(
        name="Контрзаклинание",
        level=3,
        casting_time="Реакция",
        range_text="60 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="Проверка Харизмы +6",
        components="С",
        material="—",
        effect=(
            "Когда видишь наложение заклинания. Автоматически срывает "
            "заклинание 3 уровня или ниже. Выше: Харизма СЛ 10 + уровень."
        ),
        upcast=(
            "Ячейка выше: автоматически срывает заклинания "
            "соответствующего уровня или ниже."
        ),
        source="Магические тайны",
    ),
    Spell(
        name="Высшая невидимость",
        level=4,
        casting_time="Действие",
        range_text="Касание",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="—",
        components="В, С",
        material="—",
        effect=(
            "Цель невидима даже при атаке или накладывании заклинаний. "
            "Атаки по цели обычно с помехой, её атаки обычно с преимуществом."
        ),
    ),
    Spell(
        name="Переносящая дверь",
        level=4,
        casting_time="Действие",
        range_text="500 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="—",
        components="В",
        material="—",
        effect=(
            "Телепортируйся в видимую или описанную точку; можешь взять одно "
            "согласное существо твоего размера или меньше."
        ),
    ),
    Spell(
        name="Психическое копьё Раулотима",
        level=4,
        casting_time="Действие",
        range_text="120 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="Интеллект СЛ 16",
        components="В",
        material=(
            "Если имя цели неизвестно: предмет стоимостью 1 зм с её изображением. "
            "Если имя произнесено — не нужен."
        ),
        effect=(
            "Провал: 7к6 психического урона и недееспособен до начала следующего "
            "хода Аурелии. Успех: половина урона, без недееспособности."
        ),
        upcast="+1к6 за уровень ячейки выше 4.",
    ),
    Spell(
        name="Синаптический разряд",
        level=5,
        casting_time="Действие",
        range_text="Сфера 20 фт в 120 фт",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="Интеллект СЛ 16",
        components="В, С",
        material="—",
        effect=(
            "Провал: 8к6 психического урона. На 1 минуту: −1к6 к атакам, "
            "проверкам и спасброскам Телосложения для концентрации. "
            "Успех: половина урона, без дебаффа."
        ),
        upcast="+1к6 за уровень ячейки выше 5.",
    ),
    Spell(
        name="Высшее восстановление",
        level=5,
        casting_time="Действие",
        range_text="Касание",
        duration="Мгновенно",
        concentration=False,
        save_or_attack="—",
        components="В, С, М",
        material="Алмазная пыль 100 зм; расходуется.",
        effect=(
            "Снимает один эффект: истощение, очарование, окаменение, "
            "проклятие, снижение характеристики или максимума HP."
        ),
    ),
    Spell(
        name="Разящее око",
        level=6,
        casting_time="Действие",
        range_text="60 фт",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Мудрость СЛ 16",
        components="В, С",
        material="—",
        effect=(
            "Каждый ход действием выбери цель: сон, паника или слабость. "
            "Сон: бессознательна. Паника: испугана и убегает. "
            "Слабость: помеха на атаки и проверки Силы."
        ),
    ),
]


def format_bonus(value: int) -> str:
    """Форматировать модификатор с плюсом."""

    return f"+{value}" if value >= 0 else str(value)


def skill_bonus(skill: Skill) -> int:
    """Рассчитать итоговый бонус навыка с Мастером на все руки."""

    ability_modifier = ABILITIES[skill.ability_key].modifier

    if skill.proficiency == "expertise":
        return ability_modifier + 2 * PROFICIENCY_BONUS

    if skill.proficiency == "proficient":
        return ability_modifier + PROFICIENCY_BONUS

    return ability_modifier + JACK_OF_ALL_TRADES


def proficiency_marker(skill: Skill) -> str:
    """Вернуть видимый статус навыка."""

    return {
        "none": "○",
        "proficient": "●",
        "expertise": "★",
    }[skill.proficiency]


def proficiency_label(skill: Skill) -> str:
    """Вернуть текстовое описание статуса навыка."""

    return {
        "none": "Мастер на все руки",
        "proficient": "владение",
        "expertise": "экспертность",
    }[skill.proficiency]


def find_font_paths() -> tuple[Path, Path]:
    """Найти системный TTF-шрифт с кириллицей."""

    candidates = [
        (
            Path("C:/Windows/Fonts/arial.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
        ),
        (
            Path("C:/Windows/Fonts/calibri.ttf"),
            Path("C:/Windows/Fonts/calibrib.ttf"),
        ),
        (
            Path("C:/Windows/Fonts/DejaVuSans.ttf"),
            Path("C:/Windows/Fonts/DejaVuSans-Bold.ttf"),
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
        (
            Path("/Library/Fonts/Arial.ttf"),
            Path("/Library/Fonts/Arial Bold.ttf"),
        ),
    ]

    for regular_font, bold_font in candidates:
        if regular_font.exists() and bold_font.exists():
            return regular_font, bold_font

    raise RuntimeError(
        "Не найден шрифт с поддержкой кириллицы. "
        "Проверь пути в функции find_font_paths()."
    )


def register_fonts() -> None:
    """Зарегистрировать шрифты."""

    regular_font, bold_font = find_font_paths()

    pdfmetrics.registerFont(TTFont("Aurelia", str(regular_font)))
    pdfmetrics.registerFont(TTFont("Aurelia-Bold", str(bold_font)))


def create_styles() -> dict[str, ParagraphStyle]:
    """Создать стили текста."""

    base = getSampleStyleSheet()["Normal"]

    return {
        "page_title": ParagraphStyle(
            "page_title",
            parent=base,
            fontName="Aurelia-Bold",
            fontSize=11.7,
            leading=13.6,
            textColor=BLACK,
            spaceAfter=1.7 * mm,
        ),
        "section_title": ParagraphStyle(
            "section_title",
            parent=base,
            fontName="Aurelia-Bold",
            fontSize=7.1,
            leading=8.15,
            textColor=BLACK,
        ),
        "card_title": ParagraphStyle(
            "card_title",
            parent=base,
            fontName="Aurelia-Bold",
            fontSize=6.2,
            leading=7.1,
            textColor=BLACK,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base,
            fontName="Aurelia",
            fontSize=6.45,
            leading=7.4,
            textColor=BLACK,
        ),
        "body_small": ParagraphStyle(
            "body_small",
            parent=base,
            fontName="Aurelia",
            fontSize=5.8,
            leading=6.7,
            textColor=BLACK,
        ),
        "body_tiny": ParagraphStyle(
            "body_tiny",
            parent=base,
            fontName="Aurelia",
            fontSize=5.15,
            leading=5.95,
            textColor=BLACK,
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base,
            fontName="Aurelia-Bold",
            fontSize=4.9,
            leading=5.6,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "value": ParagraphStyle(
            "value",
            parent=base,
            fontName="Aurelia-Bold",
            fontSize=8.5,
            leading=9.7,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "value_small": ParagraphStyle(
            "value_small",
            parent=base,
            fontName="Aurelia-Bold",
            fontSize=6.55,
            leading=7.55,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "center": ParagraphStyle(
            "center",
            parent=base,
            fontName="Aurelia",
            fontSize=5.6,
            leading=6.5,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
    }


def p(text: str, style: ParagraphStyle) -> Paragraph:
    """Создать Paragraph."""

    return Paragraph(text.replace("\n", "<br/>"), style)


def checkbox_row(
    count: int,
    box_size: float = 4.7 * mm,
) -> Table:
    """Создать ряд клеток для трекера."""

    table = Table(
        [[""] * count],
        colWidths=[box_size] * count,
        rowHeights=[box_size],
    )

    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, DARK_GRAY),
            ]
        )
    )

    return table


def section_header(
    title: str,
    styles: dict[str, ParagraphStyle],
    subtitle: str = "",
) -> Table:
    """Заголовок секции, отдельный от содержимого."""

    heading = title.upper()

    if subtitle:
        heading += (
            f" <font name='Aurelia' size='4.75'>· {subtitle}</font>"
        )

    table = Table(
        [[p(heading, styles["section_title"])]],
        colWidths=[CONTENT_WIDTH],
    )

    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.55, DARK_GRAY),
                ("BACKGROUND", (0, 0), (-1, -1), VERY_LIGHT_GRAY),
                ("LEFTPADDING", (0, 0), (-1, -1), CARD_PADDING_X),
                ("RIGHTPADDING", (0, 0), (-1, -1), CARD_PADDING_X),
                ("TOPPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.35 * mm),
            ]
        )
    )

    return table


def full_width_table(
    rows: list,
    col_widths: list[float],
    style_commands: list[tuple],
) -> Table:
    """Построить вложенную таблицу в пределах CARD_INNER_WIDTH."""

    table = Table(rows, colWidths=col_widths)

    base_commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.25 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.25 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.05 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.05 * mm),
    ]

    table.setStyle(TableStyle(base_commands + style_commands))
    return table


def compact_card(
    title: str,
    content: list,
    styles: dict[str, ParagraphStyle],
    width: float,
    subtitle: str = "",
) -> Table:
    """Создать компактную карточку с авто-высотой."""

    heading = title.upper()

    if subtitle:
        heading += (
            f" <font name='Aurelia' size='4.55'>· {subtitle}</font>"
        )

    table = Table(
        [[
            [
                p(heading, styles["card_title"]),
                Spacer(1, 0.6 * mm),
                *content,
            ]
        ]],
        colWidths=[width],
    )

    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.4, DARK_GRAY),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2 * mm),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )

    return table


def two_card_row(
    left: Table,
    right: Table,
    width: float,
    gap: float,
) -> Table:
    """Ряд из двух карточек."""

    table = Table(
        [[left, "", right]],
        colWidths=[width, gap, width],
    )

    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    return table


def three_card_row(
    first: Table,
    second: Table,
    third: Table,
    width: float,
    gap: float,
) -> Table:
    """Ряд из трёх карточек."""

    table = Table(
        [[first, "", second, "", third]],
        colWidths=[width, gap, width, gap, width],
    )

    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    return table


def section_spacer() -> Spacer:
    """Отступ между секциями."""

    return Spacer(1, 1.5 * mm)


def row_spacer() -> Spacer:
    """Отступ между рядами карточек."""

    return Spacer(1, 1.15 * mm)


def draw_header(canvas, doc) -> None:
    """Верхний колонтитул."""

    canvas.saveState()

    canvas.setStrokeColor(DARK_GRAY)
    canvas.setLineWidth(0.5)
    canvas.line(
        MARGIN_X,
        PAGE_HEIGHT - 9.2 * mm,
        PAGE_WIDTH - MARGIN_X,
        PAGE_HEIGHT - 9.2 * mm,
    )

    canvas.setFillColor(BLACK)
    canvas.setFont("Aurelia-Bold", 7.0)
    canvas.drawString(
        MARGIN_X,
        PAGE_HEIGHT - 6.8 * mm,
        "АУРЕЛИЯ",
    )

    canvas.setFillColor(DARK_GRAY)
    canvas.setFont("Aurelia", 5.3)
    canvas.drawRightString(
        PAGE_WIDTH - MARGIN_X,
        PAGE_HEIGHT - 6.8 * mm,
        "Тифлинг Гласии · Бард 11 · Коллегия Мечей",
    )

    canvas.restoreState()


def draw_footer(canvas, doc) -> None:
    """Нижний колонтитул."""

    canvas.saveState()

    canvas.setStrokeColor(MID_GRAY)
    canvas.setLineWidth(0.3)
    canvas.line(
        MARGIN_X,
        8.2 * mm,
        PAGE_WIDTH - MARGIN_X,
        8.2 * mm,
    )

    canvas.setFillColor(DARK_GRAY)
    canvas.setFont("Aurelia", 5.1)
    canvas.drawString(
        MARGIN_X,
        5.2 * mm,
        "Аурелия · функциональный лист · D&D 5e (2014)",
    )

    canvas.drawRightString(
        PAGE_WIDTH - MARGIN_X,
        5.2 * mm,
        f"Стр. {doc.page}",
    )

    canvas.restoreState()


def build_status_table(
    styles: dict[str, ParagraphStyle],
) -> Table:
    """Статусная панель."""

    headers = [
        "ТЕКУЩИЕ HP",
        "ВРЕМЕННЫЕ HP",
        "КД",
        "ИНИЦ.",
        "СКОРОСТЬ",
        "КОНЦ.",
        "СЛ МАГИИ",
        "АТАКА МАГ.",
    ]

    values = [
        f"______ / <b>{MAX_HP}</b>",
        "______",
        f"<b>{ARMOR_CLASS}</b>",
        f"<b>{format_bonus(INITIATIVE)}</b>",
        f"<b>{SPEED}</b>",
        f"<b>Тел {format_bonus(CONCENTRATION_SAVE_BONUS)}</b>",
        f"<b>{SPELL_SAVE_DC}</b>",
        f"<b>{format_bonus(SPELL_ATTACK_BONUS)}</b>",
    ]

    table = Table(
        [
            [p(item, styles["table_header"]) for item in headers],
            [p(item, styles["value_small"]) for item in values],
        ],
        colWidths=[CONTENT_WIDTH / 8] * 8,
    )

    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, DARK_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.55 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.55 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 0.85 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.85 * mm),
            ]
        )
    )

    return table


def build_ability_table(
    styles: dict[str, ParagraphStyle],
) -> Table:
    """Шесть характеристик."""

    ability_cells = []

    for ability in ABILITIES.values():
        ability_cells.append(
            p(
                f"<b>{ability.name.upper()}</b>"
                f"<br/><font size='9'>{format_bonus(ability.modifier)}</font>"
                f"<br/><font size='5'>значение {ability.score}</font>",
                styles["center"],
            )
        )

    table = Table(
        [ability_cells],
        colWidths=[CARD_INNER_WIDTH / 6] * 6,
    )

    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, DARK_GRAY),
                ("BACKGROUND", (0, 0), (-1, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.7 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.7 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2 * mm),
            ]
        )
    )

    return table


def build_saves_table(
    styles: dict[str, ParagraphStyle],
) -> Table:
    """Все спасброски."""

    saves = [
        ("Сила", "−1"),
        ("Ловкость", "+8"),
        ("Телосложение", "+4"),
        ("Интеллект", "+0"),
        ("Мудрость", "+0"),
        ("Харизма", "+8"),
    ]

    table = Table(
        [
            [p(name.upper(), styles["table_header"]) for name, _ in saves],
            [p(value, styles["value_small"]) for _, value in saves],
        ],
        colWidths=[CARD_INNER_WIDTH / 6] * 6,
    )

    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, DARK_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.7 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.7 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 0.85 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.85 * mm),
            ]
        )
    )

    return table


def build_slots_table(
    styles: dict[str, ParagraphStyle],
    width: float,
) -> Table:
    """Трекер ячеек заклинаний."""

    rows = []

    for level, count in SPELL_SLOTS.items():
        rows.append(
            [
                p(f"{level} УР.", styles["table_header"]),
                checkbox_row(count, 4.0 * mm),
            ]
        )

    table = Table(
        rows,
        colWidths=[16 * mm, width - 16 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.32, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.75 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.75 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 0.5 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5 * mm),
            ]
        )
    )

    return table


def build_page_one(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Лист 1: боевой dashboard."""

    story: list = [
        p("Бой и состояние", styles["page_title"]),
        build_status_table(styles),
        Spacer(1, 1.35 * mm),
    ]

    story.append(section_header("Характеристики", styles))
    story.extend(
        [
            build_ability_table(styles),
            Spacer(1, 0.75 * mm),
            p(
                f"<b>Мастер на все руки:</b> +{JACK_OF_ALL_TRADES} к проверкам характеристик без бонуса мастерства. "
                "Уже учтён в инициативе и навыках без владения. Не применяется к спасброскам.",
                styles["body_small"],
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Спасброски", styles))
    story.extend(
        [
            build_saves_table(styles),
            section_spacer(),
        ]
    )

    gap = 3.0 * mm
    half_width = (CONTENT_WIDTH - gap) / 2

    sun_blade_card = compact_card(
        "Солнечный клинок",
        [
            p(
                "<b>Фехтовальное оружие +2 · фокус Барда.</b>",
                styles["body_small"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                f"<b>Атака:</b> к20 {format_bonus(SUN_BLADE_ATTACK)}"
                f"<br/><b>Обычная цель:</b> {SUN_BLADE_DAMAGE}"
                f"<br/><b>Крит:</b> {SUN_BLADE_CRIT_DAMAGE}",
                styles["body_small"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                f"<b>Нежить:</b> {SUN_BLADE_UNDEAD_DAMAGE}"
                f"<br/><b>Крит по нежити:</b> {SUN_BLADE_UNDEAD_CRIT_DAMAGE}",
                styles["body_small"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                "Действие «Атака» = 2 удара. После «Атаки»: скорость "
                f"{SPEED_AFTER_ATTACK} до конца хода.",
                styles["body_tiny"],
            ),
        ],
        styles,
        half_width,
    )

    hit_dice_card = compact_card(
        "Кости хитов и смерть",
        [
            p(
                f"<b>Кости хитов:</b> {HIT_DICE}",
                styles["body_small"],
            ),
            Spacer(1, 0.7 * mm),
            p(
                "<b>Успехи смерти:</b> □ □ □",
                styles["body_small"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                "<b>Провалы смерти:</b> □ □ □",
                styles["body_small"],
            ),
            Spacer(1, 0.7 * mm),
            p(
                "<b>Истощение:</b> □ 1  □ 2  □ 3  □ 4  □ 5  □ 6",
                styles["body_small"],
            ),
        ],
        styles,
        half_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    two_card_row(
                        sun_blade_card,
                        hit_dice_card,
                        half_width,
                        gap,
                    )
                ]
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Атаки и Росчерки клинка", styles))

    flourish_gap = 2.2 * mm
    flourish_width = (CARD_INNER_WIDTH - 2 * flourish_gap) / 3

    attack_card = compact_card(
        "Две атаки",
        [
            p(
                f"<b>Удар 1:</b> к20 {format_bonus(SUN_BLADE_ATTACK)} → {SUN_BLADE_DAMAGE} □"
                f"<br/><b>Удар 2:</b> к20 {format_bonus(SUN_BLADE_ATTACK)} → {SUN_BLADE_DAMAGE} □",
                styles["body_tiny"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "Крит с Росчерком: дополнительный урон Росчерка — <b>2к10</b>.",
                styles["body_tiny"],
            ),
        ],
        styles,
        flourish_width,
    )

    defensive_card = compact_card(
        "Оборонительный",
        [
            p(
                "После попадания: 1 кость Вдохновения барда.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.4 * mm),
            p(
                "+1к10 урона. До начала следующего хода КД + результат.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.4 * mm),
            p(
                "КД: 18 + ____ = ____",
                styles["body_tiny"],
            ),
        ],
        styles,
        flourish_width,
    )

    slashing_mobile_card = compact_card(
        "Режущий / Мобильный",
        [
            p(
                "<b>Режущий:</b> +1к10 первоначальной цели; 1к10 выбранной цели в 5 фт.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.4 * mm),
            p(
                "<b>Мобильный:</b> +1к10; цель Большая или меньше отталкивается на 5 фт + к10; "
                "реакцией сместиться к цели.",
                styles["body_tiny"],
            ),
        ],
        styles,
        flourish_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    three_card_row(
                        attack_card,
                        defensive_card,
                        slashing_mobile_card,
                        flourish_width,
                        flourish_gap,
                    )
                ]
            ),
            Spacer(1, 0.7 * mm),
            p(
                "<b>Общее правило Росчерка:</b> требуется действие «Атака» и попадание оружейной атакой. "
                "Потрать одну кость Вдохновения барда; не более одного Росчерка за ход. "
                "Мобильный росчерк конкурирует с Контрзаклинанием за реакцию.",
                styles["body_small"],
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Вдохновение барда и концентрация", styles))

    inspiration_card = compact_card(
        "Вдохновение барда",
        [
            p(
                f"<b>{BARD_INSPIRATION_COUNT} × {BARD_INSPIRATION_DIE}</b> · короткий или долгий отдых.",
                styles["body_small"],
            ),
            Spacer(1, 0.65 * mm),
            checkbox_row(BARD_INSPIRATION_COUNT),
            Spacer(1, 0.65 * mm),
            p(
                "Бонусное действие: другое существо в 60 фт, которое слышит тебя; "
                "кость действует 10 минут.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                "Кость 1: ____________  Кость 2: ____________"
                "<br/>Кость 3: ____________  Кость 4: ____________",
                styles["body_tiny"],
            ),
        ],
        styles,
        half_width,
    )

    concentration_card = compact_card(
        "Концентрация",
        [
            p(
                "Текущая: ______________________________",
                styles["body_small"],
            ),
            Spacer(1, 0.65 * mm),
            p(
                f"Урон → спасбросок Телосложения {format_bonus(CONCENTRATION_SAVE_BONUS)}. "
                "СЛ = 10 или половина урона, что больше.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                "Режимы: Удержание личности · Гипнотический узор · "
                "Высшая невидимость · Разящее око.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.45 * mm),
            p(
                "Новое заклинание концентрации прекращает старое.",
                styles["body_tiny"],
            ),
        ],
        styles,
        half_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    two_card_row(
                        inspiration_card,
                        concentration_card,
                        half_width,
                        gap,
                    )
                ]
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Экономика хода", styles))

    action_gap = 2.2 * mm
    action_width = (CARD_INNER_WIDTH - 2 * action_gap) / 3

    action_card = compact_card(
        "Действие",
        [
            p(
                "Атака ×2 · заклинание со временем «действие» · Рывок · Отход · "
                "Уклонение · Помощь · Поиск · Засада · Готовность · предмет.",
                styles["body_tiny"],
            ),
        ],
        styles,
        action_width,
    )

    bonus_card = compact_card(
        "Бонусное действие",
        [
            p(
                "Вдохновение барда · Лечащее слово.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "Если наложила заклинание бонусным действием, другое заклинание "
                "в этот ход — только заговор со временем «действие».",
                styles["body_tiny"],
            ),
        ],
        styles,
        action_width,
    )

    reaction_card = compact_card(
        "Реакция",
        [
            p(
                "Контрзаклинание · Мобильный росчерк: смещение · "
                "реакционная атака по уходящему врагу.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Одна реакция</b> до начала следующего хода.",
                styles["body_tiny"],
            ),
        ],
        styles,
        action_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    three_card_row(
                        action_card,
                        bonus_card,
                        reaction_card,
                        action_width,
                        action_gap,
                    )
                ]
            ),
            section_spacer(),
        ]
    )

    return story


def cantrip_card(
    cantrip: Cantrip,
    styles: dict[str, ParagraphStyle],
    width: float,
) -> Table:
    """Карточка заговора."""

    content = [
        p(
            f"<b>Время:</b> {cantrip.casting_time} · "
            f"<b>Дистанция:</b> {cantrip.range_text}"
            f"<br/><b>Длит.:</b> {cantrip.duration} · "
            f"<b>Бросок:</b> {cantrip.save_or_attack}"
            f"<br/><b>Компоненты:</b> {cantrip.components}",
            styles["body_tiny"],
        ),
        Spacer(1, 0.35 * mm),
        p(
            f"<b>Эффект:</b> {cantrip.effect}",
            styles["body_tiny"],
        ),
    ]

    if cantrip.material != "—":
        content.extend(
            [
                Spacer(1, 0.35 * mm),
                p(
                    f"<b>Материал:</b> {cantrip.material}",
                    styles["body_tiny"],
                ),
            ]
        )

    return compact_card(
        cantrip.name,
        content,
        styles,
        width,
        cantrip.source,
    )


def spell_card(
    spell: Spell,
    styles: dict[str, ParagraphStyle],
    width: float,
) -> Table:
    """Карточка заклинания."""

    concentration_text = "да" if spell.concentration else "нет"

    content = [
        p(
            f"<b>Время:</b> {spell.casting_time} · "
            f"<b>Дистанция:</b> {spell.range_text}"
            f"<br/><b>Длит.:</b> {spell.duration} · "
            f"<b>Конц.:</b> {concentration_text}"
            f"<br/><b>Бросок:</b> {spell.save_or_attack}"
            f"<br/><b>Компоненты:</b> {spell.components}",
            styles["body_tiny"],
        ),
        Spacer(1, 0.35 * mm),
        p(
            f"<b>Эффект:</b> {spell.effect}",
            styles["body_tiny"],
        ),
    ]

    if spell.upcast:
        content.extend(
            [
                Spacer(1, 0.35 * mm),
                p(
                    f"<b>Ячейка выше:</b> {spell.upcast}",
                    styles["body_tiny"],
                ),
            ]
        )

    if spell.material != "—":
        content.extend(
            [
                Spacer(1, 0.35 * mm),
                p(
                    f"<b>Материал:</b> {spell.material}",
                    styles["body_tiny"],
                ),
            ]
        )

    subtitle = f"{spell.level} уровень"

    if spell.source:
        subtitle += f" · {spell.source}"

    return compact_card(
        spell.name,
        content,
        styles,
        width,
        subtitle,
    )


def build_spell_rows(
    cards: list[Table],
    cards_per_row: int,
    width: float,
    gap: float,
) -> list:
    """Создать независимые строки карточек без вложения в родительские Table."""

    flowables: list = []

    if cards_per_row == 2:
        for index in range(0, len(cards), 2):
            left = cards[index]

            if index + 1 < len(cards):
                right = cards[index + 1]
            else:
                right = Table(
                    [[""]],
                    colWidths=[width],
                    style=TableStyle(
                        [
                            ("BOX", (0, 0), (-1, -1), 0, WHITE),
                        ]
                    ),
                )

            flowables.append(
                KeepTogether(
                    [
                        two_card_row(left, right, width, gap),
                    ]
                )
            )
            flowables.append(row_spacer())

    else:
        for index in range(0, len(cards), 3):
            current_cards = cards[index:index + 3]

            while len(current_cards) < 3:
                current_cards.append(
                    Table(
                        [[""]],
                        colWidths=[width],
                        style=TableStyle(
                            [
                                ("BOX", (0, 0), (-1, -1), 0, WHITE),
                            ]
                        ),
                    )
                )

            flowables.append(
                KeepTogether(
                    [
                        three_card_row(
                            current_cards[0],
                            current_cards[1],
                            current_cards[2],
                            width,
                            gap,
                        ),
                    ]
                )
            )
            flowables.append(row_spacer())

    return flowables


def build_page_two(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Лист 2: заговоры и заклинания 1–3 уровней."""

    story: list = [
        p("Магия: заговоры и заклинания 1–3 уровней", styles["page_title"])
    ]

    story.append(section_header("Ячейки заклинаний", styles))

    slots_rows = [
        [
            p("1 УР.", styles["table_header"]),
            checkbox_row(4, 4.4 * mm),
            p("2 УР.", styles["table_header"]),
            checkbox_row(3, 4.4 * mm),
            p("3 УР.", styles["table_header"]),
            checkbox_row(3, 4.4 * mm),
        ]
    ]

    slots_table = full_width_table(
        slots_rows,
        [
            14 * mm,
            30 * mm,
            14 * mm,
            25 * mm,
            14 * mm,
            CARD_INNER_WIDTH - 97 * mm,
        ],
        [
            ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
            ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ],
    )

    story.extend(
        [
            slots_table,
            Spacer(1, 0.75 * mm),
            p(
                "Концентрация: Удержание личности · Гипнотический узор. "
                "Реакция: Контрзаклинание.",
                styles["body_small"],
            ),
            section_spacer(),
        ]
    )

    gap = 2.8 * mm
    card_width = (CONTENT_WIDTH - gap) / 2

    story.append(section_header("Заговоры", styles))

    cantrip_cards = [
        cantrip_card(cantrip, styles, card_width)
        for cantrip in CANTRIPS
    ]

    story.extend(build_spell_rows(cantrip_cards, 2, card_width, gap))
    story.append(section_spacer())

    spells_by_level: dict[int, list[Spell]] = {}

    for spell in SPELLS:
        spells_by_level.setdefault(spell.level, []).append(spell)

    for level in (1, 2, 3):
        story.append(section_header(f"Заклинания {level} уровня", styles))

        level_cards = [
            spell_card(spell, styles, card_width)
            for spell in spells_by_level[level]
        ]

        story.extend(build_spell_rows(level_cards, 2, card_width, gap))
        story.append(section_spacer())

    story.append(section_header("Индекс по спасброскам", styles))

    saves_index_rows = [
        [
            p("<b>Мудрость СЛ 16</b>", styles["body_small"]),
            p(
                "Злая насмешка · Диссонирующий шёпот · Удержание личности · "
                "Гипнотический узор · Разящее око.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Ловкость СЛ 16</b>", styles["body_small"]),
            p("Разбрасывание карт.", styles["body_small"]),
        ],
        [
            p("<b>Телосложение СЛ 16</b>", styles["body_small"]),
            p("Слепота/Глухота.", styles["body_small"]),
        ],
        [
            p("<b>Интеллект СЛ 16</b>", styles["body_small"]),
            p(
                "Расщепление разума · Психическое копьё Раулотима · "
                "Синаптический разряд.",
                styles["body_small"],
            ),
        ],
    ]

    story.extend(
        [
            full_width_table(
                saves_index_rows,
                [39 * mm, CARD_INNER_WIDTH - 39 * mm],
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                    ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ],
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Расовая магия", styles))

    racial_rows = [
        [
            p("<b>Малая иллюзия</b>", styles["body_small"]),
            p("Заговор, постоянно доступен.", styles["body_small"]),
        ],
        [
            p("<b>Маскировка</b>", styles["body_small"]),
            p("□ 1 применение за долгий отдых.", styles["body_small"]),
        ],
        [
            p("<b>Невидимость</b>", styles["body_small"]),
            p("□ 1 применение за долгий отдых.", styles["body_small"]),
        ],
    ]

    story.extend(
        [
            full_width_table(
                racial_rows,
                [39 * mm, CARD_INNER_WIDTH - 39 * mm],
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                    ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ],
            ),
            section_spacer(),
        ]
    )

    return story


def build_page_three(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Лист 3: заклинания 4–6 уровней, компоненты и оперативные правила."""

    story: list = [
        p("Магия: заклинания 4–6 уровней и компоненты", styles["page_title"])
    ]

    story.append(section_header("Ячейки заклинаний", styles))

    slots_rows = [
        [
            p("4 УР.", styles["table_header"]),
            checkbox_row(3, 4.5 * mm),
            p("5 УР.", styles["table_header"]),
            checkbox_row(2, 4.5 * mm),
            p("6 УР.", styles["table_header"]),
            checkbox_row(1, 4.5 * mm),
        ]
    ]

    slots_table = full_width_table(
        slots_rows,
        [
            14 * mm,
            27 * mm,
            14 * mm,
            22 * mm,
            14 * mm,
            CARD_INNER_WIDTH - 91 * mm,
        ],
        [
            ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
            ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ],
    )

    story.extend(
        [
            slots_table,
            Spacer(1, 0.75 * mm),
            p(
                "Концентрация: Высшая невидимость · Разящее око. "
                "Проверка Контрзаклинания / Рассеивания магии: Харизма +6.",
                styles["body_small"],
            ),
            section_spacer(),
        ]
    )

    gap = 2.8 * mm
    card_width = (CONTENT_WIDTH - gap) / 2

    spells_by_level: dict[int, list[Spell]] = {}

    for spell in SPELLS:
        spells_by_level.setdefault(spell.level, []).append(spell)

    for level in (4, 5, 6):
        story.append(section_header(f"Заклинания {level} уровня", styles))

        level_cards = [
            spell_card(spell, styles, card_width)
            for spell in spells_by_level[level]
        ]

        story.extend(build_spell_rows(level_cards, 2, card_width, gap))
        story.append(section_spacer())

    utility_cards = [
        spell_card(
            next(spell for spell in SPELLS if spell.name == "Малое восстановление"),
            styles,
            card_width,
        ),
        spell_card(
            next(spell for spell in SPELLS if spell.name == "Рассеивание магии"),
            styles,
            card_width,
        ),
    ]

    story.append(section_header("Utility и антимагия", styles))
    story.extend(build_spell_rows(utility_cards, 2, card_width, gap))
    story.append(section_spacer())

    story.append(section_header("Материальные компоненты", styles))

    components_rows = [
        [
            p("<b>Фокус</b>", styles["body_small"]),
            p(
                "Солнечный клинок. Покрывает обычные М-компоненты без цены и без расходования.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Высшее восстановление</b>", styles["body_small"]),
            p(
                "Алмазная пыль 100 зм. Расходуется: одна порция за накладывание.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Разбрасывание карт</b>", styles["body_small"]),
            p("Колода карт. Не расходуется.", styles["body_small"]),
        ],
        [
            p("<b>Психическое копьё</b>", styles["body_small"]),
            p(
                "Если не произносится имя цели: предмет с её изображением стоимостью 1 зм.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Воровские инструменты</b>", styles["body_small"]),
            p(
                f"Живые перчатки: Ловкость +4 + двойной бонус мастерства +8 = +{THIEVES_TOOLS_BONUS}.",
                styles["body_small"],
            ),
        ],
    ]

    story.extend(
        [
            full_width_table(
                components_rows,
                [47 * mm, CARD_INNER_WIDTH - 47 * mm],
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                    ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ],
            ),
            Spacer(1, 0.75 * mm),
            p(
                "Алмазная пыль 100 зм: □ 1   □ 2   □ 3   □ 4",
                styles["body_small"],
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Аттюнемент", styles))

    attunement_rows = [
        [
            p("□", styles["value"]),
            p("<b>Солнечный клинок</b>", styles["body_small"]),
        ],
        [
            p("□", styles["value"]),
            p("<b>Амулет здоровья</b> — Телосложение 19 (+4).", styles["body_small"]),
        ],
        [
            p("□", styles["value"]),
            p("<b>Живые перчатки</b> — воровские инструменты +12.", styles["body_small"]),
        ],
    ]

    story.extend(
        [
            full_width_table(
                attunement_rows,
                [12 * mm, CARD_INNER_WIDTH - 12 * mm],
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                    ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                    ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ],
            ),
            section_spacer(),
        ]
    )

    return story


def build_page_four(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Лист 4: навыки, инвентарь, ролевая информация, заметки."""

    story: list = [
        p("Навыки, инвентарь и заметки кампании", styles["page_title"])
    ]

    story.append(section_header("Все навыки", styles))

    skills_by_ability: dict[str, list[Skill]] = {
        key: []
        for key in ABILITIES
    }

    for skill in SKILLS:
        skills_by_ability[skill.ability_key].append(skill)

    skill_rows = []

    for ability_key, ability in ABILITIES.items():
        skill_names = skills_by_ability[ability_key]

        for index, skill in enumerate(skill_names):
            prefix = (
                f"<b>{ability.name.upper()} {format_bonus(ability.modifier)}</b>"
                if index == 0
                else ""
            )

            source = f" · {skill.source}" if skill.source else ""

            skill_rows.append(
                [
                    p(prefix, styles["body_tiny"]),
                    p(
                        f"<b>{proficiency_marker(skill)} {skill.name}</b>",
                        styles["body_tiny"],
                    ),
                    p(
                        f"<b>{format_bonus(skill_bonus(skill))}</b>",
                        styles["center"],
                    ),
                    p(
                        f"{proficiency_label(skill)}{source}",
                        styles["body_tiny"],
                    ),
                ]
            )

    skills_table = full_width_table(
        skill_rows,
        [
            25 * mm,
            47 * mm,
            14 * mm,
            CARD_INNER_WIDTH - 86 * mm,
        ],
        [
            ("GRID", (0, 0), (-1, -1), 0.32, MID_GRAY),
            ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
            ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ],
    )

    story.extend(
        [
            p(
                f"★ экспертность · ● владение · ○ «Мастер на все руки» (+{JACK_OF_ALL_TRADES}) "
                "уже включён в непрофильные навыки.",
                styles["body_small"],
            ),
            Spacer(1, 0.65 * mm),
            skills_table,
            section_spacer(),
        ]
    )

    story.append(section_header("Инструменты и снаряжение", styles))

    equipment_rows = [
        [
            p("<b>Воровские инструменты</b>", styles["body_small"]),
            p(f"+{THIEVES_TOOLS_BONUS} · Живые перчатки · двойной бонус мастерства.", styles["body_small"]),
        ],
        [
            p("<b>Музыкальные инструменты</b>", styles["body_small"]),
            p("Виола: ____________________  Другие: ____________________", styles["body_small"]),
        ],
        [
            p("<b>Набор для грима</b>", styles["body_small"]),
            p("Маскировка, сценические образы, документы/внешность по ситуации.", styles["body_small"]),
        ],
        [
            p("<b>Надето / при себе</b>", styles["body_small"]),
            p("Солнечный клинок · доспех из змеиной чешуи · Амулет здоровья · Живые перчатки.", styles["body_small"]),
        ],
        [
            p("<b>Расходники</b>", styles["body_small"]),
            p("Зелья лечения: □ 1  □ 2  □ 3  □ 4", styles["body_small"]),
        ],
        [
            p("<b>Деньги</b>", styles["body_small"]),
            p("Зм: __________  См: __________  Прочее: ____________________", styles["body_small"]),
        ],
    ]

    story.extend(
        [
            full_width_table(
                equipment_rows,
                [47 * mm, CARD_INNER_WIDTH - 47 * mm],
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                    ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ],
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Ролевая панель", styles))

    roleplay_rows = [
        [
            p("<b>Сильные стороны</b>", styles["body_small"]),
            p(
                "Акробатика +12 · Обман +12 · Выступление +12 · Убеждение +12.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Образ</b>", styles["body_small"]),
            p(
                "Сценическое спокойствие; обаяние как оружие; контроль внимания и пространства.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Рычаги</b>", styles["body_small"]),
            p(
                "Порядок, дисциплина, цена, публичный стыд, секреты.",
                styles["body_small"],
            ),
        ],
        [
            p("<b>Цель</b>", styles["body_small"]),
            p(
                "Разрушить, подчинить или очистить Орден Кровавой Каденции, не став его новой верхушкой; "
                "сорвать игры Векны и тех, кто торгует секретами.",
                styles["body_small"],
            ),
        ],
    ]

    story.extend(
        [
            full_width_table(
                roleplay_rows,
                [35 * mm, CARD_INNER_WIDTH - 35 * mm],
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                    ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ],
            ),
            section_spacer(),
        ]
    )

    story.append(section_header("Заметки кампании", styles))

    notes_gap = 3.0 * mm
    note_width = (CONTENT_WIDTH - notes_gap) / 2

    npc_notes = compact_card(
        "NPC и фракции",
        [
            p(
                "________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________",
                styles["body_small"],
            )
        ],
        styles,
        note_width,
    )

    secret_notes = compact_card(
        "Секреты и улики",
        [
            p(
                "________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________",
                styles["body_small"],
            )
        ],
        styles,
        note_width,
    )

    target_notes = compact_card(
        "Текущие цели",
        [
            p(
                "________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________",
                styles["body_small"],
            )
        ],
        styles,
        note_width,
    )

    loot_notes = compact_card(
        "Добыча и расходники",
        [
            p(
                "________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________"
                "<br/>________________________________________",
                styles["body_small"],
            )
        ],
        styles,
        note_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    two_card_row(
                        npc_notes,
                        secret_notes,
                        note_width,
                        notes_gap,
                    )
                ]
            ),
            row_spacer(),
            KeepTogether(
                [
                    two_card_row(
                        target_notes,
                        loot_notes,
                        note_width,
                        notes_gap,
                    )
                ]
            ),
            section_spacer(),
        ]
    )

    return story


def build_pdf(output_path: Path) -> None:
    """Собрать PDF."""

    register_fonts()
    styles = create_styles()

    frame = Frame(
        MARGIN_X,
        MARGIN_BOTTOM,
        CONTENT_WIDTH,
        CONTENT_HEIGHT,
        id="main",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )

    template = PageTemplate(
        id="aurelia",
        frames=[frame],
        onPage=lambda canvas, doc: (
            draw_header(canvas, doc),
            draw_footer(canvas, doc),
        ),
    )

    document = BaseDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        pageTemplates=[template],
        title="Аурелия — функциональный лист персонажа",
        author="Aurelia Character Sheet Generator",
    )

    story: list = []

    story.extend(build_page_one(styles))
    story.append(PageBreak())

    story.extend(build_page_two(styles))
    story.append(PageBreak())

    story.extend(build_page_three(styles))
    story.append(PageBreak())

    story.extend(build_page_four(styles))

    document.build(story)

    if not output_path.exists():
        raise RuntimeError("PDF не создан.")

    if output_path.stat().st_size == 0:
        raise RuntimeError("PDF создан, но пустой.")


def main() -> None:
    """Точка входа."""

    output_path = Path.cwd() / OUTPUT_FILENAME
    build_pdf(output_path)
    print(f"Готово: {output_path}")


if __name__ == "__main__":
    main()
