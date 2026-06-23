import { DEFAULT_DOCUMENT, DEFAULT_SETTINGS, type TelepromtrSettings } from "../shared/types";

interface MobileSettings extends TelepromtrSettings {
  boxHeight: number;
  cameraEnabled: boolean;
  cameraMirror: boolean;
}

const DEFAULT_MOBILE_SETTINGS: MobileSettings = {
  ...DEFAULT_SETTINGS,
  backgroundColor: "#050505",
  borderColor: "#343434",
  boxHeight: 30,
  cameraEnabled: false,
  cameraMirror: true
};

const STORAGE_KEY = "telepromtr.mobile.v1";

const app = document.querySelector<HTMLDivElement>("#app")!;
const camera = document.querySelector<HTMLVideoElement>("#camera")!;
const promptBox = document.querySelector<HTMLElement>("#promptBox")!;
const scrollport = document.querySelector<HTMLDivElement>("#scrollport")!;
const editor = document.querySelector<HTMLDivElement>("#editor")!;
const countdown = document.querySelector<HTMLDivElement>("#countdown")!;
const playToggle = document.querySelector<HTMLButtonElement>("#playToggle")!;
const cameraToggle = document.querySelector<HTMLButtonElement>("#cameraToggle")!;
const settingsToggle = document.querySelector<HTMLButtonElement>("#settingsToggle")!;
const settingsSheet = document.querySelector<HTMLElement>("#settingsSheet")!;
const closeSettings = document.querySelector<HTMLButtonElement>("#closeSettings")!;
const status = document.querySelector<HTMLDivElement>("#status")!;

let settings: MobileSettings = { ...DEFAULT_MOBILE_SETTINGS };
let isPlaying = false;
let isCountingDown = false;
let animationFrame = 0;
let lastTick = 0;
let saveTimer: number | undefined;
let stream: MediaStream | null = null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as {
      documentHtml?: string;
      settings?: Partial<MobileSettings>;
    };
    settings = { ...DEFAULT_MOBILE_SETTINGS, ...(saved.settings || {}) };
    editor.innerHTML = sanitizeHtml(saved.documentHtml || DEFAULT_DOCUMENT);
  } catch {
    settings = { ...DEFAULT_MOBILE_SETTINGS };
    editor.innerHTML = sanitizeHtml(DEFAULT_DOCUMENT);
  }
};

const save = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        documentHtml: editor.innerHTML,
        settings
      })
    );
  }, 250);
};

const getEffectiveFontSize = () => {
  if (!settings.autoFit) {
    return settings.fontSize;
  }
  const fitted = promptBox.clientHeight / settings.visibleLines / settings.lineHeight;
  return clamp(Math.round(fitted), 16, 92);
};

const applySettings = () => {
  const root = document.documentElement;
  root.style.setProperty("--bg", settings.backgroundColor);
  root.style.setProperty("--fg", settings.textColor);
  root.style.setProperty("--border", settings.borderColor);
  root.style.setProperty("--font-size", `${getEffectiveFontSize()}px`);
  root.style.setProperty("--line-height", String(settings.lineHeight));
  root.style.setProperty("--box-height", `${settings.boxHeight}vh`);
  editor.style.textAlign = settings.textAlign;
  editor.style.transform = `scale(${settings.mirrorX ? -1 : 1}, ${settings.mirrorY ? -1 : 1})`;
  camera.classList.toggle("mirrored", settings.cameraMirror);
  app.classList.toggle("mode-camera", settings.cameraEnabled);
  app.classList.toggle("mode-black", !settings.cameraEnabled);
  syncControls();
  save();
};

const syncControls = () => {
  setRangeValue("speed", settings.speed, `${settings.speed}px/s`);
  setRangeValue("countdownSeconds", settings.countdownSeconds, `${settings.countdownSeconds}s`);
  setRangeValue("visibleLines", settings.visibleLines, `${settings.visibleLines}`);
  setRangeValue("fontSize", settings.fontSize, `${settings.fontSize}px`);
  setRangeValue("lineHeight", settings.lineHeight, settings.lineHeight.toFixed(2));
  setRangeValue("boxHeight", settings.boxHeight, `${settings.boxHeight}%`);
  setChecked("loop", settings.loop);
  setChecked("autoFit", settings.autoFit);
  setChecked("mirrorX", settings.mirrorX);
  setChecked("cameraMirror", settings.cameraMirror);
  setValue("textColor", settings.textColor);
  setValue("backgroundColor", settings.backgroundColor);
  setValue("borderColor", settings.borderColor);
  playToggle.classList.toggle("playing", isPlaying || isCountingDown);
  playToggle.setAttribute("aria-label", isPlaying || isCountingDown ? "Pause" : "Play");
  cameraToggle.textContent = settings.cameraEnabled ? "Black" : "Camera";
  status.textContent = isCountingDown ? "Starting" : isPlaying ? "Playing" : "Paused";
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
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (input && document.activeElement !== input) {
    input.value = value;
  }
};

const updateSetting = <K extends keyof MobileSettings>(key: K, value: MobileSettings[K]) => {
  settings = { ...settings, [key]: value };
  applySettings();
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const pause = () => {
  isPlaying = false;
  isCountingDown = false;
  window.cancelAnimationFrame(animationFrame);
  countdown.hidden = true;
  syncControls();
};

const tick = (now: number) => {
  if (!isPlaying) {
    return;
  }
  const delta = lastTick ? (now - lastTick) / 1000 : 0;
  lastTick = now;
  const maxTop = scrollport.scrollHeight - scrollport.clientHeight;
  scrollport.scrollTop += settings.speed * delta;
  if (scrollport.scrollTop >= maxTop - 1) {
    if (settings.loop) {
      scrollport.scrollTop = 0;
    } else {
      pause();
      return;
    }
  }
  animationFrame = window.requestAnimationFrame(tick);
};

const start = async () => {
  if (isPlaying || isCountingDown) {
    return;
  }
  editor.blur();
  if (settings.countdownSeconds > 0) {
    isCountingDown = true;
    countdown.hidden = false;
    for (let value = settings.countdownSeconds; value > 0; value -= 1) {
      if (!isCountingDown) {
        return;
      }
      countdown.textContent = String(value);
      syncControls();
      await wait(1000);
    }
    countdown.hidden = true;
    isCountingDown = false;
  }
  isPlaying = true;
  lastTick = 0;
  syncControls();
  animationFrame = window.requestAnimationFrame(tick);
};

const togglePlayback = () => {
  if (isPlaying || isCountingDown) {
    pause();
  } else {
    void start();
  }
};

const startCamera = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    camera.srcObject = stream;
    camera.hidden = false;
    updateSetting("cameraEnabled", true);
  } catch {
    updateSetting("cameraEnabled", false);
    camera.hidden = true;
  }
};

const stopCamera = () => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  camera.srcObject = null;
  camera.hidden = true;
  updateSetting("cameraEnabled", false);
};

const toggleCamera = () => {
  if (settings.cameraEnabled) {
    stopCamera();
  } else {
    void startCamera();
  }
};

const sanitizeHtml = (html: string) => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const output = document.createElement("div");

  const copyChildren = (source: Node, target: Node) => {
    source.childNodes.forEach((child) => {
      const clean = cleanNode(child);
      if (clean) {
        target.appendChild(clean);
      }
    });
  };

  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object"].includes(tag)) {
      return null;
    }
    if (tag === "br") {
      return document.createElement("br");
    }
    if (["b", "strong", "i", "em", "u"].includes(tag)) {
      const element = document.createElement(tag);
      copyChildren(node, element);
      return element;
    }
    if (["p", "div", "h1", "h2", "h3", "h4", "li"].includes(tag)) {
      const paragraph = document.createElement("p");
      copyChildren(node, paragraph);
      return paragraph;
    }
    const fragment = document.createDocumentFragment();
    copyChildren(node, fragment);
    return fragment;
  };

  copyChildren(parsed.body, output);
  return output.innerHTML || DEFAULT_DOCUMENT;
};

const bindRange = <K extends keyof MobileSettings>(id: string, key: K, parse: (value: string) => MobileSettings[K]) => {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input", (event) => {
    updateSetting(key, parse((event.currentTarget as HTMLInputElement).value));
  });
};

const bindCheckbox = <K extends keyof MobileSettings>(id: string, key: K) => {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input", (event) => {
    updateSetting(key, (event.currentTarget as HTMLInputElement).checked as MobileSettings[K]);
  });
};

const bindTextInput = <K extends keyof MobileSettings>(id: string, key: K) => {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input", (event) => {
    updateSetting(key, (event.currentTarget as HTMLInputElement).value as MobileSettings[K]);
  });
};

const wireControls = () => {
  playToggle.addEventListener("click", togglePlayback);
  cameraToggle.addEventListener("click", toggleCamera);
  settingsToggle.addEventListener("click", () => {
    settingsSheet.hidden = false;
  });
  closeSettings.addEventListener("click", () => {
    settingsSheet.hidden = true;
  });

  bindRange("speed", "speed", Number);
  bindRange("countdownSeconds", "countdownSeconds", Number);
  bindRange("visibleLines", "visibleLines", Number);
  bindRange("fontSize", "fontSize", Number);
  bindRange("lineHeight", "lineHeight", Number);
  bindRange("boxHeight", "boxHeight", Number);
  bindCheckbox("loop", "loop");
  bindCheckbox("autoFit", "autoFit");
  bindCheckbox("mirrorX", "mirrorX");
  bindCheckbox("cameraMirror", "cameraMirror");
  bindTextInput("textColor", "textColor");
  bindTextInput("backgroundColor", "backgroundColor");
  bindTextInput("borderColor", "borderColor");

  editor.addEventListener("input", () => {
    pause();
    save();
  });
  editor.addEventListener("focus", pause);
};

load();
wireControls();
applySettings();
