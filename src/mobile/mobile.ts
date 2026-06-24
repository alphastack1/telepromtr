import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { DEFAULT_DOCUMENT, DEFAULT_SETTINGS, normalizeSettings, type TelepromtrSettings } from "../shared/types";

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
const recordToggle = document.querySelector<HTMLButtonElement>("#recordToggle")!;
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
let scrollRemainder = 0;
let saveTimer: number | undefined;
let stream: MediaStream | null = null;
let recordingAudioStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let recordedChunks: BlobPart[] = [];
let isRecording = false;
let isRecordingBusy = false;
let recordingBusyLabel = "Preparing";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const clampSetting = (value: unknown, fallback: number, min: number, max: number, integer = false) => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = clamp(numeric, min, max);
  return integer ? Math.round(clamped) : clamped;
};

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as {
      documentHtml?: string;
      settings?: Partial<MobileSettings>;
    };
    const savedSettings = saved.settings || {};
    settings = {
      ...DEFAULT_MOBILE_SETTINGS,
      ...normalizeSettings(savedSettings),
      boxHeight: clampSetting(savedSettings.boxHeight, DEFAULT_MOBILE_SETTINGS.boxHeight, 16, 72, true),
      cameraEnabled: false,
      cameraMirror:
        typeof savedSettings.cameraMirror === "boolean" ? savedSettings.cameraMirror : DEFAULT_MOBILE_SETTINGS.cameraMirror
    };
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
  return clamp(Math.round(Math.min(fitted, settings.fontSize)), 16, 92);
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
  setRangeValue("boxHeight", settings.boxHeight, `${settings.boxHeight}vh`);
  setChecked("loop", settings.loop);
  setChecked("autoFit", settings.autoFit);
  setChecked("mirrorX", settings.mirrorX);
  setChecked("cameraMirror", settings.cameraMirror);
  setValue("textColor", settings.textColor);
  setValue("backgroundColor", settings.backgroundColor);
  setValue("borderColor", settings.borderColor);
  playToggle.classList.toggle("playing", isPlaying || isCountingDown);
  playToggle.setAttribute("aria-label", isPlaying || isCountingDown ? "Pause" : "Play");
  recordToggle.classList.toggle("recording", isRecording);
  recordToggle.classList.toggle("busy", isRecordingBusy);
  recordToggle.textContent = isRecording ? "Stop" : isRecordingBusy ? "Wait" : "Record";
  recordToggle.disabled = isRecordingBusy && !isRecording;
  recordToggle.setAttribute("aria-label", isRecording ? "Stop recording" : "Start recording");
  cameraToggle.textContent = settings.cameraEnabled ? "Black" : "Camera";
  cameraToggle.disabled = isRecording || isRecordingBusy;
  status.textContent = isRecording
    ? "Recording"
    : isRecordingBusy
      ? recordingBusyLabel
      : isCountingDown
        ? "Starting"
        : isPlaying
          ? "Playing"
          : "Paused";
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
  const next = { ...settings, [key]: value };
  settings = {
    ...next,
    ...normalizeSettings(next),
    boxHeight: clampSetting(next.boxHeight, DEFAULT_MOBILE_SETTINGS.boxHeight, 16, 72, true),
    cameraEnabled: next.cameraEnabled === true,
    cameraMirror: typeof next.cameraMirror === "boolean" ? next.cameraMirror : DEFAULT_MOBILE_SETTINGS.cameraMirror
  };
  applySettings();
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const hasLiveVideo = (candidate: MediaStream | null) =>
  Boolean(candidate?.getVideoTracks().some((track) => track.readyState === "live"));

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
  const scrollDistance = settings.speed * delta + scrollRemainder;
  const wholePixels = Math.trunc(scrollDistance);
  scrollRemainder = scrollDistance - wholePixels;

  if (wholePixels !== 0) {
    scrollport.scrollTop += wholePixels;
  }

  if (scrollport.scrollTop >= maxTop - 1) {
    if (settings.loop) {
      scrollport.scrollTop = 0;
      scrollRemainder = 0;
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
  scrollRemainder = 0;
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
  if (hasLiveVideo(stream)) {
    camera.hidden = false;
    updateSetting("cameraEnabled", true);
    return true;
  }

  try {
    stream?.getTracks().forEach((track) => track.stop());
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
    return true;
  } catch {
    updateSetting("cameraEnabled", false);
    camera.hidden = true;
    return false;
  }
};

const stopCamera = () => {
  if (isRecording || isRecordingBusy) {
    return;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  camera.srcObject = null;
  camera.hidden = true;
  updateSetting("cameraEnabled", false);
};

const toggleCamera = () => {
  if (isRecording) {
    return;
  }

  if (settings.cameraEnabled) {
    stopCamera();
  } else {
    void startCamera();
  }
};

const getRecordingMimeType = () =>
  ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type)
  );

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(blob);
  });

const shareRecording = async (blob: Blob) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `telepromtr-${timestamp}.webm`;
  const data = await blobToBase64(blob);
  const saved = await Filesystem.writeFile({
    path: fileName,
    data,
    directory: Directory.Cache
  });

  const canShare = await Share.canShare().catch(() => ({ value: false }));
  if (canShare.value) {
    await Share.share({
      title: "TELEPROMTR recording",
      text: "TELEPROMTR recording",
      files: [saved.uri],
      dialogTitle: "Save or share recording"
    });
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const stopRecording = () => {
  if (!recorder || !isRecording || isRecordingBusy) {
    return;
  }
  isRecordingBusy = true;
  recordingBusyLabel = "Saving";
  isRecording = false;
  syncControls();
  recorder.stop();
};

const startRecording = async () => {
  if (isRecording) {
    stopRecording();
    return;
  }

  if (isRecordingBusy) {
    return;
  }

  isRecordingBusy = true;
  recordingBusyLabel = "Preparing";
  syncControls();
  const cameraReady = await startCamera();
  if (!cameraReady || !stream) {
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    syncControls();
    return;
  }

  recordedChunks = [];
  const mimeType = getRecordingMimeType();
  let recordingStream: MediaStream;
  try {
    recordingAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });
    recordingStream = new MediaStream([...stream.getVideoTracks(), ...recordingAudioStream.getAudioTracks()]);
    recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
  } catch {
    recordingAudioStream?.getTracks().forEach((track) => track.stop());
    recordingAudioStream = null;
    isRecording = false;
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    recorder = null;
    syncControls();
    return;
  }
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });
  recorder.addEventListener("stop", () => {
    const stoppedRecorder = recorder;
    const blob = new Blob(recordedChunks, { type: stoppedRecorder?.mimeType || "video/webm" });
    recordingAudioStream?.getTracks().forEach((track) => track.stop());
    recordingAudioStream = null;
    isRecording = false;
    recorder = null;
    recordedChunks = [];
    syncControls();
    void shareRecording(blob)
      .catch(() => undefined)
      .finally(() => {
        isRecordingBusy = false;
        recordingBusyLabel = "Preparing";
        syncControls();
      });
  });

  recorder.start(1000);
  isRecording = true;
  isRecordingBusy = false;
  syncControls();
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
  recordToggle.addEventListener("click", () => void startRecording());
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
