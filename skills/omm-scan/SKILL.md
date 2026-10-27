---
name: omm-scan
description: Scan codebase architecture and generate/update .omm/ documentation. Use when the user says "omm scan", "scan architecture", "update architecture", "refresh diagrams".
---

# omm-scan — Perspective-Based Architecture Scanner

## Purpose

Analyze the codebase and generate `.omm/` architecture documentation using **perspective-driven recursive analysis**.

- A **perspective** is a top-level element — a distinct way to look at the architecture.
- Each element in a diagram gets analyzed recursively. If it has internal structure, it becomes a **child element** (subdirectory with its own diagram). If not, it stays a leaf.
- The filesystem determines nesting. Element IDs in diagrams match child directory names. The viewer resolves groups from the filesystem.

## Prerequisites

```bash
command -v omm || npm install -g github:al-kheder/omm
```

If the install fails, tell the user: "Please run `npm install -g github:al-kheder/omm` in your terminal, then try again."

---

## Step 0: Check Language

```bash
omm config language
```

Write field content (description, context, constraint, concern, todo, note) in the configured language. Default is English. Element IDs, directory names, and diagram node IDs are always English kebab-case.

## Step 1: Explore the Codebase

Use Glob and Read to understand the project:

- Read `package.json`, `pyproject.toml`, or equivalent manifests
- List top-level directories to identify module boundaries
- Read key entry points (main, index, app files)
- Look for route definitions, service layers, database connections, external integrations

## Step 2: Select Perspectives

From the catalog below, choose which perspectives are meaningful for this codebase.

### Perspective Catalog

| Perspective | When to create | What it answers |
| --- | --- | --- |
| `overall-architecture` | **Always** | What exists and how pieces relate |
| `request-lifecycle` | Any server/API | How a request enters and gets handled end-to-end. Use a **sequence diagram** when the order of calls matters; see "Sequence Diagram Rules" |
| `data-flow` | Any data processing, DB usage | Where data comes from, transforms, and lands |
| `dependency-map` | Complex module graph | What depends on what, what's shared |
| `external-integrations` | External APIs/services | What the system connects to and why |
| `state-transitions` | Stateful features (frontend or backend) | How state changes and what triggers it. Uses a **state diagram**; see "State Diagram Rules" |
| `route-page-map` | Frontend with routing | Page structure and navigation flow |
| `command-surface` | CLI tools | Command hierarchy and dispatch |
| `extension-points` | Plugin/extension systems | Extension architecture and registry |
| `pipeline` | ML/data pipelines | Stage topology and data flow |
| `orchestration` | Event-driven/queue systems | Publisher, subscriber, broker topology |
| `storage` | 2+ storage systems | Storage topology (DB, cache, queue, object store) |
| `data-model` | Database schema, ORM models, persisted file formats | What data exists and how entities relate. Uses an **ER diagram**; see "ER Diagram Rules" |
| `business-processes` | User-facing or business workflows in the code (checkout, sign-up, approval, refund, onboarding) | What happens step by step, who does each step and where the process branches. Uses a **process flowchart**; see "Process Flowchart Rules" |

Don't force perspectives that don't exist in the code.

## Step 3: Generate Perspectives with Recursive Drill-Down

For each selected perspective, follow this recursive process:

### 3a. Write the perspective diagram

Element IDs match child directory names. The viewer resolves nesting from the filesystem.

```bash
omm write <perspective> diagram - <<'MERMAID'
graph LR
    renderer["Renderer\nsrc/renderer/"]
    renderer -->|"IPC invoke/on"| main-process["Main Process\nsrc/main/"]
    main-process -->|"spawn PTY"| engine-system["Engine System\nsrc/main/engine/"]
    main-process -->|"read/write JSON"| data-store["Data Store\nsrc/main/store.ts"]
    main-process -->|"xterm.js"| terminal-dock["Terminal Dock\nsrc/renderer/src/panel/"]
MERMAID
```

### 3b. Write the other 6 fields

Each as a separate `omm write` command: description, context, constraint, concern, todo, note.

### 3c. Recursive drill-down: analyze every element

**For every element in the diagram:**

1. **Analyze** the code it represents (Glob + Read the relevant files/directories)

2. **Write description for every node — no exceptions.** This creates the element directory. Optionally write other fields (context, constraint, concern, todo, note) if relevant — Write in the configured language.

   ```bash
   omm write <perspective>/<element-name> description - <<'EOF'
   (what this element does, which files/dirs it covers)
   EOF
   ```

3. **Decide leaf or group:**
   - **Distinct internal components found** → write a diagram and recurse deeper (it becomes a group)
   - **No meaningful sub-components** (single file, trivial wrapper, external system) → write remaining fields only (it stays a leaf)

4. **If group** — write diagram and recurse:

   ```bash
   omm write <perspective>/<element-name> diagram - <<'MERMAID'
   graph LR
       (internal elements)
   MERMAID
   ```

   Then repeat step 3c for each element in this diagram.

### Example recursion

```text
overall-architecture (perspective)
  elements: renderer, main-process, engine-system, data-store, terminal-dock

  → analyze renderer (src/renderer/)
    → finds: App.tsx, components/, hooks/, stores/, world/
    → group → write diagram with: components, stores, world
      → analyze components → 15 .tsx files, no sub-structure → leaf
      → analyze stores → 4 zustand stores → leaf
      → analyze world → OfficeCanvas + PixiJS logic → leaf

  → analyze main-process (src/main/)
    → finds: ipc.ts, auth/, engine/, terminal-session-service.ts, store.ts
    → group → write diagram with: auth, engine, terminal-session
      → analyze auth → auth-service.ts, callback-server.ts → leaf
      → analyze engine → claude-code.ts, codex.ts → leaf

  → analyze data-store (src/main/store.ts)
    → single file → leaf

  → analyze terminal-dock (src/renderer/src/panel/)
    → TerminalDock.tsx, DockManager → leaf
```

## Step 4: Summarize

Report what was created/updated and suggest `omm view` to view.

## Diagram Rules

- **Element IDs must match the child directory name.** Use kebab-case: `main-process`, `data-store`, `terminal-dock`.
- **Element labels use two-line format**: name + file path, separated by `\n`:

  ```text
  main-process["Main Process\nsrc/main/"]
  auth-service["Auth Service\nsrc/auth/service.ts"]
  ```

- Every edge must have a meaningful label: `A -->|"why this connection exists"| B`
- **Mark edges that carry something.** When an edge stands for data, files, requests, messages or events moving from A to B (`"upload file"`, `"POST /orders"`, `"publish order.created"`), give it an ID and mark it as animated. The viewer's **flow** button then shows a file icon moving along it:

  ```text
  web e1@-->|"upload file"| api
  api e2@-->|"store file"| files
  e1@{ animate: true }
  e2@{ animate: true }
  ```

  Do not mark dependencies that do not move anything: `imports`, `implements`, `extends`, `aggregates`, `re-exports`, `configures`. Use `animation: slow` for batch or scheduled transfers. Edge IDs must be unique within the diagram.
- **Cross-references** link to an element documented elsewhere. Put `@` plus the element path at the start of the label:
  - `@data-flow` points to a perspective.
  - `@overall-architecture/server` points to a nested element.

  ```text
  viewer["@overall-architecture/server\nsrc/server/"]
  ```

  Only reference elements that exist, and never reference an ancestor of the current element. Run `omm validate` after writing diagrams; it reports broken references.
- More elements in one diagram means you should recurse deeper.
- Use `graph LR` for most diagrams, `graph TD` for hierarchies.
- Use `classDef` for visual distinction when helpful:

  | Style | Color | When to use |
  | --- | --- | --- |
  | `external` | `#585b70` | Third-party services outside your codebase |
  | `concern` | `#f38ba8` | Known risk or bottleneck |
  | `entry` | `#89b4fa` | Entry points (HTTP handler, CLI, queue consumer) |
  | `store` | `#a6e3a1` | Persistent storage (DB, cache, file system) |
  | `error` | `#c0392b` | Process flowcharts: a failed or rejected outcome |
  | `success` | `#23804a` | Process flowcharts: a successful outcome |

  ```text
  classDef external fill:#585b70,stroke:#585b70,color:#cdd6f4
  classDef concern fill:#f38ba8,stroke:#f38ba8,color:#1e1e2e
  classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e
  classDef store fill:#a6e3a1,stroke:#a6e3a1,color:#1e1e2e
  classDef error fill:#fde8e8,stroke:#c0392b,color:#7a1d1d
  classDef success fill:#e3f5e8,stroke:#23804a,color:#14532d
  ```

## ER Diagram Rules

Use an `erDiagram` instead of a flowchart when the element is about **data shape**:

- database tables
- ORM/entity classes
- persisted documents
- file formats

Keep using flowcharts for components, flows and dependencies.

```bash
omm write data-model diagram - <<'MERMAID'
erDiagram
    user ||--o{ order : places
    order ||--|{ order-item : contains
    product ||--o{ order-item : "appears in"
    user {
        uuid id PK
        string email UK "login name"
    }
    order {
        uuid id PK
        uuid user_id FK
        decimal total
    }
MERMAID
```

**Entities**

- Name entities after the real table or model in kebab-case (`order-item`), not invented names.
- If an entity is documented in more detail, its child element directory must have the same name. For example, `data-model/order-item/description`, with the source file and the code that writes it.

**Relationships**

Write each relationship as `A <left><line><right> B : label`. A label is required; quote it when it has spaces.

| Marker | Meaning |
| --- | --- |
| `\|\|` | exactly one |
| `\|o` / `o\|` | zero or one |
| `}\|` / `\|{` | one or more |
| `}o` / `o{` | zero or more |
| `--` | identifying (the child cannot exist without the parent) |
| `..` | non-identifying |

**Attributes**

- Write each attribute as `type name [PK|FK|UK] ["comment"]`. Combine keys with commas (`PK, FK`).
- List only the attributes that matter for understanding: keys, foreign keys, and fields with business meaning. Don't copy every column.

**Size and checking**

- Keep 3–15 entities per diagram. Split large schemas by domain (for example `data-model/billing`, `data-model/catalog`), each with its own ER diagram.
- Run `omm validate` afterwards. It reports ER syntax errors with line numbers, and entities without relationships.

## Sequence Diagram Rules

Use a `sequenceDiagram` instead of a flowchart when the element is about **order over time**:

- a request passing through several components
- a login, checkout or sync protocol
- messages between processes or services

Keep using flowcharts for structure (what exists and what depends on what), and use one sequence diagram per scenario.

```bash
omm write request-lifecycle/login diagram - <<'MERMAID'
sequenceDiagram
    actor user as User
    participant web as Web App
    participant api as API
    participant db as Postgres
    user->>web: submit credentials
    web->>+api: POST /login
    api->>db: SELECT user by email
    db-->>api: user row
    alt password matches
        api-->>web: 200 + session cookie
    else wrong password
        api-->>web: 401
    end
    deactivate api
MERMAID
```

**Participants**

- Declare every participant first, in the order the request reaches them, with `participant id as Label` (or `actor` for people). Use kebab-case ids.
- If a participant is documented in more detail, its child element directory must have the same id, so the viewer can link to it.

**Messages**

Write each message as `A <arrow> B: text`. The text is required: name the real call, endpoint or event (`POST /login`, `publish order.created`).

| Arrow | Meaning |
| --- | --- |
| `->>` | call or request |
| `-->>` | reply |
| `-)` | asynchronous message (fire and forget, events) |
| `-x` / `--x` | failure or rejected message |

- `+` after the arrow activates the receiver, `-` deactivates the sender (`web->>+api`, `api-->>-web`). Only use activations when they make the diagram clearer.
- Use `alt`/`else` for branches, `opt` for optional steps, `loop` for repetition and `par`/`and` for parallel work. Close each with `end`.
- `Note over a,b: text` for facts that are not messages (for example where state is stored).

**Size and checking**

- Keep it to about 3–8 participants and at most 30 messages. Split long flows into one diagram per scenario (for example `request-lifecycle/login`, `request-lifecycle/checkout`).
- Run `omm validate` afterwards. It reports sequence syntax errors with line numbers (unclosed blocks, `else` outside `alt`, messages without text) and participants without messages.

## State Diagram Rules

Use a `stateDiagram-v2` when the element is about **the states something can be in** and what moves it between them:

- an order, payment or job status field
- a connection or session lifecycle
- a UI flow driven by a state machine or reducer

```bash
omm write state-transitions/order diagram - <<'MERMAID'
stateDiagram-v2
    [*] --> draft
    draft --> submitted : submit
    submitted --> check
    state check <<choice>>
    check --> paid : payment ok
    check --> failed : payment declined
    failed --> draft : retry
    state paid {
        [*] --> packing
        packing --> shipped : hand to carrier
    }
    paid --> delivered : delivered
    delivered --> [*]
MERMAID
```

**States**

- Name states after the real values in the code (`draft`, `paid`), in kebab-case. Use `state "Label" as id` for a readable name.
- `[*]` is the start (on the left of `-->`) or the end (on the right). Inside `state x { ... }` it means the start or end of `x`.
- Use `state x { ... }` for sub-states, and `<<choice>>`, `<<fork>>`, `<<join>>` for decisions and parallel paths.
- If a state is documented in more detail, its child element directory must have the same id.

**Transitions**

- Write each transition as `a --> b : trigger`. Name the real event, method or action that causes it (`submit`, `onTimeout`, `PAYMENT_FAILED`).
- Transitions from `[*]`, to `[*]`, out of a `<<choice>>` and into or out of `<<fork>>`/`<<join>>` may leave the trigger out.
- `note right of x : text` for facts that are not transitions (for example side effects).

**Size and checking**

- Keep 3–15 states per diagram. Move the details of a busy state into a composite state or its own child element.
- Run `omm validate` afterwards. It reports syntax errors with line numbers (unclosed `{`, invalid arrows), states without transitions and transitions without a trigger.

## Process Flowchart Rules

Use a **process flowchart** when the element is about **a workflow someone could follow from start to finish**, often for readers who do not know the code (clients, managers, support staff):

- a checkout, sign-up, approval or refund flow
- an onboarding or document-processing workflow
- an algorithm explained step by step

Also use these rules whenever the user asks for a flowchart to explain a process or workflow to someone non-technical.

```bash
omm write business-processes/refund diagram - <<'MERMAID'
flowchart LR
    subgraph customer [Customer]
        start([Asks for a refund]) --> form[/Fills in the refund form/]
        answer([Receives the answer])
    end
    subgraph support [Support team]
        check{Within 30 days?}
        approve[Approve the refund]
        refuse[Explain why it is refused]
    end
    subgraph payments [Payment system]
        pay[[Send the money back to the card]]
    end
    form --> check
    check -->|Yes| approve
    check -->|No| refuse
    approve --> pay
    pay --> answer
    refuse --> answer
MERMAID
```

**Symbols**

| Meaning | Syntax | Shape |
| --- | --- | --- |
| Start / end | `id([Text])` | Rounded pill |
| Step (action) | `id[Text]` | Rectangle |
| Decision (question) | `id{Question?}` | Diamond |
| Input / output (data in or out) | `id[/Text/]` | Parallelogram |
| Document or report | `id@{ shape: doc, label: "Text" }` | Rectangle with a wavy bottom |
| Subprocess (documented separately) | `id[[Text]]` | Rectangle with double sides |
| Connector to another part of the diagram | `id((A))` | Small circle |
| Stored data | `id[(Text)]` | Cylinder |

**Writing for non-technical readers**

- Write steps as short actions in plain words: "Approve the refund", not `RefundService.approve()`. No file paths, class names or jargon.
- Write decisions as yes/no questions ("Within 30 days?") and label **every** answer leaving them: `check -->|Yes| approve`. Use more than two answers when the process has them.
- Mark failed or rejected outcomes with `:::error` and successful ones with `:::success` (`refuse[Explain why it is refused]:::error`). In the viewer's color mode they are drawn red and green; the label must still say what happened, since not every reader sees color.
- Start with one `([Start])` node and end every path at an `([End])` node. A loop goes back to an earlier step with a labelled answer (`more -->|Yes| next-item`).
- Use one `subgraph id [Role]` lane per person, team or system when more than one is involved. Each node belongs to the lane it first appears in.
- Keep 5–15 steps. Move a long part into a `[[subprocess]]` and document it as a child element with its own process flowchart (its ID must match the child directory).
- Ordinary steps, decisions and start/end nodes are not elements: they need no child directory or description. Only `[[subprocess]]` steps become child elements.
- Labels are one line (use `<br>` for a deliberate line break; long labels wrap automatically). Do not add the `\n` file-path line used in architecture diagrams.
- Run `omm validate` afterwards. In a flowchart with a start or end node, it only asks for labels on decision branches, and warns about a decision with fewer than two ways out.

To present a flowchart, open it with `omm view`, click **color** (colors by meaning) and **clean** (hides file paths), select the perspective and click **png** or **svg**. The ○ button switches to the light theme, which usually suits slides better. When presenting live, **flow** shows a file icon moving along every arrow of a process flowchart; no `animate` marks are needed there. To keep one arrow still, give it an ID and `animate: false`.

## General Rules

- **Write each field as a separate `omm write` command.** Each `omm write` must be its own Bash tool call.
- Do not rewrite elements that haven't changed.
- Do not create circular references. A child element must never reference its parent.
- **Never copy secrets into `.omm/`.** No passwords, tokens, keys, connection strings with credentials or values from `.env` files, in any field. Write where a secret comes from instead ("reads `DB_PASSWORD` from the environment"). `omm write` warns and `omm validate` reports an error (`secret-value`) when something looks like a secret; if that happens, rewrite the field without it.
