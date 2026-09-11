use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
};
use tauri::Manager;

#[derive(Default)]
struct DocumentWindows {
    pending_launch: Mutex<Vec<String>>,
    unsaved: Mutex<HashSet<String>>,
    assignments: Mutex<HashMap<String, String>>,
    ready: AtomicBool,
    next_id: AtomicUsize,
}

#[tauri::command]
fn set_document_dirty(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DocumentWindows>,
    dirty: bool,
) {
    let mut unsaved = state
        .unsaved
        .lock()
        .expect("unsaved document lock poisoned");
    if dirty {
        unsaved.insert(window.label().to_owned());
    } else {
        unsaved.remove(window.label());
    }
}

enum DiscardReason {
    Quit,
    Close,
    Open,
}

fn confirm_discard(reason: DiscardReason) -> bool {
    let (action, description) = match reason {
        DiscardReason::Quit => (
            "Quit Without Saving",
            "You have unsaved changes in one or more documents. Quitting will discard them. Cancel to return to the editor and save your work.",
        ),
        DiscardReason::Close => (
            "Close Without Saving",
            "This document has unsaved changes. Closing it will discard them. Cancel to return to the editor and save your work.",
        ),
        DiscardReason::Open => (
            "Open Without Saving",
            "This document has unsaved changes. Opening another file will discard them. Cancel to return to the editor and save your work.",
        ),
    };
    rfd::MessageDialog::new()
        .set_title("Unsaved changes")
        .set_description(description)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            "Cancel".into(),
            action.into(),
        ))
        .show()
        == rfd::MessageDialogResult::Custom(action.into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    name: String,
    content: String,
}

fn markdown_path(path: PathBuf) -> Result<PathBuf, String> {
    let extension = path.extension().and_then(|value| value.to_str());
    match extension.map(str::to_ascii_lowercase).as_deref() {
        Some("md" | "markdown" | "mdown" | "mkd") => Ok(path),
        _ => Err("Please choose a Markdown file".into()),
    }
}

fn load_document(path: PathBuf) -> Result<Document, String> {
    let path = markdown_path(path)?;
    let content =
        std::fs::read_to_string(&path).map_err(|error| format!("Could not open file: {error}"))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.md")
        .to_owned();
    Ok(Document {
        path: path.to_string_lossy().into_owned(),
        name,
        content,
    })
}

#[tauri::command]
fn read_file(path: String) -> Result<Document, String> {
    load_document(PathBuf::from(path))
}

const SKIPPED_DIR_NAMES: [&str; 5] = ["node_modules", ".git", "target", "dist", ".venv"];
const MAX_TREE_DEPTH: u8 = 24;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<TreeNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderTree {
    name: String,
    path: String,
    children: Vec<TreeNode>,
}

fn is_markdown_extension(path: &std::path::Path) -> bool {
    let extension = path.extension().and_then(|value| value.to_str());
    matches!(
        extension.map(str::to_ascii_lowercase).as_deref(),
        Some("md" | "markdown" | "mdown" | "mkd")
    )
}

fn build_markdown_tree(dir: &std::path::Path, depth: u8) -> Result<Vec<TreeNode>, String> {
    if depth > MAX_TREE_DEPTH {
        return Ok(Vec::new());
    }

    let entries =
        std::fs::read_dir(dir).map_err(|error| format!("Could not read folder: {error}"))?;

    let mut nodes = Vec::new();
    for entry in entries.filter_map(|entry| entry.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();

        if file_type.is_dir() {
            if SKIPPED_DIR_NAMES.contains(&name.as_str()) {
                continue;
            }
            let children = build_markdown_tree(&path, depth + 1)?;
            if !children.is_empty() {
                nodes.push(TreeNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir: true,
                    children,
                });
            }
        } else if file_type.is_file() && is_markdown_extension(&path) {
            nodes.push(TreeNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_markdown_tree(path: String) -> Result<FolderTree, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err("That folder could not be found".into());
    }
    let children = build_markdown_tree(&dir, 0)?;
    let name = dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_owned();
    Ok(FolderTree { name, path, children })
}

#[tauri::command]
fn pick_file() -> Result<Option<Document>, String> {
    rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
        .pick_file()
        .map(load_document)
        .transpose()
}

#[tauri::command]
fn save_file(path: Option<String>, content: String) -> Result<Option<Document>, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::FileDialog::new()
            .add_filter("Markdown", &["md"])
            .set_file_name("Untitled.md")
            .save_file()
        {
            Some(path) => path,
            None => return Ok(None),
        },
    };

    std::fs::write(&path, &content).map_err(|error| format!("Could not save file: {error}"))?;
    load_document(path).map(Some)
}

#[tauri::command]
fn confirm_discard_for_open() -> bool {
    confirm_discard(DiscardReason::Open)
}

#[tauri::command]
fn take_window_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DocumentWindows>,
) -> Option<String> {
    state
        .assignments
        .lock()
        .expect("window assignment lock poisoned")
        .remove(window.label())
}

fn create_document_window(handle: &tauri::AppHandle, path: String) -> tauri::Result<()> {
    let state = handle.state::<DocumentWindows>();
    let label = format!("document-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    state
        .assignments
        .lock()
        .expect("window assignment lock poisoned")
        .insert(label.clone(), path);

    let mut config = handle.config().app.windows[0].clone();
    config.label = label.clone();
    if let Err(error) = tauri::WebviewWindowBuilder::from_config(handle, &config)?.build() {
        state
            .assignments
            .lock()
            .expect("window assignment lock poisoned")
            .remove(&label);
        return Err(error);
    }
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(DocumentWindows::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            pick_file,
            save_file,
            take_window_file,
            set_document_dirty,
            confirm_discard_for_open,
            pick_folder,
            read_markdown_tree
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let launch_files: Vec<String> = std::env::args()
                .skip(1)
                .map(PathBuf::from)
                .filter(|path| path.is_file())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            let state = app.state::<DocumentWindows>();
            let files = {
                let mut pending = state
                    .pending_launch
                    .lock()
                    .expect("pending launch lock poisoned");
                pending.extend(launch_files);
                std::mem::take(&mut *pending)
            };

            let mut files = files.into_iter();
            if let Some(path) = files.next() {
                state
                    .assignments
                    .lock()
                    .expect("window assignment lock poisoned")
                    .insert("main".into(), path);
            }
            for path in files {
                create_document_window(app.handle(), path)?;
            }
            state.ready.store(true, Ordering::Release);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Markduck");

    app.run(|handle, event| {
        match &event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let dirty = !handle
                    .state::<DocumentWindows>()
                    .unsaved
                    .lock()
                    .expect("unsaved document lock poisoned")
                    .is_empty();
                if dirty && !confirm_discard(DiscardReason::Quit) {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                let state = handle.state::<DocumentWindows>();
                let dirty = state
                    .unsaved
                    .lock()
                    .expect("unsaved document lock poisoned")
                    .contains(label);
                if dirty && !confirm_discard(DiscardReason::Close) {
                    api.prevent_close();
                } else {
                    state
                        .unsaved
                        .lock()
                        .expect("unsaved document lock poisoned")
                        .remove(label);
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                handle
                    .state::<DocumentWindows>()
                    .unsaved
                    .lock()
                    .expect("unsaved document lock poisoned")
                    .remove(label);
            }
            _ => {}
        }

        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            let state = handle.state::<DocumentWindows>();
            if state.ready.load(Ordering::Acquire) {
                for path in paths {
                    let _ = create_document_window(handle, path);
                }
            } else {
                state
                    .pending_launch
                    .lock()
                    .expect("pending launch lock poisoned")
                    .extend(paths);
            }
        }
    });
}
