# Mindmap testing framework

## Pipeline (drag-drop)

See `src/app/core/mindmap-drag-pipeline.ts` for the call graph and pure helpers.

| Layer | Location | Command |
| --- | --- | --- |
| Pipeline unit tests | `mindmap-drag-pipeline.test.ts`, `mindmap-idb-migration.test.ts` | `npm run test:local` |
| Mindmap scenarios / coverage | `mindmap-scenarios.test.ts`, `mindmap.test.ts` | `npm run test:coverage` |
| Harness drag (Puppeteer, no Angular) | `e2e/mindmap-drag.test.ts` | `npm run test:mindmap-e2e` |
| **Angular UI (Playwright)** | `playwright/mindmap-drag.spec.ts` | `npm run test:playwright` |

## Playwright (preferred UI)

1. Seeds IndexedDB + `localStorage` via `playwright/helpers/seed-mindmap.ts`.
2. Starts `ng serve` automatically (`playwright.config.ts` `webServer`).
3. Uses real pointer input on `.map-node[data-node-id="…"]`.
4. Asserts DOM ↔ IndexedDB pin after drag and after reload.

Install browsers once: `npx playwright install chromium`.

## Definition of done (mindmap features)

1. Add or update pipeline unit tests for each new step in the call graph.
2. Run `npm run test:local` and `npm run test:coverage` (mindmap modules ≥ 80% lines).
3. Run `npm run test:playwright` for any change that affects pointer interaction or persistence.
4. If a test fails, fix the product code and re-run the full suite before marking the feature done.
5. Optionally keep `npm run test:mindmap-e2e` for fast harness-only regression checks.

## Improvements

- Add Playwright specs for project drag, link-handle drag, marquee selection, and graph-recovery staged reveal.
- Wire `test:playwright` into CI after `build:electron`.
- Export a small `BattleplanStore` test double to assert `commitMindmapPosition` → `placeNode` without a browser.