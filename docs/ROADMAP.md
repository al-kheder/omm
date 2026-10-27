# Roadmap

This is the roadmap for the fork at `al-kheder/omm`. The evidence behind each item is in [AUDIT.md](./AUDIT.md), and the risk IDs (R1, R2, …) refer to its register.

**Status values:** `proposed` · `approved` · `in progress` · `blocked` · `done` · `deferred`

**Scope:** everything runs locally for now. Cloud commands stay in the code but get no new work.

## Release order

| Release | Theme | Status |
|---|---|---|
| v0.2.1 | Reliability: safety, correctness, CI | **done** (not yet released). Design: [design/v0.2.1-reliability.md](./design/v0.2.1-reliability.md). Changes: [CHANGELOG.md](../CHANGELOG.md) |
| v0.3.0 | New diagram types | **in progress**: ER, sequence, state and process flowcharts done |
| v0.4.0 | `omm search` and the `/omm-ask` skill | approved (order); design not started |
| v0.5.0 | Incremental analysis | proposed |
| later | Change-impact analysis, the `/omm-guide` skill | proposed |
| — | Fork identity | **done** |

## v0.2.1 — Reliability (done)

These fixes had to come before any new features. All are implemented with tests. Fixed: R1–R7, R9 (the stale `children` part), R10 (fallback), R13 (partly), R14 and R15.

**Still open:**

- R8: diff for nested elements in the viewer.
- R11: login improvements.
- R12: directory symlinks on Windows for setup.
- Regenerating this repo's own `.omm/` with `/omm-scan`.

- **Keep paths inside `.omm/`** (R1). `write`, `read` and `delete` can currently reach outside it.
- **Make the viewer local and safe** (R2, R3):
  - listen only on this machine by default, with an opt-in `--host` for other machines
  - stop allowing requests from any website
  - clean up the Markdown before it is shown
  - work without internet (no CDN)
- **Fix the Mermaid parser** for labelled edges (R4).
- **Cover the whole tree:** `validate` and references must include nested elements, and references can point to nested elements with `@perspective/child` (R5).
- **One metadata format** for top-level and nested elements, including the git baseline (R6).
- **CI on every pull request** (type check, tests, build on Linux and Windows), fix the existing type errors, and small clean-ups (R7, R13–R15).

## v0.3.0 — New diagram types (in progress)

New Mermaid diagram *types* beyond flowcharts, added one at a time. Design: [design/v0.3.0-diagram-types.md](./design/v0.3.0-diagram-types.md).

| Type | Use for | Status |
|---|---|---|
| `erDiagram` | Data models: database schemas, ORM models, file formats | **done** |
| `sequenceDiagram` | Request lifecycles, message exchanges between components | **done** |
| `stateDiagram-v2` | State machines, the `state-transitions` perspective | **done** |
| `flowchart` (process) | Business workflows for non-technical readers: start/end, decisions, lanes, SVG/PNG export | **done** (shared parser replaces the viewer's copy) |
| `classDiagram` | Type hierarchies and interfaces | proposed |

Each type needs:

- a shared parser in `src/lib/`, used by `validate`, `diff` and the viewer
- validation rules
- a renderer in the viewer's own style
- guidance in `/omm-scan` on when to use it

The viewer does **not** load mermaid.js. Instead, each type gets a native renderer built on dagre, so diagrams look consistent, stay small, and can be expanded as nested groups.

## v0.4.0 — Search and question answering (approved order)

- **`omm search <query>`** is a deterministic keyword search over every field and node label in the whole tree. It is available in the CLI (`--json`), the API and a search box in the viewer, and every hit links to the element it came from.
- **`/omm-ask`** is an AI skill that answers architecture questions using `omm search` results as its evidence. It separates documented facts from inferences and says plainly when something isn't documented.

This replaces the earlier item "AI-powered search in viewer". Keyword search comes first. Embedding or vector search is deferred until keyword search has been tried in real use.

## v0.5.0 — Incremental analysis (proposed)

Detect which files changed since the last scan and update only the affected perspectives and elements, leaving unchanged parts alone.

**Needs:**

- the git baseline on every element (from v0.2.1)
- an explicit mapping from files to elements
- a full-scan fallback for cases where the mapping is unsure

## Later (proposed)

- **Change-impact analysis.** Follow diagram edges and references from an element, and label each result as known or inferred. Needs the parser fix and nested references.
- **The `/omm-guide` onboarding skill.** Walks a new developer through the architecture, building on search.

## Fork identity (done)

All the pointers to the upstream project are gone. The fork's identity is defined in one place, `src/lib/package-info.ts`.

- **npm package:** renamed to `@al-kheder/oh-my-mermaid`. The command is still `omm`. Until the package is published, it installs from GitHub with `npm install -g github:al-kheder/omm`. A new `prepare` script builds it during that install.
- **Claude Code setup:** `omm setup` installs the plugin from this fork's marketplace (`al-kheder/omm`, marketplace name `al-kheder-omm`).
- **Links:** every URL (`package.json`, `.claude-plugin/*.json`, all READMEs, `cursor.ts`) now points to `github.com/al-kheder/omm`.
- **Cloud:** there is no default server any more. Cloud commands only work if `OMM_API_URL` is set.
- **Release workflow:** `release.yml` reads the package name from `package.json`.
- **Licence:** `LICENSE` keeps the upstream copyright notice, which MIT requires, and adds the fork's own line.

### Still to do before publishing to npm

- Check that the `@al-kheder` npm scope is available to you, and add an `NPM_TOKEN` secret to the repository.
- After publishing, change `INSTALL_SPEC` in `src/lib/package-info.ts` and the install commands in the READMEs and skills to `@al-kheder/oh-my-mermaid`.

## Deferred

- **Sub-agent / parallel scan pipeline.** There is no performance baseline yet, and writes to the metadata are not safe when several run at once (R9). Revisit after incremental analysis.
- **Cloud features:** sync, sharing and organisations. Revisit after the local product is stable.
- **Replacing the custom flowchart renderer in the viewer.** Not justified. It handles expanding nested groups, which mermaid.js does not.
