import { DEFAULT_SETTINGS, type MenuSnapshot, type TelepromtrBridge, type TelepromtrSettings, type TextAlign } from "../shared/types";

declare global {
  interface Window {
    telepromtr: TelepromtrBridge;
  }
}

let settings: TelepromtrSettings = { ...DEFAULT_SETTINGS };
let status: MenuSnapshot["status"] = "paused";

const playToggle = document.querySelector<HTMLButtonElement>("#playToggle")!;
const menuStatus = document.querySelector<HTMLDivElement>("#menuStatus")!;

const sendSetting = <K extends keyof TelepromtrSettings>(key: K, value: TelepromtrSettings[K]) => {
  settings = { ...settings, [key]: value };
  syncControls();
  window.telepromtr.sendMenuSetting({ key, value });
};

const setRangeValue = (id: string, value: string | number, label: string) => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  const output = document.querySelector<HTMLOutputElement>(`#${id}Value`);
  if (input && document.activeElement !== input) {
    input.value = String(value);
  }
  if (output) {
    output.textContent = label;
  }
};

const setChecked = (id: string, value: boolean) => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (input && input.checked !== value) {
    input.checked = value;
  }
};

const setValue = (id: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (input && document.activeElement !== input) {
    input.value = value;
  }
};

const syncControls = () => {
  setRangeValue("speed", settings.speed, `${settings.speed}px/s`);
  setRangeValue("countdownSeconds", settings.countdownSeconds, `${settings.countdownSeconds}s`);
  setRangeValue("windowOpacity", settings.windowOpacity, `${Math.round(settings.windowOpacity * 100)}%`);
  setRangeValue("visibleLines", settings.visibleLines, `${settings.visibleLines}`);
  setRangeValue("fontSize", settings.fontSize, `${settings.fontSize}px`);
  setRangeValue("lineHeight", settings.lineHeight, settings.lineHeight.toFixed(2));
  setRangeValue("paragraphSpacing", settings.paragraphSpacing, `${settings.paragraphSpacing.toFixed(2)}em`);
  setRangeValue("letterSpacing", settings.letterSpacing, `${settings.letterSpacing.toFixed(1)}px`);

  setChecked("loop", settings.loop);
  setChecked("alwaysOnTop", settings.alwaysOnTop);
  setChecked("autoFit", settings.autoFit);
  setChecked("mirrorX", settings.mirrorX);
  setChecked("mirrorY", settings.mirrorY);
  setValue("fontFamily", settings.fontFamily);
  setValue("textColor", settings.textColor);
  setValue("backgroundColor", settings.backgroundColor);
  setValue("borderColor", settings.borderColor);

  document.querySelectorAll<HTMLButtonElement>(".align-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.align === settings.textAlign);
  });

  playToggle.textContent = status === "playing" || status === "starting" ? "Pause" : "Play";
  menuStatus.textContent = status === "starting" ? "Starting" : status === "playing" ? "Playing" : "Paused";
};

const bindRange = <K extends keyof TelepromtrSettings>(
  id: string,
  key: K,
  parse: (value: string) => TelepromtrSettings[K]
) => {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input", (event) => {
    sendSetting(key, parse((event.currentTarget as HTMLInputElement).value));
  });
};

const bindCheckbox = <K extends keyof TelepromtrSettings>(id: string, key: K) => {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input", (event) => {
    sendSetting(key, (event.currentTarget as HTMLInputElement).checked as TelepromtrSettings[K]);
  });
};

const bindTextInput = <K extends keyof TelepromtrSettings>(id: string, key: K) => {
  document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!.addEventListener("input", (event) => {
    sendSetting(key, (event.currentTarget as HTMLInputElement).value as TelepromtrSettings[K]);
  });
};

const wireControls = () => {
  playToggle.addEventListener("click", () => window.telepromtr.sendMenuCommand("toggle-playback"));

  bindRange("speed", "speed", Number);
  bindRange("countdownSeconds", "countdownSeconds", Number);
  bindRange("windowOpacity", "windowOpacity", Number);
  bindRange("visibleLines", "visibleLines", Number);
  bindRange("fontSize", "fontSize", Number);
  bindRange("lineHeight", "lineHeight", Number);
  bindRange("paragraphSpacing", "paragraphSpacing", Number);
  bindRange("letterSpacing", "letterSpacing", Number);

  bindCheckbox("loop", "loop");
  bindCheckbox("alwaysOnTop", "alwaysOnTop");
  bindCheckbox("autoFit", "autoFit");
  bindCheckbox("mirrorX", "mirrorX");
  bindCheckbox("mirrorY", "mirrorY");

  bindTextInput("fontFamily", "fontFamily");
  bindTextInput("textColor", "textColor");
  bindTextInput("backgroundColor", "backgroundColor");
  bindTextInput("borderColor", "borderColor");

  document.querySelectorAll<HTMLButtonElement>(".align-button").forEach((button) => {
    button.addEventListener("click", () => sendSetting("textAlign", button.dataset.align as TextAlign));
  });

  document.querySelector<HTMLButtonElement>("#bold")!.addEventListener("click", () => window.telepromtr.sendMenuCommand("bold"));
  document.querySelector<HTMLButtonElement>("#italic")!.addEventListener("click", () => window.telepromtr.sendMenuCommand("italic"));
  document
    .querySelector<HTMLButtonElement>("#underline")!
    .addEventListener("click", () => window.telepromtr.sendMenuCommand("underline"));

  document
    .querySelector<HTMLButtonElement>("#newScript")!
    .addEventListener("click", () => window.telepromtr.sendMenuCommand("new-script"));
  document
    .querySelector<HTMLButtonElement>("#openScript")!
    .addEventListener("click", () => window.telepromtr.sendMenuCommand("open-script"));
  document
    .querySelector<HTMLButtonElement>("#exportScript")!
    .addEventListener("click", () => window.telepromtr.sendMenuCommand("export-script"));
  document
    .querySelector<HTMLButtonElement>("#resetWindow")!
    .addEventListener("click", () => window.telepromtr.sendMenuCommand("reset-window"));
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.telepromtr.hideMenu();
  }
});

window.telepromtr.onMenuState((snapshot) => {
  settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
  status = snapshot.status;
  syncControls();
});

wireControls();
syncControls();
