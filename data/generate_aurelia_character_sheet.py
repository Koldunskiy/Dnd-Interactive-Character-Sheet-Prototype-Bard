from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

PAGE_W, PAGE_H = A4

MARGIN = 10 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

GRAY = HexColor("#2E2E2E")
LIGHT = HexColor("#EAEAEA")
MID = HexColor("#A8A8A8")
VERY_LIGHT = HexColor("#F6F6F6")

CHARACTER = {
    "name": "Аурелия",
    "race": "Тифлинг · Гласия · Наследие Малболга",
    "class": "Бард 10 · Коллегия Мечей",
    "background": "Артист",
    "alignment": "Нейтрально-злая",
    "abilities": {
        "СИЛ": 8,
        "ЛОВ": 18,
        "ТЕЛ": 14,
        "ИНТ": 10,
        "МДР": 10,
        "ХАР": 18,
    },
    "saves": {
        "Сила": -1,
        "Ловкость": 8,
        "Телосложение": 2,
        "Интеллект": 0,
        "Мудрость": 0,
        "Харизма": 8,
    },
    "skills": [
        ("Акробатика", "+12", "эксп."),
        ("Ловкость рук", "+12", "перчатки"),
        ("Обман", "+12", "эксп."),
        ("Выступление", "+12", "эксп."),
        ("Убеждение", "+12", "эксп."),
        ("Скрытность", "+4", ""),
        ("Запугивание", "+4", ""),
        ("Восприятие", "+0", ""),
        ("Проницательность", "+0", ""),
    ],
}


def find_font() -> tuple[str, str]:
    candidates = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
        ("C:/Windows/Fonts/calibri.ttf", "C:/Windows/Fonts/calibrib.ttf"),
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ),
        ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ]

    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            return regular, bold

    raise RuntimeError(
        "Не найден шрифт с кириллицей. "
        "Укажите путь к TTF-шрифту в функции find_font()."
    )


def register_fonts() -> None:
    regular, bold = find_font()
    pdfmetrics.registerFont(TTFont("Sheet", regular))
    pdfmetrics.registerFont(TTFont("Sheet-Bold", bold))


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]

    return {
        "body": ParagraphStyle(
            "body",
            parent=base,
            fontName="Sheet",
            fontSize=7.1,
            leading=8.3,
            textColor=black,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base,
            fontName="Sheet",
            fontSize=6.2,
            leading=7.2,
            textColor=black,
        ),
        "title": ParagraphStyle(
            "title",
            parent=base,
            fontName="Sheet-Bold",
            fontSize=21,
            leading=23,
            textColor=white,
            alignment=TA_CENTER,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base,
            fontName="Sheet",
            fontSize=8.3,
            leading=9.4,
            textColor=white,
            alignment=TA_CENTER,
        ),
    }


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


def draw_box(
    pdf: canvas.Canvas,
    x: float,
    y_top: float,
    width: float,
    height: float,
    title: str,
) -> None:
    y = y_top - height

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.5)
    pdf.rect(x, y, width, height, stroke=1, fill=0)

    # Вместо чёрной плашки — заголовок и разделительная линия.
    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 7.1)
    pdf.drawString(x + 2 * mm, y_top - 4.0 * mm, title.upper())

    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.45)
    pdf.line(
        x + 2 * mm,
        y_top - 6.2 * mm,
        x + width - 2 * mm,
        y_top - 6.2 * mm,
    )


def draw_square(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    size: float = 3.3 * mm,
) -> None:
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.45)
    pdf.rect(x, y, size, size, stroke=1, fill=0)


def draw_squares(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    count: int,
    size: float = 3.3 * mm,
    gap: float = 1.3 * mm,
) -> None:
    for index in range(count):
        draw_square(pdf, x + index * (size + gap), y, size)


def draw_line_field(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    label: str,
    value: str = "",
) -> None:
    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.0)
    pdf.drawString(x, y, label.upper())

    value_x = x + 22 * mm
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 8.2)

    if value:
        pdf.drawString(value_x, y, value)

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.3)
    pdf.line(value_x, y - 1.5 * mm, x + width, y - 1.5 * mm)


def draw_stat(
    pdf: canvas.Canvas,
    x: float,
    y_top: float,
    width: float,
    height: float,
    label: str,
    score: int,
) -> None:
    modifier = (score - 10) // 2

    pdf.setFillColor(LIGHT)
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.5)
    pdf.roundRect(
        x,
        y_top - height,
        width,
        height,
        1.5 * mm,
        stroke=1,
        fill=1,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.5)
    pdf.drawCentredString(x + width / 2, y_top - 4.3 * mm, label)

    pdf.setFillColor(black)
    pdf.setFont("Sheet-Bold", 12.5)
    pdf.drawCentredString(x + width / 2, y_top - 10.1 * mm, f"{modifier:+d}")

    pdf.setFont("Sheet", 6.0)
    pdf.drawCentredString(
        x + width / 2,
        y_top - 15.4 * mm,
        f"значение {score}",
    )


def draw_header(pdf: canvas.Canvas, page_label: str) -> float:
    header_h = 28 * mm
    styles = make_styles()

    # Белая шапка, без заливки.
    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 21)
    pdf.drawCentredString(
        PAGE_W / 2,
        PAGE_H - MARGIN - 8.0 * mm,
        CHARACTER["name"],
    )

    pdf.setFont("Sheet", 8.3)
    pdf.drawCentredString(
        PAGE_W / 2,
        PAGE_H - MARGIN - 14.0 * mm,
        "Тифлинг · Бард 10 · Коллегия Мечей · Нейтрально-злая",
    )

    pdf.setFont("Sheet", 5.8)
    pdf.drawRightString(
        PAGE_W - MARGIN,
        PAGE_H - MARGIN - 20.0 * mm,
        page_label,
    )

    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.65)
    pdf.line(
        MARGIN,
        PAGE_H - MARGIN - 23.5 * mm,
        PAGE_W - MARGIN,
        PAGE_H - MARGIN - 23.5 * mm,
    )

    return PAGE_H - MARGIN - header_h - 5 * mm


def draw_page_one(pdf: canvas.Canvas) -> None:
    styles = make_styles()
    y = draw_header(pdf, "БОЙ · ЛИСТ 1/2")

    gap = 4 * mm
    left_w = 94 * mm
    right_w = CONTENT_W - left_w - gap
    left_x = MARGIN
    right_x = left_x + left_w + gap

    # Верхняя панель: хиты и основные боевые показатели.
    top_h = 39 * mm

    draw_box(pdf, left_x, y, left_w, top_h, "Хиты и боевые показатели")

    draw_line_field(
        pdf,
        left_x + 3 * mm,
        y - 10 * mm,
        42 * mm,
        "Текущие",
        "/ 73",
    )
    draw_line_field(
        pdf,
        left_x + 49 * mm,
        y - 10 * mm,
        40 * mm,
        "Временные",
    )

    draw_line_field(
        pdf,
        left_x + 3 * mm,
        y - 21 * mm,
        24 * mm,
        "КД",
        "18",
    )
    draw_line_field(
        pdf,
        left_x + 33 * mm,
        y - 21 * mm,
        24 * mm,
        "Инициатива",
        "+4",
    )
    draw_line_field(
        pdf,
        left_x + 63 * mm,
        y - 21 * mm,
        26 * mm,
        "Скорость",
        "30 фт",
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.0)
    pdf.drawString(left_x + 3 * mm, y - 32 * mm, "КОСТИ ХИТОВ")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 6.5)
    pdf.drawString(left_x + 27 * mm, y - 32 * mm, "10к8")
    draw_squares(pdf, left_x + 38 * mm, y - 34.8 * mm, 10)

    draw_box(pdf, right_x, y, right_w, top_h, "Магия и вдохновение")

    draw_line_field(
        pdf,
        right_x + 3 * mm,
        y - 10 * mm,
        29 * mm,
        "Харизма",
        "18 (+4)",
    )
    draw_line_field(
        pdf,
        right_x + 36 * mm,
        y - 10 * mm,
        28 * mm,
        "СЛ",
        "16",
    )

    draw_line_field(
        pdf,
        right_x + 3 * mm,
        y - 21 * mm,
        29 * mm,
        "Атака магией",
        "+8",
    )
    draw_line_field(
        pdf,
        right_x + 36 * mm,
        y - 21 * mm,
        28 * mm,
        "Фокус",
        "Клинок",
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.0)
    pdf.drawString(right_x + 3 * mm, y - 32 * mm, "ВДОХНОВЕНИЕ")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 6.4)
    pdf.drawString(right_x + 32 * mm, y - 32 * mm, "1к10")
    draw_squares(pdf, right_x + 43 * mm, y - 34.8 * mm, 4)

    y -= top_h + 5 * mm

    # Второй ряд: ход и концентрация.
    combat_h = 40 * mm

    draw_box(pdf, left_x, y, left_w, combat_h, "Текущий ход")

    action_y = y - 12 * mm
    action_items = [
        "Действие",
        "Бонусное действие",
        "Реакция",
        "Передвижение",
    ]

    for index, label in enumerate(action_items):
        col = index % 2
        row = index // 2
        item_x = left_x + 4 * mm + col * 44 * mm
        item_y = action_y - row * 10 * mm

        draw_square(pdf, item_x, item_y - 3.1 * mm)
        pdf.setFillColor(black)
        pdf.setFont("Sheet", 7.1)
        pdf.drawString(item_x + 5 * mm, item_y - 0.5 * mm, label)

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.1)
    pdf.drawString(left_x + 4 * mm, y - 34 * mm, "РЕШЕНИЕ ХОДА")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 6.5)
    pdf.drawString(
        left_x + 31 * mm,
        y - 34 * mm,
        "контроль / клинок / поддержка / отход",
    )

    draw_box(pdf, right_x, y, right_w, combat_h, "Концентрация и состояния")

    draw_line_field(
        pdf,
        right_x + 3 * mm,
        y - 10 * mm,
        right_w - 6 * mm,
        "Концентрация",
    )

    pdf.setFillColor(black)
    pdf.setFont("Sheet", 5.65)
    pdf.drawString(
        right_x + 3 * mm,
        y - 17.0 * mm,
        "Проверка: Телосложение +2",
    )
    pdf.drawString(
        right_x + 3 * mm,
        y - 21.0 * mm,
        "СЛ: 10 или половина урона",
    )

    conditions = [
        "очарован",
        "испуган",
        "парализован",
        "ошеломлён",
        "невидим",
        "опутан",
        "отравлен",
        "ничком",
    ]

    condition_start_y = y - 27.2 * mm
    condition_col_width = 32 * mm
    condition_row_height = 3.0 * mm

    for index, label in enumerate(conditions):
        col = index % 2
        row = index // 2

        item_x = right_x + 3 * mm + col * condition_col_width
        item_y = condition_start_y - row * condition_row_height

        draw_square(
            pdf,
            item_x,
            item_y - 2.0 * mm,
            size=2.15 * mm,
        )

        pdf.setFillColor(black)
        pdf.setFont("Sheet", 5.05)
        pdf.drawString(
            item_x + 3.15 * mm,
            item_y - 0.35 * mm,
            label,
        )

    y -= combat_h + 5 * mm

    # Третий ряд: характеристики и спасброски.
    stats_h = 52 * mm

    draw_box(pdf, left_x, y, left_w, stats_h, "Характеристики")

    stat_gap_x = 2.2 * mm
    stat_gap_y = 2.2 * mm
    stat_x = left_x + 3 * mm
    stat_y = y - 9 * mm
    stat_w = (left_w - 6 * mm - 2 * stat_gap_x) / 3
    stat_h = 19 * mm

    for index, (label, score) in enumerate(CHARACTER["abilities"].items()):
        col = index % 3
        row = index // 3

        x = stat_x + col * (stat_w + stat_gap_x)
        top = stat_y - row * (stat_h + stat_gap_y)

        draw_stat(
            pdf,
            x,
            top,
            stat_w,
            stat_h,
            label,
            score,
        )

    draw_box(pdf, right_x, y, right_w, stats_h, "Спасброски и ключевые навыки")

    save_y = y - 10 * mm
    save_col_width = 32 * mm
    save_row_height = 5.1 * mm

    for index, (name, value) in enumerate(CHARACTER["saves"].items()):
        col = index % 2
        row = index // 2

        x = right_x + 3 * mm + col * save_col_width
        yy = save_y - row * save_row_height

        pdf.setFillColor(black)
        pdf.setFont("Sheet", 5.9)
        pdf.drawString(x, yy, name)

        pdf.setFont("Sheet-Bold", 6.1)
        pdf.drawRightString(x + 26.5 * mm, yy, f"{value:+d}")

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.25)
    pdf.line(
        right_x + 3 * mm,
        y - 26.8 * mm,
        right_x + right_w - 3 * mm,
        y - 26.8 * mm,
    )

    skills_y = y - 32.5 * mm
    skill_col_width = 32 * mm
    skill_row_height = 4.15 * mm

    for index, (name, value, note) in enumerate(CHARACTER["skills"]):
        col = index % 2
        row = index // 2

        x = right_x + 3 * mm + col * skill_col_width
        yy = skills_y - row * skill_row_height

        pdf.setFillColor(black)
        pdf.setFont("Sheet", 5.2)
        pdf.drawString(x, yy, name)

        pdf.setFont("Sheet-Bold", 5.5)
        pdf.drawRightString(x + 19.5 * mm, yy, value)

        if note:
            pdf.setFont("Sheet", 4.45)
            pdf.drawString(
                x + 20.7 * mm,
                yy,
                note,
            )

    y -= stats_h + 5 * mm

    # Нижний ряд: атаки, росчерки и ячейки.
    bottom_h = 72 * mm

    draw_box(pdf, left_x, y, left_w, bottom_h, "Атаки и росчерки клинка")

    attack_y = y - 10 * mm

    attacks = [
        (
            "Солнечный клинок",
            "+10",
            "1к8 + 8 излучением",
            "Основное оружие · фехтовальное · +2 магическое",
        ),
        (
            "Рапира",
            "+8",
            "1к8 + 6 колющим",
            "Запасное оружие · фехтовальное",
        ),
        (
            "Кинжал",
            "+8",
            "1к4 + 4 колющим",
            "Лёгкое · метательное 20/60",
        ),
    ]

    for name, attack_bonus, damage, note in attacks:
        attack_y = draw_paragraph(
            pdf,
            (
                f"<b>{name}</b> · атака {attack_bonus} · {damage}"
                f"<br/><font size=5.8>{note}</font>"
            ),
            styles["body"],
            left_x + 3 * mm,
            attack_y,
            left_w - 6 * mm,
        ) - 1.2 * mm

    attack_y -= 1 * mm

    attack_y = draw_paragraph(
        pdf,
        (
            "<b>Дополнительная атака.</b> Две атаки при действии «Атака». "
            "<b>Дуэлянт.</b> +2 к урону оружием ближнего боя "
            "в одной руке без второго оружия."
        ),
        styles["body"],
        left_x + 3 * mm,
        attack_y,
        left_w - 6 * mm,
    ) - 2 * mm

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.3)
    pdf.drawString(left_x + 3 * mm, attack_y, "РОСЧЕРКИ КЛИНКА · 1К10")

    flourish_y = attack_y - 6 * mm

    flourishes = [
        (
            "Оборонительный",
            " +1к10 к урону; КД + результат до начала следующего хода.",
        ),
        (
            "Режущий",
            " +1к10 цели и существу в пределах 5 футов.",
        ),
        (
            "Мобильный",
            " +1к10; оттолкнуть цель и сместиться реакцией.",
        ),
    ]

    for title, text in flourishes:
        flourish_y = draw_paragraph(
            pdf,
            f"<b>{title}.</b>{text}",
            styles["small"],
            left_x + 3 * mm,
            flourish_y,
            left_w - 6 * mm,
        ) - 1 * mm

    draw_box(pdf, right_x, y, right_w, bottom_h, "Ячейки и быстрые решения")

    slot_y = y - 11 * mm

    slots = [
        ("1 уровень", 4),
        ("2 уровень", 3),
        ("3 уровень", 3),
        ("4 уровень", 3),
        ("5 уровень", 2),
    ]

    for index, (label, count) in enumerate(slots):
        yy = slot_y - index * 8 * mm

        pdf.setFillColor(LIGHT)
        pdf.rect(
            right_x + 3 * mm,
            yy - 4.6 * mm,
            right_w - 6 * mm,
            6.2 * mm,
            stroke=0,
            fill=1,
        )

        pdf.setFillColor(black)
        pdf.setFont("Sheet-Bold", 6.8)
        pdf.drawString(right_x + 5 * mm, yy - 1.0 * mm, label)

        draw_squares(
            pdf,
            right_x + 27 * mm,
            yy - 3.8 * mm,
            count,
            size=3.0 * mm,
            gap=1.5 * mm,
        )

    quick_y = y - 55 * mm

    draw_paragraph(
        pdf,
        (
            "<b>Контроль:</b> Гипнотический узор, Удержание личности."
            "<br/><b>Дуэль:</b> Солнечный клинок, Росчерки, Расщепление разума."
            "<br/><b>Реакция:</b> Контрзаклинание."
            "<br/><b>Спасение:</b> Лечащее слово, Переносящая дверь."
        ),
        styles["small"],
        right_x + 3 * mm,
        quick_y,
        right_w - 6 * mm,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet", 5.7)
    pdf.drawRightString(PAGE_W - MARGIN, 6 * mm, "Аурелия · боевой лист · 1/2")


def draw_page_two(pdf: canvas.Canvas) -> None:
    styles = make_styles()
    y = draw_header(pdf, "СОЦИАЛКА И МАГИЯ · ЛИСТ 2/2")

    gap = 4 * mm
    left_w = 96 * mm
    right_w = CONTENT_W - left_w - gap
    left_x = MARGIN
    right_x = left_x + left_w + gap

    # Социальная панель.
    social_h = 48 * mm

    draw_box(pdf, left_x, y, left_w, social_h, "Социальная панель")

    social_skills = [
        ("Обман", "+12"),
        ("Убеждение", "+12"),
        ("Выступление", "+12"),
        ("Акробатика", "+12"),
        ("Ловкость рук", "+12"),
        ("Запугивание", "+4"),
        ("Проницательность", "+0"),
        ("Восприятие", "+0"),
    ]

    for index, (name, value) in enumerate(social_skills):
        col = index % 2
        row = index // 2

        x = left_x + 4 * mm + col * 44 * mm
        yy = y - 11 * mm - row * 7.1 * mm

        pdf.setFillColor(LIGHT)
        pdf.rect(x, yy - 4.2 * mm, 38 * mm, 5.7 * mm, stroke=0, fill=1)

        pdf.setFillColor(black)
        pdf.setFont("Sheet", 6.6)
        pdf.drawString(x + 1.5 * mm, yy - 0.7 * mm, name)

        pdf.setFont("Sheet-Bold", 7.2)
        pdf.drawRightString(x + 36.5 * mm, yy - 0.7 * mm, value)

    draw_box(pdf, right_x, y, right_w, social_h, "Социальный стиль")

    social_text = (
        "<b>Подача:</b> обаяние, угроза и контроль сцены. "
        "Держит эмоции за маской сценического спокойствия."
        "<br/><br/><b>Триггеры:</b> дисциплина «ради порядка», "
        "ритуалы толпы, показательные наказания, давление на учеников."
        "<br/><br/><b>Тактика:</b> сначала захватить внимание, "
        "затем предложить выход, цену или угрозу."
    )

    draw_paragraph(
        pdf,
        social_text,
        styles["body"],
        right_x + 3 * mm,
        y - 10 * mm,
        right_w - 6 * mm,
    )

    y -= social_h + 5 * mm

    # Магия по ролям.
    spells_h = 115 * mm

    draw_box(pdf, left_x, y, left_w, spells_h, "Заклинания по роли")

    spell_y = y - 10 * mm

    spell_groups = [
        (
            "Заговоры",
            "Волшебная рука · Злая насмешка · Малая иллюзия · "
            "Сообщение · Фокусы.",
        ),
        (
            "Магические тайны",
            "Расщепление разума — заговор; Контрзаклинание — реакция.",
        ),
        (
            "Контроль",
            "Жуткий смех Таши · Удержание личности · "
            "Корона безумия · Гипнотический узор.",
        ),
        (
            "Урон и давление",
            "Диссонирующий шёпот · Психическое копьё Раулотима · "
            "Синаптический разряд.",
        ),
        (
            "Поддержка",
            "Лечащее слово · Лечение ран · Малое восстановление · "
            "Рассеивание магии · Видение невидимого.",
        ),
        (
            "Проникновение",
            "Маскировка · Невидимость · Высшая невидимость · "
            "Переносящая дверь.",
        ),
        (
            "Связки",
            "Расщепление разума → минус 1к4 к следующему спасброску цели "
            "→ Удержание личности, Гипнотический узор или Психическое копьё.",
        ),
    ]

    for label, value in spell_groups:
        spell_y = draw_paragraph(
            pdf,
            f"<b>{label}.</b> {value}",
            styles["body"],
            left_x + 3 * mm,
            spell_y,
            left_w - 6 * mm,
        ) - 2 * mm

    draw_box(pdf, right_x, y, right_w, spells_h, "Расовые заклинания и предметы")

    right_y = y - 10 * mm

    right_y = draw_paragraph(
        pdf,
        (
            "<b>Наследие Малболга.</b> Малая иллюзия; "
            "Маскировка — 1/долгий отдых; "
            "Невидимость — 1/долгий отдых."
        ),
        styles["body"],
        right_x + 3 * mm,
        right_y,
        right_w - 6 * mm,
    ) - 3 * mm

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 6.2)
    pdf.drawString(right_x + 3 * mm, right_y, "МАСКИРОВКА")
    draw_square(pdf, right_x + 30 * mm, right_y - 3.2 * mm)

    pdf.drawString(right_x + 3 * mm, right_y - 7 * mm, "НЕВИДИМОСТЬ")
    draw_square(pdf, right_x + 30 * mm, right_y - 10.2 * mm)

    right_y -= 16 * mm

    item_groups = [
        (
            "Солнечный клинок",
            "Фехтовальное +2 оружие; 1к8+8 излучением; фокус барда.",
        ),
        (
            "Доспех из змеиной чешуи",
            "КД 14 + полный модификатор Ловкости; без помехи к Скрытности.",
        ),
        (
            "Живые перчатки",
            "Экспертность в Ловкости рук; симбиотическая настройка; "
            "не снимаются без снятия проклятия.",
        ),
        (
            "Расходники",
            "Зелье лечения ×2: 2к4 + 2.",
        ),
    ]

    for label, value in item_groups:
        right_y = draw_paragraph(
            pdf,
            f"<b>{label}.</b> {value}",
            styles["body"],
            right_x + 3 * mm,
            right_y,
            right_w - 6 * mm,
        ) - 2 * mm

    y -= spells_h + 5 * mm

    # Нижняя зона: инвентарь, цель, заметки.
    bottom_h = 70 * mm

    draw_box(pdf, left_x, y, left_w, bottom_h, "Инвентарь и владения")

    inventory_y = y - 10 * mm

    inventory_text = (
        "<b>Надето:</b> солнечный клинок, доспех из змеиной чешуи, "
        "Живые перчатки."
        "<br/><br/><b>При себе:</b> виола, набор для грима, костюм артиста, "
        "подарок от поклонницы, 2 зелья лечения."
        "<br/><br/><b>Владения:</b> лёгкие и средние доспехи; простое оружие; "
        "длинные и короткие мечи, рапиры, ручные арбалеты, скимитары."
        "<br/><br/><b>Инструменты:</b> музыкальные инструменты, набор для грима."
        "<br/><br/><b>Деньги:</b> 140 зм · 12 см."
    )

    draw_paragraph(
        pdf,
        inventory_text,
        styles["body"],
        left_x + 3 * mm,
        inventory_y,
        left_w - 6 * mm,
    )

    draw_box(pdf, right_x, y, right_w, bottom_h, "Цели и заметки")

    note_y = y - 10 * mm

    note_y = draw_paragraph(
        pdf,
        (
            "<b>Цель:</b> разрушить, подчинить или очистить Орден "
            "Кровавой Каденции, не став его новой верхушкой; "
            "сорвать игры Векны и тех, кто торгует секретами."
        ),
        styles["body"],
        right_x + 3 * mm,
        note_y,
        right_w - 6 * mm,
    ) - 4 * mm

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.25)

    for index in range(8):
        line_y = note_y - index * 5.6 * mm
        pdf.line(
            right_x + 3 * mm,
            line_y,
            right_x + right_w - 3 * mm,
            line_y,
        )

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet", 5.7)
    pdf.drawRightString(
        PAGE_W - MARGIN,
        6 * mm,
        "Аурелия · социалка и магия · 2/2",
    )


def main() -> None:
    output = Path("aurelia_character_sheet_A4_v2.pdf")

    register_fonts()

    pdf = canvas.Canvas(str(output), pagesize=A4)
    pdf.setTitle("Аурелия — функциональный лист персонажа v2")

    draw_page_one(pdf)
    pdf.showPage()

    draw_page_two(pdf)
    pdf.save()

    print(f"Готово: {output.resolve()}")


if __name__ == "__main__":
    main()