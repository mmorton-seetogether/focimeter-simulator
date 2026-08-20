# Focimeter Simulator

A browser focimeter (lensmeter) for optometry and dispensing students. Put an unknown lens in the
instrument, hunt the axis, clear both sets of mires, read the prescription off the drum and the
wheel — and have it marked.

No accounts, no backend, no data leaves the browser. It installs as a PWA and works offline.

---

## What it does

**Practice mode** puts a random lens in the instrument and hides it. You read it the way you would
at the bench, type your answer, and get it marked field by field:

- Sphere and cylinder must be right to 0.25 D.
- The axis tolerance depends on the difficulty — 6° at Beginner down to 1° at Clinic.
- A correctly transposed answer is accepted in either cylinder form, and told so.
- The axis is ignored for a spherical lens.
- Wrong answers get a diagnosis, not just a cross: sphere and cylinder out by the same amount in
  opposite directions is called out as a transposition slip, powers right with the axis out sends
  you back to the wheel, and so on.

Streak, accuracy and time-per-lens are kept in `localStorage`, and after a few lenses the app names
whichever of sphere, cylinder or axis is costing you the most.

**Explore mode** lets you dial in any lens and watch what it does to the mires, with the same lens
shown in both cylinder forms alongside its principal powers and spherical equivalent. An optional
sharpness meter is available here as a training aid — it is deliberately unavailable while you are
being marked.

### Difficulty

| Level | Sphere | Cylinder | Axis step | Axis tolerance |
| --- | --- | --- | --- | --- |
| Beginner | −4.00 to +4.00 | 0.50 to 2.00 (half are spheres) | 10° | ±6° |
| Intermediate | −8.00 to +6.00 | 0.25 to 4.00 | 5° | ±4° |
| Advanced | −12.00 to +10.00 | 0.25 to 6.00 | 1° | ±2° |
| Clinic | −18.00 to +16.00 | 0.25 to 8.00 | 1° | ±1° |

### Controls

Every control takes a mouse, a finger and a keyboard.

| Control | Pointer | Keyboard |
| --- | --- | --- |
| Power drum | Drag vertically, scroll, or click a zone: outer 1.00 D, inner 0.25 D | `↑` `↓` step 0.25 D, `Shift` 1.00 D, `PageUp`/`PageDown` 1.00 D, `Home` zero |
| Axis wheel | Drag sideways, scroll, or click a zone on the rim: outer 10°, middle 5°, inner 1° | `←` `→` step 1°, `Shift` 10°, `Home` 180 |
| Anywhere | — | `N` next lens, `Enter` mark reading, `?` help |

---

## The optics

The interesting part of a focimeter simulator is that being out of focus has to be *informative* —
the student has to be able to tell which way to turn, and to tell "wrong power" from "wrong axis".
The model in [`src/lib/optics.ts`](src/lib/optics.ts) does three things:

**Two clearing powers.** Lines lying along a meridian are focused by the power in the meridian
perpendicular to them. With the wheel on the lens axis, one set of mires clears at `sph` and the
other at `sph + cyl`. As the wheel comes off the axis those two clearing powers slide together
following `cos²` and `sin²` of the misalignment.

**A misalignment residual.** A cylinder viewed off its axis produces skewed mires that no drum
setting can bring sharp. The residual is zero on the axis, greatest at 45° off it, and is what
forces you to settle the axis before touching the drum. It is shaped for findability rather than
strict optics: a floor term keeps small cylinders detectable, and a 0.75 exponent lets the blur
ease off over the last few degrees rather than snapping.

**Defocus that looks like defocus.** An out-of-focus mire does not go fuzzy in place — it spreads
into a wide, soft band of light that dims as the same energy covers more area. So the dioptric
error drives stroke width, blur radius and opacity together, in proportion to the error, which is
how a blur circle really grows. That keeps the ramp out of focus even: a quarter dioptre spreads
half as far as a half dioptre, so there is a readable gradient near focus rather than a cliff
between crisp and soft.

All of it is pure functions with no DOM, and all of it is unit tested — including the property that
a misaligned cylinder can never be brought sharp at *any* drum setting.

> **Note:** the lens is held in the client, so a determined student can read the answer out of
> devtools. That is unavoidable without a backend, and it only cheats the person doing it.

---

## Branding

The app carries SEE Together branding and is styled to sit alongside the
[refraction simulator](https://github.com/mmorton-seetogether) as one suite — same palette, same
type, same dark action bar and logo lockup.

| Token | Value | Used for |
| --- | --- | --- |
| Royal Blue | `#3B55A5` | Section labels, steppers, mode switch, focus rings |
| Burnt Orange | `#DD5A28` | The primary action, and the minus half of the drum scale |
| Teal | `#3F9684` | Secondary buttons, correct answers |
| Mustard Yellow | `#FFC70E` | The instrument readout, and the app icon |
| Cream | `#FAF3E6` | Page ground |
| Ink / Bar | `#1A1A1A` / `#262626` | Text, and the action bar |

Type is **Be Vietnam Pro** for headings and body, with **Optician Sans** — the optical chart face,
self-hosted from `public/fonts` under the SIL Open Font Licence — for the small capitalised labels.

Three deliberate departures from the light brand palette, all functional:

- **The instrument itself is not branded.** The power drum keeps its engraved black and red scale,
  the axis wheel its plain grey rim, and both keep plain numerals. These are meant to read as the
  real hardware, and a house typeface on an engraved dial does not.
- **The eyepiece stays dark, with green mires.** A focimeter target is a lamp behind a graticule:
  it does not read on cream, and green is the colour of a real lit target.
- **A dark theme is offered.** The cream theme is the default and the brand look; the dark theme
  keeps the same accents on the brand's ink and bar greys, for reading a screen in a dim room.

---

## Running it

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the unit tests once |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run typecheck` | Typecheck without building |
| `npm run og-image` | Redraw the social card |
| `npm run screenshot -- <url> <out.png> [js]` | Capture the running app with headless Chrome, for visual checks |

The favicon and app icons are the SEE Together brand marks, committed under `public/`. Only the
social card is generated — `scripts/generate-og-image.mjs` rasterises it with a small PNG encoder
built on Node's own zlib, and runs automatically before `dev` and `build`.

`scripts/screenshot.mjs` drives an installed Chrome over the DevTools protocol with no extra
packages, and takes an optional snippet of JS to set the page up before capturing — useful for
eyeballing a particular lens, since the mires are the one part of this app that unit tests cannot
check:

```bash
npm run screenshot -- http://localhost:5173 focused.png "
  document.querySelector('#tab-explore').click();
  document.querySelector('#wheel').axis = 45;
  document.querySelector('#drum').power = -4;
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
"
```

---

## Deploying

### Vercel

Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` already sets the
framework, build command, output directory and cache headers, so the defaults are correct — just
deploy. Or from the CLI:

```bash
npx vercel --prod
```

Optionally set `VITE_REPO_URL` in the project's environment variables to point the footer link at
your own repository. Without it the link is hidden.

### GitHub Pages

The site is static, so Pages works too. Build with a base path matching the repository name:

```bash
npm run build -- --base=/your-repo-name/
```

Then publish `dist/`. Note the service worker scope follows the base path.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) typechecks, tests and builds on every push
and pull request against Node 20 and 22.

---

## Project structure

```
index.html               Page shell and static markup
src/
  main.ts                Application controller: modes, marking, stats, wiring
  lib/
    optics.ts            Prescriptions, transposition, defocus, marking (pure, tested)
    levels.ts            Difficulty definitions
    stats.ts             Attempt records and session summaries (pure, tested)
    storage.ts           Guarded localStorage for stats and preferences
  components/
    eye-reticle.ts       The eyepiece: graticule, protractor and mires
    power-drum.ts        The power drum
    axis-wheel.ts        The axis wheel
    rx-fields.ts         Three stepped prescription fields, used for input and answers
  styles/app.css         Brand tokens, layout, and both themes
public/
  fonts/                 Optician Sans (SIL OFL), self-hosted
  see-together-logo.svg  Inverse lockup for the dark action bar
  favicon.ico, *.png     SEE Together brand icons
scripts/
  generate-og-image.mjs  Dependency-free social card generator
  screenshot.mjs         Headless-Chrome capture for visual checks
docs/
  original-prototype.html  The single-file version this grew from
```

The three instrument controls are custom elements with shadow DOM, so their internals cannot leak
into the page. `rx-fields` is deliberately in the light DOM — it is a form, and it should inherit
the page's styles and take part in the normal tab order.

---

## Accessibility

- The drum and wheel are `role="slider"` with live `aria-valuetext`, fully keyboard operable.
- The eyepiece reports in its label whether the mires are sharp and by how much they are out.
- Marking results are announced through a live region.
- Light and dark themes, following the system by default, with a manual override that persists.
- `prefers-reduced-motion` is honoured throughout.
- Layout is responsive from 320 px up, and on a desktop the whole instrument stays in view — you
  cannot focus mires with the axis wheel scrolled off the bottom of the screen.

---

## Licence

MIT — see [LICENSE](LICENSE).
