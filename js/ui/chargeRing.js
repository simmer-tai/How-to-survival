import { PALETTE } from '../core/palette.js';
// クロスヘアの周りに出す、円形のチャージメーター（槍を投げる力を溜めているときに出す）
const RING_SIZE = 40; // 輪の直径（var(--u) の倍数）
const RING_R = 15; // SVG の座標（40×40）での輪の半径
const RING_WIDTH = 3.5; // 輪の太さ（SVG の座標）
const CIRCUMFERENCE = 2 * Math.PI * RING_R;
const css = (c) => '#' + c.toString(16).padStart(6, '0');
export class ChargeRing {
    root;
    fill;
    constructor() {
        injectStyle();
        this.root = document.createElement('div');
        this.root.className = 'charge-ring hidden';
        this.root.innerHTML = `
      <svg viewBox="0 0 40 40">
        <circle class="track" cx="20" cy="20" r="${RING_R}" />
        <circle class="fill" cx="20" cy="20" r="${RING_R}" />
      </svg>`;
        this.fill = this.root.querySelector('.fill');
        this.fill.style.strokeDasharray = `${CIRCUMFERENCE}`;
        document.body.append(this.root);
    }
    /** 溜まった割合（0〜1）を出す。null なら隠す */
    set(charge) {
        this.root.classList.toggle('hidden', charge === null);
        if (charge === null)
            return;
        this.fill.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - charge)}`;
        this.root.classList.toggle('full', charge >= 1);
    }
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .charge-ring {
      position: fixed; left: 50%; top: 50%; pointer-events: none; z-index: 4;
      width: calc(${RING_SIZE} * var(--u)); height: calc(${RING_SIZE} * var(--u));
      margin: calc(${-RING_SIZE / 2} * var(--u)) 0 0 calc(${-RING_SIZE / 2} * var(--u));
    }
    .charge-ring.hidden { display: none; }
    .charge-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); } /* 真上から時計回りに溜まる */
    .charge-ring circle { fill: none; stroke-width: ${RING_WIDTH}; }
    .charge-ring .track { stroke: rgba(43, 38, 51, 0.55); }
    .charge-ring .fill { stroke: ${css(PALETTE.sand)}; stroke-linecap: round; }
    .charge-ring.full .fill { stroke: ${css(PALETTE.accent)}; }
  `;
    document.head.append(style);
}
