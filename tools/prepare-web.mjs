import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  relative,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(projectRoot, "www");

if (dirname(webDir) !== projectRoot || basename(webDir) !== "www") {
  throw new Error(`Refusing to use unexpected web directory: ${webDir}`);
}

const runtimeDataFiles = [
  "data/character.js",
  "data/sara.js",
  "data/sara-lore.js",
  "data/monk-techniques.js",
  "data/monk-support-spells.js",
  "data/spell-library.js",
  "data/bard-spells.generated.js",
  "data/extra-spells.js"
];

const portraitFiles = [
  "assets/portrait.mp4",
  "assets/portrait.png"
];

const fontFiles = [
  "assets/fonts/CormorantGaramond-500.ttf",
  "assets/fonts/CormorantGaramond-600.ttf",
  "assets/fonts/CormorantGaramond-700.ttf",
  "assets/fonts/Inter-400.ttf",
  "assets/fonts/Inter-500.ttf",
  "assets/fonts/Inter-600.ttf",
  "assets/fonts/Inter-700.ttf",
  "assets/fonts/OFL-Cormorant-Garamond.txt",
  "assets/fonts/OFL-Inter.txt"
];

async function collectFiles(directory, extension) {
  const absoluteDirectory = resolve(projectRoot, directory);
  const found = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = resolve(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && extname(entry.name) === extension) {
        found.push(relative(projectRoot, absolutePath));
      }
    }
  }

  await visit(absoluteDirectory);
  return found.sort();
}

async function requireFiles(files) {
  for (const file of files) {
    let info;

    try {
      info = await lstat(resolve(projectRoot, file));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Required runtime file is missing: ${file}`, {
          cause: error
        });
      }
      throw error;
    }

    if (!info.isFile()) {
      throw new Error(`Required runtime path is not a file: ${file}`);
    }
  }
}

async function copyGroup(label, files) {
  for (const file of files) {
    const destination = resolve(webDir, file);

    if (!destination.startsWith(`${webDir}${sep}`)) {
      throw new Error(`Refusing to copy outside www: ${file}`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(projectRoot, file), destination);
  }

  console.log(`${label}: ${files.length} file(s)`);
}

const cssFiles = await collectFiles("styles", ".css");
const scriptFiles = await collectFiles("scripts", ".js");

const groups = [
  { label: "HTML and branding", files: ["index.html", "bardfav.png"] },
  { label: "CSS", files: cssFiles },
  { label: "JavaScript modules", files: scriptFiles },
  { label: "Runtime data", files: runtimeDataFiles },
  { label: "Portraits", files: portraitFiles },
  { label: "Fonts and licenses", files: fontFiles }
];

const allFiles = groups.flatMap((group) => group.files);
await requireFiles(allFiles);

const html = await readFile(resolve(projectRoot, "index.html"), "utf8");
if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
  throw new Error("index.html still references Google Fonts; refusing offline build.");
}

let existingWebDir;

try {
  existingWebDir = await lstat(webDir);
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

if (existingWebDir && (existingWebDir.isSymbolicLink() || !existingWebDir.isDirectory())) {
  throw new Error(`Refusing to replace non-directory or linked path: ${webDir}`);
}

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const group of groups) {
  await copyGroup(group.label, group.files);
}

console.log(`Prepared local Capacitor web assets: ${webDir}`);
