import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "main"), { recursive: true });
await mkdir(resolve(dist, "preload"), { recursive: true });
await mkdir(resolve(dist, "renderer"), { recursive: true });
await mkdir(resolve(dist, "menu"), { recursive: true });
await mkdir(resolve(dist, "mobile"), { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "info"
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: [resolve(root, "src/main/main.ts")],
    outfile: resolve(dist, "main/main.js"),
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["electron"]
  }),
  esbuild.build({
    ...common,
    entryPoints: [resolve(root, "src/preload/preload.ts")],
    outfile: resolve(dist, "preload/preload.js"),
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["electron"]
  }),
  esbuild.build({
    ...common,
    entryPoints: [resolve(root, "src/renderer/renderer.ts")],
    outfile: resolve(dist, "renderer/renderer.js"),
    platform: "browser",
    target: "chrome124",
    format: "iife"
  }),
  esbuild.build({
    ...common,
    entryPoints: [resolve(root, "src/menu/menu.ts")],
    outfile: resolve(dist, "menu/menu.js"),
    platform: "browser",
    target: "chrome124",
    format: "iife"
  }),
  esbuild.build({
    ...common,
    entryPoints: [resolve(root, "src/mobile/mobile.ts")],
    outfile: resolve(dist, "mobile/mobile.js"),
    platform: "browser",
    target: "chrome124",
    format: "iife"
  }),
  copyFile(resolve(root, "src/renderer/index.html"), resolve(dist, "renderer/index.html")),
  copyFile(resolve(root, "src/renderer/styles.css"), resolve(dist, "renderer/styles.css")),
  copyFile(resolve(root, "src/menu/index.html"), resolve(dist, "menu/index.html")),
  copyFile(resolve(root, "src/menu/styles.css"), resolve(dist, "menu/styles.css")),
  copyFile(resolve(root, "src/mobile/index.html"), resolve(dist, "mobile/index.html")),
  copyFile(resolve(root, "src/mobile/styles.css"), resolve(dist, "mobile/styles.css"))
]);
