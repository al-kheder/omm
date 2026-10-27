# Changelog

All notable changes to this fork. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased] — v0.3.0 Diagram types

### Changed

- **The viewer reads flowcharts with the same parser as `omm validate` and `omm diff`** (`src/lib/flowchart.ts`). Before, it dropped edges written as `A -- Yes --> B`, the rest of chains (`a --> b --> c`) and `&` groups, nodes with `[/ /]` or `[[ ]]` shapes, and showed brackets in `([Start])` labels. Edge labels no longer show their quotes. Existing architecture diagrams look the same otherwise.
- **`balanced-brackets`** no longer reports the flag shape `id>text]`.
- **Easier-to-follow edges** in the viewer:
  - Edges in the light theme are darker (`#64748b`) and now have at least 3:1 contrast with the background. The dark theme is unchanged.
  - Arrowheads are larger and the same size in flowcharts, sequence and state diagrams.
  - Edge labels, ER cardinalities and state triggers are drawn after all lines, so no line runs over them.
  - Hovering an element highlights its edges in the light theme too. Before, the highlight was white.
  - In a compact fan-out grid, edges end on the element's border instead of under it, and edges that would cross another element run along the gap between columns.
  - Several edges without labels between the same two elements are spread apart, and two-point edges bend in the layout's direction.
- **Sequence diagrams** no longer write duplicate SVG attributes. This made SVG/PNG export of sequence diagrams fail, and drew `autonumber` digits in the wrong size and color.
- **Development uses pnpm** (pinned to `pnpm@10.34.6` via `packageManager`). Run `corepack enable`, then `pnpm install`.
  - `pnpm-lock.yaml` replaces `package-lock.json`. It was converted with `pnpm import`, so every dependency version is unchanged.
  - CI and the release workflow use pnpm.
  - `check-version-sync` no longer reads a lockfile.
  - Installing the CLI is unchanged: `npm install -g github:al-kheder/omm` still works, because `prepare` now calls `tsup` directly instead of `npm run build`.

### Added

- **Secret check.** `omm validate` reports an error (`secret-value`) when a diagram contains something that looks like a secret:
  - private keys;
  - AWS, GitHub, Slack, Google, Stripe and `sk-` API keys;
  - JSON Web Tokens;
  - passwords in URLs;
  - random-looking values assigned to `password`, `secret`, `api_key` and similar.
  `omm write` prints the same warning for any field, but still saves it. References such as `${DB_PASSWORD}`, placeholders and ordinary prose are not reported, and the matched value is never printed. `/omm-scan` now says never to copy secrets into `.omm/`.
- **Flow motion** for explaining how data or work moves. The new **flow** button in the viewer toolbar shows a small file icon travelling along the arrows that carry something:
  - every one-way arrow of a process flowchart;
  - every message of a sequence diagram, one after another in order;
  - architecture edges marked `e1@{ animate: true }`.
  Dependencies ("implements", "imports"), state and ER diagrams stay still. The icon follows the drawn line from source to target, passes under labels and elements, and stops before the arrowhead. Flow is off by default and remembered per browser. It stays off when the system asks for reduced motion, and downloads never include it. `/omm-scan` now marks the architecture edges that carry data.
- **Edge IDs and edge animation settings** in flowcharts, written the Mermaid way: `a e1@--> b`, then `e1@{ animate: true }` (or `animation: fast` / `slow`, or `animate: false`). `omm validate` accepts them and reports settings for an edge ID that does not exist. `omm diff` ignores the IDs.
- **Color mode** for every diagram type. The new **mono | color** switch in the viewer toolbar changes between the original black-and-white look (still the default) and colors that show what each element is. The choice is remembered per browser, works with both themes and is used by SVG/PNG export.
  - **Flowcharts:** start/end green, steps blue (in process flowcharts), decisions amber, input/output teal, documents violet, subprocesses indigo, data stores slate; the omm categories `entry` (blue), `store` (green), `external` (grey) and `concern` (pink). Plain architecture nodes, edges and lanes stay neutral.
  - **ER:** entity headers blue; key badges unchanged. **Sequence:** participants and activation bars blue, notes yellow. **State:** states blue, choices amber, notes yellow; start/end markers stay black/white as in UML.
  - Shapes and labels are unchanged, so nothing depends on color alone. Text has at least 4.5:1 contrast on its fill and outlines at least 3:1 against the background (tested for both themes).
  - New category classes `error` and `success` for failed and successful outcomes in process flowcharts; `omm validate` accepts them.
- **Process flowcharts** for explaining workflows to people who do not know the code.
  - **Symbols:** start/end `([ ])`, step `[ ]`, decision `{ }`, input/output `[/ /]`, document `@{ shape: doc }`, subprocess `[[ ]]`, connector `(( ))`, stored data `[( )]`, plus hexagon, trapezoid and flag shapes.
  - **Lanes:** `subgraph id [Role] … end` is drawn as a labelled lane, so a diagram can show who does each step.
  - **Viewer:** long labels wrap, edge labels get their own space, dotted and thick lines and circle/cross arrow ends are drawn.
  - **Export:** new **svg** and **png** buttons download the selected perspective in the current theme. The new **clean** button hides file paths under element names.
  - **`omm validate`:** accepts `flowchart` without a direction; reports unreadable lines with line numbers (`flowchart-syntax`); in a flowchart with a start or end node, only decision branches need labels, and a decision with fewer than two ways out is reported (`decision-branches`).
  - **`/omm-scan`:** new "Process Flowchart Rules" and a `business-processes` perspective.
- **State diagrams (`stateDiagram-v2`)** for status fields, lifecycles and state machines.
  - **Parsing:** states with labels and descriptions, transitions with triggers, `[*]` start and end, composite states, `<<choice>>`/`<<fork>>`/`<<join>>`, notes and `direction`.
  - **`omm validate`:** reports syntax errors with line numbers (`state-syntax`), and warns about states without transitions (`state-orphan`) and transitions without a trigger (`state-transition-label`).
  - **`omm diff`:** reports added and removed states and transitions.
  - **Viewer:** draws states, start and end markers, choices, fork/join bars, notes and composite states as nested boxes. State diagrams can also be nested inside flowcharts.
  - **`/omm-scan`:** new "State Diagram Rules"; the `state-transitions` perspective uses them.
- **Sequence diagrams (`sequenceDiagram`)** for request lifecycles, protocols and messages between components.
  - **Parsing:** participants and actors with labels, all message arrows (call, reply, async, failure, both directions), activations (`+`/`-`, `activate`/`deactivate`), notes, `loop`/`alt`/`else`/`opt`/`par`/`critical`/`break`/`rect` blocks, `box` and `autonumber`.
  - **`omm validate`:** reports sequence syntax errors with line numbers (`seq-syntax`), and warns about participants without messages (`seq-unused-participant`), messages without text (`seq-message-label`) and diagrams with more than 30 messages (`message-count`).
  - **`omm diff`:** reports added and removed participants and messages.
  - **Viewer:** draws participant columns with lifelines, messages top to bottom, activation bars, notes and labelled block frames. Sequence diagrams can also be nested inside flowcharts.
  - **`/omm-scan`:** new "Sequence Diagram Rules"; `request-lifecycle` uses them when the order of calls matters.
- **ER diagrams (`erDiagram`)** for data models such as database schemas, ORM models and file formats.
  - **Parsing:** entities, aliases (`product["Product"]`), attributes with types, `PK`/`FK`/`UK` keys and comments, relationships with cardinality (`||`, `|o`, `}|`, `}o` …), identifying (`--`) and non-identifying (`..`) lines, and `direction`.
  - **`omm validate`:** reports ER syntax errors with line numbers (`er-syntax`), warns about entities without relationships (`er-orphan-entity`), and counts entities for the size check.
  - **`omm diff`:** reports added and removed entities, relationships and attributes (`added_attributes` / `removed_attributes` on `DiffResult`).
  - **Viewer:** draws entities as boxes with one row per attribute (key badges, types), relationships as lines (dashed for non-identifying) with cardinality text at both ends. ER diagrams can also be nested inside flowcharts.
  - **`/omm-scan`:** new `data-model` perspective and "ER Diagram Rules".
- **One shared parser:** the ER parser in `src/lib/er.ts` is bundled for the browser as `/vendor/omm.js`, so the CLI and the viewer read diagrams the same way.
- **This repo's own docs:** a new `data-model` perspective describing the `.omm/` storage format.

## v0.2.1 Reliability (unreleased)

### Breaking changes

- **The viewer only listens on this machine.** `omm view` now binds to `127.0.0.1`. To open it from other devices, run `omm view --host 0.0.0.0`; a warning is printed.
- **`omm validate` checks every diagram.** With no arguments it now covers nested diagrams too, so projects with errors in nested diagrams now fail validation.
- **Unsafe element paths are rejected.** Paths such as `../src`, absolute paths, and hidden (`.`-prefixed) segments are refused by every command and by the viewer API.
- **Cloud sync is opt-in.** There is no default cloud server. `login`, `push`, `pull`, `share` and `org` only work when `OMM_API_URL` is set.

### Fixed

- `omm delete ../src` could delete folders outside `.omm/`. `write` and `read` could also reach outside it.
- The Mermaid parser mis-read labelled edges (`A -->|"label"| B`). This broke `omm diff` and the node-count check for every diagram produced by `/omm-scan`.
- Incoming references, the reference graph and `omm validate` ignored nested elements.
- Top-level and nested elements wrote different `meta.yaml` formats. Nested elements had no git baseline.
- Deleting a nested element left a stale entry in its parent's `children` list.
- Markdown in the viewer was inserted without sanitising.
- The viewer allowed requests from any website (wildcard CORS), could be framed by other sites, and accepted any `Host` header.
- On platforms without recursive file watching (Linux before Node 20), live reload no longer crashes the viewer.
- The Windows build did not copy `viewer.html` into `dist/`.
- `.omm/config.yaml` was created with version `0.1.0` instead of the package version.

### Added

- Nested references: `@perspective/child` in a diagram links to a nested element.
- New `ref-ancestor` validation warning when a child diagram references its own parent.
- `omm view --host <addr>`.
- `omm status` shows element and documentation counts per perspective.
- `omm validate` prints a summary line.
- New library exports: `listAllElements`, `parseElementPath`.
- CI on every pull request: type check, tests and build on Linux and Windows, with Node 18 and 22.

### Changed

- **Fork identity:**
  - The package is now `@al-kheder/oh-my-mermaid`. Until it is published to npm, install it with `npm install -g github:al-kheder/omm`.
  - `omm setup` for Claude Code uses this fork's plugin marketplace.
  - `omm update` reinstalls from the fork.
- **The viewer works offline.** `dagre`, `marked` and `DOMPurify` ship with the package (pinned versions) instead of loading from a CDN.
- **Clean-up:** removed the unused `class-field` command module, and `PLAN.md` is marked as historical.
