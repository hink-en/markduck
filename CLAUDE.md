# Markduck

A focused Markdown editor with a live rendered preview, built as a native
desktop app with [Tauri](https://tauri.app) (Rust backend + web frontend).

## Target platforms

Markduck **shall work on both macOS and Linux.** Today the app is built and
shipped for macOS only (the release pipeline, `src-tauri/tauri.conf.json`'s
`titleBarStyle`/`trafficLightPosition`/`macOSPrivateApi`, and the single
`#[cfg(target_os = "macos")]` block in [lib.rs](src-tauri/src/lib.rs) are all
macOS-specific), so treat Linux support as an active goal rather than a
finished feature. When changing platform-facing code (window chrome, file
dialogs, Finder/file-manager integration, keyboard shortcuts), avoid adding
new macOS-only assumptions, and prefer `cfg`-gating platform-specific behavior
over hard-coding it.

## Stack and architecture

- **`src-tauri/`** — Rust application shell (Tauri 2). Owns native file I/O,
  window management/creation for multi-document editing, unsaved-changes
  confirmation dialogs (via `rfd`), and "open with Markduck" / launch-file
  handling. Entry point: [lib.rs](src-tauri/src/lib.rs) (`run()`); binary
  entry is the 3-line [main.rs](src-tauri/src/main.rs).
- **`src/`** — Frontend (vanilla JS + Vite, no framework).
  - [main.js](src/main.js) — editor/preview wiring, Tauri IPC calls, scroll
    sync, theme, window-dirty tracking.
  - [formatting.js](src/formatting.js) — Markdown formatting toolbar actions.
  - [styles.css](src/styles.css) — all styling (light/dark themes).
  - [index.html](index.html) — window structure and controls.
- Markdown is rendered with `marked` and sanitized with `DOMPurify` before
  being inserted into the preview pane.
- Frontend ↔ backend communication goes through Tauri's `invoke` IPC
  (commands: `read_file`, `pick_file`, `save_file`, `take_window_file`,
  `set_document_dirty`), gated by the ACL in
  [capabilities/default.json](src-tauri/capabilities/default.json).

## Development

```sh
npm install
npm run tauri dev    # run the app with hot reload
npm run build         # build frontend only (vite)
npm run tauri build   # build the full native app + installer bundle
```

Rust-only checks (from `src-tauri/`): `cargo check`, `cargo test`.

Requirements: Rust/Cargo, Node.js/npm, and platform build tools (Xcode
command-line tools on macOS; the Tauri Linux prerequisites — e.g.
`libwebkit2gtk`, `libgtk-3-dev` — on Linux).

## Versioning and releases

Version is tracked in three places that must always match:
`package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
(`release.yml` enforces this before building). The two lockfiles
(`package-lock.json`, `src-tauri/Cargo.lock`) mirror it too.

**Releases are automatic on merge to `main`** via two chained workflows:

1. [`auto-release.yml`](.github/workflows/auto-release.yml) ("Bump version
   and tag") — runs on every push to `main`. Bumps the patch version across
   all five version-bearing files, then opens a PR with that bump and
   merges it immediately, since `main` has a repository ruleset requiring
   changes via PR (it requires 0 approvals, so this stays fully automatic).
   The bump commit message includes `[skip release]`, so the workflow
   doesn't re-trigger itself when that merge lands. It then creates and
   pushes a `vX.Y.Z` tag. It authenticates with the `RELEASE_TOKEN` repo
   secret (a PAT with Contents and Pull requests write access), **not** the
   default `GITHUB_TOKEN` — pushes/merges made with `GITHUB_TOKEN` cannot
   trigger other workflows, so the tag push would otherwise never reach
   step 2.
2. [`release.yml`](.github/workflows/release.yml) ("Release macOS") — runs
   when a `v*` tag is pushed. Builds a universal macOS app/DMG and publishes
   a GitHub Release (prerelease if the tag has a hyphen, e.g. `-beta.1`).
   Uses the default `GITHUB_TOKEN`; no extra secrets needed for this step.

To skip auto-releasing a merge (e.g. a docs-only change), include
`[skip release]` in that commit's message. Full setup/operational details are
in the README's [Publishing a release](README.md#publishing-a-release)
section.
