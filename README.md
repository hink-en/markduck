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

The [macOS release workflow](.github/workflows/release.yml) builds a universal app
and publishes a GitHub Release when a `v*` tag is pushed. It uploads a DMG and a
zipped `.app` after the build succeeds. Tags containing a hyphen (such as
`v0.2.0-beta.1`) are published as prereleases.

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml`. Refresh and commit both lockfiles along with those changes
   (`npm install --package-lock-only` and `cargo check --manifest-path src-tauri/Cargo.toml`).
2. Commit and push the release changes, including the workflow.
3. Tag that commit with the matching version and push the tag:

   ```sh
   git tag v0.1.4
   git push origin v0.1.4
   ```

Use your new version in place of `v0.1.4`. The workflow uses GitHub's built-in
token; no additional repository secrets are needed. Rerunning a successful
release replaces its uploaded assets. Apple signing and notarization are not
configured in this workflow.

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
