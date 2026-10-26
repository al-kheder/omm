import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseElementPath,
  writeField,
  writeNodeField,
  readField,
  readNodeField,
  deleteClass,
  showClass,
  classExists,
  initOmm,
} from '../lib/store.js';

const UNSAFE = ['', '..', '../x', '../src', 'a/../../x', 'a/..', '/abs', 'a//b', '.hidden', 'a/.git', 'C:\\x', 'a\\..\\b', 'c:', 'a\0b'];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-paths-'));
  initOmm(tmpDir);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseElementPath', () => {
  it.each(UNSAFE)('rejects %j', (p) => {
    expect(() => parseElementPath(p)).toThrow(/invalid element path/);
  });

  it('accepts top-level and nested kebab-case paths', () => {
    expect(parseElementPath('overall-architecture')).toEqual(['overall-architecture']);
    expect(parseElementPath('persp/child/leaf_2')).toEqual(['persp', 'child', 'leaf_2']);
  });
});

describe('store functions stay inside .omm/', () => {
  it.each(UNSAFE)('writeField rejects %j', (p) => {
    expect(() => writeField(p, 'description', 'x', tmpDir)).toThrow(/invalid element path/);
  });

  it.each(UNSAFE)('readField / showClass / classExists reject %j', (p) => {
    expect(() => readField(p, 'description', tmpDir)).toThrow(/invalid element path/);
    expect(() => showClass(p, tmpDir)).toThrow(/invalid element path/);
    expect(() => classExists(p, tmpDir)).toThrow(/invalid element path/);
  });

  it('writeNodeField / readNodeField reject traversal in nested segments', () => {
    expect(() => writeNodeField('persp', ['..', '..', 'x'], 'description', 'x', tmpDir)).toThrow(/invalid element path/);
    expect(() => readNodeField('persp', ['..'], 'description', tmpDir)).toThrow(/invalid element path/);
    expect(fs.existsSync(path.join(tmpDir, 'x'))).toBe(false);
  });

  it('deleteClass refuses to delete a project folder outside .omm/', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'app.ts'), 'code');

    expect(() => deleteClass('../src', tmpDir)).toThrow(/invalid element path/);
    expect(() => deleteClass('..', tmpDir)).toThrow(/invalid element path/);
    expect(() => deleteClass('', tmpDir)).toThrow(/invalid element path/);

    expect(fs.readFileSync(path.join(src, 'app.ts'), 'utf-8')).toBe('code');
    expect(fs.existsSync(path.join(tmpDir, '.omm'))).toBe(true);
  });

  it('valid nested paths still work', () => {
    writeNodeField('persp', ['child', 'leaf'], 'description', 'hello', tmpDir);
    expect(readNodeField('persp', ['child', 'leaf'], 'description', tmpDir)).toBe('hello');
    expect(readField('persp/child/leaf', 'description', tmpDir)).toBe('hello');
    expect(deleteClass('persp/child/leaf', tmpDir)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.omm', 'persp', 'child'))).toBe(true);
  });
});
