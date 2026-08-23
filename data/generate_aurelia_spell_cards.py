from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

PAGE_W, PAGE_H = A4

MARGIN_X = 10 * mm
MARGIN_Y = 10 * mm
GAP_X = 4 * mm
GAP_Y = 4 * mm

COLUMNS = 2
ROWS = 3

CONTENT_W = PAGE_W - 2 * MARGIN_X
CONTENT_H = PAGE_H - 2 * MARGIN_Y

CARD_W = (CONTENT_W - GAP_X) / COLUMNS
CARD_H = (CONTENT_H - 2 * GAP_Y) / ROWS

GRAY = HexColor("#2E2E2E")
DARK = HexColor("#1E1E1E")
LIGHT = HexColor("#EEEEEE")
MID = HexColor("#A8A8A8")
VERY_LIGHT = HexColor("#F8F8F8")

SPELL_SAVE_DC = 16
SPELL_ATTACK_BONUS = 8


@dataclass(frozen=True)
class SpellCard:
    """Printable spell-card data."""

    name: str
    level: str
    school: str
    casting_time: str
    range_value: str
    components: str
    duration: str
    effect: str
    higher_levels: str = ""
    save_or_attack: str = ""
    concentration: bool = False
    source_label: str = "Бард"
    usage_label: str = ""
    notes: str = ""


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
        "Не найден TTF-шрифт с поддержкой кириллицы. "
        "Укажите пути в find_font()."
    )


def register_fonts() -> None:
    regular, bold = find_font()
    pdfmetrics.registerFont(TTFont("Sheet", regular))
    pdfmetrics.registerFont(TTFont("Sheet-Bold", bold))


def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]

    return {
        "effect": ParagraphStyle(
            "effect",
            parent=base,
            fontName="Sheet",
            fontSize=6.8,
            leading=8.0,
            textColor=black,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base,
            fontName="Sheet",
            fontSize=5.6,
            leading=6.6,
            textColor=black,
        ),
        "tiny": ParagraphStyle(
            "tiny",
            parent=base,
            fontName="Sheet",
            fontSize=4.9,
            leading=5.8,
            textColor=black,
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


def draw_square(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    size: float = 3.0 * mm,
) -> None:
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.45)
    pdf.rect(x, y, size, size, stroke=1, fill=0)


def draw_cut_marks(pdf: canvas.Canvas, x: float, y_top: float) -> None:
    mark = 2.2 * mm

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.25)

    pdf.line(x - mark, y_top, x + mark, y_top)
    pdf.line(x, y_top - mark, x, y_top + mark)

    pdf.line(x + CARD_W - mark, y_top, x + CARD_W + mark, y_top)
    pdf.line(x + CARD_W, y_top - mark, x + CARD_W, y_top + mark)

    y_bottom = y_top - CARD_H

    pdf.line(x - mark, y_bottom, x + mark, y_bottom)
    pdf.line(x, y_bottom - mark, x, y_bottom + mark)

    pdf.line(
        x + CARD_W - mark,
        y_bottom,
        x + CARD_W + mark,
        y_bottom,
    )
    pdf.line(
        x + CARD_W,
        y_bottom - mark,
        x + CARD_W,
        y_bottom + mark,
    )


def draw_card(
    pdf: canvas.Canvas,
    spell: SpellCard,
    x: float,
    y_top: float,
    styles: dict[str, ParagraphStyle],
) -> None:
    padding = 3 * mm
    header_h = 12 * mm
    footer_h = 10 * mm
    y_bottom = y_top - CARD_H

    draw_cut_marks(pdf, x, y_top)

    pdf.setFillColor(white)
    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.55)
    pdf.rect(x, y_bottom, CARD_W, CARD_H, stroke=1, fill=1)

    # Заголовок без плотной заливки: только текст и разделитель.
    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 9.0)
    pdf.drawString(
        x + padding,
        y_top - 4.8 * mm,
        spell.name.upper(),
    )

    pdf.setFont("Sheet", 5.5)
    pdf.drawRightString(
        x + CARD_W - padding,
        y_top - 4.8 * mm,
        f"{spell.level} · {spell.school}",
    )

    pdf.setFont("Sheet", 4.8)
    pdf.drawString(
        x + padding,
        y_top - 9.0 * mm,
        spell.source_label,
    )

    if spell.concentration:
        draw_square(
            pdf,
            x + CARD_W - padding - 21 * mm,
            y_top - 10.6 * mm,
            size=2.3 * mm,
        )
        pdf.drawString(
            x + CARD_W - padding - 17.7 * mm,
            y_top - 8.8 * mm,
            "конц.",
        )

    if spell.usage_label:
        usage_width = pdf.stringWidth(
            spell.usage_label,
            "Sheet",
            4.8,
        )

        box_x = x + CARD_W - padding - usage_width - 5.3 * mm

        draw_square(
            pdf,
            box_x,
            y_top - 10.6 * mm,
            size=2.3 * mm,
        )

        pdf.drawString(
            box_x + 3.2 * mm,
            y_top - 8.8 * mm,
            spell.usage_label,
        )

    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.45)
    pdf.line(
        x + padding,
        y_top - header_h,
        x + CARD_W - padding,
        y_top - header_h,
    )

    content_x = x + padding
    content_w = CARD_W - 2 * padding
    cursor_y = y_top - header_h - 3.2 * mm

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 5.6)
    pdf.drawString(content_x, cursor_y, "ВРЕМЯ")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 5.6)
    pdf.drawString(content_x + 14 * mm, cursor_y, spell.casting_time)

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 5.6)
    pdf.drawString(content_x + 38 * mm, cursor_y, "ДИСТАНЦИЯ")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 5.6)
    pdf.drawString(
        content_x + 60 * mm,
        cursor_y,
        spell.range_value,
    )

    cursor_y -= 5.3 * mm

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 5.6)
    pdf.drawString(content_x, cursor_y, "КОМПОНЕНТЫ")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 5.6)
    pdf.drawString(content_x + 21 * mm, cursor_y, spell.components)

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet-Bold", 5.6)
    pdf.drawString(content_x + 38 * mm, cursor_y, "ДЛИТЕЛЬНОСТЬ")
    pdf.setFillColor(black)
    pdf.setFont("Sheet", 5.6)
    pdf.drawString(
        content_x + 60 * mm,
        cursor_y,
        spell.duration,
    )

    cursor_y -= 5.4 * mm

    if spell.save_or_attack:
        # Очень светлая подсветка: читаемо, но экономно для печати.
        pdf.setFillColor(VERY_LIGHT)
        pdf.setStrokeColor(MID)
        pdf.setLineWidth(0.25)
        pdf.rect(
            content_x,
            cursor_y - 4.5 * mm,
            content_w,
            6.4 * mm,
            stroke=1,
            fill=1,
        )

        pdf.setFillColor(GRAY)
        pdf.setFont("Sheet-Bold", 5.7)
        pdf.drawString(
            content_x + 1.5 * mm,
            cursor_y - 0.5 * mm,
            spell.save_or_attack,
        )

        cursor_y -= 8.3 * mm

    pdf.setStrokeColor(MID)
    pdf.setLineWidth(0.25)
    pdf.line(
        content_x,
        cursor_y + 1.4 * mm,
        content_x + content_w,
        cursor_y + 1.4 * mm,
    )

    cursor_y -= 2.2 * mm

    cursor_y = draw_paragraph(
        pdf,
        spell.effect,
        styles["effect"],
        content_x,
        cursor_y,
        content_w,
    ) - 1.5 * mm

    if spell.higher_levels:
        cursor_y = draw_paragraph(
            pdf,
            f"<b>Ячейка выше:</b> {spell.higher_levels}",
            styles["small"],
            content_x,
            cursor_y,
            content_w,
        ) - 1.0 * mm

    if spell.notes:
        draw_paragraph(
            pdf,
            f"<b>Заметка:</b> {spell.notes}",
            styles["tiny"],
            content_x,
            y_bottom + footer_h + 4.5 * mm,
            content_w,
        )

    # Нижняя зона без заливки.
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.35)
    pdf.line(
        x + padding,
        y_bottom + footer_h,
        x + CARD_W - padding,
        y_bottom + footer_h,
    )

    footer_y = y_bottom + 3.9 * mm

    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet", 5.1)
    pdf.drawString(
        x + padding,
        footer_y,
        f"СЛ {SPELL_SAVE_DC} · атака +{SPELL_ATTACK_BONUS}",
    )

    pdf.drawRightString(
        x + CARD_W - padding,
        footer_y,
        "Аурелия · Бард 10",
    )

SPELLS = [
    SpellCard(
        name="Волшебная рука",
        level="Заговор",
        school="Вызов",
        casting_time="1 действие",
        range_value="30 фт",
        components="В, С",
        duration="1 минута",
        effect=(
            "Создаёшь спектральную руку. Она может взаимодействовать "
            "с предметом, открыть незапертую дверь или контейнер, достать "
            "предмет из открытого контейнера, вылить содержимое флакона "
            "или нести до 10 фунтов."
        ),
    ),
    SpellCard(
        name="Злая насмешка",
        level="Заговор",
        school="Очарование",
        casting_time="1 действие",
        range_value="60 фт",
        components="В",
        duration="Мгновенно",
        save_or_attack="Спасбросок Мудрости против СЛ 16",
        effect=(
            "Цель получает 2к4 психического урона при провале и совершает "
            "с помехой следующий бросок атаки до конца своего следующего хода."
        ),
        higher_levels=(
            "Урон растёт: 3к4 на 11 уровне, 4к4 на 17 уровне."
        ),
    ),
    SpellCard(
        name="Малая иллюзия",
        level="Заговор",
        school="Иллюзия",
        casting_time="1 действие",
        range_value="30 фт",
        components="С, М",
        duration="1 минута",
        source_label="Расовое · Наследие Малболга",
        effect=(
            "Создаёшь звук или изображение объекта в пределах дистанции. "
            "Звук не громче обычного разговора. Изображение помещается "
            "в куб 5 футов, не издаёт звуков, запахов и других ощущений."
        ),
        notes="Базовая характеристика расового заклинания — Харизма.",
    ),
    SpellCard(
        name="Сообщение",
        level="Заговор",
        school="Преобразование",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С, М",
        duration="1 раунд",
        effect=(
            "Шепчешь сообщение существу в пределах дистанции; оно слышит "
            "его и может ответить шёпотом. Заклинание проходит сквозь "
            "твёрдые преграды, если известна цель и преграда не блокирует "
            "магический звук."
        ),
    ),
    SpellCard(
        name="Фокусы",
        level="Заговор",
        school="Преобразование",
        casting_time="1 действие",
        range_value="10 фт",
        components="В, С",
        duration="До 1 часа",
        effect=(
            "Создаёшь один небольшой магический эффект: безвредное "
            "ощущение, зажечь или потушить пламя, очистить или испачкать "
            "предмет, охладить, нагреть, изменить цвет или оставить метку."
        ),
        notes="До трёх не-мгновенных эффектов одновременно.",
    ),
    SpellCard(
        name="Расщепление разума",
        level="Заговор",
        school="Очарование",
        casting_time="1 действие",
        range_value="60 фт",
        components="В",
        duration="1 раунд",
        source_label="Магические тайны",
        save_or_attack="Спасбросок Интеллекта против СЛ 16",
        effect=(
            "При провале цель получает 2к6 психического урона. "
            "Первый спасбросок, который она совершит до конца твоего "
            "следующего хода, получает штраф 1к4."
        ),
        higher_levels="3к6 на 11 уровне, 4к6 на 17 уровне.",
        notes="Связка: сначала это, затем контроль со спасброском.",
    ),
    SpellCard(
        name="Лечащее слово",
        level="1 уровень",
        school="Воплощение",
        casting_time="1 бонусное действие",
        range_value="60 фт",
        components="В",
        duration="Мгновенно",
        effect=(
            "Видимое существо в пределах дистанции восстанавливает "
            "1к4 + 4 хитов. Не действует на нежить и конструктов."
        ),
        higher_levels=(
            "Лечение увеличивается на 1к4 за уровень ячейки выше 1-го."
        ),
    ),
    SpellCard(
        name="Диссонирующий шёпот",
        level="1 уровень",
        school="Очарование",
        casting_time="1 действие",
        range_value="60 фт",
        components="В",
        duration="Мгновенно",
        save_or_attack="Спасбросок Мудрости против СЛ 16",
        effect=(
            "При провале: 3к6 психического урона; цель реакцией "
            "перемещается от тебя на всю скорость, если может. Она не "
            "идёт в очевидно опасную местность. При успехе: половина урона "
            "и без перемещения. Глухая цель автоматически преуспевает."
        ),
        higher_levels=(
            "+1к6 урона за уровень ячейки выше 1-го."
        ),
    ),
    SpellCard(
        name="Жуткий смех Таши",
        level="1 уровень",
        school="Очарование",
        casting_time="1 действие",
        range_value="30 фт",
        components="В, С, М",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Спасбросок Мудрости против СЛ 16",
        effect=(
            "Существо с Интеллектом 5+ при провале падает ничком, "
            "становится недееспособным и не может встать. В конце каждого "
            "своего хода оно повторяет спасбросок; получает преимущество, "
            "если получило урон с прошлого спасброска."
        ),
        notes="Заканчивается, если цель преуспела или стала невосприимчива.",
    ),
    SpellCard(
        name="Лечение ран",
        level="1 уровень",
        school="Воплощение",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С",
        duration="Мгновенно",
        effect=(
            "Существо, которого касаешься, восстанавливает 1к8 + 4 хитов. "
            "Не действует на нежить и конструктов."
        ),
        higher_levels=(
            "Лечение увеличивается на 1к8 за уровень ячейки выше 1-го."
        ),
    ),
    SpellCard(
        name="Удержание личности",
        level="2 уровень",
        school="Очарование",
        casting_time="1 действие",
        range_value="60 фт",
        components="В, С, М",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Спасбросок Мудрости против СЛ 16",
        effect=(
            "Гуманоид при провале становится парализованным. В конце "
            "каждого своего хода повторяет спасбросок. При успехе эффект "
            "заканчивается. Нежить не затрагивается."
        ),
        higher_levels=(
            "За каждую ячейку выше 2-й можно выбрать ещё одного гуманоида."
        ),
        notes="Атака по парализованной цели в 5 фт — критическое попадание.",
    ),
    SpellCard(
        name="Видение невидимого",
        level="2 уровень",
        school="Прорицание",
        casting_time="1 действие",
        range_value="На себя",
        components="В, С, М",
        duration="1 час",
        effect=(
            "Видишь невидимых существ и предметы так, будто они видимы; "
            "видишь на Эфирный план. Эфирные существа и объекты видны "
            "призрачными и полупрозрачными."
        ),
    ),
    SpellCard(
        name="Корона безумия",
        level="2 уровень",
        school="Очарование",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Спасбросок Мудрости против СЛ 16",
        effect=(
            "Гуманоид при провале очарован тобой. До окончания эффекта "
            "он должен действием совершать рукопашную атаку по существу, "
            "которое ты мысленно выбираешь. В каждом своём ходу можешь "
            "действием сохранять контроль или позволить ему действовать "
            "обычно."
        ),
        notes="Цель повторяет спасбросок в конце каждого хода.",
    ),
    SpellCard(
        name="Малое восстановление",
        level="2 уровень",
        school="Ограждение",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С",
        duration="Мгновенно",
        effect=(
            "Заканчиваешь одно заболевание или одно состояние: "
            "ослепление, глухота, паралич или отравление."
        ),
    ),
    SpellCard(
        name="Гипнотический узор",
        level="3 уровень",
        school="Иллюзия",
        casting_time="1 действие",
        range_value="120 фт",
        components="С, М",
        duration="До 1 минуты",
        concentration=True,
        save_or_attack="Спасбросок Мудрости против СЛ 16",
        effect=(
            "Создаёшь узор в кубе 30 футов. Существа в области, которые "
            "видят узор, при провале становятся очарованными, "
            "недееспособными, а их скорость становится 0. Эффект "
            "заканчивается при получении урона или если кто-то действием "
            "встряхнёт цель."
        ),
        notes="Не забыть исключить союзников из зоны.",
    ),
    SpellCard(
        name="Рассеивание магии",
        level="3 уровень",
        school="Ограждение",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С",
        duration="Мгновенно",
        effect=(
            "Одно заклинание 3-го уровня или ниже на цели заканчивается. "
            "Для заклинания 4-го уровня или выше сделай проверку "
            "характеристики Харизма против СЛ 10 + уровень заклинания."
        ),
        higher_levels=(
            "Автоматически заканчивает заклинания уровня ячейки или ниже."
        ),
    ),
    SpellCard(
        name="Контрзаклинание",
        level="3 уровень",
        school="Ограждение",
        casting_time="1 реакция",
        range_value="60 фт",
        components="С",
        duration="Мгновенно",
        source_label="Магические тайны",
        effect=(
            "Используется, когда видишь существо в пределах дистанции, "
            "накладывающее заклинание. Заклинание 3-го уровня или ниже "
            "автоматически проваливается. Для 4-го уровня или выше сделай "
            "проверку Харизмы против СЛ 10 + уровень заклинания."
        ),
        higher_levels=(
            "Автоматически отменяет заклинание уровня ячейки или ниже."
        ),
        notes="Реакция: оставляй её свободной при вражеских заклинателях.",
    ),
    SpellCard(
        name="Высшая невидимость",
        level="4 уровень",
        school="Иллюзия",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С",
        duration="До 1 минуты",
        concentration=True,
        effect=(
            "Ты или существо, которого касаешься, становится невидимым "
            "до окончания действия. Всё, что цель носит или несёт, "
            "становится невидимым, пока находится при ней. Невидимость "
            "не заканчивается от атаки или наложения заклинаний."
        ),
    ),
    SpellCard(
        name="Переносящая дверь",
        level="4 уровень",
        school="Вызов",
        casting_time="1 действие",
        range_value="500 фт",
        components="В",
        duration="Мгновенно",
        effect=(
            "Телепортируешься в видимое или описанное место в пределах "
            "дистанции и можешь взять одно согласное существо твоего "
            "размера или меньше. Если место занято, попадаешь в ближайшее "
            "свободное пространство."
        ),
    ),
    SpellCard(
        name="Психическое копьё Раулотима",
        level="4 уровень",
        school="Очарование",
        casting_time="1 действие",
        range_value="120 фт",
        components="В",
        duration="Мгновенно",
        save_or_attack="Спасбросок Интеллекта против СЛ 16",
        effect=(
            "Цель при провале получает 7к6 психического урона и становится "
            "недееспособной до начала твоего следующего хода. При успехе "
            "получает половину урона без дополнительного эффекта. "
            "Существо не совершает спасбросок, если ты знаешь его имя."
        ),
        higher_levels=(
            "+1к6 психического урона за уровень ячейки выше 4-го."
        ),
    ),
    SpellCard(
        name="Синаптический разряд",
        level="5 уровень",
        school="Очарование",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С",
        duration="Мгновенно",
        save_or_attack="Спасбросок Интеллекта против СЛ 16",
        effect=(
            "Каждое существо по твоему выбору в сфере радиусом 20 футов "
            "получает 8к6 психического урона при провале, половину — "
            "при успехе. При провале цель также бросает 1к6 и вычитает "
            "результат из бросков атаки, проверок характеристик и "
            "спасбросков в течение 1 минуты; повторяет спасбросок "
            "в конце каждого хода."
        ),
        higher_levels=(
            "+1к6 психического урона за уровень ячейки выше 5-го."
        ),
    ),
    SpellCard(
        name="Маскировка",
        level="1 уровень",
        school="Иллюзия",
        casting_time="1 действие",
        range_value="На себя",
        components="В, С",
        duration="1 час",
        source_label="Расовое · Наследие Малболга",
        usage_label="1/долгий отдых",
        effect=(
            "Меняешь свой внешний вид, включая одежду, доспехи, оружие "
            "и вещи при себе. Можно казаться на 1 фут ниже или выше, "
            "но нельзя изменить базовое строение тела. Иллюзия не "
            "выдерживает физическую проверку."
        ),
        notes="Наложение через расу: Харизма; отмечай квадрат после применения.",
    ),
    SpellCard(
        name="Невидимость",
        level="2 уровень",
        school="Иллюзия",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С, М",
        duration="До 1 часа",
        concentration=True,
        source_label="Расовое · Наследие Малболга",
        usage_label="1/долгий отдых",
        effect=(
            "Ты или существо, которого касаешься, становится невидимым. "
            "Всё, что цель носит или несёт, также становится невидимым. "
            "Заканчивается, если цель атакует или накладывает заклинание."
        ),
        notes="Наложение через расу: Харизма; отмечай квадрат после применения.",
    ),
]


def draw_page_header(
    pdf: canvas.Canvas,
    page_number: int,
    total_pages: int,
) -> None:
    pdf.setFillColor(GRAY)
    pdf.setFont("Sheet", 5.3)

    pdf.drawString(
        MARGIN_X,
        PAGE_H - 5.5 * mm,
        "АУРЕЛИЯ · КАРТОЧКИ ЗАКЛИНАНИЙ · D&D 5e (2014)",
    )

    pdf.drawRightString(
        PAGE_W - MARGIN_X,
        PAGE_H - 5.5 * mm,
        f"стр. {page_number}/{total_pages} · резать по меткам",
    )


def main() -> None:
    output = Path("aurelia_spell_cards_A4.pdf")

    register_fonts()
    styles = build_styles()

    cards_per_page = COLUMNS * ROWS
    total_pages = (len(SPELLS) + cards_per_page - 1) // cards_per_page

    pdf = canvas.Canvas(str(output), pagesize=A4)
    pdf.setTitle("Аурелия — карточки заклинаний")

    for page_index in range(total_pages):
        draw_page_header(
            pdf,
            page_number=page_index + 1,
            total_pages=total_pages,
        )

        page_spells = SPELLS[
            page_index * cards_per_page : (page_index + 1) * cards_per_page
        ]

        for index, spell in enumerate(page_spells):
            row = index // COLUMNS
            col = index % COLUMNS

            x = MARGIN_X + col * (CARD_W + GAP_X)
            y_top = PAGE_H - MARGIN_Y - row * (CARD_H + GAP_Y)

            draw_card(
                pdf=pdf,
                spell=spell,
                x=x,
                y_top=y_top,
                styles=styles,
            )

        pdf.showPage()

    pdf.save()
    print(f"Готово: {output.resolve()}")


if __name__ == "__main__":
    main()