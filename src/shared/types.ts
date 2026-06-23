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

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 900,
  height: 190
};
