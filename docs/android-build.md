# Сборка личной Android APK

## Выбранный стек

- Node.js 22 или новее; текущая проверенная в проекте среда — Node.js 22.14.0.
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`: 8.0.0.
- Android Studio 2025.2.1 или новее.
- JDK 21; для Gradle CLI используйте `JAVA_HOME`, заданный в текущей PowerShell-сессии.
- Android SDK Platform 36 и Build-Tools 36.0.0.

Capacitor требует Node.js 22+. Capacitor Android 8.x поддерживает target SDK 36 и Android API 24+. Android Studio должна включать Android SDK и установленный JDK. Проверяйте фактические Gradle/AGP версии созданного шаблона командами ниже, не меняйте их вручную для этой задачи. Проверенный шаблон использовал Gradle 8.14.3, AGP 8.13.0 и SDK 36; первая Gradle-сборка дополнительно затребовала Build-Tools 35.0.0, которые Gradle установил автоматически по уже принятой SDK-лицензии. Если на другой машине появится запрос новой лицензии, принимайте её вручную в Android Studio.

Источники:

- Capacitor environment setup: https://capacitorjs.com/docs/getting-started/environment-setup
- Добавление Capacitor в существующий проект: https://capacitorjs.com/docs/getting-started
- Android target SDK: https://capacitorjs.com/docs/android/setting-target-sdk
- Gradle 8.14 compatibility: https://docs.gradle.org/8.14/userguide/compatibility.html
- Node.js downloads: https://nodejs.org/en/download

## Назначение `www`

`www/` — пересоздаваемый локальный web-каталог Capacitor, а не исходник приложения. После изменений HTML/CSS/JavaScript/ресурсов запускайте `npm run prepare:web` до синхронизации. Скрипт копирует выбранные runtime-файлы с сохранением структуры, не запускает Python-генераторы и удаляет только `www/`.

Локальные шрифты должны находиться в `assets/fonts/`; если обязательного файла нет, подготовка `www` завершится ошибкой. Google Fonts в собранном HTML не используются.

## Первый запуск в PowerShell

Команды выполнять из корня проекта. Установите Node.js, Android Studio и SDK отдельно; установите в SDK Manager Android Platform 36, Build-Tools 36.0.0, Platform-Tools и Command-line Tools. Примите SDK-лицензии вручную в Android Studio.

Установить Java и SDK-пути только для текущей PowerShell-сессии:

```powershell
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path

$nodeVersion = node --version
if ($LASTEXITCODE -ne 0) { throw 'node --version failed.' }
if ($nodeVersion -ne 'v22.14.0') {
  throw "Expected the validated project runtime v22.14.0; found $nodeVersion."
}

npm --version
if ($LASTEXITCODE -ne 0) { throw 'npm --version failed.' }

& (Join-Path $env:JAVA_HOME 'bin\java.exe') -version
if ($LASTEXITCODE -ne 0) { throw 'JDK java -version failed.' }

$sdkmanager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $sdkmanager)) {
  throw "Android SDK Command-line Tools not found: $sdkmanager"
}
```

Получить и проверить локальные шрифты:

```powershell
.\tools\get-fonts.ps1
if ($LASTEXITCODE -ne 0) { throw 'Font download/validation failed.' }
```

Установить зафиксированные зависимости и сгенерировать lockfile:

```powershell
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
```

Подготовить runtime web assets:

```powershell
npm run prepare:web
if ($LASTEXITCODE -ne 0) { throw 'prepare:web failed; sync was not run.' }
```

Создать Android-проект только если он ещё не существует:

```powershell
if (Test-Path -LiteralPath '.\android') {
  throw 'android/ already exists; do not run cap add again.'
}
node_modules\.bin\cap.cmd add android
if ($LASTEXITCODE -ne 0) { throw 'cap add android failed.' }
```

Проверить wrapper и JVM, синхронизировать приложение, затем проверить конфигурацию:

```powershell
Push-Location .\android
try {
  .\gradlew.bat --version
  if ($LASTEXITCODE -ne 0) { throw 'gradlew --version failed.' }
} finally {
  Pop-Location
}

node_modules\.bin\cap.cmd sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed; build was not run.' }

node_modules\.bin\cap.cmd doctor
if ($LASTEXITCODE -ne 0) { throw 'cap doctor failed.' }
```

Собрать debug APK:

```powershell
Push-Location .\android
try {
  .\gradlew.bat --version
  if ($LASTEXITCODE -ne 0) { throw 'gradlew --version failed.' }

  .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { throw 'assembleDebug failed.' }
} finally {
  Pop-Location
}

Get-Item .\android\app\build\outputs\apk\debug\app-debug.apk |
  Select-Object FullName, Length, LastWriteTime
```

Ожидаемый APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Повторная сборка после изменения веб-файлов

Не запускайте `cap add android` повторно.

```powershell
npm run prepare:web
if ($LASTEXITCODE -ne 0) { throw 'prepare:web failed; sync was not run.' }

node_modules\.bin\cap.cmd sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed; build was not run.' }

Push-Location .\android
try {
  .\gradlew.bat --version
  if ($LASTEXITCODE -ne 0) { throw 'gradlew --version failed.' }

  .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { throw 'assembleDebug failed.' }
} finally {
  Pop-Location
}

Get-Item .\android\app\build\outputs\apk\debug\app-debug.apk |
  Select-Object FullName, Length, LastWriteTime
```

Если менялись зависимости `package.json`, сначала выполните `npm install`.

## Ограничения v1

- Начальное состояние берётся из `data/character.js`; импорт состояния веб-версии не предусмотрен.
- Последующие изменения остаются в существующем `localStorage` под ключом `aurelia-character-sheet:v2`.
- Пользовательское медиа отображается временно и не сохраняется после перезапуска.
- Шрифты и встроенные портреты поставляются локально.
- Сервер, аккаунты, облачная синхронизация, release signing, публикация и Play Store не входят в scope.
- Ссылки `sourceUrl` в данных заклинаний являются внешними ссылками, но не runtime-запросами приложения.

## Ручная проверка на Pixel 9a / Android 17

1. Установить debug APK и запустить приложение.
2. Проверить шесть разделов: профиль, бой, заклинания, инвентарь, лор и библиотеку заклинаний.
3. Включить авиарежим; проверить локальные шрифты, встроенные PNG и MP4.
4. Изменить HP и ресурс, полностью закрыть приложение, открыть снова и проверить сохранение.
5. Проверить навигацию и основные действия, включая отсутствие критичного перекрытия системными панелями.
6. Убедиться, что отсутствие Telegram SDK не препятствует запуску.

## Что вернуть Orchestrator

- Вывод `node --version`, `npm --version`, Java и `gradlew.bat --version`.
- Вывод `npm run prepare:web`, `cap sync`, `cap doctor` и `assembleDebug`.
- Установленные SDK Platform/Build-Tools и значения SDK в созданном Android-проекте.
- Полный путь APK, размер и время изменения.
- Результаты ручных проверок на Pixel, в том числе офлайн-работы и сохранения после перезапуска.

Сборка debug APK не подтверждает установку или корректную работу на устройстве. AC-09—AC-14 требуют выполнения команд и фактической проверки.
