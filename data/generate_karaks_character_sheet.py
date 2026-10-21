#!/usr/bin/env python3
"""
Компактная чёрно-белая памятка для Каракса Драэнвера (D&D 5e, 2014).

Установка:
    py -m pip install reportlab

Запуск:
    py generate_karaks_character_sheet.py

Результат:
    karaks_draenver_character_sheet.pdf

Ключевой layout-инвариант:
- CONTENT_WIDTH: ширина внешней карточки.
- CARD_INNER_WIDTH: ширина ВСЕГО, что находится внутри внешней карточки.
- Вложенные таблицы никогда не используют CONTENT_WIDTH.
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


OUTPUT_FILENAME = "karaks_draenver_character_sheet.pdf"

PAGE_WIDTH, PAGE_HEIGHT = A4

MARGIN_X = 8.5 * mm
MARGIN_TOP = 14.0 * mm
MARGIN_BOTTOM = 13.0 * mm

CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

CARD_PADDING_X = 1.8 * mm
CARD_PADDING_Y = 1.7 * mm
CARD_INNER_WIDTH = CONTENT_WIDTH - 2 * CARD_PADDING_X

BLACK = colors.HexColor("#111111")
DARK_GRAY = colors.HexColor("#303030")
MID_GRAY = colors.HexColor("#858585")
VERY_LIGHT_GRAY = colors.HexColor("#F7F7F7")
WHITE = colors.white

Proficiency = Literal["none", "proficient", "expertise"]


@dataclass(frozen=True)
class Ability:
    key: str
    name: str
    score: int

    @property
    def modifier(self) -> int:
        return (self.score - 10) // 2


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    ability_key: str
    proficiency: Proficiency
    source: str | None
    use_cases: str
    phrase: str


@dataclass(frozen=True)
class Maneuver:
    title: str
    trigger: str
    cost: str
    effect: str
    purpose: str
    reaction: bool = False


ABILITIES: dict[str, Ability] = {
    "strength": Ability("strength", "Сила", 18),
    "dexterity": Ability("dexterity", "Ловкость", 14),
    "constitution": Ability("constitution", "Телосложение", 18),
    "intelligence": Ability("intelligence", "Интеллект", 10),
    "wisdom": Ability("wisdom", "Мудрость", 10),
    "charisma": Ability("charisma", "Харизма", 11),
}

LEVEL = 11
MAX_HP = 114
PROFICIENCY_BONUS = 4

ARMOR_CLASS = 21
INITIATIVE = ABILITIES["dexterity"].modifier
SPEED = "30 фт"

STRENGTH_MOD = ABILITIES["strength"].modifier

SHATTERSPIKE_ATTACK = STRENGTH_MOD + PROFICIENCY_BONUS + 1
SHATTERSPIKE_DAMAGE = "1к8 +5 рубящего"
SHATTERSPIKE_CRIT = "2к8 +5 рубящего"

BOOMERANG_SHIELD_ATTACK = STRENGTH_MOD + PROFICIENCY_BONUS
BOOMERANG_SHIELD_DAMAGE = "1к6 рубящего"
BOOMERANG_SHIELD_RANGE = "20 / 60 фт"

MANEUVER_SAVE_DC = 8 + PROFICIENCY_BONUS + STRENGTH_MOD
SUPERIORITY_DICE_COUNT = 5
SUPERIORITY_DIE = "к10"


SKILLS: list[Skill] = [
    Skill(
        "athletics",
        "Атлетика",
        "strength",
        "proficient",
        "class",
        "толкнуть, удержать, поднять, плыть, карабкаться",
        "«Удерживаю дверь, пока союзники проходят. Можно Атлетику?»",
    ),
    Skill(
        "acrobatics",
        "Акробатика",
        "dexterity",
        "proficient",
        "background",
        "баланс, прыжки, трюки, узкий край, выход из захвата",
        "«Перепрыгиваю пролом и приземляюсь на узкий край. Можно Акробатику?»",
    ),
    Skill(
        "sleightOfHand",
        "Ловкость рук",
        "dexterity",
        "none",
        None,
        "подменить, спрятать, незаметно взять предмет",
        "«Пока он отвлечён, незаметно забираю ключ. Можно Ловкость рук?»",
    ),
    Skill(
        "stealth",
        "Скрытность",
        "dexterity",
        "none",
        None,
        "спрятаться, двигаться тихо, остаться незамеченным",
        "«Держусь в тени и подхожу тихо. Можно Скрытность?»",
    ),
    Skill(
        "arcana",
        "Магия",
        "intelligence",
        "none",
        None,
        "магические руны, заклинание, арканный предмет",
        "«Пытаюсь понять назначение этих рун. Можно Магию?»",
    ),
    Skill(
        "history",
        "История",
        "intelligence",
        "none",
        None,
        "войны, роды, правители, легенды, старые события",
        "«Мне знаком этот герб или имя? Можно Историю?»",
    ),
    Skill(
        "investigation",
        "Расследование",
        "intelligence",
        "none",
        None,
        "улики, механизм, тайник, скрытая деталь, связь фактов",
        "«Проверяю, нет ли здесь скрытого рычага. Можно Расследование?»",
    ),
    Skill(
        "nature",
        "Природа",
        "intelligence",
        "none",
        None,
        "растения, звери, погода, природная опасность",
        "«Что это за следы и растения? Можно Природу?»",
    ),
    Skill(
        "religion",
        "Религия",
        "intelligence",
        "none",
        None,
        "божества, культы, ритуалы, священные символы, нежить",
        "«Чей это символ и что означает ритуал? Можно Религию?»",
    ),
    Skill(
        "animalHandling",
        "Уход за животными",
        "wisdom",
        "none",
        None,
        "успокоить, направить или понять животное",
        "«Говорю тихо и протягиваю руку к лошади. Можно Уход за животными?»",
    ),
    Skill(
        "insight",
        "Проницательность",
        "wisdom",
        "none",
        None,
        "намерения, страх, нервозность, скрытые эмоции, ложь",
        "«Слежу за его лицом, когда называю имя капитана. Можно Проницательность?»",
    ),
    Skill(
        "medicine",
        "Медицина",
        "wisdom",
        "none",
        None,
        "стабилизировать, оценить травму, болезнь или причину смерти",
        "«Проверяю дыхание и рану. Можно Медицину?»",
    ),
    Skill(
        "perception",
        "Восприятие",
        "wisdom",
        "proficient",
        "class",
        "увидеть, услышать, учуять опасность или скрытую деталь",
        "«Осматриваю потолок и прислушиваюсь у двери. Можно Восприятие?»",
    ),
    Skill(
        "survival",
        "Выживание",
        "wisdom",
        "none",
        None,
        "следы, дорога, лагерь, вода, еда, ориентирование",
        "«Ищу свежие следы и безопасное место для лагеря. Можно Выживание?»",
    ),
    Skill(
        "deception",
        "Обман",
        "charisma",
        "none",
        None,
        "ложь, блеф, легенда, скрытие настоящих намерений",
        "«Говорю так, будто нас уже ждут. Можно Обман?»",
    ),
    Skill(
        "intimidation",
        "Запугивание",
        "charisma",
        "proficient",
        "class",
        "угроза, давление, демонстрация силы и непреклонности",
        "«Даю понять, что сопротивление опасно. Можно Запугивание?»",
    ),
    Skill(
        "performance",
        "Выступление",
        "charisma",
        "none",
        None,
        "песня, речь, история, игра, отвлечение толпы",
        "«Собираю внимание толпы воинской балладой. Можно Выступление?»",
    ),
    Skill(
        "persuasion",
        "Убеждение",
        "charisma",
        "none",
        None,
        "договориться, попросить помощь, предложить союз, найти компромисс",
        "«Объясняю, почему союз будет выгоден всем. Можно Убеждение?»",
    ),
]


MANEUVERS: list[Maneuver] = [
    Maneuver(
        "Ответный удар",
        "Враг промахнулся по тебе рукопашной атакой.",
        "Реакция + 1к10.",
        "Сделай одну рукопашную атаку. При попадании добавь 1к10 к урону.",
        "Наказать врага за промах.",
        reaction=True,
    ),
    Maneuver(
        "Парирование",
        "Тебе нанесли урон рукопашной атакой.",
        "Реакция + 1к10.",
        "Уменьши полученный урон на 1к10 +2.",
        "Сохранить хиты против сильного удара.",
        reaction=True,
    ),
    Maneuver(
        "Опрокидывающая атака",
        "Ты попал оружейной атакой.",
        "1к10.",
        "Добавь 1к10 урона. Цель Большая или меньше: Сила СЛ 16. Провал: ничком.",
        "Сбить опасного врага.",
    ),
    Maneuver(
        "Обезоруживающая атака",
        "Ты попал оружейной атакой.",
        "1к10.",
        "Добавь 1к10 урона. Цель: Сила СЛ 16. Провал: роняет выбранный предмет.",
        "Выбить оружие, фокус или ключ.",
    ),
    Maneuver(
        "Толкающая атака",
        "Ты попал оружейной атакой.",
        "1к10.",
        "Добавь 1к10 урона. Цель Большая или меньше: Сила СЛ 16. Провал: толкни до 15 фт.",
        "Оттолкнуть от союзника или края.",
    ),
    Maneuver(
        "Широкая атака",
        "Попал в ближнем бою; второй враг рядом с первой целью и в досягаемости.",
        "1к10.",
        "Если исходный бросок попал бы по второму врагу, он получает 1к10 урона того же типа.",
        "Ударить двух рядом стоящих врагов.",
    ),
    Maneuver(
        "Активное уклонение",
        "Начинаешь перемещение.",
        "1к10.",
        "Добавь бросок 1к10 к КД, пока не остановишься. КД: 21 +1к10.",
        "Безопасно пройти через опасную зону.",
    ),
]


def format_bonus(value: int) -> str:
    """Форматировать модификатор с плюсом."""

    return f"+{value}" if value >= 0 else str(value)


def skill_bonus(skill: Skill) -> int:
    """Рассчитать итоговый бонус навыка."""

    proficiency_multiplier = {
        "none": 0,
        "proficient": 1,
        "expertise": 2,
    }[skill.proficiency]

    return (
        ABILITIES[skill.ability_key].modifier
        + PROFICIENCY_BONUS * proficiency_multiplier
    )


def proficiency_marker(proficiency: Proficiency) -> str:
    """Короткий маркер владения."""

    return {
        "none": "○",
        "proficient": "●",
        "expertise": "★",
    }[proficiency]


def proficiency_text(proficiency: Proficiency) -> str:
    """Текстовая расшифровка владения."""

    return {
        "none": "без владения",
        "proficient": "владение",
        "expertise": "экспертность",
    }[proficiency]


def find_font_paths() -> tuple[Path, Path]:
    """Найти кириллический TTF-шрифт на Windows/macOS/Linux."""

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
        "Не найден шрифт с кириллицей. "
        "Проверь функцию find_font_paths()."
    )


def register_fonts() -> None:
    """Зарегистрировать регулярный и жирный шрифты."""

    regular_font, bold_font = find_font_paths()

    pdfmetrics.registerFont(TTFont("Karaks", str(regular_font)))
    pdfmetrics.registerFont(TTFont("Karaks-Bold", str(bold_font)))


def create_styles() -> dict[str, ParagraphStyle]:
    """Создать все стили документа."""

    base = getSampleStyleSheet()["Normal"]

    return {
        "page_title": ParagraphStyle(
            "page_title",
            parent=base,
            fontName="Karaks-Bold",
            fontSize=12.0,
            leading=14.0,
            textColor=BLACK,
            spaceAfter=1.8 * mm,
        ),
        "section_title": ParagraphStyle(
            "section_title",
            parent=base,
            fontName="Karaks-Bold",
            fontSize=7.35,
            leading=8.45,
            textColor=BLACK,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base,
            fontName="Karaks",
            fontSize=6.85,
            leading=8.0,
            textColor=BLACK,
        ),
        "body_small": ParagraphStyle(
            "body_small",
            parent=base,
            fontName="Karaks",
            fontSize=6.15,
            leading=7.15,
            textColor=BLACK,
        ),
        "body_tiny": ParagraphStyle(
            "body_tiny",
            parent=base,
            fontName="Karaks",
            fontSize=5.5,
            leading=6.4,
            textColor=BLACK,
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base,
            fontName="Karaks-Bold",
            fontSize=5.2,
            leading=6.05,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "value": ParagraphStyle(
            "value",
            parent=base,
            fontName="Karaks-Bold",
            fontSize=9.2,
            leading=10.7,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "value_small": ParagraphStyle(
            "value_small",
            parent=base,
            fontName="Karaks-Bold",
            fontSize=7.1,
            leading=8.2,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "center": ParagraphStyle(
            "center",
            parent=base,
            fontName="Karaks",
            fontSize=6.05,
            leading=7.05,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
    }


def p(text: str, style: ParagraphStyle) -> Paragraph:
    """Создать Paragraph из текста."""

    return Paragraph(text.replace("\n", "<br/>"), style)


def resource_boxes(
    count: int,
    box_size: float = 5.0 * mm,
) -> Table:
    """Создать стабильные пустые клетки для ресурса."""

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


def full_width_card(
    title: str,
    content: list,
    styles: dict[str, ParagraphStyle],
    subtitle: str | None = None,
) -> list:
    """Создать внешнюю карточку на всю ширину страницы."""

    heading = title.upper()

    if subtitle:
        heading += (
            f" <font name='Karaks' size='5.0'>· {subtitle}</font>"
        )

    card_body = [
        p(heading, styles["section_title"]),
        Spacer(1, 0.95 * mm),
        *content,
    ]

    outer_table = Table(
        [[card_body]],
        colWidths=[CONTENT_WIDTH],
    )

    outer_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.55, DARK_GRAY),
                ("LEFTPADDING", (0, 0), (-1, -1), CARD_PADDING_X),
                ("RIGHTPADDING", (0, 0), (-1, -1), CARD_PADDING_X),
                ("TOPPADDING", (0, 0), (-1, -1), CARD_PADDING_Y),
                ("BOTTOMPADDING", (0, 0), (-1, -1), CARD_PADDING_Y),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )

    return [
        KeepTogether([outer_table]),
        Spacer(1, 1.75 * mm),
    ]


def column_card(
    title: str,
    content: list,
    styles: dict[str, ParagraphStyle],
    width: float,
    subtitle: str | None = None,
) -> Table:
    """Создать авто-высотную карточку заданной ширины."""

    heading = title.upper()

    if subtitle:
        heading += (
            f" <font name='Karaks' size='4.85'>· {subtitle}</font>"
        )

    card_body = [
        p(heading, styles["section_title"]),
        Spacer(1, 0.75 * mm),
        *content,
    ]

    table = Table(
        [[card_body]],
        colWidths=[width],
    )

    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.45, DARK_GRAY),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.55 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.55 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.45 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.45 * mm),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )

    return table


def two_columns(
    left: Table,
    right: Table,
    item_width: float,
    gap: float,
) -> Table:
    """Разместить две карточки в строке."""

    return Table(
        [[left, "", right]],
        colWidths=[item_width, gap, item_width],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


def three_columns(
    first: Table,
    second: Table,
    third: Table,
    item_width: float,
    gap: float,
) -> Table:
    """Разместить три карточки в строке."""

    return Table(
        [[first, "", second, "", third]],
        colWidths=[
            item_width,
            gap,
            item_width,
            gap,
            item_width,
        ],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


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
    canvas.setFont("Karaks-Bold", 7.0)
    canvas.drawString(
        MARGIN_X,
        PAGE_HEIGHT - 6.8 * mm,
        "КАРАКС ДРАЭНВЕР",
    )

    canvas.setFillColor(DARK_GRAY)
    canvas.setFont("Karaks", 5.4)
    canvas.drawRightString(
        PAGE_WIDTH - MARGIN_X,
        PAGE_HEIGHT - 6.8 * mm,
        "Драконорождённый · Воин 11 · Мастер Битвы",
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
    canvas.setFont("Karaks", 5.2)
    canvas.drawString(
        MARGIN_X,
        5.2 * mm,
        "Памятка для игры · функциональная чёрно-белая печать",
    )

    canvas.drawRightString(
        PAGE_WIDTH - MARGIN_X,
        5.2 * mm,
        f"Стр. {doc.page}",
    )

    canvas.restoreState()


def status_table(
    styles: dict[str, ParagraphStyle],
) -> Table:
    """Верхняя строка с HP и ключевыми боевыми числами."""

    headers = [
        "ТЕКУЩИЕ HP",
        "ВРЕМЕННЫЕ HP",
        "КД",
        "ИНИЦИАТИВА",
        "СКОРОСТЬ",
        "МАСТЕРСТВО",
    ]

    values = [
        f"______ / <b>{MAX_HP}</b>",
        "______",
        f"<b>{ARMOR_CLASS}</b>",
        f"<b>{format_bonus(INITIATIVE)}</b>",
        f"<b>{SPEED}</b>",
        f"<b>+{PROFICIENCY_BONUS}</b>",
    ]

    table = Table(
        [
            [p(header, styles["table_header"]) for header in headers],
            [p(value, styles["value_small"]) for value in values],
        ],
        colWidths=[CONTENT_WIDTH / 6] * 6,
    )

    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, DARK_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.8 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.8 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.0 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.0 * mm),
            ]
        )
    )

    return table


def build_page_one(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Страница 1: текущие параметры, броня, оружие, ресурсы."""

    story: list = [
        p("Каракс сейчас: бой и экипировка", styles["page_title"]),
        status_table(styles),
        Spacer(1, 1.8 * mm),
    ]

    gap = 3.2 * mm
    item_width = (CONTENT_WIDTH - gap) / 2

    sword_card = column_card(
        "Разрушающее остриё",
        [
            p("<b>Главное оружие ближнего боя.</b>", styles["body_small"]),
            Spacer(1, 0.55 * mm),
            p(
                f"<b>Атака:</b> к20 {format_bonus(SHATTERSPIKE_ATTACK)}"
                f"<br/><b>Попадание:</b> {SHATTERSPIKE_DAMAGE}"
                f"<br/><b>Крит по существу:</b> {SHATTERSPIKE_CRIT}",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Если цель — объект:</b> попадание автоматически критическое. "
                "Можно выбрать дробящий или рубящий урон. "
                "Меч не получает урон от немагических источников.",
                styles["body_tiny"],
            ),
        ],
        styles,
        item_width,
        "в руке",
    )

    shield_card = column_card(
        "Щит-бумеранг",
        [
            p(
                "<b>Щит даёт +2 КД; это уже включено в КД 21.</b>",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                f"<b>Дальняя атака:</b> к20 {format_bonus(BOOMERANG_SHIELD_ATTACK)}"
                f"<br/><b>Попадание:</b> {BOOMERANG_SHIELD_DAMAGE}"
                f"<br/><b>Дальность:</b> {BOOMERANG_SHIELD_RANGE}",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "После попадания или промаха щит сразу возвращается в руку.",
                styles["body_tiny"],
            ),
        ],
        styles,
        item_width,
        "в руке",
    )

    story.extend(
        [
            KeepTogether(
                [
                    two_columns(
                        sword_card,
                        shield_card,
                        item_width,
                        gap,
                    )
                ]
            ),
            Spacer(1, 1.7 * mm),
        ]
    )

    story.extend(
        full_width_card(
            "Миззиевые латы",
            [
                p(
                    "<b>КД 21 = миззиевые латы 18 + щит-бумеранг 2 + стиль «Оборона» 1.</b>",
                    styles["body"],
                ),
                Spacer(1, 0.6 * mm),
                p(
                    "<b>Крит по тебе?</b> Считай его обычным попаданием; "
                    "дополнительные кости критического урона не бросаются.",
                    styles["body_small"],
                ),
                Spacer(1, 0.5 * mm),
                p(
                    "<b>Магический эффект:</b> если нужен спасбросок Силы или "
                    "Телосложения и при успехе обычно был бы половинный урон, "
                    "то при успехе Каракс получает <b>0 урона</b>.",
                    styles["body_small"],
                ),
                Spacer(1, 0.5 * mm),
                p(
                    "<b>Электрический урон:</b> сложи урон, раздели на 2, "
                    "округли вниз.",
                    styles["body_small"],
                ),
            ],
            styles,
            "надеты",
        )
    )

    attack_gap = 2.2 * mm
    attack_width = (CARD_INNER_WIDTH - 2 * attack_gap) / 3

    attack_cards = []

    for number in range(1, 4):
        attack_cards.append(
            column_card(
                f"Удар {number}",
                [
                    p(
                        f"<b>Попасть:</b> к20 {format_bonus(SHATTERSPIKE_ATTACK)}",
                        styles["body_small"],
                    ),
                    Spacer(1, 0.45 * mm),
                    p(
                        f"<b>Попадание:</b> {SHATTERSPIKE_DAMAGE}",
                        styles["body_small"],
                    ),
                    Spacer(1, 0.45 * mm),
                    p("□ Удар сделан", styles["body_small"]),
                ],
                styles,
                attack_width,
            )
        )

    attacks_row = three_columns(
        attack_cards[0],
        attack_cards[1],
        attack_cards[2],
        attack_width,
        attack_gap,
    )

    story.extend(
        full_width_card(
            "Три удара",
            [
                p(
                    "Действие «Атака» у Воина 11 уровня = три отдельные атаки. "
                    "Для каждого удара заново бросай к20.",
                    styles["body_small"],
                ),
                Spacer(1, 0.8 * mm),
                attacks_row,
                Spacer(1, 0.7 * mm),
                p(
                    f"<b>Натуральная 20:</b> крит — {SHATTERSPIKE_CRIT}. "
                    "<b>Натуральная 1:</b> автоматический промах. "
                    "<b>Урон:</b> сначала временные HP, затем текущие.",
                    styles["body_small"],
                ),
            ],
            styles,
        )
    )

    resource_gap = 3.2 * mm
    resource_width = (CONTENT_WIDTH - resource_gap) / 2

    resources_card = column_card(
        "Ресурсы",
        [
            p(
                "<b>Второе дыхание</b> □<br/>"
                "Бонусное действие: 1к10 +11 HP.",
                styles["body_small"],
            ),
            Spacer(1, 0.6 * mm),
            p(
                "<b>Всплеск действий</b> □<br/>"
                "После действия получи ещё одно действие: "
                "обычно ещё 3 атаки.",
                styles["body_small"],
            ),
            Spacer(1, 0.6 * mm),
            p(
                "<b>Электрическое дыхание</b> □<br/>"
                "Ловкость СЛ 16; 4к6 электричеством, "
                "при успехе половина.",
                styles["body_small"],
            ),
            Spacer(1, 0.6 * mm),
            p(
                "<b>Упорный</b> □<br/>"
                "Перебрось проваленный спасбросок.",
                styles["body_small"],
            ),
        ],
        styles,
        resource_width,
    )

    superiority_card = column_card(
        "Кости превосходства",
        [
            p(
                f"<b>{SUPERIORITY_DICE_COUNT} × {SUPERIORITY_DIE}; "
                f"СЛ манёвров {MANEUVER_SAVE_DC}.</b>",
                styles["body_small"],
            ),
            Spacer(1, 0.8 * mm),
            resource_boxes(SUPERIORITY_DICE_COUNT),
            Spacer(1, 0.8 * mm),
            p(
                "Триггер → потрать 1 кость → эффект → отметь клетку. "
                "На одну атаку — один манёвр.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "Кости, дыхание, Второе дыхание и Всплеск: "
                "короткий или долгий отдых. Упорный: долгий отдых.",
                styles["body_tiny"],
            ),
        ],
        styles,
        resource_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    two_columns(
                        resources_card,
                        superiority_card,
                        resource_width,
                        resource_gap,
                    )
                ]
            ),
            Spacer(1, 1.7 * mm),
        ]
    )

    story.extend(
        full_width_card(
            "Главное вне боя",
            [
                p(
                    "<b>Владения:</b> Атлетика +8; Акробатика +6; "
                    "Восприятие +4; Запугивание +4.",
                    styles["body_small"],
                ),
                Spacer(1, 0.45 * mm),
                p(
                    "Сначала опиши намерение обычными словами: «Хочу удержать дверь», "
                    "«Хочу пройти по балке», «Хочу заметить засаду», "
                    "«Хочу надавить на пленника». Если исход неясен, Мастер назначит бросок.",
                    styles["body_tiny"],
                ),
            ],
            styles,
        )
    )

    return story


def build_page_two(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Страница 2: порядок хода, действия, преимущество и тактика."""

    story: list = [
        p("Мой ход в бою: порядок действий", styles["page_title"])
    ]

    step_items = [
        (
            "1. Осмотрись",
            "Кто угрожает союзникам? Кто рядом с краем? "
            "У кого оружие, магия или опасная позиция?",
        ),
        (
            "2. Двигайся",
            "До 30 фт. Можно идти до, между и после атак. "
            "Обычно можно открыть дверь, поднять предмет или достать оружие.",
        ),
        (
            "3. Выбери действие",
            "Чаще всего «Атака» = 3 удара. Также: дыхание, Рывок, "
            "Отход, Уклонение, Помощь, Готовность.",
        ),
        (
            "4. Бонусное действие",
            "Обычно Второе дыхание. Оно доступно, только если способность "
            "прямо говорит, что это бонусное действие.",
        ),
        (
            "5. Сохрани реакцию",
            "Одна до начала следующего хода: Парирование, Ответный удар "
            "или реакционная атака по уходящему врагу.",
        ),
    ]

    step_rows = []

    for title, text in step_items:
        step_rows.append(
            [
                p(f"<b>{title}</b>", styles["body_small"]),
                p(text, styles["body_small"]),
            ]
        )

    steps_table = Table(
        step_rows,
        colWidths=[39 * mm, CARD_INNER_WIDTH - 39 * mm],
    )

    steps_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.15 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.15 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Алгоритм хода",
            [
                steps_table,
                Spacer(1, 0.75 * mm),
                p(
                    "Перед концом хода: □ использовал действие? "
                    "□ не забыл третий удар? □ сохраняешь реакцию? "
                    "□ отметил ресурсы?",
                    styles["body_small"],
                ),
            ],
            styles,
        )
    )

    action_items = [
        (
            "Атака",
            "3 отдельные атаки оружием. Основной выбор в ближнем бою.",
        ),
        (
            "Дыхание",
            "Враги в области: Ловкость СЛ 16. Провал: 4к6 электричеством; "
            "успех: половина.",
        ),
        (
            "Рывок",
            "Ещё до 30 фт перемещения. Используй, чтобы занять важную позицию.",
        ),
        (
            "Отход",
            "Уходи, не провоцируя реакционные атаки от существ, которых видишь.",
        ),
        (
            "Уклонение",
            "Атаки по тебе с помехой, если видишь атакующего и не потерял дееспособность.",
        ),
        (
            "Помощь",
            "Дай союзнику преимущество на следующую проверку или на следующую атаку по врагу рядом с тобой.",
        ),
    ]

    action_rows = []

    for title, text in action_items:
        action_rows.append(
            [
                p(f"<b>{title.upper()}</b>", styles["body_small"]),
                p(text, styles["body_small"]),
            ]
        )

    actions_table = Table(
        action_rows,
        colWidths=[32 * mm, CARD_INNER_WIDTH - 32 * mm],
    )

    actions_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.05 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.05 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Действия на выбор",
            [actions_table],
            styles,
        )
    )

    gap = 3.2 * mm
    item_width = (CONTENT_WIDTH - gap) / 2

    advantage_card = column_card(
        "Преимущество и помеха",
        [
            p(
                "<b>Преимущество:</b> брось 2к20, выбери больший.",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Помеха:</b> брось 2к20, выбери меньший.",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Есть оба?</b> Отменяют друг друга: брось обычный 1к20.",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "Атака: к20 + атака против КД. Проверка: к20 + навык. "
                "Спасбросок: к20 + спасбросок характеристики.",
                styles["body_tiny"],
            ),
        ],
        styles,
        item_width,
    )

    reaction_card = column_card(
        "Реакция",
        [
            p("<b>Одна до начала следующего хода.</b>", styles["body_small"]),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Враг уходит:</b> одна рукопашная атака.",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Промах по тебе:</b> Ответный удар.",
                styles["body_small"],
            ),
            Spacer(1, 0.55 * mm),
            p(
                "<b>Попадание по тебе:</b> Парирование.",
                styles["body_small"],
            ),
        ],
        styles,
        item_width,
    )

    story.extend(
        [
            KeepTogether(
                [
                    two_columns(
                        advantage_card,
                        reaction_card,
                        item_width,
                        gap,
                    )
                ]
            ),
            Spacer(1, 1.7 * mm),
        ]
    )

    tactic_items = [
        (
            "Обычный ход",
            "Подойти → Атака тремя ударами → держать реакцию на Парирование.",
        ),
        (
            "Нужно сбить",
            "Попал → Опрокидывающая атака. Хорошо против опасного ближнего врага.",
        ),
        (
            "Нужно выбить оружие",
            "Попал → Обезоруживающая атака. Союзник может подобрать предмет.",
        ),
        (
            "Нужно оттеснить",
            "Попал → Толкающая атака: от союзника, из прохода или с края.",
        ),
        (
            "Нужно быстро закончить",
            "Атака: 3 удара → Всплеск действий → Атака: ещё 3 удара.",
        ),
    ]

    tactic_rows = []

    for title, text in tactic_items:
        tactic_rows.append(
            [
                p(f"<b>{title}</b>", styles["body_small"]),
                p(text, styles["body_small"]),
            ]
        )

    tactics_table = Table(
        tactic_rows,
        colWidths=[42 * mm, CARD_INNER_WIDTH - 42 * mm],
    )

    tactics_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.1 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.1 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Готовые решения",
            [tactics_table],
            styles,
        )
    )

    return story


def maneuver_card(
    maneuver: Maneuver,
    styles: dict[str, ParagraphStyle],
    width: float,
) -> Table:
    """Карточка манёвра."""

    subtitle = "реакция" if maneuver.reaction else None

    return column_card(
        maneuver.title,
        [
            p(f"<b>Когда:</b> {maneuver.trigger}", styles["body_tiny"]),
            Spacer(1, 0.45 * mm),
            p(f"<b>Цена:</b> {maneuver.cost}", styles["body_tiny"]),
            Spacer(1, 0.45 * mm),
            p(f"<b>Эффект:</b> {maneuver.effect}", styles["body_tiny"]),
            Spacer(1, 0.45 * mm),
            p(f"<b>Зачем:</b> {maneuver.purpose}", styles["body_tiny"]),
        ],
        styles,
        width,
        subtitle,
    )


def build_page_three(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Страница 3: манёвры, спасброски, состояния."""

    story: list = [
        p("Контроль, манёвры и защита", styles["page_title"])
    ]

    story.extend(
        full_width_card(
            "Кости превосходства",
            [
                p(
                    f"<b>{SUPERIORITY_DICE_COUNT} × {SUPERIORITY_DIE}; "
                    f"СЛ манёвров {MANEUVER_SAVE_DC}.</b> "
                    "Триггер → потрать одну кость → эффект → отметь клетку. "
                    "На одну атаку — один манёвр.",
                    styles["body_small"],
                ),
                Spacer(1, 0.7 * mm),
                resource_boxes(SUPERIORITY_DICE_COUNT),
            ],
            styles,
        )
    )

    gap = 3.2 * mm
    item_width = (CONTENT_WIDTH - gap) / 2

    for index in range(0, len(MANEUVERS), 2):
        left_card = maneuver_card(
            MANEUVERS[index],
            styles,
            item_width,
        )

        if index + 1 < len(MANEUVERS):
            right_card = maneuver_card(
                MANEUVERS[index + 1],
                styles,
                item_width,
            )
        else:
            right_card = column_card(
                "Напоминание",
                [
                    p(
                        "<b>Реакция одна.</b> Если использовал Парирование, "
                        "нельзя в этом же промежутке использовать Ответный удар.",
                        styles["body_small"],
                    ),
                    Spacer(1, 0.55 * mm),
                    p(
                        "На разных атаках одного хода можно использовать разные "
                        "манёвры, если есть кости превосходства.",
                        styles["body_small"],
                    ),
                ],
                styles,
                item_width,
            )

        story.extend(
            [
                KeepTogether(
                    [
                        two_columns(
                            left_card,
                            right_card,
                            item_width,
                            gap,
                        )
                    ]
                ),
                Spacer(1, 1.55 * mm),
            ]
        )

    save_headers = [
        "СИЛА",
        "ЛОВКОСТЬ",
        "ТЕЛОСЛ.",
        "ИНТ.",
        "МУД.",
        "ХАР.",
    ]

    save_values = [
        "+8",
        "+2",
        "+8",
        "+0",
        "+0",
        "+0",
    ]

    saves_table = Table(
        [
            [p(value, styles["table_header"]) for value in save_headers],
            [p(value, styles["value_small"]) for value in save_values],
        ],
        colWidths=[CARD_INNER_WIDTH / 6] * 6,
    )

    saves_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, DARK_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), VERY_LIGHT_GRAY),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0.7 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0.7 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 0.8 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.8 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Спасброски",
            [
                p(
                    "Мастер называет характеристику → брось к20 и добавь число. "
                    "Лучшие спасброски Каракса: Сила и Телосложение.",
                    styles["body_small"],
                ),
                Spacer(1, 0.7 * mm),
                saves_table,
            ],
            styles,
        )
    )

    condition_items = [
        (
            "Ничком",
            "Встать: половина скорости. Твои атаки с помехой; "
            "враги в 5 фт атакуют тебя с преимуществом.",
        ),
        (
            "Опутан",
            "Скорость 0. Твои атаки с помехой; атаки по тебе с преимуществом; "
            "помеха на спасброски Ловкости.",
        ),
        (
            "Парализован",
            "Не двигаешься, не действуешь, нет реакции. Провал Силы и Ловкости; "
            "попадание в 5 фт — крит.",
        ),
        (
            "Ошеломлён",
            "Не действуешь, не двигаешься, нет реакции. Провал Силы и Ловкости; "
            "атаки по тебе с преимуществом.",
        ),
        (
            "Испуган",
            "Помеха на атаки и проверки, пока источник страха виден; "
            "нельзя добровольно идти к нему.",
        ),
        (
            "Очарован",
            "Не можешь атаковать очаровавшего тебя; он получает преимущество "
            "на социальные проверки против тебя.",
        ),
    ]

    condition_rows = []

    for title, text in condition_items:
        condition_rows.append(
            [
                p(f"<b>{title}</b>", styles["body_tiny"]),
                p(text, styles["body_tiny"]),
            ]
        )

    conditions_table = Table(
        condition_rows,
        colWidths=[28 * mm, CARD_INNER_WIDTH - 28 * mm],
    )

    conditions_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.35, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.2 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.2 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 0.95 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0.95 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Частые состояния",
            [conditions_table],
            styles,
        )
    )

    return story


def skill_card(
    skill: Skill,
    styles: dict[str, ParagraphStyle],
    width: float,
) -> Table:
    """Карточка навыка с применением и примером фразы."""

    ability = ABILITIES[skill.ability_key]
    bonus = skill_bonus(skill)

    source = f" · {skill.source}" if skill.source else ""

    title = (
        f"{proficiency_marker(skill.proficiency)} "
        f"{skill.name.upper()} "
        f"<font name='Karaks-Bold' size='8.2'>{format_bonus(bonus)}</font>"
    )

    return column_card(
        title,
        [
            p(
                f"<b>{ability.name} {format_bonus(ability.modifier)}</b> · "
                f"{proficiency_text(skill.proficiency)}{source}",
                styles["body_tiny"],
            ),
            Spacer(1, 0.38 * mm),
            p(
                f"<b>Когда:</b> {skill.use_cases}.",
                styles["body_tiny"],
            ),
            Spacer(1, 0.38 * mm),
            p(
                f"<b>Фраза:</b> {skill.phrase}",
                styles["body_tiny"],
            ),
        ],
        styles,
        width,
    )


def build_page_four(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Страница 4: все 18 навыков."""

    story: list = [
        p("Навыки: действие, исследование и отыгрыш", styles["page_title"])
    ]

    story.extend(
        full_width_card(
            "Как пользоваться",
            [
                p(
                    "Сначала опиши, что хочет сделать Каракс. Если результат "
                    "неясен, Мастер попросит подходящую проверку.",
                    styles["body_small"],
                ),
                Spacer(1, 0.45 * mm),
                p(
                    "<b>● владение:</b> характеристика + бонус мастерства (+4). "
                    "<b>○ без владения:</b> только модификатор характеристики. "
                    "Экспертности у Каракса сейчас нет.",
                    styles["body_tiny"],
                ),
            ],
            styles,
        )
    )

    gap = 2.45 * mm
    item_width = (CONTENT_WIDTH - 2 * gap) / 3

    for index in range(0, len(SKILLS), 3):
        group = SKILLS[index:index + 3]

        cards = [
            skill_card(skill, styles, item_width)
            for skill in group
        ]

        while len(cards) < 3:
            cards.append(
                Table(
                    [[""]],
                    colWidths=[item_width],
                    style=TableStyle(
                        [
                            ("BOX", (0, 0), (-1, -1), 0, WHITE),
                        ]
                    ),
                )
            )

        story.extend(
            [
                KeepTogether(
                    [
                        three_columns(
                            cards[0],
                            cards[1],
                            cards[2],
                            item_width,
                            gap,
                        )
                    ]
                ),
                Spacer(1, 1.35 * mm),
            ]
        )

    return story


def build_page_five(
    styles: dict[str, ParagraphStyle],
) -> list:
    """Страница 5: смерть, отдых, полезные фразы, заметки."""

    story: list = [
        p("Непредвиденное, отдых и заметки", styles["page_title"])
    ]

    death_items = [
        ("В начале хода на 0 HP", "Брось 1к20 без модификатора."),
        ("10–19", "Один успех."),
        ("2–9", "Один провал."),
        ("Натуральная 1", "Два провала."),
        ("Натуральная 20", "Сразу встаёшь с 1 HP."),
        ("Урон на 0 HP", "Один провал; критический удар на 0 HP — два провала."),
    ]

    death_rows = [
        [
            p(f"<b>{title}</b>", styles["body_small"]),
            p(text, styles["body_small"]),
        ]
        for title, text in death_items
    ]

    death_table = Table(
        death_rows,
        colWidths=[44 * mm, CARD_INNER_WIDTH - 44 * mm],
    )

    death_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.1 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.1 * mm),
            ]
        )
    )

    tracker_widths = [
        18 * mm,
        28 * mm,
        18 * mm,
        CARD_INNER_WIDTH - 64 * mm,
    ]

    death_tracker = Table(
        [
            [
                p("УСПЕХИ", styles["table_header"]),
                resource_boxes(3, 4.8 * mm),
                p("ПРОВАЛЫ", styles["table_header"]),
                resource_boxes(3, 4.8 * mm),
            ]
        ],
        colWidths=tracker_widths,
    )

    death_tracker.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Если хиты стали 0",
            [
                death_table,
                Spacer(1, 0.8 * mm),
                p(
                    "<b>Три успеха:</b> стабилен. "
                    "<b>Три провала:</b> смерть.",
                    styles["body_small"],
                ),
                Spacer(1, 0.85 * mm),
                death_tracker,
            ],
            styles,
        )
    )

    rest_items = [
        (
            "Короткий или долгий отдых",
            "Второе дыхание; Всплеск действий; электрическое дыхание; "
            "все кости превосходства.",
        ),
        (
            "Долгий отдых",
            "Всё выше, а также Упорный. HP и Кости Хитов — по обычным правилам стола.",
        ),
    ]

    rest_rows = [
        [
            p(f"<b>{title}</b>", styles["body_small"]),
            p(text, styles["body_small"]),
        ]
        for title, text in rest_items
    ]

    rest_table = Table(
        rest_rows,
        colWidths=[48 * mm, CARD_INNER_WIDTH - 48 * mm],
    )

    rest_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.15 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.15 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Отдых и восстановление",
            [rest_table],
            styles,
        )
    )

    phrase_items = [
        (
            "В бою",
            "«Я хочу подойти, ударить три раза и отойти». "
            "«Я попал — применяю Опрокидывающую атаку».",
        ),
        (
            "В разговоре",
            "«Я хочу, чтобы он нам доверился. Говорю спокойно и предлагаю выгоду».",
        ),
        (
            "В исследовании",
            "«Я ищу рычаг, следы или скрытую деталь, а не просто осматриваю комнату».",
        ),
        (
            "Если не уверен",
            "«Вот что я хочу сделать. Какая проверка подходит?»",
        ),
    ]

    phrase_rows = [
        [
            p(f"<b>{title}</b>", styles["body_small"]),
            p(text, styles["body_small"]),
        ]
        for title, text in phrase_items
    ]

    phrases_table = Table(
        phrase_rows,
        colWidths=[36 * mm, CARD_INNER_WIDTH - 36 * mm],
    )

    phrases_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, MID_GRAY),
                ("BACKGROUND", (0, 0), (0, -1), VERY_LIGHT_GRAY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.35 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.15 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.15 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Полезные фразы",
            [phrases_table],
            styles,
        )
    )

    notes_rows = [
        [p("ВРАГИ / ЦЕЛИ / ИМЕНА / ДОБЫЧА / ПЛАН", styles["table_header"])]
    ]

    for _ in range(10):
        notes_rows.append([""])

    notes_table = Table(
        notes_rows,
        colWidths=[CARD_INNER_WIDTH],
        rowHeights=[5.8 * mm] + [4.8 * mm] * 10,
    )

    notes_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.45, DARK_GRAY),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, MID_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), VERY_LIGHT_GRAY),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.2 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.2 * mm),
            ]
        )
    )

    story.extend(
        full_width_card(
            "Заметки кампании",
            [notes_table],
            styles,
        )
    )

    return story


def build_pdf(output_path: Path) -> None:
    """Собрать PDF и проверить, что файл создан."""

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
        id="karaks",
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
        title="Каракс Драэнвер — памятка персонажа",
        author="Karaks Character Sheet Generator",
    )

    story: list = []

    story.extend(build_page_one(styles))
    story.append(PageBreak())

    story.extend(build_page_two(styles))
    story.append(PageBreak())

    story.extend(build_page_three(styles))
    story.append(PageBreak())

    story.extend(build_page_four(styles))
    story.append(PageBreak())

    story.extend(build_page_five(styles))

    document.build(story)

    if not output_path.exists():
        raise RuntimeError("PDF не был создан.")

    if output_path.stat().st_size == 0:
        raise RuntimeError("PDF создан, но пустой.")


def main() -> None:
    """Точка входа."""

    output_path = Path.cwd() / OUTPUT_FILENAME
    build_pdf(output_path)
    print(f"Готово: {output_path}")


if __name__ == "__main__":
    main()
