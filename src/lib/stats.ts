import type { GradeResult, Rx } from './optics.ts';
import { round2 } from './optics.ts';
import type { LevelId } from './levels.ts';

export interface Attempt {
  /** Epoch milliseconds when the attempt was submitted. */
  at: number;
  level: LevelId;
  target: Rx;
  answer: Rx;
  correct: boolean;
  /** Seconds spent on the lens. */
  seconds: number;
  sphError: number;
  cylError: number;
  axisError: number;
}

export interface Stats {
  attempts: number;
  correct: number;
  streak: number;
  bestStreak: number;
  /** Rolling log of recent attempts, newest first. */
  history: Attempt[];
}

export const EMPTY_STATS: Stats = {
  attempts: 0,
  correct: 0,
  streak: 0,
  bestStreak: 0,
  history: [],
};

/** How many attempts to keep. Enough for a session review, small enough to store. */
export const HISTORY_LIMIT = 100;

export function recordAttempt(stats: Stats, attempt: Attempt): Stats {
  const streak = attempt.correct ? stats.streak + 1 : 0;
  return {
    attempts: stats.attempts + 1,
    correct: stats.correct + (attempt.correct ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    history: [attempt, ...stats.history].slice(0, HISTORY_LIMIT),
  };
}

export function buildAttempt(input: {
  level: LevelId;
  target: Rx;
  answer: Rx;
  grade: GradeResult;
  seconds: number;
  at: number;
}): Attempt {
  return {
    at: input.at,
    level: input.level,
    target: input.target,
    answer: input.answer,
    correct: input.grade.correct,
    seconds: round2(input.seconds),
    sphError: input.grade.sph.error,
    cylError: input.grade.cyl.error,
    axisError: input.grade.axis.error,
  };
}

export function accuracy(stats: Stats): number {
  return stats.attempts === 0 ? 0 : stats.correct / stats.attempts;
}

/** Mean seconds per lens over the logged attempts, or 0 when there are none. */
export function averageSeconds(stats: Stats): number {
  if (stats.history.length === 0) return 0;
  const total = stats.history.reduce((sum, attempt) => sum + attempt.seconds, 0);
  return round2(total / stats.history.length);
}

/**
 * Which part of the reading is letting the student down, counted over the
 * logged attempts. Used to drive the coaching line under the stats.
 */
export function weakestField(stats: Stats): 'sph' | 'cyl' | 'axis' | null {
  const misses = { sph: 0, cyl: 0, axis: 0 };
  for (const attempt of stats.history) {
    if (attempt.correct) continue;
    if (Math.abs(attempt.sphError) > 0.125) misses.sph += 1;
    if (Math.abs(attempt.cylError) > 0.125) misses.cyl += 1;
    if (Math.abs(attempt.axisError) > 0) misses.axis += 1;
  }
  const worst = (Object.keys(misses) as Array<keyof typeof misses>).reduce((a, b) =>
    misses[a] >= misses[b] ? a : b,
  );
  return misses[worst] === 0 ? null : worst;
}
