import { describe, expect, it } from 'vitest';
import {
  axisDifference,
  defocus,
  formatAxis,
  formatAxisDisplay,
  formatDioptres,
  formatRx,
  generateLens,
  gradeReading,
  inFormat,
  meridianPower,
  mireAppearance,
  normaliseAxis,
  principalPowers,
  roundToStep,
  sphericalEquivalent,
  toMinusCyl,
  toPlusCyl,
  transpose,
  type Rx,
} from './optics.ts';

describe('formatting', () => {
  it('writes powers the way a script does', () => {
    expect(formatDioptres(2.5)).toBe('+2.50');
    expect(formatDioptres(-4)).toBe('-4.00');
    expect(formatDioptres(0)).toBe('0.00');
    expect(formatDioptres(-0)).toBe('0.00');
  });

  it('writes axes without padding, the way they are said', () => {
    expect(formatAxis(5)).toBe('5');
    expect(formatAxis(90)).toBe('90');
    expect(formatAxis(180)).toBe('180');
    expect(formatAxis(0)).toBe('180');
  });

  it('pads axes to three digits only for the instrument display', () => {
    expect(formatAxisDisplay(5)).toBe('005');
    expect(formatAxisDisplay(90)).toBe('090');
    expect(formatAxisDisplay(180)).toBe('180');
    expect(formatAxisDisplay(0)).toBe('180');
  });

  it('writes a sphere as DS and a toric in full', () => {
    expect(formatRx({ sph: -2, cyl: 0, axis: 180 })).toBe('-2.00 DS');
    expect(formatRx({ sph: -4, cyl: -1, axis: 45 })).toBe('-4.00 / -1.00 x 45');
  });
});

describe('axis arithmetic', () => {
  it('folds any angle into 1-180 with 0 written as 180', () => {
    expect(normaliseAxis(0)).toBe(180);
    expect(normaliseAxis(180)).toBe(180);
    expect(normaliseAxis(190)).toBe(10);
    expect(normaliseAxis(-10)).toBe(170);
    expect(normaliseAxis(360)).toBe(180);
  });

  it('measures the short way round, because axes are undirected', () => {
    expect(axisDifference(175, 5)).toBe(10);
    expect(axisDifference(1, 179)).toBe(2);
    expect(axisDifference(90, 90)).toBe(0);
    expect(axisDifference(180, 90)).toBe(90);
    expect(axisDifference(0, 180)).toBe(0);
  });
});

describe('transposition', () => {
  it('follows the standard rule', () => {
    expect(transpose({ sph: -4, cyl: -1, axis: 45 })).toEqual({ sph: -5, cyl: 1, axis: 135 });
    expect(transpose({ sph: 2, cyl: 1.5, axis: 170 })).toEqual({ sph: 3.5, cyl: -1.5, axis: 80 });
  });

  it('is its own inverse', () => {
    const rx: Rx = { sph: -3.25, cyl: -2.75, axis: 12 };
    expect(transpose(transpose(rx))).toEqual(rx);
  });

  it('leaves a sphere alone', () => {
    expect(transpose({ sph: -2, cyl: 0, axis: 90 })).toEqual({ sph: -2, cyl: 0, axis: 90 });
  });

  it('wraps the axis rather than exceeding 180', () => {
    expect(transpose({ sph: 0, cyl: -1, axis: 120 }).axis).toBe(30);
    expect(transpose({ sph: 0, cyl: -1, axis: 90 }).axis).toBe(180);
  });

  it('describes the same lens in either form', () => {
    const minus: Rx = { sph: -4, cyl: -1, axis: 45 };
    const plus = toPlusCyl(minus);
    expect(plus.cyl).toBeGreaterThan(0);
    expect(toMinusCyl(plus)).toEqual(minus);
    for (const meridian of [0, 30, 45, 90, 135, 179]) {
      expect(meridianPower(plus, meridian)).toBeCloseTo(meridianPower(minus, meridian), 10);
    }
  });

  it('leaves a form alone when it is already in it', () => {
    const minus: Rx = { sph: 1, cyl: -2, axis: 80 };
    expect(toMinusCyl(minus)).toEqual(minus);
    expect(inFormat(minus, 'minus')).toEqual(minus);
    expect(inFormat(minus, 'plus')).toEqual(transpose(minus));
  });
});

describe('lens power', () => {
  it('gives the sphere at the axis and sph + cyl across it', () => {
    const rx: Rx = { sph: -4, cyl: -1, axis: 45 };
    expect(meridianPower(rx, 45)).toBeCloseTo(-4, 10);
    expect(meridianPower(rx, 135)).toBeCloseTo(-5, 10);
  });

  it('reports the principal powers most minus first', () => {
    expect(principalPowers({ sph: -4, cyl: -1, axis: 45 })).toEqual([-5, -4]);
    expect(principalPowers({ sph: -5, cyl: 1, axis: 135 })).toEqual([-5, -4]);
  });

  it('computes the spherical equivalent', () => {
    expect(sphericalEquivalent({ sph: -4, cyl: -1, axis: 45 })).toBe(-4.5);
    expect(sphericalEquivalent({ sph: 2, cyl: 0, axis: 180 })).toBe(2);
  });
});

describe('defocus model', () => {
  const rx: Rx = { sph: -4, cyl: -1, axis: 45 };

  it('clears one line set at the sphere and the other at sph + cyl when on axis', () => {
    const state = defocus(rx, 0, 45);
    expect(state.residual).toBe(0);
    expect(state.secondaryTarget).toBeCloseTo(-4, 10);
    expect(state.primaryTarget).toBeCloseTo(-5, 10);
  });

  it('brings each set to a sharp focus at its own drum reading', () => {
    expect(defocus(rx, -5, 45).primary).toBeCloseTo(0, 10);
    expect(defocus(rx, -4, 45).secondary).toBeCloseTo(0, 10);
  });

  it('never lets a misaligned cylinder come sharp at any drum setting', () => {
    const misaligned = 45 + 30;
    let best = Infinity;
    for (let power = -8; power <= 0; power += 0.25) {
      const state = defocus(rx, power, misaligned);
      best = Math.min(best, Math.max(state.primary, state.secondary));
    }
    expect(best).toBeGreaterThan(0.5);
  });

  it('is worst at 45 degrees off axis and eases to nothing on it', () => {
    const at45 = defocus(rx, -4.5, 45 + 45).residual;
    const at20 = defocus(rx, -4.5, 45 + 20).residual;
    const at2 = defocus(rx, -4.5, 45 + 2).residual;
    expect(at45).toBeGreaterThan(at20);
    expect(at20).toBeGreaterThan(at2);
    expect(defocus(rx, -4.5, 45).residual).toBe(0);
  });

  it('treats the axis as irrelevant for a sphere', () => {
    const sphere: Rx = { sph: -3, cyl: 0, axis: 180 };
    for (const wheel of [1, 45, 90, 180]) {
      const state = defocus(sphere, -3, wheel);
      expect(state.primary).toBeCloseTo(0, 10);
      expect(state.secondary).toBeCloseTo(0, 10);
    }
  });

  it('reads the same at an axis and its 180-degree partner', () => {
    const a = defocus(rx, -4.5, 30);
    const b = defocus(rx, -4.5, 210);
    expect(a.primary).toBeCloseTo(b.primary, 10);
    expect(a.secondary).toBeCloseTo(b.secondary, 10);
  });
});

describe('mire appearance', () => {
  it('is crisp only at focus', () => {
    expect(mireAppearance(0).crisp).toBe(true);
    expect(mireAppearance(0).filter).toBe('none');
    expect(mireAppearance(0.25).crisp).toBe(false);
  });

  it('spreads wider and dimmer as the error grows', () => {
    const near = mireAppearance(0.25);
    const far = mireAppearance(3);
    expect(far.width).toBeGreaterThan(near.width);
    expect(far.opacity).toBeLessThan(near.opacity);
    expect(far.sharpness).toBeLessThan(near.sharpness);
  });

  it('keeps a badly defocused mire visible rather than invisible', () => {
    expect(mireAppearance(50).opacity).toBeGreaterThanOrEqual(0.35);
  });

  it('ignores the sign of the error', () => {
    expect(mireAppearance(-1.5)).toEqual(mireAppearance(1.5));
  });
});

describe('grading', () => {
  const target: Rx = { sph: -4, cyl: -1, axis: 45 };

  it('accepts an exact reading', () => {
    expect(gradeReading({ ...target }, target).correct).toBe(true);
  });

  it('accepts the correctly transposed reading and says so', () => {
    const answer = transpose(target);
    const result = gradeReading(answer, target);
    expect(result.correct).toBe(true);
    expect(result.transposed).toBe(true);
  });

  it('rejects a quarter dioptre out on the sphere', () => {
    const result = gradeReading({ sph: -3.75, cyl: -1, axis: 45 }, target);
    expect(result.correct).toBe(false);
    expect(result.sph.ok).toBe(false);
    expect(result.sph.error).toBe(0.25);
    expect(result.cyl.ok).toBe(true);
  });

  it('applies the axis tolerance circularly', () => {
    const near: Rx = { sph: -4, cyl: -1, axis: 178 };
    const wrapped = gradeReading(near, { ...target, axis: 2 }, { power: 0.125, axis: 5 });
    expect(wrapped.axis.error).toBe(4);
    expect(wrapped.correct).toBe(true);
  });

  it('honours a tighter axis tolerance', () => {
    const answer: Rx = { sph: -4, cyl: -1, axis: 48 };
    expect(gradeReading(answer, target, { power: 0.125, axis: 5 }).correct).toBe(true);
    expect(gradeReading(answer, target, { power: 0.125, axis: 1 }).correct).toBe(false);
  });

  it('ignores the axis for a spherical lens', () => {
    const sphere: Rx = { sph: -2, cyl: 0, axis: 180 };
    const result = gradeReading({ sph: -2, cyl: 0, axis: 37 }, sphere);
    expect(result.correct).toBe(true);
    expect(result.axis.error).toBe(0);
  });

  it('reports against the form the student wrote in when they are wrong', () => {
    // Plus-cyl answer, wrong sphere: the feedback should compare plus with plus.
    const answer: Rx = { sph: -4.5, cyl: 1, axis: 135 };
    const result = gradeReading(answer, target);
    expect(result.correct).toBe(false);
    expect(result.transposed).toBe(true);
    expect(result.expected.cyl).toBe(1);
  });

  it('spots the classic sign slip on the cylinder', () => {
    const result = gradeReading({ sph: -4, cyl: 1, axis: 45 }, target);
    expect(result.correct).toBe(false);
  });
});

describe('lens generation', () => {
  const spec = { sph: [-4, 4] as [number, number], cyl: [0.5, 2] as [number, number], axisStep: 10, sphereChance: 0 };

  it('lands every power on the quarter dioptre grid', () => {
    for (let i = 0; i < 400; i += 1) {
      const lens = generateLens(spec);
      expect(roundToStep(lens.sph)).toBe(lens.sph);
      expect(roundToStep(lens.cyl)).toBe(lens.cyl);
    }
  });

  it('stays inside the requested ranges', () => {
    for (let i = 0; i < 400; i += 1) {
      const lens = generateLens(spec);
      expect(lens.sph).toBeGreaterThanOrEqual(-4);
      expect(lens.sph).toBeLessThanOrEqual(4);
      expect(Math.abs(lens.cyl)).toBeGreaterThanOrEqual(0.5);
      expect(Math.abs(lens.cyl)).toBeLessThanOrEqual(2);
    }
  });

  it('always generates minus cylinders on a valid axis', () => {
    for (let i = 0; i < 200; i += 1) {
      const lens = generateLens(spec);
      expect(lens.cyl).toBeLessThan(0);
      expect(lens.axis).toBeGreaterThanOrEqual(1);
      expect(lens.axis).toBeLessThanOrEqual(180);
      expect(lens.axis % 10).toBe(0);
    }
  });

  it('respects the axis step', () => {
    for (let i = 0; i < 200; i += 1) {
      const lens = generateLens({ ...spec, axisStep: 5 });
      expect(lens.axis % 5).toBe(0);
    }
  });

  it('produces a sphere when asked, with the axis written as 180', () => {
    const lens = generateLens({ ...spec, sphereChance: 1 });
    expect(lens.cyl).toBe(0);
    expect(lens.axis).toBe(180);
  });

  it('reaches both ends of the range', () => {
    const lowest = generateLens(spec, () => 0);
    const highest = generateLens(spec, () => 0.999999);
    expect(lowest.sph).toBe(-4);
    expect(highest.sph).toBe(4);
  });

  it('never generates a zero cylinder for a toric lens', () => {
    // A cyl range starting at 0 must not yield a "toric" lens of -0.00.
    for (let i = 0; i < 200; i += 1) {
      const lens = generateLens({ ...spec, cyl: [0, 4] });
      expect(lens.cyl).toBeLessThanOrEqual(-0.25);
    }
  });
});

describe('rounding', () => {
  it('snaps onto the quarter dioptre grid without floating point dust', () => {
    expect(roundToStep(-4.13)).toBe(-4.25);
    expect(roundToStep(0.13)).toBe(0.25);
    expect(roundToStep(0.1)).toBe(0);
    expect(roundToStep(1.874)).toBe(1.75);
    // A near-zero negative must come back as plain 0, not -0: it is stored,
    // serialised to JSON, and compared against.
    expect(Object.is(roundToStep(-0.1), 0)).toBe(true);
  });
});
