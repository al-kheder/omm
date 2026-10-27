import { parseMermaid } from './diff.js';
import { extractRefs } from './refs.js';
import { contentLines, detectDiagramType } from './diagram.js';
import { parseErDiagram } from './er.js';
import { parseSequenceDiagram } from './sequence.js';
import { parseStateDiagram, stateDisplayId } from './state.js';
import { parseFlowchart, type FlowShape } from './flowchart.js';
import { findSecrets } from './secrets.js';
import { parseArchitectureDiagram } from './architecture.js';
import type { ValidationIssue, ValidationResult } from '../types.js';

// --- Source-of-truth constants ---

export const VALID_CLASSDEF_NAMES = ['external', 'concern', 'entry', 'store', 'error', 'success'] as const;

export const CLASSDEF_PALETTE: Record<string, Record<string, string>> = {
  external: { fill: '#585b70', stroke: '#585b70', color: '#cdd6f4' },
  concern:  { fill: '#f38ba8', stroke: '#f38ba8', color: '#1e1e2e' },
  entry:    { fill: '#89b4fa', stroke: '#89b4fa', color: '#1e1e2e' },
  store:    { fill: '#a6e3a1', stroke: '#a6e3a1', color: '#1e1e2e' },
  // process flowcharts: failed / successful outcomes (same as the viewer's light color mode)
  error:    { fill: '#fde8e8', stroke: '#c0392b', color: '#7a1d1d' },
  success:  { fill: '#e3f5e8', stroke: '#23804a', color: '#14532d' },
};

// --- Helpers ---

const GRAPH_DECL = /^(graph|flowchart)(\s+(LR|RL|TD|TB|BT))?\s*;?\s*$/i;

// Start/end shapes: a flowchart with one of these is a process flowchart
const TERMINATOR_SHAPES = new Set<FlowShape>(['stadium', 'small-circle', 'double-circle']);
// Shapes whose edges never need a label
const UNLABELLED_SHAPES = new Set<FlowShape>([...TERMINATOR_SHAPES, 'circle']);

const CLASSDEF_LINE = /^classDef\s+(\S+)\s+(.+)$/i;
const CLASSDEF_ATTR = /(\w+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;

/**
 * Quote-aware bracket balance check on a single line.
 * Ignores characters inside double-quoted strings.
 */
function checkBracketBalance(line: string): boolean {
  const counts: Record<string, number> = { '[': 0, ']': 0, '(': 0, ')': 0, '{': 0, '}': 0 };
  let inQuote = false;

  // The flag shape `id>text]` has no opening bracket
  for (const ch of line.replace(/([A-Za-z0-9_])>[^\]"]*\]/g, '$1')) {
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

function checkFlowchart(text: string, type: string, issues: ValidationIssue[]): void {
  const lines = text.split('\n');
  const first = contentLines(text)[0]?.text;

  // Rule: graph-declaration
  if (!first || !GRAPH_DECL.test(first)) {
    issues.push({
      level: 'error',
      rule: 'graph-declaration',
      message: 'Diagram must start with a graph/flowchart declaration (e.g., "graph LR" or "flowchart TD"), "erDiagram", "sequenceDiagram" or "stateDiagram-v2"',
      line: 1,
    });
  }

  // Line-based checks
  const bracketLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    // Rule: balanced-brackets (quote-aware)
    if (!checkBracketBalance(trimmed)) {
      bracketLines.add(i + 1);
      issues.push({
        level: 'error',
        rule: 'balanced-brackets',
        message: `Unbalanced brackets on line: ${trimmed}`,
        line: i + 1,
      });
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

  const fc = parseFlowchart(text);

  // Rule: flowchart-syntax — statements the parser could not read (unbalanced lines are already reported)
  if (type === 'flowchart') {
    for (const error of fc.errors) {
      if (!bracketLines.has(error.line)) {
        issues.push({ level: 'error', rule: 'flowchart-syntax', message: error.message, line: error.line });
      }
    }
  }

  const shapeOf = (id: string) => fc.nodes.get(id)?.shape ?? 'rect';
  const edgeText = (e: { from: string; to: string; arrow: string }) => `${e.from} ${e.arrow} ${e.to}`;

  if ([...fc.nodes.values()].some(n => TERMINATOR_SHAPES.has(n.shape))) {
    // Process flowchart (it has a start or end): only the answers leaving a decision need labels
    for (const e of fc.edges) {
      if (shapeOf(e.from) === 'diamond' && !e.label && e.style !== 'invisible') {
        issues.push({ level: 'warning', rule: 'edge-label', message: `Decision branch without label (e.g. Yes / No): ${edgeText(e)}`, line: e.line });
      }
    }

    // Rule: decision-branches — a decision with fewer than two ways out is not a decision
    for (const n of fc.nodes.values()) {
      if (n.shape !== 'diamond') continue;
      const out = fc.edges.filter(e => e.from === n.id && e.style !== 'invisible').length;
      if (out < 2) {
        issues.push({
          level: 'warning',
          rule: 'decision-branches',
          message: `Decision ${n.id} has ${out} outgoing branch${out === 1 ? '' : 'es'} (expected at least 2)`,
          line: n.line,
        });
      }
    }
  } else {
    // Rule: edge-label — architecture diagrams name what flows along every arrow (connectors excepted)
    for (const e of fc.edges) {
      if (e.label || e.head !== 'arrow' || e.style === 'invisible') continue;
      if (UNLABELLED_SHAPES.has(shapeOf(e.from)) || UNLABELLED_SHAPES.has(shapeOf(e.to))) continue;
      issues.push({ level: 'warning', rule: 'edge-label', message: `Edge without label: ${edgeText(e)}`, line: e.line });
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

// --- Sequence diagram rules ---

const MAX_MESSAGES = 30;

function checkSequenceDiagram(text: string, issues: ValidationIssue[]): void {
  const seq = parseSequenceDiagram(text);

  // Rule: seq-syntax — anything the parser could not read
  for (const error of seq.errors) {
    issues.push({ level: 'error', rule: 'seq-syntax', message: error.message, line: error.line });
  }

  const messages = seq.events.filter(e => e.kind === 'message');

  // Rule: seq-unused-participant — a declared participant that never sends, receives or has a note
  if (seq.participants.size > 1) {
    const used = new Set<string>();
    for (const e of seq.events) {
      if (e.kind === 'message') { used.add(e.from); used.add(e.to); }
      else if (e.kind === 'note') e.participants.forEach(p => used.add(p));
    }
    for (const id of seq.participants.keys()) {
      if (!used.has(id)) {
        issues.push({ level: 'warning', rule: 'seq-unused-participant', message: `Participant ${id} has no messages` });
      }
    }
  }

  // Rule: seq-message-label — every message should say what is sent
  for (const m of messages) {
    if (!m.text) {
      issues.push({ level: 'warning', rule: 'seq-message-label', message: `Message without text: ${m.from} ${m.arrow} ${m.to}`, line: m.line });
    }
  }

  // Rule: message-count — long sequences are hard to read
  if (messages.length > MAX_MESSAGES) {
    issues.push({
      level: 'warning',
      rule: 'message-count',
      message: `${messages.length} messages (recommended: at most ${MAX_MESSAGES}). Consider splitting into several sequence diagrams.`,
    });
  }
}

// --- State diagram rules ---

const PSEUDO_OR_CONTROL = new Set(['start', 'end', 'choice', 'fork', 'join']);

function checkStateDiagram(text: string, issues: ValidationIssue[]): void {
  const sd = parseStateDiagram(text);

  // Rule: state-syntax — anything the parser could not read
  for (const error of sd.errors) {
    issues.push({ level: 'error', rule: 'state-syntax', message: error.message, line: error.line });
  }

  // Rule: state-orphan — a state with no transitions (a composite state also counts as
  // connected when one of its children is)
  const all = [...sd.states.values()];
  const real = all.filter(s => s.kind !== 'start' && s.kind !== 'end');
  if (real.length > 1) {
    const connected = new Set(sd.transitions.flatMap(t => [t.from, t.to]));
    for (const s of real) {
      const viaChild = s.composite && all.some(c => c.parent === s.id && connected.has(c.id));
      if (!connected.has(s.id) && !viaChild) {
        issues.push({ level: 'warning', rule: 'state-orphan', message: `State ${s.id} has no transitions` });
      }
    }
  }

  // Rule: state-transition-label — a transition between two ordinary states should name its trigger
  for (const t of sd.transitions) {
    const ends = [sd.states.get(t.from)?.kind ?? 'state', sd.states.get(t.to)?.kind ?? 'state'];
    if (!t.label && !ends.some(k => PSEUDO_OR_CONTROL.has(k))) {
      issues.push({
        level: 'warning',
        rule: 'state-transition-label',
        message: `Transition without trigger: ${stateDisplayId(t.from)} --> ${stateDisplayId(t.to)}`,
        line: t.line,
      });
    }
  }
}

function checkArchitectureDiagram(text: string, issues: ValidationIssue[]): void {
  const arch = parseArchitectureDiagram(text);

  // Rule: arch-syntax — anything the parser could not read
  for (const error of arch.errors) {
    issues.push({ level: 'error', rule: 'arch-syntax', message: error.message, line: error.line });
  }

  // Rule: arch-orphan — a service with no connection
  const connected = new Set(arch.edges.flatMap(e => [e.from, e.to]));
  if (arch.services.size > 1) {
    for (const s of arch.services.values()) {
      if (!connected.has(s.id)) issues.push({ level: 'warning', rule: 'arch-orphan', message: `Service ${s.id} has no connections`, line: s.line });
    }
  }

  // Rule: arch-edge-label — say what travels over a connection (protocol or purpose)
  for (const e of arch.edges) {
    if (!e.title && !arch.junctions.has(e.from) && !arch.junctions.has(e.to)) {
      issues.push({
        level: 'warning',
        rule: 'arch-edge-label',
        message: `Connection without label (e.g. -[HTTPS]->): ${e.from} -- ${e.to}`,
        line: e.line,
      });
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
  } else if (type === 'sequence') {
    checkSequenceDiagram(text, issues);
  } else if (type === 'state') {
    checkStateDiagram(text, issues);
  } else if (type === 'architecture') {
    checkArchitectureDiagram(text, issues);
  } else {
    checkFlowchart(text, type, issues);
  }

  // Rule: secret-value — keys, tokens and passwords never belong in .omm/
  for (const s of findSecrets(text)) {
    issues.push({ level: 'error', rule: 'secret-value', message: `Looks like a ${s.kind}. Remove it: describe where the secret is used, not its value.`, line: s.line });
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

  // Rule: node-count (uses parseMermaid for counting only; entities for ER, participants for sequence, states for state diagrams)
  const parsed = parseMermaid(text);
  const nodeCount = parsed.nodes.size;
  const unit = type === 'er' ? 'entities' : type === 'sequence' ? 'participants' : type === 'state' ? 'states' : type === 'architecture' ? 'groups, services and junctions' : 'nodes';
  if (nodeCount > 0 && nodeCount < 3 && (type === 'flowchart' || type === 'unknown')) {
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
