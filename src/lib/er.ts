/**
 * Mermaid erDiagram parser — shared by the CLI (validate, diff) and the viewer
 * (bundled as dist/omm-viewer.js). Keep it dependency-free.
 */

import { contentLines } from './diagram.js';

export { detectDiagramType, type DiagramType } from './diagram.js';

export interface ErAttribute {
  type: string;
  name: string;
  keys: string[];
  comment?: string;
}

export interface ErEntity {
  name: string;
  /** Display name from `name["Alias"]`, if any */
  alias?: string;
  attributes: ErAttribute[];
}

export interface ErRelationship {
  from: string;
  to: string;
  /** Cardinality marker on the `from` side: ||, |o, }|, }o */
  fromCard: string;
  /** Cardinality marker on the `to` side: ||, o|, |{, o{ */
  toCard: string;
  /** `--` (identifying) vs `..` (non-identifying) */
  identifying: boolean;
  label: string;
}

export interface ErParseError {
  line: number;
  message: string;
}

export interface ErDiagram {
  direction: 'TB' | 'BT' | 'LR' | 'RL';
  entities: Map<string, ErEntity>;
  relationships: ErRelationship[];
  errors: ErParseError[];
}

const ENTITY_NAME = String.raw`(?:"[^"]+"|[A-Za-z_][\w-]*)`;
const ALIAS = String.raw`(?:\[\s*(?:"([^"]*)"|([^\]]*))\s*\])?`;
const RELATIONSHIP = new RegExp(
  String.raw`^(${ENTITY_NAME})\s*(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s*(${ENTITY_NAME})\s*:\s*(.+)$`,
);
const ENTITY_OPEN = new RegExp(String.raw`^(${ENTITY_NAME})${ALIAS}\s*\{\s*(\}?)$`);
const ENTITY_ALONE = new RegExp(String.raw`^(${ENTITY_NAME})${ALIAS}$`);
// type name [PK|FK|UK[, ...]] ["comment"]
const ATTRIBUTE = /^([A-Za-z_*][\w()[\],.*-]*)\s+(\*?[A-Za-z_][\w-]*)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/;
const DIRECTION = /^direction\s+(TB|BT|LR|RL)$/i;

const CARDINALITY_TEXT: Record<string, string> = {
  '||': '1',
  '|o': '0..1', 'o|': '0..1',
  '}|': '1..*', '|{': '1..*',
  '}o': '0..*', 'o{': '0..*',
};

/** Human-readable cardinality ("1", "0..1", "1..*", "0..*") for a relationship marker */
export function cardinalityText(marker: string): string {
  return CARDINALITY_TEXT[marker] ?? marker;
}

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function parseErDiagram(text: string): ErDiagram {
  const entities = new Map<string, ErEntity>();
  const relationships: ErRelationship[] = [];
  const errors: ErParseError[] = [];
  let direction: ErDiagram['direction'] = 'TB';

  const ensureEntity = (rawName: string, alias?: string): ErEntity => {
    const name = unquote(rawName);
    let entity = entities.get(name);
    if (!entity) {
      entity = { name, attributes: [] };
      entities.set(name, entity);
    }
    if (alias !== undefined && alias !== '') entity.alias = alias;
    return entity;
  };

  const lines = contentLines(text);
  let open: { entity: ErEntity; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const { line, text: t } = lines[i];
    if (i === 0) {
      if (!/^erDiagram(\s|$)/.test(t)) errors.push({ line, message: 'ER diagram must start with "erDiagram"' });
      continue;
    }

    if (open) {
      if (t === '}') { open = null; continue; }
      const attr = t.match(ATTRIBUTE);
      if (attr) {
        open.entity.attributes.push({
          type: attr[1],
          name: attr[2].replace(/^\*/, ''),
          keys: attr[3] ? attr[3].split(',').map(k => k.trim()) : (attr[2].startsWith('*') ? ['PK'] : []),
          ...(attr[4] !== undefined ? { comment: attr[4] } : {}),
        });
      } else {
        errors.push({ line, message: `Invalid attribute in ${open.entity.name}: "${t}" (expected: type name [PK|FK|UK] ["comment"])` });
      }
      continue;
    }

    const dir = t.match(DIRECTION);
    if (dir) { direction = dir[1].toUpperCase() as ErDiagram['direction']; continue; }
    if (/^(title|accTitle|accDescr|classDef|class|style)\b/.test(t)) continue;

    const rel = t.match(RELATIONSHIP);
    if (rel) {
      const from = ensureEntity(rel[1]).name;
      const to = ensureEntity(rel[5]).name;
      relationships.push({
        from, to,
        fromCard: rel[2],
        toCard: rel[4],
        identifying: rel[3] === '--',
        label: unquote(rel[6].trim()),
      });
      continue;
    }

    const block = t.match(ENTITY_OPEN);
    if (block) {
      const entity = ensureEntity(block[1], block[2] ?? block[3]?.trim());
      if (!block[4]) open = { entity, line };
      continue;
    }

    const alone = t.match(ENTITY_ALONE);
    if (alone) {
      ensureEntity(alone[1], alone[2] ?? alone[3]?.trim());
      continue;
    }

    errors.push({
      line,
      message: /--|\.\./.test(t)
        ? `Invalid relationship: "${t}" (expected: A ||--o{ B : label)`
        : `Unrecognized statement: "${t}"`,
    });
  }

  if (open) errors.push({ line: open.line, message: `Entity ${open.entity.name} is missing its closing "}"` });

  return { direction, entities, relationships, errors };
}
