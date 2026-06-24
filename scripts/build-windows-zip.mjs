import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = require(resolve(root, "package.json"));
const releaseVersion = packageJson.version.replace(/\.0$/, "");

const packagedAppDir = resolve(root, "release", "TELEPROMTR-win32-x64");
const packagedAppExe = resolve(packagedAppDir, "TELEPROMTR.exe");
const zipFolderName = `TELEPROMTR-v${releaseVersion}-windows`;
const zipSourceDir = resolve(root, "release", zipFolderName);
const outDir = process.env.TELEPROMTR_WINDOWS_OUT_DIR
  ? resolve(root, process.env.TELEPROMTR_WINDOWS_OUT_DIR)
  : resolve(root, "release", "artifacts");
const outFile = resolve(outDir, `${zipFolderName}.zip`);

const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;

const run = (command, args) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });

if (!existsSync(packagedAppExe)) {
  throw new Error("Missing packaged Windows app. Run npm run package:win before building the zip.");
}

await mkdir(outDir, { recursive: true });
await rm(zipSourceDir, { recursive: true, force: true });
await rm(outFile, { force: true });
await cp(packagedAppDir, zipSourceDir, { recursive: true });

await run("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  [
    "$ErrorActionPreference = 'Stop'",
    `Compress-Archive -LiteralPath ${psQuote(zipSourceDir)} -DestinationPath ${psQuote(outFile)} -Force`
  ].join("; ")
]);

console.log(`Wrote ${outFile}`);
