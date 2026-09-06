import { describe, expect, it } from 'vitest';
import { History } from '../../src/core/history';
import { validateOp, validateRecipe } from '../../src/core/ops/validate';
import { describeOp, describeSelection } from '../../src/core/ops/types';

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
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'cut', axis: 'z', offset: 1, keep: 'both' }] })).toThrow(/normal/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'cut', normal: [0, 0, 0], offset: 1, keep: 'both' }] })).toThrow(/normal/);
    expect(() => validateOp({ id: 'a', type: 'rotate', axis: 'z', degrees: 90 })).toThrow(/unknown op type rotate/);
    expect(() => validateOp({ id: 'a', type: 'layflat', normal: [0, 0, 1] })).toThrow(/unknown op type layflat/);
    expect(() => validateRecipe({ version: 1, ops: [{ id: 'a', type: 'nope' }] })).toThrow(/unknown op type/);
    expect(() => validateRecipe({ version: 1, ops: [{ type: 'mirror', axis: 'x' }] })).toThrow(/id/);
  });
});

describe('History.push validation', () => {
  it('rejects NaN from a blank form field', () => {
    const h = new History();
    expect(() => h.push({ id: 'a', type: 'cut', normal: [0, 0, 1], offset: NaN, keep: 'both' })).toThrow(/offset/);
    expect(h.ops.length).toBe(0);
  });
});

describe('paint selection gestures', () => {
  const paint = (select: unknown) => validateOp({ id: 'p', type: 'paint', color: 1, select });

  it('accepts mode, dam, segment, lasso, invert, grow, shrink and rejects bad ones', () => {
    const fill = { kind: 'fill', part: 0, point: [1, 2, 3], normal: [0, 0, 1], angle: 30, mode: 'subtract', dam: true };
    const brush = { kind: 'brush', part: 0, points: [[0, 0, 0]], normals: [[0, 0, 1]], radius: 2, mode: 'add', dam: true };
    const segment = { kind: 'segment', part: 0, point: [1, 2, 3], normal: [0, 0, 1], tolerance: 20, mode: 'subtract' };
    const lasso = { kind: 'lasso', part: 1, eye: [0, 0, 50], polygon: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] };
    const height = { kind: 'height', min: 0, max: 5, mode: 'subtract' };
    const part = { kind: 'part', index: 0, mode: 'subtract' };
    const all = { kind: 'all', mode: 'subtract' };
    const invert = { kind: 'invert' };
    const grow = { kind: 'grow', distance: 1.5 };
    const shrink = { kind: 'shrink', distance: 0.5 };
    const multi = { kind: 'multi', selections: [fill, brush, segment, lasso, height, part, all, invert, grow, shrink] };
    const op = paint(multi);
    expect(JSON.parse(JSON.stringify(op)).select).toEqual(multi);
    expect(validateOp(JSON.parse(JSON.stringify(op)))).toEqual(op);

    expect(() => paint({ ...fill, mode: 'both' })).toThrow(/mode/);
    expect(() => paint({ ...lasso, polygon: lasso.polygon.slice(0, 2) })).toThrow(/polygon/);
    expect(() => paint({ ...grow, distance: 0 })).toThrow(/distance/);
    expect(() => paint({ ...shrink, distance: -1 })).toThrow(/distance/);
    expect(() => paint({ ...segment, tolerance: -1 })).toThrow(/tolerance/);
    expect(() => paint({ ...fill, dam: 'yes' })).toThrow(/dam/);

    const plain = paint({ kind: 'fill', part: 0, point: [1, 2, 3], normal: [0, 0, 1], angle: 30 });
    if (plain.type !== 'paint') throw new Error('expected paint');
    expect('mode' in plain.select).toBe(false);
    expect('dam' in plain.select).toBe(false);
  });

  it('describeSelection prefixes subtract gestures with a minus', () => {
    const op = paint({
      kind: 'multi',
      selections: [
        { kind: 'segment', part: 0, point: [0, 0, 0], normal: [0, 0, 1], tolerance: 20 },
        { kind: 'segment', part: 0, point: [0, 0, 0], normal: [0, 0, 1], tolerance: 20 },
        { kind: 'lasso', part: 0, eye: [0, 0, 50], polygon: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], mode: 'subtract' },
        { kind: 'grow', distance: 1 },
      ],
    });
    if (op.type !== 'paint') throw new Error('expected paint');
    expect(describeSelection(op.select)).toBe('2 segments, -1 lasso, 1 grow');
    expect(describeOp(op)).toBe('Paint slot 1 (2 segments, -1 lasso, 1 grow)');
  });
});
