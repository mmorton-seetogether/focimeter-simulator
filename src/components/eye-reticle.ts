import { defocus, mireAppearance, type Rx } from '../lib/optics.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The eyepiece view: the graticule, the protractor ring, and the two sets of
 * mires whose sharpness is the whole point of the exercise.
 *
 * The DOM is built once and only the handful of attributes that change with
 * the drum and wheel are touched afterwards, so dragging stays smooth.
 */
export class EyeReticle extends HTMLElement {
  static readonly observedAttributes = ['rxsph', 'rxcyl', 'rxaxis', 'power', 'axis'];

  #primaryGroup: SVGGElement | null = null;
  #secondaryGroup: SVGGElement | null = null;
  #primaryPath: SVGPathElement | null = null;
  #secondaryPath: SVGPathElement | null = null;
  #mires: SVGGElement | null = null;
  #frame = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.#render();
  }

  connectedCallback(): void {
    this.setAttribute('role', 'img');
    this.#update();
  }

  disconnectedCallback(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  attributeChangedCallback(_name: string, previous: string | null, next: string | null): void {
    if (previous !== next) this.#schedule();
  }

  /** The lens sitting in the instrument. */
  get lens(): Rx {
    return {
      sph: Number(this.getAttribute('rxsph')) || 0,
      cyl: Number(this.getAttribute('rxcyl')) || 0,
      axis: Number(this.getAttribute('rxaxis')) || 180,
    };
  }

  set lens(rx: Rx) {
    this.setAttribute('rxsph', String(rx.sph));
    this.setAttribute('rxcyl', String(rx.cyl));
    this.setAttribute('rxaxis', String(rx.axis));
  }

  get power(): number {
    return Number(this.getAttribute('power')) || 0;
  }

  set power(value: number) {
    this.setAttribute('power', String(value));
  }

  get axis(): number {
    return Number(this.getAttribute('axis')) || 180;
  }

  set axis(value: number) {
    this.setAttribute('axis', String(value));
  }

  /** Sharpness of each line set, 0-1, for the optional focus meter. */
  get sharpness(): { primary: number; secondary: number } {
    const state = defocus(this.lens, this.power, this.axis);
    return {
      primary: mireAppearance(state.primary).sharpness,
      secondary: mireAppearance(state.secondary).sharpness,
    };
  }

  /** Attributes can change several times per frame; redraw at most once. */
  #schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#update();
    });
  }

  #update(): void {
    const state = defocus(this.lens, this.power, this.axis);
    const primary = mireAppearance(state.primary);
    const secondary = mireAppearance(state.secondary);

    if (this.#primaryGroup && this.#primaryPath) {
      this.#primaryGroup.style.opacity = String(primary.opacity);
      this.#primaryGroup.style.filter = primary.filter;
      this.#primaryPath.setAttribute('stroke-width', primary.width.toFixed(2));
    }
    if (this.#secondaryGroup && this.#secondaryPath) {
      this.#secondaryGroup.style.opacity = String(secondary.opacity);
      this.#secondaryGroup.style.filter = secondary.filter;
      this.#secondaryPath.setAttribute('stroke-width', secondary.width.toFixed(2));
    }
    // The mires turn with the wheel, so the target the student is focusing
    // always lies square to the graticule they are reading it against.
    //
    // An SVG transform attribute rather than the CSS property: CSS rotation
    // resolves its origin against transform-box, which put the mires in the
    // corner of the field instead of across its centre. The attribute always
    // rotates about the user-space origin, which is the centre here.
    this.#mires?.setAttribute('transform', `rotate(${-this.axis})`);

    const focused = primary.crisp && secondary.crisp;
    this.setAttribute(
      'aria-label',
      focused
        ? 'Eyepiece: both sets of mires are sharp'
        : `Eyepiece: mires blurred, ${state.primary.toFixed(2)} and ${state.secondary.toFixed(
            2,
          )} dioptres out of focus`,
    );
  }

  #buildProtractor(): void {
    const protractor = this.shadowRoot?.querySelector('#protractor');
    if (!protractor) return;
    const fragment = document.createDocumentFragment();

    for (let degree = 0; degree <= 180; degree += 5) {
      const major = degree % 10 === 0;
      const tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('x1', '65');
      tick.setAttribute('x2', major ? '70' : '68');
      tick.setAttribute('y1', '0');
      tick.setAttribute('y2', '0');
      tick.setAttribute('class', 'grat-tick');
      tick.setAttribute('transform', `rotate(-${degree}, 0, 0)`);
      fragment.append(tick);

      if (major) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.textContent = String(degree === 0 ? 180 : degree);
        label.setAttribute('class', 'grat-label');
        label.setAttribute(
          'transform',
          `rotate(${-degree}, 0, 0) translate(78 0) rotate(${degree}, 0, 0)`,
        );
        fragment.append(label);
      }
    }
    protractor.append(fragment);
  }

  #render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        svg { height: 100%; width: 100%; display: block; }
        .mire-set {
          transition: opacity 160ms linear, filter 160ms linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .mire-set { transition: none; }
        }
        .mire {
          stroke: var(--mire-colour, greenyellow);
          fill: none;
          stroke-linecap: butt;
        }
        /*
         * The graticule is etched on glass and read against the lit field, so
         * it is black - the lamp behind it is what makes it legible.
         */
        .grat-tick { stroke: #0a0f05; stroke-width: 0.8; }
        .grat-label {
          dominant-baseline: middle;
          text-anchor: middle;
          font: 500 6px system-ui, sans-serif;
          fill: #0a0f05;
        }
        .grat-line { stroke: #0a0f05; stroke-width: 0.8; fill: none; }
        .grat-ring { stroke: rgba(10, 15, 5, 0.55); stroke-width: 0.7; fill: none; }
        .grat-number {
          dominant-baseline: middle;
          text-anchor: middle;
          font: 500 6px system-ui, sans-serif;
          fill: #0a0f05;
        }
        /*
         * The rim of the field stop. Stroke only - never give this a CSS
         * fill property, which beats a fill=none attribute on the element
         * and paints a solid disc straight over the field of view.
         */
        .bezel {
          fill: none;
          stroke: #000000;
          stroke-width: 5;
        }
      </style>
      <svg viewBox="-120 -120 240 240" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="field" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#547f18" />
            <stop offset="70%" stop-color="#4c7514" />
            <stop offset="100%" stop-color="#3f620f" />
          </radialGradient>
          <clipPath id="field-clip">
            <circle cx="0" cy="0" r="110" />
          </clipPath>
        </defs>

        <circle cx="0" cy="0" r="110" fill="url(#field)"></circle>

        <g clip-path="url(#field-clip)">
          <g id="mires">
            <g class="mire-set" id="primary-set">
              <path class="mire" id="primary"
                    d="M -120 4 L 120 4 M -120 0 L 120 0 M -120 -4 L 120 -4"
                    stroke-width="2"></path>
            </g>
            <g class="mire-set" id="secondary-set">
              <path class="mire" id="secondary"
                    d="M 20 -120 L 20 120 M 0 -120 L 0 120 M -20 -120 L -20 120"
                    stroke-width="2"></path>
            </g>
          </g>
        </g>

        <g id="protractor">
          <path class="grat-line" d="M -65 0 A 65 65 0 1 1 65 0"></path>
        </g>

        <g id="graticule">
          <circle class="grat-ring" cx="0" cy="0" r="20"></circle>
          <circle class="grat-ring" cx="0" cy="0" r="40"></circle>
          <circle class="grat-ring" cx="0" cy="0" r="60"></circle>
          <path class="grat-line" d="M -105 0 L -10 0 M 10 0 L 105 0"></path>
          <path class="grat-line" d="M 0 -15 L 0 -7 M 0 7 L 0 15"></path>
          <path class="grat-line"
                d="M 80 2.5 L 80 -2.5 M -80 2.5 L -80 -2.5 M 100 2.5 L 100 -2.5 M -100 2.5 L -100 -2.5"></path>
          <text class="grat-number" x="-25" y="6">1</text>
          <text class="grat-number" x="25" y="6">1</text>
          <text class="grat-number" x="-45" y="6">2</text>
          <text class="grat-number" x="45" y="6">2</text>
          <text class="grat-number" x="-65" y="6">3</text>
          <text class="grat-number" x="65" y="6">3</text>
          <text class="grat-number" x="-85" y="6">4</text>
          <text class="grat-number" x="85" y="6">4</text>
        </g>

        <!-- Rim of the field stop. -->
        <circle class="bezel" cx="0" cy="0" r="110"></circle>
      </svg>
    `;
    this.#primaryGroup = root.querySelector('#primary-set');
    this.#secondaryGroup = root.querySelector('#secondary-set');
    this.#primaryPath = root.querySelector('#primary');
    this.#secondaryPath = root.querySelector('#secondary');
    this.#mires = root.querySelector('#mires');
    this.#buildProtractor();
  }
}

customElements.define('eye-reticle', EyeReticle);

declare global {
  interface HTMLElementTagNameMap {
    'eye-reticle': EyeReticle;
  }
}
