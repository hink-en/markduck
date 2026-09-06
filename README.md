# HinkMD

HinkMD is a focused Markdown editor for macOS, built with Rust and Tauri. It combines a distraction-free source editor with a live rendered preview in a compact native desktop application.

## Features

- Side-by-side Markdown editor and live preview
- GitHub Flavored Markdown, including tables and task lists
- Sanitized preview output
- Synchronized editor and preview scrolling
- Click-to-navigate from a preview block to its Markdown source
- Native macOS open and save dialogs
- Finder integration for `.md`, `.markdown`, `.mdown`, and `.mkd` files
- Separate windows when additional Markdown files are opened from Finder
- Persistent light and dark themes
- Word count and estimated reading time
- Unsaved-change indicator
- Native macOS title bar, window dragging, and application icon

## Using HinkMD

Use **Open** or `Command-O` to load a Markdown document into the current window. Use **Save** or `Command-S` to save changes. A new document prompts for a destination the first time it is saved.

Scrolling or moving the caret in the editor keeps the related preview content in view. Clicking rendered content in the preview moves the editor caret to the corresponding source location.

The sun/moon button in the title bar switches between light and dark themes. HinkMD stores the selected theme locally and restores it at the next launch.

Opening another Markdown file from Finder creates a separate HinkMD window. macOS may suppress a second request for a file that is already open.

## Install

Build the application:

```sh
npm install
npm run tauri build
```

The generated packages are located at:

- Application: `src-tauri/target/release/bundle/macos/HinkMD.app`
- Disk image: `src-tauri/target/release/bundle/dmg/HinkMD_<version>_aarch64.dmg`

Open the DMG and drag **HinkMD** into the Applications folder.

## Set As Default

To make HinkMD the default application for Markdown documents:

1. Select an `.md` file in Finder.
2. Press `Command-I` to open **Get Info**.
3. Expand **Open with** and select **HinkMD**.
4. Click **Change All**.
5. Confirm the change when macOS prompts you.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Command-O` | Open a Markdown file in the current window |
| `Command-S` | Save the current document |
| `Tab` | Insert two spaces in the editor |

## Development

### Requirements

- macOS
- Rust and Cargo
- Node.js and npm
- Apple developer command-line tools required by Tauri

Install dependencies and start the development application:

```sh
npm install
npm run tauri dev
```

Build only the web frontend:

```sh
npm run build
```

Check the Rust application:

```sh
cd src-tauri
cargo check
cargo test
```

## Architecture

- `src-tauri/`: Rust application shell, native file I/O, Finder document events, window management, and bundle configuration
- `src/`: Editor behavior, Markdown rendering, preview synchronization, and theme handling
- `index.html`: Application window structure and controls

Markdown rendering uses `marked`, and generated HTML is sanitized with `DOMPurify` before being inserted into the preview. Tauri handles native macOS integration and packages the application as an `.app` and DMG.
