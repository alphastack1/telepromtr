import {
  DEFAULT_DOCUMENT,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type ExportPayload,
  type MenuCommand,
  type MenuSnapshot,
  type TelepromtrBridge,
  type TelepromtrSettings
} from "../shared/types";

declare global {
  interface Window {
    telepromtr: TelepromtrBridge;
  }
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const scrollport = document.querySelector<HTMLDivElement>("#scrollport")!;
const transformSurface = document.querySelector<HTMLDivElement>("#transformSurface")!;
const editor = document.querySelector<HTMLDivElement>("#editor")!;
const countdown = document.querySelector<HTMLDivElement>("#countdown")!;
const playToggle = document.querySelector<HTMLButtonElement>("#playToggle")!;

let settings: TelepromtrSettings = { ...DEFAULT_SETTINGS };
let saveDocumentTimer: number | undefined;
let saveSettingsTimer: number | undefined;
let isPlaying = false;
let isCountingDown = false;
let animationFrame = 0;
let lastTick = 0;
let scrollRemainder = 0;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getStatus = (): MenuSnapshot["status"] => {
  if (isCountingDown) {
    return "starting";
  }
  return isPlaying ? "playing" : "paused";
};

const getMenuSnapshot = (): MenuSnapshot => ({
  settings,
  status: getStatus()
});

const notifyMenu = () => {
  window.telepromtr.updateMenuState(getMenuSnapshot());
};

const debounceDocumentSave = () => {
  window.clearTimeout(saveDocumentTimer);
  saveDocumentTimer = window.setTimeout(() => {
    void window.telepromtr.saveDocument(editor.innerHTML);
  }, 350);
};

const debounceSettingsSave = () => {
  window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = window.setTimeout(() => {
    void window.telepromtr.saveSettings(settings);
  }, 120);
};

const saveSettingsNow = () => {
  window.clearTimeout(saveSettingsTimer);
  void window.telepromtr.saveSettings(settings);
};

const getEffectiveFontSize = () => {
  if (!settings.autoFit) {
    return settings.fontSize;
  }

  const availableHeight = Math.max(60, scrollport.clientHeight - 8);
  const fitted = availableHeight / settings.visibleLines / settings.lineHeight;
  return clamp(Math.round(Math.min(fitted, settings.fontSize)), 16, 120);
};

const applySettings = () => {
  const root = document.documentElement;
  const fontSize = getEffectiveFontSize();
  root.style.setProperty("--bg", settings.backgroundColor);
  root.style.setProperty("--fg", settings.textColor);
  root.style.setProperty("--border", settings.borderColor);
  root.style.setProperty("--font-family", settings.fontFamily);
  root.style.setProperty("--font-size", `${fontSize}px`);
  root.style.setProperty("--line-height", `${settings.lineHeight}`);
  root.style.setProperty("--paragraph-spacing", `${settings.paragraphSpacing}em`);
  root.style.setProperty("--tracking", `${settings.letterSpacing}px`);

  editor.style.textAlign = settings.textAlign;
  transformSurface.style.transform = `scale(${settings.mirrorX ? -1 : 1}, ${settings.mirrorY ? -1 : 1})`;
  app.style.backgroundColor = settings.backgroundColor;
  syncPlaybackButton();
  notifyMenu();
};

const syncPlaybackButton = () => {
  const active = isPlaying || isCountingDown;
  playToggle.classList.toggle("playing", active);
  playToggle.setAttribute("aria-label", active ? "Pause" : "Play");
  playToggle.title = active ? "Pause" : "Play";
};

const updateSetting = <K extends keyof TelepromtrSettings>(key: K, value: TelepromtrSettings[K]) => {
  settings = { ...settings, [key]: value };
  applySettings();
  if (key === "alwaysOnTop" || key === "windowOpacity") {
    saveSettingsNow();
  } else {
    debounceSettingsSave();
  }
};

const isEditorFocused = () => document.activeElement === editor;

const pause = () => {
  isPlaying = false;
  isCountingDown = false;
  window.cancelAnimationFrame(animationFrame);
  countdown.hidden = true;
  syncPlaybackButton();
  notifyMenu();
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

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const start = async (withCountdown = true) => {
  if (isPlaying || isCountingDown) {
    return;
  }

  editor.blur();
  syncPlaybackButton();
  notifyMenu();

  if (withCountdown && settings.countdownSeconds > 0) {
    isCountingDown = true;
    countdown.hidden = false;
    for (let value = settings.countdownSeconds; value > 0; value -= 1) {
      if (!isCountingDown) {
        return;
      }
      countdown.textContent = String(value);
      notifyMenu();
      await wait(1000);
    }
    countdown.hidden = true;
    isCountingDown = false;
  }

  isPlaying = true;
  lastTick = 0;
  scrollRemainder = 0;
  syncPlaybackButton();
  notifyMenu();
  animationFrame = window.requestAnimationFrame(tick);
};

const togglePlayback = () => {
  if (isPlaying || isCountingDown) {
    pause();
  } else {
    void start(true);
  }
};

const execStyleCommand = (command: "bold" | "italic" | "underline") => {
  editor.focus();
  document.execCommand(command);
  debounceDocumentSave();
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
    if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object") {
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

const insertHtmlAtSelection = (html: string) => {
  editor.focus();
  document.execCommand("insertHTML", false, sanitizeHtml(html));
};

const placeCaretFromPoint = (x: number, y: number) => {
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  let range: Range | null = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else {
    const position = document.caretPositionFromPoint?.(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    }
  }

  if (!range || !editor.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  selection.removeAllRanges();
  selection.addRange(range);
};

const selectAllEditor = () => {
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
};

const selectWordFromPoint = (x: number, y: number) => {
  placeCaretFromPoint(x, y);
  const selection = window.getSelection();
  const editableSelection = selection as (Selection & {
    modify?: (alter: "move" | "extend", direction: "forward" | "backward", granularity: "word") => void;
  }) | null;
  if (!editableSelection?.modify) {
    return;
  }
  editableSelection.modify("move", "backward", "word");
  editableSelection.modify("extend", "forward", "word");
};

const getExportPayload = (): ExportPayload => ({
  html: editor.innerHTML,
  text: editor.innerText.replace(/\n{3,}/g, "\n\n")
});

const loadInitialState = async () => {
  const snapshot = await window.telepromtr.loadState();
  settings = normalizeSettings(snapshot.settings);
  editor.innerHTML = sanitizeHtml(snapshot.documentHtml || DEFAULT_DOCUMENT);
  applySettings();
};

const clearScript = () => {
  if (editor.innerText.trim() && !window.confirm("Clear the current script?")) {
    return;
  }
  editor.innerHTML = "<p></p>";
  scrollport.scrollTop = 0;
  debounceDocumentSave();
};

const openScript = async () => {
  const result = await window.telepromtr.importScript();
  if (!result.canceled && result.html) {
    editor.innerHTML = sanitizeHtml(result.html);
    scrollport.scrollTop = 0;
    debounceDocumentSave();
  }
};

const handleMenuCommand = (command: MenuCommand) => {
  switch (command) {
    case "toggle-playback":
      togglePlayback();
      break;
    case "bold":
    case "italic":
    case "underline":
      execStyleCommand(command);
      break;
    case "new-script":
      clearScript();
      window.telepromtr.hideMenu();
      break;
    case "open-script":
      void openScript().then(() => window.telepromtr.hideMenu());
      break;
    case "export-script":
      void window.telepromtr.exportScript(getExportPayload()).then(() => window.telepromtr.hideMenu());
      break;
    case "reset-window":
      void window.telepromtr.resetWindow().then(() => window.telepromtr.hideMenu());
      break;
    case "hide-menu":
      window.telepromtr.hideMenu();
      break;
  }
};

const wireControls = () => {
  playToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePlayback();
  });
};

const wireEditor = () => {
  editor.addEventListener("input", () => {
    pause();
    debounceDocumentSave();
  });

  editor.addEventListener("focus", pause);

  editor.addEventListener("click", (event) => {
    if (event.detail >= 3) {
      event.preventDefault();
      selectAllEditor();
      window.setTimeout(selectAllEditor, 0);
    }
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }

    const html = clipboard.getData("text/html");
    const text = clipboard.getData("text/plain");
    if (html) {
      insertHtmlAtSelection(html);
    } else if (text) {
      document.execCommand("insertText", false, text);
    }
    debounceDocumentSave();
  });
};

interface DragState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  clientX: number;
  clientY: number;
  startedInEditor: boolean;
  startedAt: number;
  dragging: boolean;
}

interface ClickSeries {
  count: number;
  clientX: number;
  clientY: number;
  at: number;
}

let dragState: DragState | null = null;
let editorClickSeries: ClickSeries = {
  count: 0,
  clientX: 0,
  clientY: 0,
  at: 0
};

const recordEditorClick = (clientX: number, clientY: number) => {
  const now = performance.now();
  const closeToLast = Math.hypot(clientX - editorClickSeries.clientX, clientY - editorClickSeries.clientY) <= 24;
  const quickEnough = now - editorClickSeries.at <= 650;
  const count = closeToLast && quickEnough ? editorClickSeries.count + 1 : 1;

  editorClickSeries = {
    count,
    clientX,
    clientY,
    at: now
  };

  return count;
};

const isChromeControl = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest(".chrome-control"));

const isEditorTarget = (target: EventTarget | null) => target instanceof Node && editor.contains(target);

const wireWindowMovement = () => {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || isChromeControl(event.target)) {
        return;
      }

      const startedInEditor = isEditorTarget(event.target);
      if (startedInEditor && isEditorFocused()) {
        dragState = null;
        return;
      }

      event.preventDefault();
      dragState = {
        startX: event.screenX,
        startY: event.screenY,
        lastX: event.screenX,
        lastY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        startedInEditor,
        startedAt: performance.now(),
        dragging: false
      };
    },
    true
  );

  window.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }

    const dx = event.screenX - dragState.startX;
    const dy = event.screenY - dragState.startY;
    const distance = Math.hypot(dx, dy);
    const heldFor = performance.now() - dragState.startedAt;
    const shouldDrag = dragState.dragging || (distance > 8 && heldFor > 90);

    if (!shouldDrag) {
      return;
    }

    dragState.dragging = true;
    scrollport.classList.add("dragging");
    pause();
    editor.blur();

    const moveX = event.screenX - dragState.lastX;
    const moveY = event.screenY - dragState.lastY;
    dragState.lastX = event.screenX;
    dragState.lastY = event.screenY;
    void window.telepromtr.moveWindowBy(moveX, moveY);
  });

  window.addEventListener("pointerup", (event) => {
    if (!dragState) {
      return;
    }

    const wasDragging = dragState.dragging;
    const { clientX, clientY, startedInEditor } = dragState;
    dragState = null;
    scrollport.classList.remove("dragging");

    if (!wasDragging) {
      pause();
      if (startedInEditor) {
        const clickCount = recordEditorClick(clientX, clientY);
        if (clickCount >= 3) {
          selectAllEditor();
          window.setTimeout(selectAllEditor, 0);
        } else if (clickCount === 2) {
          selectWordFromPoint(clientX, clientY);
        } else {
          placeCaretFromPoint(clientX, clientY);
        }
      } else {
        placeCaretFromPoint(clientX, clientY);
      }
    } else {
      editorClickSeries.count = 0;
    }

    event.preventDefault();
  });
};

const wireGlobalEvents = () => {
  window.addEventListener("resize", applySettings);

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void window.telepromtr.showMenu({
      x: event.screenX,
      y: event.screenY,
      snapshot: getMenuSnapshot()
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      editor.blur();
      window.telepromtr.hideMenu();
      return;
    }

    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (isEditorFocused()) {
      if (event.ctrlKey && ["b", "i", "u"].includes(event.key.toLowerCase())) {
        debounceDocumentSave();
      }
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollport.scrollBy({ top: event.shiftKey ? 220 : 76, behavior: "smooth" });
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollport.scrollBy({ top: event.shiftKey ? -220 : -76, behavior: "smooth" });
    }
  });

  window.telepromtr.onMenuCommand(handleMenuCommand);
  window.telepromtr.onMenuSetting((patch) => {
    const next = normalizeSettings({ ...settings, [patch.key]: patch.value });
    updateSetting(patch.key, next[patch.key]);
  });
};

const boot = async () => {
  wireControls();
  wireEditor();
  wireWindowMovement();
  wireGlobalEvents();
  await loadInitialState();
};

void boot();
