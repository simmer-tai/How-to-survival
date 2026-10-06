import * as THREE from 'three';
import {
  ACCENT, BALL, BARK, BOX, Batch, CYL, LEAF, MORTAR, PRISM, ROCK, SAND, TRUNK, WATER,
  backSide, colliderBox, faceBox, faceNormal, facePoint3, stoneColor, type Face,
} from './townKit.js';

// 街の家。1階は石積み、2階は外へ張り出した木組みの漆喰壁、その上に急な石板ぶきの切妻屋根がのる。
// 屋根には小さな屋根窓と石の煙突が付く。
// 家の中で組み立て（原点は1階の床の真ん中、妻側の正面が +Z、棟は Z に沿う）、置く位置と向きは buildHouse に渡す。
// 形は固定シードの乱数で決めるので、誰の画面でも同じになる

// ---- 大きさ ----
const W = 6; // 1階の幅（X）
const D = 7.2; // 1階の奥行き（Z）
const PLINTH_H = 0.4; // 1階の足元の、少し張り出した土台の石の高さ
const GF_H = 2.8; // 1階の壁の高さ
const COURSE = 0.4; // 1階の石積みの1段の高さ
const BLOCK_MIN = 0.55; // 1階の石の長さ（最小・最大）
const BLOCK_MAX = 1.1;
const JOINT = 0.05; // 石と石のすきま（目地）
const BAND = 0.3; // 1階と2階の間の梁の帯の高さ
const JETTY = 0.4; // 2階が1階より外へ張り出す長さ
const UF_H = 2.4; // 2階の壁の高さ
const GABLE_JETTY = 0.2; // 妻の三角の壁が2階よりさらに張り出す長さ
const BAY = 1.3; // 2階の木組みの柱と柱の間隔（目安）
const TIMBER = 0.16; // 木組みの角材の太さ
const EAVE_TUCK = 0.14; // 軒の下の面の木組みを、壁の上端からどれだけ下で止めるか
const UNDER_ROOF = 0.22; // 妻の三角の壁を、屋根の面からどれだけ内側に引っ込めるか（石板の間から見えないように）

// ---- 屋根 ----
const PITCH = THREE.MathUtils.degToRad(56); // 屋根の傾き
const EAVE_OVER = 0.45; // 軒が壁より外へ出る長さ
const GABLE_OVER = 0.35; // 屋根が妻の壁より外へ出る長さ
const TILE_ROW = 0.34; // 石板の1段の間隔（屋根の斜面に沿って）
const TILE_MIN = 0.34; // 石板の幅（最小・最大）
const TILE_MAX = 0.5;

// ---- 屋根窓（広い側の斜面の真ん中） ----
const DORMER_W = 1.8; // 屋根窓の幅
const DORMER_SET = 0.7; // 屋根窓の正面が、2階の壁からどれだけ奥にあるか
const DORMER_WALL = 1.25; // 屋根窓の正面の壁の高さ（屋根の面から）
const DORMER_PITCH = THREE.MathUtils.degToRad(50); // 屋根窓の小さな屋根の傾き

const HOUSE_SEED = 777; // 石や石板の大きさ・色のばらつきを決める乱数のシード

/** 家を置く位置（1階の床の真ん中）と向き（Y 軸まわり。0 なら妻側の正面が +Z を向く） */
export interface HouseSpot { x: number; y: number; z: number; yaw: number }

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 色 ----
const PLASTER = SAND.clone().lerp(ROCK, 0.18); // 漆喰の壁
const BEAM = BARK.clone().multiplyScalar(0.75); // 木組みの濃い角材
const GLASS = WATER.clone().lerp(BARK, 0.55).multiplyScalar(0.45); // 窓ガラス（暗い）
const SHUTTER = LEAF.clone().lerp(WATER, 0.3).multiplyScalar(0.8); // 窓の板戸
const SLATE = ROCK.clone().lerp(WATER, 0.3).multiplyScalar(0.72); // 屋根の石板
const POT = ACCENT.clone().lerp(TRUNK, 0.5); // 煙突の素焼きの筒

const UP = new THREE.Vector3(0, 1, 0);

/** 石の色（1階の壁）。窓の縁や角の石は少し明るい */
const wallStone = (rand: () => number, k = 0.85) => stoneColor(rand, k);
const trimStone = (rand: () => number) => stoneColor(rand, 1.05).lerp(SAND, 0.12);

// ---- 1階：石積み ----

/** 壁の穴（窓・戸口）。along は a〜e、高さは y0〜y1 */
interface Opening { a: number; e: number; y0: number; y1: number; door?: boolean; flowers?: boolean }

/** 穴のまわりで石を積まない範囲（窓台と、上のまぐさ石のぶん広い） */
const clipOf = (o: Opening) => ({ a: o.a - 0.14, e: o.e + 0.14, y0: o.door ? 0 : o.y0 - 0.14, y1: o.y1 + 0.3 });

/** [a, e] から cuts の範囲を除いた残りの区間 */
function subtract(a: number, e: number, cuts: { a: number; e: number }[]): [number, number][] {
  let parts: [number, number][] = [[a, e]];
  for (const c of cuts) {
    const next: [number, number][] = [];
    for (const [pa, pe] of parts) {
      if (c.e <= pa || c.a >= pe) next.push([pa, pe]);
      else {
        if (c.a > pa) next.push([pa, c.a]);
        if (c.e < pe) next.push([c.e, pe]);
      }
    }
    parts = next;
  }
  return parts;
}

/** 石を1つ置く（面から少しずつ違う量だけ出っ張らせる） */
function stone(b: Batch, rand: () => number, f: Face, a: number, e: number, y0: number, y1: number, color: THREE.Color): void {
  if (e - a < 0.12 || y1 - y0 < 0.06) return;
  faceBox(b, f, a + JOINT / 2, e - JOINT / 2, y0 + JOINT / 2, y1 - JOINT / 2, -0.2, 0.04 + rand() * 0.06, color, [backSide(f)]);
}

/** 1階の壁の面に、段ごとに長さの違う石を積む。穴のまわりは空けておく */
function stoneWall(b: Batch, rand: () => number, f: Face, openings: Opening[]): void {
  const clips = openings.map(clipOf);
  // 土台：大きめの暗い石を一段、少し張り出して並べる
  const doorCuts = clips.filter((c) => c.y0 < PLINTH_H);
  for (let s = f.from; s < f.to - 0.05; ) {
    const len = 0.8 + rand() * 0.6;
    for (const [a, e] of subtract(s, Math.min(s + len, f.to), doorCuts)) {
      if (e - a > 0.12) faceBox(b, f, a + JOINT / 2, e - JOINT / 2, 0, PLINTH_H, -0.2, 0.14, wallStone(rand, 0.7), ['ny', backSide(f)]);
    }
    s += len;
  }
  // 石積み
  for (let y0 = PLINTH_H, row = 0; y0 < GF_H - 0.05; y0 += COURSE, row++) {
    const y1 = Math.min(y0 + COURSE, GF_H);
    const cuts = clips.filter((c) => c.y0 < y1 && c.y1 > y0);
    for (let s = f.from - (row % 2) * BLOCK_MIN * 0.5; s < f.to; ) {
      const len = BLOCK_MIN + rand() * (BLOCK_MAX - BLOCK_MIN);
      for (const [a, e] of subtract(Math.max(s, f.from), Math.min(s + len, f.to), cuts)) stone(b, rand, f, a, e, y0, y1, wallStone(rand));
      s += len;
    }
    // 穴の上下にかかる段は、穴の幅のぶんを薄い石で埋める
    for (const c of cuts) {
      if (c.y0 > y0) stone(b, rand, f, c.a, c.e, y0, c.y0, wallStone(rand));
      if (c.y1 < y1) stone(b, rand, f, c.a, c.e, c.y1, y1, wallStone(rand));
    }
  }
  for (const o of openings) (o.door ? door : stoneWindow)(b, rand, f, o);
}

/** 家の四隅に、長い石と短い石を段ごとに互い違いに積む（隅石） */
function quoins(b: Batch, rand: () => number): void {
  const hx = W / 2;
  const hz = D / 2;
  for (let y0 = PLINTH_H, row = 0; y0 < GF_H - 0.05; y0 += COURSE, row++) {
    const y1 = Math.min(y0 + COURSE, GF_H) - JOINT / 2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const long = (row + (sx * sz > 0 ? 0 : 1)) % 2 === 0;
        const lenZ = long ? 0.6 : 0.35; // 妻側（Z の面）に見える長さ
        const lenX = long ? 0.35 : 0.6; // 平側（X の面）に見える長さ
        const c = trimStone(rand);
        const [xa, xb] = [sx * (hx - lenZ), sx * (hx + 0.14)];
        const [za, zb] = [sz * (hz - 0.2), sz * (hz + 0.14)];
        b.box(Math.min(xa, xb), y0 + JOINT / 2, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), c);
        const [xc, xd] = [sx * (hx - 0.2), sx * (hx + 0.14)];
        const [zc, zd] = [sz * (hz - lenX), sz * (hz + 0.14)];
        b.box(Math.min(xc, xd), y0 + JOINT / 2, Math.min(zc, zd), Math.max(xc, xd), y1, Math.max(zc, zd), c);
      }
    }
  }
}

/** 窓ガラスと、それを十字に区切る木の枠 */
function windowPane(b: Batch, f: Face, a: number, e: number, y0: number, y1: number, frame: THREE.Color): void {
  faceBox(b, f, a, e, y0, y1, -0.05, 0.015, GLASS, [backSide(f)]);
  const t = 0.07;
  faceBox(b, f, a, a + t, y0, y1, 0, 0.06, frame, [backSide(f)]);
  faceBox(b, f, e - t, e, y0, y1, 0, 0.06, frame, [backSide(f)]);
  faceBox(b, f, a, e, y0, y0 + t, 0, 0.06, frame, [backSide(f)]);
  faceBox(b, f, a, e, y1 - t, y1, 0, 0.06, frame, [backSide(f)]);
  const mid = (a + e) / 2;
  faceBox(b, f, mid - 0.025, mid + 0.025, y0, y1, 0, 0.04, frame, [backSide(f)]);
  const my = y0 + (y1 - y0) * 0.55;
  faceBox(b, f, a, e, my - 0.025, my + 0.025, 0, 0.04, frame, [backSide(f)]);
}

/** 1階の窓：石の窓台とまぐさ石、両わきに開いた板戸。flowers なら窓台の下に花の箱を付ける */
function stoneWindow(b: Batch, rand: () => number, f: Face, o: Opening): void {
  windowPane(b, f, o.a, o.e, o.y0, o.y1, BEAM);
  faceBox(b, f, o.a - 0.12, o.e + 0.12, o.y0 - 0.12, o.y0, -0.2, 0.2, trimStone(rand), [backSide(f)]); // 窓台
  faceBox(b, f, o.a - 0.14, o.e + 0.14, o.y1, o.y1 + 0.3, -0.2, 0.14, trimStone(rand), [backSide(f)]); // まぐさ石
  // 板戸：縦の板に、横の桟を2本
  const sw = (o.e - o.a) / 2;
  for (const [a, e] of [[o.a - 0.16 - sw, o.a - 0.16], [o.e + 0.16, o.e + 0.16 + sw]]) {
    faceBox(b, f, a, e, o.y0 - 0.02, o.y1 + 0.02, 0.1, 0.15, SHUTTER, [backSide(f)]);
    for (const y of [o.y0 + 0.2, o.y1 - 0.2]) faceBox(b, f, a + 0.04, e - 0.04, y - 0.04, y + 0.04, 0.15, 0.18, SHUTTER.clone().multiplyScalar(0.8), [backSide(f)]);
  }
  if (!o.flowers) return;
  // 花の箱：葉の上に赤と黄色の花を散らす
  const top = o.y0 - 0.16;
  faceBox(b, f, o.a - 0.05, o.e + 0.05, top - 0.26, top, 0.2, 0.46, TRUNK, [backSide(f)]);
  const n = Math.round((o.e - o.a) / 0.13);
  for (let i = 0; i <= n; i++) {
    const s = o.a + ((o.e - o.a) * i) / n;
    const p = facePoint3(f, s, top + 0.05, 0.33 + (rand() - 0.5) * 0.1);
    b.add(BALL, p.x, p.y, p.z, 0.11, 0.09, 0.11, LEAF.clone().multiplyScalar(0.85 + rand() * 0.3), rand() * 3);
    if (i % 2 === 1 || rand() < 0.3) {
      const q = facePoint3(f, s + (rand() - 0.5) * 0.1, top + 0.15 + rand() * 0.05, 0.3 + rand() * 0.12);
      b.add(BALL, q.x, q.y, q.z, 0.055, 0.05, 0.055, rand() < 0.7 ? ACCENT : SAND, rand() * 3);
    }
  }
}

/** 戸口：縦板の扉、鉄の帯、上の太い梁、前の踏み石、その上の小さなひさし */
function door(b: Batch, rand: () => number, f: Face, o: Opening): void {
  const skip = [backSide(f)];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = o.a + ((o.e - o.a) * i) / n;
    const e = o.a + ((o.e - o.a) * (i + 1)) / n;
    faceBox(b, f, a + 0.01, e - 0.01, o.y0, o.y1, -0.05, 0.04, TRUNK.clone().multiplyScalar(0.8 + rand() * 0.15), skip);
  }
  const iron = BARK.clone().lerp(ROCK, 0.25).multiplyScalar(0.55);
  for (const y of [o.y0 + 0.45, o.y1 - 0.45]) faceBox(b, f, o.a + 0.06, o.e - 0.2, y - 0.04, y + 0.04, 0.04, 0.06, iron, skip);
  const knob = facePoint3(f, o.e - 0.15, o.y0 + 1.0, 0.08);
  b.add(BALL, knob.x, knob.y, knob.z, 0.045, 0.045, 0.045, iron);
  // 戸の枠と上の梁
  faceBox(b, f, o.a - 0.14, o.a, o.y0, o.y1, -0.1, 0.12, BEAM, skip);
  faceBox(b, f, o.e, o.e + 0.14, o.y0, o.y1, -0.1, 0.12, BEAM, skip);
  faceBox(b, f, o.a - 0.22, o.e + 0.22, o.y1, o.y1 + 0.3, -0.2, 0.16, BEAM, skip);
  // 踏み石
  faceBox(b, f, o.a - 0.35, o.e + 0.35, 0, o.y0, -0.1, 0.6, trimStone(rand), ['ny', backSide(f)]);
  // ひさし：壁から斜め下へ出した石板の板と、それを支える2本の腕木
  const mid = (o.a + o.e) / 2;
  const p0 = facePoint3(f, mid, o.y1 + 0.95, 0.1);
  const p1 = facePoint3(f, mid, o.y1 + 0.5, 1.0);
  const down = p1.clone().sub(p0).normalize();
  const slabN = UP.clone().addScaledVector(down, -UP.dot(down)).normalize();
  b.beam(p0, p1, slabN, o.e - o.a + 0.9, 0.08, SLATE);
  const along = f.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  for (const s of [o.a - 0.28, o.e + 0.28]) {
    b.beam(facePoint3(f, s, o.y1 - 0.2, 0.08), facePoint3(f, s, o.y1 + 0.52, 0.85), along, 0.1, 0.1, BEAM);
  }
}

// ---- 2階：木組みの漆喰壁 ----

/**
 * 木組みの面。柱で区切った区画（bay）ごとに、窓・斜めの筋かい・中の横木と×の筋かいのどれかを入れる。
 * windows は窓を入れる区画の番号
 */
function timberFace(b: Batch, f: Face, y0: number, y1: number, windows: number[]): void {
  const n = Math.max(2, Math.round((f.to - f.from) / BAY));
  const bw = (f.to - f.from) / n;
  const nrm = faceNormal(f);
  const t = TIMBER;
  const skip = [backSide(f)];
  const beam = (a: number, ya: number, e: number, ye: number) => b.beam(facePoint3(f, a, ya, 0.03), facePoint3(f, e, ye, 0.03), nrm, t * 0.85, 0.06, BEAM);
  faceBox(b, f, f.from, f.to, y0, y0 + t, 0, 0.07, BEAM, skip); // 下の横木
  faceBox(b, f, f.from, f.to, y1 - t, y1, 0, 0.07, BEAM, skip); // 上の横木
  for (let i = 0; i <= n; i++) {
    const s = THREE.MathUtils.clamp(f.from + i * bw, f.from + t / 2, f.to - t / 2);
    faceBox(b, f, s - t / 2, s + t / 2, y0, y1, 0, 0.07, BEAM, skip);
  }
  for (let j = 0; j < n; j++) {
    const a = f.from + j * bw + t / 2;
    const e = f.from + (j + 1) * bw - t / 2;
    const lo = y0 + t;
    const hi = y1 - t;
    if (windows.includes(j)) {
      const wy0 = y0 + 0.75;
      faceBox(b, f, a, e, wy0 - 0.14, wy0, 0, 0.07, BEAM, skip); // 窓の下の横木
      windowPane(b, f, a + 0.12, e - 0.12, wy0, hi - 0.22, BEAM);
      faceBox(b, f, a, e, hi - 0.22, hi - 0.1, 0, 0.07, BEAM, skip); // 窓の上の横木
    } else if (j === 0) {
      beam(a, lo, e, hi); // 隅の区画は、上が内へ寄る斜めの筋かい
    } else if (j === n - 1) {
      beam(e, lo, a, hi);
    } else {
      const my = (lo + hi) / 2;
      faceBox(b, f, a, e, my - t / 2, my + t / 2, 0, 0.07, BEAM, skip);
      beam(a, lo, e, my - t / 2);
      beam(e, lo, a, my - t / 2);
    }
  }
}

/** 張り出した2階の下に並ぶ、床の梁の端（1階の壁から突き出して2階を支える） */
function joists(b: Batch, f: Face): void {
  const skip = [backSide(f)];
  for (let s = f.from + 0.3; s < f.to - 0.2; s += 0.55) faceBox(b, f, s - 0.07, s + 0.07, GF_H - 0.16, GF_H, 0, JETTY, BEAM, skip);
  // 両端の角の下に、斜めの方杖
  const along = f.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  for (const s of [f.from + 0.25, f.to - 0.25]) b.beam(facePoint3(f, s, GF_H - 0.9, 0.12), facePoint3(f, s, GF_H - 0.08, JETTY - 0.05), along, 0.13, 0.13, BEAM);
}

/** 妻の三角の壁と、その木組み（2本の束、斜めの筋かい、中ほどの横木、小さな窓） */
function gable(b: Batch, f: Face, base: number, half: number, rise: number): void {
  const out = f.fixed; // 三角の壁の外の面（Z）
  b.oriented(PRISM, new THREE.Vector3(0, base, out - f.out * 0.25), new THREE.Vector3(1, 0, 0), UP, new THREE.Vector3(0, 0, 1), half * 2, rise, 0.5, PLASTER);
  const nrm = faceNormal(f);
  const tan = rise / half;
  const edge = (x: number) => base + (half - Math.abs(x)) * tan; // 三角の斜めの縁の高さ
  const beam = (a: number, ya: number, e: number, ye: number) => b.beam(facePoint3(f, a, ya, 0.03), facePoint3(f, e, ye, 0.03), nrm, TIMBER * 0.85, 0.06, BEAM);
  const collar = base + rise * 0.5;
  const cw = half - (collar - base) / tan;
  faceBox(b, f, -half, half, base, base + TIMBER, 0, 0.07, BEAM, [backSide(f)]);
  faceBox(b, f, -cw, cw, collar - TIMBER / 2, collar + TIMBER / 2, 0, 0.07, BEAM, [backSide(f)]);
  for (const x of [-0.55, 0.55]) faceBox(b, f, x - TIMBER / 2, x + TIMBER / 2, base, edge(x) - 0.05, 0, 0.07, BEAM, [backSide(f)]);
  for (const s of [-1, 1]) beam(s * (half - 0.3), base + TIMBER, s * 0.62, collar - TIMBER / 2);
  windowPane(b, f, -0.4, 0.4, base + 0.5, collar - 0.25, BEAM);
  // 張り出した三角の壁の下の帯と、梁の端
  const z0 = out - f.out * (GABLE_JETTY + 0.3);
  b.box(-half - 0.05, base - 0.16, Math.min(z0, out + f.out * 0.04), half + 0.05, base, Math.max(z0, out + f.out * 0.04), BEAM);
}

// ---- 屋根 ----

/**
 * 石板ぶきの斜面。eave は軒先の真ん中、u は斜面を上る向き、n は斜面の外向き（どちらも単位ベクトル）。
 * 斜面の下地の板を敷き、その上に幅の違う石板を段ごとに互い違いに並べる（下の端が少し浮くよう傾ける）
 */
function slope(b: Batch, rand: () => number, eave: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, width: number, length: number): void {
  const ax = new THREE.Vector3().crossVectors(n, u);
  const at = (s: number, along: number, lift: number) => eave.clone().addScaledVector(u, s).addScaledVector(ax, along).addScaledVector(n, lift);
  b.oriented(BOX, at(length / 2, 0, -0.09), ax, n, u, width, 0.18, length, SLATE.clone().multiplyScalar(0.6));
  const tn = n.clone().addScaledVector(u, 0.12).normalize();
  const tu = new THREE.Vector3().crossVectors(ax, tn);
  for (let s = 0, row = 0; s < length - 0.04; s += TILE_ROW, row++) {
    const len = Math.min(TILE_ROW + 0.1, length - s);
    let a = -width / 2 - (row % 2) * TILE_MIN * 0.5;
    while (a < width / 2) {
      const w = TILE_MIN + rand() * (TILE_MAX - TILE_MIN);
      const a0 = Math.max(a, -width / 2);
      const a1 = Math.min(a + w, width / 2);
      a += w;
      if (a1 - a0 < 0.08) continue;
      const c = SLATE.clone().multiplyScalar(0.85 + rand() * 0.28);
      if (rand() < 0.12) c.lerp(ROCK, 0.35); // ところどころ色の抜けた石板
      b.oriented(BOX, at(s + len / 2, (a0 + a1) / 2, 0.04), ax, tn, tu, a1 - a0 - 0.03, 0.05, len, c);
    }
  }
}

/** 棟（斜面の合わせ目）にかぶせる石。dir は棟の向き、len は長さ */
function ridgeCap(b: Batch, rand: () => number, mid: THREE.Vector3, dir: THREE.Vector3, len: number): void {
  const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
  const ay = UP.clone().add(side).normalize();
  const az = new THREE.Vector3().crossVectors(dir, ay);
  for (let s = -len / 2; s < len / 2 - 0.05; s += 0.5) {
    const l = Math.min(0.5, len / 2 - s);
    const c = mid.clone().addScaledVector(dir, s + l / 2).addScaledVector(UP, 0.03);
    b.oriented(BOX, c, dir, ay, az, l - 0.03, 0.24, 0.24, SLATE.clone().multiplyScalar(0.75 + rand() * 0.15));
  }
}

/** 切妻屋根の2つの斜面。halfW は棟から軒先までの水平の幅（軒の出を含む）、along は棟の向き。ridge は棟の真ん中 */
function gableRoof(b: Batch, rand: () => number, ridge: THREE.Vector3, along: THREE.Vector3, halfW: number, pitch: number, length: number): void {
  const side = new THREE.Vector3().crossVectors(UP, along).normalize();
  const slopeLen = halfW / Math.cos(pitch);
  for (const s of [-1, 1]) {
    const outward = side.clone().multiplyScalar(s);
    const eave = ridge.clone().addScaledVector(outward, halfW).addScaledVector(UP, -halfW * Math.tan(pitch));
    const u = ridge.clone().sub(eave).normalize();
    const n = outward.clone().multiplyScalar(Math.sin(pitch)).addScaledVector(UP, Math.cos(pitch));
    slope(b, rand, eave, u, n, length, slopeLen);
    // 妻側の縁の破風板
    for (const e of [-1, 1]) {
      const p0 = eave.clone().addScaledVector(along, (e * length) / 2).addScaledVector(n, -0.08);
      const p1 = ridge.clone().addScaledVector(along, (e * length) / 2).addScaledVector(n, -0.08);
      b.beam(p0, p1, along.clone().multiplyScalar(e), 0.3, 0.06, BEAM);
    }
  }
  ridgeCap(b, rand, ridge, along, length);
}

// ---- 家を組み立てる ----

/** 家を1つ建てて group に入れる。当たり判定の見えない箱は solids に足す */
export function buildHouse(group: THREE.Group, solids: THREE.Mesh[], spot: HouseSpot): void {
  const g = new THREE.Group();
  g.position.set(spot.x, spot.y, spot.z);
  g.rotation.y = spot.yaw;
  group.add(g);
  const b = new Batch();
  const rand = mulberry32(HOUSE_SEED);
  const hx = W / 2;
  const hz = D / 2;

  // 1階：石積み。正面（+Z）に戸口と2つの窓、広い側（-X）に花の箱付きの窓を2つ
  b.box(-hx, 0, -hz, hx, GF_H, hz, MORTAR, ['ny']); // 壁の芯（目地の奥に見える）
  const win = (a: number, e: number, flowers = false): Opening => ({ a, e, y0: 1.0, y1: 2.0, flowers });
  const ground: [Face, Opening[]][] = [
    [{ axis: 'z', fixed: hz, from: -hx, to: hx, out: 1 }, [{ a: -0.6, e: 0.6, y0: 0.14, y1: 2.15, door: true }, win(-2.25, -1.35), win(1.35, 2.25)]],
    [{ axis: 'z', fixed: -hz, from: -hx, to: hx, out: -1 }, [win(-0.45, 0.45)]],
    [{ axis: 'x', fixed: -hx, from: -hz, to: hz, out: -1 }, [win(-2.3, -1.3, true), win(1.3, 2.3, true)]],
    [{ axis: 'x', fixed: hx, from: -hz, to: hz, out: 1 }, [win(-0.45, 0.45)]],
  ];
  for (const [f, openings] of ground) {
    stoneWall(b, rand, f, openings);
    joists(b, f);
  }
  quoins(b, rand);

  // 1階と2階の間の梁の帯（2階の張り出しの下も覆う）
  const ux = hx + JETTY;
  const uz = hz + JETTY;
  const y1 = GF_H + BAND;
  const eaveY = y1 + UF_H;
  b.box(-ux - 0.05, GF_H, -uz - 0.05, ux + 0.05, y1, uz + 0.05, BEAM);

  // 2階：漆喰に木組み
  b.box(-ux, y1, -uz, ux, eaveY, uz, PLASTER, ['ny']);
  timberFace(b, { axis: 'z', fixed: uz, from: -ux, to: ux, out: 1 }, y1, eaveY, [1, 3]);
  timberFace(b, { axis: 'z', fixed: -uz, from: -ux, to: ux, out: -1 }, y1, eaveY, [2]);
  // 軒の下の面は、木組みの上端を少し下げて屋根の石板の間から出ないようにする
  timberFace(b, { axis: 'x', fixed: -ux, from: -uz, to: uz, out: -1 }, y1, eaveY - EAVE_TUCK, [1, 4]);
  timberFace(b, { axis: 'x', fixed: ux, from: -uz, to: uz, out: 1 }, y1, eaveY - EAVE_TUCK, [1, 4]);

  // 妻の三角の壁（前後とも、2階よりさらに少し張り出す）
  const rise = ux * Math.tan(PITCH);
  const gz = uz + GABLE_JETTY;
  const shrink = (half: number, pitch: number) => [half - UNDER_ROOF / Math.sin(pitch), half * Math.tan(pitch) - UNDER_ROOF / Math.cos(pitch)];
  const [gHalf, gRise] = shrink(ux, PITCH);
  for (const out of [1, -1] as const) gable(b, { axis: 'z', fixed: out * gz, from: -gHalf, to: gHalf, out }, eaveY, gHalf, gRise);

  // 屋根
  const ridgeY = eaveY + rise;
  gableRoof(b, rand, new THREE.Vector3(0, ridgeY, 0), new THREE.Vector3(0, 0, 1), ux + EAVE_OVER, PITCH, (gz + GABLE_OVER) * 2);
  // 棟の両端の飾り
  for (const e of [-1, 1]) {
    const z = e * (gz + GABLE_OVER - 0.1);
    b.add(CYL, 0, ridgeY + 0.35, z, 0.04, 0.6, 0.04, BEAM);
    b.add(BALL, 0, ridgeY + 0.68, z, 0.09, 0.09, 0.09, BEAM);
  }

  // 屋根窓（-X の斜面の真ん中）
  const tan = Math.tan(PITCH);
  const fx = -(ux - DORMER_SET);
  const roofAt = eaveY + DORMER_SET * tan; // 屋根窓の正面の位置での屋根の高さ
  const dEave = roofAt + DORMER_WALL;
  const dHalf = DORMER_W / 2;
  const dRise = dHalf * Math.tan(DORMER_PITCH);
  const backX = -(ux - (dEave + dRise - eaveY) / tan) + 0.3; // 屋根窓の棟が大屋根に入り込む所
  b.box(fx, roofAt - 0.5, -dHalf, backX, dEave - 0.03, dHalf, PLASTER);
  const df: Face = { axis: 'x', fixed: fx, from: -dHalf, to: dHalf, out: -1 };
  faceBox(b, df, -dHalf, dHalf, roofAt - 0.05, roofAt + 0.12, 0, 0.07, BEAM, ['px']);
  const dTop = dEave - EAVE_TUCK; // 木組みの上端（小さな屋根の石板の間から出ないように少し下げる）
  faceBox(b, df, -dHalf, dHalf, dTop - TIMBER, dTop, 0, 0.07, BEAM, ['px']);
  for (const s of [-1, 1]) faceBox(b, df, s * dHalf - TIMBER / 2, s * dHalf + TIMBER / 2, roofAt - 0.05, dTop, 0, 0.07, BEAM, ['px']);
  windowPane(b, df, -0.5, 0.5, roofAt + 0.3, dTop - 0.25, BEAM);
  const depth = backX - fx;
  const [pHalf, pRise] = shrink(dHalf, DORMER_PITCH);
  b.oriented(PRISM, new THREE.Vector3(fx + depth / 2, dEave, 0), new THREE.Vector3(0, 0, 1), UP, new THREE.Vector3(-1, 0, 0), pHalf * 2, pRise, depth, PLASTER);
  const dLen = depth + 0.3;
  gableRoof(b, rand, new THREE.Vector3(fx - 0.3 + dLen / 2, dEave + dRise, 0), new THREE.Vector3(1, 0, 0), dHalf + 0.25, DORMER_PITCH, dLen);

  // 煙突（+X の斜面の奥寄りから、棟より高く出す）
  const cx = 1.1;
  const cz = -hz + 1.2;
  const top = ridgeY + 1.0;
  for (let y = eaveY, row = 0; y < top; y += 0.32, row++) {
    const j = (row % 2) * 0.03;
    b.box(cx - 0.45 - j, y, cz - 0.45 + j, cx + 0.45 - j, Math.min(y + 0.32, top) - 0.03, cz + 0.45 + j, wallStone(rand, 0.8));
  }
  b.box(cx - 0.55, top, cz - 0.55, cx + 0.55, top + 0.14, cz + 0.55, trimStone(rand));
  for (const dz of [-0.2, 0.2]) b.add(CYL, cx, top + 0.33, cz + dz, 0.13, 0.4, 0.13, POT);

  // 広い側（-X）の正面寄りの角に下げた看板
  const sf: Face = { axis: 'x', fixed: -hx, from: -hz, to: hz, out: -1 };
  const sz = hz - 0.35;
  const iron = BARK.clone().lerp(ROCK, 0.25).multiplyScalar(0.55);
  faceBox(b, sf, sz - 0.04, sz + 0.04, 2.4, 2.47, 0, 1.15, iron);
  b.beam(facePoint3(sf, sz, 1.95, 0.1), facePoint3(sf, sz, 2.42, 0.8), new THREE.Vector3(0, 0, 1), 0.05, 0.05, iron);
  for (const off of [0.45, 1.0]) faceBox(b, sf, sz - 0.01, sz + 0.01, 2.2, 2.4, off - 0.01, off + 0.01, iron);
  faceBox(b, sf, sz - 0.03, sz + 0.03, 1.6, 2.2, 0.35, 1.1, TRUNK.clone().multiplyScalar(1.1));
  for (const side of [-1, 1]) {
    const p = facePoint3(sf, sz + side * 0.04, 1.9, 0.72);
    b.add(BALL, p.x, p.y, p.z, 0.02, 0.17, 0.17, ACCENT); // 看板の丸い印
  }

  g.add(b.mesh());

  // 当たり判定：1階と、張り出した2階
  colliderBox(g, solids, -hx - 0.12, 0, -hz - 0.12, hx + 0.12, GF_H, hz + 0.12);
  colliderBox(g, solids, -ux, GF_H, -uz, ux, eaveY, uz);
}
