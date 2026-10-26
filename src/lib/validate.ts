import { parseMermaid } from './diff.js';
import { extractRefs } from './refs.js';
import { detectDiagramType, parseErDiagram } from './er.js';
import type { ValidationIssue, ValidationResult } from '../types.js';

// --- Source-of-truth constants ---

export const VALID_CLASSDEF_NAMES = ['external', 'concern', 'entry', 'store'] as const;

export const CLASSDEF_PALETTE: Record<string, Record<string, string>> = {
  external: { fill: '#585b70', stroke: '#585b70', color: '#cdd6f4' },
  concern:  { fill: '#f38ba8', stroke: '#f38ba8', color: '#1e1e2e' },
  entry:    { fill: '#89b4fa', stroke: '#89b4fa', color: '#1e1e2e' },
  store:    { fill: '#a6e3a1', stroke: '#a6e3a1', color: '#1e1e2e' },
};

// --- Helpers ---

const GRAPH_DECL = /^(graph|flowchart)\s+(LR|RL|TD|TB|BT)\s*$/i;
const DIRECTIVE_LINE = /^(graph|flowchart|classDef|class |click |style |linkStyle|subgraph|end$|%%)/i;

// Edges we check for labels in v1: -->, ==>, -.->
const EDGE_LINE = /(-->|==>|-.->)/;
const EDGE_HAS_LABEL = /\|.*?\|/;

const CLASSDEF_LINE = /^classDef\s+(\S+)\s+(.+)$/i;
const CLASSDEF_ATTR = /(\w+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;

/**
 * Quote-aware bracket balance check on a single line.
 * Ignores characters inside double-quoted strings.
 */
function checkBracketBalance(line: string): boolean {
  const counts: Record<string, number> = { '[': 0, ']': 0, '(': 0, ')': 0, '{': 0, '}': 0 };
  let inQuote = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch in counts) counts[ch]++;
  }

  return counts['['] === counts[']'] &&
         counts['('] === counts[')'] &&
         counts['{'] === counts['}'];
}

function formatAvailable(elements: string[], max = 10): string {
  const shown = elements.slice(0, max).join(', ');
  return elements.length > max ? `${shown}, … (${elements.length - max} more, see 'omm tree')` : shown;
}

// --- Flowchart rules ---

function checkFlowchart(text: string, issues: ValidationIssue[]): void {
  const lines = text.split('\n');
  const contentLines = lines.map(l => l.trim()).filter(l => l && !l.startsWith('%%'));

  // Rule: graph-declaration
  if (contentLines.length === 0 || !GRAPH_DECL.test(contentLines[0])) {
    issues.push({
      level: 'error',
      rule: 'graph-declaration',
      message: 'Diagram must start with a graph/flowchart direction declaration (e.g., "graph LR") or with "erDiagram"',
      line: 1,
    });
  }

  // Line-based checks
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    // Rule: balanced-brackets (quote-aware)
    if (!checkBracketBalance(trimmed)) {
      issues.push({
        level: 'error',
        rule: 'balanced-brackets',
        message: `Unbalanced brackets on line: ${trimmed}`,
        line: i + 1,
      });
    }

    // Rule: edge-label (v1: -->, ==>, -.->)
    if (EDGE_LINE.test(trimmed) && !DIRECTIVE_LINE.test(trimmed)) {
      if (!EDGE_HAS_LABEL.test(trimmed)) {
        issues.push({
          level: 'warning',
          rule: 'edge-label',
          message: `Edge without label: ${trimmed}`,
          line: i + 1,
        });
      }
    }

    // Rule: classdef-name and classdef-color
    const classDefMatch = trimmed.match(CLASSDEF_LINE);
    if (classDefMatch) {
      const name = classDefMatch[1];
      const attrStr = classDefMatch[2];

      if (!(VALID_CLASSDEF_NAMES as readonly string[]).includes(name)) {
        issues.push({
          level: 'warning',
          rule: 'classdef-name',
          message: `Unknown classDef name "${name}". Valid: ${VALID_CLASSDEF_NAMES.join(', ')}`,
          line: i + 1,
        });
      } else {
        // Check declared attributes only — order/whitespace agnostic
        const expected = CLASSDEF_PALETTE[name];
        let match: RegExpExecArray | null;
        const attrPattern = new RegExp(CLASSDEF_ATTR.source, 'g');
        while ((match = attrPattern.exec(attrStr)) !== null) {
          const [, attr, value] = match;
          if (attr in expected && value.toLowerCase() !== expected[attr].toLowerCase()) {
            issues.push({
              level: 'warning',
              rule: 'classdef-color',
              message: `classDef "${name}" has ${attr}:${value}, expected ${attr}:${expected[attr]}`,
              line: i + 1,
            });
          }
        }
      }
    }
  }
}

// --- ER diagram rules ---

function checkErDiagram(text: string, issues: ValidationIssue[]): void {
  const er = parseErDiagram(text);

  // Rule: er-syntax — anything the parser could not read
  for (const error of er.errors) {
    issues.push({ level: 'error', rule: 'er-syntax', message: error.message, line: error.line });
  }

  // Rule: er-orphan-entity — an entity with no relationships is usually a mistake in a multi-entity diagram
  if (er.entities.size > 1) {
    const related = new Set(er.relationships.flatMap(r => [r.from, r.to]));
    for (const name of er.entities.keys()) {
      if (!related.has(name)) {
        issues.push({ level: 'warning', rule: 'er-orphan-entity', message: `Entity ${name} has no relationships` });
      }
    }
  }
}

// --- Main validation function ---

export interface ValidateContext {
  className: string;
  allClasses: string[];
}

export function validateDiagram(text: string, context?: ValidateContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const type = detectDiagramType(text);

  if (type === 'er') {
    checkErDiagram(text, issues);
  } else {
    checkFlowchart(text, issues);
  }

  // Rule: ref-exists, ref-self and ref-ancestor (only when context provided).
  // allClasses holds every element path, so @persp/child refs resolve too.
  if (context) {
    const refs = extractRefs(text);
    for (const ref of refs) {
      if (ref === context.className) {
        issues.push({
          level: 'error',
          rule: 'ref-self',
          message: `Diagram references its own element: @${ref}`,
        });
      } else if (context.className.startsWith(`${ref}/`)) {
        issues.push({
          level: 'warning',
          rule: 'ref-ancestor',
          message: `Diagram references its own ancestor @${ref}. A child element should not reference its parent.`,
        });
      } else if (!context.allClasses.includes(ref)) {
        issues.push({
          level: 'error',
          rule: 'ref-exists',
          message: `@${ref} does not exist. Available: ${formatAvailable(context.allClasses)}`,
        });
      }
    }
  }

  // Rule: node-count (uses parseMermaid for counting only; entities for ER diagrams)
  const parsed = parseMermaid(text);
  const nodeCount = parsed.nodes.size;
  const unit = type === 'er' ? 'entities' : 'nodes';
  if (nodeCount > 0 && nodeCount < 3 && type !== 'er') {
    issues.push({
      level: 'warning',
      rule: 'node-count',
      message: `${nodeCount} ${unit} (recommended: 5-15). Diagram may be too simple.`,
    });
  } else if (nodeCount > 15) {
    issues.push({
      level: 'warning',
      rule: 'node-count',
      message: `${nodeCount} ${unit} (recommended: 5-15). Consider splitting into sub-diagrams.`,
    });
  }

  return {
    valid: issues.filter(i => i.level === 'error').length === 0,
    issues,
  };
}
