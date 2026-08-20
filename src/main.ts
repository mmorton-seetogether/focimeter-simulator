import './styles/app.css';
import './components/power-drum.ts';
import './components/axis-wheel.ts';
import './components/eye-reticle.ts';
import './components/rx-fields.ts';

import type { PowerDrum } from './components/power-drum.ts';
import type { AxisWheel } from './components/axis-wheel.ts';
import type { EyeReticle } from './components/eye-reticle.ts';
import type { RxFields } from './components/rx-fields.ts';

import {
  DIOPTRE_STEP,
  formatAxis,
  formatDioptres,
  formatRx,
  generateLens,
  gradeReading,
  inFormat,
  principalPowers,
  sphericalEquivalent,
  transpose,
  type CylFormat,
  type GradeResult,
  type Rx,
} from './lib/optics.ts';
import { LEVELS, getLevel, isLevelId, type LevelId } from './lib/levels.ts';
import { accuracy, averageSeconds, buildAttempt, recordAttempt, weakestField, type Stats } from './lib/stats.ts';
import {
  clearStats,
  loadPreferences,
  loadStats,
  savePreferences,
  saveStats,
  type Mode,
  type Preferences,
  type Theme,
} from './lib/storage.ts';

/** Look up an element that the markup guarantees exists. */
function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

const reticle = must<EyeReticle>('#reticle');
const drum = must<PowerDrum>('#drum');
const wheel = must<AxisWheel>('#wheel');

const readoutPower = must<HTMLElement>('#readout-power');
const readoutAxis = must<HTMLElement>('#readout-axis');

const focusMeter = must<HTMLElement>('#focus-meter');
const focusPrimary = must<HTMLElement>('#focus-primary');
const focusSecondary = must<HTMLElement>('#focus-secondary');
const focusMeterToggle = must<HTMLInputElement>('#focus-meter-toggle');

const answerFields = must<RxFields>('#answer-fields');
const answerForm = must<HTMLFormElement>('#answer-form');
const submitButton = must<HTMLButtonElement>('#submit-answer');
const skipButton = must<HTMLButtonElement>('#skip-lens');
const feedback = must<HTMLElement>('#feedback');
const statsList = must<HTMLElement>('#stats');
const coach = must<HTMLElement>('#coach');
const historyBox = must<HTMLElement>('#history');
const resetStatsButton = must<HTMLButtonElement>('#reset-stats');
const levelSelect = must<HTMLSelectElement>('#level-select');
const levelSummary = must<HTMLElement>('#level-summary');
const cylFormatTag = must<HTMLButtonElement | HTMLElement>('#cyl-format-tag');

const lensFields = must<RxFields>('#lens-fields');
const lensFacts = must<HTMLElement>('#lens-facts');
const lensRandom = must<HTMLButtonElement>('#lens-random');
const lensTranspose = must<HTMLButtonElement>('#lens-transpose');

const themeToggle = must<HTMLButtonElement>('#theme-toggle');
const helpDialog = must<HTMLDialogElement>('#help-dialog');

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let preferences: Preferences = loadPreferences();
let stats: Stats = loadStats();

/** The lens currently in the instrument, always held in minus-cyl form. */
let lens: Rx = { sph: 0, cyl: 0, axis: 180 };
/** When the current practice lens was presented, for the per-lens timer. */
let lensPresentedAt = Date.now();
/** True once the current practice lens has been marked or skipped. */
let settled = false;

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * `system` is resolved here rather than in CSS so the token block stays
 * single-source: the root always carries an explicit dark or light theme.
 */
function applyTheme(): void {
  const resolved: Exclude<Theme, 'system'> =
    preferences.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : preferences.theme;
  document.documentElement.dataset.theme = resolved;
  themeToggle.setAttribute('aria-label', `Theme: ${preferences.theme}. Click to change.`);
  themeToggle.title = `Theme: ${preferences.theme}`;
}

darkQuery.addEventListener('change', () => {
  if (preferences.theme === 'system') applyTheme();
});

themeToggle.addEventListener('click', () => {
  const order: Theme[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(preferences.theme) + 1) % order.length] as Theme;
  preferences = { ...preferences, theme: next };
  savePreferences(preferences);
  applyTheme();
});

/* ------------------------------------------------------------------ *
 * Instrument
 * ------------------------------------------------------------------ */

function setLens(next: Rx): void {
  lens = next;
  reticle.lens = next;
  updateFocusMeter();
}

function updateReadout(): void {
  readoutPower.textContent = formatDioptres(drum.power);
  readoutAxis.textContent = formatAxis(wheel.axis);
}

function updateFocusMeter(): void {
  if (focusMeter.hidden) return;
  const { primary, secondary } = reticle.sharpness;
  focusPrimary.style.width = `${(primary * 100).toFixed(1)}%`;
  focusSecondary.style.width = `${(secondary * 100).toFixed(1)}%`;
}

drum.addEventListener('power-change', () => {
  reticle.power = drum.power;
  updateReadout();
  updateFocusMeter();
});

wheel.addEventListener('axis-change', () => {
  reticle.axis = wheel.axis;
  updateReadout();
  updateFocusMeter();
});

/** Put the instrument back to its rest position for a fresh lens. */
function resetInstrument(): void {
  drum.power = 0;
  wheel.axis = 180;
  reticle.power = 0;
  reticle.axis = 180;
  updateReadout();
}

/* ------------------------------------------------------------------ *
 * Mode
 * ------------------------------------------------------------------ */

function setMode(mode: Mode): void {
  preferences = { ...preferences, mode };
  savePreferences(preferences);

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.segmented__option')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  }
  for (const view of document.querySelectorAll<HTMLElement>('.console-view')) {
    view.hidden = view.dataset.view !== mode;
  }

  // The sharpness meter is a crutch, so it is only offered away from marking.
  const showMeter = mode === 'explore' && preferences.focusMeter;
  focusMeter.hidden = !showMeter;

  if (mode === 'practice') {
    lensFacts.replaceChildren();
    nextLens();
  } else {
    setLens(lensFields.value);
    renderLensFacts();
    updateFocusMeter();
  }
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('.segmented__option')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode === 'explore' ? 'explore' : 'practice'));
}

/* ------------------------------------------------------------------ *
 * Practice
 * ------------------------------------------------------------------ */

function currentLevel() {
  return getLevel(preferences.level);
}

function nextLens(): void {
  const level = currentLevel();
  setLens(generateLens(level.lens));
  resetInstrument();
  lensPresentedAt = Date.now();
  settled = false;

  feedback.hidden = true;
  feedback.replaceChildren();
  answerFields.disabled = false;
  answerFields.value = { sph: 0, cyl: 0, axis: 180 };
  submitButton.textContent = 'Mark my reading';
  skipButton.hidden = false;
}

function setCylFormat(format: CylFormat): void {
  preferences = { ...preferences, cylFormat: format };
  savePreferences(preferences);
  cylFormatTag.textContent = format === 'plus' ? 'plus cyl' : 'minus cyl';
  cylFormatTag.setAttribute('title', 'Click to switch cylinder form');
  if (preferences.mode === 'explore') renderLensFacts();
}

cylFormatTag.addEventListener('click', () => {
  setCylFormat(preferences.cylFormat === 'minus' ? 'plus' : 'minus');
});

function submitAnswer(): void {
  // Once a lens is settled the same button moves on, so Enter keeps working.
  if (settled) {
    nextLens();
    answerFields.focusFirst();
    return;
  }

  const answer = answerFields.value;
  const level = currentLevel();
  const grade = gradeReading(answer, lens, level.tolerances);
  const seconds = (Date.now() - lensPresentedAt) / 1000;

  stats = recordAttempt(
    stats,
    buildAttempt({ level: level.id, target: lens, answer, grade, seconds, at: Date.now() }),
  );
  saveStats(stats);

  settle(grade, seconds);
  renderStats();
  renderHistory();
}

function settle(grade: GradeResult | null, seconds: number): void {
  settled = true;
  answerFields.disabled = true;
  submitButton.textContent = 'Next lens';
  skipButton.hidden = true;
  renderFeedback(grade, seconds);
  submitButton.focus();
}

answerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAnswer();
});

skipButton.addEventListener('click', () => {
  // A skip is not marked, but it does break the streak - otherwise the run
  // would only ever contain the lenses that happened to be easy.
  stats = { ...stats, streak: 0 };
  saveStats(stats);
  settle(null, (Date.now() - lensPresentedAt) / 1000);
  renderStats();
});

/* ------------------------------------------------------------------ *
 * Practice rendering
 * ------------------------------------------------------------------ */

function renderFeedback(grade: GradeResult | null, seconds: number): void {
  const shown = inFormat(lens, preferences.cylFormat);
  feedback.hidden = false;

  if (!grade) {
    feedback.dataset.result = 'skipped';
    feedback.innerHTML = `
      <p class="feedback__verdict">Skipped</p>
      <p class="feedback__answer">${formatRx(shown)}</p>
      <p class="feedback__note">Not marked, but the streak resets. Have another go at this kind of lens.</p>
    `;
    return;
  }

  const level = currentLevel();
  const lines = [
    line('Sphere', grade.sph.ok, formatDioptres(grade.sph.expected), formatDioptres(grade.sph.given)),
    line('Cyl', grade.cyl.ok, formatDioptres(grade.cyl.expected), formatDioptres(grade.cyl.given)),
    grade.expected.cyl === 0
      ? '<div class="feedback__line"><b>Axis</b><span>Not applicable — the lens is spherical.</span></div>'
      : line(
          'Axis',
          grade.axis.ok,
          formatAxis(grade.axis.expected),
          `${formatAxis(grade.axis.given)} (${grade.axis.error}° out, ${level.tolerances.axis}° allowed)`,
        ),
  ].join('');

  const notes: string[] = [];
  if (grade.correct && grade.transposed) {
    notes.push(
      `Marked against the ${grade.expected.cyl > 0 ? 'plus' : 'minus'}-cyl form of the lens — your transposition was right.`,
    );
  }
  if (!grade.correct) {
    notes.push(hint(grade));
  }
  notes.push(`${seconds.toFixed(1)} s on this lens.`);

  feedback.dataset.result = grade.correct ? 'correct' : 'incorrect';
  feedback.innerHTML = `
    <p class="feedback__verdict">${grade.correct ? '✓ Correct' : '✕ Not quite'}</p>
    <p class="feedback__answer">${formatRx(shown)}</p>
    <div class="feedback__breakdown">${lines}</div>
    <p class="feedback__note">${notes.join(' ')}</p>
  `;
}

function line(label: string, ok: boolean, expected: string, given: string): string {
  return `
    <div class="feedback__line ${ok ? 'is-ok' : 'is-bad'}">
      <b>${label}</b>
      <span>${ok ? `${expected} ✓` : `you said ${given} — it was ${expected}`}</span>
    </div>
  `;
}

/** Turn a wrong answer into the one thing most worth saying about it. */
function hint(grade: GradeResult): string {
  // A sphere has one reading, not two, so none of the advice below about
  // taking the cylinder off the wrong reading applies to it.
  if (grade.expected.cyl === 0) {
    return grade.cyl.ok
      ? 'This one is a sphere: both sets of lines clear together at a single drum reading. Take that reading again.'
      : 'This one is a sphere — both sets of lines clear at the same drum reading, so there is no cylinder to record.';
  }
  if (!grade.axis.ok && grade.sph.ok && grade.cyl.ok) {
    return 'Powers right, axis out. Hunt the axis before you touch the drum: turn the wheel until the lines look square rather than skewed.';
  }
  if (!grade.cyl.ok && Math.abs(grade.cyl.error) >= DIOPTRE_STEP) {
    return 'The cylinder is the difference between your two drum readings, not the second reading itself.';
  }
  if (!grade.sph.ok && grade.cyl.ok) {
    return 'The cylinder is right, so both readings are the correct distance apart — you have taken the sphere off the wrong one.';
  }
  if (Math.abs(grade.sph.error) === Math.abs(grade.cyl.error) && grade.sph.error !== 0) {
    return 'Sphere and cylinder are out by the same amount in opposite directions: that is a transposition slip.';
  }
  return 'Take it again slowly — axis first, then each set of lines in turn.';
}

function renderStats(): void {
  const cells: Array<[string, string]> = [
    ['Lenses', String(stats.attempts)],
    ['Correct', String(stats.correct)],
    ['Accuracy', stats.attempts === 0 ? '—' : `${Math.round(accuracy(stats) * 100)}%`],
    ['Streak', String(stats.streak)],
    ['Best', String(stats.bestStreak)],
    ['Time', stats.history.length === 0 ? '—' : `${averageSeconds(stats).toFixed(0)}s`],
  ];
  statsList.innerHTML = cells
    .map(([term, value]) => `<div class="stat"><dt>${term}</dt><dd>${value}</dd></div>`)
    .join('');

  const weakest = weakestField(stats);
  if (weakest && stats.attempts >= 3) {
    const advice = {
      sph: 'Most of your misses are on the sphere. Read the more positive of the two drum settings.',
      cyl: 'Most of your misses are on the cylinder. It is the difference between the two readings.',
      axis: 'Most of your misses are on the axis. Settle the wheel before you touch the drum.',
    } as const;
    coach.textContent = advice[weakest];
    coach.hidden = false;
  } else {
    coach.hidden = true;
  }
}

function renderHistory(): void {
  if (stats.history.length === 0) {
    historyBox.innerHTML = '<p class="history-empty">No lenses read yet.</p>';
    return;
  }
  const items = stats.history
    .slice(0, 25)
    .map((attempt) => {
      const shown = inFormat(attempt.target, preferences.cylFormat);
      return `
        <li class="history-item ${attempt.correct ? 'is-correct' : 'is-wrong'}">
          <span class="history-item__mark" aria-hidden="true">${attempt.correct ? '✓' : '✕'}</span>
          <span>${formatRx(shown)}</span>
          <span class="history-item__time">${attempt.seconds.toFixed(0)}s</span>
        </li>
      `;
    })
    .join('');
  historyBox.innerHTML = `<ul class="history-list">${items}</ul>`;
}

resetStatsButton.addEventListener('click', () => {
  if (!window.confirm('Clear every recorded lens, streak and score?')) return;
  stats = clearStats();
  renderStats();
  renderHistory();
});

/* ------------------------------------------------------------------ *
 * Levels
 * ------------------------------------------------------------------ */

levelSelect.innerHTML = LEVELS.map(
  (level) => `<option value="${level.id}">${level.label}</option>`,
).join('');

function setLevel(id: LevelId): void {
  preferences = { ...preferences, level: id };
  savePreferences(preferences);
  levelSelect.value = id;
  levelSummary.textContent = getLevel(id).summary;
}

levelSelect.addEventListener('change', () => {
  const value = levelSelect.value;
  if (!isLevelId(value)) return;
  setLevel(value);
  if (preferences.mode === 'practice') nextLens();
});

/* ------------------------------------------------------------------ *
 * Explore
 * ------------------------------------------------------------------ */

function renderLensFacts(): void {
  // The facts spell the lens out in full, so they are only ever in the DOM
  // while exploring - in practice mode that would be the answer, one
  // inspector panel away.
  if (preferences.mode !== 'explore') {
    lensFacts.replaceChildren();
    return;
  }
  const [weak, strong] = principalPowers(lens);
  const facts: Array<[string, string]> = [
    ['Minus cyl', formatRx(inFormat(lens, 'minus'))],
    ['Plus cyl', formatRx(inFormat(lens, 'plus'))],
    ['Principal powers', `${formatDioptres(weak)} / ${formatDioptres(strong)}`],
    ['Spherical equivalent', formatDioptres(sphericalEquivalent(lens))],
  ];
  lensFacts.innerHTML = facts
    .map(([term, value]) => `<div class="lens-fact"><dt>${term}</dt><dd>${value}</dd></div>`)
    .join('');
}

lensFields.addEventListener('rx-input', () => {
  setLens(lensFields.value);
  renderLensFacts();
});

lensRandom.addEventListener('click', () => {
  const generated = generateLens(currentLevel().lens);
  lensFields.value = inFormat(generated, preferences.cylFormat);
  setLens(generated);
  renderLensFacts();
  resetInstrument();
});

lensTranspose.addEventListener('click', () => {
  const shown = transpose(lensFields.value);
  lensFields.value = shown;
  setLens(shown);
  renderLensFacts();
});

focusMeterToggle.addEventListener('change', () => {
  preferences = { ...preferences, focusMeter: focusMeterToggle.checked };
  savePreferences(preferences);
  focusMeter.hidden = !(preferences.mode === 'explore' && preferences.focusMeter);
  updateFocusMeter();
});

/* ------------------------------------------------------------------ *
 * Help and shortcuts
 * ------------------------------------------------------------------ */

must<HTMLButtonElement>('#help-open').addEventListener('click', () => helpDialog.showModal());
must<HTMLButtonElement>('#help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (event) => {
  // Clicking the backdrop lands on the dialog itself, never on its contents.
  if (event.target === helpDialog) helpDialog.close();
});

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement;

  if (event.key === '?' && !typing) {
    event.preventDefault();
    if (helpDialog.open) helpDialog.close();
    else helpDialog.showModal();
    return;
  }
  if ((event.key === 'n' || event.key === 'N') && !typing && !helpDialog.open) {
    event.preventDefault();
    if (preferences.mode === 'practice') nextLens();
    else lensRandom.click();
  }
});

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

function start(): void {
  applyTheme();
  setLevel(preferences.level);
  setCylFormat(preferences.cylFormat);
  focusMeterToggle.checked = preferences.focusMeter;

  lensFields.value = { sph: -4, cyl: -1, axis: 45 };
  renderStats();
  renderHistory();
  renderLensFacts();

  setMode(preferences.mode);
  updateReadout();

  // Set VITE_REPO_URL at build time to point the footer at your own fork.
  const repo = must<HTMLAnchorElement>('#repo-link');
  const repoUrl = import.meta.env.VITE_REPO_URL;
  if (repoUrl) repo.href = repoUrl;
  else repo.hidden = true;
}

start();
