/**
 * Mermaid classDiagram parser — shared by the CLI (validate, diff) and the viewer
 * (bundled as dist/omm-viewer.js). Keep it dependency-free.
 *
 * Reads:
 *   class Name, class Name~T~, class Name["Label"], class Name:::style, class Name { members }
 *   Name : +member            <<interface>> Name            (or <<interface>> inside a body)
 *   A <|-- B, A *-- B, A o-- B, A --> B, A ..> B, A ..|> B, A -- B, A .. B, A ()-- B, two-way forms
 *   A "1" --> "*" B : label
 *   namespace N { class … }   note "text"   note for A "text"   direction LR
 * Styling and interaction lines (classDef, cssClass, style, click, link, callback) are ignored.
 */

import { contentLines } from './diagram.js';

export { detectDiagramType, type DiagramType } from './diagram.js';

export type ClassVisibility = '+' | '-' | '#' | '~';

export interface ClassMember {
  /** As written, without the `$`/`*` classifier; `~T~` generics shown as `<T>` */
  text: string;
  /** Attribute or method name, used to identify the member in diffs */
  name: string;
  kind: 'attribute' | 'method';
  visibility?: ClassVisibility;
  static: boolean;
  abstract: boolean;
}

export interface ClassNode {
  id: string;
  /** Display name from `class A["Label"]` */
  label?: string;
  /** Generic parameters from `A~T~`, shown as `A<T>` */
  generic?: string;
  annotations: string[];
  attributes: ClassMember[];
  methods: ClassMember[];
  namespace?: string;
  cls?: string;
  line: number;
}

/** What is drawn at one end of a relationship */
export type ClassEnd = 'inheritance' | 'composition' | 'aggregation' | 'arrow' | 'lollipop' | 'none';

export interface ClassRelation {
  from: string;
  to: string;
  fromEnd: ClassEnd;
  toEnd: ClassEnd;
  /** `--` solid, `..` dashed */
  dashed: boolean;
  fromCard?: string;
  toCard?: string;
  label: string;
  /** The relationship as written, normalized (`<|--`, `..>`, `*--` …) */
  arrow: string;
  line: number;
}

export interface ClassNote {
  text: string;
  /** Class the note is attached to (`note for A "…"`) */
  for?: string;
  line: number;
}

export interface ClassParseError {
  line: number;
  message: string;
}

export interface ClassDiagram {
  direction: 'TB' | 'BT' | 'LR' | 'RL';
  classes: Map<string, ClassNode>;
  relations: ClassRelation[];
  namespaces: Map<string, { id: string; classes: string[]; line: number }>;
  notes: ClassNote[];
  errors: ClassParseError[];
}

// Class names: letters, digits, underscores and single dashes (so `--` stays an arrow),
// optionally with generics `~T~`; or a backtick-quoted name
const NAME = String.raw`(?:\`[^\`]+\`|[A-Za-z_](?:\w|-(?!-))*(?:~[^~\s]+~)?)`;
const END_LEFT = String.raw`(<\||\*|(?<=\s)o|<|\(\))`;
const END_RIGHT = String.raw`(\|>|\*|o(?=\s)|>|\(\))`;
const RELATION = new RegExp(
  String.raw`^(${NAME})\s*(?:"([^"]*)"\s*)?${END_LEFT}?(--|\.\.)${END_RIGHT}?\s*(?:"([^"]*)"\s*)?(${NAME})\s*(?::\s*(.*))?$`,
);
const CLASS_DECL = new RegExp(String.raw`^class\s+(${NAME})\s*(?:\[\s*"?([^"\]]*)"?\s*\])?\s*(?::::([\w-]+))?\s*(\{\s*(\})?)?\s*$`);
const MEMBER_LINE = new RegExp(String.raw`^(${NAME})\s*:\s*(.+)$`);
const ANNOTATION = new RegExp(String.raw`^<<\s*([^>]+?)\s*>>\s*(${NAME})?\s*$`);
const NAMESPACE = /^namespace\s+([\w.-]+)\s*\{\s*$/;
const NOTE = new RegExp(String.raw`^note\s+(?:for\s+(${NAME})\s+)?"([^"]*)"\s*$`);
const DIRECTION = /^direction\s+(TB|TD|BT|LR|RL)$/i;
const SKIP = /^(classDef|cssClass|style|click|link|callback|accTitle|accDescr|title)\b/;

const END_OF: Record<string, ClassEnd> = { '<|': 'inheritance', '|>': 'inheritance', '*': 'composition', o: 'aggregation', '<': 'arrow', '>': 'arrow', '()': 'lollipop' };

/** `Name~T~` → { id: 'Name', generic: 'T' }; backticks removed */
function splitName(raw: string): { id: string; generic?: string } {
  const name = raw.replace(/^`|`$/g, '');
  const m = name.match(/^([^~]+)~(.+)~$/);
  return m ? { id: m[1], generic: m[2] } : { id: name };
}

const showGenerics = (s: string) => s.replace(/~([^~]+)~/g, '<$1>');

/** Parse one member line (`+String name`, `-int id$`, `+eat(food) bool`, `+area()* double`) */
export function parseClassMember(raw: string): ClassMember {
  let t = raw.trim();
  const visibility = /^[+\-#~]/.test(t) && !/^~[^~]*~/.test(t) ? (t[0] as ClassVisibility) : undefined;
  const body = visibility ? t.slice(1).trim() : t;
  const paren = body.indexOf('(');
  if (paren >= 0 && body.indexOf(')', paren) > paren) {
    const close = body.lastIndexOf(')');
    const after = body.slice(close + 1);
    const classifier = after.match(/[$*]/)?.[0];
    const returnType = after.replace(/[$*]/g, '').trim();
    t = (visibility ?? '') + body.slice(0, close + 1) + (returnType ? ` ${returnType}` : '');
    return { text: showGenerics(t), name: `${body.slice(0, paren).trim()}()`, kind: 'method', visibility, static: classifier === '$', abstract: classifier === '*' };
  }
  const classifier = body.match(/([$*])\s*$/)?.[1];
  const clean = body.replace(/[$*]\s*$/, '').trim();
  // `String name`, `name : String` or just `name`
  const colon = clean.match(/^([\w]+)\s*:\s*(.+)$/);
  const name = colon ? colon[1] : clean.split(/\s+/).pop() ?? clean;
  return { text: showGenerics((visibility ?? '') + clean), name, kind: 'attribute', visibility, static: classifier === '$', abstract: classifier === '*' };
}

/** Parse a class diagram. Lines that cannot be read are reported in `errors`. */
export function parseClassDiagram(text: string): ClassDiagram {
  const cd: ClassDiagram = { direction: 'TB', classes: new Map(), relations: [], namespaces: new Map(), notes: [], errors: [] };
  const lines = contentLines(text);
  let start = 0;
  if (lines[0] && /^classDiagram(-v2)?\s*$/.test(lines[0].text)) start = 1;
  else cd.errors.push({ line: lines[0]?.line ?? 1, message: 'Class diagram must start with "classDiagram"' });

  let namespace: string | undefined;
  let body: ClassNode | null = null; // class whose { … } body is open
  let bodyLine = 0;

  const touch = (raw: string, line: number): ClassNode => {
    const { id, generic } = splitName(raw);
    let c = cd.classes.get(id);
    if (!c) {
      c = { id, annotations: [], attributes: [], methods: [], line };
      cd.classes.set(id, c);
      if (namespace) { c.namespace = namespace; cd.namespaces.get(namespace)!.classes.push(id); }
    }
    if (generic) c.generic = generic;
    return c;
  };
  const addMember = (c: ClassNode, raw: string) => {
    const m = parseClassMember(raw);
    (m.kind === 'method' ? c.methods : c.attributes).push(m);
  };

  for (let i = start; i < lines.length; i++) {
    const { line, text: t } = lines[i];

    if (body) {
      if (t === '}') { body = null; continue; }
      const ann = t.match(/^<<\s*([^>]+?)\s*>>$/);
      if (ann) body.annotations.push(ann[1]);
      else addMember(body, t);
      continue;
    }
    if (t === '}') {
      if (namespace) namespace = undefined;
      else cd.errors.push({ line, message: '"}" without an open class or namespace' });
      continue;
    }
    if (SKIP.test(t)) continue;

    const dir = t.match(DIRECTION);
    if (dir) { const d = dir[1].toUpperCase(); cd.direction = (d === 'TD' ? 'TB' : d) as ClassDiagram['direction']; continue; }

    const ns = t.match(NAMESPACE);
    if (ns) {
      if (namespace) cd.errors.push({ line, message: 'Namespaces cannot be nested' });
      namespace = ns[1];
      if (!cd.namespaces.has(namespace)) cd.namespaces.set(namespace, { id: namespace, classes: [], line });
      continue;
    }

    const decl = t.match(CLASS_DECL);
    if (decl) {
      const c = touch(decl[1], line);
      if (decl[2]) c.label = decl[2].trim();
      if (decl[3]) c.cls = decl[3];
      if (decl[4] && !decl[5]) { body = c; bodyLine = line; }
      continue;
    }

    const ann = t.match(ANNOTATION);
    if (ann) {
      if (ann[2]) touch(ann[2], line).annotations.push(ann[1]);
      else cd.errors.push({ line, message: `Annotation ${t} needs a class (<<interface>> Name) or must be inside a class body` });
      continue;
    }

    const note = t.match(NOTE);
    if (note) {
      const n: ClassNote = { text: note[2].replace(/\\n|<br\s*\/?>/gi, '\n'), line };
      if (note[1]) n.for = splitName(note[1]).id;
      cd.notes.push(n);
      continue;
    }

    const rel = t.match(RELATION);
    if (rel) {
      const [, a, fromCard, left, lineStyle, right, toCard, b, label] = rel;
      const from = touch(a, line).id, to = touch(b, line).id;
      const r: ClassRelation = {
        from, to,
        fromEnd: left ? END_OF[left] : 'none', toEnd: right ? END_OF[right] : 'none',
        dashed: lineStyle === '..', label: (label ?? '').trim(),
        arrow: `${left ?? ''}${lineStyle}${right ?? ''}`, line,
      };
      if (fromCard !== undefined) r.fromCard = fromCard;
      if (toCard !== undefined) r.toCard = toCard;
      cd.relations.push(r);
      continue;
    }

    const member = t.match(MEMBER_LINE);
    if (member) { addMember(touch(member[1], line), member[2]); continue; }

    cd.errors.push({
      line,
      message: /^class\b/.test(t)
        ? `Could not read class declaration (expected: class Name or class Name { … }): ${t}`
        : /--|\.\./.test(t)
          ? `Could not read relationship (expected e.g. A <|-- B, A "1" --> "*" B : label): ${t}`
          : `Unrecognized statement: ${t}`,
    });
  }

  if (body) cd.errors.push({ line: bodyLine, message: `Class ${body.id} is missing its closing "}"` });
  if (namespace) cd.errors.push({ line: cd.namespaces.get(namespace)!.line, message: `Namespace ${namespace} is missing its closing "}"` });
  for (const n of cd.notes) {
    if (n.for && !cd.classes.has(n.for)) cd.errors.push({ line: n.line, message: `Note for unknown class ${n.for}` });
  }
  return cd;
}

/** Short description of a relationship kind, for messages and tooltips */
export function classRelationKind(r: Pick<ClassRelation, 'fromEnd' | 'toEnd' | 'dashed'>): string {
  const ends = [r.fromEnd, r.toEnd];
  if (ends.includes('inheritance')) return r.dashed ? 'realization' : 'inheritance';
  if (ends.includes('composition')) return 'composition';
  if (ends.includes('aggregation')) return 'aggregation';
  if (ends.includes('lollipop')) return 'interface';
  if (ends.includes('arrow')) return r.dashed ? 'dependency' : 'association';
  return r.dashed ? 'link (dashed)' : 'link';
}
