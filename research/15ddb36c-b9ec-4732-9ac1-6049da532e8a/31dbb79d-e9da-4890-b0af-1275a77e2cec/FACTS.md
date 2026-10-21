# Facts — Local Hermes (environment lookup)

Facts below were gathered from the Battleplan repo and Hermes Agent upstream docs. They inform the design interview; they are **not** decisions.

## Battleplan repository

- **No Docker artifacts** in battleplan today: no `Dockerfile`, no `docker-compose*.yml`.
- **Hermes connector foundation** exists in application code:
  - `src/app/core/agent-connector.ts` — connector kinds, Hermes kanban status ↔ Battleplan task status.
  - `ProjectTask` fields: `connector_kind`, `backend_idempotency_key`, `backend_run_id` (`src/app/core/models.ts`).
  - Generate Tasks JSON accepts `connector_kind: hermes` (`docs/GENERATE_TASKS.md`).
- **Planned connector registry** (not persisted on `ProjectDocument` yet): `research/.../d51c-graph-of-agents/connector-schema.json` — `connectors[]` with `endpoint`, `healthy`, `max_in_progress`.
- **Planned Electron Docker lifecycle:** d51c **Task 18** — subproject `default_hermes_connector_id`, start/stop container, health → registry; WSL note for Windows.
- **Parallel pattern for local services:** LocalLLM uses Electron main-process HTTP + `GET {origin}/health` (`docs/LOCAL_LLM.md`, `electron/agent-connection.ts`).
- **Catalog pattern to mirror:** Agent Library research uses `agent-types.yaml` → runtime registry + `agents[]` in `project_config.json` (`research/.../86575162-.../`).

## Hermes Agent upstream (NousResearch/hermes-agent)

- **Image:** `nousresearch/hermes-agent` (stateless; all mutable state on host mount).
- **Data directory:** host `~/.hermes` → container `/opt/data` (config, `.env`, profiles, kanban DB, sessions, skills, memories).
- **First-time setup:** `docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup`.
- **Gateway (persistent):** `docker run -d --name hermes --restart unless-stopped -v ~/.hermes:/opt/data -p 8642:8642 nousresearch/hermes-agent gateway run`.
- **Port 8642:** OpenAI-compatible API + health (needed for dashboard / external tools; optional if chat-only).
- **Supervision:** s6-overlay supervises gateway (and dashboard when enabled); do not run two gateway containers against the **same** data directory concurrently.
- **Multi-profile (recommended):** **One container, many profiles** under `/opt/data/profiles/<name>/` — each profile gets an s6 `gateway-<name>` slot; create with `hermes profile create <name>` inside the container. Separate containers per profile are reserved for isolation/pinning/network segmentation.
- **Kanban:** Durable board in `~/.hermes/kanban.db`; dispatcher runs in gateway by default; workers are assigned **profile names**; statuses align with Battleplan mapping (`triage`, `todo`, `ready`, `running`, `review`, `blocked`, `done`, `archived`).
- **Docker-backed kanban workers:** Terminal backend can spawn task-scoped Docker workers with host-backed workspace mounts (recent upstream work on fail-closed remote `DOCKER_HOST` and mount authority).
- **Upstream compose:** `docker-compose.yml` in hermes-agent repo uses `network_mode: host`, `HERMES_UID`/`HERMES_GID`, optional separate `dashboard` service on localhost.

## Implications for “common profile + catalog”

- Hermes **profiles are native** to the mounted data dir; a “catalog” in Battleplan likely **materializes** into `~/.hermes/profiles/` (or a declared mount path), not replace Hermes’s on-disk layout.
- **Specialized agents** in Battleplan terms may map to: Hermes profile names, kanban assignees, and/or connector + endpoint entries — exact mapping is a **design decision** (interview).
- Battleplan **must not** assume Hermes repo URL was vendored in battleplan; link is external ([references.json](./references.json)).
