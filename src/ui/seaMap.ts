import { PALETTE } from '../core/palette.js';
import { LOCATIONS, type LocationId } from '../world/location.js';
import { keyGuide } from './keyGuide.js';

// 海図：船で世界の端まで漕いでいくと開き、ほかの場所（島・街）を選んで船ごと渡る。
// 開くのも選ぶのも自分だけの UI。渡るのは main が船のワールドコマンド（sailBoat）にする

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const CHART_W = 520; // 海図の幅（UI の単位。高さは CHART_H）
const CHART_H = 340;

export class SeaMap {
  isOpen = false;
  /** 開いた時刻（開いたのと同じキーで閉じないように） */
  private openedAt = 0;
  private readonly root: HTMLElement;
  private readonly chart: HTMLElement;
  private here: LocationId = 'island';

  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** 行き先を選んだときに呼ばれる */
  onTravel: (to: LocationId) => void = () => {};

  constructor() {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'seamap';
    this.root.innerHTML = `
      <div class="seamap-title">海図</div>
      <div class="seamap-say">どこへ行こう？</div>
      <div class="seamap-chart"></div>
      <div class="seamap-hint">${keyGuide('[左]：行き先を選ぶ ／ [Esc]：閉じて漕ぎ続ける')}</div>`;
    this.chart = this.root.querySelector<HTMLElement>('.seamap-chart')!;
    document.body.append(this.root);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (!this.isOpen || e.timeStamp <= this.openedAt) return;
      if (e.code === 'Escape') this.setOpen(false, false);
    });
  }

  /** here は今いる場所 */
  open(here: LocationId): void {
    this.here = here;
    this.setOpen(true);
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) {
      this.openedAt = performance.now();
      this.render();
    }
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  private render(): void {
    this.chart.replaceChildren(
      ...Object.values(LOCATIONS).map((loc) => {
        const here = loc.id === this.here;
        const spot = document.createElement('button');
        spot.className = 'seamap-spot' + (here ? ' here' : '');
        spot.disabled = here;
        spot.style.left = `${loc.chart[0] * 100}%`;
        spot.style.top = `${loc.chart[1] * 100}%`;
        spot.style.setProperty('--size', String(loc.chartSize * CHART_W));
        spot.innerHTML =
          `<span class="seamap-land"></span>` +
          `<span class="seamap-name">${loc.name}</span>` +
          `<span class="seamap-tag">${here ? 'いまここ' : 'ここへ行く'}</span>`;
        spot.addEventListener('click', () => {
          this.setOpen(false);
          this.onTravel(loc.id);
        });
        return spot;
      }),
    );
  }
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .seamap {
      display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5;
      max-width: calc(100vw - 32px); box-sizing: border-box;
      padding: calc(14 * var(--u)) calc(18 * var(--u)); border-radius: calc(12 * var(--u)); background: rgba(43, 38, 51, 0.75);
      color: #fff; text-align: center; user-select: none;
    }
    .seamap.open { display: block; }
    .seamap-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.1em; }
    .seamap-say { font-size: calc(13 * var(--u)); opacity: 0.8; margin: calc(2 * var(--u)) 0 calc(10 * var(--u)); }
    .seamap-chart {
      position: relative; width: calc(${CHART_W} * var(--u)); height: calc(${CHART_H} * var(--u)); max-width: 100%;
      border-radius: calc(8 * var(--u)); overflow: hidden;
      background:
        repeating-linear-gradient(0deg, transparent 0 calc(39 * var(--u)), rgba(255, 255, 255, 0.12) calc(39 * var(--u)) calc(40 * var(--u))),
        repeating-linear-gradient(90deg, transparent 0 calc(39 * var(--u)), rgba(255, 255, 255, 0.12) calc(39 * var(--u)) calc(40 * var(--u))),
        ${css(PALETTE.water)};
    }
    .seamap-spot {
      position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center;
      gap: calc(4 * var(--u)); padding: 0; border: none; background: none; color: #fff; font: inherit; cursor: pointer;
    }
    .seamap-spot:disabled { cursor: default; }
    .seamap-land {
      width: calc(var(--size) * var(--u)); height: calc(var(--size) * 0.8 * var(--u));
      border-radius: 46% 54% 50% 50% / 55% 45% 55% 45%;
      background: radial-gradient(circle at 50% 50%, ${css(PALETTE.grass)} 0 48%, ${css(PALETTE.sand)} 52% 70%, ${css(PALETTE.sky)} 74%);
      box-shadow: 0 0 0 calc(3 * var(--u)) rgba(168, 220, 239, 0.35);
      transition: transform 0.12s;
    }
    .seamap-spot:not(:disabled):hover .seamap-land { transform: scale(1.08); }
    .seamap-name { font-size: calc(15 * var(--u)); font-weight: 700; text-shadow: 0 calc(1 * var(--u)) 0 #2b2633; }
    .seamap-tag {
      font-size: calc(12 * var(--u)); font-weight: 700; padding: calc(3 * var(--u)) calc(10 * var(--u)); border-radius: 999px;
      color: #2b2633; background: ${css(PALETTE.sand)};
    }
    .seamap-spot.here .seamap-tag { color: #fff; background: ${css(PALETTE.accent)}; }
    .seamap-hint { font-size: calc(12 * var(--u)); opacity: 0.8; margin-top: calc(10 * var(--u)); }

    /* 場所を移るときの暗転 */
    .travel-fade {
      position: fixed; inset: 0; z-index: 20; pointer-events: none; background: #2b2633; opacity: 0;
      transition: opacity 0.6s; display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: calc(22 * var(--u)); font-weight: 700; letter-spacing: 0.15em;
    }
    .travel-fade.show { opacity: 1; }
  `;
  document.head.append(style);
}

/** 画面を暗くしてから mid を呼び、名前を出したあとで明るく戻す（場所を移るときの演出） */
export function travelFade(name: string, mid: () => void): void {
  const el = document.createElement('div');
  el.className = 'travel-fade';
  el.textContent = name;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    mid();
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 700);
    }, 900);
  }, 650);
}
