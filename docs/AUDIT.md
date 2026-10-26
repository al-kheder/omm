# oh-my-mermaid — Current-State Audit (Phase 1)

- **Date:** 2026-10-26
- **Audited version:** v0.2.0, HEAD `38ccdb6`
- **Status:** Phase 1 audit only. This document makes no changes to the code. Everything in [§6](#6-preliminary-recommendations-for-phase-2-not-approved) is a proposal and has **not** been approved. [ROADMAP.md](./ROADMAP.md) is left as it is until a roadmap is agreed.

## 0. Method and limits

**What was done:**

- Every file under `src/` was read in full, except `src/server/viewer.html`. That file (74 KB) was searched for its API calls, how it renders content, and its search and diff features.
- The following were also read:
  - all 3 skills
  - all 8 test files
  - both CI workflows
  - `package.json`, `tsconfig.json`, `tsup.config.ts`
  - `CLAUDE.md`, `PLAN.md`, `README.md`, `docs/ROADMAP.md`
  - the repository's own `.omm/` documentation
- Commands were run on Windows 11 with Node 24.22.0:
  - `npm ci`
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run build`
  - `omm validate` against the repo's own `.omm/`
- Findings marked **[repro]** were reproduced by running the built CLI (`dist/cli.js`) and the viewer server inside a throwaway sandbox directory.

**What was not done:**

- No tests on macOS or Linux, and none on Node 18, 20 or 22.
- The ohmymermaid.com backend is not in this repository. Server-side authentication, data isolation and the push/pull contract could not be checked.
- The skills were not run inside an AI agent. Their quality is judged from the prompt text alone.
- No usage data, user feedback or performance baselines exist in the repository. None were invented.

**Labels used:**

- **Verified**: implemented, and confirmed by tests or by running it.
- **Partial**: present but limited.
- **Documented only**: described in the docs, but no implementation was found.
- **Gap**: absent.
- **Unknown**: not enough evidence to say.

## 1. Current-State Audit

### 1.1 Build, tests, CI

| Capability | Status | Evidence |
|---|---|---|
| Build (`tsup`, ESM, `.d.ts`) | **Verified** | `npm run build` succeeds |
| Unit tests | **Verified (narrow)** | 37/37 pass across 8 files. Coverage is listed in §1.9 |
| Type checking | **Gap** | `tsc --noEmit` reports **4 errors**: `src/commands/config.ts:44` and `:57` (TS2352), plus the test imports of `scripts/*.js`, which have no type declarations (TS7016). `tsup` does not type-check, so the build still succeeds |
| CI on pull requests | **Partial** | `check-version-sync.yml` only checks that version numbers match. `npm test` runs **only in `release.yml`**, i.e. after a merge to `main` that bumps the version. Nothing runs tests or type checks on PRs |
| Release automation | **Verified** | `release.yml` publishes to npm with provenance when the `package.json` version changes. The decision logic is tested in `release-decision.test.ts` |
| Build on Windows | **Partial [repro]** | `tsup.config.ts` `onSuccess` runs `cp ...`, which fails on Windows ("path not found"). As a result, `dist/viewer.html` is never created. Published packages are built on Ubuntu, so users are unaffected. Locally, `src/server/index.ts` falls back to `src/server/viewer.html` |

### 1.2 Core domain and storage (`src/lib/store.ts`, `src/lib/meta.ts`, `src/types.ts`)

| Capability | Status | Evidence |
|---|---|---|
| 7 fields per element, stored as files | **Verified** | `VALID_FIELDS` and `FIELD_FILES` in `types.ts` |
| Nested elements, with the folder tree as the hierarchy | **Verified [repro]** | `writeNodeField` and `listNodes`. Writing `persp/child/leaf` creates the folders |
| `.omm/` created on first write | **Verified** | `store.test.ts` |
| `prev_diagram` kept on diagram writes | **Verified [repro]** | Works for both top-level and nested elements |
| Metadata the same for all elements | **Partial [repro]** | Top-level writes go through `writeField` → `updateMeta`. These record `git_commit` and `git_branch`, but **no** `kind` or `title`. Nested writes go through `writeNodeField`. These record `kind`, `title` and `parentPath`, but **no git info**. Two code paths produce two different meta formats |
| `meta.children` | **Partial** | Written by `writeNodeField`, but **no code reads it**: the API uses `listNodes` on the filesystem. `omm delete` of a nested element leaves a stale entry **[repro]**. The update is also a read-modify-write, so two writers at once could lose entries (from reading the code; matters for parallel scanning) |
| Paths stay inside `.omm/` | **Gap [repro]** | `classDir` and `nodeDir` use `path.join` with no checks. `omm write ../escaped description x` wrote **outside** `.omm/`. **`omm delete ../src` deleted the project's `src/` folder** (sandbox). `omm delete ..` tries to remove the whole project; on Windows it failed only because the folder was the current directory, and it is untested on Unix |
| Element identity | **Partial** | An element's identity is its folder path. There are no stable IDs. Renaming a node in a diagram does not rename its folder |
| Config | **Partial** | `omm config <key> <value>` writes any key without checking it. `initOmm` hard-codes `version: '0.1.0'`, while the package is 0.2.0 |

### 1.3 Mermaid parsing, validation, diff, refs (`src/lib/diff.ts`, `validate.ts`, `refs.ts`)

| Capability | Status | Evidence |
|---|---|---|
| Parsing node/edge sets | **Gap for the format the skill requires [repro]** | `parseMermaid` reads `A -->\|"label"\| B[...]` as an edge from `A` to `\|"label"\|`. The real target `B` is lost, and fake nodes such as `\|dispatches` appear. Running it on this repo's own `overall-architecture` diagram finds 25 "nodes" when there are 12. `/omm-scan` makes every edge carry a label, so **every generated diagram is mis-parsed** |
| `omm diff` | **Partial [repro]** | Works for nested paths through the CLI. But because of the parser bug, a label change looks like a node change, and changing an edge's *target* goes undetected |
| `node-count` validation rule | **Partial [repro]** | Fooled by the same parser bug. This repo's own docs produce false "23/25 nodes" warnings |
| Other validation rules (`graph-declaration`, `balanced-brackets`, `edge-label`, `classdef-*`, `ref-*`) | **Verified** | `validate.test.ts`, 14 cases |
| `omm validate` with no arguments | **Partial [repro]** | Checks **top-level diagrams only**. Nested diagrams are never checked unless you name the path explicitly |
| Cross-element refs (`@name`) | **Partial [repro]** | Only top-level names can be referenced. `getIncomingRefs` and `buildRefGraph` scan top-level diagrams only, so a `@persp` inside `persp/child` is not reported as an incoming ref. `extractRefs` matches `@word` anywhere in the text, including inside labels |
| Non-flowchart diagram types | **Gap** | The validator requires `graph`/`flowchart`. The parser skips other types. The viewer only draws flowcharts |

### 1.4 CLI (`src/cli.ts`, `src/commands/`)

| Capability | Status | Evidence |
|---|---|---|
| `read`, `write`, `tree`, `show`, `list`, `status`, `config`, `init` | **Verified** | Read and run in the sandbox |
| Legacy shorthand `omm <path> <field> [content]` | **Verified** | Default branch in `cli.ts` |
| `src/commands/class-field.ts` | **Dead code** | No file imports `commandClassField` any more |
| `omm status` | **Partial [repro]** | Lists perspectives only. No coverage information, no nested elements, nothing on staleness |
| CI use | **Partial** | `omm validate` exits 1 on errors, so CI can use it. Nothing else reads like a CI feature, there is no machine-readable output (no `--json`), and none of it is documented |
| Help text | **Inconsistent [repro]** | `omm help` says "Log in to omm.dev". The default API is `https://ohmymermaid.com`. Usage strings still say `<class>` (`omm diff <class>`), against the terminology rule in `CLAUDE.md` |

### 1.5 Viewer (`src/server/`)

| Capability | Status | Evidence |
|---|---|---|
| Local HTTP server and read-only JSON API | **Verified [repro]** | `api.ts` |
| Live reload through SSE | **Verified (from code)** | `watcher.ts` uses `fs.watch(dir, {recursive:true})`. **Unknown on Linux with Node 18**: there, recursive watching throws synchronously, and `engines` allows `>=18` |
| Expanding nested groups | **Verified (from code)** | `viewer.html` fetches `/api/class/:p/node/...` |
| Diff view in the viewer | **Documented only** | `PLAN.md` lists "diff 시각화" (diff visualisation) as part of the MVP. The viewer never calls `/diff`. The `/diff` endpoint does not accept nested paths **[repro]** |
| Search | **Gap** | No search in the viewer, the API or the CLI. Listed as planned in `ROADMAP.md` |
| Opening the code behind a node | **Gap** | Labels include file paths by convention (`"Name\npath"`), but nothing links them to the code |
| Network exposure | **Risk [repro]** | The server listens on `::` (all network interfaces) and sends `Access-Control-Allow-Origin: *`. Any device on the LAN, and any web page open in your browser, can read the docs while `omm view` is running |
| Rendering untrusted content | **Risk (from code)** | Field Markdown goes through `marked.parse()` into `innerHTML` with no sanitising (`viewer.html:1087`, `:1108`). The content may come from a teammate's commit or from `omm pull` |
| CDN dependencies | **Risk** | `marked` is loaded **without a version pin** (`cdn.jsdelivr.net/npm/marked/marked.min.js`). The viewer needs internet access, so it does not work offline |

### 1.6 Cloud (`src/lib/cloud.ts`, `cloud-paths.ts`, `commands/{login,link,push,pull,share,org}.ts`)

| Capability | Status | Evidence |
|---|---|---|
| Path safety on `pull` | **Verified** | `resolvePullDestination` and `cloud-paths.test.ts` |
| Credential storage | **Verified (from code)** | `~/.omm/credentials.json`, mode `0600`. The mode has no effect on Windows |
| Login | **Partial** | Uses `execSync('open "<url>"')`, which works on macOS only. Elsewhere it prints the URL instead. The callback server listens on all interfaces and has no `state` check. The token arrives as a query parameter |
| `org members` | **Partial** | Only prints a URL (stated in a code comment) |
| Server behaviour, authentication, isolation | **Unknown** | The backend is not in this repository |
| Local-first | **Verified** | Every core workflow works without the cloud |

### 1.7 Supported AI tools (`src/lib/platforms/`)

| Tool | Status | Notes |
|---|---|---|
| Claude Code | **Verified (from code)** | `claude plugin` CLI. Compares versions by parsing `claude plugin list` text, which will break if that output format changes |
| Cursor | **Verified** | `cursor.test.ts`. Writes into the project (`.cursor-plugin/`) |
| Codex, OpenClaw, Antigravity | **Partial** | `fs.symlinkSync(..., 'dir')`. **Unknown on Windows**, where directory symlinks need admin rights or Developer Mode (a junction would not). `isSetup` only checks that the folder exists, so it never notices a stale version |
| `getAgentsSource` | **Unused** | No `agents/` folder exists |

### 1.8 Skills (`skills/`)

| Aspect | Assessment |
|---|---|
| `omm-scan` structure | Clear catalogue of perspectives and recursion rules. Sensible defaults ("don't force perspectives") |
| Reproducibility | **Low.** There is no record of what was scanned, from which commit, or with which choices. "Do not rewrite elements that haven't changed" has no mechanism to back it up |
| Evidence traceability | **Partial.** File paths in labels are a convention only. Fields have no "sources" entry, and nothing marks a statement as verified or inferred |
| Handling uncertainty | **Gap.** The skill never asks the AI to mark guesses or unknowns |
| Incremental mode | **Gap** (see `ROADMAP.md`) |
| `/omm-view` | Exists, but is not listed in the README's skills table |
| "One Bash call per field" | Makes a scan slow and expensive in tool calls. This matters for the parallel-scan roadmap item |

### 1.9 Test coverage map

**Covered:**

- `ensureOmmForRead` and `ensureOmmForWrite`
- top-level `writeField`
- `validateDiagram`
- `resolvePullDestination`
- credential/handle sync
- Cursor `isSetup`
- `commandUpdate`
- release decision logic
- version-sync helpers

**Not covered:**

- `writeNodeField` and anything nested
- `parseMermaid` and `diffMermaid`
- `refs.ts`
- `deleteClass`
- path containment
- the server API and watcher
- `tree`, `read`/`write` commands, `config`
- the push request format

### 1.10 Documentation consistency

| Item | Finding |
|---|---|
| `PLAN.md` (Korean) | Historical. Describes `omm serve`, a mermaid.js viewer, `omm init` copying skills into `.claude/skills`, and a flat `<class> <field>` interface. None of this matches the current code |
| Repo's own `.omm/` | **Stale.** Generated at commit `2fb887a`, before the v0.2.0 nested-element rewrite (`a9cc5c3`). `command-surface` has no `read`, `write`, `tree` or `config`, and still lists `class-field`. Its description still says "class" |
| `CLAUDE.md` | Lists 4 README translations. A Turkish one, `README.tr.md`, also exists |
| README | Accurate for the main workflow. Omits `/omm-view` |
| `.omm/config.yaml` | `version: 0.1.0` vs package `0.2.0`. That field is never read or migrated |

## 2. Architecture Boundary Map

| Boundary | Current modules | Responsibilities today | Depends on | Assessment |
|---|---|---|---|---|
| **A. AI analysis and skills** | `skills/*/SKILL.md` | Exploring, picking perspectives, writing recursively | CLI `write`/`read`/`config` only | Cleanly separated: skills only call the CLI. Gaps: no evidence or uncertainty in what they produce, no record of what was scanned |
| **B. Core domain** | `lib/store.ts`, `lib/meta.ts`, `lib/diff.ts`, `lib/refs.ts`, `lib/validate.ts`, `types.ts`, `index.ts` | File storage, metadata, parsing, diff, refs, validation | `yaml`, `child_process` (git) | Right place, but **two APIs side by side** (flat `*Class`/`*Field` and nested `*Node*`), with different metadata behaviour. No path checks. Rules (IDs match folders, refs resolve, children match the folder) are not enforced in one place |
| **C. CLI** | `cli.ts`, `commands/*` | Argument handling, output | B; `platforms/`; cloud | Thin and readable. Mixes the flat and nested APIs depending on the command. No `--json` output |
| **D. Viewer** | `server/index.ts`, `api.ts`, `watcher.ts`, `viewer.html` | Read-only API, SSE, its own flowchart parser plus dagre layout | B | **The viewer has its own Mermaid parser** (`parseFlowchart` in `viewer.html`) separate from `lib/diff.ts`'s `parseMermaid`, so two parsers can disagree. The API is a mix of flat and nested endpoints |
| **E. Cloud** | `lib/cloud.ts`, `lib/cloud-paths.ts`, `commands/{login,logout,link,push,pull,share,org}.ts` | Authentication, project linking, full-snapshot push and pull | Backend (not in repo) | Optional, local-first preserved. Push sends the full snapshot every time. Pull overwrites without merging or warning |
| (Infra) Platforms | `lib/platforms/*` | Installing skills per tool | OS, tool CLIs | Fine. Platform behaviour largely untested |

## 3. Inconsistency and Risk Register

**Severity scale:**

- **S1**: data loss, or a security exposure
- **S2**: wrong results that users rely on
- **S3**: inconsistency, or missing coverage
- **S4**: cosmetic

| # | Issue | Evidence | Impact | Sev | Recommended action |
|---|---|---|---|---|---|
| R1 | Paths can escape `.omm/` in `write`, `read` and **`delete`** | §1.2 [repro]: `omm delete ../src` removed `src/` | An AI agent passing a wrong path can delete or overwrite source code | **S1** | Add one path-check helper in `store.ts` that rejects `..`, absolute paths and empty segments. Use it in every public function. Add regression tests |
| R2 | Viewer listens on all interfaces with wildcard CORS | §1.5 [repro] | Private architecture docs readable from the LAN and from any open web page | **S1** | Listen on `127.0.0.1` by default. Remove `*` CORS, or limit it to the same origin. Add an opt-in `--host` |
| R3 | Markdown inserted into the page without sanitising | `viewer.html:1087`, `:1108` | Script injection through committed or pulled docs, made worse by R2 | S2 | Sanitise the HTML (e.g. DOMPurify, pinned version) or use `marked` with HTML disabled. Pin every CDN version |
| R4 | `parseMermaid` mis-parses labelled edges | §1.3 [repro] | `diff`, the `node-count` rule, and any future impact or search feature built on the graph are wrong for every diagram the skill produces | **S2** | Fix the parser and add tests using real diagrams from `.omm/`. Consider sharing one parser between the CLI and the viewer |
| R5 | `validate` and `refs` ignore nested elements | §1.3 [repro] | Most generated diagrams are never validated. The reference graph is incomplete | S2 | Recurse through the whole tree. Decide how nested refs are written (decision D3) |
| R6 | Two metadata formats | §1.2 [repro] | Nested elements have no git baseline, which blocks incremental analysis. Perspectives have no `kind` | S2 | Merge into one write path. Keep reading old meta files unchanged |
| R7 | No tests or type check on PRs; 4 existing `tsc` errors | §1.1 | Regressions are found only at release time | S3 | Add a PR workflow running `tsc --noEmit`, `npm test` and `npm run build`. Fix the 4 errors |
| R8 | Nested API diff and refs unavailable; no diff view in the viewer | §1.5 [repro] | A promised MVP feature is missing | S3 | Track after R4 is fixed |
| R9 | `meta.children` goes stale and is never read | §1.2 [repro] | Confusing. Racy under parallel scanning | S3 | Either derive it from the filesystem, or update it on delete. Decide before any parallel-scan work |
| R10 | Recursive `fs.watch` on Linux with Node 18 | §1.5 (from code) | `omm view` may crash on a supported runtime | S3 (unverified) | Reproduce on Linux with Node 18. Then either catch and fall back, or raise `engines` to `>=20` |
| R11 | Login opens the browser on macOS only; callback has no `state` check and listens on all interfaces | §1.6 | Worse experience on Windows and Linux. A small risk of a forged login | S3 | Open the browser in a cross-platform way. Listen on `127.0.0.1`. Add a `state` parameter (needs backend support, which is unknown) |
| R12 | Directory symlinks on Windows for Codex, OpenClaw and Antigravity | §1.7 (from code) | `omm setup` may fail on Windows | S3 (unverified) | Test on Windows; use `'junction'` on win32 |
| R13 | Stale docs: own `.omm/`, `PLAN.md`, help text, `CLAUDE.md` language list, config `version` | §1.10 | The project's own example of good docs is out of date | S4 | Re-scan after the P0 fixes. Mark `PLAN.md` as historical. Fix the help text and language list |
| R14 | Dead code: `class-field.ts`, `getAgentsSource` | §1.4, §1.7 | Maintenance noise | S4 | Remove when touching nearby code |
| R15 | Windows `cp` in `tsup` `onSuccess` | §1.1 [repro] | Local Windows builds have no `dist/viewer.html` | S4 | Copy the file with Node instead of `cp` |

## 4. Feature Capability Matrix

| Proposed capability | Exists today | Status | Prerequisites |
|---|---|---|---|
| P0 Reliability and consistency | Partial validation, diff and refs; tests for top-level only | **Partial** | — |
| P1 Search / question answering | Nothing (no search in CLI, API or viewer). The data is all local Markdown and Mermaid, so search is simple to add | **Gap** | R4 (for searching node labels), R5 (for walking the whole tree) |
| P1 Incremental analysis | Only `meta.git_commit` on perspectives. File paths in labels by convention | **Gap** | R6 (git baseline on every element), a reliable file-to-element mapping, R4 |
| P1–2 Change-impact analysis | Diagram edges and `@refs` exist but are mis-parsed and limited to top level | **Gap** | R4, R5, a defined ID/path model (decision D3) |
| P2 Guided onboarding | The viewer's tree and expandable groups are a basis. `/omm-guide` is planned | **Documented only** | Search makes it far more useful |
| P2 Parallel scanning | Not present | **Documented only** | R9 (concurrent writes to `meta.children`), a measured baseline (none exists) |
| P3 CI architecture checks | `omm validate` exits non-zero | **Partial** | R5 (validate nested elements), `--json`, documentation |
| P3 PR summaries, editor navigation | None | **Gap** | Incremental analysis and impact analysis |
| Cloud collaboration | Push and pull of full snapshots | **Partial / backend unknown** | Backend access |

## 5. Verified vs. assumed (summary)

**Verified by running it:**

- R1, R2, R4, R5, R6, R8, R9, R15
- build, tests and type-check results
- stale self-docs
- the wrong help text

**From reading code only:**

- R3, R7 (CI configuration), R11, R14

**Unverified and needing a specific environment:**

- R10: Linux with Node 18
- R12: Windows symlinks
- Backend behaviour (no access)

**Assumed with no evidence:**

- How often users hit each problem, and actual demand for each roadmap item. There is no telemetry or issue data in the repository; GitHub issues were not reviewed.

## 6. Preliminary recommendations for Phase 2 (NOT approved)

The scoring is qualitative. Value assumes the product vision in the brief. Effort is relative, not a time estimate.

| Order | Item | Value | Confidence | Effort | Risk | Why here |
|---|---|---|---|---|---|---|
| 1 | **P0-Safety**: path containment (R1), localhost-only viewer and CORS (R2), sanitising and pinned CDN (R3) | High | High | Low | Low | Data loss and exposure. Small, local changes |
| 2 | **P0-Correctness**: fix the parser (R4), validate and refs across the whole tree (R5), one meta format (R6) | High | High | Low–Med | Med (refs format, D3) | Every later feature reads the graph |
| 3 | **P0-Hygiene**: PR CI with `tsc`, tests and build (R7); fix the type errors; tests for nested elements, `diff` and `refs` | Med | High | Low | Low | Prevents regressions in the work above |
| 4 | **P1 `omm search`**: a deterministic search over fields and node labels across the whole tree, in the CLI (`--json`), the API and a viewer search box | High | Med | Med | Low | The smallest useful user-facing feature. Every answer points to a real element. It becomes the evidence source for an AI Q&A skill later |
| 5 | **P1 `/omm-ask` skill**: AI answers built on `omm search`, separating documented facts from inferences | High | Med | Low | Med (prompt quality) | Reuses item 4. Adds no runtime dependency |
| 6 | **P1 Incremental analysis**: an explicit file-to-element mapping plus the git baseline, `omm changed --since` | High | Med | Med–High | Med | Needs items 2 and 6 in place |
| 7 | **P1–2 Impact analysis**: follow graph edges and refs, labelling each result as known or inferred | Med–High | Low–Med | Med | Med | Needs items 2 and 6. Should be validated on 2–3 real repos first |
| 8 | **P2 `/omm-guide`** onboarding skill | Med | Med | Low | Low | Mostly skill text, built on search |
| 9 | **P2 Parallel scan** | Med | Low | High | High | **Defer.** No baseline exists yet, and concurrent writes are unsafe (R9) |
| — | **Rejected for now** | | | | | Replacing the viewer with mermaid.js; vector or embedding search (adds dependencies and model choices before keyword search is proven); any change that makes the cloud mandatory |

**First release proposal:**

- **v0.2.1**: items 1–3. This is a reliability patch with no new user-facing features.
- **v0.3.0**: items 4 and 5, search and asking questions. This is the first release that changes what users can do.

The technical design (Phase 3) and the detailed validation plan come after the roadmap is approved.

## 7. Files inspected

**Source:**

- `src/cli.ts`, `src/index.ts`, `src/types.ts`
- every file in `src/commands/` (23 files)
- `src/lib/{store,meta,diff,refs,validate,cloud,cloud-paths}.ts`
- `src/lib/platforms/{index,types,utils,claude,cursor,codex}.ts`. `openclaw.ts` and `antigravity.ts` were only searched, since they follow the same pattern as `codex.ts`
- `src/server/{index,api,watcher}.ts`
- `src/server/viewer.html`, partially (API calls, rendering, SSE)

**Tests:**

- every file in `src/__tests__/` (8 files)

**Skills:**

- `skills/omm-scan/SKILL.md`, `skills/omm-push/SKILL.md`, `skills/omm-view/SKILL.md`

**Config and CI:**

- `package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`
- `.github/workflows/release.yml`, `.github/workflows/check-version-sync.yml`
- `.claude-plugin/plugin.json`

**Docs:**

- `README.md`, `CLAUDE.md`, `PLAN.md` (first 120 lines), `docs/ROADMAP.md`
- `.omm/` (structure, meta files, `overall-architecture` diagram and description)
