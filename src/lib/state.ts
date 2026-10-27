/**
 * Mermaid stateDiagram / stateDiagram-v2 parser — shared by the CLI (validate, diff) and the
 * viewer (bundled as dist/omm-viewer.global.js). Keep it dependency-free.
 */

import { contentLines } from './diagram.js';

export type StateKind = 'state' | 'start' | 'end' | 'choice' | 'fork' | 'join';

export interface StState {
  id: string;
  kind: StateKind;
  /** Display name from `state "Label" as id`, if any */
  label?: string;
  /** Lines from `id : text` */
  descriptions: string[];
  /** Id of the enclosing composite state; undefined at the top level */
  parent?: string;
  /** True for `state id { ... }` */
  composite: boolean;
}

export interface StTransition {
  from: string;
  to: string;
  label: string;
  line: number;
}

export interface StNote {
  state: string;
  placement: 'left of' | 'right of';
  text: string;
}

export interface StParseError {
  line: number;
  message: string;
}

export interface StateDiagram {
  direction: 'TB' | 'BT' | 'LR' | 'RL';
  /** In order of first appearance; includes the `[*]` start and end pseudo-states */
  states: Map<string, StState>;
  transitions: StTransition[];
  notes: StNote[];
  errors: StParseError[];
}

const START = '[*]';
// `[*]` is scoped: each composite state has its own start and end
const START_SUFFIX = '[*]start';
const END_SUFFIX = '[*]end';

const ID = String.raw`(?:\[\*\]|[\w.-]+)`;
const CLASS_SUFFIX = String.raw`(?::::[\w-]+)?`;
const TRANSITION = new RegExp(String.raw`^(${ID})${CLASS_SUFFIX}\s*-->\s*(${ID})${CLASS_SUFFIX}\s*(?::\s*(.*))?$`);
const DECLARE = /^state\s+(?:"([^"]*)"\s+as\s+([\w.-]+)|([\w.-]+)(?:\s+as\s+"([^"]*)")?)\s*(<<(choice|fork|join)>>)?\s*(\{)?$/;
const DESCRIPTION = /^([\w.-]+)\s*:\s*(.+)$/;
const NOTE_LINE = /^note\s+(left of|right of)\s+([\w.-]+)\s*:\s*(.*)$/i;
const NOTE_OPEN = /^note\s+(left of|right of)\s+([\w.-]+)\s*$/i;
const DIRECTION = /^direction\s+(TB|BT|LR|RL)$/i;
const SKIP = /^(title|accTitle|accDescr|classDef|class|style|scale|hide\s+empty\s+description)(\s|:|$)/;

/** Id of the `[*]` pseudo-state in a scope (undefined = top level) */
export function pseudoStateId(scope: string | undefined, kind: 'start' | 'end'): string {
  return `${scope ? scope + '/' : ''}${kind === 'start' ? START_SUFFIX : END_SUFFIX}`;
}

/** Readable name for a state id: `[*]` for start and end pseudo-states */
export function stateDisplayId(id: string): string {
  if (id.endsWith(START_SUFFIX) || id.endsWith(END_SUFFIX)) {
    const scope = id.slice(0, -(START_SUFFIX.length));
    return scope.endsWith('/') ? `${scope}${START}` : START;
  }
  return id;
}

export function parseStateDiagram(text: string): StateDiagram {
  const states = new Map<string, StState>();
  const transitions: StTransition[] = [];
  const notes: StNote[] = [];
  const errors: StParseError[] = [];
  let direction: StateDiagram['direction'] = 'TB';

  const scopes: Array<{ id: string; line: number }> = [];
  const scope = () => scopes[scopes.length - 1]?.id;

  const ensure = (id: string): StState => {
    let s = states.get(id);
    if (!s) {
      s = { id, kind: 'state', descriptions: [], parent: scope(), composite: false };
      states.set(id, s);
    }
    return s;
  };
  const endpoint = (raw: string, side: 'from' | 'to'): string => {
    if (raw !== START) return ensure(raw).id;
    const kind = side === 'from' ? 'start' : 'end';
    const id = pseudoStateId(scope(), kind);
    if (!states.has(id)) states.set(id, { id, kind, descriptions: [], parent: scope(), composite: false });
    return id;
  };

  const lines = contentLines(text);
  let note: (StNote & { line: number }) | null = null;

  for (let i = 0; i < lines.length; i++) {
    const { line, text: t } = lines[i];
    if (i === 0) {
      if (!/^stateDiagram(-v2)?(\s|$)/.test(t)) errors.push({ line, message: 'State diagram must start with "stateDiagram-v2"' });
      continue;
    }

    if (note) {
      if (/^end\s+note$/i.test(t)) {
        notes.push({ state: note.state, placement: note.placement, text: note.text });
        note = null;
      } else {
        note.text = note.text ? `${note.text}\n${t}` : t;
      }
      continue;
    }

    if (t === '}') {
      if (!scopes.pop()) errors.push({ line, message: '"}" without an open composite state' });
      continue;
    }
    // Separator between concurrent regions of a composite state: accepted, not modelled
    if (t === '--') {
      if (!scope()) errors.push({ line, message: '"--" is only allowed inside a composite state' });
      continue;
    }

    const dir = t.match(DIRECTION);
    if (dir) { direction = dir[1].toUpperCase() as StateDiagram['direction']; continue; }
    if (SKIP.test(t)) continue;

    const tr = t.match(TRANSITION);
    if (tr) {
      const from = endpoint(tr[1], 'from');
      const to = endpoint(tr[2], 'to');
      transitions.push({ from, to, label: (tr[3] ?? '').trim(), line });
      continue;
    }

    const decl = t.match(DECLARE);
    if (decl) {
      const id = decl[2] ?? decl[3];
      const s = ensure(id);
      const label = decl[1] ?? decl[4];
      if (label) s.label = label;
      if (decl[6]) s.kind = decl[6] as StateKind;
      if (decl[7]) {
        s.composite = true;
        scopes.push({ id, line });
      }
      continue;
    }

    const noteLine = t.match(NOTE_LINE);
    if (noteLine) {
      notes.push({ state: ensure(noteLine[2]).id, placement: noteLine[1].toLowerCase() as StNote['placement'], text: noteLine[3].trim() });
      continue;
    }
    const noteOpen = t.match(NOTE_OPEN);
    if (noteOpen) {
      note = { state: ensure(noteOpen[2]).id, placement: noteOpen[1].toLowerCase() as StNote['placement'], text: '', line };
      continue;
    }

    const desc = t.match(DESCRIPTION);
    if (desc) {
      ensure(desc[1]).descriptions.push(desc[2].trim());
      continue;
    }

    if (/^[\w.-]+$/.test(t)) { ensure(t); continue; }

    errors.push({
      line,
      message: /--|->/.test(t)
        ? `Invalid transition: "${t}" (expected: a --> b : event)`
        : `Unrecognized statement: "${t}"`,
    });
  }

  if (note) errors.push({ line: note.line, message: 'Note is missing its closing "end note"' });
  for (const open of scopes) {
    errors.push({ line: open.line, message: `Composite state ${open.id} is missing its closing "}"` });
  }

  return { direction, states, transitions, notes, errors };
}
