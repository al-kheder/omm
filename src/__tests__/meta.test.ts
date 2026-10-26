import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import YAML from 'yaml';
import { initOmm, writeField, writeNodeField, readNodeMeta, readMeta, deleteClass } from '../lib/store.js';

let tmpDir: string;

function git(cmd: string): void {
  execSync(`git ${cmd}`, { cwd: tmpDir, stdio: 'ignore' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-meta-'));
  git('init -q -b main');
  git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m init');
  initOmm(tmpDir);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('unified meta format', () => {
  it('top-level writes record kind, title and git info', () => {
    writeField('persp', 'description', 'd', tmpDir);
    const meta = readMeta('persp', tmpDir)!;
    expect(meta.kind).toBe('perspective');
    expect(meta.title).toBe('persp');
    expect(meta.git_commit).toMatch(/^[0-9a-f]{4,}$/);
    expect(meta.git_branch).toBe('main');
    expect(meta.update_count).toBe(1);
  });

  it('nested writes record git info too', () => {
    writeNodeField('persp', ['child'], 'description', 'd', tmpDir);
    const meta = readNodeMeta('persp', ['child'], tmpDir)!;
    expect(meta.kind).toBe('nested-class');
    expect(meta.git_commit).toMatch(/^[0-9a-f]{4,}$/);
    expect(meta.git_branch).toBe('main');
  });

  it('writeField with a nested path behaves like writeNodeField', () => {
    writeField('persp/child', 'description', 'd', tmpDir);
    expect(readNodeMeta('persp', ['child'], tmpDir)?.kind).toBe('nested-class');
    expect(readMeta('persp', tmpDir)?.children).toEqual(['child']);
  });

  it('keeps the previous diagram for top-level and nested elements', () => {
    writeField('persp', 'diagram', 'graph LR\n  a --> b', tmpDir);
    writeField('persp', 'diagram', 'graph LR\n  a --> c', tmpDir);
    expect(readMeta('persp', tmpDir)?.prev_diagram).toBe('graph LR\n  a --> b');

    writeNodeField('persp', ['child'], 'diagram', 'graph LR\n  x --> y', tmpDir);
    writeNodeField('persp', ['child'], 'diagram', 'graph LR\n  x --> z', tmpDir);
    expect(readNodeMeta('persp', ['child'], tmpDir)?.prev_diagram).toBe('graph LR\n  x --> y');
  });

  it('deleting a nested element removes it from the parent children list', () => {
    writeNodeField('persp', ['a'], 'description', 'a', tmpDir);
    writeNodeField('persp', ['b'], 'description', 'b', tmpDir);
    expect(readMeta('persp', tmpDir)?.children).toEqual(['a', 'b']);
    deleteClass('persp/a', tmpDir);
    expect(readMeta('persp', tmpDir)?.children).toEqual(['b']);
  });

  it('reads old-format meta and upgrades it on the next write', () => {
    const dir = path.join(tmpDir, '.omm', 'legacy');
    fs.mkdirSync(dir, { recursive: true });
    // Format written by the pre-v0.2.1 updateMeta(): no kind/title
    fs.writeFileSync(path.join(dir, 'meta.yaml'), YAML.stringify({
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      update_count: 4,
      last_field: 'diagram',
      git_commit: 'abc1234',
      git_branch: 'old',
    }));

    expect(readMeta('legacy', tmpDir)?.update_count).toBe(4);

    writeField('legacy', 'note', 'n', tmpDir);
    const meta = readMeta('legacy', tmpDir)!;
    expect(meta.created).toBe('2026-01-01T00:00:00.000Z');
    expect(meta.update_count).toBe(5);
    expect(meta.kind).toBe('perspective');
    expect(meta.title).toBe('legacy');
    expect(meta.git_branch).toBe('main');
  });
});
