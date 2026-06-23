import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSnapshot,
  ExportPayload,
  ImportResult,
  MenuCommand,
  MenuSettingPatch,
  MenuShowPayload,
  MenuSnapshot,
  TelepromtrSettings
} from "../shared/types";

const on = <T>(channel: string, listener: (payload: T) => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld("telepromtr", {
  loadState: (): Promise<AppSnapshot> => ipcRenderer.invoke("state:load"),
  saveDocument: (documentHtml: string): Promise<void> =>
    ipcRenderer.invoke("state:save-document", documentHtml),
  saveSettings: (settings: TelepromtrSettings): Promise<void> =>
    ipcRenderer.invoke("state:save-settings", settings),
  moveWindowBy: (dx: number, dy: number): Promise<void> =>
    ipcRenderer.invoke("window:move-by", { dx, dy }),
  resetWindow: (): Promise<void> => ipcRenderer.invoke("window:reset"),
  importScript: (): Promise<ImportResult> => ipcRenderer.invoke("script:import"),
  exportScript: (payload: ExportPayload): Promise<{ canceled: boolean }> =>
    ipcRenderer.invoke("script:export", payload),
  showMenu: (payload: MenuShowPayload): Promise<void> => ipcRenderer.invoke("menu:show", payload),
  updateMenuState: (snapshot: MenuSnapshot): void => ipcRenderer.send("menu:update-state", snapshot),
  hideMenu: (): void => ipcRenderer.send("menu:hide"),
  sendMenuCommand: (command: MenuCommand): void => ipcRenderer.send("menu:command", command),
  sendMenuSetting: (patch: MenuSettingPatch): void => ipcRenderer.send("menu:setting", patch),
  onMenuCommand: (listener: (command: MenuCommand) => void): (() => void) =>
    on<MenuCommand>("menu:command", listener),
  onMenuSetting: (listener: (patch: MenuSettingPatch) => void): (() => void) =>
    on<MenuSettingPatch>("menu:setting", listener),
  onMenuState: (listener: (snapshot: MenuSnapshot) => void): (() => void) =>
    on<MenuSnapshot>("menu:state", listener)
});
