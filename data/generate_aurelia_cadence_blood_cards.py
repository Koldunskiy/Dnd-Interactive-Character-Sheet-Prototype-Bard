from __future__ import annotations

from dataclasses import dataclass
from math import cos, pi, sin
from pathlib import Path

from reportlab.lib.colors import Color, HexColor, black, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

PAGE_W, PAGE_H = A4

CARD_W = 63 * mm
CARD_H = 88 * mm
COLS = 3
ROWS = 3
GAP_X = 3 * mm
GAP_Y = 3 * mm
GRID_W = COLS * CARD_W + (COLS - 1) * GAP_X
GRID_H = ROWS * CARD_H + (ROWS - 1) * GAP_Y
GRID_X = (PAGE_W - GRID_W) / 2
GRID_Y_TOP = (PAGE_H + GRID_H) / 2

INK = HexColor("#282522")
GRAY = HexColor("#77716A")
PALE = HexColor("#F4F1EA")
PAPER = HexColor("#FFFDF8")

SPELL_DC = 16
SPELL_ATTACK = 8


@dataclass(frozen=True)
class SchoolStyle:
    symbol: str
    accent: Color
    motif: str


SCHOOLS = {
    "Очарование": SchoolStyle("♥", HexColor("#7A3030"), "mask"),
    "Иллюзия": SchoolStyle("♠", HexColor("#4E4B69"), "eye"),
    "Ограждение": SchoolStyle("♦", HexColor("#365D7D"), "shield"),
    "Вызов": SchoolStyle("♣", HexColor("#3D6549"), "hand"),
    "Воплощение": SchoolStyle("✦", HexColor("#806032"), "star"),
    "Прорицание": SchoolStyle("◉", HexColor("#5B4B78"), "eye"),
    "Преобразование": SchoolStyle("⚙", HexColor("#50644B"), "gear"),
}

DISPLAY_ROLES = {
    "Утилита": "УТИЛИТА",
    "Разведка": "РАЗВЕДКА",
    "Поддержка": "ПОДДЕРЖКА",
    "Контроль": "КОНТРОЛЬ",
    "Подготовка контроля": "ПОДГОТОВКА",
    "Урон / давление": "ДАВЛЕНИЕ",
    "Магическая защита": "ЗАЩИТА",
    "Проникновение": "ПРОНИКНОВЕНИЕ",
}


@dataclass(frozen=True)
class SpellCard:
    name: str
    level: int
    school: str
    source: str
    role: str
    priority: int
    casting_time: str
    range_value: str
    components: str
    duration: str
    rules: str
    tactics: str
    save_or_attack: str = ""
    concentration: bool = False
    uses: str = ""


CARD_TACTICS = {
    "Волшебная рука": {
        "role": "Утилита",
        "priority": 1,
        "tactics": (
            "Двери, ключи, ловушки, предметы вне досягаемости. "
            "Держись вне опасной зоны."
        ),
    },
    "Злая насмешка": {
        "role": "Урон / давление",
        "priority": 2,
        "tactics": (
            "Хороша против опасного одиночного атакующего, "
            "когда важно сорвать его следующий удар."
        ),
    },
    "Малая иллюзия": {
        "role": "Утилита",
        "priority": 2,
        "tactics": (
            "Отвлекай, создавай укрытие для обзора или ложный звук. "
            "Лучше работает до начала открытого боя."
        ),
    },
    "Сообщение": {
        "role": "Разведка",
        "priority": 1,
        "tactics": (
            "Тихая координация при разделении группы, проникновении "
            "и переговорах."
        ),
    },
    "Фокусы": {
        "role": "Утилита",
        "priority": 1,
        "tactics": (
            "Мелкие сценические эффекты, метки, отвлечение и работа "
            "с предметами."
        ),
    },
    "Расщепление разума": {
        "role": "Подготовка контроля",
        "priority": 3,
        "tactics": (
            "Сначала наложи штраф 1к4, затем используй контроль "
            "со спасброском: Удержание личности или Гипнотический узор."
        ),
    },
    "Лечащее слово": {
        "role": "Поддержка",
        "priority": 4,
        "tactics": (
            "Поднимай союзника с 0 хитов бонусным действием, "
            "не теряя основное действие."
        ),
    },
    "Диссонирующий шёпот": {
        "role": "Урон / давление",
        "priority": 3,
        "tactics": (
            "Выталкивай врага из позиции и провоцируй атаки союзников "
            "при его вынужденном отходе."
        ),
    },
    "Жуткий смех Таши": {
        "role": "Контроль",
        "priority": 3,
        "tactics": (
            "Выключай сильную одиночную цель с хорошими атаками. "
            "Не давай союзникам случайно снять эффект уроном."
        ),
    },
    "Лечение ран": {
        "role": "Поддержка",
        "priority": 2,
        "tactics": (
            "Используй вне давления боя или когда можно безопасно "
            "потратить основное действие."
        ),
    },
    "Удержание личности": {
        "role": "Контроль",
        "priority": 4,
        "tactics": (
            "Лучший ответ гуманоидному боссу. Подготовь его "
            "Расщеплением разума; союзники в 5 фт автоматически критуют."
        ),
    },
    "Видение невидимого": {
        "role": "Разведка",
        "priority": 2,
        "tactics": (
            "Накладывай заранее, если ждёшь невидимость, иллюзии "
            "или эфирных противников."
        ),
    },
    "Корона безумия": {
        "role": "Контроль",
        "priority": 2,
        "tactics": (
            "Полезна, если есть конкретная вражеская цель, по которой "
            "можно развернуть опасного гуманоида."
        ),
    },
    "Малое восстановление": {
        "role": "Поддержка",
        "priority": 2,
        "tactics": (
            "Держи против паралича, отравления, слепоты, глухоты "
            "и заболеваний; обычно не первый ход боя."
        ),
    },
    "Гипнотический узор": {
        "role": "Контроль",
        "priority": 4,
        "tactics": (
            "Выключай группу врагов в начале сцены. Сразу обозначь "
            "союзникам: не наносить урон затронутым целям."
        ),
    },
    "Рассеивание магии": {
        "role": "Магическая защита",
        "priority": 3,
        "tactics": (
            "Снимай баффы врагов, удерживающие эффекты, магические "
            "барьеры и опасные эффекты на союзниках."
        ),
    },
    "Контрзаклинание": {
        "role": "Магическая защита",
        "priority": 4,
        "tactics": (
            "Оставляй реакцию свободной против магов. Не трать её "
            "на неопасное заклинание, если ждёшь сильный контроль."
        ),
    },
    "Высшая невидимость": {
        "role": "Проникновение",
        "priority": 3,
        "tactics": (
            "Ставь на себя перед боем или на союзника, которому "
            "нужно занять позицию и продолжать атаковать."
        ),
    },
    "Переносящая дверь": {
        "role": "Проникновение",
        "priority": 4,
        "tactics": (
            "Эвакуируй союзника, обходи стену, ловушку или линию фронта. "
            "Помни: можно взять только одного спутника."
        ),
    },
    "Психическое копьё Раулотима": {
        "role": "Урон / давление",
        "priority": 3,
        "tactics": (
            "Бей по цели, чьё имя известно: тогда нет спасброска. "
            "Недееспособность открывает союзникам безопасный ход."
        ),
    },
    "Синаптический разряд": {
        "role": "Урон / давление",
        "priority": 4,
        "tactics": (
            "Лучший массовый дебафф против плотной группы. "
            "Выбирай центр так, чтобы исключить союзников."
        ),
    },
    "Маскировка": {
        "role": "Проникновение",
        "priority": 3,
        "tactics": (
            "Расовый ресурс: используй для легенды, прохода и побега. "
            "Физическая проверка может раскрыть иллюзию."
        ),
    },
    "Невидимость": {
        "role": "Проникновение",
        "priority": 3,
        "tactics": (
            "Расовый ресурс для разведки и обхода. Не атакуй и не "
            "накладывай заклинания, если хочешь сохранить эффект."
        ),
    },
}


def _spell(
    *,
    name: str,
    level: int,
    school: str,
    source: str,
    casting_time: str,
    range_value: str,
    components: str,
    duration: str,
    rules: str,
    save_or_attack: str = "",
    concentration: bool = False,
    uses: str = "",
) -> SpellCard:
    try:
        tactic = CARD_TACTICS[name]
    except KeyError as exc:
        raise ValueError(
            f"Для заклинания {name!r} нет данных в CARD_TACTICS."
        ) from exc

    return SpellCard(
        name=name,
        level=level,
        school=school,
        source=source,
        role=tactic["role"],
        priority=tactic["priority"],
        casting_time=casting_time,
        range_value=range_value,
        components=components,
        duration=duration,
        rules=rules,
        tactics=tactic["tactics"],
        save_or_attack=save_or_attack,
        concentration=concentration,
        uses=uses,
    )


SPELLS = [
    _spell(
        name="Волшебная рука",
        level=0,
        school="Вызов",
        source="Бард",
        casting_time="1 действие",
        range_value="30 фт",
        components="В, С",
        duration="1 минута",
        rules=(
            "Создай спектральную руку. Она взаимодействует с предметами, "
            "открывает незапертые двери и контейнеры, достаёт вещи "
            "и несёт до 10 фунтов."
        ),
    ),
    _spell(
        name="Злая насмешка",
        level=0,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="60 фт",
        components="В",
        duration="Мгновенно",
        rules=(
            "Провал: 2к4 психического урона; следующий бросок атаки "
            "цели до конца её следующего хода — с помехой."
        ),
        save_or_attack="Мудрость · СЛ 16",
    ),
    _spell(
        name="Малая иллюзия",
        level=0,
        school="Иллюзия",
        source="Расовое",
        casting_time="1 действие",
        range_value="30 фт",
        components="С, М",
        duration="1 минута",
        rules=(
            "Создай звук или неподвижное изображение в кубе 5 футов. "
            "Иллюзия не создаёт иных ощущений и не выдерживает "
            "физическую проверку."
        ),
    ),
    _spell(
        name="Сообщение",
        level=0,
        school="Преобразование",
        source="Бард",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С, М",
        duration="1 раунд",
        rules=(
            "Шепни существу сообщение; оно слышит его и может ответить "
            "шёпотом. Магия проходит сквозь преграды при соблюдении "
            "условий заклинания."
        ),
    ),
    _spell(
        name="Фокусы",
        level=0,
        school="Преобразование",
        source="Бард",
        casting_time="1 действие",
        range_value="10 фт",
        components="В, С",
        duration="До 1 часа",
        rules=(
            "Небольшой магический эффект: зажечь или потушить огонь, "
            "очистить предмет, изменить вкус, температуру, цвет "
            "или оставить знак."
        ),
    ),
    _spell(
        name="Расщепление разума",
        level=0,
        school="Очарование",
        source="Магические тайны",
        casting_time="1 действие",
        range_value="60 фт",
        components="В",
        duration="1 раунд",
        rules=(
            "Провал: 2к6 психического урона. Следующий спасбросок цели "
            "до конца твоего следующего хода получает штраф 1к4."
        ),
        save_or_attack="Интеллект · СЛ 16",
    ),
    _spell(
        name="Лечащее слово",
        level=1,
        school="Воплощение",
        source="Бард",
        casting_time="1 бонусное действие",
        range_value="60 фт",
        components="В",
        duration="Мгновенно",
        rules=(
            "Видимое существо восстанавливает 1к4 + 4 хитов. "
            "На более высокой ячейке: +1к4 за уровень ячейки."
        ),
    ),
    _spell(
        name="Диссонирующий шёпот",
        level=1,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="60 фт",
        components="В",
        duration="Мгновенно",
        rules=(
            "Провал: 3к6 психического урона, затем цель реакцией "
            "перемещается от тебя на всю скорость, если может. "
            "Успех: половина урона."
        ),
        save_or_attack="Мудрость · СЛ 16",
    ),
    _spell(
        name="Жуткий смех Таши",
        level=1,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="30 фт",
        components="В, С, М",
        duration="До 1 минуты",
        rules=(
            "Провал: цель ничком, недееспособна и не может встать. "
            "Повторяет спасбросок в конце хода; получает преимущество "
            "после полученного урона."
        ),
        save_or_attack="Мудрость · СЛ 16",
        concentration=True,
    ),
    _spell(
        name="Лечение ран",
        level=1,
        school="Воплощение",
        source="Бард",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С",
        duration="Мгновенно",
        rules=(
            "Существо восстанавливает 1к8 + 4 хитов. "
            "На более высокой ячейке: +1к8 за уровень ячейки."
        ),
    ),
    _spell(
        name="Удержание личности",
        level=2,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="60 фт",
        components="В, С, М",
        duration="До 1 минуты",
        rules=(
            "Гуманоид при провале парализован. В конце каждого хода "
            "повторяет спасбросок. Нежить не затрагивается."
        ),
        save_or_attack="Мудрость · СЛ 16",
        concentration=True,
    ),
    _spell(
        name="Видение невидимого",
        level=2,
        school="Прорицание",
        source="Бард",
        casting_time="1 действие",
        range_value="На себя",
        components="В, С, М",
        duration="1 час",
        rules=(
            "Видишь невидимых существ и предметы как видимые, "
            "а также заглядываешь на Эфирный план."
        ),
    ),
    _spell(
        name="Корона безумия",
        level=2,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С",
        duration="До 1 минуты",
        rules=(
            "Гуманоид при провале очарован. Обычно он действует "
            "и атакует существо, выбранное тобой мысленно; "
            "контроль требует твоего действия."
        ),
        save_or_attack="Мудрость · СЛ 16",
        concentration=True,
    ),
    _spell(
        name="Малое восстановление",
        level=2,
        school="Ограждение",
        source="Бард",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С",
        duration="Мгновенно",
        rules=(
            "Заканчивает одно заболевание или одно состояние: "
            "ослепление, глухоту, паралич либо отравление."
        ),
    ),
    _spell(
        name="Гипнотический узор",
        level=3,
        school="Иллюзия",
        source="Бард",
        casting_time="1 действие",
        range_value="120 фт",
        components="С, М",
        duration="До 1 минуты",
        rules=(
            "Куб 30 фт. Провал: очарован, недееспособен, скорость 0. "
            "Эффект заканчивается при получении урона или если союзник "
            "действием встряхнёт цель."
        ),
        save_or_attack="Мудрость · СЛ 16",
        concentration=True,
    ),
    _spell(
        name="Рассеивание магии",
        level=3,
        school="Ограждение",
        source="Бард",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С",
        duration="Мгновенно",
        rules=(
            "Заканчивает одно заклинание 3 уровня или ниже. "
            "Для 4+ уровня: проверка Харизмы против СЛ 10 + "
            "уровень заклинания."
        ),
    ),
    _spell(
        name="Контрзаклинание",
        level=3,
        school="Ограждение",
        source="Магические тайны",
        casting_time="1 реакция",
        range_value="60 фт",
        components="С",
        duration="Мгновенно",
        rules=(
            "Когда видишь сотворение заклинания: 3 уровень или ниже — "
            "отменяется. Для 4+ уровня: проверка Харизмы против "
            "СЛ 10 + уровень заклинания."
        ),
    ),
    _spell(
        name="Высшая невидимость",
        level=4,
        school="Иллюзия",
        source="Бард",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С",
        duration="До 1 минуты",
        rules=(
            "Ты или цель становится невидимой вместе с носимыми вещами. "
            "В отличие от обычной невидимости, эффект не заканчивается "
            "от атаки или заклинания."
        ),
        concentration=True,
    ),
    _spell(
        name="Переносящая дверь",
        level=4,
        school="Вызов",
        source="Бард",
        casting_time="1 действие",
        range_value="500 фт",
        components="В",
        duration="Мгновенно",
        rules=(
            "Телепортируйся в указанное место в пределах дистанции; "
            "можешь взять одно согласное существо твоего размера или меньше."
        ),
    ),
    _spell(
        name="Психическое копьё Раулотима",
        level=4,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="120 фт",
        components="В",
        duration="Мгновенно",
        rules=(
            "Провал: 7к6 психического урона и недееспособность до начала "
            "твоего следующего хода. Успех: половина урона. Если знаешь "
            "имя цели, спасброска нет."
        ),
        save_or_attack="Интеллект · СЛ 16",
    ),
    _spell(
        name="Синаптический разряд",
        level=5,
        school="Очарование",
        source="Бард",
        casting_time="1 действие",
        range_value="120 фт",
        components="В, С",
        duration="Мгновенно",
        rules=(
            "Сфера 20 фт: провал — 8к6 психического урона и штраф 1к6 "
            "к атакам, проверкам и спасброскам до 1 минуты; "
            "успех — половина урона."
        ),
        save_or_attack="Интеллект · СЛ 16",
    ),
    _spell(
        name="Маскировка",
        level=1,
        school="Иллюзия",
        source="Расовое",
        casting_time="1 действие",
        range_value="На себя",
        components="В, С",
        duration="1 час",
        rules=(
            "Меняешь внешность, одежду и снаряжение. Физическая проверка "
            "раскрывает иллюзию. Рост можно изменить в пределах 1 фута."
        ),
        uses="1/долгий отдых",
    ),
    _spell(
        name="Невидимость",
        level=2,
        school="Иллюзия",
        source="Расовое",
        casting_time="1 действие",
        range_value="Касание",
        components="В, С, М",
        duration="До 1 часа",
        rules=(
            "Ты или существо становится невидимым вместе с носимыми вещами. "
            "Эффект заканчивается, если цель атакует или накладывает "
            "заклинание."
        ),
        concentration=True,
        uses="1/долгий отдых",
    ),
]

def find_font() -> tuple[str, str]:
    candidates = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
        ("C:/Windows/Fonts/calibri.ttf", "C:/Windows/Fonts/calibrib.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ]
    for regular, bold in candidates:
        if Path(regular).exists() and Path(bold).exists():
            return regular, bold
    raise RuntimeError("Не найден TTF-шрифт с поддержкой кириллицы. Укажите путь в find_font().")


def register_fonts() -> None:
    regular, bold = find_font()
    pdfmetrics.registerFont(TTFont("Card", regular))
    pdfmetrics.registerFont(TTFont("Card-Bold", bold))


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    return {
        "rules": ParagraphStyle(
            "rules", parent=base, fontName="Card", fontSize=6.35, leading=7.45, textColor=INK,
        ),
        "meta": ParagraphStyle(
            "meta", parent=base, fontName="Card", fontSize=5.3, leading=6.1, textColor=INK,
        ),
    }


def draw_paragraph(pdf: canvas.Canvas, text: str, style: ParagraphStyle, x: float, y_top: float, width: float) -> float:
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(width, 1000)
    paragraph.drawOn(pdf, x, y_top - height)
    return y_top - height


def card_position(index: int) -> tuple[float, float]:
    row = index // COLS
    col = index % COLS
    x = GRID_X + col * (CARD_W + GAP_X)
    y_top = GRID_Y_TOP - row * (CARD_H + GAP_Y)
    return x, y_top


def draw_cut_marks(pdf: canvas.Canvas, x: float, y_top: float) -> None:
    length = 1.5 * mm
    y_bottom = y_top - CARD_H
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.22)
    for px, py in ((x, y_top), (x + CARD_W, y_top), (x, y_bottom), (x + CARD_W, y_bottom)):
        pdf.line(px - length, py, px + length, py)
        pdf.line(px, py - length, px, py + length)


def draw_frame(pdf: canvas.Canvas, x: float, y_top: float, accent: Color) -> None:
    y_bottom = y_top - CARD_H
    outer = 1.6 * mm
    inner = 3.1 * mm
    pdf.setFillColor(PAPER)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(0.65)
    pdf.roundRect(x, y_bottom, CARD_W, CARD_H, 2.1 * mm, stroke=1, fill=1)
    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.35)
    pdf.roundRect(x + outer, y_bottom + outer, CARD_W - 2 * outer, CARD_H - 2 * outer, 1.6 * mm, stroke=1, fill=0)
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.22)
    pdf.roundRect(x + inner, y_bottom + inner, CARD_W - 2 * inner, CARD_H - 2 * inner, 1.1 * mm, stroke=1, fill=0)


def draw_school_mark(
    pdf: canvas.Canvas,
    kind: str,
    cx: float,
    cy: float,
    size: float,
    color: Color,
) -> None:
    """Draw a font-independent school mark using ReportLab paths."""

    pdf.saveState()
    pdf.setStrokeColor(color)
    pdf.setFillColor(color)
    pdf.setLineWidth(0.45)

    if kind == "heart":
        radius = size * 0.25

        pdf.circle(cx - radius, cy + radius * 0.45, radius, stroke=1, fill=1)
        pdf.circle(cx + radius, cy + radius * 0.45, radius, stroke=1, fill=1)

        path = pdf.beginPath()
        path.moveTo(cx - size * 0.50, cy + radius * 0.32)
        path.lineTo(cx + size * 0.50, cy + radius * 0.32)
        path.lineTo(cx, cy - size * 0.58)
        path.close()

        pdf.drawPath(path, stroke=1, fill=1)

    elif kind == "diamond":
        path = pdf.beginPath()
        path.moveTo(cx, cy + size * 0.58)
        path.lineTo(cx + size * 0.42, cy)
        path.lineTo(cx, cy - size * 0.58)
        path.lineTo(cx - size * 0.42, cy)
        path.close()

        pdf.drawPath(path, stroke=1, fill=1)

    elif kind == "spade":
        top = cy + size * 0.48
        bottom = cy - size * 0.26

        pdf.circle(
            cx - size * 0.22,
            cy + size * 0.05,
            size * 0.25,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            cx + size * 0.22,
            cy + size * 0.05,
            size * 0.25,
            stroke=1,
            fill=1,
        )

        path = pdf.beginPath()
        path.moveTo(cx - size * 0.47, cy + size * 0.04)
        path.lineTo(cx + size * 0.47, cy + size * 0.04)
        path.lineTo(cx, top)
        path.close()

        pdf.drawPath(path, stroke=1, fill=1)

        pdf.setFillColor(PAPER)

        path = pdf.beginPath()
        path.moveTo(cx - size * 0.42, cy + size * 0.02)
        path.lineTo(cx + size * 0.42, cy + size * 0.02)
        path.lineTo(cx, bottom)
        path.close()

        pdf.drawPath(path, stroke=0, fill=1)

        pdf.setFillColor(color)

        stem = pdf.beginPath()
        stem.moveTo(cx - size * 0.09, cy - size * 0.34)
        stem.lineTo(cx + size * 0.09, cy - size * 0.34)
        stem.lineTo(cx + size * 0.17, cy - size * 0.56)
        stem.lineTo(cx - size * 0.17, cy - size * 0.56)
        stem.close()

        pdf.drawPath(stem, stroke=1, fill=1)

    elif kind == "club":
        radius = size * 0.22

        pdf.circle(
            cx,
            cy + size * 0.25,
            radius,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            cx - size * 0.22,
            cy - size * 0.04,
            radius,
            stroke=1,
            fill=1,
        )
        pdf.circle(
            cx + size * 0.22,
            cy - size * 0.04,
            radius,
            stroke=1,
            fill=1,
        )

        stem = pdf.beginPath()
        stem.moveTo(cx - size * 0.10, cy - size * 0.22)
        stem.lineTo(cx + size * 0.10, cy - size * 0.22)
        stem.lineTo(cx + size * 0.16, cy - size * 0.55)
        stem.lineTo(cx - size * 0.16, cy - size * 0.55)
        stem.close()

        pdf.drawPath(stem, stroke=1, fill=1)

    elif kind == "star":
        path = pdf.beginPath()

        for index in range(16):
            angle = -pi / 2 + pi * index / 8
            radius = size * 0.54 if index % 2 == 0 else size * 0.23
            px = cx + cos(angle) * radius
            py = cy + sin(angle) * radius

            if index == 0:
                path.moveTo(px, py)
            else:
                path.lineTo(px, py)

        path.close()
        pdf.drawPath(path, stroke=1, fill=1)

    elif kind == "eye":
        pdf.ellipse(
            cx - size * 0.58,
            cy - size * 0.30,
            cx + size * 0.58,
            cy + size * 0.30,
            stroke=1,
            fill=0,
        )
        pdf.circle(
            cx,
            cy,
            size * 0.16,
            stroke=1,
            fill=1,
        )

    elif kind == "gear":
        pdf.circle(
            cx,
            cy,
            size * 0.30,
            stroke=1,
            fill=0,
        )
        pdf.circle(
            cx,
            cy,
            size * 0.10,
            stroke=1,
            fill=1,
        )

        for index in range(8):
            angle = index * pi / 4
            x1 = cx + cos(angle) * size * 0.30
            y1 = cy + sin(angle) * size * 0.30
            x2 = cx + cos(angle) * size * 0.52
            y2 = cy + sin(angle) * size * 0.52

            pdf.line(x1, y1, x2, y2)

    else:
        pdf.circle(
            cx,
            cy,
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
    school_name: str,
    style: SchoolStyle,
) -> None:
    label = "A" if level == 0 else str(level)

    mark_kind = {
        "Очарование": "heart",
        "Иллюзия": "spade",
        "Ограждение": "diamond",
        "Вызов": "club",
        "Воплощение": "star",
        "Прорицание": "eye",
        "Преобразование": "gear",
    }.get(school_name, "circle")

    # Верхний индекс: меньше и ближе к внешней рамке.
    top_x = x + 5.0 * mm
    top_y = y_top - 5.1 * mm

    pdf.setFillColor(style.accent)
    pdf.setFont("Card-Bold", 8.3)
    pdf.drawCentredString(
        top_x,
        top_y - 3,
        label,
    )

    draw_school_mark(
        pdf,
        mark_kind,
        top_x,
        top_y - 3.0 * mm,
        2.75 * mm,
        style.accent,
    )

    # Нижний индекс: компактный и расположен только в углу.
    y_bottom = y_top - CARD_H
    bottom_x = x + CARD_W - 5.0 * mm
    bottom_y = y_bottom + 5.4 * mm

    pdf.saveState()
    pdf.translate(bottom_x, bottom_y)
    pdf.rotate(180)

    pdf.setFillColor(style.accent)
    pdf.setFont("Card-Bold", 8.3)
    pdf.drawCentredString(
        0,
        0 - 3,
        label,
    )

    draw_school_mark(
        pdf,
        mark_kind,
        0,
        -3.0 * mm,
        2.75 * mm,
        style.accent,
    )

    pdf.restoreState()


def draw_motif(pdf: canvas.Canvas, motif: str, cx: float, cy: float, radius: float, accent: Color) -> None:
    pdf.saveState()
    pdf.setStrokeColor(accent)
    pdf.setFillColor(Color(accent.red, accent.green, accent.blue, alpha=0.05))
    pdf.setLineWidth(0.65)

    if motif in {"mask", "split_mask"}:
        pdf.ellipse(cx - radius * 0.58, cy - radius * 0.78, cx + radius * 0.58, cy + radius * 0.78, stroke=1, fill=0)
        pdf.setFillColor(accent)
        pdf.ellipse(cx - radius * 0.35, cy + radius * 0.12, cx - radius * 0.08, cy + radius * 0.28, stroke=0, fill=1)
        pdf.ellipse(cx + radius * 0.08, cy + radius * 0.12, cx + radius * 0.35, cy + radius * 0.28, stroke=0, fill=1)
        pdf.setLineWidth(0.5)
        pdf.arc(cx - radius * 0.30, cy - radius * 0.40, cx + radius * 0.30, cy - radius * 0.05, 200, 140)
        if motif == "split_mask":
            pdf.setLineWidth(0.8)
            pdf.line(cx - radius * 0.05, cy + radius * 0.72, cx + radius * 0.12, cy - radius * 0.72)
    elif motif in {"eye", "rosette"}:
        if motif == "eye":
            pdf.ellipse(cx - radius, cy - radius * 0.52, cx + radius, cy + radius * 0.52, stroke=1, fill=0)
            pdf.circle(cx, cy, radius * 0.28, stroke=1, fill=0)
            pdf.circle(cx, cy, radius * 0.08, stroke=1, fill=1)
        else:
            for index in range(12):
                angle = 2 * pi * index / 12
                px = cx + cos(angle) * radius * 0.58
                py = cy + sin(angle) * radius * 0.58
                pdf.circle(px, py, radius * 0.24, stroke=1, fill=0)
            pdf.circle(cx, cy, radius * 0.23, stroke=1, fill=0)
    elif motif in {"shield", "broken_circle"}:
        if motif == "shield":
            path = pdf.beginPath()
            path.moveTo(cx, cy + radius * 0.85)
            path.lineTo(cx + radius * 0.66, cy + radius * 0.46)
            path.lineTo(cx + radius * 0.45, cy - radius * 0.64)
            path.lineTo(cx, cy - radius * 0.92)
            path.lineTo(cx - radius * 0.45, cy - radius * 0.64)
            path.lineTo(cx - radius * 0.66, cy + radius * 0.46)
            path.close()
            pdf.drawPath(path, stroke=1, fill=0)
            pdf.line(cx, cy + radius * 0.52, cx, cy - radius * 0.55)
            pdf.line(cx - radius * 0.34, cy, cx + radius * 0.34, cy)
        else:
            pdf.circle(cx, cy, radius * 0.72, stroke=1, fill=0)
            pdf.setStrokeColor(PAPER)
            pdf.setLineWidth(3.4)
            pdf.line(cx - radius * 0.08, cy + radius * 0.94, cx + radius * 0.22, cy + radius * 0.40)
            pdf.setStrokeColor(accent)
            pdf.setLineWidth(0.65)
            pdf.line(cx - radius * 0.12, cy + radius * 0.93, cx + radius * 0.27, cy + radius * 0.25)
    elif motif == "hand":
        pdf.circle(cx, cy - radius * 0.18, radius * 0.40, stroke=1, fill=0)
        for offset in (-0.42, -0.14, 0.14, 0.42):
            pdf.line(cx + radius * offset, cy + radius * 0.12, cx + radius * offset * 1.10, cy + radius * 0.82)
    elif motif in {"star", "rune"}:
        points = 8 if motif == "star" else 6
        path = pdf.beginPath()
        for index in range(points * 2):
            angle = -pi / 2 + pi * index / points
            r = radius if index % 2 == 0 else radius * 0.42
            px = cx + cos(angle) * r
            py = cy + sin(angle) * r
            if index == 0:
                path.moveTo(px, py)
            else:
                path.lineTo(px, py)
        path.close()
        pdf.drawPath(path, stroke=1, fill=0)
    elif motif == "tongue":
        pdf.setLineWidth(0.8)
        pdf.bezier(cx - radius * 0.72, cy, cx - radius * 0.2, cy + radius * 0.85, cx + radius * 0.15, cy - radius * 0.85, cx + radius * 0.72, cy)
        pdf.line(cx + radius * 0.72, cy, cx + radius * 0.94, cy + radius * 0.18)
        pdf.line(cx + radius * 0.72, cy, cx + radius * 0.94, cy - radius * 0.18)
    elif motif == "chains":
        for dx, dy in ((-0.38, 0.28), (-0.13, 0.08), (0.13, -0.12), (0.38, -0.32)):
            pdf.ellipse(cx + radius * (dx - 0.17), cy + radius * (dy - 0.11), cx + radius * (dx + 0.17), cy + radius * (dy + 0.11), stroke=1, fill=0)
    elif motif == "crown":
        path = pdf.beginPath()
        path.moveTo(cx - radius * 0.75, cy - radius * 0.45)
        path.lineTo(cx - radius * 0.62, cy + radius * 0.55)
        path.lineTo(cx - radius * 0.20, cy + radius * 0.05)
        path.lineTo(cx, cy + radius * 0.70)
        path.lineTo(cx + radius * 0.20, cy + radius * 0.05)
        path.lineTo(cx + radius * 0.62, cy + radius * 0.55)
        path.lineTo(cx + radius * 0.75, cy - radius * 0.45)
        path.close()
        pdf.drawPath(path, stroke=1, fill=0)
        pdf.line(cx - radius * 0.75, cy - radius * 0.45, cx + radius * 0.75, cy - radius * 0.45)
    elif motif == "gear":
        pdf.circle(cx, cy, radius * 0.48, stroke=1, fill=0)
        pdf.circle(cx, cy, radius * 0.16, stroke=1, fill=0)
        for index in range(8):
            angle = 2 * pi * index / 8
            pdf.line(cx + cos(angle) * radius * 0.48, cy + sin(angle) * radius * 0.48, cx + cos(angle) * radius * 0.82, cy + sin(angle) * radius * 0.82)
    elif motif == "cloak":
        path = pdf.beginPath()
        path.moveTo(cx, cy + radius * 0.80)
        path.curveTo(cx - radius * 0.72, cy + radius * 0.22, cx - radius * 0.54, cy - radius * 0.86, cx, cy - radius * 0.72)
        path.curveTo(cx + radius * 0.54, cy - radius * 0.86, cx + radius * 0.72, cy + radius * 0.22, cx, cy + radius * 0.80)
        path.close()
        pdf.drawPath(path, stroke=1, fill=0)
    elif motif == "door":
        pdf.roundRect(cx - radius * 0.46, cy - radius * 0.72, radius * 0.92, radius * 1.44, radius * 0.12, stroke=1, fill=0)
        pdf.arc(cx - radius * 0.42, cy + radius * 0.22, cx + radius * 0.42, cy + radius * 0.90, 0, 180)
        pdf.circle(cx + radius * 0.20, cy - radius * 0.05, radius * 0.05, stroke=1, fill=1)
    elif motif == "spear":
        pdf.setLineWidth(0.9)
        pdf.line(cx - radius * 0.70, cy - radius * 0.68, cx + radius * 0.52, cy + radius * 0.52)
        path = pdf.beginPath()
        path.moveTo(cx + radius * 0.52, cy + radius * 0.52)
        path.lineTo(cx + radius * 0.92, cy + radius * 0.94)
        path.lineTo(cx + radius * 0.62, cy + radius * 0.50)
        path.close()
        pdf.drawPath(path, stroke=1, fill=0)
    elif motif == "brain":
        pdf.circle(cx - radius * 0.25, cy + radius * 0.16, radius * 0.31, stroke=1, fill=0)
        pdf.circle(cx + radius * 0.25, cy + radius * 0.16, radius * 0.31, stroke=1, fill=0)
        pdf.circle(cx - radius * 0.20, cy - radius * 0.24, radius * 0.28, stroke=1, fill=0)
        pdf.circle(cx + radius * 0.20, cy - radius * 0.24, radius * 0.28, stroke=1, fill=0)
        pdf.line(cx, cy + radius * 0.46, cx, cy - radius * 0.53)
    else:
        pdf.circle(cx, cy, radius * 0.7, stroke=1, fill=0)

    pdf.restoreState()


def draw_separator(pdf: canvas.Canvas, x1: float, y: float, x2: float, color: Color) -> None:
    pdf.setStrokeColor(color)
    pdf.setLineWidth(0.35)
    pdf.line(x1, y, x2, y)
    pdf.circle((x1 + x2) / 2, y, 0.55 * mm, stroke=1, fill=0)


def draw_spell_card(
    pdf: canvas.Canvas,
    spell: SpellCard,
    x: float,
    y_top: float,
    styles: dict[str, ParagraphStyle],
) -> None:
    school = SCHOOLS[spell.school]
    y_bottom = y_top - CARD_H

    pad = 5.2 * mm
    content_x = x + pad
    content_w = CARD_W - 2 * pad

    draw_cut_marks(pdf, x, y_top)
    draw_frame(pdf, x, y_top, school.accent)
    draw_index(
        pdf,
        x,
        y_top,
        spell.level,
        spell.school,
        school,
    )

    title_y = y_top - 8.0 * mm

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 8.4)

    title = spell.name.upper()

    title_safe_width = content_w - 20 * mm

    if pdf.stringWidth(title, "Card-Bold", 8.4) > title_safe_width:
        pdf.setFont("Card-Bold", 7.0)

    pdf.drawCentredString(
        x + CARD_W / 2,
        title_y,
        title,
    )

    pdf.setFillColor(school.accent)
    pdf.setFont("Card", 4.9)

    pdf.drawCentredString(
        x + CARD_W / 2,
        title_y - 3.7 * mm,
        f"{spell.school.upper()} · {spell.source.upper()}",
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Card-Bold", 4.8)

    display_role = DISPLAY_ROLES.get(
        spell.role,
        spell.role.upper(),
    )

    pdf.drawCentredString(
        x + CARD_W / 2,
        title_y - 7.0 * mm,
        f"РОЛЬ: {display_role}",
    )

    priority = "◆" * spell.priority

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 4.65)
    pdf.drawRightString(
        x + CARD_W - 4.2 * mm,
        y_top - 4.9 * mm,
        priority,
    )

    draw_separator(
        pdf,
        content_x,
        y_top - 20.5 * mm,
        content_x + content_w,
        school.accent,
    )

    belt_y = y_top - 25.5 * mm

    pdf.setFillColor(PALE)
    pdf.setStrokeColor(school.accent)
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

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 5.05)

    action_label = spell.casting_time.upper()
    range_label = spell.range_value.upper()

    belt_first_line = f"{action_label} · {range_label}"

    if spell.concentration:
        belt_first_line += " · □ КОНЦ."

    pdf.drawCentredString(
        x + CARD_W / 2,
        belt_y - 2.8 * mm,
        belt_first_line,
    )

    belt_second_line = f"{spell.components.upper()} · {spell.duration.upper()}"

    if spell.uses:
        belt_second_line += f" · □ {spell.uses.upper()}"

    pdf.setFont("Card", 4.9)
    pdf.drawCentredString(
        x + CARD_W / 2,
        belt_y - 6.8 * mm,
        belt_second_line,
    )

    cursor_y = belt_y - 13.6 * mm

    if spell.save_or_attack:
        pdf.setFillColor(school.accent)
        pdf.setFont("Card-Bold", 5.6)
        pdf.drawCentredString(
            x + CARD_W / 2,
            cursor_y,
            spell.save_or_attack.upper(),
        )
        cursor_y -= 4.7 * mm

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 5.0)
    pdf.drawString(
        content_x,
        cursor_y,
        "ЭФФЕКТ",
    )

    cursor_y -= 2.5 * mm

    cursor_y = draw_paragraph(
        pdf,
        spell.rules,
        styles["rules"],
        content_x,
        cursor_y,
        content_w,
    ) - 2.0 * mm

    pdf.setStrokeColor(school.accent)
    pdf.setLineWidth(0.25)
    pdf.line(
        content_x,
        cursor_y,
        content_x + content_w,
        cursor_y,
    )

    cursor_y -= 3.0 * mm

    pdf.setFillColor(school.accent)
    pdf.setFont("Card-Bold", 5.0)
    pdf.drawString(
        content_x,
        cursor_y,
        "ТАКТИКА",
    )

    cursor_y -= 2.5 * mm

    draw_paragraph(
        pdf,
        spell.tactics,
        styles["meta"],
        content_x,
        cursor_y,
        content_w,
    )

    footer_x = x + 10.0 * mm
    footer_w = CARD_W - 20.0 * mm

    pdf.setStrokeColor(school.accent)
    pdf.setLineWidth(0.25)
    pdf.line(
        footer_x,
        y_bottom + 7.0 * mm,
        footer_x + footer_w,
        y_bottom + 7.0 * mm,
    )

    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 4.0)
    pdf.drawCentredString(
        x + CARD_W / 2,
        y_bottom + 4.15 * mm,
        "ХАРИЗМА +4 · СЛ 16 · АТАКА +8",
    )


def draw_card_back(pdf: canvas.Canvas, x: float, y_top: float) -> None:
    y_bottom = y_top - CARD_H
    draw_cut_marks(pdf, x, y_top)
    pdf.setFillColor(PAPER)
    pdf.setStrokeColor(INK)
    pdf.setLineWidth(0.65)
    pdf.roundRect(x, y_bottom, CARD_W, CARD_H, 2.1 * mm, stroke=1, fill=1)
    pdf.setStrokeColor(HexColor("#7A3030"))
    pdf.setLineWidth(0.45)
    pdf.roundRect(x + 1.6 * mm, y_bottom + 1.6 * mm, CARD_W - 3.2 * mm, CARD_H - 3.2 * mm, 1.6 * mm, stroke=1, fill=0)
    pdf.setStrokeColor(GRAY)
    pdf.setLineWidth(0.25)
    pdf.roundRect(x + 3.4 * mm, y_bottom + 3.4 * mm, CARD_W - 6.8 * mm, CARD_H - 6.8 * mm, 1.1 * mm, stroke=1, fill=0)

    cx = x + CARD_W / 2
    cy = y_bottom + CARD_H / 2
    accent = HexColor("#7A3030")

    pdf.setStrokeColor(accent)
    pdf.setLineWidth(0.45)
    for index in range(16):
        angle = 2 * pi * index / 16
        x1 = cx + cos(angle) * 12.5 * mm
        y1 = cy + sin(angle) * 12.5 * mm
        x2 = cx + cos(angle) * 17.5 * mm
        y2 = cy + sin(angle) * 17.5 * mm
        pdf.line(x1, y1, x2, y2)
    pdf.circle(cx, cy, 12.5 * mm, stroke=1, fill=0)
    pdf.circle(cx, cy, 17.5 * mm, stroke=1, fill=0)

    draw_motif(pdf, "split_mask", cx, cy + 2.0 * mm, 10 * mm, accent)

    pdf.setFillColor(INK)
    pdf.setFont("Card-Bold", 7.2)
    pdf.drawCentredString(cx, cy - 13.0 * mm, "КАДЕНЦИЯ КРОВИ")
    pdf.setFont("Card", 4.9)
    pdf.drawCentredString(cx, cy - 17.0 * mm, "АУРЕЛИЯ · КОЛЛЕГИЯ МЕЧЕЙ")

    pdf.saveState()
    pdf.translate(cx, y_bottom + 10.0 * mm)
    pdf.rotate(180)
    pdf.setFillColor(accent)
    pdf.setFont("Card", 7.5)
    pdf.drawCentredString(0, 0, "✦")
    pdf.restoreState()
    pdf.setFillColor(accent)
    pdf.setFont("Card", 7.5)
    pdf.drawCentredString(cx, y_top - 8.0 * mm, "✦")


def draw_page_label(pdf: canvas.Canvas, page_number: int, total_pages: int, side: str) -> None:
    pdf.setFillColor(GRAY)
    pdf.setFont("Card", 5.3)
    pdf.drawString(8 * mm, 6 * mm, f"АУРЕЛИЯ · КАДЕНЦИЯ КРОВИ · {side}")
    pdf.drawRightString(PAGE_W - 8 * mm, 6 * mm, f"{page_number}/{total_pages} · печатать 100%")


def build_faces(output: Path, styles: dict[str, ParagraphStyle]) -> None:
    cards_per_page = COLS * ROWS
    pages = (len(SPELLS) + cards_per_page - 1) // cards_per_page
    pdf = canvas.Canvas(str(output), pagesize=A4)
    pdf.setTitle("Аурелия — Каденция Крови — лица карт")

    for page_index in range(pages):
        draw_page_label(pdf, page_index + 1, pages, "ЛИЦА")
        batch = SPELLS[page_index * cards_per_page:(page_index + 1) * cards_per_page]
        for index, spell in enumerate(batch):
            x, y_top = card_position(index)
            draw_spell_card(pdf, spell, x, y_top, styles)
        pdf.showPage()
    pdf.save()


def build_backs(output: Path) -> None:
    cards_per_page = COLS * ROWS
    pages = (len(SPELLS) + cards_per_page - 1) // cards_per_page
    pdf = canvas.Canvas(str(output), pagesize=A4)
    pdf.setTitle("Аурелия — Каденция Крови — рубашки карт")

    for page_index in range(pages):
        draw_page_label(pdf, page_index + 1, pages, "РУБАШКИ")
        page_count = min(cards_per_page, len(SPELLS) - page_index * cards_per_page)
        for index in range(page_count):
            x, y_top = card_position(index)
            draw_card_back(pdf, x, y_top)
        pdf.showPage()
    pdf.save()


def main() -> None:
    register_fonts()
    styles = make_styles()
    build_faces(Path("aurelia_cadence_blood_faces.pdf"), styles)
    build_backs(Path("aurelia_cadence_blood_backs.pdf"))
    print("Готово: aurelia_cadence_blood_faces.pdf")
    print("Готово: aurelia_cadence_blood_backs.pdf")


if __name__ == "__main__":
    main()
