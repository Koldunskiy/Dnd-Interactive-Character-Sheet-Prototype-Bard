#!/usr/bin/env python3
"""Аурелия: бард 12, D&D 5e 2014. Односторонняя печать.

Установка: py -m pip install reportlab
Запуск:    py generate_aurelia_a5.py
Печать:    A4, альбомная ориентация, фактический размер / 100%.

12 вертикальных карточек A5 на шести альбомных A4.
Белый фон, чёрные линии. Переполнение вызывает ошибку, а не обрезание.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape
import os
import tempfile

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

OUTPUT_FILENAME = "aurelia_level_12_a5.pdf"
PAGE_W, PAGE_H = landscape(A4)
CARD_W = PAGE_W / 2
MARGIN = 7 * mm
TOP = PAGE_H - 18 * mm
BOTTOM = 13 * mm
BODY_SIZE = 8.3
LEADING = 10.3
LEVEL = 12
MAX_HP = 111
PB = 4
SCORES = {"Сила": 8, "Ловкость": 18, "Телосложение": 19,
          "Интеллект": 10, "Мудрость": 10, "Харизма": 20}
MOD = {k: (v - 10) // 2 for k, v in SCORES.items()}
CHA = MOD["Харизма"]
DEX = MOD["Ловкость"]
CON = MOD["Телосложение"]
JACK = PB // 2
DC = 8 + PB + CHA
SPELL_ATTACK = PB + CHA
MAGIC_CHECK = CHA + JACK
WEAPON_ATTACK = DEX + PB + 2
WEAPON_DAMAGE = DEX + 2 + 2  # Ловкость, магическое оружие, Дуэлянт.
AC = 14 + DEX
SLOTS = {1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1}


def bonus(n: int) -> str:
    return f"{n:+d}"


def register_fonts() -> None:
    candidates = [
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
        (Path("C:/Windows/Fonts/calibri.ttf"), Path("C:/Windows/Fonts/calibrib.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
         Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
        (Path("/Library/Fonts/Arial.ttf"), Path("/Library/Fonts/Arial Bold.ttf")),
        (Path(__file__).resolve().parent / "DejaVuSans.ttf",
         Path(__file__).resolve().parent / "DejaVuSans-Bold.ttf"),
    ]
    for regular, bold in candidates:
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont("Aurelia", str(regular)))
            pdfmetrics.registerFont(TTFont("Aurelia-Bold", str(bold)))
            pdfmetrics.registerFontFamily("Aurelia", normal="Aurelia", bold="Aurelia-Bold",
                                          italic="Aurelia", boldItalic="Aurelia-Bold")
            return
    raise RuntimeError("Не найдены обычный и жирный TTF с кириллицей. "
                       "Положите DejaVuSans.ttf и DejaVuSans-Bold.ttf рядом со скриптом.")


class LayoutError(RuntimeError):
    pass


class Card:
    def __init__(self, c: canvas.Canvas, side: int, number: int, title: str):
        self.c = c
        self.x = side * CARD_W + MARGIN
        self.w = CARD_W - 2 * MARGIN
        self.y = TOP
        self.number = number
        self.title = title
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.4)
        c.setFont("Aurelia-Bold", 12)
        c.drawString(self.x, PAGE_H - 10 * mm, "АУРЕЛИЯ")
        c.setFont("Aurelia", 7)
        c.drawRightString(self.x + self.w, PAGE_H - 10 * mm, f"Бард {LEVEL} · Коллегия Мечей")
        c.line(self.x, PAGE_H - 12 * mm, self.x + self.w, PAGE_H - 12 * mm)
        c.setFont("Aurelia", 7)
        c.drawString(self.x, 7 * mm, "D&D 5e 2014 · Тифлинг Гласии")
        c.drawRightString(self.x + self.w, 7 * mm, f"{number:02d} · {title}")
        self.text(escape(title.upper()), size=11, bold=True, gap=3 * mm)

    def require(self, h: float) -> None:
        if self.y - h < BOTTOM:
            raise LayoutError(f"Карточка {self.number} «{self.title}»: переполнение. "
                              f"Нужно {h/mm:.1f} мм, осталось {(self.y-BOTTOM)/mm:.1f} мм. "
                              "Перераспределите блоки; текст не обрезан.")

    @staticmethod
    def paragraph(text: str, width: float, size: float = BODY_SIZE,
                  bold: bool = False) -> tuple[Paragraph, float]:
        style = ParagraphStyle("card", fontName="Aurelia-Bold" if bold else "Aurelia",
                               fontSize=size, leading=size + 2, textColor=colors.black,
                               spaceBefore=0, spaceAfter=0)
        p = Paragraph(text, style)
        _, h = p.wrap(width, PAGE_H * 10)
        return p, h

    def text(self, text: str, size: float = BODY_SIZE, bold: bool = False,
             gap: float = 1.6 * mm) -> None:
        p, h = self.paragraph(text, self.w, size, bold)
        self.require(h + gap)
        p.drawOn(self.c, self.x, self.y - h)
        self.y -= h + gap

    def heading(self, text: str) -> None:
        self.require(8 * mm)
        self.c.setLineWidth(0.4)
        self.c.line(self.x, self.y, self.x + self.w, self.y)
        self.y -= 1.5 * mm
        self.text(escape(text), size=9, bold=True, gap=1.8 * mm)

    def box(self, text: str, size: float = BODY_SIZE) -> None:
        pad = 2 * mm
        p, h = self.paragraph(text, self.w - 2 * pad, size)
        total = h + 2 * pad
        self.require(total + 2 * mm)
        self.c.rect(self.x, self.y - total, self.w, total, fill=0, stroke=1)
        p.drawOn(self.c, self.x + pad, self.y - pad - h)
        self.y -= total + 2 * mm

    def checks(self, label: str, count: int, size: float = 4 * mm) -> None:
        self.text(escape(label), gap=1 * mm)
        self.require(size + 2 * mm)
        for i in range(count):
            self.c.rect(self.x + i * (size + 1.7 * mm), self.y - size,
                        size, size, fill=0, stroke=1)
        self.y -= size + 2 * mm

    def grid(self, headers: list[str], widths: list[float], rows: list[list[str]],
             row_mm: float = 7, font: float = 8) -> None:
        widths = [self.w * w for w in widths]
        heights = []
        content = [headers] + rows
        for index, row in enumerate(content):
            hs = [self.paragraph(escape(t), w - 3 * mm, font, index == 0)[1]
                  for t, w in zip(row, widths)]
            heights.append(max(row_mm * mm, max(hs, default=0) + 2 * mm))
        total = sum(heights)
        self.require(total + 2 * mm)
        y = self.y
        for index, (row, h) in enumerate(zip(content, heights)):
            x = self.x
            for t, w in zip(row, widths):
                self.c.rect(x, y - h, w, h, fill=0, stroke=1)
                p, ph = self.paragraph(escape(t), w - 3 * mm, font, index == 0)
                p.drawOn(self.c, x + 1.5 * mm, y - 1 * mm - ph)
                x += w
            y -= h
        self.y = y - 2 * mm

    def lines(self, label: str, count: int, step_mm: float = 7) -> None:
        if label:
            self.heading(label)
        self.require(count * step_mm * mm + 2 * mm)
        for _ in range(count):
            self.y -= step_mm * mm
            self.c.line(self.x, self.y, self.x + self.w, self.y)
        self.y -= 2 * mm

    def fill_lines(self, step_mm: float = 7) -> None:
        count = int((self.y - BOTTOM - 2 * mm) // (step_mm * mm))
        if count > 0:
            self.lines("", count, step_mm)


def combat(k: Card) -> None:
    h = 35 * mm
    k.require(h + 3 * mm)
    split = k.w * 0.6
    for x, w, label in [(k.x, split, "ТЕКУЩИЕ HP"),
                         (k.x + split, k.w - split, "ВРЕМЕННЫЕ HP")]:
        k.c.rect(x, k.y - h, w, h, fill=0, stroke=1)
        k.c.setFont("Aurelia-Bold", 8)
        k.c.drawString(x + 2 * mm, k.y - 4 * mm, label)
    k.c.setFont("Aurelia", 8)
    k.c.drawString(k.x + 2 * mm, k.y - h + 2 * mm, f"Максимум: {MAX_HP}")
    k.y -= h + 3 * mm
    k.grid(["КД", "Инициатива", "Скорость"], [0.28, 0.32, 0.4],
           [[str(AC), bonus(DEX + JACK), "30 фт / 40 после Атаки"]], row_mm=8)
    k.grid(["Сил", "Лов", "Тел", "Инт", "Мдр", "Хар"], [1/6]*6,
           [[bonus(MOD["Сила"]), bonus(DEX+PB), bonus(CON), "+0", "+0", bonus(CHA+PB)]], row_mm=6)
    k.box(f"<b>Концентрация:</b> Тел {bonus(CON)}. СЛ 10 или половина урона (округлить вниз), что больше."
          "<br/>Заклинание: __________________________"
          "<br/>До какого момента: ___________________")
    k.checks("Вдохновение: 5 × к10 · восстановление: короткий / долгий отдых", CHA)
    k.text("<b>Смерть:</b> успехи [ ] [ ] [ ] &nbsp; провалы [ ] [ ] [ ]")
    k.text("<b>Кости хитов:</b> 12к8 · осталось: ______ · лечение костью: 1к8 +4")
    k.lines("Эффекты / временная КД / срок окончания", 3)


def tactics(k: Card) -> None:
    k.box(f"<b>Солнечный клинок:</b> атака к20 {bonus(WEAPON_ATTACK)}. Две атаки действием."
          f"<br/>Урон: 1к8 +{WEAPON_DAMAGE} излучением; крит: 2к8 +{WEAPON_DAMAGE}."
          f"<br/>По нежити: 2к8 +{WEAPON_DAMAGE}; крит: 4к8 +{WEAPON_DAMAGE}."
          "<br/><b>Дуэлянт:</b> одна рука, без другого оружия. Бонус уже учтён."
          "<br/>После действия «Атака» скорость +10 фт до конца хода.")
    k.heading("Росчерки · один за ход · после попадания при Атаке")
    k.text("Потрать 1 кость Вдохновения. Её результат добавляется к урону попадания. "
           "При крите кости дополнительного урона удваиваются; не удваивай бонус КД и расстояние.")
    k.text("<b>Оборонительный:</b> КД + результат к10 до начала твоего следующего хода.")
    k.text("<b>Режущий:</b> тот же результат урона получает ещё одно выбранное видимое существо "
           "в пределах 5 фт от тебя.")
    k.text("<b>Мобильный:</b> оттолкни цель до 5 фт + результат к10 футов. "
           "Затем реакцией можешь пройти до скорости ходьбы в свободное место в пределах 5 фт от цели.")
    k.heading("Экономика хода")
    k.text("<b>Действие:</b> Атака ×2, заклинание, Рывок, Отход, Уклонение, Помощь, Поиск, Засада, Готовность.")
    k.text("<b>Бонусное:</b> Вдохновение, Лечащее слово, включение / выключение клинка. "
           "После заклинания бонусным действием другое заклинание в этот ход — только заговор действием.")
    k.text("<b>Реакция:</b> Контрзаклинание, мобильный росчерк, провоцированная атака. "
           "Восстановление реакции — в начале своего хода.")
    k.text("<b>Контрочарование:</b> действие; до конца следующего хода слышащие тебя "
           "ты и дружественные существа в 30 фт имеют преимущество на спасброски от испуга и очарования. "
           "Прекращается при недееспособности, немоте или добровольно (без действия).", size=8)
    k.text("<b>Вдохновение:</b> бонусное действие, другое слышащее существо в 60 фт; к10 на 10 минут. "
           "Добавить к проверке, атаке или спасброску после броска, но до объявления результата.", size=8)
    k.lines("Противник / наблюдения", 2, 6)


@dataclass(frozen=True)
class Spell:
    name: str
    level: int
    meta: str
    effect: str
    extra: str = ""


SPELLS = [
    Spell("Лечащее слово", 1, "Бонусное · 60 фт · В · мгновенно",
          "Видимое существо восстанавливает 1к4 +5 HP. Не действует на нежить и конструктов.",
          "Ячейка выше: +1к4 за уровень."),
    Spell("Диссонирующий шёпот", 1, "Действие · 60 фт · В · мгновенно",
          "Мудрость: провал — 3к6 психического урона и немедленное движение реакцией максимально далеко от тебя, "
          "без явно опасных участков. Успех — половина, без движения. Оглохшая цель автоматически успешна.",
          "Ячейка выше: +1к6 за уровень."),
    Spell("Удержание личности", 2, "Действие · 60 фт · В, С, М · КОНЦ. до 1 мин",
          "Видимый гуманоид: Мудрость, провал — паралич. Повтор в конце каждого хода цели. "
          "Попадание атакой с расстояния до 5 фт — крит; атаки по цели с преимуществом.",
          "М: прямой кусок железа, фокус заменяет. Ячейка выше: +1 цель, цели в 30 фт друг от друга."),
    Spell("Разбрасывание карт", 2, "Действие · конус 15 фт · В, С, М · мгновенно",
          "Выбранные существа в конусе: Ловкость. Провал — 2к10 силового урона и ослепление "
          "до конца следующего хода цели; успех — половина, без ослепления.",
          "М: колода карт, не расходуется; обычный фокус заменяет. Ячейка выше: +1к10 за уровень."),
    Spell("Малое восстановление", 2, "Действие · касание · В, С · мгновенно",
          "Снимает одну болезнь либо одно состояние: ослепление, глухоту, паралич или отравление."),
    Spell("Гипнотический узор", 3, "Действие · 120 фт, куб 30 фт · С, М · КОНЦ. до 1 мин",
          "Видящие узор: Мудрость. Провал — очарование, недееспособность и скорость 0. "
          "Прекращается от урона или если другое существо действием встряхнёт цель.",
          "М: светящаяся палочка благовоний или кристаллический флакон с фосфоресцирующим веществом; фокус заменяет."),
    Spell("Рассеивание магии", 3, "Действие · 120 фт · В, С · мгновенно",
          "Выбери существо, предмет или магический эффект. Заклинания до уровня ячейки прекращаются; "
          f"для каждого более высокого — проверка Харизмы {bonus(MAGIC_CHECK)}, СЛ 10 + уровень заклинания."),
    Spell("Контрзаклинание", 3, "Реакция · 60 фт · С · мгновенно",
          "Когда видишь существо, накладывающее заклинание. Срывает заклинание до уровня ячейки; "
          f"выше — проверка Харизмы {bonus(MAGIC_CHECK)}, СЛ 10 + уровень. Магические тайны."),
    Spell("Высшая невидимость", 4, "Действие · касание · В, С · КОНЦ. до 1 мин",
          "Ты или касаемое существо невидимо, включая носимые вещи. Атаки и заклинания не снимают эффект. "
          "Обычно атаки цели с преимуществом, по ней — с помехой; невидимость не равна скрытности."),
    Spell("Переносящая дверь", 4, "Действие · 500 фт · В · мгновенно",
          "Телепорт в видимое, представляемое или описанное место. Можно взять согласное существо "
          "твоего размера или меньше в 5 фт и вещи в пределах грузоподъёмности. "
          "Занятое место: телепорта нет, ты и спутник получаете по 4к6 силового урона."),
    Spell("Психическое копьё Раулотима", 4, "Действие · 120 фт · В · мгновенно",
          "Видимое существо либо названная по имени цель в пределах дистанции, даже невидимая. "
          "Интеллект: провал — 7к6 психического урона и недееспособность до начала твоего следующего хода; "
          "успех — половина без состояния. Если названной цели нет в пределах дистанции, копьё исчезает.",
          "Материал не нужен. Ячейка выше: +1к6 за уровень."),
    Spell("Синаптический разряд", 5, "Действие · 120 фт, сфера 20 фт · В, С · мгновенно",
          "Выбранные существа, Интеллект: провал — 8к6 психического урона и на 1 мин "
          "вычитание 1к6 из атак, проверок характеристик и спасбросков Телосложения для концентрации. "
          "Успех — половина без штрафа. В конце каждого хода повтор Интеллекта снимает штраф. "
          "Интеллект 2 и ниже — не затронут.", "Ячейка выше: +1к6 за уровень."),
    Spell("Высшее восстановление", 5, "Действие · касание · В, С, М · мгновенно",
          "Снимает 1 уровень истощения либо один эффект: очарование / окаменение; одно проклятие "
          "(включая настройку на проклятый предмет); одно снижение характеристики; одно снижение максимума HP.",
          "М: алмазная пыль не менее 100 зм, расходуется; фокус не заменяет."),
    Spell("Разящее око", 6, "Действие · на себя, цель в 60 фт · В, С · КОНЦ. до 1 мин",
          "Сразу и затем действием выбирай видимое существо: Мудрость. Нельзя повторно выбирать "
          "цель, уже успешно спасшуюся от этого наложения. Провал — один режим: "
          "<b>сон</b> (бессознательна; пробуждение от урона или действия другого существа); "
          "<b>паника</b> (испугана тобой, в свой ход Рывок прочь безопасным путём; заканчивается, "
          "когда цель не видит тебя и находится не ближе 60 фт); "
          "<b>слабость</b> (помеха атакам и всем проверкам характеристик; повтор спасброска в конце каждого хода)."),
]


def spell_box(k: Card, s: Spell) -> None:
    text = (f"<b>{escape(s.name)} · {s.level} ур.</b><br/>"
            f"{escape(s.meta)}<br/>{s.effect}")
    if s.extra:
        text += "<br/>" + s.extra
    k.box(text)


def cantrips(k: Card) -> None:
    k.text(f"<b>СЛ {DC} · атака магией {bonus(SPELL_ATTACK)}</b> · урон заговоров на уровне 12.")
    entries = [
        ("Злая насмешка", "Действие · 60 фт · В · мгновенно",
         "Видимая цель, которая слышит тебя: Мудрость. Провал — 3к4 психического урона "
         "и помеха следующей атаке до конца её следующего хода."),
        ("Расщепление разума", "Действие · 60 фт · В · мгновенно · Магические тайны",
         "Видимая цель: Интеллект. Провал — 3к6 психического урона; вычесть 1к4 "
         "из следующего спасброска до конца твоего следующего хода."),
        ("Сообщение", "Действие · 120 фт · В, С, М · 1 раунд",
         "Укажи на цель и прошепчи сообщение; ответ слышишь только ты. Можно через преграды, "
         "если знаешь цель и что она за ними. Блокируют магическая тишина, 1 фт камня, "
         "1 дюйм обычного металла, тонкий свинец или 3 фт дерева. М: медная проволока, фокус заменяет."),
        ("Волшебная рука", "Действие · 30 фт · В, С · 1 мин",
         "Управление действием: предметы, незапертые двери / ёмкости, достать или убрать вещь. "
         "До 10 фунтов. Не атакует, не активирует магические предметы; исчезает дальше 30 фт."),
        ("Фокусы", "Действие · 10 фт · В, С · до 1 часа",
         "Малые безопасные эффекты; зажечь / погасить свечу, факел, костёр; очистить / загрязнить "
         "предмет до 1 куб. фута; нагреть, охладить, придать вкус, поставить метку. "
         "Безделушка / образ в руке — до конца следующего хода. До 3 длительных эффектов."),
        ("Малая иллюзия", "Действие · 30 фт · С, М · 1 мин · Наследие Малболга",
         "Звук либо образ предмета в кубе 5 фт; образ не создаёт свет, звук или запах. "
         "Взаимодействие раскрывает образ; действием Расследование против СЛ магии распознаёт иллюзию. "
         "М: шерсть; использовать компонент / мешочек с компонентами."),
    ]
    for name, meta, effect in entries:
        k.box(f"<b>{name}</b><br/>{meta}<br/>{effect}")


def low_spells(k: Card) -> None:
    k.text(f"<b>СЛ магии {DC}</b> · КОНЦ. = концентрация; одновременно одно такое заклинание.")
    for level in (1, 2):
        k.checks(f"Ячейки {level}-го уровня", SLOTS[level])
    for s in SPELLS:
        if s.level in (1, 2):
            spell_box(k, s)


def middle_spells(k: Card) -> None:
    """Магия 3-го уровня: отдельная карточка."""

    k.text(
        f"<b>СЛ {DC} · проверка магии {bonus(MAGIC_CHECK)}</b> "
        "(Харизма + Мастер на все руки)."
    )

    k.checks("Ячейки 3-го уровня", SLOTS[3])

    for spell in SPELLS:
        if spell.level == 3:
            spell_box(k, spell)


def fourth_spells(k: Card) -> None:
    """Магия 4-го уровня: отдельная карточка."""

    k.text(
        f"<b>СЛ магии {DC}</b> · ячейки учитываются только здесь."
    )

    k.checks("Ячейки 4-го уровня", SLOTS[4])

    for spell in SPELLS:
        if spell.level == 4:
            spell_box(k, spell)

    k.lines("Тактика / выбранные цели", 4)


def high_spells(k: Card) -> None:
    for level in (5, 6):
        k.checks(f"Ячейки {level}-го уровня", SLOTS[level])
    for s in SPELLS:
        if s.level in (5, 6):
            spell_box(k, s)
    k.heading("Расовая магия · отдельно от ячеек")
    k.text("<b>Малая иллюзия:</b> заговор на карточке 3. "
           "<b>Маскировка:</b> [ ] 1 / долгий отдых. Действие, на себя, В/С, 1 час, без концентрации. "
           "Изменение внешности и одежды; касание выявляет обман, Расследование действием против СЛ магии.")
    k.text("<b>Невидимость:</b> [ ] 1 / долгий отдых. Действие, касание, В/С/М, концентрация до 1 часа. "
           "Расовое наложение — только на себя. Заканчивается при атаке или заклинании. "
           "М: ресница в гуммиарабике; компонент / мешочек. Расовая характеристика — Харизма.")
    k.text("<b>Фокус:</b> оружие ближнего боя, которым владеешь, заменяет обычные М-компоненты "
           "заклинаний барда. Цена или расходование требуют самого материала. "
           "Для С без М нужна свободная рука. Расовая магия не становится магией барда автоматически.", size=8)


SKILLS = [
    ("Атлетика", "Сила", 0), ("Акробатика", "Ловкость", 2),
    ("Ловкость рук", "Ловкость", 1), ("Скрытность", "Ловкость", 0),
    ("Магия", "Интеллект", 0), ("История", "Интеллект", 0),
    ("Расследование", "Интеллект", 0), ("Природа", "Интеллект", 0),
    ("Религия", "Интеллект", 0), ("Уход за животными", "Мудрость", 0),
    ("Проницательность", "Мудрость", 0), ("Медицина", "Мудрость", 0),
    ("Восприятие", "Мудрость", 0), ("Выживание", "Мудрость", 0),
    ("Обман", "Харизма", 2), ("Запугивание", "Харизма", 0),
    ("Выступление", "Харизма", 2), ("Убеждение", "Харизма", 2),
]


def skill_value(ability: str, rank: int) -> int:
    return MOD[ability] + (PB * rank if rank else JACK)


def social(k: Card) -> None:
    k.text("<b>Характеристики:</b> " + " · ".join(f"{n[:3]} {v}" for n, v in SCORES.items()))
    rows = []
    for i in range(9):
        cells = []
        for name, ability, rank in (SKILLS[i], SKILLS[i + 9]):
            mark = "Э" if rank == 2 else "В" if rank else "—"
            cells.extend([f"{name} ({mark})", bonus(skill_value(ability, rank))])
        rows.append(cells)
    k.grid(["Навык", "+", "Навык", "+"], [0.4, 0.1, 0.4, 0.1], rows, row_mm=6, font=7.5)
    k.text("Э — экспертность; В — владение; — включает +2 «Мастера на все руки». "
           "Он также учтён в инициативе и проверках магии, но не спасбросках.", size=7.5)
    k.text("<b>Пассивные:</b> Восприятие 12; Проницательность 12; Расследование 12. "
           "При преимуществе +5, при помехе −5, если мастер использует пассивную проверку.")
    k.text("<b>Языки:</b> Общий, Инфернальный. <b>Предыстория:</b> Артист. "
           "<b>Инструменты:</b> виола, лютня, арфа; набор для грима. "
           "Дополнительное владение от предыстории: __________________")
    k.text("<b>По многочисленным просьбам:</b> можно найти место для выступления; "
           "при регулярных выступлениях — скромные питание и проживание, местная узнаваемость.")
    k.lines("Собеседник / цель / что хочет", 2)
    k.lines("Предложение / обещания / долги", 2)


def inventory(k: Card) -> None:
    k.text("Заполнено только подтверждённое оружие и броня. Количества и деньги — вручную.", size=8)
    rows = [["Солнечный клинок", "", ""], ["Доспех из змеиной чешуи", "", ""]]
    rows += [["", "", ""] for _ in range(9)]
    k.grid(["Предмет", "Кол-во", "Где / примечание"], [0.47, 0.15, 0.38], rows, row_mm=7)
    k.grid(["Пм", "Зм", "Эм", "См", "Мм"], [0.2]*5, [[""]*5], row_mm=9)
    k.text("<b>Настройка (до 3):</b> Солнечный клинок; Амулет здоровья; Живые перчатки. "
           "Это исходное действующее снаряжение; изменение требует пересчёта показателей.", size=8)
    k.text("<b>Доспех:</b> КД 14 + вся Ловкость; без помехи Скрытности. "
           "<b>Амулет:</b> Телосложение 19. <b>Перчатки:</b> воровские инструменты "
           "+12 (Ловкость), специализация предполагается по исходнику. "
           "Симбионт: снять / прекратить настройку добровольно нельзя; требуется снятие проклятия.", size=8)
    k.lines("Расходники / материалы / где хранится", 2)


def notes(k: Card) -> None:
    k.text("Сессия / дата: ______________________________")
    k.text("Место / участники: __________________________")
    k.heading("Заметки сессии")
    k.fill_lines(7)


def campaign(k: Card) -> None:
    k.lines("NPC / фракция / отношение", 5)
    k.lines("Зацепки / секреты / источник информации", 5)
    k.lines("Обещания / обязательства / следующая цель", 4)
    k.heading("Отдых и постоянные особенности")
    k.text("<b>Песнь отдыха к8:</b> на коротком отдыхе слышащие выступление ты и союзники "
           "получают дополнительно 1к8 HP, если потратили хотя бы одну кость хитов.")
    k.text("<b>Тифлинг:</b> тёмное зрение 60 фт; сопротивление огню. "
           "<b>Долгий отдых:</b> восстанавливает HP, ячейки и расходуемые способности; "
           "кости хитов — до половины общего количества (6).", size=8)
    k.text("<b>Истощение (накопительно):</b> 1 — помеха проверкам; 2 — скорость вдвое; "
           "3 — помеха атакам и спасброскам; 4 — максимум HP вдвое; 5 — скорость 0; 6 — смерть. "
           "Уровень сейчас: ______", size=8)


CARDS = [
    ("Бой и состояние", combat),
    ("Атаки и боевые приёмы", tactics),
    ("Заговоры", cantrips),
    ("Магия 1–2 уровней", low_spells),
    ("Магия 3-го уровня", middle_spells),
    ("Магия 4-го уровня", fourth_spells),
    ("Магия 5–6 и наследие", high_spells),
    ("Навыки и общение", social),
    ("Инвентарь и ресурсы", inventory),
    ("Заметки сессии", notes),
    ("Связи, цели и отдых", campaign),
    ("Дополнительные заметки", notes),
]


def validate_data() -> None:
    if len(SPELLS) != 14:
        raise ValueError("Должно быть 14 заклинаний плюс заговор Магических тайн.")
    if len({s.name for s in SPELLS}) != len(SPELLS):
        raise ValueError("Повтор названия заклинания.")
    if any(s.name == "Слепота/Глухота" for s in SPELLS):
        raise ValueError("Удалённое заклинание вернулось в список.")
    if (DC, SPELL_ATTACK, MAGIC_CHECK, WEAPON_ATTACK, WEAPON_DAMAGE, AC) != (17, 9, 7, 10, 8, 18):
        raise ValueError("Расчётные показатели не соответствуют согласованным данным.")
    if len(CARDS) % 2:
        raise ValueError("Нужно чётное число карточек для односторонней раскладки.")


def build_pdf(output_path: Path) -> None:
    validate_data()
    register_fonts()
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="aurelia_", suffix=".pdf", dir=output_path.parent)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        c = canvas.Canvas(str(temp_path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
        c.setTitle("Аурелия — бард 12 — карточки A5")
        c.setAuthor("Aurelia Character Sheet Generator")
        for start in range(0, len(CARDS), 2):
            c.setStrokeColor(colors.black)
            c.setLineWidth(0.25)
            c.setDash(2, 3)
            c.line(CARD_W, 5 * mm, CARD_W, PAGE_H - 5 * mm)
            c.setDash()
            for side in (0, 1):
                title, builder = CARDS[start + side]
                builder(Card(c, side, start + side + 1, title))
            c.showPage()
        c.save()
        if not temp_path.is_file() or temp_path.stat().st_size == 0:
            raise RuntimeError("PDF отсутствует или пуст.")
        os.replace(temp_path, output_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def main() -> None:
    output = Path.cwd() / OUTPUT_FILENAME
    try:
        build_pdf(output)
    except PermissionError as exc:
        raise SystemExit("Нет доступа к PDF. Закройте его в программе просмотра и повторите запуск.") from exc
    except LayoutError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"Создан: {output}")
    print(f"Листов A4: {len(CARDS)//2}; карточек A5: {len(CARDS)}. Печать: 100%, односторонняя.")


if __name__ == "__main__":
    main()
