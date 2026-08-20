import type { LensSpec, Tolerances } from './optics.ts';

export type LevelId = 'beginner' | 'intermediate' | 'advanced' | 'clinic';

export interface Level {
  id: LevelId;
  label: string;
  /** One line shown under the level picker. */
  summary: string;
  lens: LensSpec;
  tolerances: Tolerances;
}

/**
 * Four rungs of difficulty. Ranges widen, axes land on finer steps, and the
 * axis tolerance tightens - so an answer that passes at clinic level would
 * have passed at every level below it.
 */
export const LEVELS: readonly Level[] = [
  {
    id: 'beginner',
    label: 'Beginner',
    summary: 'Low powers, axes on tens, generous axis tolerance. Half the lenses are spheres.',
    lens: { sph: [-4, 4], cyl: [0.5, 2], axisStep: 10, sphereChance: 0.5 },
    tolerances: { power: 0.125, axis: 6 },
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    summary: 'Everyday powers, axes on fives.',
    lens: { sph: [-8, 6], cyl: [0.25, 4], axisStep: 5, sphereChance: 0.2 },
    tolerances: { power: 0.125, axis: 4 },
  },
  {
    id: 'advanced',
    label: 'Advanced',
    summary: 'Full power range, any axis, tight tolerance.',
    lens: { sph: [-12, 10], cyl: [0.25, 6], axisStep: 1, sphereChance: 0.1 },
    tolerances: { power: 0.125, axis: 2 },
  },
  {
    id: 'clinic',
    label: 'Clinic',
    summary: 'High powers and large cylinders, axis to the degree. Nothing forgiven.',
    lens: { sph: [-18, 16], cyl: [0.25, 8], axisStep: 1, sphereChance: 0.05 },
    tolerances: { power: 0.125, axis: 1 },
  },
] as const;

const FALLBACK = LEVELS[0] as Level;

export function getLevel(id: LevelId): Level {
  return LEVELS.find((level) => level.id === id) ?? FALLBACK;
}

export function isLevelId(value: unknown): value is LevelId {
  return typeof value === 'string' && LEVELS.some((level) => level.id === value);
}
