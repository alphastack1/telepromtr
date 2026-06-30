import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { DEFAULT_DOCUMENT, DEFAULT_SETTINGS, normalizeSettings, type TelepromtrSettings } from "../shared/types";

interface MobileSettings extends TelepromtrSettings {
  boxHeight: number;
  cameraEnabled: boolean;
  cameraMirror: boolean;
  cameraDeviceId: string;
  microphoneDeviceId: string;
}

const DEFAULT_MOBILE_SETTINGS: MobileSettings = {
  ...DEFAULT_SETTINGS,
  backgroundColor: "#050505",
  borderColor: "#343434",
  boxHeight: 30,
  cameraEnabled: false,
  cameraMirror: true,
  cameraDeviceId: "",
  microphoneDeviceId: ""
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
const recordingStatus = document.querySelector<HTMLDivElement>("#recordingStatus")!;
const cameraDeviceSelect = document.querySelector<HTMLSelectElement>("#cameraDeviceId")!;
const microphoneDeviceSelect = document.querySelector<HTMLSelectElement>("#microphoneDeviceId")!;

let settings: MobileSettings = { ...DEFAULT_MOBILE_SETTINGS };
let isPlaying = false;
let isCountingDown = false;
let animationFrame = 0;
let lastTick = 0;
let scrollRemainder = 0;
let saveTimer: number | undefined;
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let recordedChunks: BlobPart[] = [];
let isRecording = false;
let isRecordingBusy = false;
let recordingBusyLabel = "Preparing";
let recordingStartedAt = 0;
let recordingTimer: number | undefined;
let recordingMessage = "";
let clearRecordingMessageTimer: number | undefined;
let mediaDevices: MediaDeviceInfo[] = [];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const clampSetting = (value: unknown, fallback: number, min: number, max: number, integer = false) => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = clamp(numeric, min, max);
  return integer ? Math.round(clamped) : clamped;
};

const stringSetting = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

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
        typeof savedSettings.cameraMirror === "boolean" ? savedSettings.cameraMirror : DEFAULT_MOBILE_SETTINGS.cameraMirror,
      cameraDeviceId: stringSetting(savedSettings.cameraDeviceId),
      microphoneDeviceId: stringSetting(savedSettings.microphoneDeviceId)
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

const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const getRecordingElapsed = () => (recordingStartedAt ? formatDuration(Date.now() - recordingStartedAt) : "0:00");

const setRecordingMessage = (message: string, autoClear = false) => {
  window.clearTimeout(clearRecordingMessageTimer);
  recordingMessage = message;
  if (autoClear && message) {
    clearRecordingMessageTimer = window.setTimeout(() => {
      recordingMessage = "";
      syncControls();
    }, 5000);
  }
  syncControls();
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
  setChecked("mirrorY", settings.mirrorY);
  setChecked("cameraMirror", settings.cameraMirror);
  setValue("cameraDeviceId", settings.cameraDeviceId);
  setValue("microphoneDeviceId", settings.microphoneDeviceId);
  setValue("textColor", settings.textColor);
  setValue("backgroundColor", settings.backgroundColor);
  setValue("borderColor", settings.borderColor);
  playToggle.classList.toggle("playing", isPlaying || isCountingDown);
  playToggle.setAttribute("aria-label", isPlaying || isCountingDown ? "Pause" : "Play");
  recordToggle.classList.toggle("recording", isRecording);
  recordToggle.classList.toggle("busy", isRecordingBusy);
  recordToggle.textContent = isRecording ? `Stop ${getRecordingElapsed()}` : isRecordingBusy ? recordingBusyLabel : "Record";
  recordToggle.disabled = isRecordingBusy && !isRecording;
  recordToggle.setAttribute("aria-label", isRecording ? "Stop recording" : "Start recording");
  cameraToggle.textContent = settings.cameraEnabled ? "Black" : "Camera";
  cameraToggle.disabled = isRecording || isRecordingBusy;
  cameraDeviceSelect.disabled = isRecording || isRecordingBusy;
  microphoneDeviceSelect.disabled = isRecording || isRecordingBusy;
  const statusText = isRecording
    ? "Recording"
    : isRecordingBusy
      ? recordingBusyLabel
      : isCountingDown
        ? "Starting"
        : isPlaying
          ? "Playing"
          : "Paused";
  status.textContent = statusText;
  const visibleRecordingMessage = isRecording
    ? `Recording ${getRecordingElapsed()}`
    : isRecordingBusy
      ? recordingBusyLabel
      : recordingMessage;
  recordingStatus.hidden = !visibleRecordingMessage;
  recordingStatus.textContent = visibleRecordingMessage;
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

const updateSetting = <K extends keyof MobileSettings>(key: K, value: MobileSettings[K]) => {
  const next = { ...settings, [key]: value };
  settings = {
    ...next,
    ...normalizeSettings(next),
    boxHeight: clampSetting(next.boxHeight, DEFAULT_MOBILE_SETTINGS.boxHeight, 16, 72, true),
    cameraEnabled: next.cameraEnabled === true,
    cameraMirror: typeof next.cameraMirror === "boolean" ? next.cameraMirror : DEFAULT_MOBILE_SETTINGS.cameraMirror,
    cameraDeviceId: stringSetting(next.cameraDeviceId),
    microphoneDeviceId: stringSetting(next.microphoneDeviceId)
  };
  applySettings();
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isLiveTrack = (track: MediaStreamTrack) => track.readyState === "live";

const hasLiveVideo = (candidate: MediaStream | null) =>
  Boolean(candidate?.getVideoTracks().some(isLiveTrack));

const hasLiveAudio = (candidate: MediaStream | null) =>
  Boolean(candidate?.getAudioTracks().some(isLiveTrack));

const stopStream = (candidate: MediaStream | null) => {
  candidate?.getTracks().forEach((track) => track.stop());
};

const stopAudioTracks = (candidate: MediaStream | null) => {
  candidate?.getAudioTracks().forEach((track) => track.stop());
};

const describeMediaError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera or mic permission blocked";
    }
    if (error.name === "NotFoundError") {
      return "Camera or mic not found";
    }
    if (error.name === "NotReadableError") {
      return "Camera or mic is busy";
    }
  }
  return "Recording could not start";
};

const startRecordingClock = () => {
  window.clearInterval(recordingTimer);
  recordingStartedAt = Date.now();
  recordingTimer = window.setInterval(syncControls, 500);
};

const stopRecordingClock = () => {
  window.clearInterval(recordingTimer);
  recordingTimer = undefined;
  recordingStartedAt = 0;
};

const renderDeviceOptions = (
  select: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  selectedDeviceId: string,
  defaultLabel: string,
  fallbackLabel: string
) => {
  const previousValue = select.value;
  select.replaceChildren();
  select.add(new Option(defaultLabel, ""));
  devices.forEach((device, index) => {
    select.add(new Option(device.label || `${fallbackLabel} ${index + 1}`, device.deviceId));
  });
  if (selectedDeviceId && !devices.some((device) => device.deviceId === selectedDeviceId)) {
    select.add(new Option(`Selected ${fallbackLabel.toLowerCase()}`, selectedDeviceId));
  }
  select.value = selectedDeviceId;
  if (!selectedDeviceId && previousValue && devices.some((device) => device.deviceId === previousValue)) {
    select.value = previousValue;
  }
};

const refreshMediaDevices = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return;
  }

  try {
    mediaDevices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    mediaDevices = [];
  }

  renderDeviceOptions(
    cameraDeviceSelect,
    mediaDevices.filter((device) => device.kind === "videoinput"),
    settings.cameraDeviceId,
    "Default camera",
    "Camera"
  );
  renderDeviceOptions(
    microphoneDeviceSelect,
    mediaDevices.filter((device) => device.kind === "audioinput"),
    settings.microphoneDeviceId,
    "Default mic",
    "Mic"
  );
};

const getVideoConstraints = (useSelectedDevice = true): MediaTrackConstraints => ({
  ...(useSelectedDevice && settings.cameraDeviceId
    ? { deviceId: { exact: settings.cameraDeviceId } }
    : { facingMode: "user" }),
  width: { ideal: 1280 },
  height: { ideal: 720 }
});

const getAudioConstraints = (useSelectedDevice = true): MediaTrackConstraints => ({
  ...(useSelectedDevice && settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),
  echoCancellation: true,
  noiseSuppression: true
});

const shouldFallbackToDefaultDevice = (error: unknown) =>
  error instanceof DOMException && error.name !== "NotAllowedError" && error.name !== "SecurityError";

const requestMediaStream = async (withAudio: boolean) => {
  const usesSelectedDevice = Boolean(settings.cameraDeviceId || (withAudio && settings.microphoneDeviceId));
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: withAudio ? getAudioConstraints(true) : false,
      video: getVideoConstraints(true)
    });
  } catch (error) {
    if (usesSelectedDevice && shouldFallbackToDefaultDevice(error)) {
      setRecordingMessage("Selected device unavailable; using default", true);
      return navigator.mediaDevices.getUserMedia({
        audio: withAudio ? getAudioConstraints(false) : false,
        video: getVideoConstraints(false)
      });
    }
    throw error;
  }
};

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

const startCamera = async (withAudio = false) => {
  if (hasLiveVideo(stream) && (!withAudio || hasLiveAudio(stream))) {
    camera.hidden = false;
    updateSetting("cameraEnabled", true);
    return true;
  }

  try {
    const nextStream = await requestMediaStream(withAudio);
    const previousStream = stream;
    stream = nextStream;
    camera.srcObject = stream;
    camera.hidden = false;
    await camera.play().catch(() => undefined);
    stopStream(previousStream);
    updateSetting("cameraEnabled", true);
    void refreshMediaDevices();
    return true;
  } catch (error) {
    if (!hasLiveVideo(stream)) {
      updateSetting("cameraEnabled", false);
      camera.hidden = true;
    }
    setRecordingMessage(describeMediaError(error), true);
    return false;
  }
};

const stopCamera = () => {
  if (isRecording || isRecordingBusy) {
    return;
  }
  stopStream(stream);
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
  typeof MediaRecorder === "undefined"
    ? undefined
    : ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"].find((type) =>
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
    return fileName;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
};

const stopRecording = () => {
  if (!recorder || !isRecording || isRecordingBusy) {
    return;
  }
  isRecordingBusy = true;
  recordingBusyLabel = "Saving";
  isRecording = false;
  syncControls();
  if (recorder.state === "recording") {
    recorder.requestData();
    recorder.stop();
  } else {
    stopRecordingClock();
    recorder = null;
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    setRecordingMessage("Recording stopped unexpectedly", true);
  }
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
  const cameraReady = await startCamera(true);
  if (!cameraReady || !stream) {
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    syncControls();
    return;
  }

  if (typeof MediaRecorder === "undefined") {
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    setRecordingMessage("Recording is not supported on this device", true);
    return;
  }

  if (!hasLiveVideo(stream) || !hasLiveAudio(stream)) {
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    setRecordingMessage("Camera and mic are required", true);
    return;
  }

  recordedChunks = [];
  const mimeType = getRecordingMimeType();
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    console.error("TELEPROMTR recording could not start", error);
    isRecording = false;
    isRecordingBusy = false;
    recordingBusyLabel = "Preparing";
    recorder = null;
    setRecordingMessage("Recording could not start", true);
    syncControls();
    return;
  }

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  recorder.addEventListener("error", (event) => {
    const recorderError = (event as Event & { error?: DOMException }).error;
    console.error("TELEPROMTR recording error", recorderError || event);
    if (recorder?.state === "recording") {
      recorder.stop();
    }
    setRecordingMessage("Recording failed", true);
  });

  recorder.addEventListener("stop", () => {
    const stoppedRecorder = recorder;
    const blob = new Blob(recordedChunks, { type: stoppedRecorder?.mimeType || "video/webm" });
    stopAudioTracks(stream);
    stopRecordingClock();
    isRecording = false;
    recorder = null;
    recordedChunks = [];
    if (blob.size === 0) {
      isRecordingBusy = false;
      recordingBusyLabel = "Preparing";
      setRecordingMessage("Recording failed: empty file", true);
      syncControls();
      return;
    }

    recordingBusyLabel = "Opening share";
    syncControls();
    void shareRecording(blob)
      .then((fileName) => {
        setRecordingMessage(`Saved ${fileName}`, true);
      })
      .catch((error) => {
        console.error("TELEPROMTR recording share failed", error);
        setRecordingMessage("Recording saved, share failed", true);
      })
      .finally(() => {
        isRecordingBusy = false;
        recordingBusyLabel = "Preparing";
        syncControls();
      });
  });

  recorder.start(500);
  isRecording = true;
  isRecordingBusy = false;
  recordingMessage = "";
  startRecordingClock();
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

const bindMediaDeviceSelect = (select: HTMLSelectElement, key: "cameraDeviceId" | "microphoneDeviceId") => {
  select.addEventListener("input", () => {
    updateSetting(key, select.value);
    if (key === "cameraDeviceId" && settings.cameraEnabled && !isRecording && !isRecordingBusy) {
      void startCamera(false);
    }
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
  bindCheckbox("mirrorY", "mirrorY");
  bindCheckbox("cameraMirror", "cameraMirror");
  bindMediaDeviceSelect(cameraDeviceSelect, "cameraDeviceId");
  bindMediaDeviceSelect(microphoneDeviceSelect, "microphoneDeviceId");
  bindTextInput("textColor", "textColor");
  bindTextInput("backgroundColor", "backgroundColor");
  bindTextInput("borderColor", "borderColor");

  editor.addEventListener("input", () => {
    pause();
    save();
  });
  editor.addEventListener("focus", pause);
  window.addEventListener("pagehide", () => {
    stopStream(stream);
    stopRecordingClock();
  });
  navigator.mediaDevices?.addEventListener("devicechange", () => {
    void refreshMediaDevices();
  });
};

load();
wireControls();
applySettings();
void refreshMediaDevices();
