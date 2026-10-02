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

1. Update `version` in `package.json` to match the tag (for example `1.0.1`).
2. Commit and push a tag such as `v1.0.1`.
3. Optionally edit the GitHub Release notes to summarize user-visible changes. The first release should describe what Battleplan is for.
4. The `Release Battleplan desktop` workflow builds Windows, macOS, and Linux installers and attaches them to the release.

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
