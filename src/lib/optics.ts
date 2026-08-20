/**
 * Pure optics for the focimeter simulator.
 *
 * Sign convention: a prescription is stored as written on a script -
 * `sph` and `cyl` in dioptres, `axis` in degrees 1-180 (180 meaning horizontal).
 * Nothing in this module touches the DOM, so every rule below is unit tested.
 */

export interface Rx {
  /** Sphere power in dioptres. */
  sph: number;
  /** Cylinder power in dioptres. Negative in minus-cyl form, positive in plus-cyl form. */
  cyl: number;
  /** Cylinder axis, 1-180 degrees. Meaningless (and normalised to 180) when cyl is 0. */
  axis: number;
}

/** Smallest power increment on the drum, matching a real focimeter. */
export const DIOPTRE_STEP = 0.25;

/** The drum bottoms out here, as a real instrument does. */
export const POWER_LIMIT = 20;

/** Round a power onto the 0.25 D grid the instrument can actually display. */
export function roundToStep(value: number, step: number = DIOPTRE_STEP): number {
  return round2(Math.round(value / step) * step);
}

/** Clamp a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Round to two decimals without floating point dust, and never return -0. */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Format a power the way a script does: `+2.50`, `-4.00`, `0.00` when plano. */
export function formatDioptres(value: number): string {
  const rounded = round2(value);
  if (rounded === 0) return '0.00';
  return (rounded > 0 ? '+' : '-') + Math.abs(rounded).toFixed(2);
}

/** Format an axis as a script does: three digits, `005`, `090`, `180`. */
export function formatAxis(axis: number): string {
  return String(normaliseAxis(axis)).padStart(3, '0');
}

/**
 * Fold any angle into the 1-180 range used for cylinder axes.
 * Axis 0 and axis 180 are the same meridian; optometry writes it as 180.
 */
export function normaliseAxis(axis: number): number {
  const wrapped = ((Math.round(axis) % 180) + 180) % 180;
  return wrapped === 0 ? 180 : wrapped;
}

/**
 * Shortest angular distance between two axes, 0-90 degrees.
 * Axes are undirected, so 175 and 5 are only 10 degrees apart.
 */
export function axisDifference(a: number, b: number): number {
  const diff = Math.abs(normaliseAxis(a) - normaliseAxis(b)) % 180;
  return Math.min(diff, 180 - diff);
}

/**
 * Standard transposition: add the cyl to the sph, flip the cyl sign,
 * rotate the axis by 90 degrees. The lens is unchanged; only the notation moves.
 */
export function transpose(rx: Rx): Rx {
  if (rx.cyl === 0) return { ...rx, axis: normaliseAxis(rx.axis) };
  return {
    sph: round2(rx.sph + rx.cyl),
    cyl: round2(-rx.cyl),
    axis: normaliseAxis(rx.axis + 90),
  };
}

/** Express a prescription in minus-cylinder form. */
export function toMinusCyl(rx: Rx): Rx {
  return rx.cyl > 0 ? transpose(rx) : { ...rx, axis: normaliseAxis(rx.axis) };
}

/** Express a prescription in plus-cylinder form. */
export function toPlusCyl(rx: Rx): Rx {
  return rx.cyl < 0 ? transpose(rx) : { ...rx, axis: normaliseAxis(rx.axis) };
}

export type CylFormat = 'minus' | 'plus';

/** Express a prescription in the requested cylinder form. */
export function inFormat(rx: Rx, format: CylFormat): Rx {
  return format === 'plus' ? toPlusCyl(rx) : toMinusCyl(rx);
}

/** Render a prescription as a single line, e.g. `-4.00 / -1.00 x 045`. */
export function formatRx(rx: Rx): string {
  const sph = formatDioptres(rx.sph);
  if (rx.cyl === 0) return `${sph} DS`;
  return `${sph} / ${formatDioptres(rx.cyl)} x ${formatAxis(rx.axis)}`;
}

/**
 * Power of the lens in the meridian `meridian` degrees from horizontal.
 * At the cyl axis the power is the sphere; 90 degrees away it is sph + cyl.
 */
export function meridianPower(rx: Rx, meridian: number): number {
  const rad = ((meridian - rx.axis) * Math.PI) / 180;
  return rx.sph + rx.cyl * Math.sin(rad) ** 2;
}

/** The two principal powers of the lens, most minus first. */
export function principalPowers(rx: Rx): [number, number] {
  const a = round2(rx.sph);
  const b = round2(rx.sph + rx.cyl);
  return a <= b ? [a, b] : [b, a];
}

/** The spherical equivalent, sph + cyl/2. */
export function sphericalEquivalent(rx: Rx): number {
  return round2(rx.sph + rx.cyl / 2);
}

/* ------------------------------------------------------------------ *
 * Defocus model
 * ------------------------------------------------------------------ */

export interface DefocusState {
  /** Dioptric error blurring the line set lying along the wheel axis. */
  primary: number;
  /** Dioptric error blurring the line set lying across the wheel axis. */
  secondary: number;
  /** Drum power that clears the primary set at the current wheel position. */
  primaryTarget: number;
  /** Drum power that clears the secondary set at the current wheel position. */
  secondaryTarget: number;
  /** Blur that no drum position can remove, caused by wheel/axis misalignment. */
  residual: number;
}

/**
 * How out of focus each set of mires is, given the lens in the instrument and
 * the current drum and wheel positions.
 *
 * Lines lying along a meridian are focused by the power in the meridian
 * PERPENDICULAR to them, so with the wheel sat on the lens axis the primary
 * lines clear at sph + cyl and the secondary lines clear at sph. Off-axis, the
 * two clearing powers slide together following cos^2 / sin^2 of the
 * misalignment.
 *
 * On top of that sits a residual term: a cylinder viewed off its axis produces
 * mires that are skewed and can never be brought crisp at any drum setting.
 * That residual is zero when aligned and greatest at 45 degrees off, which is
 * exactly the cue that drives a student to hunt for the axis first. It is
 * shaped for findability rather than strict optics - the floor term keeps small
 * cylinders detectable and the 0.75 exponent lets the blur ease off over the
 * last few degrees rather than snapping.
 */
export function defocus(rx: Rx, drumPower: number, wheelAxis: number): DefocusState {
  const rad = ((rx.axis - wheelAxis) * Math.PI) / 180;
  const sin2 = Math.sin(rad) ** 2;
  const cos2 = Math.cos(rad) ** 2;

  const primaryTarget = rx.sph + rx.cyl * cos2;
  const secondaryTarget = rx.sph + rx.cyl * sin2;

  const residual =
    rx.cyl === 0 ? 0 : (0.75 + Math.abs(rx.cyl)) * Math.abs(Math.sin(2 * rad)) ** 0.75;

  return {
    primary: Math.abs(drumPower - primaryTarget) + residual,
    secondary: Math.abs(drumPower - secondaryTarget) + residual,
    primaryTarget,
    secondaryTarget,
    residual,
  };
}

export interface MireAppearance {
  /** Stroke width of the line set, in SVG units. */
  width: number;
  /** CSS filter for the line set. */
  filter: string;
  /** Opacity of the line set. */
  opacity: number;
  /** True when the set is sharp enough to call focused. */
  crisp: boolean;
  /** 0-1 sharpness, for the optional focus meter. */
  sharpness: number;
}

/** Below this dioptric error a line set counts as in focus. */
const CRISP_EPSILON = 0.001;

/**
 * Map a dioptric error onto how a real mire looks: an out-of-focus line does
 * not simply go fuzzy in place, it spreads into a wide soft band of light that
 * dims as the same energy covers more area. The 0.7 exponent steepens the
 * response near focus so even a quarter dioptre is visibly soft and exact
 * focus snaps in by comparison.
 */
export function mireAppearance(dioptricError: number): MireAppearance {
  const error = Math.min(Math.abs(dioptricError), 10);
  const crisp = error < CRISP_EPSILON;
  const response = error ** 0.7;
  return {
    width: 2 + response * 6,
    filter: crisp ? 'none' : `blur(${(response * 3).toFixed(2)}px)`,
    opacity: crisp ? 1 : Math.max(0.35, 0.9 - response * 0.08),
    crisp,
    sharpness: clamp(1 - error / 2, 0, 1),
  };
}

/* ------------------------------------------------------------------ *
 * Grading
 * ------------------------------------------------------------------ */

export interface FieldResult {
  ok: boolean;
  expected: number;
  given: number;
  /** Signed error for powers, unsigned angular error for the axis. */
  error: number;
}

export interface GradeResult {
  correct: boolean;
  sph: FieldResult;
  cyl: FieldResult;
  axis: FieldResult;
  /** True when the answer was graded against the transposed form of the target. */
  transposed: boolean;
  /** The target expressed in the same cylinder form the answer used. */
  expected: Rx;
}

export interface Tolerances {
  /** Allowed power error in dioptres. */
  power: number;
  /** Allowed axis error in degrees. */
  axis: number;
}

export const DEFAULT_TOLERANCES: Tolerances = { power: 0.125, axis: 3 };

/**
 * Grade a student's reading against the lens in the instrument.
 *
 * The answer is accepted in either cylinder form - a correctly transposed
 * reading describes the same lens - but the result reports which form was used
 * so the UI can point it out. The axis is ignored for a spherical lens, and is
 * compared circularly so 179 against 1 is a 2 degree error, not 178.
 */
export function gradeReading(
  answer: Rx,
  target: Rx,
  tolerances: Tolerances = DEFAULT_TOLERANCES,
): GradeResult {
  const direct = compare(answer, target, tolerances, false);
  if (direct.correct) return direct;

  const flipped = compare(answer, transpose(target), tolerances, true);
  if (flipped.correct) return flipped;

  // Neither form is right, so report against whichever form the student wrote
  // in - the feedback then lines up with what they actually typed.
  const answerIsOtherForm =
    (answer.cyl > 0 && target.cyl < 0) || (answer.cyl < 0 && target.cyl > 0);
  return answerIsOtherForm ? flipped : direct;
}

function compare(
  answer: Rx,
  expected: Rx,
  tolerances: Tolerances,
  transposed: boolean,
): GradeResult {
  const sphError = round2(answer.sph - expected.sph);
  const cylError = round2(answer.cyl - expected.cyl);
  const axisRelevant = expected.cyl !== 0;
  const axisError = axisRelevant ? axisDifference(answer.axis, expected.axis) : 0;

  const sph: FieldResult = {
    ok: Math.abs(sphError) <= tolerances.power,
    expected: expected.sph,
    given: answer.sph,
    error: sphError,
  };
  const cyl: FieldResult = {
    ok: Math.abs(cylError) <= tolerances.power,
    expected: expected.cyl,
    given: answer.cyl,
    error: cylError,
  };
  const axis: FieldResult = {
    ok: !axisRelevant || axisError <= tolerances.axis,
    expected: expected.axis,
    given: answer.axis,
    error: axisError,
  };

  return { correct: sph.ok && cyl.ok && axis.ok, sph, cyl, axis, transposed, expected };
}

/* ------------------------------------------------------------------ *
 * Lens generation
 * ------------------------------------------------------------------ */

export interface LensSpec {
  /** Inclusive sphere range in dioptres. */
  sph: [number, number];
  /** Inclusive cylinder magnitude range in dioptres, both values positive. */
  cyl: [number, number];
  /** Axis granularity in degrees: 10 gives 10, 20, 30 ... 180. */
  axisStep: number;
  /** Chance of generating a spherical (cyl 0) lens, 0-1. */
  sphereChance: number;
}

export type Random = () => number;

/** Pick a value on the 0.25 D grid inside an inclusive range. */
function randomPower(range: [number, number], random: Random): number {
  const steps = Math.round((range[1] - range[0]) / DIOPTRE_STEP);
  return round2(range[0] + Math.floor(random() * (steps + 1)) * DIOPTRE_STEP);
}

/**
 * Generate a lens for the student to read. Cylinders are always produced in
 * minus form; call {@link inFormat} to present them the other way round.
 */
export function generateLens(spec: LensSpec, random: Random = Math.random): Rx {
  const sph = randomPower(spec.sph, random);
  const spherical = random() < spec.sphereChance;
  const cylMagnitude = spherical
    ? 0
    : Math.max(DIOPTRE_STEP, randomPower(spec.cyl, random));
  const axisSteps = Math.floor(180 / spec.axisStep);
  const axis = spherical
    ? 180
    : normaliseAxis((Math.floor(random() * axisSteps) + 1) * spec.axisStep);

  return {
    sph: clamp(sph, -POWER_LIMIT, POWER_LIMIT),
    cyl: cylMagnitude === 0 ? 0 : -cylMagnitude,
    axis,
  };
}
