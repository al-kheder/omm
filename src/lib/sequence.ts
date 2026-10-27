/**
 * Mermaid sequenceDiagram parser — shared by the CLI (validate, diff) and the viewer
 * (bundled as dist/omm-viewer.global.js). Keep it dependency-free.
 */

import { contentLines } from './diagram.js';

export interface SeqParticipant {
  id: string;
  /** Display name from `participant id as Label`, if any */
  label?: string;
  kind: 'participant' | 'actor';
}

export type SeqBlockType = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect';

export type SeqEvent =
  | {
      kind: 'message';
      line: number;
      from: string;
      to: string;
      /** The arrow as written: ->, -->, ->>, -->>, -x, --x, -), --), <<->>, <<-->> */
      arrow: string;
      text: string;
      /** `+` after the arrow: activates the receiver */
      activate: boolean;
      /** `-` after the arrow: deactivates the sender */
      deactivate: boolean;
    }
  | { kind: 'note'; line: number; placement: 'left of' | 'right of' | 'over'; participants: string[]; text: string }
  | { kind: 'activate' | 'deactivate'; line: number; participant: string }
  /** Opens loop/alt/opt/par/critical/break/rect; the label of `rect` is its colour */
  | { kind: 'block'; line: number; type: SeqBlockType; label: string }
  /** `else` (alt), `and` (par) or `option` (critical) */
  | { kind: 'branch'; line: number; label: string }
  | { kind: 'end'; line: number };

export interface SeqBox {
  label: string;
  participants: string[];
}

export interface SeqParseError {
  line: number;
  message: string;
}

export interface SequenceDiagram {
  /** In order of first appearance */
  participants: Map<string, SeqParticipant>;
  events: SeqEvent[];
  boxes: SeqBox[];
  autonumber: boolean;
  errors: SeqParseError[];
}

export interface SeqMessageStyle {
  dashed: boolean;
  /** filled: ->>, none: ->, cross: -x, async: -) */
  head: 'filled' | 'none' | 'cross' | 'async';
  bidirectional: boolean;
}

// Longest arrows first, so `-->>` is not read as `-->` followed by `>`
const ARROWS = ['<<-->>', '<<->>', '-->>', '->>', '--x', '-x', '--)', '-)', '-->', '->'];
const ARROW_SOURCE = ARROWS.map(a => a.replace(/[()]/g, '\\$&')).join('|');
// Participant names cannot contain ":"; the first arrow in the line separates sender and receiver
const MESSAGE = new RegExp(String.raw`^([^:]+?)\s*(${ARROW_SOURCE})\s*([+-]?)\s*([^:]+?)\s*:\s*(.*)$`);
const MESSAGE_NO_TEXT = new RegExp(String.raw`^([^:]+?)\s*(${ARROW_SOURCE})\s*[+-]?\s*([^:]+?)\s*$`);
const PARTICIPANT = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/;
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i;
const ACTIVATION = /^(activate|deactivate)\s+(.+)$/;
const BLOCK = /^(loop|alt|opt|par|critical|break)(?:\s+(.*))?$/;
const BRANCH = /^(else|and|option)(?:\s+(.*))?$/;
const BRANCH_OF: Record<string, SeqBlockType> = { else: 'alt', and: 'par', option: 'critical' };
const SKIP = /^(title|accTitle|accDescr|links?|properties|details)(\s|:|$)/;

/** Line style and arrowhead for a message arrow */
export function messageStyle(arrow: string): SeqMessageStyle {
  const bidirectional = arrow.startsWith('<<');
  const body = bidirectional ? arrow.slice(2) : arrow;
  const dashed = body.startsWith('--');
  const end = body.slice(dashed ? 2 : 1);
  const head = end === '>>' ? 'filled' : end === 'x' ? 'cross' : end === ')' ? 'async' : 'none';
  return { dashed, head, bidirectional };
}

/** `id@{ ... }` participant config is accepted but not used */
function participantId(raw: string): string {
  return raw.replace(/@\{.*\}$/, '').trim();
}

export function parseSequenceDiagram(text: string): SequenceDiagram {
  const participants = new Map<string, SeqParticipant>();
  const events: SeqEvent[] = [];
  const boxes: SeqBox[] = [];
  const errors: SeqParseError[] = [];
  let autonumber = false;

  const ensure = (id: string, kind?: SeqParticipant['kind'], label?: string): SeqParticipant => {
    let p = participants.get(id);
    if (!p) {
      p = { id, kind: kind ?? 'participant' };
      participants.set(id, p);
    } else if (kind) {
      p.kind = kind;
    }
    if (label) p.label = label;
    return p;
  };

  // Open blocks and boxes, innermost last
  const stack: Array<{ type: SeqBlockType | 'box'; line: number; box?: SeqBox }> = [];
  const active = new Map<string, number>();
  const deactivate = (id: string, line: number) => {
    const n = active.get(id) ?? 0;
    if (n === 0) errors.push({ line, message: `${id} is deactivated but is not active` });
    else active.set(id, n - 1);
  };

  const lines = contentLines(text);
  for (let i = 0; i < lines.length; i++) {
    const { line, text: t } = lines[i];
    if (i === 0) {
      if (!/^sequenceDiagram(\s|$)/.test(t)) errors.push({ line, message: 'Sequence diagram must start with "sequenceDiagram"' });
      continue;
    }

    const box = stack[stack.length - 1]?.box;

    if (t === 'end') {
      const top = stack.pop();
      if (!top) errors.push({ line, message: '"end" without an open block' });
      else if (top.type !== 'box') events.push({ kind: 'end', line });
      continue;
    }

    const decl = t.match(PARTICIPANT);
    if (decl) {
      const id = participantId(decl[2]);
      ensure(id, decl[1] as SeqParticipant['kind'], decl[3]?.trim());
      if (box) box.participants.push(id);
      continue;
    }

    if (box) {
      errors.push({ line, message: `Only participant declarations are allowed inside "box": "${t}"` });
      continue;
    }

    if (/^autonumber\b/.test(t)) { autonumber = !/\boff$/.test(t); continue; }
    if (SKIP.test(t)) continue;

    const note = t.match(NOTE);
    if (note) {
      const ids = note[2].split(',').map(s => s.trim()).filter(Boolean);
      ids.forEach(id => ensure(id));
      events.push({ kind: 'note', line, placement: note[1].toLowerCase() as 'left of' | 'right of' | 'over', participants: ids, text: note[3].trim() });
      continue;
    }

    const act = t.match(ACTIVATION);
    if (act) {
      const id = ensure(act[2].trim()).id;
      if (act[1] === 'activate') active.set(id, (active.get(id) ?? 0) + 1);
      else deactivate(id, line);
      events.push({ kind: act[1] as 'activate' | 'deactivate', line, participant: id });
      continue;
    }

    const destroy = t.match(/^destroy\s+(.+)$/);
    if (destroy) { ensure(destroy[1].trim()); continue; }

    const block = t.match(BLOCK) ?? t.match(/^(rect)\s+(.+)$/);
    if (block) {
      const type = block[1] as SeqBlockType;
      stack.push({ type, line });
      events.push({ kind: 'block', line, type, label: (block[2] ?? '').trim() });
      continue;
    }

    const branch = t.match(BRANCH);
    if (branch) {
      const expected = BRANCH_OF[branch[1]];
      if (stack[stack.length - 1]?.type !== expected) {
        errors.push({ line, message: `"${branch[1]}" is only allowed inside "${expected}"` });
      } else {
        events.push({ kind: 'branch', line, label: (branch[2] ?? '').trim() });
      }
      continue;
    }

    const msg = t.match(MESSAGE);
    if (msg) {
      const from = ensure(msg[1].trim()).id;
      const to = ensure(msg[4].trim()).id;
      events.push({
        kind: 'message', line, from, to,
        arrow: msg[2],
        text: msg[5].trim(),
        activate: msg[3] === '+',
        deactivate: msg[3] === '-',
      });
      if (msg[3] === '+') active.set(to, (active.get(to) ?? 0) + 1);
      if (msg[3] === '-') deactivate(from, line);
      continue;
    }

    const boxOpen = t.match(/^box(?:\s+(.*))?$/);
    if (boxOpen) {
      const b: SeqBox = { label: (boxOpen[1] ?? '').trim(), participants: [] };
      boxes.push(b);
      stack.push({ type: 'box', line, box: b });
      continue;
    }

    errors.push({
      line,
      message: MESSAGE_NO_TEXT.test(t)
        ? `Message without text: "${t}" (expected: A->>B: text)`
        : `Unrecognized statement: "${t}"`,
    });
  }

  for (const open of stack) {
    errors.push({ line: open.line, message: `"${open.type}" is missing its closing "end"` });
  }

  return { participants, events, boxes, autonumber, errors };
}
