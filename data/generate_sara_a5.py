#!/usr/bin/env python3
"""Сара Веларис, Alternate Monk 12. Проверено 17.11.2026.
Установка: py -m pip install reportlab
Запуск: py generate_sara_a5.py
По умолчанию: PDF на отдельных A5 и PDF 2×A5 на альбомном A4.
Печать: фактический размер 100%, односторонняя; A4 разрезать по центру.
Опции: --layout a5 / a4 / both; --output-dir ПАПКА; --without-amulet.
Переполнение карточки вызывает ошибку; шрифт автоматически не уменьшается.
Основа оформления: пользовательский generate_aurelia_a5.py.
"""
from __future__ import annotations
import argparse
import os
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A5, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

LEVEL, PB = 12, 4
USE_AMULET = True
SEVENTH = "Deflect Missile"  # Heavenly Step / Aura Sight / Patient Defense
BASE = dict(Сила=8, Ловкость=15, Телосложение=14, Интеллект=8, Мудрость=14, Харизма=12)
NATURAL = dict(Сила=8, Ловкость=20, Телосложение=14, Интеллект=8, Мудрость=18, Харизма=12)
SCORES = NATURAL.copy()
MOD = {}
PAGE_W, PAGE_H = A5
CARD_W = A5[0]
X_OFFSET = 0
MARGIN, BOTTOM = 7 * mm, 13 * mm
TOP = PAGE_H - 18 * mm
BODY_SIZE = 8.3
CHECKED = "17.11.2026"


def configure(amulet=True):
    global SCORES, MOD, DEX, WIS, CON, AC, DC, KI, ATTACK, DAMAGE, MAX_HP
    SCORES = NATURAL.copy()
    if amulet:
        SCORES["Телосложение"] = 19
    MOD = {k: (v-10)//2 for k,v in SCORES.items()}
    DEX, WIS, CON = MOD["Ловкость"], MOD["Мудрость"], MOD["Телосложение"]
    AC, DC, KI = 10+DEX+WIS, 8+PB+WIS, LEVEL+WIS
    ATTACK, DAMAGE = DEX+PB+1, DEX+1
    MAX_HP = 10+CON+(LEVEL-1)*(6+CON)

configure()

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
    try:
        import matplotlib
        fp = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
        candidates.append((fp / "DejaVuSans.ttf", fp / "DejaVuSans-Bold.ttf"))
    except ImportError:
        pass
    for regular, bold in candidates:
        if regular.is_file() and bold.is_file():
            pdfmetrics.registerFont(TTFont("Sara", str(regular)))
            pdfmetrics.registerFont(TTFont("Sara-Bold", str(bold)))
            pdfmetrics.registerFontFamily("Sara", normal="Sara", bold="Sara-Bold",
                                          italic="Sara", boldItalic="Sara-Bold")
            return
    raise RuntimeError("Не найдены обычный и жирный TTF с кириллицей. "
                       "Положите DejaVuSans.ttf и DejaVuSans-Bold.ttf рядом со скриптом.")


class LayoutError(RuntimeError):
    pass


class Card:
    def __init__(self, c: canvas.Canvas, side: int, number: int, title: str):
        self.c = c
        self.x = X_OFFSET + side * CARD_W + MARGIN
        self.w = CARD_W - 2 * MARGIN
        self.y = TOP
        self.number = number
        self.title = title
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.4)
        c.setFont("Sara-Bold", 11)
        c.drawString(self.x, PAGE_H - 10 * mm, "САРА ВЕЛАРИС")
        c.setFont("Sara", 6.5)
        c.drawRightString(self.x + self.w, PAGE_H - 10 * mm, f"Монах {LEVEL} · Открытая ладонь")
        c.line(self.x, PAGE_H - 12 * mm, self.x + self.w, PAGE_H - 12 * mm)
        c.setFont("Sara", 7)
        c.drawString(self.x, 7 * mm, "Юань-ти MotM · Alternate Monk")
        c.drawRightString(self.x + self.w, 7 * mm, f"{number:02d} / {len(CARDS)}")
        self.text(escape(title.upper()), size=11, bold=True, gap=3 * mm)

    def require(self, h: float) -> None:
        if self.y - h < BOTTOM:
            raise LayoutError(f"Карточка {self.number} «{self.title}»: переполнение. "
                              f"Нужно {h/mm:.1f} мм, осталось {(self.y-BOTTOM)/mm:.1f} мм. "
                              "Перераспределите блоки; текст не обрезан.")

    @staticmethod
    def paragraph(text: str, width: float, size: float = BODY_SIZE,
                  bold: bool = False) -> tuple[Paragraph, float]:
        style = ParagraphStyle("card", fontName="Sara-Bold" if bold else "Sara",
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


def state(k):
    h = 29*mm
    k.require(h+3*mm)
    for x,w,label in [(k.x,k.w*.6,"ТЕКУЩИЕ ХП"),(k.x+k.w*.6,k.w*.4,"ВРЕМЕННЫЕ ХП")]:
        k.c.rect(x,k.y-h,w,h)
        k.c.setFont("Sara-Bold",8)
        k.c.drawString(x+2*mm,k.y-4*mm,label)
    k.c.setFont("Sara",8)
    k.c.drawString(k.x+2*mm,k.y-h+2*mm,f"Максимум: {MAX_HP}")
    k.y -= h+3*mm
    k.grid(["КД","Инициатива","Скорость"],[.25,.3,.45],[[str(AC),bonus(DEX),"50 фт / 10 клеток"]],row_mm=8)
    k.box(f"<b>Безоружная:</b> к20 {bonus(ATTACK)} · досягаемость 5 фт.<br/>Урон 1к10 +{DAMAGE} дробящего, магический.<br/>Крит: 2к10 +{DAMAGE}. Эмблема уже учтена.")
    k.checks(f"Ци: {KI} · в начале своего боевого хода +1 потраченное",KI)
    k.checks(f"Отработанные удары: {WIS} / долгий отдых",WIS)
    k.checks("Внушение: 1 / долгий отдых",1)
    k.text("<b>Кости хитов:</b> 12к10 · осталось: _____")
    k.text("<b>Смерть:</b> успехи [ ] [ ] [ ] · провалы [ ] [ ] [ ]")
    k.text("Реакция: [ ] доступна · обновляется в начале своего хода.")
    k.text(f"Концентрация: ТЕЛ {bonus(CON)}; Сл 10 или половина урона (вниз), что выше. Заклинание: __________",size=8)


def actions(k):
    k.box("<b>Начало хода:</b> обнови реакцию; в бою восстанови 1 потраченное ци, если не недееспособна. Не выше 16.")
    k.heading("Действие и бонусное")
    k.grid(["Вариант","Атаки / цена"],[.59,.41],[
        ["Атака + бесплатный удар","2 + 1; 0 ци"],
        ["Атака + шквал","2 + 2; 1 ци"],
        ["Рывок / Отход действием + удар","1 бонусная; 0 ци"],
        ["Регенерация + шквал","лечение + 2; 3 ци"],
        ["Заклинание действием + шквал","заклинание + 2; 1 ци"]],row_mm=7,font=8)
    k.text("Бесплатный удар запускает действие «Атака» хотя бы с одной атакой Боевых искусств. Отдельно Extra Attack позволяет бонусную атаку Боевых искусств после Рывка или Отхода действием.")
    k.text("<b>Шквал / Flurry of Blows:</b> бонусное действие, 1 ци, два безоружных удара. Предварительная Атака не требуется.")
    k.text("После лечения или заклинания бесплатного одиночного удара нет. Шквал доступен, если ничто не запрещает бонусное действие.")
    k.heading("Одна атака — одна трата ци")
    k.text("Нельзя расходовать ци на несколько способностей в рамках одной атаки, проверки, реакции или спасброска без прямого исключения. Разные техники назначай разным попаданиям.")
    k.text("Два удара Extra Attack — одно действие «Атака», не два действия. Реакция на 12-м уровне даёт только один ответный удар.")
    k.text("Бонусное действие одно: бесплатный удар, шквал, Шаг ветра или подготовленная Терпеливая оборона — выбирай.")


def strikes(k):
    k.text("Сначала попадание и обычный урон, затем техника. Все ниже: <b>1 ци; каждая не чаще одного раза за ход</b>. Сл 16. Это не обязательно только собственный ход.")
    for title, english, effect in [
        ("Мощный удар","Empowered Strike","СИЛ 16. Провал: оттолкнуть по горизонтали от себя на 20 фт по прямой, затем опрокинуть. Цель крупнее Сары — преимущество на спасбросок."),
        ("Ошеломляющий удар","Stunning Strike","ТЕЛ 16. Провал: ошеломление до начала следующего хода Сары."),
        ("Калечащий удар","Crippling Strike","ТЕЛ 16. Провал: ослепление, глухота ИЛИ невозможность говорить до начала следующего хода Сары. Последнее мешает вербальным компонентам, а не любой магии."),
        ("Замедляющий удар","Slowing Strike","МДР 16. Провал: эффекты Slow 2014 до начала следующего хода Сары, без концентрации. Подробности — карточка 10.")]:
        k.box(f"<b>{title}</b> / {english}<br/>{effect}")
    k.heading("Отработанные удары / Practiced Strikes")
    k.text("<b>4 / долгий отдых.</b> Один раз в СВОЙ ход после безоружного попадания примени известную Strike-технику без обычной платы ци. Спасбросок остаётся; успешный спасбросок не возвращает применение.")
    k.text("Не оплачивает шквал, отражение, лечение, Мантию или проверку Атлетики. Ограничение самой техники сохраняется.")
    k.text("<b>Open Hand Strike:</b> при безоружном крите — помеха спасброскам, вызванным именно этой атакой. Не на весь раунд.")


def reactions(k):
    k.text("Одна реакция до начала следующего своего хода. Все ответные рукопашные удары требуют досягаемости: обычно 5 фт.")
    k.box("<b>Попали рукопашной атакой → Deflect Strike</b><br/>Реакция, 1 ци: уменьши урон на <b>1к10 +17</b>. На 12-м работает и против рукопашной атаки заклинанием.<br/>Урон снижен до 0: можно один безоружный ответный удар +10, урон 1к10 +6, в рамках той же реакции.")
    k.box("<b>Видимое существо промахнулось рукопашной → Ebb and Flow</b><br/>Реакция, без ци; выбери одно:<br/><b>Swift Reprisal:</b> один безоружный удар +10, 1к10 +6.<br/><b>Toppling Blow:</b> ЛОВ 16; провал — ничком и скорость 0 до конца текущего хода цели. Крупнее Сары — преимущество на спасбросок.")
    k.heading("Ударные техники на контратаке")
    k.text("Обычная Strike-техника ограничена одним разом за ход, не раунд: при подходящем попадании на чужом ходу она может быть доступна снова. Practiced Strikes на чужом ходу не работает.")
    k.text("За Deflect Strike уже потрачено ци в этой реакции: не добавляй ещё платную технику без согласованного исключения. Бесплатный Swift Reprisal сам по себе ци не расходует.")
    k.heading("Провоцированная атака")
    k.text("Видимый враг выходит из досягаемости своим перемещением: реакцией один удар перед выходом, +10 / 1к10 +6. Отход и обычное вынужденное отталкивание не провоцируют её.")
    k.text("Отражение снарядов доступно только при выбранной седьмой технике — карточка 8.")


def utility(k):
    k.box("<b>Шаг ветра / Step of the Wind</b><br/>Бонусное действие, <b>0 ци</b>: Рывок или Отход. Прыжки удвоены до конца текущего хода. Сам прыжок всё равно расходует перемещение.")
    k.box("<b>Мистическая регенерация / Mystic Regeneration</b><br/>Действие, <b>2 ци</b>: себе 1к10 +4 ХП (5–14). Не лечение союзника, не бонусное действие. Со шквалом в тот же ход — всего 3 ци.")
    k.box("<b>Несокрушимый дух / Indomitable Spirit</b><br/>При проверке Атлетики за <b>1 ци</b> добавь МДР +4. После броска, до определения успеха. Не постоянное владение Атлетикой.")
    k.heading("Захват и толчок · правила 2014")
    k.text("Заменяют одну атаку действия «Атака». Цель в досягаемости, не более чем на один размер крупнее. Для захвата нужна свободная рука.")
    k.text("Класс позволяет ЛОВ вместо СИЛ: Атлетика <b>+5</b>, с Несокрушимым духом <b>+9</b>. Обычная силовая Атлетика −1, с техникой +3. Не заменять проверку Акробатикой +9.")
    k.text("Защита цели: Атлетика или Акробатика по её выбору. Захват: скорость 0, не опутывание. Толчок: ничком либо на 5 фт. Захват/толчок без урона не запускает Strike-технику.")
    k.text("Без Enhanced Grip перетаскивание обычно вдвое снижает скорость; сам захват не наносит автоматического урона.")


SKILLS = [
    ("Акробатика", "Ловкость", True), ("Анализ", "Интеллект", False),
    ("Атлетика", "Сила", False), ("Внимательность", "Мудрость", False),
    ("Выживание", "Мудрость", False), ("Выступление", "Харизма", False),
    ("Запугивание", "Харизма", False), ("История", "Интеллект", False),
    ("Ловкость рук", "Ловкость", False), ("Магия", "Интеллект", False),
    ("Медицина", "Мудрость", False), ("Обман", "Харизма", True),
    ("Природа", "Интеллект", False), ("Проницательность", "Мудрость", True),
    ("Религия", "Интеллект", False), ("Скрытность", "Ловкость", True),
    ("Убеждение", "Мудрость", True), ("Уход за животными", "Мудрость", False)]


def social(k):
    rows = []
    for i in range(9):
        row=[]
        for name,ability,trained in [SKILLS[i],SKILLS[i+9]]:
            row.extend([name+(' •' if trained else ''),bonus(MOD[ability]+(PB if trained else 0))])
        rows.append(row)
    k.grid(["Навык","Бонус","Навык","Бонус"],[.37,.13,.37,.13],rows,row_mm=6,font=7.5)
    k.text("• — владение. Убеждение через МДР от Мантии, без сложения МДР и ХАР. Атлетика в таблице обычная силовая.",size=7.8)
    k.box("<b>Мантия учтивости / Mantle of Courtesy</b><br/>Убеждение +8. После проверки за 1 ци замени результат к20 уровнем монаха: <b>12 +8 = 20</b>, до прочих модификаторов. Не гарантирует согласия и не влияет на другие навыки.")
    k.text("<b>Пассивные:</b> Внимательность 14; Проницательность 18. Проницательность не чтение мыслей.")
    k.text("<b>Инструменты:</b> воровские, игральные карты, каллиграфа. Воровские с ЛОВ +9. Владение не означает наличие набора.")
    k.text("<b>Языки:</b> Общий; Драконий — выбран, подтвердить мастером.<br/><b>Предыстория:</b> Преступник 2014, шантажистка; контакт преступного мира — уточнить личность и доступность.")
    k.lines("Собеседник / цель / обещание",2,6)


def racial(k):
    k.text("Юань-ти <b>Monsters of the Multiverse</b>, гуманоид, Средний. МДР — выбранная характеристика расовой магии; Сл 16. Ячеек заклинаний у этой сборки нет.")
    k.text("<b>Тёмное зрение:</b> 60 фт. <b>Magic Resistance:</b> преимущество спасброскам против заклинаний, не любых магических эффектов.")
    k.text("<b>Poison Resilience:</b> сопротивление урону ядом; преимущество спасброскам от состояния «отравлен». Не иммунитет.")
    k.box("<b>Ядовитые брызги / Poison Spray · 2014</b><br/>Действие · 10 фт · В/С · видимая цель.<br/>ТЕЛ 16: провал — 3к12 ядом; успех — 0. Не бросок атаки, не вызывает бесплатный бонусный удар.")
    k.box("<b>Дружба с животными / Animal Friendship · 2014</b><br/>Неограниченно, только змеи. Действие · 30 фт · В/С/М (немного еды) · 24 часа, без концентрации.<br/>Выбери видимого зверя, который видит и слышит тебя; ИНТ 4+ — провал заклинания. МДР 16: иначе очарована. Ты/спутники вредите ей — эффект кончается. Не управление и не разговор со змеями.")
    k.box("<b>Внушение / Suggestion · 2014</b><br/>1 / долгий отдых. Действие · 30 фт · В/М · концентрация до 8 часов. Видимая цель слышит и понимает; МДР 16. Разумно звучащая инструкция, 1–2 предложения; явно вредная для цели — прекращает заклинание. Иммунитет к очарованию защищает.<br/>Выполнение задачи или урон от тебя/спутников заканчивает эффект. М: язык змеи + соты или сладкое масло.",size=8)
    k.text("Расовая способность не отменяет компоненты и не делает колдовство незаметным. Мешочек компонентов / материалы приобрести отдельно.",size=7.8)


def preparation(k):
    k.text(f"<b>Седьмая техника в этой распечатке:</b> {escape(SEVENTH)}.")
    k.box("<b>Отражение снарядов / Deflect Missile</b><br/>Реакция на видимую дальнобойную атаку оружием: уменьшить урон на <b>1к10 +17</b>, без ци.<br/>При снижении до 0 и свободной руке — поймать снаряд. За 1 ци: обратная атака 20/60 фт, <b>+9</b>, урон <b>1к10 +5</b> соответствующего типа. Эмблема не помогает.<br/>С 11-го уровня за 1 ци можно отражать любую дальнобойную атаку, включая заклинание. Не площадной эффект со спасброском.")
    k.text("Нематериальный луч не считать автоматически пригодным для поимки и броска. Расход ци на расширенное отражение и обратную атаку в одной реакции — согласовать, не складывать автоматически.")
    k.heading("Альтернативы · вместо Deflect Missile")
    k.text("<b>Heavenly Step:</b> при Unarmored Movement можно идти по стенам, жидкостям и потолкам, не падая во время движения. Остановилась — 1 ци, чтобы остаться до начала следующего хода. Не полёт и не Slow Fall.")
    k.text("<b>Aura Sight:</b> слепое зрение 20 фт; точные позиции существ и предметов, включая невидимых, но не за полным укрытием.")
    k.text("<b>Patient Defense:</b> бонусное действие, 1 ци: Уклонение. Конкурирует со шквалом и Шагом ветра.")
    k.heading("Как менять")
    k.text("Master of Many Forms: за 10 минут практики в течение долгого отдыха заменить одну известную технику на доступную. В этой сборке меняем только седьмое свободное место. Не менять набор на коротком отдыхе.")
    k.text("Это зафиксированный выбор сборки, а не запрет класса менять другие допустимые техники. Замена фирменных и пересечение формулировок — по тексту подкласса и решению мастера.",size=7.7)


def equipment(k):
    k.box(f"<b>Амулет здоровья / Amulet of Health</b><br/>Редкий, настройка. ТЕЛ 19 при ношении и настройке.<br/>С ним: 124 ХП, ТЕЛ +4. Без: ТЕЛ 14, 100 ХП, ТЕЛ +2.<br/>Текущая распечатка: {MAX_HP} ХП, ТЕЛ {bonus(CON)}. Не повышает КД монаха.")
    k.box("<b>Эмблема когтей / Insignia of Claws</b><br/>Необычная, без настройки. +1 к попаданию и урону безоружных атак; они магические. Учтена: +10 / 1к10 +6.<br/>Не повышает Сл, лечение, отражение урона или обратный бросок снаряда.")
    k.text("Оформление эмблемы: брошь дома Веларис, бронзовый овал со змеёй вокруг сливового аметиста, графитовая эмаль, потёртые края. Меняется только вид.")
    k.grid(["Прочее снаряжение","Кол-во / где"],[.61,.39],[["",""] for _ in range(6)],row_mm=7)
    k.grid(["Пм","Зм","Эм","См","Мм"],[.2]*5,[[""]*5],row_mm=8)
    k.text("Настройка: 1) амулет; 2) __________; 3) __________.<br/>Инструменты и компоненты: наличие подтвердить. Кастета нет. Дополнительные магические предметы не выданы.",size=8)


def conditions(k):
    k.heading("Замедление / Slow · версия 2014")
    k.text("Скорость вдвое; −2 КД и спасброскам ЛОВ; нет реакций. В свой ход действие ИЛИ бонусное, не оба; не более одной рукопашной или дальнобойной атаки.")
    k.text("Заклинание за 1 действие: к20, на 11+ задерживается до следующего хода цели; тогда нужно действие для завершения, иначе пропадает.")
    k.box("<b>Slowing Strike:</b> начальный МДР 16; эффект до начала следующего хода Сары, без концентрации.<br/>В Slow есть повтор МДР в конце каждого хода цели. Взаимодействие этой части со ссылкой техники на «эффекты» заклинания согласовать. По умолчанию не считать повтор отменённым.")
    k.heading("Состояния · кратко, не полный справочник")
    k.text("<b>Ничком:</b> свои атаки с помехой; атаки по цели с преимуществом в 5 фт, дальше — с помехой. Встать — половина скорости, при скорости 0 нельзя.")
    k.text("<b>Ошеломление:</b> недееспособность, нет движения, речь запинаясь; автоматический провал СИЛ/ЛОВ-спасбросков, атаки по цели с преимуществом. ТЕЛ не проваливается автоматически.")
    k.text("<b>Ослепление:</b> не видит; свои атаки с помехой, по цели — с преимуществом. <b>Глухота:</b> не слышит. Невозможность говорить сама по себе не оглушение.")
    k.heading("Несмертельный удар")
    k.text("По 2014: рукопашная атака снижает цель до 0 ХП — можно выбрать нокаут: без сознания и стабильна. Дополнительной помехи за этот выбор нет, с оружием или без. Уточнить домашние правила группы.")
    k.text("Это не автоматическое увечье. Ядовитые брызги и обратный дальний бросок не получают такое право от общего правила нокаута.")


def defenses(k):
    k.grid(["Спасбросок","Бонус","Владение"],[.52,.22,.26],[[a,bonus(MOD[a]+(PB if a in ('Сила','Ловкость') else 0)), 'Да' if a in ('Сила','Ловкость') else 'Нет'] for a in SCORES],row_mm=7)
    k.box("<b>Дух спокойствия / Spirit of Tranquility</b><br/>При спасброске за 1 ци добавить МДР +4. Не реакция. Английский текст не разрешает явно ждать объявления провала: момент заявления согласовать.")
    k.box("<b>Увёртливость / Evasion</b><br/>Только когда эффект даёт спасбросок ЛОВ для половины урона: успех — 0, провал — половина. Не любая проверка/атака и не любой спасбросок ЛОВ.")
    k.text(f"<b>Концентрация:</b> обычный ТЕЛ {bonus(CON)}, без владения; Дух спокойствия может добавить +4 за 1 ци. Преимущество юань-ти не даёт автоматически преимущество концентрации после урона от заклинания — не предполагать его без решения мастера.")
    k.heading("Чего пока нет")
    k.text("Purity of Body — с 13-го: владение ТЕЛ, иммунитет болезням и состоянию «отравлен», не всему урону ядом.")
    k.text("Purity of Mind — с 14-го, не на 12-м. Не добавлять автоматическое снятие страха/очарования.")
    k.text("Нет Slow Fall, Gentling Touch, Enhanced Grip, обычного лечения Открытой ладони на 36 ХП и автоматического Sanctuary. Персональный хоумбрю не выбран и не включён.")


def rests(k):
    k.heading("Восстановление")
    k.text("<b>Начало своего хода в бою:</b> +1 потраченное ци, если не недееспособна, максимум 16. Это не внебоевой источник бесконечного лечения.")
    k.text("<b>Короткий / долгий отдых:</b> всё ци при минимум 30 минутах медитации в составе отдыха. Короткий отдых также позволяет тратить оставшиеся кости хитов на лечение.")
    k.text(f"<b>Кость хитов:</b> 1к10 {bonus(CON)} ХП за потраченную кость. Всего 12к10; расход и остаток отмечай отдельно.")
    k.text("<b>Долгий отдых, базовые 2014:</b> всё ХП; восстановить потраченные кости хитов до половины общего числа — до 6, не сверх 12. Отработанные удары снова 4; Внушение снова доступно.")
    k.heading("Текущий ресурс")
    k.checks("Потраченные кости хитов · 12",12)
    k.text("Ци: ____ /16 · Отработанные: ____ /4<br/>Внушение: [ ] доступно [ ] использовано<br/>Седьмая техника: ____________________")
    k.lines("Действующие эффекты / кто наложил / до какого хода",4,7)
    k.lines("Практика на отдыхе / новая техника",2,7)


def tactics(k):
    k.heading("Выбери задачу, затем расход")
    k.text("<b>Экономно:</b> Атака ×2 + бесплатный удар. Все 3 попали без критов: 3к10 +18, до сопротивлений.")
    k.text("<b>Наступление:</b> Атака ×2 + шквал за 1 ци. Все 4 попали без критов: 4к10 +24. Это урон при попаданиях, не ожидаемый урон за ход.")
    k.text("<b>Контроль:</b> Stunning — ТЕЛ; Slowing — МДР; Crippling — ТЕЛ; Empowered — СИЛ. У всех Сл 16. Если цель уже почти побеждена, не расходуй контроль автоматически.")
    k.text("Отработанный удар полезен для экономии ци, но это 4 применения на долгий отдых; восстановление 1 ци за ход не возвращает их.")
    k.heading("Работа с союзниками")
    k.text("Партия по билду: магус; варвар Пути Великана; воин Мастер битвы; друид Круга Земли. Версия магуса не уточнена.")
    k.text("Перехватывай угрозы друиду. Перед отталкиванием проверь, не лишишь ли союзника удобной цели. Согласовывай опасные зоны по тексту конкретного заклинания.")
    k.text("Ничком не всегда выгодно атакующим с дистанции: преимущество только в пределах 5 фт, не просто в досягаемости длинного оружия.")
    k.heading("Не путай пределы")
    k.text("Техники контроля заканчиваются в НАЧАЛЕ следующего хода Сары, если не указано иное. Toppling Blow — до конца текущего хода цели. Отдельная техника раз за ход ≠ все техники вместе раз за ход.")
    k.text("Вид, размер и иммунитеты противника имеют значение. Описание перелома не обходит сопротивление и не добавляет состояние.")
    k.lines("Цель / заметные защиты / иммунитеты",2,6)


def notes(k):
    k.text("Сессия / дата: ______________________________")
    k.text("Место / группа: ____________________________")
    k.lines("NPC / обещания / долги",5,7)
    k.lines("Зацепки / источник / что знает Сара",5,7)
    k.heading("Перед следующей игрой")
    k.text("[ ] Отметить ресурсы и расходники.<br/>[ ] Подготовить седьмую технику.<br/>[ ] Уточнить компоненты и инструменты.<br/>[ ] Обновить заметки, не смешивая знания игрока и Сары.")
    k.fill_lines(7)


def reference(k):
    k.heading("Основа и расчёт")
    k.text("Ссаэйрра «Сара» Веларис · юань-ти MotM · Alternate Monk 12 · Way of the Open Hand · Преступник 2014. Без мультикласса и черт.")
    k.grid(["Характеристика","База","Итог"],[.56,.22,.22],[[a,str(BASE[a]),str(SCORES[a])] for a in SCORES],row_mm=6)
    k.text("Point buy: 0 +9 +7 +0 +7 +4 = 27.<br/>Раса: ЛОВ +1, МДР +2. Уровни 4/8: ЛОВ +2/+2; 12: МДР +2. ТЕЛ 19 только от амулета.")
    k.text(f"ХП: 10 +{CON} +11 ×(6 +{CON}) = {MAX_HP}.<br/>КД 10 +5 +4 =19; ци 12 +4 =16; Сл 8 +4 +4 =16.<br/>Безоружная: +5 +4 +1 =+10; урон к10 +5 +1.")
    k.heading("Набор техник")
    k.text("Фирменные 3: Empowered Strike, Stunning Strike, Indomitable Spirit.<br/>Свободные 7: Crippling Strike, Deflect Strike, Step of the Wind, Slowing Strike, Mantle of Courtesy, Mystic Regeneration + выбранная седьмая.")
    k.heading("Проверка источников · 17.11.2026")
    k.text('Класс: laserllama, Alternate Monk, основной английский документ. Номер редакции страницы не установлен.<br/><link href="https://www.gmbinder.com/share/-MhGHvc1sNLoUrISINrV">GM Binder: Alternate Monk</link>',size=7.8)
    k.text("Раса: Monsters of the Multiverse. Заклинания, Slow, бой и отдых — редакция 2014. Предметы: Amulet of Health; Insignia of Claws.",size=7.8)
    k.text("Согласовать: тайминг Spirit of Tranquility; повтор Slow; ловлю магических снарядов и затраты реакции. Персональные способности Сары не добавлены. Подробная сверка приложена отдельным Markdown.",size=7.8)


CARDS = [
    ("Бой и состояние",state), ("Действия и экономика",actions),
    ("Ударные техники",strikes), ("Реакции и контратаки",reactions),
    ("Движение, лечение, борьба",utility), ("Навыки и общение",social),
    ("Раса и заклинания",racial), ("Седьмая техника",preparation),
    ("Предметы и инвентарь",equipment), ("Контроль и нокаут",conditions),
    ("Спасброски и защита",defenses), ("Отдых и ресурсы",rests),
    ("Тактика и группа",tactics), ("Заметки сессии",notes),
    ("Основа и источники",reference), ("Продолжение заметок",notes),
]


def validate_data():
    cost={8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9}
    assert sum(cost[v] for v in BASE.values()) == 27
    assert (AC,DC,KI,ATTACK,DAMAGE)==(19,16,16,10,6)
    assert MAX_HP == (124 if SCORES['Телосложение']==19 else 100)
    assert len(SKILLS)==18 and len({x[0] for x in SKILLS})==18
    assert sum(x[2] for x in SKILLS)==5
    assert len(CARDS)%2==0
    assert SEVENTH in ('Deflect Missile','Heavenly Step','Aura Sight','Patient Defense')


def build_pdf(output_path, layout):
    global PAGE_W, PAGE_H, CARD_W, X_OFFSET, TOP
    validate_data()
    register_fonts()
    PAGE_W,PAGE_H = A5 if layout=='a5' else landscape(A4)
    CARD_W = A5[0]
    columns = 1 if layout=='a5' else 2
    X_OFFSET = (PAGE_W-columns*CARD_W)/2
    TOP = PAGE_H-18*mm
    output_path=Path(output_path).resolve()
    output_path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='sara_',suffix='.pdf',dir=output_path.parent)
    os.close(fd)
    temp_path=Path(tmp)
    try:
        c=canvas.Canvas(str(temp_path),pagesize=(PAGE_W,PAGE_H),pageCompression=1)
        c.setTitle(f'Сара Веларис — монах 12 — {layout.upper()}')
        c.setAuthor('Sara Character Sheet Generator')
        for start in range(0,len(CARDS),columns):
            if columns==2:
                c.setStrokeColor(colors.black)
                c.setLineWidth(.25)
                c.setDash(2,3)
                c.line(PAGE_W/2,5*mm,PAGE_W/2,PAGE_H-5*mm)
                c.setDash()
            for side in range(columns):
                idx=start+side
                title,builder=CARDS[idx]
                c.bookmarkPage(f'card_{idx+1}') if side==0 else None
                builder(Card(c,side,idx+1,title))
            c.showPage()
        c.save()
        if not temp_path.exists() or temp_path.stat().st_size==0:
            raise RuntimeError('PDF отсутствует или пуст')
        os.replace(temp_path,output_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return output_path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout',choices=['a5','a4','both'],default='both')
    parser.add_argument('--output-dir',type=Path,default=Path.cwd())
    parser.add_argument('--without-amulet',action='store_true')
    args=parser.parse_args()
    configure(not args.without_amulet)
    layouts=['a5','a4'] if args.layout=='both' else [args.layout]
    for layout in layouts:
        name='sara_level_12_a5.pdf' if layout=='a5' else 'sara_level_12_a4_2up.pdf'
        try:
            target=build_pdf(args.output_dir/name,layout)
        except PermissionError as exc:
            raise SystemExit('Закройте PDF в программе просмотра и повторите запуск.') from exc
        except LayoutError as exc:
            raise SystemExit(str(exc)) from exc
        pages=len(CARDS) if layout=='a5' else len(CARDS)//2
        print(f'Создан {target.name}: {pages} стр.; печать 100%, односторонняя.')

if __name__=='__main__':
    main()
