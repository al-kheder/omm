/**
 * Helpers shared by the per-type diagram parsers (er.ts, sequence.ts, state.ts, architecture.ts,
 * class-diagram.ts).
 * Bundled into the viewer too, so keep it dependency-free.
 */

export type DiagramType = 'flowchart' | 'er' | 'sequence' | 'state' | 'architecture' | 'class' | 'unknown';

export interface DiagramLine {
  /** 1-based line number in the original text */
  line: number;
  /** Trimmed line content */
  text: string;
}

/** Non-empty lines, trimmed, without YAML front matter and `%%` comments */
export function contentLines(text: string): DiagramLine[] {
  const out: DiagramLine[] = [];
  let inFrontmatter = false;
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (i === 0 && t === '---') { inFrontmatter = true; return; }
    if (inFrontmatter) { if (t === '---') inFrontmatter = false; return; }
    if (t && !t.startsWith('%%')) out.push({ line: i + 1, text: t });
  });
  return out;
}

/** Detect the Mermaid diagram type from its first statement */
export function detectDiagramType(text: string): DiagramType {
  const first = contentLines(text)[0]?.text ?? '';
  if (/^(graph|flowchart)(\s|$)/i.test(first)) return 'flowchart';
  if (/^erDiagram(\s|$)/.test(first)) return 'er';
  if (/^sequenceDiagram(\s|$)/.test(first)) return 'sequence';
  if (/^stateDiagram(-v2)?(\s|$)/.test(first)) return 'state';
  if (/^architecture-beta(\s|$)/.test(first)) return 'architecture';
  if (/^classDiagram(-v2)?(\s|$)/.test(first)) return 'class';
  return 'unknown';
}
