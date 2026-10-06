import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { itemIcon } from '../items/itemIcons.js';
import type { ItemId } from '../items/inventory.js';
import { chartRandom, readChart, toldNames, type IslandChart } from '../items/islandChart.js';
import { LAND_NAMES, landInfoId } from '../items/landInfo.js';
import { keyGuide } from './keyGuide.js';

// 島の地図を広げる画面：島の地図（アイテム）を持って右クリックすると開く。左クリックで海図に書き写すと、その島へ船で渡れるようになる（書き写すのは main がワールドコマンドにする）。
// 描くのは、組み合わせたメモから描いた「予想図」だけ。本当に島にある地形（IslandChart.lands）は見せない。
// 島の形と、メモを書き込む場所は地図の種から決める（同じ地図なら、いつ広げても同じ絵）。見るだけの自分だけの UI

const RES = 320; // 地図の画像の解像度（px。表示は CSS で大きさを決める）
const VIEW_PX = 420; // 表示の大きさ（UI の単位）
const COAST_POINTS = 32; // 島の輪郭の点の数
const ISLAND_R = 0.3; // 島の大きさ（画像の幅に対する割合）
const COAST_WOBBLE = 0.28; // 輪郭のでこぼこの大きさ（島の大きさに対する割合）
const ICON_PX = 38; // 書き込むメモの絵の大きさ（画像の px）
const PAPER_TINT = 0.35; // 島と海の色を紙の色に寄せる割合（手描きらしく）

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const tinted = (c: number) => '#' + new THREE.Color(c).lerp(new THREE.Color(PALETTE.sand), PAPER_TINT).getHexString();

export class IslandChartView {
  isOpen = false;
  /** 開いた時刻（開いたのと同じ右クリックで閉じないように） */
  private openedAt = 0;
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly toldEl: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** メモの絵（読み込み終わったら描き直す） */
  private readonly icons = new Map<ItemId, HTMLImageElement>();
  private chart: IslandChart | null = null;
  /** 広げている島の地図の中身 */
  private code = 0;

  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** 左クリックで海図に書き写そうとしたときに呼ばれる（chart は島の地図の中身） */
  onCopy: (chart: number) => void = () => {};

  constructor() {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'islandchart';
    this.root.innerHTML = `
      <div class="islandchart-title"></div>
      <div class="islandchart-sheet"><canvas width="${RES}" height="${RES}"></canvas></div>
      <div class="islandchart-told"></div>
      <div class="islandchart-note">メモから描いた予想図。本当の姿は、渡ってみるまでわからない</div>
      <div class="islandchart-hint">${keyGuide('[左]：海図に書き写す ／ [右] [Esc]：たたむ')}</div>`;
    this.titleEl = this.root.querySelector<HTMLElement>('.islandchart-title')!;
    this.toldEl = this.root.querySelector<HTMLElement>('.islandchart-told')!;
    this.ctx = this.root.querySelector('canvas')!.getContext('2d')!;
    document.body.append(this.root);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (!this.isOpen || e.timeStamp <= this.openedAt) return;
      if (e.code === 'Escape') this.setOpen(false, false);
    });
    // 右クリックでたたんで、遊びに戻る。左クリックで海図に書き写す
    addEventListener('mousedown', (e) => {
      if (!this.isOpen || e.timeStamp <= this.openedAt) return;
      if (e.button === 2) this.setOpen(false);
      else if (e.button === 0) {
        this.setOpen(false);
        this.onCopy(this.code);
      }
    });
  }

  /** chart（スタックに入っている島の地図の中身）を広げる */
  open(chart: number): void {
    this.code = chart;
    this.chart = readChart(chart);
    this.titleEl.textContent = `${this.chart.name}の地図`;
    this.toldEl.textContent = `メモ：${toldNames(this.chart.told)}`;
    this.draw();
    this.setOpen(true);
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) this.openedAt = performance.now();
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  private draw(): void {
    const chart = this.chart;
    if (!chart) return;
    const ctx = this.ctx;
    const rand = chartRandom(chart.seed + 1); // 地形を決める乱数とは別の並びにする
    ctx.clearRect(0, 0, RES, RES);

    // 海と、うすい方眼
    ctx.fillStyle = tinted(PALETTE.sky);
    ctx.fillRect(0, 0, RES, RES);
    ctx.strokeStyle = 'rgba(43, 38, 51, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const v = (RES / 8) * i;
      ctx.beginPath();
      ctx.moveTo(v, 0);
      ctx.lineTo(v, RES);
      ctx.moveTo(0, v);
      ctx.lineTo(RES, v);
      ctx.stroke();
    }

    // 島：でこぼこの輪郭（いくつかの波を重ねる）。輪郭は確かでないので点線で描く
    const waves = [2, 3, 5].map((k) => ({ k, phase: rand() * Math.PI * 2, amp: rand() }));
    const sum = waves.reduce((n, w) => n + w.amp, 0) || 1;
    const cx = RES / 2;
    const cy = RES / 2;
    const radius = (a: number) => RES * ISLAND_R * (1 + (COAST_WOBBLE * waves.reduce((n, w) => n + w.amp * Math.sin(w.k * a + w.phase), 0)) / sum);
    ctx.beginPath();
    for (let i = 0; i <= COAST_POINTS; i++) {
      const a = (i / COAST_POINTS) * Math.PI * 2;
      const r = radius(a);
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = tinted(PALETTE.grass);
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = css(PALETTE.bark);
    ctx.stroke();
    ctx.setLineDash([]);

    // メモの地形を、島の中に「？」付きで書き込む（場所は均等にずらして、重ならないようにする）
    const start = rand() * Math.PI * 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    chart.told.forEach((kind, i) => {
      const a = start + (i / chart.told.length) * Math.PI * 2;
      const d = chart.told.length === 1 ? 0 : radius(a) * (0.45 + rand() * 0.15);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const icon = this.icon(landInfoId(kind));
      if (icon.complete && icon.naturalWidth > 0) ctx.drawImage(icon, x - ICON_PX / 2, y - ICON_PX / 2 - 6, ICON_PX, ICON_PX);
      label(ctx, `${LAND_NAMES[kind]}？`, x, y + ICON_PX / 2, 12, '#fff', '#2b2633');
    });

    // 方位の印（右上）：北は画面の上
    ctx.fillStyle = '#2b2633';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('N', RES - 22, 16);
    ctx.beginPath();
    ctx.moveTo(RES - 22, 26);
    ctx.lineTo(RES - 27, 42);
    ctx.lineTo(RES - 22, 38);
    ctx.lineTo(RES - 17, 42);
    ctx.closePath();
    ctx.fillStyle = css(PALETTE.accent);
    ctx.fill();
  }

  /** メモのアイコンの画像（初めてなら読み込み、読み込めたら描き直す） */
  private icon(id: ItemId): HTMLImageElement {
    let img = this.icons.get(id);
    if (!img) {
      img = new Image();
      img.onload = () => this.isOpen && this.draw();
      img.src = itemIcon(id);
      this.icons.set(id, img);
    }
    return img;
  }
}

/** 縁取りした文字 */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, edge: string): void {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = edge;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .islandchart {
      display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5;
      flex-direction: column; align-items: center; gap: calc(8 * var(--u));
      max-width: calc(100vw - 32px); color: #fff; user-select: none; text-align: center;
    }
    .islandchart.open { display: flex; }
    .islandchart-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.1em; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
    .islandchart-sheet {
      padding: calc(10 * var(--u)); border-radius: calc(6 * var(--u)); background: ${css(PALETTE.sand)};
      box-shadow: 0 0 0 calc(3 * var(--u)) ${css(PALETTE.trunk)}, 0 calc(6 * var(--u)) calc(18 * var(--u)) rgba(43, 38, 51, 0.5);
    }
    .islandchart-sheet canvas {
      display: block; width: calc(${VIEW_PX} * var(--u)); height: calc(${VIEW_PX} * var(--u));
      max-width: calc(100vw - 64px); max-height: calc(100vh - 200px); object-fit: contain; border-radius: calc(3 * var(--u));
    }
    .islandchart-told { font-size: calc(14 * var(--u)); font-weight: 700; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
    .islandchart-note, .islandchart-hint { font-size: calc(12 * var(--u)); opacity: 0.85; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
  `;
  document.head.append(style);
}
