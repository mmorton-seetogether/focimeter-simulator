import { DIOPTRE_STEP, POWER_LIMIT, clamp, formatDioptres, roundToStep } from '../lib/optics.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG user units per dioptre on the drum face. */
const UNITS_PER_DIOPTRE = 20;

export interface PowerChangeDetail {
  power: number;
}

/**
 * The power drum.
 *
 * Driven four ways so it suits whatever the student has to hand: clicking a
 * zone (coarse outer, fine inner, as on the real knurled drum), dragging it
 * like a physical wheel, scrolling, and the arrow keys. Every route lands on
 * the 0.25 D grid.
 */
export class PowerDrum extends HTMLElement {
  static readonly observedAttributes = ['power'];

  #power = 0;
  #scale: SVGGElement | null = null;
  #svg: SVGSVGElement | null = null;
  #dragging = false;
  #pointerId: number | null = null;
  #dragStartY = 0;
  #dragStartPower = 0;
  #dragDistance = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.#render();
  }

  connectedCallback(): void {
    this.tabIndex = this.tabIndex === -1 ? 0 : this.tabIndex;
    this.setAttribute('role', 'slider');
    this.setAttribute('aria-label', 'Power drum');
    this.setAttribute('aria-valuemin', String(-POWER_LIMIT));
    this.setAttribute('aria-valuemax', String(POWER_LIMIT));
    this.setAttribute('aria-orientation', 'vertical');

    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerUp);
    this.addEventListener('pointercancel', this.#onPointerUp);
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#sync();
  }

  disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerUp);
    this.removeEventListener('pointercancel', this.#onPointerUp);
    this.removeEventListener('keydown', this.#onKeyDown);
    this.removeEventListener('wheel', this.#onWheel);
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (name === 'power' && previous !== next) {
      this.power = Number(next) || 0;
    }
  }

  get power(): number {
    return this.#power;
  }

  set power(value: number) {
    const next = clamp(roundToStep(Number(value) || 0), -POWER_LIMIT, POWER_LIMIT);
    if (next === this.#power) {
      this.#sync();
      return;
    }
    this.#power = next;
    this.#sync();
    this.#emit();
  }

  /** Move the drum by a number of dioptres, clamped to the instrument range. */
  step(delta: number): void {
    this.power = this.#power + delta;
  }

  #emit(): void {
    this.dispatchEvent(
      new CustomEvent<PowerChangeDetail>('power-change', {
        bubbles: true,
        composed: true,
        detail: { power: this.#power },
      }),
    );
  }

  #sync(): void {
    if (this.getAttribute('power') !== String(this.#power)) {
      this.setAttribute('power', String(this.#power));
    }
    this.setAttribute('aria-valuenow', String(this.#power));
    this.setAttribute('aria-valuetext', `${formatDioptres(this.#power)} dioptres`);
    this.#scale?.setAttribute('transform', `translate(0 ${this.#power * UNITS_PER_DIOPTRE})`);
  }

  /* ----------------------------- input ----------------------------- */

  /**
   * Click zones, measured against the rendered SVG rather than the host box -
   * the host can be wider than the visible drum, which used to swallow edge
   * clicks. Outer thirds move a whole dioptre, inner ones a quarter.
   */
  #zoneStep(clientY: number): number {
    const rect = this.#svg?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    const fraction = clamp((clientY - rect.top) / (rect.height / 2), 0, 2);
    if (fraction < 0.5) return 1;
    if (fraction < 1) return DIOPTRE_STEP;
    if (fraction < 1.5) return -DIOPTRE_STEP;
    return -1;
  }

  /** Dioptres per screen pixel, read from the live SVG transform. */
  #dioptresPerPixel(): number {
    const matrix = this.#svg?.getScreenCTM();
    if (!matrix || matrix.d === 0) return 0;
    return 1 / (UNITS_PER_DIOPTRE * matrix.d);
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.#dragging = true;
    this.#pointerId = event.pointerId;
    this.#dragStartY = event.clientY;
    this.#dragStartPower = this.#power;
    this.#dragDistance = 0;
    this.setPointerCapture(event.pointerId);
    this.shadowRoot?.querySelector('.container')?.classList.add('dragging');
    this.focus({ preventScroll: true });
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragging || event.pointerId !== this.#pointerId) return;
    const deltaY = event.clientY - this.#dragStartY;
    this.#dragDistance = Math.max(this.#dragDistance, Math.abs(deltaY));
    if (this.#dragDistance < 4) return;
    event.preventDefault();
    // Dragging down pulls higher plus powers into view, as on the instrument.
    this.power = this.#dragStartPower + deltaY * this.#dioptresPerPixel();
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (!this.#dragging || event.pointerId !== this.#pointerId) return;
    this.#dragging = false;
    this.#pointerId = null;
    this.shadowRoot?.querySelector('.container')?.classList.remove('dragging');
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    // A press that never really moved is a click on a zone, not a drag.
    if (this.#dragDistance < 4) this.step(this.#zoneStep(event.clientY));
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const size = event.shiftKey ? 1 : DIOPTRE_STEP;
    this.step(event.deltaY > 0 ? -size : size);
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    const fine = DIOPTRE_STEP;
    const coarse = 1;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        this.step(event.shiftKey ? coarse : fine);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        this.step(event.shiftKey ? -coarse : -fine);
        break;
      case 'PageUp':
        this.step(coarse);
        break;
      case 'PageDown':
        this.step(-coarse);
        break;
      case 'Home':
        this.power = 0;
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  /* ----------------------------- render ----------------------------- */

  #buildScale(): void {
    const scale = this.#scale;
    if (!scale) return;
    const fragment = document.createDocumentFragment();

    for (let dioptres = 0; dioptres <= POWER_LIMIT; dioptres += DIOPTRE_STEP) {
      const whole = dioptres % 1 === 0;
      for (const sign of [1, -1]) {
        // The plus half of the drum is printed black, the minus half red,
        // exactly as the scale on a real focimeter is engraved.
        const tick = document.createElementNS(SVG_NS, 'line');
        const y = -sign * dioptres * UNITS_PER_DIOPTRE;
        tick.setAttribute('x1', '-25');
        tick.setAttribute('x2', whole ? '0' : '-5');
        tick.setAttribute('y1', String(y));
        tick.setAttribute('y2', String(y));
        tick.setAttribute('class', sign > 0 ? 'tick plus' : 'tick minus');
        fragment.append(tick);

        if (whole) {
          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('x', '10');
          label.setAttribute('y', String(y));
          label.setAttribute('class', sign > 0 ? 'label plus' : 'label minus');
          label.textContent = String(dioptres);
          fragment.append(label);
        }
        if (dioptres === 0) break; // zero is printed once, not twice
      }
    }
    scale.replaceChildren(fragment);
  }

  #render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <style>
        :host {
          display: block;
          /* The face is out of flow, so the host has to claim the box itself. */
          width: 100%;
          height: 100%;
          cursor: ns-resize;
          touch-action: none;
          -webkit-tap-highlight-color: transparent;
        }
        :host(:focus-visible) { outline: none; }
        :host(:focus-visible) .container {
          box-shadow: 0 0 0 2px var(--focus-ring, #9ae600);
        }
        * { user-select: none; }
        .container {
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(90deg, #d6d8dc 0%, #ffffff 22%, #fbfbfc 60%, #c9ccd1 100%);
          border-radius: 3px;
          overflow: hidden;
        }
        /* Shading at both ends sells the curvature of a rotating drum. */
        .container::before,
        .container::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 34%;
          pointer-events: none;
          z-index: 2;
        }
        .container::before {
          top: 0;
          background-image: linear-gradient(to bottom, rgba(0,0,0,0.95), transparent);
        }
        .container::after {
          bottom: 0;
          background-image: linear-gradient(to top, rgba(0,0,0,0.95), transparent);
        }
        /*
         * Absolutely positioned so the drum face contributes no intrinsic
         * size: the viewBox is 1:8, and left in flow it would demand eight
         * times the column width in height and stretch the whole row.
         */
        svg {
          position: absolute;
          inset: 0;
          height: 100%;
          width: 100%;
          display: block;
        }
        #scale { transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1); }
        .dragging #scale { transition: none; }
        @media (prefers-reduced-motion: reduce) {
          #scale { transition: none; }
        }
        .tick { stroke-width: 1; }
        .tick.plus { stroke: #14161a; }
        .tick.minus { stroke: #c81e1e; }
        .label {
          dominant-baseline: middle;
          text-anchor: middle;
          font: 600 11px system-ui, sans-serif;
        }
        .label.plus { fill: #14161a; }
        .label.minus { fill: #c81e1e; }
        .index { fill: #14161a; }
      </style>
      <div class="container">
        <svg viewBox="-25 -200 50 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g id="scale"></g>
          <g class="index">
            <path d="M -25 -15 L -10 0 L -25 15 Z" />
          </g>
        </svg>
      </div>
    `;
    this.#svg = root.querySelector('svg');
    this.#scale = root.querySelector('#scale');
    this.#buildScale();
  }
}

customElements.define('power-drum', PowerDrum);

declare global {
  interface HTMLElementTagNameMap {
    'power-drum': PowerDrum;
  }
}
