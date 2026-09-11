# Markduck

<img src="app-icon.png" alt="Markduck duck logo" width="160">

Markduck is a focused Markdown editor for macOS, built with Rust and Tauri. It combines a distraction-free source editor with a live rendered preview in a compact native desktop application.

## Features

- Side-by-side Markdown editor and live preview
- GitHub Flavored Markdown, including tables and task lists
- Sanitized preview output
- Synchronized editor and preview scrolling
- Native macOS open and save dialogs
- Finder integration for `.md`, `.markdown`, `.mdown`, and `.mkd` files
- Separate windows when additional Markdown files are opened from Finder
- Persistent light and dark themes
- Word count and estimated reading time
- Unsaved-change indicator
- Native macOS title bar, window dragging, and application icon

## Using Markduck

Use **Open** or `Command-O` to load a Markdown document into the current window. Use **Save** or `Command-S` to save changes. A new document prompts for a destination the first time it is saved.

Closing a window or quitting with unsaved changes shows a warning. Choose
**Cancel** to return and save, or explicitly close/quit without saving. Quitting
checks all open document windows.

Scrolling either pane moves the other to the same relative position. Editing or moving the caret in the Markdown editor keeps the related preview content in view. You can select text and click links in the preview without moving the editor caret.

The sun/moon button in the title bar switches between light and dark themes. Markduck stores the selected theme locally and restores it at the next launch.

Opening another Markdown file from Finder creates a separate Markduck window. macOS may suppress a second request for a file that is already open.

## Install

Download the universal macOS DMG from [GitHub Releases](https://github.com/hink-en/markduck/releases/latest). It supports both Apple Silicon and Intel Macs. Open the DMG and drag **Markduck** into Applications.

Release builds are not Developer ID signed or notarized by Apple, so macOS may block opening the downloaded app.

### Build from source

Build the application:

```sh
npm install
npm run tauri build
```

The generated packages are located at:

- Application: `src-tauri/target/release/bundle/macos/Markduck.app`
- Disk image: `src-tauri/target/release/bundle/dmg/Markduck_<version>_aarch64.dmg`

Open the DMG and drag **Markduck** into the Applications folder.

## Writing with Markdown

Click **Formatting** at the bottom left to show or hide the toolbar. It starts
hidden and remembers your preference between launches. Formatting shortcuts
work even when the toolbar is hidden.

Select text and use the formatting toolbar for bold, italic, headings, links,
lists, checklists, quotes, or code. With no selection, it inserts editable example
text or formats the current line. The Table button inserts a starter table.
Changes appear immediately in the preview. Use **Markdown help** for a short
cheat sheet, and press Escape or Close to dismiss it.

While editing, use `Command-B` for bold, `Command-I` for italic, and `Command-K`
for a link. For links on selected text, the example URL is selected so you can
replace it with the real address.

## Set As Default

To make Markduck the default application for Markdown documents:

1. Select an `.md` file in Finder.
2. Press `Command-I` to open **Get Info**.
3. Expand **Open with** and select **Markduck**.
4. Click **Change All**.
5. Confirm the change when macOS prompts you.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Command-O` | Open a Markdown file in the current window |
| `Command-S` | Save the current document |
| `Command-Plus` / `Command-Minus` | Increase / decrease UI text size |
| `Command-0` | Reset text size to 100% |
| `Tab` | Insert two spaces in the editor |

Use the **Text size** controls at the bottom of the window to zoom from 75% to 200%. The setting is remembered between launches and does not change your Markdown files.

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

If a build fails after moving the project and references the old directory (for
example, `failed to read plugin permissions`), clear Rust's generated build
artifacts and rebuild from the project root:

```sh
cargo clean --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Check the Rust application:

```sh
cd src-tauri
cargo check
cargo test
```

## Publishing a release

Releases are fully automated. Every merge to `main` publishes a new release —
no manual version bump or tagging is needed.

1. **[Bump version and tag](.github/workflows/auto-release.yml)** runs on every
   push to `main`. It increments the patch version (e.g. `0.1.6` → `0.1.7`) in
   `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`, commits that bump with
   `[skip release]` in the message, then creates and pushes a matching `vX.Y.Z`
   tag. The `[skip release]` marker stops this workflow from re-triggering on
   its own bump commit.
2. **[Release macOS](.github/workflows/release.yml)** runs when a `v*` tag is
   pushed. It builds a universal macOS app and publishes a GitHub Release,
   uploading a DMG and a zipped `.app`. Tags containing a hyphen (such as
   `v0.2.0-beta.1`) are published as prereleases. Rerunning a successful
   release replaces its uploaded assets. Apple signing and notarization are
   not configured.

To skip a release for a given merge (e.g. a docs-only change), include
`[skip release]` in that commit's message yourself.

### One-time setup: `RELEASE_TOKEN` secret

The bump-and-tag job pushes using a **personal access token** stored as the
`RELEASE_TOKEN` repository secret, not the default `GITHUB_TOKEN`. This is
required: pushes made with the default `GITHUB_TOKEN` are not allowed to
trigger other workflow runs, so the pushed tag would never start the release
workflow.

To set it up: create a fine-grained PAT scoped to this repository with
**Contents: Read and write** permission, then add it under
**Settings → Secrets and variables → Actions** as `RELEASE_TOKEN`.

### Manual releases

To cut a release without waiting for a merge, either push a `v*` tag by hand
(same three version files must already match that tag), or run the
"Bump version and tag" workflow manually via **Actions → Bump version and
tag → Run workflow**.

## Architecture

- `src-tauri/`: Rust application shell, native file I/O, Finder document events, window management, and bundle configuration
- `src/`: Editor behavior, Markdown rendering, preview synchronization, and theme handling
- `index.html`: Application window structure and controls

Markdown rendering uses `marked`, and generated HTML is sanitized with `DOMPurify` before being inserted into the preview. Tauri handles native macOS integration and packages the application as an `.app` and DMG.

## App icon

The duck logo source is `app-icon.png`. Regenerate the platform icons with:

```sh
npm run tauri icon app-icon.png
```

The app keeps its original bundle identifier and preference keys so existing
installations retain their settings after the rename.
