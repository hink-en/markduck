import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const fileName = document.querySelector("#file-name");
const dirtyDot = document.querySelector("#dirty-dot");
const stats = document.querySelector("#document-stats");
const toast = document.querySelector("#toast");
const themeButton = document.querySelector("#theme-button");
const themeColor = document.querySelector('meta[name="theme-color"]');

let currentPath = null;
let savedContent = "";
let toastTimer;
let syncFrame;

marked.setOptions({ gfm: true, breaks: true });

function setTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute("aria-pressed", String(isLight));
  themeButton.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} theme`);
  themeButton.title = `Switch to ${isLight ? "dark" : "light"} theme`;
  themeColor.content = isLight ? "#f4f2ec" : "#0c0d10";
  localStorage.setItem("hinkmd-theme", theme);
}

setTheme(localStorage.getItem("hinkmd-theme") === "light" ? "light" : "dark");
themeButton.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

const zoomOut = document.querySelector("#zoom-out");
const zoomIn = document.querySelector("#zoom-in");
const zoomReset = document.querySelector("#zoom-reset");
let zoom = 100;

function setZoom(value) {
  const progress = scrollProgress(editor);
  zoom = Math.max(75, Math.min(200, Math.round(value / 5) * 5));
  document.documentElement.style.setProperty("--text-scale", zoom / 100);
  zoomReset.textContent = `${zoom}%`;
  zoomReset.setAttribute("aria-label", `Zoom ${zoom}%. Reset to 100%`);
  zoomOut.disabled = zoom <= 75;
  zoomIn.disabled = zoom >= 200;
  localStorage.setItem("hinkmd-zoom", String(zoom));
  requestAnimationFrame(() => {
    scrollToProgress(editor, progress);
    scrollToProgress(preview, progress);
  });
}

const storedZoom = Number(localStorage.getItem("hinkmd-zoom"));
setZoom(Number.isFinite(storedZoom) && storedZoom > 0 ? storedZoom : 100);
zoomOut.addEventListener("click", () => setZoom(zoom - 10));
zoomIn.addEventListener("click", () => setZoom(zoom + 10));
zoomReset.addEventListener("click", () => setZoom(100));

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.className = `visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.className = ""), 2400);
}

function updateDocument() {
  const content = editor.value;
  const tokens = marked.lexer(content);
  preview.innerHTML = DOMPurify.sanitize(marked.parser(tokens));
  const blocks = tokens.filter((token) => !["space", "def"].includes(token.type));
  let sourceOffset = 0;
  [...preview.children].forEach((element, index) => {
    const raw = blocks[index]?.raw;
    if (!raw) return;
    const start = content.indexOf(raw, sourceOffset);
    if (start < 0) return;
    const startLine = content.slice(0, start).split("\n").length - 1;
    const endLine = startLine + raw.replace(/\n$/, "").split("\n").length - 1;
    element.dataset.sourceStart = startLine;
    element.dataset.sourceEnd = endLine;
    sourceOffset = start + raw.length;
  });
  preview.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.ceil(words / 220));
  stats.textContent = `${words} ${words === 1 ? "word" : "words"} · ${readingTime} min read`;
  dirtyDot.classList.toggle("visible", content !== savedContent);
  document.title = `${content !== savedContent ? "• " : ""}${fileName.textContent} — HinkMD`;
}

function scrollProgress(element) {
  const range = element.scrollHeight - element.clientHeight;
  return range > 0 ? element.scrollTop / range : 0;
}

function scrollToProgress(element, progress, behavior = "auto") {
  const range = element.scrollHeight - element.clientHeight;
  element.scrollTo({ top: Math.max(0, range * progress), behavior });
}

function syncPreviewToEditor() {
  cancelAnimationFrame(syncFrame);
  syncFrame = requestAnimationFrame(() => {
    scrollToProgress(preview, scrollProgress(editor));
  });
}

function syncPreviewToCaret() {
  const contentBeforeCaret = editor.value.slice(0, editor.selectionStart);
  const line = contentBeforeCaret.split("\n").length - 1;
  const lineCount = Math.max(1, editor.value.split("\n").length - 1);
  const block = [...preview.children].find((element) => {
    const start = Number(element.dataset.sourceStart);
    const end = Number(element.dataset.sourceEnd);
    return line >= start && line <= end;
  });
  let targetY = preview.scrollHeight * (line / lineCount);

  if (block) {
    const start = Number(block.dataset.sourceStart);
    const end = Number(block.dataset.sourceEnd);
    const withinBlock = end > start ? (line - start) / (end - start) : 0;
    targetY = block.offsetTop + block.offsetHeight * withinBlock;
  }

  const viewportY = targetY - preview.scrollTop;
  const focusY = preview.clientHeight / 3;
  // Keep the active source around the upper third, while avoiding tiny shifts.
  if (viewportY < preview.clientHeight * 0.16 || viewportY > preview.clientHeight * 0.52) {
    preview.scrollTo({ top: Math.max(0, targetY - focusY), behavior: "smooth" });
  }
}

function jumpEditorToPreviewPosition(event) {
  if (!preview.textContent.trim()) return;
  event.preventDefault();

  const lines = editor.value.split("\n");
  const block = event.target.closest("[data-source-start]");
  let targetLine;

  if (block) {
    const bounds = block.getBoundingClientRect();
    const withinBlock = bounds.height > 0
      ? Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
      : 0;
    const start = Number(block.dataset.sourceStart);
    const end = Number(block.dataset.sourceEnd);
    targetLine = Math.round(start + (end - start) * withinBlock);
  } else {
    const bounds = preview.getBoundingClientRect();
    const documentY = preview.scrollTop + event.clientY - bounds.top;
    const progress = Math.max(0, Math.min(1, documentY / preview.scrollHeight));
    targetLine = Math.round(progress * (lines.length - 1));
  }

  targetLine = Math.min(lines.length - 1, targetLine);
  const progress = targetLine / Math.max(1, lines.length - 1);
  let position = 0;
  for (let index = 0; index < targetLine; index += 1) {
    position += lines[index].length + 1;
  }

  editor.focus();
  editor.setSelectionRange(position, position);
  const editorRange = editor.scrollHeight - editor.clientHeight;
  editor.scrollTo({
    top: Math.max(0, editorRange * progress),
    behavior: "smooth",
  });
}

function loadDocument(document) {
  currentPath = document.path;
  savedContent = document.content;
  editor.value = document.content;
  fileName.textContent = document.name;
  updateDocument();
  editor.focus();
}

async function openDocument(path = null) {
  try {
    const document = path
      ? await invoke("read_file", { path })
      : await invoke("pick_file");
    if (document) loadDocument(document);
  } catch (error) {
    showToast(String(error), "error");
  }
}

async function saveDocument() {
  try {
    const result = await invoke("save_file", {
      path: currentPath,
      content: editor.value,
    });
    if (!result) return;
    currentPath = result.path;
    fileName.textContent = result.name;
    savedContent = editor.value;
    updateDocument();
    showToast("Saved");
  } catch (error) {
    showToast(String(error), "error");
  }
}

editor.addEventListener("input", () => {
  updateDocument();
  syncPreviewToCaret();
});
editor.addEventListener("scroll", syncPreviewToEditor, { passive: true });
editor.addEventListener("click", syncPreviewToCaret);
editor.addEventListener("keyup", syncPreviewToCaret);
preview.addEventListener("click", jumpEditorToPreviewPosition);
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText("  ", start, editor.selectionEnd, "end");
    updateDocument();
  }
});

document.querySelector("#open-button").addEventListener("click", () => openDocument());
document.querySelector("#save-button").addEventListener("click", saveDocument);

document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  if (["+", "=", "-", "0"].includes(event.key)) {
    event.preventDefault();
    setZoom(event.key === "0" ? 100 : zoom + (event.key === "-" ? -10 : 10));
    return;
  }
  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveDocument();
  }
  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    openDocument();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (editor.value !== savedContent) event.preventDefault();
});

const assignedFile = await invoke("take_window_file");
if (assignedFile) await openDocument(assignedFile);
else updateDocument();
