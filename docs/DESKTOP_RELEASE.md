# Battleplan desktop releases

Battleplan ships as a cross-platform Electron app. GitHub Releases host tagged builds for Windows, macOS, and Linux.

## What the app is

Battleplan is the planning surface for a project, as a mindmap over Cursor Cloud Agents. You keep project conversation in the UI, generate ordered tasks, run code or research agents, and review pull requests from the same dashboard.

## Desktop data layout

Live data lives under the Electron user data directory in per-project folders:

```
<userData>/projects/
  app_config.json
  <project_id>/
    project_config.json
    <task_id>/
      task_config.json
      output.png
```

`app_config.json` stores the current project, Cursor API key, theme, and pane width. Project and task JSON files store messages, outputs, and text artifacts. Binary artifacts are stored as files beside the JSON, with paths recorded in the document.

## Export and import

Use **Import project** / **Export project** in the sidebar to move a project as a single `*.battleplan` ZIP archive (JSON plus artifact files).

## Automated releases

Two entry points share the same build/publish jobs:

1. **Tag desktop release** — runs when commits land on `develop` or `main`. It creates the tag, then immediately builds and publishes installers (GitHub does not auto-start a second workflow when the tag is pushed by `GITHUB_TOKEN`).
2. **Release Battleplan desktop** — runs when a tag is pushed manually or via **Run workflow**; uses the same reusable build/publish pipeline.

### `develop` (test builds)

Each push to `develop` (including when a PR merges) creates a unique tag:

`v{package.json version}-test-{unix epoch}`

Example: `v1.0.7-test-1790978815`

Installers are published to a GitHub Release for that tag. These are for validation; the desktop app’s updater targets normal semver releases on `main`.

### `main` (production builds)

Each push to `main` creates:

`v{package.json version}`

Example: `v1.0.7`

Bump `version` in `package.json` before merging to `main`. If that tag already exists, the tag job fails and no duplicate production release is created.

### Release assets

GitHub also attaches **Source code (zip/tar.gz)** on every tag. Installers are the `battleplan-*` files, for example:

- `battleplan-1.0.7-win.exe`
- `battleplan-1.0.7-mac.dmg` / `.zip`
- `battleplan-1.0.7-linux.AppImage` / `.deb`

### Manual re-run

**Actions → Release Battleplan desktop → Run workflow** and enter an existing tag (e.g. `v1.0.1`) to rebuild and re-upload installers without moving the tag.

The desktop app checks GitHub Releases on startup using the GitHub PAT saved under **File → GitHub Token (Updates)**. It compares the installed semver with the newest production tag (excluding `v*-test-*` develop builds). When a newer release is available, it prompts to download the platform installer from that release and install it.

## Local development

```bash
npm install
npm run electron:dev
```

Production-like local run:

```bash
npm run electron:start
```

Build installers locally (no publish):

```bash
npm run dist
```
