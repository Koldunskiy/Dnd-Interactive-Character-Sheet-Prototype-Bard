from __future__ import annotations

import json
import re
from dataclasses import dataclass
from math import cos, pi, sin
from pathlib import Path
from typing import Any

from reportlab.lib.colors import Color, HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


INPUT_FILE = Path("bard_spells_parsed.json")

CARDS_OUTPUT_FILE = Path("bard_spell_library_cards.pdf")
REFERENCE_OUTPUT_FILE = Path("bard_spell_library_reference.pdf")

PAGE_W, PAGE_H = A4

CARD_W = 63 * mm
CARD_H = 88 * mm

CARD_COLS = 3
CARD_ROWS = 3

CARD_GAP_X = 3 * mm
CARD_GAP_Y = 3 * mm

GRID_W = CARD_COLS * CARD_W + (CARD_COLS - 1) * CARD_GAP_X
GRID_H = CARD_ROWS * CARD_H + (CARD_ROWS - 1) * CARD_GAP_Y

GRID_X = (PAGE_W - GRID_W) / 2
GRID_Y_TOP = (PAGE_H + GRID_H) / 2

REFERENCE_MARGIN = 14 * mm
REFERENCE_CONTENT_W = PAGE_W - 2 * REFERENCE_MARGIN

INK = HexColor("#282522")
GRAY = HexColor("#77716A")
MID = HexColor("#AAA39A")
PALE = HexColor("#F4F1EA")
PAPER = HexColor("#FFFDF8")

SCHOOL_STYLES: dict[str, dict[str, Any]] = {
    "Очарование": {
        "accent": HexColor("#7A3030"),
        "mark": "heart",
    },
    "Иллюзия": {
        "accent": HexColor("#4E4B69"),
        "mark": "spade",
    },
    "Ограждение": {
        "accent": HexColor("#365D7D"),
        "mark": "diamond",
    },
    "Вызов": {
        "accent": HexColor("#3D6549"),
        "mark": "club",
    },
    "Воплощение": {
        "accent": HexColor("#806032"),
        "mark": "star",
    },
    "Прорицание": {
        "accent": HexColor("#5B4B78"),
        "mark": "eye",
    },
    "Преобразование": {
        "accent": HexColor("#50644B"),
        "mark": "gear",
    },
}

DEFAULT_SCHOOL_STYLE = {
    "accent": GRAY,
    "mark": "circle",
}

SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")
WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class Spell:
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
    classes: tuple[str, ...]
    subclasses: tuple[str, ...]
    full_description: str
    upcast_text: str | None
    needs_summary: bool


def find_font() -> tuple[str, str]:
    candidates = [
        (
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ),
        (
            "C:/Windows/Fonts/calibri.ttf",
            "C:/Windows/Fonts/calibrib.ttf",
        ),
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ),
        (
            "/Library/Fonts/Arial.ttf",
            "/Library/Fonts/Arial Bold.ttf",
        ),
    ]

    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            return regular, bold

    raise RuntimeError(
        "Не найден TTF-шрифт с кириллицей. "
        "Укажите путь к шрифту в find_font()."
    )


def register_fonts() -> None:
    regular, bold = find_font()

    pdfmetrics.registerFont(TTFont("Card", regular))
    pdfmetrics.registerFont(TTFont("Card-Bold", bold))


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]

    return {
        "card_rules": ParagraphStyle(
            "card_rules",
            parent=base,
            fontName="Card",
            fontSize=6.05,
            leading=7.05,
            textColor=INK,
        ),
        "card_small": ParagraphStyle(
            "card_small",
            parent=base,
            fontName="Card",
            fontSize=5.1,
            leading=6.0,
            textColor=INK,
        ),
        "reference_title": ParagraphStyle(
            "reference_title",
            parent=base,
            fontName="Card-Bold",
            fontSize=15.0,
            leading=18.0,
            textColor=INK,
        ),
        "reference_meta": ParagraphStyle(
            "reference_meta",
            parent=base,
            fontName="Card",
            fontSize=7.2,
            leading=8.6,
            textColor=GRAY,
        ),
        "reference_body": ParagraphStyle(
            "reference_body",
            parent=base,
            fontName="Card",
            fontSize=8.3,
            leading=10.2,
            textColor=INK,
        ),
        "reference_upcast": ParagraphStyle(
            "reference_upcast",
            parent=base,
            fontName="Card",
            fontSize=8.1,
            leading=9.9,
            textColor=INK,
            leftIndent=2.5 * mm,
            rightIndent=2.5 * mm,
        ),
        "reference_toc": ParagraphStyle(
            "reference_toc",
            parent=base,
            fontName="Card",
            fontSize=8.0,
            leading=10.0,
            textColor=INK,
        ),
        "reference_toc_level": ParagraphStyle(
            "reference_toc_level",
            parent=base,
            fontName="Card-Bold",
            fontSize=10.0,
            leading=13.0,
            textColor=INK,
        ),
    }


def read_spells() -> list[Spell]:
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Не найден входной JSON: {INPUT_FILE.resolve()}"
        )

    payload = json.loads(INPUT_FILE.read_text(encoding="utf-8"))

    if payload.get("schema_version") != 1:
        raise ValueError(
            "Неподдерживаемая версия JSON: "
            f"{payload.get('schema_version')!r}"
        )

    spells: list[Spell] = []

    for item in payload.get("spells", []):
        spells.append(
            Spell(
                slug=item["slug"],
                name_ru=item["name_ru"],
                name_en=item.get("name_en"),
                source=item.get("source"),
                level=int(item["level"]),
                school=item["school"],
                ritual=bool(item["ritual"]),
                casting_time=item["casting_time"],
                range_value=item["range_value"],
                components=item["components"],
                duration=item["duration"],
                concentration=bool(item["concentration"]),
                classes=tuple(item.get("classes", [])),
                subclasses=tuple(item.get("subclasses", [])),
                full_description=item["full_description"],
                upcast_text=item.get("upcast_text"),
                needs_summary=bool(item.get("needs_summary", False)),
            )
        )

    if not spells:
        raise ValueError("В JSON отсутствуют заклинания.")

    return sorted(
        spells,
        key=lambda spell: (
            spell.level,
            spell.name_ru.casefold(),
        ),
    )


def clean_inline(value: str) -> str:
    return WHITESPACE_RE.sub(" ", value).strip()


def truncate_sentence_safe(
    text: str,
    max_chars: int,
) -> str:
    text = clean_inline(text)

    if len(text) <= max_chars:
        return text

    sentences = SENTENCE_END_RE.split(text)
    selected: list[str] = []
    current_length = 0

    for sentence in sentences:
        sentence_length = len(sentence)

        if selected and current_length + 1 + sentence_length > max_chars:
            break

        if not selected and sentence_length > max_chars:
            return sentence[: max_chars - 1].rstrip() + "…"

        selected.append(sentence)
        current_length += sentence_length + 1

    if not selected:
        return text[: max_chars - 1].rstrip() + "…"

    result = " ".join(selected)

    if len(result) < len(text):
        return result.rstrip(".") + "…"

    return result


def build_card_summary(spell: Spell) -> str:
    paragraphs = [
        clean_inline(paragraph)
        for paragraph in spell.full_description.split("\n\n")
        if clean_inline(paragraph)
    ]

    if not paragraphs:
        return "Описание отсутствует."

    first = truncate_sentence_safe(
        paragraphs[0],
        max_chars=310,
    )

    if len(first) < 155 and len(paragraphs) > 1:
        combined = f"{first} {paragraphs[1]}"
        return truncate_sentence_safe(combined, max_chars=345)

    return first


def build_upcast_summary(spell: Spell) -> str | None:
    if not spell.upcast_text:
        return None

    return truncate_sentence_safe(
        spell.upcast_text,
        max_chars=145,
    )


def level_label(level: int) -> str:
    if level == 0:
        return "ЗАГОВОР"

    return f"{level} УРОВЕНЬ"


def source_label(source: str | None) -> str:
    return source or "ИСТОЧНИК НЕ УКАЗАН"


def card_position(index: int) -> tuple[float, float]:
    row = index // CARD_COLS
    col = index % CARD_COLS

    x = GRID_X + col * (CARD_W + CARD_GAP_X)
    y_top = GRID_Y_TOP - row * (CARD_H + CARD_GAP_Y)

    return x, y_top


def draw_paragraph(
    pdf: canvas.Canvas,
    text: str,
    style: ParagraphStyle,
    x: float,
    y_top: float,
    width: float,
) -> float:
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(width, 1000)
    paragraph.drawOn(pdf, x, y_top - height)

    return y_top - height


def draw_cut_marks(
    pdf: canvas.Canvas,
    x: float,
    y_top: float,
) -> None:
    length = 1.5 * mm
    y_bottom = y_top - CARD_H

    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.22)

    for point_x, point_y in (
        (x, y_top),
        (x + CARD_W, y_top),
        (x, y_bottom),
        (x + CARD_W, y_bottom),
    ):
        pdf.line(
            point_x - length,
            point_y,
            point_x + length,
            point_y,
        )
        pdf.line(
            point_x,
            point_y - length,
            point_x,
            point_y + length,
        )


def draw_school_mark(
    pdf: canvas.Canvas,
    kind: str,
    center_x: float,
    center_y: float,
    size: float,
    color: Color,
) -> None:
    """Draw a school symbol without relying on Unicode glyph support."""

    pdf.saveState()

    pdf.setStrokeColor(color)
    pdf.setFillColor(color)
    pdf.setLineWidth(0.45)

    if kind == "heart":
        radius = size * 0.25

        pdf.circle(
            center_x - radius,
            center_y + radius * 0.45,
            radius,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            center_x + radius,
            center_y + radius * 0.45,
            radius,
            stroke=1,
            fill=1,
        )

        path = pdf.beginPath()
        path.moveTo(
            center_x - size * 0.50,
            center_y + radius * 0.32,
        )
        path.lineTo(
            center_x + size * 0.50,
            center_y + radius * 0.32,
        )
        path.lineTo(
            center_x,
            center_y - size * 0.58,
        )
        path.close()

        pdf.drawPath(path, stroke=1, fill=1)

    elif kind == "diamond":
        path = pdf.beginPath()
        path.moveTo(center_x, center_y + size * 0.58)
        path.lineTo(center_x + size * 0.42, center_y)
        path.lineTo(center_x, center_y - size * 0.58)
        path.lineTo(center_x - size * 0.42, center_y)
        path.close()

        pdf.drawPath(path, stroke=1, fill=1)

    elif kind == "spade":
        pdf.circle(
            center_x - size * 0.22,
            center_y + size * 0.05,
            size * 0.25,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            center_x + size * 0.22,
            center_y + size * 0.05,
            size * 0.25,
            stroke=1,
            fill=1,
        )

        path = pdf.beginPath()
        path.moveTo(
            center_x - size * 0.47,
            center_y + size * 0.04,
        )
        path.lineTo(
            center_x + size * 0.47,
            center_y + size * 0.04,
        )
        path.lineTo(
            center_x,
            center_y + size * 0.48,
        )
        path.close()

        pdf.drawPath(path, stroke=1, fill=1)

        pdf.setFillColor(PAPER)

        path = pdf.beginPath()
        path.moveTo(
            center_x - size * 0.42,
            center_y + size * 0.02,
        )
        path.lineTo(
            center_x + size * 0.42,
            center_y + size * 0.02,
        )
        path.lineTo(
            center_x,
            center_y - size * 0.26,
        )
        path.close()

        pdf.drawPath(path, stroke=0, fill=1)

        pdf.setFillColor(color)

        stem = pdf.beginPath()
        stem.moveTo(
            center_x - size * 0.09,
            center_y - size * 0.34,
        )
        stem.lineTo(
            center_x + size * 0.09,
            center_y - size * 0.34,
        )
        stem.lineTo(
            center_x + size * 0.17,
            center_y - size * 0.56,
        )
        stem.lineTo(
            center_x - size * 0.17,
            center_y - size * 0.56,
        )
        stem.close()

        pdf.drawPath(stem, stroke=1, fill=1)

    elif kind == "club":
        radius = size * 0.22

        pdf.circle(
            center_x,
            center_y + size * 0.25,
            radius,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            center_x - size * 0.22,
            center_y - size * 0.04,
            radius,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            center_x + size * 0.22,
            center_y - size * 0.04,
            radius,
            stroke=1,
            fill=1,
        )

        stem = pdf.beginPath()
        stem.moveTo(
            center_x - size * 0.10,
            center_y - size * 0.22,
        )
        stem.lineTo(
            center_x + size * 0.10,
            center_y - size * 0.22,
        )
        stem.lineTo(
            center_x + size * 0.16,
            center_y - size * 0.55,
        )
        stem.lineTo(
            center_x - size * 0.16,
            center_y - size * 0.55,
        )
        stem.close()

        pdf.drawPath(stem, stroke=1, fill=1)

    elif kind == "star":
        path = pdf.beginPath()

        for index in range(16):
            angle = -pi / 2 + pi * index / 8
            radius = (
                size * 0.54
                if index % 2 == 0
                else size * 0.23
            )

            point_x = center_x + cos(angle) * radius
            point_y = center_y + sin(angle) * radius

            if index == 0:
                path.moveTo(point_x, point_y)
            else:
                path.lineTo(point_x, point_y)

        path.close()
        pdf.drawPath(path, stroke=1, fill=1)

    elif kind == "eye":
        pdf.ellipse(
            center_x - size * 0.58,
            center_y - size * 0.30,
            center_x + size * 0.58,
            center_y + size * 0.30,
            stroke=1,
            fill=0,
        )
        pdf.circle(
            center_x,
            center_y,
            size * 0.16,
            stroke=1,
            fill=1,
        )

    elif kind == "gear":
        pdf.circle(
            center_x,
            center_y,
            size * 0.30,
            stroke=1,
            fill=0,
        )
        pdf.circle(
            center_x,
            center_y,
            size * 0.10,
            stroke=1,
            fill=1,
        )

        for index in range(8):
            angle = index * pi / 4

            x1 = center_x + cos(angle) * size * 0.30
            y1 = center_y + sin(angle) * size * 0.30

            x2 = center_x + cos(angle) * size * 0.52
            y2 = center_y + sin(angle) * size * 0.52

            pdf.line(x1, y1, x2, y2)

    else:
        pdf.circle(
            center_x,
            center_y,
            size * 0.34,
            stroke=1,
            fill=0,
        )

    pdf.restoreState()


def draw_index(
    pdf: canvas.Canvas,
    x: float,
    y_top: float,
    level: int,
    school_style: dict[str, Any],
) -> None:
    label = "A" if level == 0 else str(level)

    top_x = x + 5.0 * mm
    top_y = y_top - 5.1 * mm

    accent = school_style["accent"]
    mark = school_style["mark"]

    pdf.setFillColor(accent)
    pdf.setFont("Card-Bold", 8.3)
    pdf.drawCentredString(top_x, top_y - 3, label)

    draw_school_mark(
        pdf,
        mark,
        top_x,
        top_y - 3.0 * mm,
        2.75 * mm,
        accent,
    )

    y_bottom = y_top - CARD_H
    bottom_x = x + CARD_W - 5.0 * mm
    bottom_y = y_bottom + 5.4 * mm

    pdf.saveState()
    pdf.translate(bottom_x, bottom_y)
    pdf.rotate(180)

    pdf.setFillColor(accent)
    pdf.setFont("Card-Bold", 8.3)
    pdf.drawCentredString(0, 0- 3, label)

    draw_school_mark(
        pdf,
        mark,
        0,
        -3.0 * mm,
        2.75 * mm,
        accent,
    )

    pdf.restoreState()


def draw_frame(
    pdf: canvas.Canvas,
    x: float,
    y_top: float,
    accent: Color,
) -> None:
    y_bottom = y_top - CARD_H

    outer = 1.6 * mm
    inner = 3.1 * mm

    pdf.setFillColor(PAPER)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(0.65)

    pdf.roundRect(
        x,
        y_bottom,
        CARD_W,
        CARD_H,
        2.1 * mm,
        stroke=1,
        fill=1,
    )

    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.35)

    pdf.roundRect(
        x + outer,
        y_bottom + outer,
        CARD_W - 2 * outer,
        CARD_H - 2 * outer,
        1.6 * mm,
        stroke=1,
        fill=0,
    )

    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.22)

    pdf.roundRect(
        x + inner,
        y_bottom + inner,
        CARD_W - 2 * inner,
        CARD_H - 2 * inner,
        1.1 * mm,
        stroke=1,
        fill=0,
    )


def draw_separator(
    pdf: canvas.Canvas,
    x1: float,
    y: float,
    x2: float,
    color: Color,
) -> None:
    pdf.setStrokeColor(color)
    pdf.setLineWidth(0.35)
    pdf.line(x1, y, x2, y)
    pdf.circle((x1 + x2) / 2, y, 0.55 * mm, stroke=1, fill=0)


def fit_font_size(
    pdf: canvas.Canvas,
    text: str,
    font_name: str,
    initial_size: float,
    available_width: float,
    min_size: float,
) -> float:
    size = initial_size

    while (
        pdf.stringWidth(text, font_name, size) > available_width
        and size > min_size
    ):
        size -= 0.2

    return size


def draw_card(
    pdf: canvas.Canvas,
    spell: Spell,
    x: float,
    y_top: float,
    styles: dict[str, ParagraphStyle],
) -> None:
    style = SCHOOL_STYLES.get(
        spell.school,
        DEFAULT_SCHOOL_STYLE,
    )

    accent = style["accent"]
    y_bottom = y_top - CARD_H

    pad = 5.2 * mm
    content_x = x + pad
    content_w = CARD_W - 2 * pad

    draw_cut_marks(pdf, x, y_top)
    draw_frame(pdf, x, y_top, accent)
    draw_index(pdf, x, y_top, spell.level, style)

    title_y = y_top - 8.0 * mm
    title_safe_width = content_w - 20 * mm

    title = spell.name_ru.upper()

    title_size = fit_font_size(
        pdf,
        title,
        "Card-Bold",
        initial_size=8.2,
        available_width=title_safe_width,
        min_size=5.7,
    )

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", title_size)
    pdf.drawCentredString(
        x + CARD_W / 2,
        title_y,
        title,
    )

    subtitle = (
        f"{spell.school.upper()} · "
        f"{level_label(spell.level)} · "
        f"{source_label(spell.source)}"
    )

    subtitle_size = fit_font_size(
        pdf,
        subtitle,
        "Card",
        initial_size=4.8,
        available_width=content_w,
        min_size=3.7,
    )

    pdf.setFillColor(accent)
    pdf.setFont("Card", subtitle_size)
    pdf.drawCentredString(
        x + CARD_W / 2,
        title_y - 3.7 * mm,
        subtitle,
    )

    flags: list[str] = []

    if spell.concentration:
        flags.append("□ КОНЦ.")

    if spell.ritual:
        flags.append("РИТУАЛ")

    if flags:
        pdf.setFillColor(GRAY)
        pdf.setFont("Card-Bold", 4.55)
        pdf.drawCentredString(
            x + CARD_W / 2,
            title_y - 6.8 * mm,
            " · ".join(flags),
        )

    draw_separator(
        pdf,
        content_x,
        y_top - 20.5 * mm,
        content_x + content_w,
        accent,
    )

    belt_y = y_top - 25.5 * mm

    pdf.setFillColor(PALE)
    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.3)

    pdf.roundRect(
        content_x,
        belt_y - 9.0 * mm,
        content_w,
        10.8 * mm,
        1.0 * mm,
        stroke=1,
        fill=1,
    )

    first_line = (
        f"{spell.casting_time.upper()} · "
        f"{spell.range_value.upper()}"
    )

    first_line_size = fit_font_size(
        pdf,
        first_line,
        "Card-Bold",
        initial_size=5.0,
        available_width=content_w - 2.0 * mm,
        min_size=3.8,
    )

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", first_line_size)
    pdf.drawCentredString(
        x + CARD_W / 2,
        belt_y - 2.8 * mm,
        first_line,
    )

    components_short = spell.components.split(" (", maxsplit=1)[0]

    second_line = (
        f"{components_short.upper()} · "
        f"{spell.duration.upper()}"
    )

    second_line_size = fit_font_size(
        pdf,
        second_line,
        "Card",
        initial_size=4.9,
        available_width=content_w - 2.0 * mm,
        min_size=3.8,
    )

    pdf.setFont("Card", second_line_size)
    pdf.drawCentredString(
        x + CARD_W / 2,
        belt_y - 6.8 * mm,
        second_line,
    )

    cursor_y = belt_y - 13.2 * mm

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 5.0)
    pdf.drawString(content_x, cursor_y, "ЭФФЕКТ")

    cursor_y -= 2.5 * mm

    summary = build_card_summary(spell)

    cursor_y = draw_paragraph(
        pdf,
        summary,
        styles["card_rules"],
        content_x,
        cursor_y,
        content_w,
    ) - 1.7 * mm

    upcast_summary = build_upcast_summary(spell)

    if upcast_summary:
        pdf.setStrokeColor(accent)
        pdf.setLineWidth(0.25)
        pdf.line(
            content_x,
            cursor_y,
            content_x + content_w,
            cursor_y,
        )

        cursor_y -= 2.8 * mm

        pdf.setFillColor(accent)
        pdf.setFont("Card-Bold", 4.9)
        pdf.drawString(content_x, cursor_y, "ЯЧЕЙКА ВЫШЕ")

        cursor_y -= 2.4 * mm

        cursor_y = draw_paragraph(
            pdf,
            upcast_summary,
            styles["card_small"],
            content_x,
            cursor_y,
            content_w,
        ) - 1.5 * mm

    footer_x = x + 10.0 * mm
    footer_w = CARD_W - 20.0 * mm

    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.25)

    pdf.line(
        footer_x,
        y_bottom + 7.0 * mm,
        footer_x + footer_w,
        y_bottom + 7.0 * mm,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 3.85)

    pdf.drawCentredString(
        x + CARD_W / 2,
        y_bottom + 4.15 * mm,
        f"ID: {spell.slug.upper()} · ПОЛНЫЙ ТЕКСТ В СПРАВОЧНИКЕ",
    )


def draw_cards_page_label(
    pdf: canvas.Canvas,
    page_number: int,
    total_pages: int,
) -> None:
    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 5.3)

    pdf.drawString(
        8 * mm,
        6 * mm,
        "БАРД · БИБЛИОТЕКА ЗАКЛИНАНИЙ · ЛИЦА КАРТ",
    )

    pdf.drawRightString(
        PAGE_W - 8 * mm,
        6 * mm,
        f"{page_number}/{total_pages} · печатать 100%",
    )


def build_cards_pdf(
    spells: list[Spell],
    styles: dict[str, ParagraphStyle],
) -> int:
    cards_per_page = CARD_COLS * CARD_ROWS
    total_pages = (
        len(spells) + cards_per_page - 1
    ) // cards_per_page

    pdf = canvas.Canvas(
        str(CARDS_OUTPUT_FILE),
        pagesize=A4,
    )

    pdf.setTitle("Бард — библиотека заклинаний — карты")

    for page_index in range(total_pages):
        draw_cards_page_label(
            pdf,
            page_number=page_index + 1,
            total_pages=total_pages,
        )

        start = page_index * cards_per_page
        end = start + cards_per_page
        page_spells = spells[start:end]

        for index, spell in enumerate(page_spells):
            x, y_top = card_position(index)
            draw_card(pdf, spell, x, y_top, styles)

        pdf.showPage()

    pdf.save()

    return total_pages


def draw_reference_header(
    pdf: canvas.Canvas,
    title: str,
    page_number: int,
) -> float:
    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 15.5)

    pdf.drawString(
        REFERENCE_MARGIN,
        PAGE_H - REFERENCE_MARGIN,
        title,
    )

    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.55)

    line_y = PAGE_H - REFERENCE_MARGIN - 4.0 * mm

    pdf.line(
        REFERENCE_MARGIN,
        line_y,
        PAGE_W - REFERENCE_MARGIN,
        line_y,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 6.2)

    pdf.drawRightString(
        PAGE_W - REFERENCE_MARGIN,
        PAGE_H - REFERENCE_MARGIN,
        f"стр. {page_number}",
    )

    return line_y - 6.0 * mm


def draw_reference_footer(
    pdf: canvas.Canvas,
    page_number: int,
) -> None:
    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.25)

    pdf.line(
        REFERENCE_MARGIN,
        10 * mm,
        PAGE_W - REFERENCE_MARGIN,
        10 * mm,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 6.0)

    pdf.drawString(
        REFERENCE_MARGIN,
        6.8 * mm,
        "Бард · библиотека заклинаний · полный текст",
    )

    pdf.drawRightString(
        PAGE_W - REFERENCE_MARGIN,
        6.8 * mm,
        f"стр. {page_number}",
    )


def reference_page_break(
    pdf: canvas.Canvas,
    page_number: int,
) -> tuple[int, float]:
    draw_reference_footer(pdf, page_number)
    pdf.showPage()

    next_page = page_number + 1

    return (
        next_page,
        draw_reference_header(
            pdf,
            "БАРД · БИБЛИОТЕКА ЗАКЛИНАНИЙ",
            next_page,
        ),
    )


def ensure_reference_space(
    pdf: canvas.Canvas,
    cursor_y: float,
    required_height: float,
    page_number: int,
) -> tuple[int, float]:
    bottom_limit = 16 * mm

    if cursor_y - required_height >= bottom_limit:
        return page_number, cursor_y

    return reference_page_break(pdf, page_number)


def draw_reference_toc(
    pdf: canvas.Canvas,
    spells: list[Spell],
    styles: dict[str, ParagraphStyle],
    page_number: int,
    cursor_y: float,
) -> tuple[int, float]:
    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 10.5)
    pdf.drawString(
        REFERENCE_MARGIN,
        cursor_y,
        "СОДЕРЖАНИЕ",
    )

    cursor_y -= 6.5 * mm

    for level in range(10):
        level_spells = [
            spell
            for spell in spells
            if spell.level == level
        ]

        if not level_spells:
            continue

        page_number, cursor_y = ensure_reference_space(
            pdf,
            cursor_y,
            required_height=20 * mm,
            page_number=page_number,
        )

        label = (
            "ЗАГОВОРЫ"
            if level == 0
            else f"ЗАКЛИНАНИЯ {level} УРОВНЯ"
        )

        cursor_y = draw_paragraph(
            pdf,
            label,
            styles["reference_toc_level"],
            REFERENCE_MARGIN,
            cursor_y,
            REFERENCE_CONTENT_W,
        ) - 1.0 * mm

        names = " · ".join(
            spell.name_ru
            for spell in level_spells
        )

        cursor_y = draw_paragraph(
            pdf,
            names,
            styles["reference_toc"],
            REFERENCE_MARGIN,
            cursor_y,
            REFERENCE_CONTENT_W,
        ) - 4.0 * mm

    return page_number, cursor_y


def draw_reference_spell(
    pdf: canvas.Canvas,
    spell: Spell,
    styles: dict[str, ParagraphStyle],
    page_number: int,
    cursor_y: float,
) -> tuple[int, float]:
    school_style = SCHOOL_STYLES.get(
        spell.school,
        DEFAULT_SCHOOL_STYLE,
    )

    accent = school_style["accent"]

    estimated_height = 35 * mm

    page_number, cursor_y = ensure_reference_space(
        pdf,
        cursor_y,
        required_height=estimated_height,
        page_number=page_number,
    )

    title = spell.name_ru.upper()

    if spell.name_en:
        title += f" [{spell.name_en}]"

    cursor_y = draw_paragraph(
        pdf,
        title,
        styles["reference_title"],
        REFERENCE_MARGIN,
        cursor_y,
        REFERENCE_CONTENT_W,
    ) - 1.5 * mm

    meta_parts = [
        level_label(spell.level).capitalize(),
        spell.school,
    ]

    if spell.ritual:
        meta_parts.append("ритуал")

    meta_parts.append(source_label(spell.source))

    cursor_y = draw_paragraph(
        pdf,
        " · ".join(meta_parts),
        styles["reference_meta"],
        REFERENCE_MARGIN,
        cursor_y,
        REFERENCE_CONTENT_W,
    ) - 2.2 * mm

    table_items = [
        ("Время", spell.casting_time),
        ("Дистанция", spell.range_value),
        ("Компоненты", spell.components),
        (
            "Длительность",
            (
                "Концентрация · "
                if spell.concentration
                else ""
            )
            + spell.duration,
        ),
    ]

    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.3)

    for label, value in table_items:
        page_number, cursor_y = ensure_reference_space(
            pdf,
            cursor_y,
            required_height=6.0 * mm,
            page_number=page_number,
        )

        pdf.setFillColor(GRAY)
        pdf.setFont("Card-Bold", 6.5)
        pdf.drawString(
            REFERENCE_MARGIN,
            cursor_y,
            label.upper(),
        )

        pdf.setFillColor(INK)
        pdf.setFont("Card", 7.2)
        pdf.drawString(
            REFERENCE_MARGIN + 26 * mm,
            cursor_y,
            value,
        )

        cursor_y -= 5.0 * mm

    if spell.classes:
        page_number, cursor_y = ensure_reference_space(
            pdf,
            cursor_y,
            required_height=7.0 * mm,
            page_number=page_number,
        )

        classes_text = ", ".join(spell.classes)

        cursor_y = draw_paragraph(
            pdf,
            f"<b>Классы:</b> {classes_text}",
            styles["reference_meta"],
            REFERENCE_MARGIN,
            cursor_y,
            REFERENCE_CONTENT_W,
        ) - 2.0 * mm

    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.5)

    pdf.line(
        REFERENCE_MARGIN,
        cursor_y,
        PAGE_W - REFERENCE_MARGIN,
        cursor_y,
    )

    cursor_y -= 3.5 * mm

    body_paragraphs = [
        clean_inline(paragraph)
        for paragraph in spell.full_description.split("\n\n")
        if clean_inline(paragraph)
    ]

    for paragraph_text in body_paragraphs:
        paragraph = Paragraph(
            paragraph_text,
            styles["reference_body"],
        )

        _, paragraph_height = paragraph.wrap(
            REFERENCE_CONTENT_W,
            1000,
        )

        page_number, cursor_y = ensure_reference_space(
            pdf,
            cursor_y,
            required_height=paragraph_height + 4 * mm,
            page_number=page_number,
        )

        paragraph.drawOn(
            pdf,
            REFERENCE_MARGIN,
            cursor_y - paragraph_height,
        )

        cursor_y -= paragraph_height + 3.0 * mm

    if spell.upcast_text:
        upcast = Paragraph(
            f"<b>НА БОЛЬШИХ УРОВНЯХ.</b> "
            f"{clean_inline(spell.upcast_text)}",
            styles["reference_upcast"],
        )

        _, upcast_height = upcast.wrap(
            REFERENCE_CONTENT_W - 5 * mm,
            1000,
        )

        page_number, cursor_y = ensure_reference_space(
            pdf,
            cursor_y,
            required_height=upcast_height + 9 * mm,
            page_number=page_number,
        )

        pdf.setFillColor(PALE)
        pdf.setStrokeColor(accent)
        pdf.setLineWidth(0.3)

        box_y = cursor_y - upcast_height - 4 * mm

        pdf.roundRect(
            REFERENCE_MARGIN,
            box_y,
            REFERENCE_CONTENT_W,
            upcast_height + 6 * mm,
            1.5 * mm,
            stroke=1,
            fill=1,
        )

        upcast.drawOn(
            pdf,
            REFERENCE_MARGIN + 2.5 * mm,
            cursor_y - upcast_height - 1 * mm,
        )

        cursor_y = box_y - 4.0 * mm

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.3)

    pdf.line(
        REFERENCE_MARGIN,
        cursor_y,
        PAGE_W - REFERENCE_MARGIN,
        cursor_y,
    )

    return page_number, cursor_y - 7.0 * mm


def build_reference_pdf(
    spells: list[Spell],
    styles: dict[str, ParagraphStyle],
) -> int:
    pdf = canvas.Canvas(
        str(REFERENCE_OUTPUT_FILE),
        pagesize=A4,
    )

    pdf.setTitle("Бард — библиотека заклинаний — справочник")

    page_number = 1

    cursor_y = draw_reference_header(
        pdf,
        "БАРД · БИБЛИОТЕКА ЗАКЛИНАНИЙ",
        page_number,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 7.0)

    pdf.drawString(
        REFERENCE_MARGIN,
        cursor_y,
        (
            "Полный текст правил из bard_spells.md. "
            "Карточки используют ID для быстрого поиска."
        ),
    )

    cursor_y -= 9 * mm

    page_number, cursor_y = draw_reference_toc(
        pdf,
        spells,
        styles,
        page_number,
        cursor_y,
    )

    for level in range(10):
        level_spells = [
            spell
            for spell in spells
            if spell.level == level
        ]

        if not level_spells:
            continue

        page_number, cursor_y = ensure_reference_space(
            pdf,
            cursor_y,
            required_height=20 * mm,
            page_number=page_number,
        )

        level_title = (
            "ЗАГОВОРЫ"
            if level == 0
            else f"ЗАКЛИНАНИЯ {level} УРОВНЯ"
        )

        pdf.setFillColor(INK)
        pdf.setFont("Card-Bold", 12.5)
        pdf.drawString(
            REFERENCE_MARGIN,
            cursor_y,
            level_title,
        )

        cursor_y -= 6 * mm

        for spell in level_spells:
            page_number, cursor_y = draw_reference_spell(
                pdf,
                spell,
                styles,
                page_number,
                cursor_y,
            )

    draw_reference_footer(pdf, page_number)
    pdf.save()

    return page_number


def main() -> None:
    register_fonts()

    styles = make_styles()
    spells = read_spells()

    card_pages = build_cards_pdf(
        spells,
        styles,
    )

    reference_pages = build_reference_pdf(
        spells,
        styles,
    )

    upcast_count = sum(
        spell.upcast_text is not None
        for spell in spells
    )

    concentration_count = sum(
        spell.concentration
        for spell in spells
    )

    ritual_count = sum(
        spell.ritual
        for spell in spells
    )

    print(f"Заклинаний: {len(spells)}")
    print(f"Карточки: {CARDS_OUTPUT_FILE.resolve()}")
    print(f"Страниц карточек: {card_pages}")
    print(f"Справочник: {REFERENCE_OUTPUT_FILE.resolve()}")
    print(f"Страниц справочника: {reference_pages}")
    print(f"Концентрация: {concentration_count}")
    print(f"Ритуалы: {ritual_count}")
    print(f"Отдельный блок апкаста: {upcast_count}")


if __name__ == "__main__":
    main()