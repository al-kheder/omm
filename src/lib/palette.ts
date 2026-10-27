/**
 * Diagram colors for the viewer: the monochrome look (the default, unchanged) and an
 * optional color mode. Bundled into the viewer, so keep it dependency-free.
 *
 * Color mode only colors elements whose meaning is known:
 * - a flowchart node's shape (start/end, decision, input/output …),
 * - an omm category class (`entry`, `store`, `external`, `concern`, `error`, `success`),
 * - a notation convention (sequence participants, notes, state choices …).
 * Everything else stays neutral, so color never carries meaning on its own.
 */
import type { FlowShape } from './flowchart.js';

export type DiagramColorMode = 'monochrome' | 'color';
export type DiagramThemeName = 'dark' | 'light';

export interface NodeColors {
  bg: string;
  border: string;
  text: string;
  dash: string | null;
}

export type ColorRole =
  | 'neutral'
  // flowchart shapes
  | 'start-end' | 'process' | 'decision' | 'io' | 'document' | 'subprocess' | 'data' | 'connector'
  // omm category classes
  | 'error' | 'success' | 'entry' | 'store' | 'external' | 'concern'
  // other diagram types
  | 'entity' | 'participant' | 'state' | 'note' | 'activation' | 'composite';

type Swatch = [bg: string, border: string, text: string];

// Monochrome: the viewer's original node styles, kept exactly
const MONO: Record<DiagramThemeName, Record<'default' | 'external' | 'lib', NodeColors>> = {
  dark: {
    default:  { bg: '#0a0a0a', border: '#666666', dash: null, text: '#ffffff' },
    external: { bg: '#0a0a0a', border: '#666666', dash: null, text: '#cccccc' },
    lib:      { bg: '#0a0a0a', border: '#666666', dash: null, text: '#cccccc' },
  },
  light: {
    default:  { bg: '#f0f0f0', border: '#999', dash: null, text: '#1a1a1a' },
    external: { bg: '#e0e0e0', border: '#bbb', dash: null, text: '#64748b' },
    lib:      { bg: '#e8e8e8', border: '#c0c0c0', dash: null, text: '#553388' },
  },
};

// Color mode: soft fills, darker (light theme) or brighter (dark theme) borders, and text
// chosen for at least 4.5:1 contrast on the fill. Hues follow common flowchart practice and
// the category colors /omm-scan already prescribes (validate.ts CLASSDEF_PALETTE).
const COLOR: Record<DiagramThemeName, Record<Exclude<ColorRole, 'neutral'>, Swatch>> = {
  light: {
    'start-end':  ['#e6f4ea', '#2e7d4f', '#14532d'],
    process:      ['#e8f0fb', '#3b6db3', '#1e3a5f'],
    decision:     ['#fdf1dc', '#a86400', '#5c3a00'],
    io:           ['#e0f4f6', '#0e7c86', '#134e56'],
    document:     ['#efe8fa', '#7b4fc0', '#3f2470'],
    subprocess:   ['#e9eafb', '#4f55c4', '#2a2e7a'],
    data:         ['#eceff3', '#5b6b7f', '#1f2937'],
    connector:    ['#f0f0f0', '#6b6b6b', '#1a1a1a'],
    error:        ['#fde8e8', '#c0392b', '#7a1d1d'],
    success:      ['#e3f5e8', '#23804a', '#14532d'],
    entry:        ['#e5effd', '#2f6fd0', '#1e3a5f'],
    store:        ['#e4f4e4', '#3c8a3c', '#1d4d1d'],
    external:     ['#e6e6ea', '#6b6f80', '#3a3d4a'],
    concern:      ['#fce8ee', '#c43c6a', '#6e1a36'],
    entity:       ['#e8f0fb', '#3b6db3', '#1e3a5f'],
    participant:  ['#e8f0fb', '#3b6db3', '#1e3a5f'],
    state:        ['#e8f0fb', '#3b6db3', '#1e3a5f'],
    note:         ['#fff8d6', '#8f7400', '#4a3d00'],
    activation:   ['#dbe7f7', '#3b6db3', '#1e3a5f'],
    composite:    ['#f3f6fb', '#5f7ba3', '#1a1a1a'],
  },
  dark: {
    'start-end':  ['#0f2a1b', '#4caf73', '#d8f3e2'],
    process:      ['#0f1f33', '#5b9bd5', '#dbe9f8'],
    decision:     ['#2e2108', '#e0a030', '#fbe8c4'],
    io:           ['#0b2629', '#3fb4bf', '#d2f1f4'],
    document:     ['#22183a', '#a07ee0', '#e9e0fa'],
    subprocess:   ['#191b3a', '#7f86e8', '#e1e3fb'],
    data:         ['#1a1f27', '#8a9bb0', '#e2e8f0'],
    connector:    ['#0a0a0a', '#888888', '#ffffff'],
    error:        ['#330f0f', '#e06666', '#fadcdc'],
    success:      ['#0f2a1b', '#4caf73', '#d8f3e2'],
    entry:        ['#0f1f33', '#6aa2ea', '#dbe9f8'],
    store:        ['#102a12', '#6fbf73', '#dcf3dd'],
    external:     ['#16171c', '#7d8193', '#c9ccd6'],
    concern:      ['#321220', '#e06a92', '#f9dbe6'],
    entity:       ['#0f1f33', '#5b9bd5', '#dbe9f8'],
    participant:  ['#0f1f33', '#5b9bd5', '#dbe9f8'],
    state:        ['#0f1f33', '#5b9bd5', '#dbe9f8'],
    note:         ['#2b2508', '#c9a82a', '#f5ebc0'],
    activation:   ['#1b2c44', '#5b9bd5', '#dbe9f8'],
    composite:    ['#0d1520', '#5a7aa3', '#ffffff'],
  },
};

/** omm category classes that pick a color role (from `class x name` or `x:::name`) */
export const CATEGORY_CLASSES = ['entry', 'store', 'external', 'concern', 'error', 'success'] as const;

/**
 * Fill, border and text for an element.
 * In monochrome mode the role is ignored and the original styles are returned
 * (only the `external` and `lib` classes differ, as before).
 */
export function nodeColors(mode: DiagramColorMode, theme: DiagramThemeName, role: ColorRole, cls?: string): NodeColors {
  if (mode === 'monochrome') {
    const mono = MONO[theme];
    return { ...(cls === 'external' ? mono.external : cls === 'lib' ? mono.lib : mono.default) };
  }
  const byClass = cls === 'lib' ? 'external' : (CATEGORY_CLASSES as readonly string[]).includes(cls ?? '') ? cls as ColorRole : null;
  const r = byClass ?? role;
  if (r === 'neutral') return { ...MONO[theme].default };
  const [bg, border, text] = COLOR[theme][r];
  return { bg, border, text, dash: null };
}

const PROCESS_SHAPES = new Set<FlowShape>(['stadium', 'small-circle', 'double-circle']);

/** True for a flowchart with a start/end node: a process flowchart rather than an architecture diagram */
export function isProcessFlowchart(shapes: Iterable<FlowShape>): boolean {
  for (const s of shapes) if (PROCESS_SHAPES.has(s)) return true;
  return false;
}

/**
 * Color role of a flowchart node from its shape. Shapes with a fixed meaning get their role in
 * any flowchart; plain boxes count as process steps only in a process flowchart and stay
 * neutral in architecture diagrams. Category classes take precedence (see nodeColors).
 */
export function flowNodeRole(shape: FlowShape, processFlowchart: boolean): ColorRole {
  switch (shape) {
    case 'stadium': case 'small-circle': case 'double-circle': return 'start-end';
    case 'diamond': return 'decision';
    case 'lean-right': case 'lean-left': return 'io';
    case 'document': return 'document';
    case 'subroutine': return 'subprocess';
    case 'cylinder': return 'data';
    case 'circle': return 'connector';
    default: return processFlowchart ? 'process' : 'neutral';
  }
}

/** Every role with a color, for tests and documentation */
export function colorSwatches(theme: DiagramThemeName): Record<string, Swatch> {
  return { ...COLOR[theme] };
}

export interface EdgeColors { line: string; labelBg: string; labelText: string }

// Edges stay neutral in both color modes. Lines and arrowheads keep at least 3:1 against
// the backgrounds they cross; label text keeps 4.5:1 on its label background.
const EDGES: Record<DiagramThemeName, EdgeColors> = {
  dark: { line: '#909090', labelBg: '#000000', labelText: '#aaaaaa' },
  light: { line: '#64748b', labelBg: '#e8e8e8', labelText: '#475569' },
};

/** Line, arrowhead and label colors for edges */
export function edgeColors(theme: DiagramThemeName): EdgeColors {
  return { ...EDGES[theme] };
}

// --- WCAG contrast (used by tests) ---

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rgb or #rrggbb color */
export function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (1 to 21) */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
