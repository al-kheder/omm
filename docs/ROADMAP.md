# Roadmap

This is the roadmap for the fork at `al-kheder/oh-my-mermaid`. The evidence behind each item is in [AUDIT.md](./AUDIT.md), and the risk IDs (R1, R2, …) refer to its register.

**Status values:** `proposed` · `approved` · `in progress` · `blocked` · `done` · `deferred`

**Scope:** everything runs locally for now. Cloud commands stay in the code but get no new work.

## Release order

| Release | Theme | Status |
|---|---|---|
| v0.2.1 | Reliability: safety, correctness, CI | **approved, awaiting design sign-off**. Design: [design/v0.2.1-reliability.md](./design/v0.2.1-reliability.md) |
| v0.3.0 | New diagram types | proposed |
| v0.4.0 | `omm search` and the `/omm-ask` skill | approved (order); design not started |
| v0.5.0 | Incremental analysis | proposed |
| later | Change-impact analysis, the `/omm-guide` skill | proposed |
| — | Fork identity | **done** |

## v0.2.1 — Reliability (approved)

These fixes have to come before any new features.

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

## v0.3.0 — New diagram types (proposed)

**Assumption, still to confirm:** "new diagrams" means new Mermaid diagram *types*, for example `sequenceDiagram`, `stateDiagram-v2`, `erDiagram` and `classDiagram`.

Today the validator, the parser and the viewer only handle `graph`/`flowchart`. Supporting more types means:

- the validator rules and the parser recognise each type, or skip it explicitly
- the viewer renders the non-flowchart types, most likely with a pinned, bundled mermaid.js used only for those
- `/omm-scan` learns when to choose each type, e.g. sequence diagrams for the request lifecycle and ER diagrams for storage

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

- **npm package:** renamed to `@al-kheder/oh-my-mermaid`. The command is still `omm`. Until the package is published, it installs from GitHub with `npm install -g github:al-kheder/oh-my-mermaid`. A new `prepare` script builds it during that install.
- **Claude Code setup:** `omm setup` installs the plugin from this fork's marketplace (`al-kheder/oh-my-mermaid`, marketplace name `al-kheder-omm`).
- **Links:** every URL (`package.json`, `.claude-plugin/*.json`, all READMEs, `cursor.ts`) now points to `github.com/al-kheder/oh-my-mermaid`.
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
