import { describe, expect, it } from 'vitest';
import { gradeReading, type Rx } from './optics.ts';
import {
  EMPTY_STATS,
  HISTORY_LIMIT,
  accuracy,
  averageSeconds,
  buildAttempt,
  recordAttempt,
  weakestField,
  type Attempt,
  type Stats,
} from './stats.ts';

const target: Rx = { sph: -4, cyl: -1, axis: 45 };

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  const answer = overrides.answer ?? target;
  return buildAttempt({
    level: 'beginner',
    target,
    answer,
    grade: gradeReading(answer, target),
    seconds: 10,
    at: 1_700_000_000_000,
    ...overrides,
  } as Parameters<typeof buildAttempt>[0]);
}

describe('recording attempts', () => {
  it('counts a correct answer and extends the streak', () => {
    const stats = recordAttempt(EMPTY_STATS, attempt());
    expect(stats.attempts).toBe(1);
    expect(stats.correct).toBe(1);
    expect(stats.streak).toBe(1);
    expect(stats.bestStreak).toBe(1);
  });

  it('breaks the streak on a miss but keeps the best', () => {
    let stats: Stats = EMPTY_STATS;
    stats = recordAttempt(stats, attempt());
    stats = recordAttempt(stats, attempt());
    stats = recordAttempt(stats, attempt({ answer: { sph: 0, cyl: 0, axis: 180 } }));
    expect(stats.streak).toBe(0);
    expect(stats.bestStreak).toBe(2);
    expect(stats.attempts).toBe(3);
    expect(stats.correct).toBe(2);
  });

  it('does not mutate the stats it is given', () => {
    const before = { ...EMPTY_STATS, history: [] };
    recordAttempt(before, attempt());
    expect(before.attempts).toBe(0);
    expect(before.history).toHaveLength(0);
  });

  it('keeps the newest attempt first and caps the history', () => {
    let stats: Stats = { ...EMPTY_STATS, history: [] };
    for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) {
      stats = recordAttempt(stats, attempt({ seconds: i }));
    }
    expect(stats.history).toHaveLength(HISTORY_LIMIT);
    expect(stats.history[0]?.seconds).toBe(HISTORY_LIMIT + 24);
    expect(stats.attempts).toBe(HISTORY_LIMIT + 25);
  });
});

describe('summaries', () => {
  it('reports accuracy, and zero rather than NaN before any attempt', () => {
    expect(accuracy(EMPTY_STATS)).toBe(0);
    let stats: Stats = { ...EMPTY_STATS, history: [] };
    stats = recordAttempt(stats, attempt());
    stats = recordAttempt(stats, attempt({ answer: { sph: 0, cyl: 0, axis: 180 } }));
    expect(accuracy(stats)).toBe(0.5);
  });

  it('averages the time over logged attempts', () => {
    let stats: Stats = { ...EMPTY_STATS, history: [] };
    expect(averageSeconds(stats)).toBe(0);
    stats = recordAttempt(stats, attempt({ seconds: 10 }));
    stats = recordAttempt(stats, attempt({ seconds: 20 }));
    expect(averageSeconds(stats)).toBe(15);
  });
});

describe('weakest field', () => {
  it('is nothing when every attempt was right', () => {
    let stats: Stats = { ...EMPTY_STATS, history: [] };
    stats = recordAttempt(stats, attempt());
    expect(weakestField(stats)).toBeNull();
  });

  it('picks out the axis when only the axis is missed', () => {
    let stats: Stats = { ...EMPTY_STATS, history: [] };
    for (let i = 0; i < 3; i += 1) {
      stats = recordAttempt(stats, attempt({ answer: { sph: -4, cyl: -1, axis: 90 } }));
    }
    expect(weakestField(stats)).toBe('axis');
  });

  it('picks out the sphere when the powers are the problem', () => {
    let stats: Stats = { ...EMPTY_STATS, history: [] };
    for (let i = 0; i < 3; i += 1) {
      stats = recordAttempt(stats, attempt({ answer: { sph: -2, cyl: -1, axis: 45 } }));
    }
    expect(weakestField(stats)).toBe('sph');
  });
});
