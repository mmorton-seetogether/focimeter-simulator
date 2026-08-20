import { EMPTY_STATS, HISTORY_LIMIT, type Attempt, type Stats } from './stats.ts';
import { isLevelId, type LevelId } from './levels.ts';
import type { CylFormat } from './optics.ts';

const STATS_KEY = 'focimeter.stats.v1';
const PREFS_KEY = 'focimeter.prefs.v1';

export type Theme = 'dark' | 'light' | 'system';
export type Mode = 'explore' | 'practice';

export interface Preferences {
  mode: Mode;
  level: LevelId;
  cylFormat: CylFormat;
  theme: Theme;
  /** Show the sharpness meter beside the eyepiece. */
  focusMeter: boolean;
  /** Reveal the lens in explore mode. */
  showRx: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'practice',
  level: 'beginner',
  cylFormat: 'minus',
  // The brand look is the cream theme, so that is what a first visit gets
  // rather than whatever the operating system happens to prefer.
  theme: 'light',
  focusMeter: false,
  showRx: true,
};

/**
 * localStorage is unavailable in private-mode Safari and behind some corporate
 * policies. The app must still run, so every access is guarded and falls back
 * to in-memory state for the session.
 */
function safeStorage(): Storage | null {
  try {
    const probe = '__focimeter__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage = typeof window === 'undefined' ? null : safeStorage();

function readJson<T>(key: string): unknown | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled mid-session: the app keeps working
    // with whatever is already in memory.
  }
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

export function loadPreferences(): Preferences {
  const raw = readJson<Partial<Preferences>>(PREFS_KEY);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES };
  const value = raw as Partial<Preferences>;
  return {
    mode: value.mode === 'explore' || value.mode === 'practice' ? value.mode : DEFAULT_PREFERENCES.mode,
    level: isLevelId(value.level) ? value.level : DEFAULT_PREFERENCES.level,
    cylFormat: value.cylFormat === 'plus' ? 'plus' : 'minus',
    theme:
      value.theme === 'dark' || value.theme === 'light' || value.theme === 'system'
        ? value.theme
        : DEFAULT_PREFERENCES.theme,
    focusMeter: value.focusMeter === true,
    showRx: value.showRx !== false,
  };
}

export function savePreferences(preferences: Preferences): void {
  writeJson(PREFS_KEY, preferences);
}

/* ------------------------------------------------------------------ *
 * Stats
 * ------------------------------------------------------------------ */

/** Parse stored stats defensively - the shape may predate the current build. */
export function loadStats(): Stats {
  const raw = readJson<Partial<Stats>>(STATS_KEY);
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATS, history: [] };
  const value = raw as Partial<Stats>;
  const history = Array.isArray(value.history)
    ? value.history.filter(isAttempt).slice(0, HISTORY_LIMIT)
    : [];
  return {
    attempts: numberOr(value.attempts, 0),
    correct: numberOr(value.correct, 0),
    streak: numberOr(value.streak, 0),
    bestStreak: numberOr(value.bestStreak, 0),
    history,
  };
}

export function saveStats(stats: Stats): void {
  writeJson(STATS_KEY, stats);
}

export function clearStats(): Stats {
  if (storage) {
    try {
      storage.removeItem(STATS_KEY);
    } catch {
      // Nothing to do: the in-memory reset below still takes effect.
    }
  }
  return { ...EMPTY_STATS, history: [] };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isAttempt(value: unknown): value is Attempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<Attempt>;
  return (
    typeof attempt.at === 'number' &&
    typeof attempt.correct === 'boolean' &&
    !!attempt.target &&
    !!attempt.answer &&
    typeof attempt.target.sph === 'number' &&
    typeof attempt.answer.sph === 'number'
  );
}
