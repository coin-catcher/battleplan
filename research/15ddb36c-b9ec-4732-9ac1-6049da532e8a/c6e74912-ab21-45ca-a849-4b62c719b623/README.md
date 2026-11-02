# Skills Library — Research Summary

**BattlePlan research task:** Skills Library  
**Scope:** How BattlePlan can help users import agent skills from the internet, browse a curated catalog, and pair tasks with opinionated architecture stacks so Cloud Agents ship with a consistent technology baseline.

## Problem

Cloud Agents only reliably use skills that exist **in the task repository** (`.cursor/skills/`, `.agents/skills/`) or in the **environment image**. User-level skills on a laptop do not travel to Cloud Agents. BattlePlan already injects hierarchical **Data and Rules (DAR)** into every agent launch (`collectTaskDarSections` in `src/app/core/dar.ts`, assembled in `launchWithFirstMessage` in `src/app/data/local-engine.ts`). A Skills Library should extend that model: curated skills + architecture templates become first-class project/task metadata, then materialize into the repo before or during code-task execution.

## Deliverables in this folder

| File | Purpose |
|------|---------|
| [TASKS.md](./TASKS.md) | **Primary output:** ordered implementation tasks with acceptance criteria |
| [skill-repositories.csv](./skill-repositories.csv) | Known skill sources to ingest or link |
| [recommended-skills.yaml](./recommended-skills.yaml) | BattlePlan “starter set” (featured + recommended) |
| [architecture-stacks.yaml](./architecture-stacks.yaml) | Opinionated stacks aligned to task goals |
| [catalog-schema.json](./catalog-schema.json) | JSON Schema for the curated catalog |
| [organization-taxonomy.yaml](./organization-taxonomy.yaml) | High-level browsing categories |

## Design principles

1. **Repo-local skills for Cloud Agents** — Import means writing skill folders into the target git repo (usually via a dedicated “bootstrap skills” code task or PR), not only bookmarking a URL.
2. **Curate, don’t crawl blindly** — Start from official marketplaces (`cursor/plugins`, `anthropics/skills`) and indexed lists (`VoltAgent/awesome-agent-skills`); add human review before “Recommended”.
3. **Stacks compose with skills** — An architecture stack supplies DAR (constraints, folder layout, deploy commands); skills supply procedural playbooks (TDD, PR review, Terraform apply).
4. **Inherit down the mindmap** — Project stack + project skills apply to all tasks; task-level overrides add or remove skills for one branch of work.
5. **Safe unimport** — Removing a skill deletes vendored files and catalog references; optional git history remains, but active DAR must not reference removed skills.

## Recommended skill stacks (high level)

| Stack | Source | When to recommend |
|-------|--------|-------------------|
| **pstack** | [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) | Rigorous engineering: playbooks, review, shipping |
| **dyl-stack** | [cursor/plugins/dyl-stack](https://github.com/cursor/plugins/tree/main/dyl-stack) | pstack + root-cause / terse delivery style |
| **cursor-team-kit** | [cursor/plugins/cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit) | CI, verification, internal shipping workflows |
| **orchestrate** | [cursor/plugins/orchestrate](https://github.com/cursor/plugins/tree/main/orchestrate) | Large features split across parallel cloud agents |

See [recommended-skills.yaml](./recommended-skills.yaml) for the full starter set.

## Architecture stacks (high level)

See [architecture-stacks.yaml](./architecture-stacks.yaml) for DAR snippets and default skill bundles. Stacks include:

- Extend existing codebase (detect stack, match conventions)
- Basic website (WordPress + PHP)
- Ecommerce (Shopify + theme/UI)
- Static webapp (Angular + S3)
- Full-stack serverless (Angular + Lambda/Node + DynamoDB + S3)
- Native mobile (iOS + Android)
- Desktop (Angular + Electron)
- CI/CD (GitHub Actions + Terraform + npm scripts)

## References

- Agent Skills open standard: [agentskills.io](https://agentskills.io)
- Cursor skills docs: [cursor.com/docs/skills](https://cursor.com/docs/skills)
- Official Cursor plugin marketplace: [github.com/cursor/plugins](https://github.com/cursor/plugins)
