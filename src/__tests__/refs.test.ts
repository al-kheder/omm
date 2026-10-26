import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initOmm, writeField, writeNodeField, listAllElements } from '../lib/store.js';
import { extractRefs, getIncomingRefs, getOutgoingRefs, buildRefGraph } from '../lib/refs.js';
import { validateDiagram } from '../lib/validate.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-refs-'));
  initOmm(tmpDir);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  // persp-a
  // ├── api       (diagram references @persp-b/store)
  // │   └── handler
  // └── worker
  // persp-b
  // └── store
  writeField('persp-a', 'diagram', 'graph LR\n  api -->|"calls"| worker', tmpDir);
  writeNodeField('persp-a', ['api'], 'diagram', 'graph LR\n  handler -->|"writes"| db["@persp-b/store"]', tmpDir);
  writeNodeField('persp-a', ['api', 'handler'], 'description', 'h', tmpDir);
  writeNodeField('persp-a', ['worker'], 'description', 'w', tmpDir);
  writeField('persp-b', 'diagram', 'graph LR\n  store -->|"read by"| a["@persp-a"]', tmpDir);
  writeNodeField('persp-b', ['store'], 'description', 's', tmpDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listAllElements', () => {
  it('walks the whole tree depth-first', () => {
    expect(listAllElements(tmpDir)).toEqual([
      'persp-a', 'persp-a/api', 'persp-a/api/handler', 'persp-a/worker',
      'persp-b', 'persp-b/store',
    ]);
  });

  it('skips hidden and unsafe directory names', () => {
    fs.mkdirSync(path.join(tmpDir, '.omm', 'persp-a', '.cache'));
    expect(listAllElements(tmpDir)).not.toContain('persp-a/.cache');
  });
});

describe('extractRefs', () => {
  it('extracts top-level and nested path refs', () => {
    expect(extractRefs('a["@persp-b/store"] --> b["@persp-a"]')).toEqual(['persp-b/store', 'persp-a']);
  });

  it('ignores e-mail addresses', () => {
    expect(extractRefs('a["mail admin@example.com"]')).toEqual([]);
  });
});

describe('refs across the whole tree', () => {
  it('finds incoming refs from nested diagrams', () => {
    expect(getIncomingRefs('persp-b/store', tmpDir).map(r => r.source_class)).toEqual(['persp-a/api']);
    expect(getIncomingRefs('persp-a', tmpDir).map(r => r.source_class)).toEqual(['persp-b']);
  });

  it('finds outgoing refs of a nested element', () => {
    expect(getOutgoingRefs('persp-a/api', tmpDir).map(r => r.target_class)).toEqual(['persp-b/store']);
  });

  it('builds the full graph', () => {
    const graph = buildRefGraph(tmpDir).map(r => `${r.source_class} -> ${r.target_class}`);
    expect(graph.sort()).toEqual(['persp-a/api -> persp-b/store', 'persp-b -> persp-a']);
  });
});

describe('validation of path refs', () => {
  const allClasses = ['persp-a', 'persp-a/api', 'persp-b', 'persp-b/store'];

  it('accepts refs to existing nested elements', () => {
    const r = validateDiagram('graph LR\n  a -->|"x"| b["@persp-b/store"]\n  b -->|"y"| c\n  c -->|"z"| a', { className: 'persp-a/api', allClasses });
    expect(r.issues.filter(i => i.rule.startsWith('ref-'))).toEqual([]);
  });

  it('errors on refs to missing nested elements', () => {
    const r = validateDiagram('graph LR\n  a -->|"x"| b["@persp-b/nope"]', { className: 'persp-a', allClasses });
    expect(r.issues.find(i => i.rule === 'ref-exists')?.level).toBe('error');
  });

  it('warns when a child references its ancestor', () => {
    const r = validateDiagram('graph LR\n  a -->|"x"| b["@persp-a"]', { className: 'persp-a/api', allClasses });
    expect(r.issues.find(i => i.rule === 'ref-ancestor')?.level).toBe('warning');
    expect(r.valid).toBe(true);
  });

  it('errors on a nested self-reference', () => {
    const r = validateDiagram('graph LR\n  a -->|"x"| b["@persp-a/api"]', { className: 'persp-a/api', allClasses });
    expect(r.issues.find(i => i.rule === 'ref-self')?.level).toBe('error');
  });
});
