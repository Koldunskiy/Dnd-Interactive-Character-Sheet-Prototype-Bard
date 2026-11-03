import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const linkerScript = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import vm from "node:vm";
  import { fileURLToPath, pathToFileURL } from "node:url";

  const rootPath = process.cwd();
  const context = vm.createContext({});
  const modules = new Map();

  async function loadModule(fileUrl) {
    const canonicalUrl = new URL(fileUrl).href;
    if (!modules.has(canonicalUrl)) {
      modules.set(canonicalUrl, (async () => {
        const source = await fs.readFile(fileURLToPath(canonicalUrl), "utf8");
        return new vm.SourceTextModule(source, {
          context,
          identifier: canonicalUrl,
        });
      })());
    }
    return modules.get(canonicalUrl);
  }

  function assertAllowedLocalSource(fileUrl) {
    const url = new URL(fileUrl);
    if (url.protocol !== "file:") {
      throw new Error("Non-local module import is not allowed: " + fileUrl);
    }
    const relativePath = path.relative(rootPath, fileURLToPath(url));
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("Module import escapes repository root: " + fileUrl);
    }
  }

  const entryUrl = pathToFileURL(path.resolve(rootPath, "scripts/app.js"));
  const entry = await loadModule(entryUrl.href);
  await entry.link(async (specifier, referencingModule) => {
    if (!specifier.startsWith(".")) {
      throw new Error("Unexpected non-relative import: " + specifier);
    }
    const targetUrl = new URL(specifier, referencingModule.identifier);
    assertAllowedLocalSource(targetUrl.href);
    return loadModule(targetUrl.href);
  });
  console.log("Linked static entry graph without evaluation.");
`;

test("scripts/app.js static ESM dependency graph links without evaluation", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-vm-modules",
    "--input-type=module",
    "-e",
    linkerScript,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30000,
  });

  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `Entry graph linking failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /Linked static entry graph without evaluation\./);
});
