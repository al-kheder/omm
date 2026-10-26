import { listAllElements, readField } from './store.js';
import type { RefEntry } from '../types.js';

// @perspective or @perspective/child/... — not preceded by a word char, so emails don't count
const REF_PATTERN = /(?<![\w.])@([\w-]+(?:\/[\w-]+)*)/g;

/**
 * Extract @element references from a mermaid diagram text.
 * `@name` refers to a perspective; `@name/child` to a nested element.
 */
export function extractRefs(diagramText: string): string[] {
  const refs: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(REF_PATTERN.source, 'g');
  while ((match = pattern.exec(diagramText)) !== null) {
    if (!refs.includes(match[1])) {
      refs.push(match[1]);
    }
  }
  return refs;
}

/**
 * Get all elements that the given element references (outgoing refs).
 */
export function getOutgoingRefs(className: string, cwd?: string): RefEntry[] {
  const diagram = readField(className, 'diagram', cwd);
  if (!diagram) return [];

  const refs = extractRefs(diagram);
  return refs.map(target => ({
    source_class: className,
    target_class: target,
    node_id: `@${target}`,
  }));
}

/**
 * Get all elements, at any depth, that reference the given element (incoming refs).
 */
export function getIncomingRefs(className: string, cwd?: string): RefEntry[] {
  const incoming: RefEntry[] = [];

  for (const element of listAllElements(cwd)) {
    if (element === className) continue;
    const diagram = readField(element, 'diagram', cwd);
    if (!diagram) continue;

    const refs = extractRefs(diagram);
    if (refs.includes(className)) {
      incoming.push({
        source_class: element,
        target_class: className,
        node_id: `@${className}`,
      });
    }
  }

  return incoming;
}

/**
 * Build a full reference graph for all elements in the tree.
 */
export function buildRefGraph(cwd?: string): RefEntry[] {
  const allRefs: RefEntry[] = [];

  for (const element of listAllElements(cwd)) {
    allRefs.push(...getOutgoingRefs(element, cwd));
  }

  return allRefs;
}
