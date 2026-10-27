/**
 * Flowchart parser (`graph` / `flowchart`), shared by `omm diff`, `omm validate` and the
 * viewer (bundled into dist/omm-viewer.global.js). Keep it dependency-free.
 *
 * Covers the classic shape syntax (`[ ]`, `([ ])`, `{ }`, `[/ /]`, `[[ ]]` …), the
 * `id@{ shape: doc, label: "…" }` form for the common flowchart shapes, `-->|label|` and
 * `-- label -->` edges, chains (`a --> b --> c`), `&` fan-out, `:::class` suffixes and
 * subgraphs. Errors carry line numbers.
 */
import { contentLines } from './diagram.js';

export type FlowDirection = 'TB' | 'BT' | 'LR' | 'RL';

export type FlowShape =
  | 'rect'           // [text]     process
  | 'round'          // (text)
  | 'stadium'        // ([text])   start / end
  | 'subroutine'     // [[text]]   predefined process
  | 'cylinder'       // [(text)]   database
  | 'circle'         // ((text))   connector
  | 'double-circle'  // (((text)))
  | 'small-circle'   // @{ shape: start }
  | 'asymmetric'     // >text]
  | 'diamond'        // {text}     decision
  | 'hexagon'        // {{text}}
  | 'lean-right'     // [/text/]   input / output
  | 'lean-left'      // [\text\]
  | 'trapezoid'      // [/text\]
  | 'trapezoid-alt'  // [\text/]
  | 'document';      // @{ shape: doc }

export interface FlowNode {
  /** ID without a leading `@` */
  id: string;
  /** ID as written (legacy `@id` references keep the `@`) */
  rawId: string;
  /** Display text; lines (from `<br>`) are separated by `\n` */
  label: string;
  /** Text after a literal `\n` in the label: omm-scan's convention for a path or subtitle line */
  detail?: string;
  shape: FlowShape;
  cls?: string;
  isRef: boolean;
  refTarget: string | null;
  /** Innermost subgraph the node was first mentioned in */
  subgraph?: string;
  line: number;
}

export type FlowLineStyle = 'solid' | 'dotted' | 'thick' | 'invisible';
export type FlowHead = 'arrow' | 'circle' | 'cross' | 'none';

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  /** Normalized arrow (`-->`, `-.->`, `==>`, `---`, `<-->` …); `-- text -->` becomes `-->` */
  arrow: string;
  style: FlowLineStyle;
  head: FlowHead;
  tail: FlowHead;
  /** Rank distance: 1 for `-->`, 2 for `--->` … */
  length: number;
  line: number;
  /** Edge ID from `a e1@--> b` */
  id?: string;
  /** From `e1@{ animate: true }`; undefined when not written */
  animate?: boolean;
  /** From `e1@{ animation: fast }` */
  animation?: 'fast' | 'slow';
}

export interface FlowSubgraph {
  id: string;
  label: string;
  parent?: string;
  direction?: FlowDirection;
  line: number;
}

export interface FlowError {
  line: number;
  message: string;
}

export interface Flowchart {
  direction: FlowDirection;
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  subgraphs: Map<string, FlowSubgraph>;
  errors: FlowError[];
}

const HEADER = /^(graph|flowchart)(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i;
const SKIP = /^(classDef|click|style|linkStyle|accTitle|accDescr|title)(\s|:|$)/i;
const CLASS_ASSIGN = /^class\s+(.+?)\s+([\w-]+)\s*;?$/;

// Arrow forms: -->, --->, ---, -.->, -.-, ==>, ===, --o, --x, ~~~ (optionally bidirectional with a leading <)
const ARROW = /^<?(?:-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|-{2,}[ox]|={2,}[ox]|~{3,})/;
// Inline text form: A -- text --> B, A == text ==> B, A -. text .-> B
const INLINE_ARROW = /^<?(--|==|-\.)\s+("[^"]*"|[^"]*?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+|-{2,}[ox])/;
const PIPE_LABEL = /^\s*\|([^|]*)\|/;
const SHAPE_OPEN = '[({';
const SHAPE_CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}' };

// [open, close, shape], longest delimiters first
const DELIMITERS: [string, string, FlowShape][] = [
  ['(((', ')))', 'double-circle'],
  ['((', '))', 'circle'],
  ['([', '])', 'stadium'],
  ['[(', ')]', 'cylinder'],
  ['[[', ']]', 'subroutine'],
  ['[/', '/]', 'lean-right'],
  ['[\\', '\\]', 'lean-left'],
  ['[/', '\\]', 'trapezoid'],
  ['[\\', '/]', 'trapezoid-alt'],
  ['{{', '}}', 'hexagon'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
  ['>', ']', 'asymmetric'],
];

// `id@{ shape: … }` names (Mermaid 11) for the shapes the viewer draws; others fall back to rect
const NAMED_SHAPES: Record<string, FlowShape> = {
  rect: 'rect', rectangle: 'rect', proc: 'rect', process: 'rect',
  rounded: 'round', event: 'round',
  stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
  subroutine: 'subroutine', subproc: 'subroutine', subprocess: 'subroutine', 'fr-rect': 'subroutine', 'framed-rectangle': 'subroutine',
  cyl: 'cylinder', cylinder: 'cylinder', db: 'cylinder', database: 'cylinder',
  circle: 'circle', circ: 'circle',
  'dbl-circ': 'double-circle', 'double-circle': 'double-circle', stop: 'double-circle', 'fr-circ': 'double-circle', 'framed-circle': 'double-circle',
  start: 'small-circle', 'sm-circ': 'small-circle', 'small-circle': 'small-circle',
  diam: 'diamond', diamond: 'diamond', decision: 'diamond', question: 'diamond',
  hex: 'hexagon', hexagon: 'hexagon', prepare: 'hexagon',
  'lean-r': 'lean-right', 'lean-right': 'lean-right', 'in-out': 'lean-right',
  'lean-l': 'lean-left', 'lean-left': 'lean-left', 'out-in': 'lean-left',
  'trap-b': 'trapezoid', trapezoid: 'trapezoid', 'trapezoid-bottom': 'trapezoid', priority: 'trapezoid',
  'trap-t': 'trapezoid-alt', 'trapezoid-top': 'trapezoid-alt', manual: 'trapezoid-alt', 'inv-trapezoid': 'trapezoid-alt',
  doc: 'document', document: 'document',
};

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'" };

/** Label text as shown: quotes and markdown backticks removed, `<br>`/`\n` as newlines, `#quot;` decoded */
export function cleanFlowLabel(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/#(\w+);/g, (m, code: string) => {
      if (/^\d+$/.test(code)) return String.fromCodePoint(Number(code));
      return ENTITIES[code] ?? m;
    });
}

/** Split a line on `;` outside quoted text (Mermaid allows several statements per line). */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map(s => s.trim()).filter(Boolean);
}

/** Length of the shape starting at s[0] ("[...]", "((...))", "[(...)]", ">...]"), or 0 if malformed. */
function shapeLength(s: string): number {
  if (s[0] === '>') {
    const end = s.indexOf(']');
    return end < 0 ? 0 : end + 1;
  }
  const stack: string[] = [];
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (SHAPE_OPEN.includes(ch)) stack.push(SHAPE_CLOSE[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return 0;
}

/** Length of `{ ... }` starting at s[0], quote-aware, or 0 if unclosed. */
function braceLength(s: string): number {
  let inQuote = false;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '"') inQuote = !inQuote;
    else if (s[i] === '}' && !inQuote) return i + 1;
  }
  return 0;
}

/** Shape and label from a bracketed shape such as `([Start])` or `[/Input/]`. */
function classifyShape(text: string): { shape: FlowShape; label: string; detail?: string } {
  for (const [open, close, shape] of DELIMITERS) {
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      return { shape, ...withDetail(text.slice(open.length, text.length - close.length)) };
    }
  }
  return { shape: 'rect', ...withDetail(text) };
}

/** Shape and label from `@{ shape: doc, label: "Invoice" }`. */
function parseShapeConfig(body: string): { shape?: FlowShape; label?: string; detail?: string } {
  const out: { shape?: FlowShape; label?: string; detail?: string } = {};
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of body) {
    if (ch === '"') inQuote = !inQuote;
    if ((ch === ',' || ch === '\n') && !inQuote) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  for (const part of parts) {
    const m = part.match(/^\s*(\w+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    if (m[1] === 'shape') out.shape = NAMED_SHAPES[m[2].replace(/["']/g, '').toLowerCase()] ?? 'rect';
    if (m[1] === 'label') Object.assign(out, withDetail(m[2]));
  }
  return out;
}

interface NodeRef {
  rawId: string;
  shape?: FlowShape;
  label?: string;
  detail?: string;
  cls?: string;
}

/** Split omm-scan's `Name\nsrc/path/` labels into the label and its detail line */
function withDetail(raw: string): { label: string; detail?: string } {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  const i = s.indexOf('\\n');
  if (i < 0) return { label: cleanFlowLabel(s) };
  return { label: cleanFlowLabel(s.slice(0, i)), detail: cleanFlowLabel(s.slice(i + 2)).replace(/\n/g, ' ') };
}

/**
 * Read a node reference at the start of s: an ID, an optional shape and an optional
 * `:::class`. Returns the node and the number of characters consumed, or null.
 */
function readNode(s: string): { node: NodeRef; length: number } | null {
  let i = 0;
  // IDs end at whitespace, a shape opener, `&`, `:::`, `@{` or the start of an arrow
  while (i < s.length && !/[\s[({>&;|]/.test(s[i]) && !s.startsWith(':::', i) && !s.startsWith('@{', i) && !ARROW.test(s.slice(i)) && !INLINE_ARROW.test(s.slice(i))) {
    i++;
  }
  if (i === 0) return null;
  const node: NodeRef = { rawId: s.slice(0, i).replace(/["']/g, '') };
  if (s.startsWith('@{', i)) {
    const len = braceLength(s.slice(i + 1));
    if (len === 0) return null;
    Object.assign(node, parseShapeConfig(s.slice(i + 2, i + len)));
    node.shape ??= 'rect';
    i += 1 + len;
  } else if (i < s.length && (SHAPE_OPEN.includes(s[i]) || s[i] === '>')) {
    const len = shapeLength(s.slice(i));
    if (len === 0) return null;
    Object.assign(node, classifyShape(s.slice(i, i + len)));
    i += len;
  }
  const cls = s.slice(i).match(/^:::([\w-]+)/);
  if (cls) { node.cls = cls[1]; i += cls[0].length; }
  return { node, length: i };
}

/** Read one or more `&`-joined nodes. */
function readNodeGroup(s: string): { nodes: NodeRef[]; length: number } | null {
  const nodes: NodeRef[] = [];
  let pos = 0;
  for (;;) {
    pos += s.slice(pos).length - s.slice(pos).trimStart().length;
    const read = readNode(s.slice(pos));
    if (!read) return nodes.length ? { nodes, length: pos } : null;
    nodes.push(read.node);
    pos += read.length;
    const amp = s.slice(pos).match(/^\s*&\s*/);
    if (!amp) return { nodes, length: pos };
    pos += amp[0].length;
  }
}

/**
 * Read an arrow (with an optional `id@` before it and an optional |label| or inline text).
 * Returns the normalized arrow, its label and its ID.
 */
function readArrow(s: string): { arrow: string; label: string; length: number; id?: string } | null {
  let lead = s.length - s.trimStart().length;
  let rest = s.slice(lead);
  // `a e1@--> b`: an edge ID needs whitespace before it, or it is part of the source ID
  const edgeId = lead > 0 ? rest.match(/^([A-Za-z_][\w-]*)@(?=[-=.~<ox])/) : null;
  if (edgeId) {
    lead += edgeId[0].length;
    rest = rest.slice(edgeId[0].length);
  }
  const id = edgeId?.[1];
  // `o--o` and `x--x`: a circle or cross at the start needs whitespace before it, or it is part of an ID
  let startHead = '';
  if (lead > 0 && /^[ox](?=[-=])/.test(rest) && ARROW.test(rest.slice(1))) {
    startHead = rest[0];
    rest = rest.slice(1);
  }
  const offset = lead + startHead.length;
  const inline = rest.match(INLINE_ARROW);
  if (inline) {
    const open = inline[1];
    const close = inline[3];
    // "-- text -->" is the same edge type as "-->"; "-. text .->" as "-.->"
    const arrow = startHead + (inline[0].startsWith('<') ? '<' : '') + (open === '-.' ? `-${close}` : close);
    return { arrow, label: cleanFlowLabel(inline[2]).replace(/\n/g, ' '), length: offset + inline[0].length, id };
  }
  const plain = rest.match(ARROW);
  if (!plain) return null;
  let length = offset + plain[0].length;
  let label = '';
  const pipe = s.slice(length).match(PIPE_LABEL);
  if (pipe) {
    length += pipe[0].length;
    label = cleanFlowLabel(pipe[1]).replace(/\n/g, ' ');
  }
  return { arrow: startHead + plain[0], label, length, id };
}

const EDGE_SETTINGS = /^([A-Za-z_][\w-]*)@\{([\s\S]*)\}$/;

/**
 * Settings from `e1@{ animate: true }` or `e1@{ animation: slow }`. Returns null when the
 * block has other keys (then it is a node shape such as `doc@{ shape: doc }`).
 */
function parseEdgeSettings(body: string): Pick<FlowEdge, 'animate' | 'animation'> | null {
  const out: Pick<FlowEdge, 'animate' | 'animation'> = {};
  const parts = body.split(/[,\n]/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = part.match(/^(\w+)\s*:\s*["']?(\w+)["']?$/);
    if (!m) return null;
    const value = m[2].toLowerCase();
    if (m[1] === 'animate') out.animate = value === 'true';
    else if (m[1] === 'animation') {
      if (value === 'fast' || value === 'slow') out.animation = value;
      out.animate ??= true;
    } else if (m[1] !== 'curve') return null;
  }
  return out;
}

function headOf(ch: string | undefined): FlowHead {
  if (ch === '>' || ch === '<') return 'arrow';
  if (ch === 'o') return 'circle';
  if (ch === 'x') return 'cross';
  return 'none';
}

/** Line style, heads and rank length of a normalized arrow. */
export function arrowStyle(arrow: string): Pick<FlowEdge, 'style' | 'head' | 'tail' | 'length'> {
  if (arrow.startsWith('~')) return { style: 'invisible', head: 'none', tail: 'none', length: 1 };
  const head = headOf(/[>ox]$/.test(arrow) ? arrow[arrow.length - 1] : undefined);
  const tail = headOf(/^[<ox]/.test(arrow) ? arrow[0] : undefined);
  const body = arrow.replace(/^[<ox]/, '').replace(/[>ox]$/, '');
  const style: FlowLineStyle = body.includes('.') ? 'dotted' : body.includes('=') ? 'thick' : 'solid';
  const count = style === 'dotted' ? (body.match(/\./g) ?? []).length + 1 : body.length;
  return { style, head, tail, length: Math.max(1, head === 'none' ? count - 2 : count - 1) };
}

const REF_LABEL = /^@([\w-]+)/;

/** Parse a flowchart. Lines that cannot be read are reported in `errors`. */
export function parseFlowchart(text: string): Flowchart {
  const fc: Flowchart = { direction: 'TB', nodes: new Map(), edges: [], subgraphs: new Map(), errors: [] };
  const lines = contentLines(text);
  const stack: string[] = [];
  const explicit = new Set<string>(); // nodes with a written shape or label
  const classOf = new Map<string, string>();
  const settingsOf: { id: string; settings: Pick<FlowEdge, 'animate' | 'animation'>; line: number }[] = [];

  const touch = (ref: NodeRef, line: number): string => {
    const isRefId = ref.rawId.startsWith('@');
    const id = ref.rawId.replace(/^@/, '');
    let node = fc.nodes.get(id);
    if (!node) {
      node = { id, rawId: ref.rawId, label: id, shape: 'rect', isRef: isRefId, refTarget: isRefId ? id : null, line };
      fc.nodes.set(id, node);
    }
    // A later definition replaces the shape and label, as in Mermaid
    if (ref.shape || ref.label !== undefined) {
      explicit.add(id);
      node.shape = ref.shape ?? 'rect';
      if (ref.label !== undefined) node.label = ref.label;
      node.detail = ref.detail;
      const r = node.label.match(REF_LABEL);
      if (r) { node.isRef = true; node.refTarget = r[1]; }
    }
    if (ref.cls) node.cls = ref.cls;
    if (stack.length && node.subgraph === undefined) node.subgraph = stack[stack.length - 1];
    return id;
  };

  let start = 0;
  const header = lines[0]?.text.match(HEADER);
  if (header) {
    const d = (header[2] ?? 'TB').toUpperCase();
    fc.direction = (d === 'TD' ? 'TB' : d) as FlowDirection;
    start = 1;
  }

  // Join `id@{ ... }` blocks that span several lines
  const statements: { line: number; text: string }[] = [];
  for (let i = start; i < lines.length; i++) {
    let { text: t } = lines[i];
    const line = lines[i].line;
    while (/@\{[^}]*$/.test(t) && i + 1 < lines.length) t += '\n' + lines[++i].text;
    for (const s of splitStatements(t)) statements.push({ line, text: s });
  }

  for (const { line, text: s } of statements) {
    if (SKIP.test(s)) continue;

    const cls = s.match(CLASS_ASSIGN);
    if (cls) {
      cls[1].split(',').map(x => x.trim()).filter(Boolean).forEach(id => classOf.set(id.replace(/^@/, ''), cls[2]));
      continue;
    }

    const sub = s.match(/^subgraph(?:\s+(.*))?$/);
    if (sub) {
      const rest = (sub[1] ?? '').trim();
      const m = rest.match(/^([^\s[]+)\s*\[(.*)\]$/);
      const id = m ? m[1] : rest.replace(/^"|"$/g, '') || `subgraph-${fc.subgraphs.size + 1}`;
      const label = m ? cleanFlowLabel(m[2]) : cleanFlowLabel(rest) || id;
      fc.subgraphs.set(id, { id, label, parent: stack[stack.length - 1], line });
      stack.push(id);
      continue;
    }
    if (s === 'end') {
      if (!stack.pop()) fc.errors.push({ line, message: '"end" without an open subgraph' });
      continue;
    }
    const dir = s.match(/^direction\s+(TB|TD|BT|LR|RL)$/i);
    if (dir) {
      const sg = fc.subgraphs.get(stack[stack.length - 1]);
      const d = dir[1].toUpperCase();
      if (sg) sg.direction = (d === 'TD' ? 'TB' : d) as FlowDirection;
      continue;
    }

    const settings = s.match(EDGE_SETTINGS);
    const edgeSettings = settings && parseEdgeSettings(settings[2]);
    if (settings && edgeSettings) {
      settingsOf.push({ id: settings[1], settings: edgeSettings, line });
      continue;
    }

    // Node and edge statements: a node group, then any number of arrow + node group
    const unreadable = (rest: string) => /[[({]/.test(rest)
      ? `Could not read node shape (unclosed bracket?): ${s}`
      : `Unrecognized statement: ${s}`;
    let group = readNodeGroup(s);
    if (!group) {
      fc.errors.push({ line, message: unreadable(s) });
      continue;
    }
    let ids = group.nodes.map(n => touch(n, line));
    let pos = group.length;
    for (;;) {
      const arrow = readArrow(s.slice(pos));
      if (!arrow) break;
      pos += arrow.length;
      const next = readNodeGroup(s.slice(pos));
      if (!next) {
        fc.errors.push({ line, message: `Edge without a target node: ${s}` });
        pos = s.length;
        break;
      }
      pos += next.length;
      const nextIds = next.nodes.map(n => touch(n, line));
      for (const from of ids) {
        for (const to of nextIds) {
          const edge: FlowEdge = { from, to, label: arrow.label, arrow: arrow.arrow, ...arrowStyle(arrow.arrow), line };
          if (arrow.id) edge.id = arrow.id;
          fc.edges.push(edge);
        }
      }
      ids = nextIds;
      group = next;
    }
    const leftover = s.slice(pos).trim();
    if (leftover) fc.errors.push({ line, message: unreadable(leftover) });
  }

  for (const id of stack.reverse()) {
    fc.errors.push({ line: fc.subgraphs.get(id)!.line, message: `Subgraph ${id} is missing its closing "end"` });
  }

  for (const [id, c] of classOf) {
    const node = fc.nodes.get(id);
    if (node) node.cls = c;
  }

  // Edge settings may come before or after the edge they name
  for (const { id, settings, line } of settingsOf) {
    const named = fc.edges.filter(e => e.id === id);
    if (!named.length) fc.errors.push({ line, message: `No edge with ID ${id} (write it as: a ${id}@--> b)` });
    for (const e of named) Object.assign(e, settings);
  }

  // An edge to a subgraph ID links to the subgraph, not to a new node
  for (const id of fc.subgraphs.keys()) {
    if (fc.nodes.has(id) && !explicit.has(id)) fc.nodes.delete(id);
  }

  return fc;
}
