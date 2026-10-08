import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/palette.js';
import { flat, flatVertex, woodVertex, WOOD_SPAN_U, WOOD_SPAN_V } from '../core/materials.js';

// 建築部材の形。ハンマーで素材から建てる（素材は items/recipes.ts の BUILD_PLANS）。
// 作業台・製図台・焚火はアイテムとしてクラフトし、手に持って設置する（id はアイテムの id と同じ）

export const CELL = 2; // 建築グリッドの1マス（床1枚の大きさ）
const WALL_H = 2.4;
const WALL_T = 0.2; // 壁の厚み
const FLOOR_H = 0.125; // 床の厚み（置く高さの刻み actions/build.ts の LAYER の倍数）
const DOOR_W = 1; // 入口の幅
const DOOR_H = 2; // 入口の高さ（プレイヤーの背丈は 1.8）
export const BENCH_W = 1.6; // 作業台の天板の幅
export const BENCH_D = 0.9; // 作業台の天板の奥行き
export const BENCH_H = 1; // 作業台の高さ（天板の上面）。製図台も同じ大きさ
const BLUEPRINT_W = 1; // 天板に敷く設計図の幅
const BLUEPRINT_D = 0.62; // 設計図の奥行き
const BLUEPRINT_TURN = 0.12; // 設計図を天板に対して少し斜めに置く（rad）
const CHART_W = 1.3; // 製図台の天板に敷く海図の幅
const CHART_D = 0.7; // 海図の奥行き
const CHART_TURN = -0.06; // 海図を天板に対して少し斜めに置く（rad）
const SCROLLS = 3; // 製図台の棚に寝かせる、巻いた地図の数
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
const POST_TOP = 0.05; // 壁・柵の両端の柱の頭が、壁・柵より上に出る量
const POST_LEAN = 0.012; // 柱の傾きの最大（rad）
const LOOK_VARIANTS = 4; // 板の並び方の種類。置いた部材ごとに ID から選ぶ
const LOOK_SEED = 5150; // 板の並び方を決める乱数のシード
const FRAME_W = 0.08; // 入口の枠の太さ
const STUD_W = 0.08; // 壁の中の間柱・横木の太さ
const STUD_SPAN = 0.9; // 壁の区画がこれより広ければ、真ん中に間柱を立てる
const FENCE_T = 0.12; // 柵の厚み
const FENCE_PICKETS = 7; // 柵の縦板の枚数（片面）
const FENCE_SHORT = 0.9; // 柵の縦板のいちばん低い高さ（0.9〜1 のあいだでばらつく）
const FENCE_LEAN = 0.035; // 柵の縦板の傾きの最大（rad）
const FENCE_RAILS = [0.2, 0.7]; // 柵の縦板を裏で支える横木の高さ
const PILLAR_W = 0.26; // 柱の太さ（四角い角材）
const PILLAR_BASE = 0.36; // 柱の根元の台座の幅
const PILLAR_BASE_H = 0.12; // 台座の高さ
const PILLAR_CAP = 0.34; // 柱の頭に載せる受け木の幅
const PILLAR_CAP_H = 0.1; // 受け木の高さ
const PILLAR_BANDS = [0.55, 1.75]; // 柱に巻いたツルの高さ
const PILLAR_BAND_H = 0.06; // 巻いたツルの幅
const PILLAR_REACH = 0.1; // 柱の見た目を当たり判定の上面より伸ばす量。上に載せた床の板の裏まで届かせる（床の板の上面より下）
const PILLAR_LEGS = 0.5; // 柱の根元から地面に埋める長さ。上の床に届くよう持ち上げても、下が浮かない（actions/build.ts の levelUp）
const FLOOR_PLANKS = 5; // 床に張る板の枚数
const JOIST_W = 0.12; // 床板の下の根太の幅
const STAIR_POLE = 0.09; // 階段の両脇の斜めの棒と、それを支える脚の太さ
const STAIR_TREAD = 0.06; // 階段の踏み板の厚み
const STAIR_TREAD_D = 0.2; // 階段の踏み板の奥行き（段の手前に寄せる。奥はすき間になる。1段の奥行きより小さくする）
const STAIR_INTO = 0.02; // 踏み板の両端を棒に差し込む長さ
const STAIR_TIE = 0.35; // 後ろの脚どうしをつなぐ横木の高さ
const STAIR_CELLS = 2; // 階段が使うマスの数（上る向きに並ぶ。長いほど坂がゆるい）
const STAIR_STEPS = 16; // 階段の段数（いちばん上は踊り場）。1段の高さは autostep で上れる高さより低くする
const STAIR_LEN = CELL * STAIR_CELLS; // 階段の長さ
const BENCH_PLANKS = 3; // 作業台の天板の板の枚数
export const FIRE_RING = 0.42; // 焚火を囲む石の輪の半径
const FIRE_STONES = 14; // 焚火を囲む石の数（すき間なく並ぶ数）
const FIRE_PEBBLES = 14; // 石の輪の外側のすき間を埋める小石の数
const FIRE_LOGS = 6; // 焚火の真ん中に組む薪の数（三角錐に立てかける）
const FIRE_LOG_BASE = 0.27; // 薪の根元を置く、真ん中からの距離
const FIRE_LOG_TOP = 0.44; // 薪の先が寄り合う高さ
const FIRE_LOG_R = 0.036; // 薪の太さ（半径）
const FIRE_LOG_TAPER = 0.7; // 薪の先の太さ（根元に対する割合）
const FIRE_LOG_CHAR = 0.35; // 薪の先の、焦げて黒くなったところの長さ（割合）
const FIRE_TWIGS = 3; // 灰の上に転がる小枝の数
const FIRE_H = 0.3; // 焚火の当たり判定の高さ
const FIRE_STONE_DETAIL = 1; // 焚火の石の丸さ（多面体を細かく割る回数。0 だと角ばる）
const FIRE_STONE_SINK = 0.3; // 焚火の石を地面に埋める割合（高さに対して）

export const PIECE_IDS = ['workbench', 'draftingTable', 'floor', 'wall', 'doorway', 'fence', 'stairs', 'foundation', 'campfire', 'pillar'] as const;
export type PieceId = (typeof PIECE_IDS)[number];

/**
 * cell：マスの中央に置く　edge：マスの辺に沿って置く（壁・柵）　corner：マスの角に置く（柱。壁の継ぎ目に立つ）
 * free：グリッドに沿わず、狙った所に置く（作業台・製図台・焚火）
 */
export type Snap = 'cell' | 'edge' | 'corner' | 'free';

/** 部材を形づくる箱 [幅, 高さ, 奥行き, x, y, z]。y は箱の底面の高さ */
export type Part = [number, number, number, number, number, number];

/** 箱の傾き [x, y, z]（rad）。箱の中心のまわりに回す */
type Tilt = [number, number, number];

/** 見た目の箱と、その色、傾き。round なら箱でなく、箱に収まる丸い石の形にする。rod なら先（+Y）が細くなる丸太の形にする */
type Look = [Part, number, Tilt?, ('round' | 'rod')?];

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
  /** 当たり判定を箱ごとではなく、この点 [x, y, z, …] の凸包（なめらかな坂）にする */
  ramp?: number[];
  /** -Z 方向に並べて使うマスの数（cell の部材だけ。省くと 1）。原点は並んだマスの真ん中 */
  cells?: number;
  /** 地面に埋める脚の長さ。見た目と当たり判定にだけ付け、置ける場所の判定には使わない */
  legs?: number;
  /** 上に乗れる平らな面か（泳いでいるときのよじ登り判定に使う） */
  platform: boolean;
  /** 耐久値。斧や素手で叩くと減り、0 になると壊れる（減らす量は actions/build.ts の STRIKE_DAMAGE） */
  hp: number;
  /** 部材と違う色の、見た目だけの飾り（当たり判定なし）。置くたびに新しく作る */
  details?: () => THREE.Object3D;
  /** 木目のドット絵を重ねて描くか（pieceMaterial()） */
  wood?: boolean;
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

/**
 * 箱の面ごとの UV を、長さに合わせて振り直す（1 が WOOD_SPAN_U / V。長い板でも木目が引き伸ばされない）。
 * 木目（テクスチャの u）は面の長い向きに沿わせる。箱ごとに模様の位置をずらし、同じ所がそろって見えないようにする
 */
function woodUV(g: THREE.BoxGeometry, w: number, h: number, d: number, seed: number): THREE.BoxGeometry {
  // BoxGeometry の面の順（+x, -x, +y, -y, +z, -z）と、それぞれの u・v の向きの長さ
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const ou = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  const ov = Math.abs(Math.sin(seed * 78.233) * 12543.123) % 1;
  for (let i = 0; i < uv.count; i++) {
    const [lu, lv] = faces[Math.floor(i / 4)];
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (lu >= lv) uv.setXY(i, (u * lu) / WOOD_SPAN_U + ou, (v * lv) / WOOD_SPAN_V + ov);
    else uv.setXY(i, (v * lv) / WOOD_SPAN_U + ou, (u * lu) / WOOD_SPAN_V + ov);
  }
  return g;
}

/** 頂点に色を塗った箱か丸い石（傾きがあれば中心のまわりに回す） */
function coloredBox([[w, h, d, x, y, z], color, tilt, shape]: Look): THREE.BufferGeometry {
  // 丸い石は面ごとに頂点を持つ形（インデックスなし）なので、箱とまとめるときは mergeLooks() で形をそろえる
  const g =
    shape === 'round'
      ? new THREE.IcosahedronGeometry(0.5, FIRE_STONE_DETAIL).scale(w, h, d)
      : shape === 'rod'
        ? new THREE.CylinderGeometry(0.5 * FIRE_LOG_TAPER, 0.5, 1, 7).scale(w, h, d)
        : woodUV(new THREE.BoxGeometry(w, h, d), w, h, d, x + y + z);
  if (tilt) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tilt)));
  g.translate(x, y + h / 2, z);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** 見た目の箱や石を1つのジオメトリにまとめる（丸い石が混ざっていれば、箱もインデックスなしにそろえる） */
function mergeLooks(looks: Look[]): THREE.BufferGeometry {
  const geos = looks.map(coloredBox);
  const flat = geos.some((g) => !g.index);
  return mergeGeometries(flat ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos)!;
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
    const g = mergeLooks([...spec.look(lookRand(spec.id, v)), ...legs.map((p): Look => [p, spec.color])]);
    g.userData.shared = true; // 置いた部材どうしで共有するので、アイコン撮影後などに捨てない
    return g;
  });
  const colliders = [...spec.collision, ...legs];
  let hull: Float32Array | undefined;
  if (spec.ramp) {
    const pts = [...spec.ramp];
    if (legs.length) {
      const g = mergeGeometries(legs.map(box), false)!;
      pts.push(...g.getAttribute('position').array);
      g.dispose();
    }
    hull = new Float32Array(pts);
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

/**
 * 壁・柵の両端の柱（濃い色）。マスの角の点を中心にした、厚み t の角柱。
 * 角で直角に組んだ壁・柵も、まっすぐ並べた壁・柵も、角の柱が同じ形で重なってすき間を埋める（だから傾けたり高さを変えたりしない）
 */
function cornerPosts(t: number, h: number): Look[] {
  return [-1, 1].map((sx): Look => [[t, h + POST_TOP, t, (sx * CELL) / 2, 0, 0], PALETTE.bark]);
}

/** 壁：両端の柱と、そのあいだの横板 */
function wallLook(rand: Rand): Look[] {
  const x = CELL / 2 - WALL_T / 2; // 柱の内側
  return [...cornerPosts(WALL_T, WALL_H), ...plankPanel(rand, -x, x, 0, WALL_H, WALL_T, true)];
}

/** 入口のある壁：柱、入口の枠、枠の左右の横板と、枠より上の柱から柱までの横板 */
function doorwayLook(rand: Rand): Look[] {
  const x = CELL / 2 - WALL_T / 2; // 柱の内側
  const jamb = DOOR_W / 2 + FRAME_W; // 枠の外側
  return [
    ...cornerPosts(WALL_T, WALL_H),
    ...plankPanel(rand, -x, -jamb, 0, DOOR_H + FRAME_W, WALL_T),
    ...plankPanel(rand, jamb, x, 0, DOOR_H + FRAME_W, WALL_T),
    ...plankPanel(rand, -x, x, DOOR_H + FRAME_W, WALL_H, WALL_T),
    ...[-1, 1].map((sx): Look => [[FRAME_W, DOOR_H + FRAME_W, WALL_T, sx * (DOOR_W / 2 + FRAME_W / 2), 0, 0], PALETTE.bark]),
    [[DOOR_W, FRAME_W, WALL_T, 0, DOOR_H, 0], PALETTE.bark],
  ];
}

/** 柵：両端の杭、裏の横木、両面に張った縦板（幅・高さ・傾きがばらつく） */
function fenceLook(rand: Rand): Look[] {
  const inner = CELL - FENCE_T; // 両端の柱の内側
  const rail = FENCE_T - PLANK_T * 2; // 両面の縦板のあいだ
  const out: Look[] = [
    ...cornerPosts(FENCE_T, 1),
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

/** 柱：根元の台座と頭の受け木（濃い色）のあいだに、少し傾いた角材を立て、ツルを2か所巻く */
function pillarLook(rand: Rand): Look[] {
  const lean: Tilt = [wobble(rand, POST_LEAN), wobble(rand, 0.08), wobble(rand, POST_LEAN)];
  const top = WALL_H + PILLAR_REACH;
  const shaft = top - PILLAR_BASE_H - PILLAR_CAP_H;
  return [
    [[PILLAR_BASE, PILLAR_BASE_H, PILLAR_BASE, 0, 0, 0], PALETTE.bark],
    [[PILLAR_W, shaft, PILLAR_W, wobble(rand, PLANK_SHIFT), PILLAR_BASE_H, wobble(rand, PLANK_SHIFT)], PALETTE.trunk, lean],
    ...PILLAR_BANDS.map((y): Look => [[PILLAR_W + 0.03, PILLAR_BAND_H, PILLAR_W + 0.03, 0, y + wobble(rand, 0.05), 0], PALETTE.leaf, [0, wobble(rand, 0.1), 0]]),
    [[PILLAR_CAP, PILLAR_CAP_H, PILLAR_CAP, 0, top - PILLAR_CAP_H, 0], PALETTE.bark, [0, wobble(rand, 0.06), 0]],
  ];
}

/**
 * 階段：両脇の斜めの棒を前後の脚で支え、棒のあいだに踏み板を1枚ずつ渡す（下は抜けている）。
 * いちばん上の段は、板2枚を並べた踊り場
 */
function stairsLook(rand: Rand): Look[] {
  const steps = stairParts();
  const [, topH, topD, , , topZ] = steps[steps.length - 1];
  const half = STAIR_POLE / 2;
  const px = CELL / 2 - half; // 棒と脚の x
  const inner = CELL - STAIR_POLE * 2; // 両脇の棒のあいだ
  const slope = WALL_H / STAIR_LEN;
  const out: Look[] = [];

  const tread = (z: number, d: number, y: number) => {
    const tilt: Tilt = [wobble(rand, PLANK_TWIST), wobble(rand, PLANK_TILT / 2), wobble(rand, PLANK_TWIST)];
    const plank: Look = [[inner + STAIR_INTO * 2, STAIR_TREAD, d, 0, y - rand() * PLANK_SINK, z + wobble(rand, PLANK_SHIFT)], PALETTE.trunk, tilt];
    out.push(plank);
  };
  // 踏み板：各段の手前に1枚。いちばん上は奥まで2枚
  for (const [, h, d, , , z] of steps.slice(0, -1)) tread(z + d / 2 - STAIR_TREAD_D / 2, STAIR_TREAD_D, h - STAIR_TREAD);
  for (const [tz, td] of split(topD, 2, rand)) tread(topZ + tz, td, topH - STAIR_TREAD);

  // 斜めの棒は踏み板の真ん中を通す。手前は短い脚に、奥は踊り場の下の受け木につなぎ、真ん中も脚で支える
  const [, h0, d0, , , z0] = steps[0];
  const tz0 = z0 + d0 / 2 - STAIR_TREAD_D / 2;
  const ty0 = h0 - STAIR_TREAD / 2;
  const poleY = (z: number) => ty0 + slope * (tz0 - z); // 棒の中心の高さ
  const landingY = topH - STAIR_TREAD - STAIR_POLE; // 踊り場の受け木の底
  const front = STAIR_LEN / 2 - half;
  const back = tz0 - (landingY + half - ty0) / slope;
  const len = Math.hypot(front - back, poleY(back) - poleY(front));
  const mid = (front + back) / 2;
  const backPost = -STAIR_LEN / 2 + half;
  for (const sx of [-1, 1]) {
    out.push(
      [[STAIR_POLE, STAIR_POLE, len, sx * px, poleY(mid) - half, mid], PALETTE.bark, [Math.atan(slope), 0, 0]],
      [[STAIR_POLE, STAIR_POLE, topD, sx * px, landingY, topZ], PALETTE.bark],
      [[STAIR_POLE, poleY(front), STAIR_POLE, sx * px, 0, front], PALETTE.bark, [wobble(rand, POST_LEAN), 0, wobble(rand, POST_LEAN)]],
      [[STAIR_POLE, landingY, STAIR_POLE, sx * px, 0, backPost], PALETTE.bark, [wobble(rand, POST_LEAN), 0, wobble(rand, POST_LEAN)]],
      [[STAIR_POLE, poleY(0) - half, STAIR_POLE, sx * px, 0, 0], PALETTE.bark, [wobble(rand, POST_LEAN), 0, wobble(rand, POST_LEAN)]],
    );
  }
  out.push([[inner, STAIR_POLE, STAIR_POLE, 0, STAIR_TIE, backPost], PALETTE.bark]);
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

/** 色を k 倍に明るく（暗く）する（パレットの色から濃淡を作る） */
const shadeColor = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const CHAR_COLOR = shadeColor(PALETTE.bark, 0.35); // 焦げた薪の先
const CUT_COLOR = shadeColor(PALETTE.trunk, 1.3); // 薪の切り口（明るい木の色）
const Y_UP = new THREE.Vector3(0, 1, 0);

/** from から to へ伸びる丸太の形（to の側が細い）。r は根元の半径 */
function rod(from: THREE.Vector3, to: THREE.Vector3, r: number, color: number): Look {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.normalize()));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  return [[r * 2, len, r * 2, mid.x, mid.y - len / 2, mid.z], color, [e.x, e.y, e.z], 'rod'];
}

/** 焚火の石1つ。a は輪の上の向き、ring は真ん中からの距離 */
function fireStone(rand: Rand, a: number, ring: number, w: number, h: number, d: number): Look {
  return [
    [w, h, d, Math.sin(a) * ring, -h * FIRE_STONE_SINK, Math.cos(a) * ring],
    shadeColor(PALETTE.rock, 0.82 + rand() * 0.26), // 石ごとに少し濃さを変える
    [wobble(rand, 0.25), a + wobble(rand, 0.3), wobble(rand, 0.25)], // 長い辺を輪に沿わせる
    'round',
  ];
}

/**
 * 焚火：すき間なく輪に並べた丸い石（大きさ・向き・濃さがばらつき、少し地面に埋まる）と、外側のすき間を埋める小石、真ん中の灰、
 * 三角錐に立てかけた丸い薪（先が細く焦げて黒く、根元には明るい切り口。枝を払った跡の出っ張りがあるものも）と、灰の上の小枝
 */
function campfireLook(rand: Rand): Look[] {
  const out: Look[] = [[[FIRE_RING * 1.4, 0.03, FIRE_RING * 1.4, 0, 0, 0], PALETTE.bark]]; // 灰
  for (let i = 0; i < FIRE_STONES; i++) {
    const a = ((i + wobble(rand, 0.1)) / FIRE_STONES) * Math.PI * 2;
    out.push(fireStone(rand, a, FIRE_RING + wobble(rand, 0.02), 0.2 + rand() * 0.06, 0.13 + rand() * 0.07, 0.17 + rand() * 0.05));
  }
  for (let i = 0; i < FIRE_PEBBLES; i++) {
    const a = ((i + 0.5 + wobble(rand, 0.15)) / FIRE_PEBBLES) * Math.PI * 2;
    out.push(fireStone(rand, a, FIRE_RING + 0.09 + rand() * 0.03, 0.1 + rand() * 0.05, 0.07 + rand() * 0.04, 0.09 + rand() * 0.04));
  }
  // 薪は根元を輪の内側に少し埋め、先を真ん中の少し向こうまで伸ばして寄り合わせる
  for (let i = 0; i < FIRE_LOGS; i++) {
    const a = ((i + 0.5) / FIRE_LOGS) * Math.PI * 2 + wobble(rand, 0.25);
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const r = FIRE_LOG_R * (0.8 + rand() * 0.4);
    const base = FIRE_LOG_BASE + wobble(rand, 0.03);
    const from = new THREE.Vector3(sx * base, -0.02, sz * base);
    const past = 0.03 + rand() * 0.04; // 先が真ん中を越える長さ
    const side = wobble(rand, 0.04); // 先を少し横へずらして、薪どうしが重ならないように
    const to = new THREE.Vector3(-sx * past + sz * side, FIRE_LOG_TOP + wobble(rand, 0.05), -sz * past - sx * side);
    const dir = to.clone().sub(from);
    const charAt = from.clone().addScaledVector(dir, 1 - FIRE_LOG_CHAR);
    const wood = shadeColor(i % 2 === 0 ? PALETTE.trunk : PALETTE.bark, 0.9 + rand() * 0.2);
    out.push(rod(from, charAt, r, wood));
    // 焦げた先は、根元の部分の先の太さから続ける
    out.push(rod(charAt, to, r * (1 - (1 - FIRE_LOG_TAPER) * (1 - FIRE_LOG_CHAR)), CHAR_COLOR));
    // 根元の切り口：少しだけ外へはみ出した、明るい色の輪切り
    out.push(rod(from.clone().addScaledVector(dir, -0.012 / dir.length()), from, r * 0.85, CUT_COLOR));
    if (rand() < 0.5) {
      // 枝を払った跡の短い出っ張り
      const at = from.clone().addScaledVector(dir, 0.3 + rand() * 0.25);
      const stub = new THREE.Vector3(sx, 0.6, sz).normalize().multiplyScalar(0.06 + rand() * 0.03);
      out.push(rod(at, at.clone().add(stub), r * 0.4, wood));
    }
  }
  // 灰の上に転がる、燃え残りの小枝
  for (let i = 0; i < FIRE_TWIGS; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.08 + rand() * 0.12;
    const at = new THREE.Vector3(Math.sin(a) * d, 0.035, Math.cos(a) * d);
    const t = a + Math.PI / 2 + wobble(rand, 0.6);
    const half = new THREE.Vector3(Math.sin(t), 0, Math.cos(t)).multiplyScalar(0.08 + rand() * 0.05);
    out.push(rod(at.clone().sub(half), at.clone().add(half), 0.012, i === 0 ? CHAR_COLOR : PALETTE.bark));
  }
  return out;
}

/** 階段の当たり判定の箱：-Z へ向かって上る段（2マス分。置ける場所・積む高さ・底面の大きさに使う。歩く面は stairRamp()） */
function stairParts(): Part[] {
  const depth = STAIR_LEN / STAIR_STEPS;
  return Array.from({ length: STAIR_STEPS }, (_, i): Part => [CELL, (WALL_H / STAIR_STEPS) * (i + 1), depth, 0, 0, STAIR_LEN / 2 - depth * (i + 0.5)]);
}

/**
 * 階段の歩く面：踏み板の真ん中を通る坂と、奥の平らな踊り場の凸包。
 * 段の箱の凸包だと、手前に段差（1段の高さ）が立ち、坂も踏み板の角を通って急になるので、
 * 坂を踏み板の奥行きの半分だけ下げて、手前の段差を自動で上れる高さにする
 */
function stairRamp(): number[] {
  const steps = stairParts();
  const [, rise, depth] = steps[0];
  const slope = rise / depth;
  const lip = rise - (STAIR_TREAD_D / 2) * slope; // 手前の段差の高さ
  const top = WALL_H;
  const h = STAIR_LEN / 2;
  const topZ = h - (top - lip) / slope; // 坂が踊り場の高さに届く所
  const pts: number[] = [];
  for (const x of [-CELL / 2, CELL / 2]) pts.push(x, 0, h, x, 0, -h, x, lip, h, x, top, topZ, x, top, -h);
  return pts;
}

/** 入口のある壁の当たり判定：左右の柱と、入口の上の梁 */
function doorwayParts(): Part[] {
  const side = (CELL + WALL_T - DOOR_W) / 2; // 入口の脇の壁の幅（両端は角の柱の外側まで）
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

/**
 * 製図台の天板の飾り：生成りの海図（海の中に島が2つ、方位の印、島をつなぐ航路）と、角に置いたインク壺と羽ペン、
 * 棚に寝かせた巻いた地図
 */
function draftingDetails(): THREE.Object3D {
  const sheet = 0.008;
  const ink = (w: number, d: number, x: number, z: number, ry = 0) => new THREE.BoxGeometry(w, 0.002, d).rotateY(ry).translate(x, sheet + 0.001, z);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(CHART_W, sheet, CHART_D).translate(0, sheet / 2, 0), flat(PALETTE.sand));
  const sea = new THREE.Mesh(new THREE.BoxGeometry(CHART_W - 0.12, 0.002, CHART_D - 0.12).translate(0, sheet + 0.0005, 0), flat(PALETTE.sky));
  const isle = (rx: number, rz: number, x: number, z: number) => new THREE.CylinderGeometry(1, 1, 0.003, 12).scale(rx, 1, rz).translate(x, sheet + 0.002, z);
  const land = new THREE.Mesh(mergeGeometries([isle(0.16, 0.1, -0.3, 0.05), isle(0.1, 0.08, 0.28, -0.12)])!, flat(PALETTE.grass));
  const lines = new THREE.Mesh(
    mergeGeometries([
      // 島から島への航路（点線）
      ...[0, 1, 2, 3, 4].map((i) => ink(0.05, 0.012, -0.14 + i * 0.075, 0.02 - i * 0.03, 0.38)),
      // 方位の印（十字）
      ink(0.16, 0.012, 0.42, 0.18),
      ink(0.012, 0.16, 0.42, 0.18),
    ])!,
    flat(PALETTE.bark),
  );
  const top = new THREE.Group();
  for (const m of [paper, sea, land, lines]) {
    m.receiveShadow = true;
    top.add(m);
  }
  top.position.set(0, BENCH_H, 0);
  top.rotation.y = CHART_TURN;

  // インク壺と羽ペン（天板の右奥の角）
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 10).translate(0, 0.04, 0), flat(PALETTE.bark));
  const quill = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.05).translate(0, 0.13, 0), flat(PALETTE.sand));
  quill.rotation.z = -0.35;
  quill.position.set(0.01, 0.05, 0);
  const pen = new THREE.Group();
  pen.add(pot, quill);
  pen.position.set(BENCH_W / 2 - 0.12, BENCH_H, -BENCH_D / 2 + 0.1);
  for (const m of [pot, quill]) m.castShadow = true;

  // 棚に寝かせた、巻いた地図
  const rolls = new THREE.Group();
  for (let i = 0; i < SCROLLS; i++) {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, BENCH_W * 0.6, 10).rotateZ(Math.PI / 2), flat(i === 1 ? PALETTE.sky : PALETTE.sand));
    roll.position.set((i - 1) * 0.06, 0.43, (i - 1) * 0.12);
    roll.rotation.y = (i - 1) * 0.08;
    roll.castShadow = true;
    rolls.add(roll);
  }

  const g = new THREE.Group();
  g.add(top, pen, rolls);
  return g;
}

export const PIECES: PieceDef[] = [
  define({ id: 'workbench', snap: 'free', color: PALETTE.trunk, look: workbenchLook, collision: workbenchParts(), platform: false, hp: 6, details: blueprint, wood: true }),
  define({ id: 'draftingTable', snap: 'free', color: PALETTE.trunk, look: workbenchLook, collision: workbenchParts(), platform: false, hp: 6, details: draftingDetails, wood: true }),
  define({ id: 'floor', snap: 'cell', color: PALETTE.trunk, look: floorLook, collision: [[CELL, FLOOR_H, CELL, 0, 0, 0]], platform: true, hp: 8, wood: true }),
  define({ id: 'wall', snap: 'edge', color: PALETTE.trunk, look: wallLook, collision: [[CELL + WALL_T, WALL_H, WALL_T, 0, 0, 0]], platform: false, hp: 10, wood: true }),
  define({ id: 'doorway', snap: 'edge', color: PALETTE.trunk, look: doorwayLook, collision: doorwayParts(), platform: false, hp: 10, wood: true }),
  define({ id: 'pillar', snap: 'corner', color: PALETTE.trunk, look: pillarLook, collision: [[PILLAR_W, WALL_H, PILLAR_W, 0, 0, 0]], legs: PILLAR_LEGS, platform: false, hp: 8, wood: true }),
  define({ id: 'fence', snap: 'edge', color: PALETTE.trunk, look: fenceLook, collision: [[CELL + FENCE_T, 1, FENCE_T, 0, 0, 0]], platform: false, hp: 4, wood: true }),
  define({ id: 'stairs', snap: 'cell', color: PALETTE.trunk, look: stairsLook, collision: stairParts(), ramp: stairRamp(), cells: STAIR_CELLS, platform: false, hp: 8, wood: true }),
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
  define({
    id: 'campfire',
    snap: 'free',
    color: PALETTE.rock,
    look: campfireLook,
    collision: [[FIRE_RING * 2 + 0.2, FIRE_H, FIRE_RING * 2 + 0.2, 0, 0, 0]],
    platform: false,
    hp: 4,
  }),
];
const PIECE_BY_ID = new Map<string, PieceDef>(PIECES.map((d) => [d.id, d]));

/** id が部材ならその定義（アイテムやセーブデータの id から引く） */
export function pieceDef(id: string): PieceDef | undefined {
  return PIECE_BY_ID.get(id);
}

/** 置いた部材を描くマテリアル（木目を重ねる部材は woodVertex()） */
export function pieceMaterial(def: PieceSpec): THREE.Material {
  return def.wood ? woodVertex() : flatVertex();
}

/** アイコン用の部材のモデル。脚は地面に埋まる部分なので描かない */
export function pieceIconModel(id: PieceId): THREE.Object3D {
  const def = PIECE_BY_ID.get(id)!;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeLooks(def.look(lookRand(id, 0))), pieceMaterial(def)));
  if (def.details) g.add(def.details());
  g.rotation.set(id === 'campfire' ? 0.7 : 0.45, id === 'stairs' ? 2.4 : -0.6, 0);
  return g;
}
