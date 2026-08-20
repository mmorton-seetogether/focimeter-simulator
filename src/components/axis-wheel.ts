import { normaliseAxis } from '../lib/optics.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface AxisChangeDetail {
  axis: number;
}

/**
 * The axis wheel.
 *
 * Shows a 360 degree engraved rim numbered 1-180 twice over, exactly as the
 * instrument does, so the reading is the same whichever way round the student
 * turns it. Click zones step 10 / 5 / 1 degrees from the rim inwards; dragging
 * turns it continuously; arrow keys nudge it a degree at a time.
 */
export class AxisWheel extends HTMLElement {
  static readonly observedAttributes = ['axis'];

  #axis = 180;
  #scale: SVGGElement | null = null;
  #svg: SVGSVGElement | null = null;
  #dragging = false;
  #pointerId: number | null = null;
  #dragStartX = 0;
  #dragStartAxis = 0;
  #dragDistance = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.#render();
  }

  connectedCallback(): void {
    this.tabIndex = this.tabIndex === -1 ? 0 : this.tabIndex;
    this.setAttribute('role', 'slider');
    this.setAttribute('aria-label', 'Axis wheel');
    this.setAttribute('aria-valuemin', '1');
    this.setAttribute('aria-valuemax', '180');
    this.setAttribute('aria-orientation', 'horizontal');

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
    if (name === 'axis' && previous !== next) {
      this.axis = Number(next) || 180;
    }
  }

  get axis(): number {
    return this.#axis;
  }

  set axis(value: number) {
    const next = normaliseAxis(Number(value) || 0);
    if (next === this.#axis) {
      this.#sync();
      return;
    }
    this.#axis = next;
    this.#sync();
    this.#emit();
  }

  /** Turn the wheel by a number of degrees, wrapping through 180/1. */
  step(delta: number): void {
    this.axis = this.#axis + delta;
  }

  #emit(): void {
    this.dispatchEvent(
      new CustomEvent<AxisChangeDetail>('axis-change', {
        bubbles: true,
        composed: true,
        detail: { axis: this.#axis },
      }),
    );
  }

  #sync(): void {
    if (this.getAttribute('axis') !== String(this.#axis)) {
      this.setAttribute('axis', String(this.#axis));
    }
    this.setAttribute('aria-valuenow', String(this.#axis));
    this.setAttribute('aria-valuetext', `Axis ${this.#axis} degrees`);
    this.#scale?.setAttribute('transform', `rotate(${this.#axis})`);
  }

  /* ----------------------------- input ----------------------------- */

  /** Left of centre adds degrees, right subtracts; the rim is the coarse zone. */
  #zoneStep(clientX: number): number {
    const rect = this.#svg?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const fraction = Math.min(Math.max((clientX - rect.left) / (rect.width / 2), 0), 2);
    if (fraction < 1 / 3) return 10;
    if (fraction < 2 / 3) return 5;
    if (fraction < 1) return 1;
    if (fraction < 4 / 3) return -1;
    if (fraction < 5 / 3) return -5;
    return -10;
  }

  /** Degrees per screen pixel, taken from the wheel radius as drawn. */
  #degreesPerPixel(): number {
    const matrix = this.#svg?.getScreenCTM();
    if (!matrix || matrix.a === 0) return 0;
    const radiusInPixels = 100 * matrix.a;
    return radiusInPixels === 0 ? 0 : 180 / (Math.PI * radiusInPixels);
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.#dragging = true;
    this.#pointerId = event.pointerId;
    this.#dragStartX = event.clientX;
    this.#dragStartAxis = this.#axis;
    this.#dragDistance = 0;
    this.setPointerCapture(event.pointerId);
    this.shadowRoot?.querySelector('.container')?.classList.add('dragging');
    this.focus({ preventScroll: true });
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragging || event.pointerId !== this.#pointerId) return;
    const deltaX = event.clientX - this.#dragStartX;
    this.#dragDistance = Math.max(this.#dragDistance, Math.abs(deltaX));
    if (this.#dragDistance < 4) return;
    event.preventDefault();
    // Pushing the near edge of the wheel right turns the scale the other way.
    this.axis = this.#dragStartAxis - deltaX * this.#degreesPerPixel();
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (!this.#dragging || event.pointerId !== this.#pointerId) return;
    this.#dragging = false;
    this.#pointerId = null;
    this.shadowRoot?.querySelector('.container')?.classList.remove('dragging');
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    if (this.#dragDistance < 4) this.step(this.#zoneStep(event.clientX));
  };

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const size = event.shiftKey ? 10 : 1;
    this.step(event.deltaY > 0 ? -size : size);
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        this.step(event.shiftKey ? 10 : 1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        this.step(event.shiftKey ? -10 : -1);
        break;
      case 'PageUp':
        this.step(10);
        break;
      case 'PageDown':
        this.step(-10);
        break;
      case 'Home':
        this.axis = 180;
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

    for (let degree = 0; degree < 360; degree += 1) {
      const tick = document.createElementNS(SVG_NS, 'line');
      const major = degree % 10 === 0;
      const medium = degree % 5 === 0;
      tick.setAttribute('x1', '-80');
      tick.setAttribute('x2', major ? '-90' : medium ? '-87' : '-85');
      tick.setAttribute('class', major ? 'tick major' : 'tick');
      tick.setAttribute('transform', `rotate(${degree}, 0, 0)`);
      fragment.append(tick);

      if (major) {
        const label = document.createElementNS(SVG_NS, 'text');
        // The rim is numbered so the value under the pointer reads as an axis.
        label.textContent = String(((degree + 90) % 180) || 180);
        label.setAttribute(
          'transform',
          `rotate(${-degree}, 0, 0) translate(93, 0) rotate(90, 0, 0)`,
        );
        fragment.append(label);
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
          height: 100%;
          cursor: ew-resize;
          touch-action: none;
          -webkit-tap-highlight-color: transparent;
        }
        :host(:focus-visible) { outline: none; }
        :host(:focus-visible) .container {
          box-shadow: 0 0 0 2px var(--focus-ring, #9ae600);
          border-radius: 3px;
        }
        * { user-select: none; }
        .container { display: flex; height: 100%; justify-content: center; }
        svg { height: 100%; display: block; }
        #scale { transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1); }
        .dragging #scale { transition: none; }
        @media (prefers-reduced-motion: reduce) {
          #scale { transition: none; }
        }
        .tick { stroke: #2b2f36; stroke-width: 1; }
        .tick.major { stroke: #0d0f12; stroke-width: 1.4; }
        text {
          dominant-baseline: middle;
          text-anchor: middle;
          font: 600 7px system-ui, sans-serif;
          fill: #14161a;
        }
        .rim-outer { fill: #b9bec7; }
        .rim-inner { fill: #8b929c; }
        .pointer { stroke: #14161a; stroke-width: 1.2; }
        .lens { fill: rgba(120, 190, 255, 0.16); stroke: #2b2f36; stroke-width: 4; }
      </style>
      <div class="container">
        <svg viewBox="-110 -110 220 40" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
          <circle class="rim-outer" cx="0" cy="0" r="100"></circle>
          <circle class="rim-inner" cx="0" cy="0" r="80"></circle>
          <g id="scale"></g>
          <g>
            <line class="pointer" x1="0" x2="0" y1="0" y2="-85"></line>
            <circle class="lens" cx="0" cy="-85" r="20"></circle>
          </g>
        </svg>
      </div>
    `;
    this.#svg = root.querySelector('svg');
    this.#scale = root.querySelector('#scale');
    this.#buildScale();
  }
}

customElements.define('axis-wheel', AxisWheel);

declare global {
  interface HTMLElementTagNameMap {
    'axis-wheel': AxisWheel;
  }
}
