# Upstream Hermes Docker — notes for Local Hermes design

Condensed from [Hermes Docker docs](https://hermes-agent.nousresearch.com/docs/user-guide/docker) and `hermes-agent` `docker-compose.yml`.

## Minimal lifecycle

```sh
mkdir -p ~/.hermes
docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup
docker run -d --name hermes --restart unless-stopped \
  -v ~/.hermes:/opt/data -p 8642:8642 \
  nousresearch/hermes-agent gateway run
```

## Compose-oriented production pattern (upstream)

- Set `HERMES_UID` / `HERMES_GID` to host owner of `~/.hermes`.
- `network_mode: host` in upstream compose (simplifies multi-port profiles).
- Optional second service: `dashboard --host 127.0.0.1` (port 9119); Desktop uses dashboard backend for multi-profile switching.
- Keep `/init` entrypoint — bypass breaks s6 profile reconcile and gateway supervision.

## Multi-profile operations (inside running container)

```sh
docker exec hermes hermes profile create coder
docker exec hermes hermes -p coder gateway start
```

Profile-specific API ports go in **each profile’s `.env`**, not global container env.

## Constraints to respect in Battleplan catalog/sync design

1. Never mount the same `~/.hermes` into two running gateway containers.
2. Profile create on **host** against bind mount does not register s6 slot until `gateway start` **inside** container.
3. Kanban assignees reference **profile names** known to the Hermes home that runs the dispatcher.
4. Docker kanban workers need host-backed task workspaces; remote `DOCKER_HOST` without shared FS requires explicit config or fails closed (upstream).

## Suggested health check for Battleplan connector

Align with LocalLLM pattern: probe gateway origin (e.g. `http://127.0.0.1:8642`) health or OpenAI `/v1/models` when API server enabled — exact path to be confirmed in connector spike against running container.
