import { DIOPTRE_STEP, POWER_LIMIT, clamp, normaliseAxis, round2, type Rx } from '../lib/optics.ts';

export interface RxInputDetail {
  value: Rx;
}

type FieldName = 'sph' | 'cyl' | 'axis';

/**
 * Three stepped number fields making up a prescription.
 *
 * Rendered in the light DOM on purpose: it is a form, so it should inherit the
 * page styles, take part in the normal tab order, and be reachable by the
 * browser's own autofill and zoom behaviour.
 *
 * Used twice - to set the lens in explore mode, and to take the student's
 * answer in practice mode.
 */
export class RxFields extends HTMLElement {
  #value: Rx = { sph: 0, cyl: 0, axis: 180 };
  #inputs = new Map<FieldName, HTMLInputElement>();
  #built = false;

  connectedCallback(): void {
    if (!this.#built) {
      this.#build();
      this.#built = true;
    }
    this.#sync();
  }

  get value(): Rx {
    return { ...this.#value };
  }

  set value(rx: Rx) {
    this.#value = {
      sph: clamp(round2(rx.sph), -POWER_LIMIT, POWER_LIMIT),
      cyl: clamp(round2(rx.cyl), -POWER_LIMIT, POWER_LIMIT),
      axis: normaliseAxis(rx.axis),
    };
    this.#sync();
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }

  set disabled(value: boolean) {
    this.toggleAttribute('disabled', value);
    for (const input of this.#inputs.values()) input.disabled = value;
    for (const button of this.querySelectorAll('button')) button.disabled = value;
  }

  /** Move keyboard focus to the first field, for "next lens" flows. */
  focusFirst(): void {
    this.#inputs.get('sph')?.focus();
  }

  #emit(): void {
    this.dispatchEvent(
      new CustomEvent<RxInputDetail>('rx-input', {
        bubbles: true,
        detail: { value: this.value },
      }),
    );
  }

  #sync(): void {
    const sph = this.#inputs.get('sph');
    const cyl = this.#inputs.get('cyl');
    const axis = this.#inputs.get('axis');
    if (sph) sph.value = this.#value.sph.toFixed(2);
    if (cyl) cyl.value = this.#value.cyl.toFixed(2);
    if (axis) axis.value = String(this.#value.axis);
    // An axis has no meaning without a cylinder, so it is greyed out for a sphere.
    const spherical = this.#value.cyl === 0;
    this.querySelector('.rx-field--axis')?.classList.toggle('is-muted', spherical);
    if (axis) axis.setAttribute('aria-disabled', String(spherical));
  }

  #set(field: FieldName, raw: number): void {
    const next = { ...this.#value };
    if (field === 'axis') {
      next.axis = normaliseAxis(raw);
    } else {
      next[field] = clamp(round2(raw), -POWER_LIMIT, POWER_LIMIT);
    }
    this.#value = next;
    this.#sync();
    this.#emit();
  }

  #build(): void {
    const idBase = `rx-${Math.random().toString(36).slice(2, 8)}`;
    this.classList.add('rx-fields');
    this.innerHTML = `
      ${field('sph', 'Sphere', 'DS', DIOPTRE_STEP, idBase)}
      ${field('cyl', 'Cylinder', 'DC', DIOPTRE_STEP, idBase)}
      ${field('axis', 'Axis', 'deg', 1, idBase)}
    `;

    for (const name of ['sph', 'cyl', 'axis'] as const) {
      const input = this.querySelector<HTMLInputElement>(`#${idBase}-${name}`);
      if (!input) continue;
      this.#inputs.set(name, input);

      input.addEventListener('input', () => {
        const parsed = Number.parseFloat(input.value);
        if (Number.isNaN(parsed)) return;
        // While typing, take the raw number: normalising mid-keystroke would
        // fight the student as they type "-1" on the way to "-1.25".
        const next = { ...this.#value };
        if (name === 'axis') next.axis = Math.round(parsed);
        else next[name] = parsed;
        this.#value = next;
        this.#emit();
      });

      input.addEventListener('change', () => {
        const parsed = Number.parseFloat(input.value);
        this.#set(name, Number.isNaN(parsed) ? 0 : parsed);
      });
    }

    this.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
      if (!button) return;
      event.preventDefault();
      const name = button.dataset.field as FieldName;
      const delta = Number(button.dataset.step);
      this.#set(name, this.#value[name] + delta);
    });
  }
}

function field(
  name: FieldName,
  label: string,
  unit: string,
  step: number,
  idBase: string,
): string {
  const id = `${idBase}-${name}`;
  const numeric =
    name === 'axis'
      ? 'min="1" max="180" step="1" inputmode="numeric"'
      : `min="-${POWER_LIMIT}" max="${POWER_LIMIT}" step="${step}" inputmode="decimal"`;
  return `
    <div class="rx-field rx-field--${name}">
      <label class="rx-field__label" for="${id}">${label} <span class="rx-field__unit">${unit}</span></label>
      <div class="rx-field__control">
        <button type="button" class="rx-step" data-field="${name}" data-step="${-step}"
                aria-label="Decrease ${label.toLowerCase()}">&minus;</button>
        <input class="rx-input" id="${id}" name="${name}" type="number" ${numeric} autocomplete="off" />
        <button type="button" class="rx-step" data-field="${name}" data-step="${step}"
                aria-label="Increase ${label.toLowerCase()}">+</button>
      </div>
    </div>
  `;
}

customElements.define('rx-fields', RxFields);

declare global {
  interface HTMLElementTagNameMap {
    'rx-fields': RxFields;
  }
}
