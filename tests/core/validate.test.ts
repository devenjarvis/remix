import { describe, expect, it } from 'vitest';
import { History } from '../../src/core/history';
import { validateRecipe } from '../../src/core/ops/validate';

describe('recipe validation', () => {
  it('accepts a round-tripped recipe', () => {
    const h = new History();
    h.push({ id: 'a', type: 'scale', factors: [2, 2, 2] });
    h.push({ id: 'b', type: 'boolean', mode: 'subtract', tool: { kind: 'cylinder', size: [4, 4, 20] }, matrix: Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) });
    h.push({ id: 'c', type: 'text', text: 'v2', height: 5, depth: 1, mode: 'engrave', origin: [0, 0, 0], normal: [0, 0, 1], rotation: 0 });
    const back = History.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(back.ops).toEqual(h.ops);
  });

  it('rejects malformed ops', () => {
    expect(() => validateRecipe({ version: 3, ops: [] })).toThrow(/version/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'scale', factors: [1, 'x', 1] }] })).toThrow(/scale factors/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'scale', factors: [1, NaN, 1] }] })).toThrow(/scale factors/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'boolean', mode: 'union', tool: { kind: 'box', size: [1, 1, 1] }, matrix: [1, 2] }] })).toThrow(/matrix/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'boolean', mode: 'union', tool: { kind: 'mesh', name: 'm', positions: [0, 0, 0], indices: [0, 1, 2] }, matrix: Array(16).fill(0) }] })).toThrow(/index out of range/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'cut', axis: 'w', offset: 1, keep: 'both' }] })).toThrow(/axis/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'nope' }] })).toThrow(/unknown op type/);
    expect(() => validateRecipe({ version: 1, ops: [{ type: 'mirror', axis: 'x' }] })).toThrow(/id/);
  });
});

describe('History.push validation', () => {
  it('rejects NaN from a blank form field', () => {
    const h = new History();
    expect(() => h.push({ id: 'a', type: 'rotate', axis: 'z', degrees: NaN })).toThrow(/degrees/);
    expect(h.ops.length).toBe(0);
  });
});
