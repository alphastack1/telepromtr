import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, delimiter } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const releaseVersion = packageJson.version.replace(/\.0$/, "");

const candidates = {
  javaHome: [
    process.env.JAVA_HOME,
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "C:\\Program Files\\Android\\Android Studio\\jre"
  ].filter(Boolean),
  androidSdk: [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(process.env.LOCALAPPDATA || "", "Android", "Sdk")
  ].filter(Boolean)
};

const findFirst = (paths, test) => paths.find((path) => path && test(path));
const javaHome = findFirst(candidates.javaHome, (path) => existsSync(join(path, "bin", "java.exe")));
const androidSdk = findFirst(candidates.androidSdk, (path) => existsSync(join(path, "platform-tools")));

if (!javaHome) {
  throw new Error("Could not find Java. Install Android Studio or set JAVA_HOME.");
}

if (!androidSdk) {
  throw new Error("Could not find Android SDK. Install Android Studio or set ANDROID_HOME.");
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  PATH: [
    join(javaHome, "bin"),
    join(androidSdk, "platform-tools"),
    join(androidSdk, "cmdline-tools", "latest", "bin"),
    process.env.PATH || ""
  ].join(delimiter)
};

const run = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
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

console.log(`Using JAVA_HOME=${javaHome}`);
console.log(`Using ANDROID_HOME=${androidSdk}`);

await run("npm", ["run", "android:sync"]);
await run(process.platform === "win32" ? "gradlew.bat" : "./gradlew", ["assembleDebug"], {
  cwd: join(root, "android")
});

const sourceApk = join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const releaseDir = join(root, "release");
const artifactDir = join(releaseDir, "artifacts");
const releaseApk = join(releaseDir, "TELEPROMTR-android-debug.apk");
const artifactApk = join(artifactDir, `TELEPROMTR-v${releaseVersion}-android-debug.apk`);

await mkdir(releaseDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
await copyFile(sourceApk, releaseApk);
await copyFile(sourceApk, artifactApk);
console.log(`Wrote ${releaseApk}`);
console.log(`Wrote ${artifactApk}`);
