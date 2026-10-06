import { PALETTE } from '../core/palette.js';

const MAX = 100;
const HUNGER_DECAY = MAX / 600; // 約10分で空腹ゲージが空になる
const THIRST_DECAY = MAX / 420; // 約7分で水分ゲージが空になる
const STARVE_DAMAGE = 1.5; // 空腹・水分のどちらかが 0 のとき毎秒減る HP
const REGEN = 0.5; // 空腹・水分が両方十分なとき毎秒回復する HP
const REGEN_THRESHOLD = 0.8;
const RAIN_THIRST = 0.5; // いちばん強い雨に打たれているときに、水分の減りを抑える割合

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

type VitalKey = 'hp' | 'hunger' | 'thirst';

export type VitalsSave = Record<VitalKey, number>;

const BARS: { key: VitalKey; label: string; color: number; icon: string }[] = [
  {
    key: 'hp',
    label: 'HP',
    color: PALETTE.accent,
    icon: '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/>',
  },
  {
    key: 'hunger',
    label: '空腹',
    color: PALETTE.sand,
    icon: '<path d="M14.5 3a6.5 6.5 0 0 1 0 13c-1 0-1.9-.2-2.7-.6l-3.3 3.3a2 2 0 1 1-2.6 2.6 2 2 0 1 1-1.7-3.2l3.3-3.3A6.5 6.5 0 0 1 14.5 3z"/>',
  },
  {
    key: 'thirst',
    label: '水分',
    color: PALETTE.water,
    icon: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  },
];

/** HP・空腹・水分の管理と、画面左下のゲージ表示 */
export class Vitals {
  hp = MAX;
  hunger = MAX;
  thirst = MAX;

  private readonly fills = {} as Record<VitalKey, HTMLElement>;
  private readonly rows = {} as Record<VitalKey, HTMLElement>;
  /** 空腹か水分が尽きて HP が減っている間、画面の縁を赤くする */
  private readonly hurtEl: HTMLElement;

  constructor() {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'vitals';
    for (const bar of BARS) {
      const row = document.createElement('div');
      row.className = 'vital';
      row.style.setProperty('--c', css(bar.color));
      row.innerHTML = `
        <svg class="vital-icon" viewBox="0 0 24 24" aria-label="${bar.label}">${bar.icon}</svg>
        <div class="vital-bar"><div class="vital-fill"></div></div>`;
      root.append(row);
      this.rows[bar.key] = row;
      this.fills[bar.key] = row.querySelector('.vital-fill')!;
    }
    this.hurtEl = document.createElement('div');
    this.hurtEl.className = 'vitals-hurt';
    document.body.append(root, this.hurtEl);
    this.render();
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** 空腹ゲージが満タンでなければ食べられる */
  get canEat(): boolean {
    return this.hunger < MAX;
  }

  get canDrink(): boolean {
    return this.thirst < MAX;
  }

  /** リスポーンしたときにすべて満タンに戻す */
  reset(): void {
    this.hp = this.hunger = this.thirst = MAX;
    this.render();
  }

  /** rain は打たれている雨の強さ（0〜1。屋根の下では 0）。雨に打たれている間は水分が減りにくい */
  update(dt: number, rain = 0): void {
    this.hunger = clamp(this.hunger - HUNGER_DECAY * dt);
    this.thirst = clamp(this.thirst - THIRST_DECAY * (1 - rain * RAIN_THIRST) * dt);
    if (this.hunger === 0 || this.thirst === 0) this.damage(STARVE_DAMAGE * dt);
    else if (this.hunger > MAX * REGEN_THRESHOLD && this.thirst > MAX * REGEN_THRESHOLD) {
      this.hp = clamp(this.hp + REGEN * dt);
    }
    this.render();
  }

  serialize(): VitalsSave {
    return { hp: this.hp, hunger: this.hunger, thirst: this.thirst };
  }

  restore(save: VitalsSave): void {
    for (const { key } of BARS) this[key] = clamp(save[key] ?? MAX);
    this.render();
  }

  damage(amount: number): void {
    this.hp = clamp(this.hp - amount);
  }

  heal(amount: number): void {
    this.hp = clamp(this.hp + amount);
  }

  eat(amount: number): void {
    this.hunger = clamp(this.hunger + amount);
  }

  drink(amount: number): void {
    this.thirst = clamp(this.thirst + amount);
  }

  private render(): void {
    for (const { key } of BARS) {
      const ratio = this[key] / MAX;
      this.fills[key].style.width = `${ratio * 100}%`;
      this.rows[key].classList.toggle('low', ratio < 0.2);
    }
    this.hurtEl.classList.toggle('show', this.hp > 0 && (this.hunger === 0 || this.thirst === 0));
  }
}

const clamp = (v: number) => Math.min(MAX, Math.max(0, v));

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .vitals {
      position: fixed; left: calc(16 * var(--u)); bottom: calc(16 * var(--u)); z-index: 5; pointer-events: none; user-select: none;
      display: flex; flex-direction: column; gap: calc(6 * var(--u));
      padding: calc(8 * var(--u)) calc(10 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.55);
    }
    .vital { display: flex; align-items: center; gap: calc(8 * var(--u)); }
    .vital-icon {
      width: calc(18 * var(--u)); height: calc(18 * var(--u)); fill: var(--c);
      filter: drop-shadow(0 1px 0 #2b2633);
    }
    .vital-bar {
      width: calc(160 * var(--u)); height: calc(10 * var(--u)); border-radius: calc(5 * var(--u)); overflow: hidden;
      background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    }
    .vital-fill { height: 100%; border-radius: calc(5 * var(--u)); background: var(--c); transition: width 0.2s linear; }
    .vital.low .vital-icon { animation: vital-blink 0.8s ease-in-out infinite; }
    @keyframes vital-blink { 50% { opacity: 0.25; } }
    .vitals-hurt {
      position: fixed; inset: 0; z-index: 4; pointer-events: none; opacity: 0; transition: opacity 0.6s;
      box-shadow: inset 0 0 calc(120 * var(--u)) calc(20 * var(--u)) ${css(PALETTE.accent)};
    }
    .vitals-hurt.show { opacity: 0.55; animation: vital-blink 1.6s ease-in-out infinite; }
  `;
  document.head.append(style);
}
