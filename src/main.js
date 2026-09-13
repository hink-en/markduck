import "./styles.css";
import { formatMarkdown } from "./formatting.js";
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
const programmaticScrolls = new WeakMap();
let reportedDirty;
let dirtyStateQueue = Promise.resolve();

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

const sidebarToggle = document.querySelector("#sidebar-toggle-button");
const fileTreePanel = document.querySelector("#file-tree-panel");
const fileTreeTitle = document.querySelector("#file-tree-title");
const fileTree = document.querySelector("#file-tree");
const openFolderButton = document.querySelector("#open-folder-button");
const fileSearchBar = document.querySelector("#file-search-bar");
const fileSearchInput = document.querySelector("#file-search-input");
const fileSearchClose = document.querySelector("#file-search-close");

let currentTree = null;
let currentFolderPath = null;

function setSidebarVisible(visible) {
  fileTreePanel.hidden = !visible;
  sidebarToggle.setAttribute("aria-pressed", String(visible));
  const label = `${visible ? "Hide" : "Show"} file panel`;
  sidebarToggle.title = label;
  sidebarToggle.setAttribute("aria-label", label);
  localStorage.setItem("hinkmd-sidebar-visible", String(visible));
}

setSidebarVisible(localStorage.getItem("hinkmd-sidebar-visible") === "true");
sidebarToggle.addEventListener("click", () => setSidebarVisible(fileTreePanel.hidden));

function highlightActiveFile() {
  fileTree.querySelectorAll(".tree-file-label").forEach((button) => {
    button.classList.toggle("active", button.dataset.path === currentPath);
  });
}

function renderTreeNodes(nodes) {
  const list = document.createElement("ul");
  list.setAttribute("role", "group");
  for (const node of nodes) {
    const item = document.createElement("li");
    item.setAttribute("role", "treeitem");
    if (node.isDir) {
      item.className = "tree-folder";
      item.setAttribute("aria-expanded", "true");
      const label = document.createElement("button");
      label.type = "button";
      label.className = "tree-folder-label";
      label.textContent = node.name;
      label.addEventListener("click", () => {
        item.setAttribute("aria-expanded", String(item.getAttribute("aria-expanded") !== "true"));
      });
      item.append(label, renderTreeNodes(node.children));
    } else {
      item.className = "tree-file";
      const label = document.createElement("button");
      label.type = "button";
      label.className = "tree-file-label";
      label.textContent = node.name;
      label.title = node.path;
      label.dataset.path = node.path;
      label.addEventListener("click", () => openDocument(node.path));
      item.appendChild(label);
    }
    list.appendChild(item);
  }
  return list;
}

function renderEmptyTreeState() {
  fileTree.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "tree-empty";
  const message = document.createElement("p");
  message.textContent = "Open a folder to browse its Markdown files.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Open Folder";
  button.addEventListener("click", () => openFolder());
  empty.append(message, button);
  fileTree.appendChild(empty);
}

function renderTree(tree) {
  currentTree = tree;
  fileTreeTitle.textContent = tree.name;
  fileTree.innerHTML = "";
  if (!tree.children.length) {
    const empty = document.createElement("p");
    empty.className = "tree-empty";
    empty.textContent = "No Markdown files found in this folder.";
    fileTree.appendChild(empty);
    return;
  }
  fileTree.appendChild(renderTreeNodes(tree.children));
  highlightActiveFile();
}

async function loadFolderTree(path) {
  const tree = await invoke("read_markdown_tree", { path });
  currentFolderPath = path;
  localStorage.setItem("hinkmd-folder-path", path);
  closeSidebarSearch();
  renderTree(tree);
}

async function openFolder() {
  try {
    const path = await invoke("pick_folder");
    if (!path) return;
    await loadFolderTree(path);
    setSidebarVisible(true);
  } catch (error) {
    showToast(String(error), "error");
  }
}

openFolderButton.addEventListener("click", () => openFolder());
renderEmptyTreeState();

const storedFolderPath = localStorage.getItem("hinkmd-folder-path");
if (storedFolderPath) {
  loadFolderTree(storedFolderPath).catch(() => localStorage.removeItem("hinkmd-folder-path"));
}

function highlightSnippet(text, query) {
  const button = document.createElement("span");
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0 || !needle) {
    button.textContent = text;
    return button;
  }
  button.append(
    document.createTextNode(text.slice(0, index)),
    Object.assign(document.createElement("mark"), { textContent: text.slice(index, index + query.length) }),
    document.createTextNode(text.slice(index + query.length)),
  );
  return button;
}

function relativeToFolder(path) {
  if (!currentFolderPath) return path;
  const trimmed = path.startsWith(currentFolderPath) ? path.slice(currentFolderPath.length) : path;
  return trimmed.replace(/^[\\/]/, "");
}

async function openSearchMatch(path, lineNumber, query) {
  await openDocument(path);
  if (currentPath === path) revealMatchInEditor(lineNumber, query);
}

function renderSearchResults(results, query) {
  fileTree.innerHTML = "";
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "tree-empty";
    empty.textContent = "No matches found.";
    fileTree.appendChild(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "search-results";
  for (const file of results) {
    const item = document.createElement("li");
    item.className = "search-result-file";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "search-result-file-header";
    const nameRow = document.createElement("span");
    nameRow.className = "search-result-file-name";
    nameRow.appendChild(document.createTextNode(file.name));
    const pathRow = document.createElement("span");
    pathRow.className = "search-result-file-path";
    const relative = relativeToFolder(file.path);
    pathRow.textContent = relative === file.name ? "" : relative;
    header.append(nameRow, pathRow);
    header.addEventListener("click", () => {
      if (file.matches.length) item.classList.toggle("collapsed");
      else openDocument(file.path);
    });
    item.appendChild(header);

    if (file.matches.length) {
      const matchList = document.createElement("ul");
      matchList.className = "search-result-matches";
      for (const match of file.matches) {
        const matchItem = document.createElement("li");
        const matchButton = document.createElement("button");
        matchButton.type = "button";
        matchButton.className = "search-result-match";
        matchButton.title = `Line ${match.line}`;
        matchButton.appendChild(highlightSnippet(match.text, query));
        matchButton.addEventListener("click", () => openSearchMatch(file.path, match.line, query));
        matchItem.appendChild(matchButton);
        matchList.appendChild(matchItem);
      }
      item.appendChild(matchList);
    }

    list.appendChild(item);
  }
  fileTree.appendChild(list);
}

let searchTimer;
let searchRequestId = 0;

async function runSidebarSearch(query) {
  if (!currentFolderPath) return;
  if (!query.trim()) {
    if (currentTree) renderTree(currentTree);
    return;
  }
  const requestId = ++searchRequestId;
  try {
    const results = await invoke("search_markdown_files", { path: currentFolderPath, query });
    if (requestId === searchRequestId) renderSearchResults(results, query);
  } catch (error) {
    showToast(String(error), "error");
  }
}

function openSidebarSearch() {
  if (!currentFolderPath) {
    showToast("Open a folder first", "error");
    return;
  }
  setSidebarVisible(true);
  fileSearchBar.hidden = false;
  fileSearchInput.focus();
  fileSearchInput.select();
}

function closeSidebarSearch() {
  fileSearchBar.hidden = true;
  fileSearchInput.value = "";
  if (currentTree) renderTree(currentTree);
}

fileSearchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSidebarSearch(fileSearchInput.value), 150);
});
fileSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeSidebarSearch();
    editor.focus();
  }
});
fileSearchClose.addEventListener("click", () => {
  closeSidebarSearch();
  editor.focus();
});

const formattingToggle = document.querySelector("#formatting-toggle");
const formattingBar = document.querySelector("#formatting-bar");

function setFormattingVisible(visible) {
  formattingBar.hidden = !visible;
  formattingToggle.setAttribute("aria-expanded", String(visible));
  formattingToggle.title = `${visible ? "Hide" : "Show"} formatting toolbar`;
  localStorage.setItem("hinkmd-formatting-visible", String(visible));
}

setFormattingVisible(localStorage.getItem("hinkmd-formatting-visible") === "true");
formattingToggle.addEventListener("click", () => setFormattingVisible(formattingBar.hidden));

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

let renderTimer;
const RENDER_DEBOUNCE_MS = 120;

function renderPreview(content) {
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
  syncPreviewToCaret();
}

function updateDocument() {
  const content = editor.value;

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.ceil(words / 220));
  stats.textContent = `${words} ${words === 1 ? "word" : "words"} · ${readingTime} min read`;
  const dirty = content !== savedContent;
  dirtyDot.classList.toggle("visible", dirty);
  if (dirty !== reportedDirty) {
    reportedDirty = dirty;
    // Keep native close/quit protection in sync, including saves and undo.
    dirtyStateQueue = dirtyStateQueue.then(() => invoke("set_document_dirty", { dirty }))
      .catch((error) => {
        reportedDirty = undefined;
        showToast(`Could not update unsaved-changes protection: ${error}`, "error");
      });
  }
  document.title = `${dirty ? "• " : ""}${fileName.textContent} — Markduck`;

  // Coalesce the expensive lex/parse/sanitize/DOM rebuild across rapid keystrokes.
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderPreview(content), RENDER_DEBOUNCE_MS);
}

function scrollProgress(element) {
  const range = element.scrollHeight - element.clientHeight;
  return range > 0 ? element.scrollTop / range : 0;
}

function scrollPaneTo(element, top) {
  const limit = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollTo({ top: Math.max(0, Math.min(limit, top)), behavior: "instant" });
  // Ignore the resulting scroll event so the other pane does not bounce back.
  programmaticScrolls.set(element, element.scrollTop);
}

function scrollToProgress(element, progress) {
  const range = element.scrollHeight - element.clientHeight;
  scrollPaneTo(element, Math.max(0, range * progress));
}

function syncPaneScroll(source, target) {
  const expected = programmaticScrolls.get(source);
  programmaticScrolls.delete(source);
  if (expected !== undefined && Math.abs(source.scrollTop - expected) < 1) return;
  cancelAnimationFrame(syncFrame);
  syncFrame = requestAnimationFrame(() => {
    scrollToProgress(target, scrollProgress(source));
  });
}

function syncPreviewToCaret() {
  cancelAnimationFrame(syncFrame);
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
    scrollPaneTo(preview, targetY - focusY);
  }
}

const editorFindBar = document.querySelector("#editor-find-bar");
const editorFindInput = document.querySelector("#editor-find-input");
const editorFindCount = document.querySelector("#editor-find-count");
const editorFindPrev = document.querySelector("#editor-find-prev");
const editorFindNext = document.querySelector("#editor-find-next");
const editorFindClose = document.querySelector("#editor-find-close");

let findMatches = [];
let findIndex = -1;

function updateFindCount() {
  editorFindCount.textContent = findMatches.length ? `${findIndex + 1}/${findMatches.length}` : "0/0";
}

function updateFindMatches() {
  const query = editorFindInput.value;
  findMatches = [];
  if (query) {
    const content = editor.value.toLowerCase();
    const needle = query.toLowerCase();
    let index = content.indexOf(needle);
    while (index !== -1) {
      findMatches.push(index);
      index = content.indexOf(needle, index + needle.length);
    }
  }
  findIndex = findMatches.length ? 0 : -1;
  updateFindCount();
}

function selectFindMatch(index) {
  if (!findMatches.length) return;
  findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
  const start = findMatches[findIndex];
  const end = start + editorFindInput.value.length;
  editor.setSelectionRange(start, end);
  const totalLines = Math.max(1, editor.value.split("\n").length - 1);
  const line = editor.value.slice(0, start).split("\n").length - 1;
  scrollPaneTo(editor, editor.scrollHeight * (line / totalLines) - editor.clientHeight / 3);
  updateFindCount();
}

function openEditorFind() {
  editorFindBar.hidden = false;
  const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (selected && !selected.includes("\n")) editorFindInput.value = selected;
  updateFindMatches();
  if (findMatches.length) selectFindMatch(0);
  editorFindInput.focus();
  editorFindInput.select();
}

function closeEditorFind() {
  if (editorFindBar.hidden) return;
  editorFindBar.hidden = true;
  findMatches = [];
  findIndex = -1;
}

editorFindInput.addEventListener("input", () => {
  updateFindMatches();
  if (findMatches.length) selectFindMatch(0);
});
editorFindInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    selectFindMatch(findIndex + (event.shiftKey ? -1 : 1));
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeEditorFind();
    editor.focus();
  }
});
editorFindPrev.addEventListener("click", () => selectFindMatch(findIndex - 1));
editorFindNext.addEventListener("click", () => selectFindMatch(findIndex + 1));
editorFindClose.addEventListener("click", () => {
  closeEditorFind();
  editor.focus();
});

function revealMatchInEditor(lineNumber, query) {
  const lines = editor.value.split("\n");
  let offset = 0;
  for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  const lineText = lines[lineNumber - 1] ?? "";
  const withinLine = Math.max(0, lineText.toLowerCase().indexOf(query.toLowerCase()));
  const start = offset + withinLine;
  editor.focus();
  editor.setSelectionRange(start, start + query.length);
  const totalLines = Math.max(1, editor.value.split("\n").length - 1);
  scrollPaneTo(editor, editor.scrollHeight * ((lineNumber - 1) / totalLines) - editor.clientHeight / 3);
  syncPreviewToCaret();
}

function loadDocument(document) {
  currentPath = document.path;
  savedContent = document.content;
  editor.value = document.content;
  // Setting .value moves the caret to the end; put it back at the top
  // before rendering so the preview doesn't scroll to match it.
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  fileName.textContent = document.name;
  updateDocument();
  clearTimeout(renderTimer);
  renderPreview(document.content);
  editor.focus();
  highlightActiveFile();
  closeEditorFind();
}

async function openDocument(path = null) {
  try {
    if (editor.value !== savedContent && !(await invoke("confirm_discard_for_open"))) {
      return;
    }
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
    savedContent = result.content;
    updateDocument();
    showToast("Saved");
  } catch (error) {
    showToast(String(error), "error");
  }
}

editor.addEventListener("input", () => {
  updateDocument();
  syncPreviewToCaret();
  if (!editorFindBar.hidden) updateFindMatches();
});
editor.addEventListener("scroll", () => syncPaneScroll(editor, preview), { passive: true });
preview.addEventListener("scroll", () => syncPaneScroll(preview, editor), { passive: true });
editor.addEventListener("click", syncPreviewToCaret);
editor.addEventListener("keyup", syncPreviewToCaret);
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText("  ", start, editor.selectionEnd, "end");
    updateDocument();
  }
});

function applyFormatting(action) {
  const edit = formatMarkdown(editor.value, editor.selectionStart, editor.selectionEnd, action);
  editor.focus();
  editor.setSelectionRange(edit.start, edit.end);
  // Native insertion keeps toolbar edits in the textarea's undo history.
  if (!document.execCommand("insertText", false, edit.text)) {
    editor.setRangeText(edit.text, edit.start, edit.end, "end");
  }
  editor.setSelectionRange(edit.start + edit.selectStart, edit.start + edit.selectEnd);
  updateDocument();
  syncPreviewToCaret();
}

document.querySelectorAll("[data-format]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => applyFormatting(button.dataset.format));
});
const markdownHelp = document.querySelector("#markdown-help");
document.querySelector("#markdown-help-button").addEventListener("click", () => markdownHelp.showModal());

document.querySelector("#open-button").addEventListener("click", () => openDocument());
document.querySelector("#save-button").addEventListener("click", saveDocument);

document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  if (markdownHelp.open) return;
  const format = { b: "bold", i: "italic", k: "link" }[event.key.toLowerCase()];
  if (format && document.activeElement === editor) {
    event.preventDefault();
    applyFormatting(format);
    return;
  }
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
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    if (event.shiftKey) openSidebarSearch();
    else openEditorFind();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (editor.value !== savedContent) event.preventDefault();
});

const assignedFile = await invoke("take_window_file");
if (assignedFile) await openDocument(assignedFile);
else updateDocument();
