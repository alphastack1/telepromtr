import { app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_DOCUMENT,
  DEFAULT_SETTINGS,
  DEFAULT_WINDOW_STATE,
  type AppSnapshot,
  type ExportPayload,
  type MenuCommand,
  type MenuSettingPatch,
  type MenuShowPayload,
  type MenuSnapshot,
  type TelepromtrSettings,
  type WindowState
} from "../shared/types";

interface StoredState {
  documentHtml?: string;
  settings?: Partial<TelepromtrSettings>;
  windowState?: Partial<WindowState>;
}

let mainWindow: BrowserWindow | null = null;
let menuWindow: BrowserWindow | null = null;
let currentSnapshot: AppSnapshot = {
  documentHtml: DEFAULT_DOCUMENT,
  settings: { ...DEFAULT_SETTINGS },
  windowState: { ...DEFAULT_WINDOW_STATE }
};

const dataFile = () => join(app.getPath("userData"), "telepromtr-data.json");
const appIcon = () => join(__dirname, "../../assets/app/telepromtr-icon.png");
const menuSize = { width: 390, height: 650 };

const mergeSnapshot = (stored?: StoredState): AppSnapshot => ({
  documentHtml: stored?.documentHtml || DEFAULT_DOCUMENT,
  settings: {
    ...DEFAULT_SETTINGS,
    ...(stored?.settings || {})
  },
  windowState: {
    ...DEFAULT_WINDOW_STATE,
    ...(stored?.windowState || {})
  }
});

const loadSnapshot = async () => {
  const file = dataFile();
  if (!existsSync(file)) {
    currentSnapshot = mergeSnapshot();
    return currentSnapshot;
  }

  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as StoredState;
    currentSnapshot = mergeSnapshot(parsed);
  } catch {
    currentSnapshot = mergeSnapshot();
  }

  return currentSnapshot;
};

const saveSnapshot = async () => {
  const file = dataFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(currentSnapshot, null, 2), "utf8");
};

const clampBounds = (bounds: WindowState): Required<WindowState> => {
  const nearest = screen.getDisplayMatching({
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
    width: bounds.width,
    height: bounds.height
  });
  const area = nearest.workArea;
  const width = Math.max(320, Math.min(bounds.width, area.width));
  const height = Math.max(80, Math.min(bounds.height, area.height));
  const fallbackX = area.x + Math.round((area.width - width) / 2);
  const fallbackY = area.y + 16;
  const x = Math.min(Math.max(bounds.x ?? fallbackX, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y ?? fallbackY, area.y), area.y + area.height - height);

  return { x, y, width, height };
};

const rememberWindowState = () => {
  if (!mainWindow) {
    return;
  }

  const bounds = mainWindow.getBounds();
  currentSnapshot.windowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  void saveSnapshot();
};

const applyWindowSettings = (settings: TelepromtrSettings) => {
  if (!mainWindow) {
    return;
  }

  mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  mainWindow.setOpacity(settings.windowOpacity);
  if (menuWindow) {
    menuWindow.setAlwaysOnTop(settings.alwaysOnTop);
  }
};

const clampMenuPosition = (payload: MenuShowPayload) => {
  const display = screen.getDisplayNearestPoint({ x: payload.x, y: payload.y });
  const area = display.workArea;
  const x = Math.min(Math.max(payload.x + 10, area.x + 6), area.x + area.width - menuSize.width - 6);
  const y = Math.min(Math.max(payload.y + 10, area.y + 6), area.y + area.height - menuSize.height - 6);
  return { x, y };
};

const createMenuWindow = async () => {
  if (menuWindow) {
    return menuWindow;
  }

  menuWindow = new BrowserWindow({
    width: menuSize.width,
    height: menuSize.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    icon: appIcon(),
    title: "TELEPROMTR Settings",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  menuWindow.on("blur", () => {
    menuWindow?.hide();
  });

  menuWindow.on("closed", () => {
    menuWindow = null;
  });

  await menuWindow.loadFile(join(__dirname, "../menu/index.html"));
  return menuWindow;
};

const sendMenuState = (snapshot: MenuSnapshot) => {
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.webContents.send("menu:state", snapshot);
  }
};

const createWindow = async () => {
  await loadSnapshot();
  const bounds = clampBounds(currentSnapshot.windowState);

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 80,
    frame: false,
    hasShadow: true,
    resizable: true,
    movable: true,
    backgroundColor: currentSnapshot.settings.backgroundColor,
    icon: appIcon(),
    title: "TELEPROMTR",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyWindowSettings(currentSnapshot.settings);

  mainWindow.on("resized", rememberWindowState);
  mainWindow.on("moved", () => {
    if (!mainWindow) {
      return;
    }

    const clamped = clampBounds(mainWindow.getBounds());
    const boundsNow = mainWindow.getBounds();
    if (clamped.x !== boundsNow.x || clamped.y !== boundsNow.y) {
      mainWindow.setBounds(clamped);
    }
    rememberWindowState();
  });

  mainWindow.on("closed", () => {
    menuWindow?.close();
    mainWindow = null;
  });

  await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
};

ipcMain.handle("state:load", async () => {
  await loadSnapshot();
  return currentSnapshot;
});

ipcMain.handle("state:save-document", async (_event, documentHtml: string) => {
  currentSnapshot.documentHtml = documentHtml;
  await saveSnapshot();
});

ipcMain.handle("state:save-settings", async (_event, settings: TelepromtrSettings) => {
  currentSnapshot.settings = { ...DEFAULT_SETTINGS, ...settings };
  applyWindowSettings(currentSnapshot.settings);
  await saveSnapshot();
});

ipcMain.handle("menu:show", async (_event, payload: MenuShowPayload) => {
  const menu = await createMenuWindow();
  const position = clampMenuPosition(payload);
  menu.setBounds({ ...position, ...menuSize });
  menu.setAlwaysOnTop(currentSnapshot.settings.alwaysOnTop);
  menu.show();
  menu.focus();
  sendMenuState(payload.snapshot);
});

ipcMain.on("menu:hide", () => {
  menuWindow?.hide();
});

ipcMain.on("menu:update-state", (_event, snapshot: MenuSnapshot) => {
  if (menuWindow?.isVisible()) {
    sendMenuState(snapshot);
  }
});

ipcMain.on("menu:command", (_event, command: MenuCommand) => {
  if (command === "hide-menu") {
    menuWindow?.hide();
    return;
  }

  mainWindow?.webContents.send("menu:command", command);
});

ipcMain.on("menu:setting", (_event, patch: MenuSettingPatch) => {
  mainWindow?.webContents.send("menu:setting", patch);
});

ipcMain.handle("window:move-by", (_event, delta: { dx: number; dy: number }) => {
  if (!mainWindow) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const clamped = clampBounds({
    ...bounds,
    x: bounds.x + Math.round(delta.dx),
    y: bounds.y + Math.round(delta.dy)
  });
  mainWindow.setBounds(clamped);
});

ipcMain.handle("window:reset", () => {
  if (!mainWindow) {
    return;
  }

  const primary = screen.getPrimaryDisplay().workArea;
  const width = Math.min(DEFAULT_WINDOW_STATE.width, primary.width);
  const height = Math.min(DEFAULT_WINDOW_STATE.height, primary.height);
  mainWindow.setBounds({
    width,
    height,
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + 16
  });
  rememberWindowState();
});

ipcMain.handle("script:import", async () => {
  if (!mainWindow) {
    return { canceled: true };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Script",
    properties: ["openFile"],
    filters: [
      { name: "Scripts", extensions: ["txt", "md", "html", "htm"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const text = await readFile(filePath, "utf8");
  const html = /\.(html|htm)$/i.test(filePath)
    ? text
    : text
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("");

  currentSnapshot.documentHtml = html;
  await saveSnapshot();
  return { canceled: false, html };
});

ipcMain.handle("script:export", async (_event, payload: ExportPayload) => {
  if (!mainWindow) {
    return { canceled: true };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export Script",
    defaultPath: "telepromtr-script.txt",
    filters: [
      { name: "Plain Text", extensions: ["txt"] },
      { name: "HTML", extensions: ["html"] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const content = /\.html?$/i.test(result.filePath) ? payload.html : payload.text;
  await writeFile(result.filePath, content, "utf8");
  return { canceled: false };
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

app.setName("TELEPROMTR");

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
