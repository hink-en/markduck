use serde::Serialize;
use std::{
    collections::HashMap,
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
    assignments: Mutex<HashMap<String, String>>,
    ready: AtomicBool,
    next_id: AtomicUsize,
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
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Could not open file: {error}"))?;
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
    let label = format!(
        "document-{}",
        state.next_id.fetch_add(1, Ordering::Relaxed)
    );
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
            take_window_file
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
        .expect("error while building HinkMD");

    app.run(|handle, event| {
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
