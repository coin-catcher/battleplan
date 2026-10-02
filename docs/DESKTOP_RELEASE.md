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

## Cutting a release

1. Update `version` in `package.json` on `develop` to match the tag you will push (for example `1.0.1`).
2. Commit and push, then create and push the tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. The **Release Battleplan desktop** workflow runs on that tag push. It builds Windows, macOS, and Linux installers in parallel, then a single publish job uploads all assets to the GitHub Release (avoids race conditions from parallel publishers).

### Release page vs installer assets

GitHub always adds **Source code (zip/tar.gz)** when a tag exists. Those are not the desktop app. Installer files look like `battleplan-1.0.0-mac.dmg`, `battleplan-1.0.0-win.exe`, and `battleplan-1.0.0-linux.AppImage`.

You may publish the release notes before or after the workflow finishes. If you create the release yourself, publish it normally — the workflow is configured with `releaseType: "release"` so `electron-builder` attaches binaries to an existing published release.

If a tag build failed partway (for example only source archives appear), open **Actions → Release Battleplan desktop → Run workflow**, enter the tag (e.g. `v1.0.0`), and run it again. No need to move the tag.

### First release

For `v1.0.0`, use the release description to summarize what Battleplan is for. Later tags should list user-visible changes.

The desktop app checks GitHub Releases on startup. When a newer tag is available, it prompts to download and restart into the updated build.

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
