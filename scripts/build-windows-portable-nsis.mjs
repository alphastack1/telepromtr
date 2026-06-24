import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
const iconPath = resolve(root, "assets", "app", "telepromtr.ico");
const outDir = process.env.TELEPROMTR_PORTABLE_OUT_DIR
  ? resolve(root, process.env.TELEPROMTR_PORTABLE_OUT_DIR)
  : resolve(root, "release", "artifacts");
const outFile = resolve(outDir, `TELEPROMTR-v${releaseVersion}-windows.exe`);
const scriptFile = resolve(outDir, "telepromtr-portable.nsi");

const q = (value) => `"${value}"`;

const run = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      ...options
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
  throw new Error("Missing packaged Windows app. Run npm run package:win before building the portable exe.");
}

await mkdir(outDir, { recursive: true });
await rm(outFile, { force: true });

const { getMakeNsisPath } = require("app-builder-lib/out/toolsets/windows");
const makensis = await getMakeNsisPath(null, null);

const tempDir = `$TEMP\\TELEPROMTR-v${releaseVersion}`;
const sourceGlob = `${packagedAppDir}\\*.*`;
const appExe = `${tempDir}\\TELEPROMTR.exe`;
const readyFile = `${tempDir}\\.telepromtr-ready`;

const script = `
Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow
SetCompressor /SOLID lzma
CRCCheck on

Name "TELEPROMTR"
OutFile ${q(outFile)}
Icon ${q(iconPath)}

VIProductVersion "${packageJson.version}.0"
VIAddVersionKey /LANG=1033 "ProductName" "TELEPROMTR"
VIAddVersionKey /LANG=1033 "FileDescription" "TELEPROMTR portable launcher"
VIAddVersionKey /LANG=1033 "FileVersion" "${packageJson.version}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${packageJson.version}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "MIT"

Section
  IfFileExists "${appExe}" 0 unpack
  IfFileExists "${readyFile}" launch unpack

  unpack:
    Banner::show /NOUNLOAD "Starting TELEPROMTR..."
    RMDir /r "${tempDir}"
    CreateDirectory "${tempDir}"
    SetOutPath "${tempDir}"
    File /r ${q(sourceGlob)}
    FileOpen $0 "${readyFile}" w
    FileWrite $0 "${packageJson.version}"
    FileClose $0
    Banner::destroy

  launch:
  Exec ${q(appExe)}
SectionEnd
`;

await writeFile(scriptFile, script.trimStart(), "utf8");
await run(makensis.path, ["-INPUTCHARSET", "UTF8", scriptFile], {
  env: { ...process.env, ...(makensis.env || {}) }
});

console.log(`Wrote ${outFile}`);
