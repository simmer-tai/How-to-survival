import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { WORLD_SIZE, type HeightField } from '../world/terrain.js';
import type { Platform } from '../world/props.js';
import { LOCATIONS, type LocationId } from '../world/location.js';
import { keyGuide } from './keyGuide.js';

// 地図：地図（アイテム）を持って右クリックすると広げ、今いる場所（島・街）を真上から見た図に、自分の位置と向きを描く。
// マルチでは同じ場所にいるほかの人の位置も描く。地図を見るのは自分だけの UI で、ワールドは変えない

const RES = 320; // 地図の画像の解像度（px。表示は CSS で大きさを決める）
const LAND_PAD = 14; // 陸地のまわりに、これだけ海を入れて切り取る（m）
const MIN_SPAN = 90; // 切り取る範囲の最小の幅（m。小さい島でも寄りすぎないように）
const SHALLOW = 1.5; // これより浅い海は明るい色にする（m）
const BEACH = 0.6; // これより低い陸は砂浜の色にする（m）
const ROCKY = 7; // これより高い陸は岩肌の色に寄せる（m）
const RELIEF = 1.6; // 斜面の陰影の強さ
const PAPER_TINT = 0.22; // 全体を紙の色に寄せる割合（古い地図らしく）
const VIEW_PX = 460; // 表示の大きさ（UI の単位）
const ARROW = 11; // 自分の矢印の大きさ（画像の px）

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const C = (c: number) => new THREE.Color(c);

/** 場所ごとの、地図に描く物 */
export interface MapSource {
  field: HeightField;
  /** 上に乗れる所（桟橋・広場など）。地図では塗りつぶす */
  platforms: Platform[];
  platformColor: number;
  /** 建物の形（真上から見た四隅） */
  buildings: THREE.Vector3[][];
  /** 名前を書く所 */
  marks: { name: string; x: number; z: number }[];
}

/** 地図を開いている間に描く、動く物 */
export interface MapView {
  /** 自分の位置と、見ている向き（水平の単位ベクトル） */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** 同じ場所にいるほかの人 */
  others: { name: string; x: number; z: number }[];
}

/** 焼いた地図（地形・桟橋・建物）と、切り取った範囲 */
interface Baked { image: HTMLCanvasElement; x0: number; z0: number; span: number }

export class AreaMap {
  isOpen = false;
  /** 開いた時刻（開いたのと同じ右クリックで閉じないように） */
  private openedAt = 0;
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sources = new Map<LocationId, MapSource>();
  private readonly baked = new Map<LocationId, Baked>();
  private here: LocationId = 'island';

  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};

  constructor() {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'areamap';
    this.root.innerHTML = `
      <div class="areamap-title"></div>
      <div class="areamap-sheet"><canvas width="${RES}" height="${RES}"></canvas></div>
      <div class="areamap-hint">${keyGuide('[右] [Esc]：たたむ')}</div>`;
    this.titleEl = this.root.querySelector<HTMLElement>('.areamap-title')!;
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    document.body.append(this.root);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (!this.isOpen || e.timeStamp <= this.openedAt) return;
      if (e.code === 'Escape') this.setOpen(false, false);
    });
    // 右クリックでたたんで、遊びに戻る
    addEventListener('mousedown', (e) => {
      if (this.isOpen && e.button === 2 && e.timeStamp > this.openedAt) this.setOpen(false);
    });
  }

  /** 場所ごとの地図の中身を登録する（画像は初めて開いたときに焼く） */
  addSource(loc: LocationId, source: MapSource): void {
    this.sources.set(loc, source);
  }

  /** here の地図を広げる */
  open(here: LocationId, view: MapView): void {
    this.here = here;
    this.titleEl.textContent = `${LOCATIONS[here].name}の地図`;
    this.setOpen(true);
    this.update(view);
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) this.openedAt = performance.now();
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  /** 開いている間、毎フレーム呼んで自分とほかの人の位置を描き直す */
  update(view: MapView): void {
    if (!this.isOpen) return;
    const map = this.bake(this.here);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, RES, RES);
    if (!map) return;
    ctx.drawImage(map.image, 0, 0);
    const px = (x: number) => ((x - map.x0) / map.span) * RES;
    const pz = (z: number) => ((z - map.z0) / map.span) * RES;

    // 名前を書く所
    const source = this.sources.get(this.here)!;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const m of source.marks) label(ctx, m.name, px(m.x), pz(m.z), 12, css(PALETTE.sand), '#2b2633');

    // ほかの人：小さな丸と名前
    for (const o of view.others) {
      const x = px(o.x);
      const y = pz(o.z);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = css(PALETTE.sky);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2b2633';
      ctx.stroke();
      label(ctx, o.name, x, y - 12, 11, '#fff', '#2b2633');
    }

    // 自分：向きを指す矢印（地図の外にいれば縁に寄せる）
    const x = THREE.MathUtils.clamp(px(view.x), ARROW, RES - ARROW);
    const y = THREE.MathUtils.clamp(pz(view.z), ARROW, RES - ARROW);
    const a = Math.atan2(view.dz, view.dx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(ARROW, 0);
    ctx.lineTo(-ARROW * 0.7, ARROW * 0.65);
    ctx.lineTo(-ARROW * 0.35, 0);
    ctx.lineTo(-ARROW * 0.7, -ARROW * 0.65);
    ctx.closePath();
    ctx.fillStyle = css(PALETTE.accent);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2b2633';
    ctx.stroke();
    ctx.restore();
  }

  /** 場所の地図を焼く（一度焼いたら取っておく） */
  private bake(loc: LocationId): Baked | null {
    const done = this.baked.get(loc);
    if (done) return done;
    const source = this.sources.get(loc);
    if (!source) return null;
    const { field } = source;
    const half = WORLD_SIZE / 2;

    // 陸地の範囲を調べて、まわりに少し海を入れた正方形に切り取る
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let z = -half; z <= half; z += 2) {
      for (let x = -half; x <= half; x += 2) {
        if (field.height(x, z) < 0) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    if (minX > maxX) [minX, maxX, minZ, maxZ] = [-half, half, -half, half];
    const span = Math.min(WORLD_SIZE, Math.max(MIN_SPAN, maxX - minX + LAND_PAD * 2, maxZ - minZ + LAND_PAD * 2));
    const x0 = THREE.MathUtils.clamp((minX + maxX) / 2 - span / 2, -half, half - span);
    const z0 = THREE.MathUtils.clamp((minZ + maxZ) / 2 - span / 2, -half, half - span);

    const image = document.createElement('canvas');
    image.width = RES;
    image.height = RES;
    const ctx = image.getContext('2d')!;
    const data = ctx.createImageData(RES, RES);
    const paper = C(PALETTE.sand);
    const deep = C(PALETTE.water).multiplyScalar(0.8);
    const shallow = C(PALETTE.water).lerp(C(PALETTE.sky), 0.55);
    const sand = C(PALETTE.sand);
    const grass = C(PALETTE.grass);
    const rock = C(PALETTE.rock);
    const c = new THREE.Color();
    const step = span / RES;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = x0 + (i + 0.5) * step;
        const z = z0 + (j + 0.5) * step;
        const h = field.height(x, z);
        if (h < 0) {
          c.copy(shallow).lerp(deep, THREE.MathUtils.smoothstep(-h, 0, SHALLOW * 3));
          if (-h < 0.25) c.lerp(C(PALETTE.sky), 0.5); // 波打ち際
        } else {
          c.copy(h < BEACH ? sand : grass);
          if (h > ROCKY) c.lerp(rock, THREE.MathUtils.clamp((h - ROCKY) / 6, 0, 0.7));
          // 北西から光が当たっているように、斜面に陰影を付ける
          const gx = field.height(x + step, z) - field.height(x - step, z);
          const gz = field.height(x, z + step) - field.height(x, z - step);
          c.multiplyScalar(THREE.MathUtils.clamp(1 + (-(gx + gz) / (2 * step)) * 0.25 * RELIEF, 0.7, 1.2));
        }
        c.lerp(paper, PAPER_TINT);
        // THREE.Color は線形の値なので、画面に出す sRGB に直してから書く
        const k = (j * RES + i) * 4;
        data.data[k] = toByte(c.r);
        data.data[k + 1] = toByte(c.g);
        data.data[k + 2] = toByte(c.b);
        data.data[k + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);

    const px = (x: number) => ((x - x0) / span) * RES;
    const pz = (z: number) => ((z - z0) / span) * RES;
    // 桟橋・広場
    ctx.fillStyle = css(source.platformColor);
    for (const p of source.platforms) ctx.fillRect(px(p.minX), pz(p.minZ), px(p.maxX) - px(p.minX), pz(p.maxZ) - pz(p.minZ));
    // 建物
    ctx.lineJoin = 'round';
    for (const b of source.buildings) {
      ctx.beginPath();
      b.forEach((v, n) => (n === 0 ? ctx.moveTo(px(v.x), pz(v.z)) : ctx.lineTo(px(v.x), pz(v.z))));
      ctx.closePath();
      ctx.fillStyle = css(PALETTE.bark);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2b2633';
      ctx.stroke();
    }
    // 方位の印（右上）：北は画面の上
    ctx.fillStyle = '#2b2633';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', RES - 22, 16);
    ctx.beginPath();
    ctx.moveTo(RES - 22, 26);
    ctx.lineTo(RES - 27, 42);
    ctx.lineTo(RES - 22, 38);
    ctx.lineTo(RES - 17, 42);
    ctx.closePath();
    ctx.fillStyle = css(PALETTE.accent);
    ctx.fill();

    const baked = { image, x0, z0, span };
    this.baked.set(loc, baked);
    return baked;
  }
}

/** THREE.Color の値（線形）を、画像に書く sRGB の 0〜255 にする */
function toByte(v: number): number {
  const l = THREE.MathUtils.clamp(v, 0, 1);
  const s = THREE.ColorManagement.enabled ? (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055) : l;
  return Math.round(s * 255);
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
    .areamap {
      display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5;
      flex-direction: column; align-items: center; gap: calc(8 * var(--u));
      max-width: calc(100vw - 32px); color: #fff; user-select: none;
    }
    .areamap.open { display: flex; }
    .areamap-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.1em; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
    .areamap-sheet {
      padding: calc(10 * var(--u)); border-radius: calc(6 * var(--u)); background: ${css(PALETTE.sand)};
      box-shadow: 0 0 0 calc(3 * var(--u)) ${css(PALETTE.trunk)}, 0 calc(6 * var(--u)) calc(18 * var(--u)) rgba(43, 38, 51, 0.5);
    }
    .areamap-sheet canvas {
      display: block; width: calc(${VIEW_PX} * var(--u)); height: calc(${VIEW_PX} * var(--u));
      max-width: calc(100vw - 64px); max-height: calc(100vh - 140px); object-fit: contain; border-radius: calc(3 * var(--u));
    }
    .areamap-hint { font-size: calc(12 * var(--u)); opacity: 0.85; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
  `;
  document.head.append(style);
}
