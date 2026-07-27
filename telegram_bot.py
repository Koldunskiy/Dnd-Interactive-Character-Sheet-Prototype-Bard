import os

from dotenv import load_dotenv
from telegram import Update, ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

load_dotenv()

WEB_APP_URL = "https://dnd-interactive-character-sheet-prototype-bard.koldunskiymag.workers.dev"
BOT_TOKEN = os.getenv("BOT_TOKEN")
PROXY_URL = os.getenv("BOT_PROXY_URL", "socks5://127.0.0.1:2080")

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is not set in .env")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return

    keyboard = [[
        KeyboardButton(
            text="Открыть лист персонажа",
            web_app=WebAppInfo(url=WEB_APP_URL),
        )
    ]]

    markup = ReplyKeyboardMarkup(
        keyboard,
        resize_keyboard=True,
        is_persistent=True,
    )

    await update.message.reply_text(
        "Открой интерактивный лист персонажа:",
        reply_markup=markup,
    )


def main() -> None:
    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .proxy(PROXY_URL)
        .get_updates_proxy(PROXY_URL)
        .build()
    )

    app.add_handler(CommandHandler("start", start))
    app.run_polling()


if __name__ == "__main__":
    main()