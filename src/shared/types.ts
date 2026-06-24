export type TextAlign = "left" | "center" | "right" | "justify";

export interface TelepromtrSettings {
  speed: number;
  countdownSeconds: number;
  loop: boolean;
  alwaysOnTop: boolean;
  windowOpacity: number;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  fontFamily: string;
  fontSize: number;
  autoFit: boolean;
  visibleLines: number;
  lineHeight: number;
  paragraphSpacing: number;
  letterSpacing: number;
  textAlign: TextAlign;
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface AppSnapshot {
  documentHtml: string;
  settings: TelepromtrSettings;
  windowState: WindowState;
}

export type PlaybackStatus = "playing" | "paused" | "starting";

export interface MenuSnapshot {
  settings: TelepromtrSettings;
  status: PlaybackStatus;
}

export type MenuCommand =
  | "toggle-playback"
  | "bold"
  | "italic"
  | "underline"
  | "new-script"
  | "open-script"
  | "export-script"
  | "reset-window"
  | "quit-app"
  | "hide-menu";

export interface MenuSettingPatch<K extends keyof TelepromtrSettings = keyof TelepromtrSettings> {
  key: K;
  value: TelepromtrSettings[K];
}

export interface MenuPosition {
  x: number;
  y: number;
}

export interface MenuShowPayload extends MenuPosition {
  snapshot: MenuSnapshot;
}

export interface ExportPayload {
  html: string;
  text: string;
}

export interface ImportResult {
  canceled: boolean;
  html?: string;
}

export interface TelepromtrBridge {
  loadState: () => Promise<AppSnapshot>;
  saveDocument: (documentHtml: string) => Promise<void>;
  saveSettings: (settings: TelepromtrSettings) => Promise<void>;
  moveWindowBy: (dx: number, dy: number) => Promise<void>;
  resetWindow: () => Promise<void>;
  importScript: () => Promise<ImportResult>;
  exportScript: (payload: ExportPayload) => Promise<{ canceled: boolean }>;
  showMenu: (payload: MenuShowPayload) => Promise<void>;
  updateMenuState: (snapshot: MenuSnapshot) => void;
  hideMenu: () => void;
  sendMenuCommand: (command: MenuCommand) => void;
  sendMenuSetting: <K extends keyof TelepromtrSettings>(patch: MenuSettingPatch<K>) => void;
  onMenuCommand: (listener: (command: MenuCommand) => void) => () => void;
  onMenuSetting: (listener: (patch: MenuSettingPatch) => void) => () => void;
  onMenuState: (listener: (snapshot: MenuSnapshot) => void) => () => void;
}

export const DEFAULT_DOCUMENT = `
<p>Welcome to TELEPROMTR.</p>
<p>Click once to edit. Right click for settings. Press Escape, then Space, to start or pause.</p>
<p>Drag and hold anywhere in the window to move it near your webcam.</p>
`;

export const DEFAULT_SETTINGS: TelepromtrSettings = {
  speed: 34,
  countdownSeconds: 3,
  loop: false,
  alwaysOnTop: false,
  windowOpacity: 1,
  backgroundColor: "#050505",
  textColor: "#f7f7f2",
  borderColor: "#343434",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  fontSize: 34,
  autoFit: true,
  visibleLines: 5,
  lineHeight: 1.22,
  paragraphSpacing: 0.35,
  letterSpacing: 0,
  textAlign: "center",
  mirrorX: false,
  mirrorY: false
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const numberSetting = (value: unknown, fallback: number, min: number, max: number, integer = false) => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = clamp(numeric, min, max);
  return integer ? Math.round(clamped) : clamped;
};

const booleanSetting = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const colorSetting = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

const stringSetting = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

const textAlignSetting = (value: unknown): TextAlign =>
  value === "left" || value === "center" || value === "right" || value === "justify"
    ? value
    : DEFAULT_SETTINGS.textAlign;

export const normalizeSettings = (settings?: Partial<TelepromtrSettings>): TelepromtrSettings => {
  const source = settings || {};

  return {
    speed: numberSetting(source.speed, DEFAULT_SETTINGS.speed, 1, 140, true),
    countdownSeconds: numberSetting(source.countdownSeconds, DEFAULT_SETTINGS.countdownSeconds, 0, 10, true),
    loop: booleanSetting(source.loop, DEFAULT_SETTINGS.loop),
    alwaysOnTop: booleanSetting(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    windowOpacity: numberSetting(source.windowOpacity, DEFAULT_SETTINGS.windowOpacity, 0.45, 1),
    backgroundColor: colorSetting(source.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
    textColor: colorSetting(source.textColor, DEFAULT_SETTINGS.textColor),
    borderColor: colorSetting(source.borderColor, DEFAULT_SETTINGS.borderColor),
    fontFamily: stringSetting(source.fontFamily, DEFAULT_SETTINGS.fontFamily),
    fontSize: numberSetting(source.fontSize, DEFAULT_SETTINGS.fontSize, 16, 120, true),
    autoFit: booleanSetting(source.autoFit, DEFAULT_SETTINGS.autoFit),
    visibleLines: numberSetting(source.visibleLines, DEFAULT_SETTINGS.visibleLines, 2, 9, true),
    lineHeight: numberSetting(source.lineHeight, DEFAULT_SETTINGS.lineHeight, 0.9, 1.8),
    paragraphSpacing: numberSetting(source.paragraphSpacing, DEFAULT_SETTINGS.paragraphSpacing, 0, 1.6),
    letterSpacing: numberSetting(source.letterSpacing, DEFAULT_SETTINGS.letterSpacing, 0, 6),
    textAlign: textAlignSetting(source.textAlign),
    mirrorX: booleanSetting(source.mirrorX, DEFAULT_SETTINGS.mirrorX),
    mirrorY: booleanSetting(source.mirrorY, DEFAULT_SETTINGS.mirrorY)
  };
};

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 900,
  height: 190
};
