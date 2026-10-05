import { PALETTE } from '../core/palette.js';
// 画面左上の時計（何日目か・時刻・昼か夜か）
const STEP_MINUTES = 10; // 時刻はこの分単位で表示する（数字がちらちら変わらないように）
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const SUN_ICON = '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke-width="2" stroke-linecap="round"/>';
const MOON_ICON = '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>';
export class ClockHud {
    root;
    icon;
    text;
    shown = '';
    constructor() {
        injectStyle();
        this.root = document.createElement('div');
        this.root.className = 'clock hidden';
        this.root.innerHTML = '<svg class="clock-icon" viewBox="0 0 24 24"></svg><span class="clock-text"></span>';
        this.icon = this.root.querySelector('svg');
        this.text = this.root.querySelector('.clock-text');
        document.body.append(this.root);
    }
    set visible(v) {
        this.root.classList.toggle('hidden', !v);
    }
    update(day, hour, night) {
        const total = Math.floor((hour * 60) / STEP_MINUTES) * STEP_MINUTES;
        const label = `${day}日目 ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
        if (label + night === this.shown)
            return;
        this.shown = label + night;
        this.text.textContent = label;
        this.icon.innerHTML = night ? MOON_ICON : SUN_ICON;
        this.root.classList.toggle('night', night);
    }
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .clock {
      position: fixed; left: calc(16 * var(--u)); top: calc(16 * var(--u)); z-index: 5; pointer-events: none; user-select: none;
      display: flex; align-items: center; gap: calc(8 * var(--u));
      padding: calc(6 * var(--u)) calc(12 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.55);
      color: #fff; font-size: calc(15 * var(--u)); font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .clock.hidden { display: none; }
    .clock-icon {
      width: calc(18 * var(--u)); height: calc(18 * var(--u)); fill: ${css(PALETTE.sand)}; stroke: ${css(PALETTE.sand)};
      filter: drop-shadow(0 1px 0 #2b2633);
    }
    .clock.night .clock-icon { fill: ${css(PALETTE.sky)}; stroke: none; }
  `;
    document.head.append(style);
}
