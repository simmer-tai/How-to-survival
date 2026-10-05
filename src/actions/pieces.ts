import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/palette.js';
import { flat, flatVertex } from '../core/materials.js';

// 建築部材の形。ハンマーで素材から建てる（素材は items/recipes.ts の BUILD_PLANS）。
// 作業台だけはアイテムとしてクラフトし、手に持って設置する（id はアイテムの id と同じ）

export const CELL = 2; // 建築グリッドの1マス（床1枚の大きさ）
const WALL_H = 2.4;
const WALL_T = 0.2; // 壁の厚み
const FLOOR_H = 0.125; // 床の厚み（置く高さの刻み actions/build.ts の LAYER の倍数）
const DOOR_W = 1; // 入口の幅
const DOOR_H = 2; // 入口の高さ（プレイヤーの背丈は 1.8）
export const BENCH_W = 1.6; // 作業台の天板の幅
export const BENCH_D = 0.9; // 作業台の天板の奥行き
export const BENCH_H = 1; // 作業台の高さ（天板の上面）
const BLUEPRINT_W = 1; // 天板に敷く設計図の幅
const BLUEPRINT_D = 0.62; // 設計図の奥行き
const BLUEPRINT_TURN = 0.12; // 設計図を天板に対して少し斜めに置く（rad）
const FOUNDATION_LEGS = 2; // 土台の下に伸ばす脚の長さ。斜面に置いても下が浮かないように地面に埋める
const PLANK_W = 0.3; // 壁に横に張る板の幅（この幅に近い枚数に分ける）
const PLANK_T = 0.05; // 板の厚み
const PLANK_GAP = 0.05; // 板と板のすき間（向こうが見える）
const PLANK_TILT = 0.03; // 板が面の中で斜めになる角度の最大（rad）。板が平行にそろわないようにする
const PLANK_TWIST = 0.012; // 板が面から浮く・ねじれる角度の最大（rad）
const PLANK_SHIFT = 0.01; // 板の位置のぶれの最大
const PLANK_TRIM = 0.06; // 床・作業台の板の片端を切り詰める量の最大（両端それぞれ。端がそろわないようにする）
const PLANK_INTO = 0.04; // 壁の横板の両端を、両脇の柱・枠に差し込む長さ（傾けても柱とのあいだにすき間ができない）
const PLANK_SINK = 0.012; // 板の面を引っ込める量の最大（面がそろわないようにする）
const PLANK_VARY = 0.3; // 板の幅のばらつき（割合）。手で切ったように太い板と細い板が混ざる
const BRACE_W = 0.14; // 壁の片面に斜めに打つ筋交いの幅
const BRACE_CHANCE = 0.5; // 壁に筋交いを打つ割合（並び方ごとに決まる）
const POST_TOP = 0.08; // 柱の頭が壁より上に出る量の最大（柱ごとにばらつく）
const POST_LEAN = 0.012; // 柱の傾きの最大（rad）
const LOOK_VARIANTS = 4; // 板の並び方の種類。置いた部材ごとに ID から選ぶ
const LOOK_SEED = 5150; // 板の並び方を決める乱数のシード
const POST_W = 0.12; // 壁の両端の柱の幅
const FRAME_W = 0.08; // 入口の枠の太さ
const STUD_W = 0.08; // 壁の中の間柱・横木の太さ
const STUD_SPAN = 0.9; // 壁の区画がこれより広ければ、真ん中に間柱を立てる
const FENCE_T = 0.12; // 柵の厚み
const FENCE_POST = 0.1; // 柵の両端の杭の幅
const FENCE_PICKETS = 7; // 柵の縦板の枚数（片面）
const FENCE_SHORT = 0.9; // 柵の縦板のいちばん低い高さ（0.9〜1 のあいだでばらつく）
const FENCE_LEAN = 0.035; // 柵の縦板の傾きの最大（rad）
const FENCE_RAILS = [0.2, 0.7]; // 柵の縦板を裏で支える横木の高さ
const FLOOR_PLANKS = 5; // 床に張る板の枚数
const JOIST_W = 0.12; // 床板の下の根太の幅
const STAIR_SIDE = 0.06; // 階段の両脇の側板の厚み
const STAIR_TREAD = 0.06; // 階段の踏み板の厚み
const STAIR_RISER = 0.04; // 階段の段の前板の厚み
const BENCH_PLANKS = 3; // 作業台の天板の板の枚数

export const PIECE_IDS = ['workbench', 'floor', 'wall', 'doorway', 'fence', 'stairs', 'foundation'] as const;
export type PieceId = (typeof PIECE_IDS)[number];

/** cell：マスの中央に置く　edge：マスの辺に沿って置く（壁・柵） */
export type Snap = 'cell' | 'edge';

/** 部材を形づくる箱 [幅, 高さ, 奥行き, x, y, z]。y は箱の底面の高さ */
export type Part = [number, number, number, number, number, number];

/** 箱の傾き [x, y, z]（rad）。箱の中心のまわりに回す */
type Tilt = [number, number, number];

/** 見た目の箱と、その色、傾き */
type Look = [Part, number, Tilt?];

/** 0〜1 の乱数を返す関数 */
type Rand = () => number;

interface PieceSpec {
  id: PieceId;
  snap: Snap;
  /** 部材の主な色（壊したときの破片と、脚の色） */
  color: number;
  /**
   * 見た目の箱と色。原点は底面の中央。edge のものは X 方向に伸びる。
   * rand で板の向きや長さをばらつかせる（固定シードなので誰の画面でも同じ）
   */
  look: (rand: Rand) => Look[];
  /**
   * 当たり判定の箱（見た目とは別に定義する）。置ける場所の判定、積む高さ、底面の大きさもこれで決める。
   * 見た目とほぼ同じ大きさにしておく
   */
  collision: Part[];
  /** 当たり判定を箱ごとではなく、collision 全体の凸包（なめらかな坂）にする */
  ramp?: boolean;
  /** 地面に埋める脚の長さ。見た目と当たり判定にだけ付け、置ける場所の判定には使わない */
  legs?: number;
  /** 上に乗れる平らな面か（泳いでいるときのよじ登り判定に使う） */
  platform: boolean;
  /** 耐久値。斧や素手で叩くと減り、0 になると壊れる（減らす量は actions/build.ts の STRIKE_DAMAGE） */
  hp: number;
  /** 部材と違う色の、見た目だけの飾り（当たり判定なし）。置くたびに新しく作る */
  details?: () => THREE.Object3D;
}

export interface PieceDef extends PieceSpec {
  /** 脚も含めた見た目（頂点に色を塗ってある。flatVertex() で描く）。板の並び方ごとに1つ */
  looks: THREE.BufferGeometry[];
  /** 置く前の半透明の見本などに使う見た目（looks の最初） */
  geometry: THREE.BufferGeometry;
  /** 脚も含めた当たり判定の箱。ramp のものは使わず hull を使う */
  colliders: Part[];
  /** ramp のときの、凸包にする点（脚も含む） */
  hull?: Float32Array;
  /** 底面から上面までの高さ。この上に積む */
  height: number;
  /** 回転する前の、底面の大きさの半分 */
  halfX: number;
  halfZ: number;
}

/** 底面が y = 0 になる箱 */
function box([w, h, d, x, y, z]: Part): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
}

/** 頂点に色を塗った箱（傾きがあれば中心のまわりに回す） */
function coloredBox([[w, h, d, x, y, z], color, tilt]: Look): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tilt) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tilt)));
  g.translate(x, y + h / 2, z);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** 固定シードの乱数（誰の画面でも同じ並びになる） */
function mulberry32(seed: number): Rand {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** -a〜a の乱数 */
function wobble(rand: Rand, a: number): number {
  return (rand() * 2 - 1) * a;
}

/** 部材の i 番目の板の並び方を決める乱数 */
function lookRand(id: PieceId, variant: number): Rand {
  return mulberry32(LOOK_SEED + PIECE_IDS.indexOf(id) * 100 + variant);
}

function define(spec: PieceSpec): PieceDef {
  const halfX = Math.max(...spec.collision.map(([w, , , x]) => Math.abs(x) + w / 2));
  const halfZ = Math.max(...spec.collision.map(([, , d, , , z]) => Math.abs(z) + d / 2));
  const height = Math.max(...spec.collision.map(([, h, , , y]) => y + h));
  // 脚は底面いっぱいの箱を、底面から下へ伸ばす
  const legs: Part[] = spec.legs ? [[halfX * 2, spec.legs, halfZ * 2, 0, -spec.legs, 0]] : [];
  const looks = Array.from({ length: LOOK_VARIANTS }, (_, v) => {
    const g = mergeGeometries([...spec.look(lookRand(spec.id, v)), ...legs.map((p): Look => [p, spec.color])].map(coloredBox))!;
    g.userData.shared = true; // 置いた部材どうしで共有するので、アイコン撮影後などに捨てない
    return g;
  });
  const colliders = [...spec.collision, ...legs];
  let hull: Float32Array | undefined;
  if (spec.ramp) {
    const g = mergeGeometries(colliders.map(box), false)!;
    hull = new Float32Array(g.getAttribute('position').array);
    g.dispose();
  }
  return { ...spec, looks, geometry: looks[0], colliders, hull, height, halfX, halfZ };
}

/**
 * 長さ len を n 枚の板に分ける（板のあいだにすき間）。[板の中心, 板の幅] の列。
 * rand を渡すと、板ごとに幅がばらつく
 */
function split(len: number, n: number, rand?: Rand): [number, number][] {
  const weights = Array.from({ length: n }, () => (rand ? 1 + wobble(rand, PLANK_VARY) : 1));
  const scale = (len - PLANK_GAP * (n - 1)) / weights.reduce((a, b) => a + b, 0);
  let x = -len / 2;
  return weights.map((wt): [number, number] => {
    const w = wt * scale;
    const c = x + w / 2;
    x += w + PLANK_GAP;
    return [c, w];
  });
}

/** 長さ len の板の両端を別々に切り詰める。[縮めた長さ, 中心のずれ] */
function trim(rand: Rand, len: number): [number, number] {
  const a = rand() * PLANK_TRIM;
  const b = rand() * PLANK_TRIM;
  return [len - a - b, (a - b) / 2];
}

/**
 * 板張りの壁の一区画：x0〜x1、y0〜y1 の範囲の両面に、すき間をあけて横板を張る。
 * 横板は両脇の柱・枠まで伸ばし、端を差し込む。
 * 厚みは t（z = 0 が中央）。板のあいだは中空で、上下の横木と間柱で支える。
 * brace なら、片面に斜めの筋交いを打つことがある
 */
function plankPanel(rand: Rand, x0: number, x1: number, y0: number, y1: number, t: number, brace = false): Look[] {
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const inner = t - PLANK_T * 2; // 両面の板のあいだ
  const stud = w > STUD_SPAN; // 真ん中に間柱を立てるか
  const out: Look[] = [];
  // 上下の横木と、広い区画なら真ん中の間柱（板のあいだに収める）
  if (h > STUD_W * 3) {
    out.push([[w, STUD_W, inner, cx, y0, 0], PALETTE.bark], [[w, STUD_W, inner, cx, y1 - STUD_W, 0], PALETTE.bark]);
  }
  if (stud) out.push([[STUD_W, h, inner, cx, y0, 0], PALETTE.bark]);

  for (const [y, ph] of split(h, Math.max(1, Math.round(h / PLANK_W)), rand)) {
    for (const side of [-1, 1]) {
      const sink = rand() * PLANK_SINK;
      const tilt: Tilt = [wobble(rand, PLANK_TWIST), wobble(rand, PLANK_TWIST), wobble(rand, PLANK_TILT)];
      const z = side * (inner / 2 + PLANK_T / 2 - sink);
      const plank: Look = [[w + PLANK_INTO * 2, ph, PLANK_T, cx, y0 + h / 2 + y - ph / 2 + wobble(rand, PLANK_SHIFT), z], PALETTE.trunk, tilt];
      out.push(plank);
    }
  }

  // 筋交い：板の外側に、区画の角から角へ斜めに渡す
  if (brace && rand() < BRACE_CHANCE) {
    const side = rand() < 0.5 ? -1 : 1;
    const dir = rand() < 0.5 ? -1 : 1;
    const len = Math.hypot(w, h) - BRACE_W * 1.5;
    const tilt: Tilt = [0, 0, dir * Math.atan2(h, w)];
    const plank: Look = [[len, BRACE_W, PLANK_T, cx, y0 + h / 2 - BRACE_W / 2, side * (t / 2 + PLANK_T / 2)], PALETTE.bark, tilt];
    out.push(plank);
  }
  return out;
}

/** 壁の両端の柱（濃い色）。頭の高さと傾きが柱ごとにばらつく */
function posts(rand: Rand): Look[] {
  return [-1, 1].map((sx): Look => [
    [POST_W, WALL_H + rand() * POST_TOP, WALL_T, sx * (CELL / 2 - POST_W / 2), 0, 0],
    PALETTE.bark,
    [wobble(rand, POST_LEAN), 0, wobble(rand, POST_LEAN)],
  ]);
}

/** 壁：両端の柱と、そのあいだの横板 */
function wallLook(rand: Rand): Look[] {
  const x = CELL / 2 - POST_W;
  return [...posts(rand), ...plankPanel(rand, -x, x, 0, WALL_H, WALL_T, true)];
}

/** 入口のある壁：柱、入口の枠、枠の左右の横板と、枠より上の柱から柱までの横板 */
function doorwayLook(rand: Rand): Look[] {
  const x = CELL / 2 - POST_W;
  const jamb = DOOR_W / 2 + FRAME_W; // 枠の外側
  return [
    ...posts(rand),
    ...plankPanel(rand, -x, -jamb, 0, DOOR_H + FRAME_W, WALL_T),
    ...plankPanel(rand, jamb, x, 0, DOOR_H + FRAME_W, WALL_T),
    ...plankPanel(rand, -x, x, DOOR_H + FRAME_W, WALL_H, WALL_T),
    ...[-1, 1].map((sx): Look => [[FRAME_W, DOOR_H + FRAME_W, WALL_T, sx * (DOOR_W / 2 + FRAME_W / 2), 0, 0], PALETTE.bark]),
    [[DOOR_W, FRAME_W, WALL_T, 0, DOOR_H, 0], PALETTE.bark],
  ];
}

/** 柵：両端の杭、裏の横木、両面に張った縦板（幅・高さ・傾きがばらつく） */
function fenceLook(rand: Rand): Look[] {
  const inner = CELL - FENCE_POST * 2;
  const rail = FENCE_T - PLANK_T * 2; // 両面の縦板のあいだ
  const out: Look[] = [
    ...[-1, 1].map((sx): Look => [
      [FENCE_POST, 1 + rand() * POST_TOP, FENCE_T, sx * (CELL / 2 - FENCE_POST / 2), 0, 0],
      PALETTE.bark,
      [wobble(rand, POST_LEAN), 0, wobble(rand, POST_LEAN)],
    ]),
    ...FENCE_RAILS.map((y): Look => [[inner, STUD_W, rail, 0, y, 0], PALETTE.bark]),
  ];
  for (const [x, pw] of split(inner, FENCE_PICKETS, rand)) {
    for (const side of [-1, 1]) {
      const h = FENCE_SHORT + rand() * (1 - FENCE_SHORT);
      const tilt: Tilt = [wobble(rand, PLANK_TWIST), 0, wobble(rand, FENCE_LEAN)];
      const z = side * (rail / 2 + PLANK_T / 2 - rand() * PLANK_SINK);
      const plank: Look = [[pw, h, PLANK_T, x + wobble(rand, PLANK_SHIFT), 0, z], PALETTE.trunk, tilt];
      out.push(plank);
    }
  }
  return out;
}

/** 床：根太（濃い色の横木）の上に、すき間をあけて板を並べる */
function floorLook(rand: Rand): Look[] {
  const base = FLOOR_H - PLANK_T;
  const joists = [-1, 0, 1].map((k) => k * (CELL / 2 - JOIST_W / 2));
  const out: Look[] = joists.map((z): Look => [[CELL, base, JOIST_W, 0, 0, z], PALETTE.bark]);
  for (const [x, pw] of split(CELL, FLOOR_PLANKS, rand)) {
    const [len, dz] = trim(rand, CELL);
    const tilt: Tilt = [wobble(rand, PLANK_TWIST / 2), wobble(rand, PLANK_TILT / 2), wobble(rand, PLANK_TWIST)];
    const plank: Look = [[pw, PLANK_T, len, x + wobble(rand, PLANK_SHIFT), base - rand() * PLANK_SINK, dz], PALETTE.trunk, tilt];
    out.push(plank);
  }
  return out;
}

/** 階段：両脇の側板、各段の踏み板（2枚）と前板。中は濃い色の下地 */
function stairsLook(rand: Rand): Look[] {
  const out: Look[] = [];
  const inner = CELL - STAIR_SIDE * 2;
  for (const [, h, d, , , z] of stairParts()) {
    const bottom = h - WALL_H / 4; // 一段下の高さ（前板はここから立ち上がる）
    for (const sx of [-1, 1]) out.push([[STAIR_SIDE, h, d, sx * (CELL / 2 - STAIR_SIDE / 2), 0, z], PALETTE.trunk]);
    out.push([[inner, h - STAIR_TREAD, d - STAIR_RISER, 0, 0, z - STAIR_RISER / 2], PALETTE.bark]);
    out.push([[inner, h - STAIR_TREAD - bottom, STAIR_RISER, 0, bottom, z + d / 2 - STAIR_RISER / 2], PALETTE.trunk]);
    for (const [tz, td] of split(d, 2, rand)) {
      const tilt: Tilt = [0, wobble(rand, PLANK_TWIST), 0];
      const plank: Look = [[inner, STAIR_TREAD, td, wobble(rand, PLANK_SHIFT), h - STAIR_TREAD, z + tz], PALETTE.trunk, tilt];
      out.push(plank);
    }
  }
  return out;
}

/** 作業台：板を並べた天板（下に濃い色の受け木）、4本の脚、板の棚 */
function workbenchLook(rand: Rand): Look[] {
  const [top, ...rest] = workbenchParts();
  const [sw, sh, sd, , sy] = rest.pop()!; // 棚板
  const [tw, th, td, , ty] = top;
  // 天板は上に設計図を敷くので、向きだけ少しずらす（高さはそろえる）
  const plank = (w: number, h: number, d: number, y: number, z: number): Look[] => {
    const [len, dx] = trim(rand, w);
    const p: Look = [[len, h, d, dx, y, z + wobble(rand, PLANK_SHIFT)], PALETTE.trunk, [0, wobble(rand, PLANK_TWIST), 0]];
    return [p];
  };
  return [
    [[tw - 0.08, th - PLANK_T, td - 0.08, 0, ty, 0], PALETTE.bark],
    ...split(td, BENCH_PLANKS, rand).flatMap(([z, pd]) => plank(tw, PLANK_T, pd, BENCH_H - PLANK_T, z)),
    ...rest.map((p): Look => [p, PALETTE.trunk]),
    ...split(sd, 2, rand).flatMap(([z, pd]) => plank(sw, sh, pd, sy, z)),
  ];
}

/** 階段の当たり判定：-Z へ向かって上る4段（凸包にするのでなめらかな坂になる） */
function stairParts(): Part[] {
  const steps = 4;
  const depth = CELL / steps;
  return Array.from({ length: steps }, (_, i): Part => [CELL, (WALL_H / steps) * (i + 1), depth, 0, 0, CELL / 2 - depth * (i + 0.5)]);
}

/** 入口のある壁の当たり判定：左右の柱と、入口の上の梁 */
function doorwayParts(): Part[] {
  const side = (CELL - DOOR_W) / 2;
  const x = DOOR_W / 2 + side / 2;
  return [
    [side, WALL_H, WALL_T, -x, 0, 0],
    [side, WALL_H, WALL_T, x, 0, 0],
    [DOOR_W, WALL_H - DOOR_H, WALL_T, 0, DOOR_H, 0],
  ];
}

/** 作業台の当たり判定：天板と4本の脚、脚のあいだの棚板 */
function workbenchParts(): Part[] {
  const top = 0.15; // 天板の厚み
  const leg = 0.14;
  const lx = BENCH_W / 2 - 0.12;
  const lz = BENCH_D / 2 - 0.1;
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): Part => [leg, BENCH_H - top, leg, sx * lx, 0, sz * lz]);
  return [[BENCH_W, top, BENCH_D, 0, BENCH_H - top, 0], ...legs, [lx * 2, 0.08, lz * 2, 0, 0.3, 0]];
}

/** 作業台の天板に敷く設計図：青い紙に家の間取りの線。奥の端は丸まっている */
function blueprint(): THREE.Object3D {
  const sheet = 0.008; // 紙の厚み
  const paper = new THREE.Mesh(new THREE.BoxGeometry(BLUEPRINT_W, sheet, BLUEPRINT_D).translate(0, sheet / 2, 0), flat(PALETTE.water));
  const r = 0.035; // 丸まった端の太さ
  const roll = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, BLUEPRINT_W, 8).rotateZ(Math.PI / 2).translate(0, r, -BLUEPRINT_D / 2),
    flat(PALETTE.water),
  );

  // 間取りの線：外壁（手前に入口のすき間）、中の仕切り、右下の表題欄
  const t = 0.018; // 線の太さ
  const w = 0.6;
  const d = 0.38;
  const ox = -0.08; // 間取りは少し左に寄せ、右に表題欄を置く
  const line = (lw: number, ld: number, x: number, z: number) => new THREE.BoxGeometry(lw, 0.002, ld).translate(ox + x, sheet + 0.001, z);
  const lines = new THREE.Mesh(
    mergeGeometries([
      line(w, t, 0, -d / 2),
      line(t, d, -w / 2, 0),
      line(t, d, w / 2, 0),
      line(w * 0.35, t, -w / 2 + w * 0.175, d / 2),
      line(w * 0.45, t, w / 2 - w * 0.225, d / 2),
      line(t, d * 0.6, w * 0.1, -d * 0.2),
      line(w * 0.3, t, w * 0.25, 0.02),
      line(0.12, t * 0.6, 0.47, 0.19),
      line(0.12, t * 0.6, 0.47, 0.23),
    ])!,
    flat(PALETTE.sky),
  );

  const g = new THREE.Group();
  for (const m of [paper, roll, lines]) {
    m.receiveShadow = true;
    g.add(m);
  }
  roll.castShadow = true;
  g.position.set(0, BENCH_H, 0.03);
  g.rotation.y = BLUEPRINT_TURN;
  return g;
}

export const PIECES: PieceDef[] = [
  define({ id: 'workbench', snap: 'cell', color: PALETTE.trunk, look: workbenchLook, collision: workbenchParts(), platform: false, hp: 6, details: blueprint }),
  define({ id: 'floor', snap: 'cell', color: PALETTE.trunk, look: floorLook, collision: [[CELL, FLOOR_H, CELL, 0, 0, 0]], platform: true, hp: 8 }),
  define({ id: 'wall', snap: 'edge', color: PALETTE.trunk, look: wallLook, collision: [[CELL, WALL_H, WALL_T, 0, 0, 0]], platform: false, hp: 10 }),
  define({ id: 'doorway', snap: 'edge', color: PALETTE.trunk, look: doorwayLook, collision: doorwayParts(), platform: false, hp: 10 }),
  define({ id: 'fence', snap: 'edge', color: PALETTE.trunk, look: fenceLook, collision: [[CELL, 1, FENCE_T, 0, 0, 0]], platform: false, hp: 4 }),
  define({ id: 'stairs', snap: 'cell', color: PALETTE.trunk, look: stairsLook, collision: stairParts(), ramp: true, platform: false, hp: 8 }),
  define({
    id: 'foundation',
    snap: 'cell',
    color: PALETTE.rock,
    look: () => [[[CELL, 1, CELL, 0, 0, 0], PALETTE.rock]],
    collision: [[CELL, 1, CELL, 0, 0, 0]],
    legs: FOUNDATION_LEGS,
    platform: true,
    hp: 20,
  }),
];
const PIECE_BY_ID = new Map<string, PieceDef>(PIECES.map((d) => [d.id, d]));

/** id が部材ならその定義（アイテムやセーブデータの id から引く） */
export function pieceDef(id: string): PieceDef | undefined {
  return PIECE_BY_ID.get(id);
}

/** アイコン用の部材のモデル。脚は地面に埋まる部分なので描かない */
export function pieceIconModel(id: PieceId): THREE.Object3D {
  const def = PIECE_BY_ID.get(id)!;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(def.look(lookRand(id, 0)).map(coloredBox))!, flatVertex()));
  if (def.details) g.add(def.details());
  g.rotation.set(0.45, id === 'stairs' ? 2.4 : -0.6, 0);
  return g;
}
