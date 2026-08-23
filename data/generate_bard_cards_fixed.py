from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = A4
MARGIN = 7 * mm
GAP_X = 3 * mm
GAP_Y = 3 * mm
COLS = 2
ROWS = 3
CARD_W = (PAGE_W - 2 * MARGIN - GAP_X) / COLS
CARD_H = (PAGE_H - 2 * MARGIN - 2 * GAP_Y) / ROWS
PADDING = 4.2 * mm

GRAY = HexColor("#303030")
LIGHT_GRAY = HexColor("#E8E8E8")
MID_GRAY = HexColor("#A9A9A9")


@dataclass
class Spell:
    level_group: str
    title_ru: str
    title_en: str
    source: str
    kind: str
    fields: dict[str, str]
    body: str


@dataclass
class Card:
    spell: Spell
    continuation: int
    total: int
    flowables: list[object]


def find_font() -> tuple[str, str]:
    candidates = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
        ("C:/Windows/Fonts/calibri.ttf", "C:/Windows/Fonts/calibrib.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
        ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ]
    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            return regular, bold
    raise RuntimeError(
        "Не найден TTF-шрифт с кириллицей. Установите DejaVu Sans или укажите путь к шрифтам в find_font()."
    )


def register_fonts() -> None:
    regular, bold = find_font()
    pdfmetrics.registerFont(TTFont("Cards", regular))
    pdfmetrics.registerFont(TTFont("Cards-Bold", bold))


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("Сл ваших заклинаний", "СЛ ваших заклинаний")
    text = re.sub(r"\bСл\b", "СЛ", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def parse_title(value: str) -> tuple[str, str, str]:
    match = re.match(r"(?P<ru>.*?)\s*\[(?P<en>[^]]+)\]\s*(?P<source>.*)$", value.strip())
    if not match:
        return value.strip(), "", ""
    return match.group("ru").strip(), match.group("en").strip(), match.group("source").strip()


def parse_spells(markdown: str) -> list[Spell]:
    markdown = normalize(markdown)
    sections = re.split(r"(?=^##\s+(?!#))", markdown, flags=re.MULTILINE)
    spells: list[Spell] = []
    field_pattern = re.compile(
        r"^\*\*(Время накладывания|Дистанция|Компоненты|Длительность|Классы|Подклассы):\*\*\s*(.*)$",
        re.MULTILINE,
    )

    for section in sections:
        level_match = re.match(r"^##\s+(.+?)\s*$", section, flags=re.MULTILINE)
        if not level_match:
            continue
        level_group = level_match.group(1).strip()
        chunks = re.split(r"(?=^###\s+)", section, flags=re.MULTILINE)
        for chunk in chunks:
            title_match = re.match(r"^###\s+(.+?)\s*$", chunk, flags=re.MULTILINE)
            if not title_match:
                continue
            title_ru, title_en, source = parse_title(title_match.group(1))
            raw = chunk[title_match.end():].strip()
            lines = raw.splitlines()
            kind = ""
            if lines and lines[0].strip() and not lines[0].startswith("**"):
                kind = lines.pop(0).strip()
            raw = "\n".join(lines).strip()

            fields = {match.group(1): match.group(2).strip() for match in field_pattern.finditer(raw)}
            body = field_pattern.sub("", raw)
            body = re.sub(r"^---\s*$", "", body, flags=re.MULTILINE)
            body = re.sub(r"\n{3,}", "\n\n", body).strip()

            if title_ru:
                spells.append(
                    Spell(level_group, title_ru, title_en, source, kind, fields, body)
                )
    return spells


def escape_markup(value: str) -> str:
    value = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    value = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", value)
    return value


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    return {
        "body": ParagraphStyle(
            "card-body", parent=base, fontName="Cards", fontSize=7.0, leading=8.25,
            textColor=black, spaceAfter=1.5 * mm, alignment=TA_LEFT, splitLongWords=True,
        ),
        "small": ParagraphStyle(
            "card-small", parent=base, fontName="Cards", fontSize=6.15, leading=7.05,
            textColor=black, spaceAfter=1.0 * mm, alignment=TA_LEFT, splitLongWords=True,
        ),
        "subheading": ParagraphStyle(
            "card-subheading", parent=base, fontName="Cards-Bold", fontSize=7.2,
            leading=8.2, textColor=black, spaceBefore=1.1 * mm, spaceAfter=0.8 * mm,
        ),
        "meta": ParagraphStyle(
            "card-meta", parent=base, fontName="Cards", fontSize=6.3, leading=7.25,
            textColor=black, alignment=TA_LEFT,
        ),
        "title": ParagraphStyle(
            "card-title", parent=base, fontName="Cards-Bold", fontSize=10.0,
            leading=11.0, textColor=white, alignment=TA_CENTER,
        ),
        "english": ParagraphStyle(
            "card-english", parent=base, fontName="Cards", fontSize=6.45,
            leading=7.0, textColor=white, alignment=TA_CENTER,
        ),
    }


def split_blocks(body: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    table: list[str] = []

    def flush_current() -> None:
        nonlocal current
        if current:
            blocks.append("\n".join(current).strip())
            current = []

    def flush_table() -> None:
        nonlocal table
        if table:
            blocks.append("\n".join(table).strip())
            table = []

    for line in body.splitlines():
        if line.startswith("|"):
            flush_current()
            table.append(line)
            continue
        if table:
            flush_table()
        if line.strip():
            current.append(line)
        else:
            flush_current()
    flush_current()
    flush_table()
    return blocks


def parse_table(block: str, styles: dict[str, ParagraphStyle]) -> Table | None:
    lines = [line.strip() for line in block.splitlines() if line.strip()]
    if len(lines) < 2 or not all(line.startswith("|") for line in lines):
        return None
    raw_rows: list[list[str]] = []
    for index, line in enumerate(lines):
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if index == 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        raw_rows.append(cells)
    if not raw_rows:
        return None

    column_count = max(len(row) for row in raw_rows)
    for row in raw_rows:
        row.extend([""] * (column_count - len(row)))
    width = (CARD_W - 2 * PADDING) / column_count
    data = [[Paragraph(escape_markup(cell), styles["small"]) for cell in row] for row in raw_rows]
    result = Table(data, colWidths=[width] * column_count, repeatRows=1)
    result.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Cards-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_GRAY),
        ("GRID", (0, 0), (-1, -1), 0.25, MID_GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.0 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.0 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 0.55 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0.55 * mm),
    ]))
    return result


def flowables_for_body(body: str, styles: dict[str, ParagraphStyle]) -> list[object]:
    result: list[object] = []
    for block in split_blocks(body):
        table = parse_table(block, styles)
        if table is not None:
            result.append(table)
            continue
        if block.startswith("#### "):
            result.append(Paragraph(escape_markup(block[5:]), styles["subheading"]))
            continue
        if block.startswith("- "):
            items = [line[2:].strip() for line in block.splitlines() if line.startswith("- ")]
            result.append(Paragraph("<br/>".join(f"• {escape_markup(item)}" for item in items), styles["body"]))
            continue
        lines = block.splitlines()
        if all(line.startswith("**") and ".**" in line for line in lines):
            result.append(Paragraph("<br/>".join(escape_markup(line) for line in lines), styles["body"]))
            continue
        result.append(Paragraph(escape_markup(" ".join(line.strip() for line in lines)), styles["body"]))
    return result


def metadata_flowables(spell: Spell, styles: dict[str, ParagraphStyle]) -> list[Paragraph]:
    labels = {
        "Время накладывания": "Время",
        "Дистанция": "Дистанция",
        "Компоненты": "Компоненты",
        "Длительность": "Длительность",
    }
    result: list[Paragraph] = []
    if spell.kind:
        result.append(Paragraph(escape_markup(spell.kind), styles["meta"]))
    for key, short_label in labels.items():
        if spell.fields.get(key):
            result.append(
                Paragraph(
                    f"<b>{short_label}:</b> {escape_markup(spell.fields[key])}",
                    styles["meta"],
                )
            )
    return result


def header_height(spell: Spell, styles: dict[str, ParagraphStyle]) -> float:
    width = CARD_W - 2 * PADDING
    title = Paragraph(escape_markup(spell.title_ru), styles["title"])
    english = Paragraph(escape_markup(f"[{spell.title_en}]" if spell.title_en else ""), styles["english"])
    _, title_h = title.wrap(width, 100 * mm)
    _, english_h = english.wrap(width, 100 * mm)
    return max(18 * mm, title_h + english_h + 8 * mm)


def consume_flowables(
    remaining: list[object], width: float, available_height: float
) -> tuple[list[object], list[object]]:
    """Take complete flowables that fit. Paragraphs are split safely when possible."""
    used: list[object] = []
    rest = list(remaining)
    used_height = 0.0

    while rest:
        flowable = rest[0]
        room = available_height - used_height
        if room <= 2:
            break
        _, needed = flowable.wrap(width, room)
        if needed <= room:
            used.append(rest.pop(0))
            used_height += needed
            continue

        if isinstance(flowable, Paragraph):
            pieces = flowable.split(width, room)
            if len(pieces) >= 2:
                used.append(pieces[0])
                rest = [pieces[1], *rest[1:]]
                break
            if len(pieces) == 1 and not used:
                used.append(pieces[0])
                rest.pop(0)
                break
        break

    if not used and rest:
        # Do not enter an infinite loop. A very tall table is placed on its own card.
        used.append(rest.pop(0))
    return used, rest


def layout_cards(spells: list[Spell], styles: dict[str, ParagraphStyle]) -> list[Card]:
    cards: list[Card] = []
    content_width = CARD_W - 2 * PADDING

    for spell in spells:
        remaining = flowables_for_body(spell.body, styles)
        chunks: list[list[object]] = []
        part = 1
        while remaining:
            header_h = header_height(spell, styles)
            meta_h = 0.0
            if part == 1:
                for flowable in metadata_flowables(spell, styles):
                    _, height = flowable.wrap(content_width, 100 * mm)
                    meta_h += height
            continuation_h = 5 * mm if part > 1 else 0
            usable_h = CARD_H - 2 * PADDING - header_h - meta_h - continuation_h - 7 * mm
            used, remaining = consume_flowables(remaining, content_width, usable_h)
            chunks.append(used)
            part += 1

        if not chunks:
            chunks = [[]]
        total = len(chunks)
        for index, chunk in enumerate(chunks, start=1):
            cards.append(Card(spell, index, total, chunk))
    return cards


def draw_flowables(
    c: canvas.Canvas, flowables: Iterable[object], x: float, y_top: float, width: float
) -> float:
    y = y_top
    for flowable in flowables:
        _, height = flowable.wrap(width, max(1, y))
        flowable.drawOn(c, x, y - height)
        y -= height
    return y


def draw_card(
    c: canvas.Canvas,
    card: Card,
    x: float,
    y: float,
    card_number: int,
    styles: dict[str, ParagraphStyle],
) -> None:
    c.setStrokeColor(GRAY)
    c.setLineWidth(0.55)
    c.rect(x, y, CARD_W, CARD_H, stroke=1, fill=0)

    head_h = header_height(card.spell, styles)
    c.setFillColor(GRAY)
    c.rect(x, y + CARD_H - head_h, CARD_W, head_h, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Cards-Bold", 6.1)
    c.drawString(x + PADDING, y + CARD_H - 4.2 * mm, card.spell.level_group.upper())
    c.setFont("Cards", 6.1)
    c.drawRightString(x + CARD_W - PADDING, y + CARD_H - 4.2 * mm, card.spell.source)

    content_w = CARD_W - 2 * PADDING
    title = Paragraph(escape_markup(card.spell.title_ru), styles["title"])
    english = Paragraph(escape_markup(f"[{card.spell.title_en}]" if card.spell.title_en else ""), styles["english"])
    _, title_h = title.wrap(content_w, head_h)
    _, english_h = english.wrap(content_w, head_h)
    title_y = y + CARD_H - 6.6 * mm - title_h
    title.drawOn(c, x + PADDING, title_y)
    english.drawOn(c, x + PADDING, title_y - english_h - 0.6 * mm)

    current_y = y + CARD_H - head_h - PADDING
    if card.continuation == 1:
        current_y = draw_flowables(c, metadata_flowables(card.spell, styles), x + PADDING, current_y, content_w)
        current_y -= 1.1 * mm
    else:
        c.setFillColor(GRAY)
        c.setFont("Cards", 6.1)
        c.drawString(x + PADDING, current_y - 2.4 * mm, f"Продолжение {card.continuation}/{card.total}")
        current_y -= 5 * mm

    draw_flowables(c, card.flowables, x + PADDING, current_y, content_w)

    c.setFillColor(GRAY)
    c.setFont("Cards", 5.7)
    footer = f"Карта {card_number}"
    if card.total > 1:
        footer += f" · {card.continuation}/{card.total}"
    c.drawRightString(x + CARD_W - PADDING, y + 2.0 * mm, footer)


def draw_cut_marks(c: canvas.Canvas) -> None:
    c.setStrokeColor(MID_GRAY)
    c.setLineWidth(0.25)
    for col in range(1, COLS):
        x = MARGIN + col * CARD_W + (col - 0.5) * GAP_X
        c.line(x, MARGIN - 2 * mm, x, PAGE_H - MARGIN + 2 * mm)
    for row in range(1, ROWS):
        y = PAGE_H - MARGIN - row * CARD_H - (row - 0.5) * GAP_Y
        c.line(MARGIN - 2 * mm, y, PAGE_W - MARGIN + 2 * mm, y)


def generate_pdf(input_path: Path, output_path: Path) -> tuple[int, int]:
    if not input_path.exists():
        raise FileNotFoundError(f"Не найден входной файл: {input_path}")
    register_fonts()
    styles = make_styles()
    spells = parse_spells(input_path.read_text(encoding="utf-8"))
    if not spells:
        raise RuntimeError("Не найдено ни одного заголовка формата: ### Название [English] SOURCE")
    cards = layout_cards(spells, styles)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output_path), pagesize=A4)
    pdf.setTitle("Карточки заклинаний барда")

    positions: list[tuple[float, float]] = []
    for row in range(ROWS):
        for col in range(COLS):
            x = MARGIN + col * (CARD_W + GAP_X)
            y = PAGE_H - MARGIN - (row + 1) * CARD_H - row * GAP_Y
            positions.append((x, y))

    per_page = COLS * ROWS
    for start in range(0, len(cards), per_page):
        for offset, card in enumerate(cards[start:start + per_page]):
            x, y = positions[offset]
            draw_card(pdf, card, x, y, start + offset + 1, styles)
        draw_cut_marks(pdf)
        pdf.showPage()
    pdf.save()
    return len(spells), len(cards)


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF-карточки заклинаний барда: 6 карточек на A4.")
    parser.add_argument("input", nargs="?", default="bard_spells.md", help="Путь к исходному Markdown")
    parser.add_argument("-o", "--output", default="bard_spell_cards_A4.pdf", help="Путь к PDF")
    args = parser.parse_args()

    spells, cards = generate_pdf(Path(args.input), Path(args.output))
    print(f"Готово: {args.output}; заклинаний: {spells}; карточек: {cards}.")


if __name__ == "__main__":
    main()