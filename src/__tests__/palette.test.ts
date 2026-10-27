import { describe, it, expect } from 'vitest';
import {
  nodeColors, flowNodeRole, isProcessFlowchart, colorSwatches, contrastRatio, CATEGORY_CLASSES,
  type DiagramThemeName,
} from '../lib/palette.js';
import { VALID_CLASSDEF_NAMES } from '../lib/validate.js';

const THEMES: DiagramThemeName[] = ['dark', 'light'];
// Backgrounds a node can sit on in the viewer (canvas, perspective box, nested group / lane)
const BACKGROUNDS: Record<DiagramThemeName, string[]> = {
  dark: ['#000000', '#0a0a0a', '#111111'],
  light: ['#f0f0f0', '#f8f8f8', '#efefef'],
};

describe('monochrome mode', () => {
  it('returns the original node styles, whatever the role', () => {
    expect(nodeColors('monochrome', 'dark', 'decision')).toEqual({ bg: '#0a0a0a', border: '#666666', dash: null, text: '#ffffff' });
    expect(nodeColors('monochrome', 'dark', 'process', 'external')).toEqual({ bg: '#0a0a0a', border: '#666666', dash: null, text: '#cccccc' });
    expect(nodeColors('monochrome', 'light', 'start-end')).toEqual({ bg: '#f0f0f0', border: '#999', dash: null, text: '#1a1a1a' });
    expect(nodeColors('monochrome', 'light', 'neutral', 'external')).toEqual({ bg: '#e0e0e0', border: '#bbb', dash: null, text: '#64748b' });
    expect(nodeColors('monochrome', 'light', 'neutral', 'lib')).toEqual({ bg: '#e8e8e8', border: '#c0c0c0', dash: null, text: '#553388' });
    // category classes other than external do not change the monochrome look
    expect(nodeColors('monochrome', 'light', 'neutral', 'error')).toEqual(nodeColors('monochrome', 'light', 'neutral'));
  });
});

describe('color mode', () => {
  it('keeps neutral elements in the monochrome style', () => {
    for (const t of THEMES) expect(nodeColors('color', t, 'neutral')).toEqual(nodeColors('monochrome', t, 'neutral'));
  });

  it('gives category classes precedence over the shape role', () => {
    const err = nodeColors('color', 'light', 'process', 'error');
    expect(err).toEqual(nodeColors('color', 'light', 'error'));
    expect(nodeColors('color', 'light', 'neutral', 'store').bg).not.toBe(nodeColors('color', 'light', 'neutral').bg);
    expect(nodeColors('color', 'dark', 'neutral', 'lib')).toEqual(nodeColors('color', 'dark', 'external'));
    // unknown classes do not change the color
    expect(nodeColors('color', 'light', 'decision', 'highlight')).toEqual(nodeColors('color', 'light', 'decision'));
  });

  it('uses a distinct fill for each flowchart symbol', () => {
    const roles = ['start-end', 'process', 'decision', 'io', 'document', 'subprocess', 'data', 'error'] as const;
    for (const t of THEMES) {
      const fills = roles.map(r => nodeColors('color', t, r).bg);
      expect(new Set(fills).size).toBe(roles.length);
    }
  });

  for (const t of THEMES) {
    it(`meets WCAG contrast in the ${t} theme`, () => {
      for (const [role, [bg, border, text]] of Object.entries(colorSwatches(t))) {
        // text on its fill: 4.5:1 (WCAG 1.4.3, small text)
        expect(contrastRatio(text, bg), `${role} text`).toBeGreaterThanOrEqual(4.5);
        // outline against every background it can sit on: 3:1 (WCAG 1.4.11, graphical objects)
        for (const back of BACKGROUNDS[t]) {
          expect(contrastRatio(border, back), `${role} border on ${back}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }
});

describe('flowchart roles', () => {
  it('maps shapes to roles', () => {
    expect(flowNodeRole('stadium', true)).toBe('start-end');
    expect(flowNodeRole('double-circle', false)).toBe('start-end');
    expect(flowNodeRole('diamond', false)).toBe('decision');
    expect(flowNodeRole('lean-right', true)).toBe('io');
    expect(flowNodeRole('lean-left', true)).toBe('io');
    expect(flowNodeRole('document', true)).toBe('document');
    expect(flowNodeRole('subroutine', true)).toBe('subprocess');
    expect(flowNodeRole('cylinder', false)).toBe('data');
    expect(flowNodeRole('circle', true)).toBe('connector');
  });

  it('colors plain boxes as steps only in process flowcharts', () => {
    expect(flowNodeRole('rect', true)).toBe('process');
    expect(flowNodeRole('round', true)).toBe('process');
    expect(flowNodeRole('rect', false)).toBe('neutral');
    expect(flowNodeRole('hexagon', false)).toBe('neutral');
  });

  it('recognises a process flowchart by its start or end node', () => {
    expect(isProcessFlowchart(['rect', 'stadium'])).toBe(true);
    expect(isProcessFlowchart(['rect', 'diamond', 'cylinder'])).toBe(false);
  });
});

describe('category classes', () => {
  it('are all accepted by omm validate', () => {
    for (const c of CATEGORY_CLASSES) expect(VALID_CLASSDEF_NAMES).toContain(c);
  });
});
