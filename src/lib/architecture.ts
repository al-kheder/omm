/**
 * Mermaid architecture-beta parser — shared by the CLI (validate, diff) and the viewer
 * (bundled as dist/omm-viewer.js). Keep it dependency-free.
 *
 * omm uses this diagram type for the `deployment` perspective: groups are the places
 * software runs (cloud accounts, networks, hosts, containers), services are what runs
 * there, and edges are the runtime connections between them.
 *
 * Grammar (Mermaid v11):
 *   group id(icon)[Title] in parent
 *   service id(icon)[Title] in parent        (or service id "text"[Title])
 *   junction id in parent
 *   a:R --> L:b      a{group}:B -[HTTPS]-> T:b      a:R <-[SQL]-- … (sides T, B, L, R)
 *   align row|column id id …
 *   title …, accTitle: …, accDescr: … / accDescr { … }
 */

import { contentLines } from './diagram.js';

export { detectDiagramType, type DiagramType } from './diagram.js';

export type ArchSide = 'L' | 'R' | 'T' | 'B';

export interface ArchGroup {
  id: string;
  icon?: string;
  title: string;
  parent?: string;
  line: number;
}

export interface ArchService {
  id: string;
  /** Icon name, e.g. `server`, `database`, `logos:aws-lambda` */
  icon?: string;
  /** Text shown instead of an icon (`service a "λ"[Title]`) */
  iconText?: string;
  title: string;
  /** omm's second label line (after `\n` or `<br>`), usually a path */
  detail?: string;
  parent?: string;
  line: number;
}

export interface ArchJunction {
  id: string;
  parent?: string;
  line: number;
}

export interface ArchEdge {
  from: string;
  to: string;
  fromSide: ArchSide;
  toSide: ArchSide;
  /** `{group}`: the edge starts or ends at the border of the service's group */
  fromGroup: boolean;
  toGroup: boolean;
  /** Arrowhead at `to` (`-->`) */
  head: boolean;
  /** Arrowhead at `from` (`<--`) */
  tail: boolean;
  title: string;
  line: number;
}

export interface ArchAlign {
  axis: 'row' | 'column';
  ids: string[];
  line: number;
}

export interface ArchParseError {
  line: number;
  message: string;
}

export interface ArchitectureDiagram {
  title?: string;
  groups: Map<string, ArchGroup>;
  services: Map<string, ArchService>;
  junctions: Map<string, ArchJunction>;
  edges: ArchEdge[];
  aligns: ArchAlign[];
  errors: ArchParseError[];
}

const ID = String.raw`[A-Za-z0-9_](?:[\w-]*\w)?`;
const TITLE = String.raw`\[\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^[\]]+?)\s*\]`;
const ICON = String.raw`\(\s*([\w:-]+)\s*\)`;
const IN = String.raw`(?:\s+in\s+(${ID}))?`;

const HEADER = /^architecture-beta\s*$/;
const GROUP = new RegExp(String.raw`^group\s+(${ID})\s*(?:${ICON})?\s*(?:${TITLE})?${IN}\s*$`);
const SERVICE = new RegExp(String.raw`^service\s+(${ID})\s*(?:${ICON}|"([^"]*)")?\s*(?:${TITLE})?${IN}\s*$`);
const JUNCTION = new RegExp(String.raw`^junction\s+(${ID})${IN}\s*$`);
const EDGE = new RegExp(
  String.raw`^(${ID})(\{group\})?\s*:\s*([LRTB])\s*(<)?\s*(?:--|-\s*${TITLE}\s*-)\s*(>)?\s*([LRTB])\s*:\s*(${ID})(\{group\})?\s*$`,
);
const ALIGN = new RegExp(String.raw`^align\s+(row|column)((?:\s+${ID}){2,})\s*$`);

function stripQuotes(s: string): { text: string; quoted: boolean } {
  const t = s.trim();
  const quoted = t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")));
  return { text: quoted ? t.slice(1, -1) : t, quoted };
}

function unquote(s: string): string {
  const { text, quoted } = stripQuotes(s);
  return quoted ? text.replace(/\\(.)/g, '$1') : text;
}

/** Split omm's `Name\npath` (or `Name<br>path`) into the title and its detail line */
function splitTitle(raw: string): { title: string; detail?: string } {
  const { text, quoted } = stripQuotes(raw);
  const parts = text.split(/\\n|<br\s*\/?>/i)
    .map(p => (quoted ? p.replace(/\\(.)/g, '$1') : p).trim())
    .filter(Boolean);
  return parts.length > 1 ? { title: parts[0], detail: parts.slice(1).join(' ') } : { title: parts[0] ?? '' };
}

/** Parse an architecture-beta diagram. Lines that cannot be read are reported in `errors`. */
export function parseArchitectureDiagram(text: string): ArchitectureDiagram {
  const arch: ArchitectureDiagram = {
    groups: new Map(), services: new Map(), junctions: new Map(), edges: [], aligns: [], errors: [],
  };
  const lines = contentLines(text);
  let start = 0;
  if (lines[0] && HEADER.test(lines[0].text)) start = 1;
  else arch.errors.push({ line: lines[0]?.line ?? 1, message: 'Architecture diagram must start with "architecture-beta"' });

  const declared = (id: string) => arch.groups.has(id) || arch.services.has(id) || arch.junctions.has(id);
  const err = (line: number, message: string) => arch.errors.push({ line, message });
  const checkParent = (parent: string | undefined, line: number) => {
    if (parent && !arch.groups.has(parent)) err(line, `Group ${parent} is not declared before it is used ("group ${parent}(cloud)[…]")`);
  };
  const checkNew = (id: string, line: number) => {
    if (declared(id)) { err(line, `${id} is declared twice`); return false; }
    return true;
  };

  let inAccDescr = false;
  for (let i = start; i < lines.length; i++) {
    const { line, text: t } = lines[i];
    if (inAccDescr) { if (t.includes('}')) inAccDescr = false; continue; }
    if (/^accDescr\s*\{/.test(t)) { inAccDescr = !t.includes('}'); continue; }
    if (/^(accTitle|accDescr)\s*:/.test(t)) continue;
    const title = t.match(/^title\s+(.+)$/);
    if (title) { arch.title = title[1].trim(); continue; }

    let m = t.match(GROUP);
    if (m) {
      const [, id, icon, rawTitle, parent] = m;
      checkParent(parent, line);
      if (checkNew(id, line)) arch.groups.set(id, { id, icon, title: rawTitle ? splitTitle(rawTitle).title : id, parent, line });
      continue;
    }
    m = t.match(SERVICE);
    if (m) {
      const [, id, icon, iconText, rawTitle, parent] = m;
      checkParent(parent, line);
      const label = rawTitle ? splitTitle(rawTitle) : { title: id };
      if (checkNew(id, line)) arch.services.set(id, { id, icon, iconText, ...label, parent, line });
      continue;
    }
    m = t.match(JUNCTION);
    if (m) {
      const [, id, parent] = m;
      checkParent(parent, line);
      if (checkNew(id, line)) arch.junctions.set(id, { id, parent, line });
      continue;
    }
    m = t.match(EDGE);
    if (m) {
      const [, from, fromGroup, fromSide, tail, rawTitle, head, toSide, to, toGroup] = m;
      let ok = true;
      for (const [id, grp] of [[from, fromGroup], [to, toGroup]] as const) {
        if (arch.groups.has(id)) { err(line, `Edges connect services or junctions, not groups: ${id}. Use a service inside it with {group}`); ok = false; }
        else if (!arch.services.has(id) && !arch.junctions.has(id)) { err(line, `${id} is not declared before this edge`); ok = false; }
        else if (grp && !arch.services.get(id)?.parent) { err(line, `${id}{group} needs ${id} to be inside a group`); ok = false; }
      }
      if (ok) {
        arch.edges.push({
          from, to, fromSide: fromSide as ArchSide, toSide: toSide as ArchSide,
          fromGroup: !!fromGroup, toGroup: !!toGroup, head: !!head, tail: !!tail,
          title: rawTitle ? unquote(rawTitle) : '', line,
        });
      }
      continue;
    }
    m = t.match(ALIGN);
    if (m) {
      const ids = m[2].trim().split(/\s+/);
      const missing = ids.filter(id => !arch.services.has(id) && !arch.junctions.has(id));
      if (missing.length) err(line, `align: ${missing.join(', ')} not declared before this line`);
      else arch.aligns.push({ axis: m[1] as 'row' | 'column', ids, line });
      continue;
    }
    err(line, /^(group|service|junction)\b/.test(t)
      ? `Could not read declaration (expected: ${t.split(/\s/)[0]} id(icon)[Title] in parent): ${t}`
      : /--|-\[|:\s*[LRTB]\b/.test(t)
        ? `Could not read edge (expected: a:R --> L:b or a:R -[label]-> L:b): ${t}`
        : `Unrecognized statement: ${t}`);
  }
  return arch;
}

/** Nesting depth of a group (0 for a top-level group) */
export function archGroupDepth(arch: ArchitectureDiagram, id: string): number {
  let depth = 0;
  for (let g = arch.groups.get(id)?.parent; g; g = arch.groups.get(g)?.parent) depth++;
  return depth;
}
