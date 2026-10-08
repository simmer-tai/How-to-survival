import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { townVertex } from '../core/materials.js';

// 街の石積み・建物・小物を組み立てる道具（town.ts と house.ts で使う）

const WOOD_HUE = [0.04, 0.09]; // 木材とみる色合い（HSL の色相。茶色の幅）。幹・木組みの色はこの中に入り、砂・布・赤い実は外れる
const WOOD_SATURATION = 0.25; // これより鮮やかな茶色を木材とみる（石や鉄の灰色は外れる）
const WET_LINE = 0.25; // これより低い石は濡れて藻が付いた色にする

export const BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
/** 箱の面の名前（BoxGeometry の面の並び順） */
export type Side = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const SIDES: Side[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const boxCache = new Map<string, THREE.BufferGeometry>();
/** 見えない面（地面に付いた底や、壁に埋まった裏など）を省いた箱。描く三角形を減らすため */
export function boxWithout(skip: Side[]): THREE.BufferGeometry {
  const key = skip.join();
  let geo = boxCache.get(key);
  if (!geo) {
    const src = BOX.getAttribute('position');
    const keep: number[] = [];
    SIDES.forEach((side, f) => {
      if (skip.includes(side)) return;
      for (let i = f * 6; i < f * 6 + 6; i++) keep.push(src.getX(i), src.getY(i), src.getZ(i));
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    boxCache.set(key, geo);
  }
  return geo;
}
/** 上面だけ（敷石など、上からしか見えない物） */
export const TOP_ONLY: Side[] = ['px', 'nx', 'ny', 'pz', 'nz'];
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 10).toNonIndexed();
export const CYL_LOW = new THREE.CylinderGeometry(1, 1, 1, 7).toNonIndexed();
export const BALL = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();

/** 三角柱（切妻の壁の三角の部分）。底辺は X が -0.5〜0.5・Y = 0、頂点は Y = 1、厚みは Z が -0.5〜0.5 */
export const PRISM = (() => {
  const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -0.5);
  return geo.toNonIndexed();
})();

/** 石の色（stoneColor() で作った色と markStone() した色）。これで塗った所に石のドット絵を付ける */
const STONE_COLORS = new WeakSet<THREE.Color>();

/** この色を石の色として印を付ける（石板の屋根など、stoneColor() を通さずに作る石の色に使う） */
export function markStone(c: THREE.Color): THREE.Color {
  STONE_COLORS.add(c);
  return c;
}

/** たくさんの石や木箱を、頂点の色を変えて1つのメッシュにまとめる（描く回数を減らすため） */
export class Batch {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  /** 頂点ごとに石か（1 が石） */
  private readonly stones: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly s = new THREE.Vector3();

  /** geo を (x, y, z) に置き、s の大きさにして、Y 軸まわりに rotY 回す */
  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, rotY = 0, tilt = 0): void {
    this.q.setFromEuler(this.euler.set(tilt, rotY, tilt * 0.6));
    this.addMatrix(geo, this.m.compose(new THREE.Vector3(x, y, z), this.q, this.s.set(sx, sy, sz)), color);
  }

  /** geo を行列 m で動かして足す */
  addMatrix(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color): void {
    const pos = geo.getAttribute('position');
    const stone = STONE_COLORS.has(color) ? 1 : 0;
    for (let i = 0; i < pos.count; i++) {
      this.v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.positions.push(this.v.x, this.v.y, this.v.z);
      this.colors.push(color.r, color.g, color.b);
      this.stones.push(stone);
    }
  }

  /** 傾いた箱。ax・ay・az は箱の X・Y・Z が向く単位ベクトル（互いに直交し、右手系） */
  oriented(geo: THREE.BufferGeometry, c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3, sx: number, sy: number, sz: number, color: THREE.Color): void {
    this.m.makeBasis(ax, ay, az).scale(this.s.set(sx, sy, sz)).setPosition(c);
    this.addMatrix(geo, this.m, color);
  }

  /** p0 から p1 へ渡す角材。normal は角材の厚み（depth）の向き。幅は w */
  beam(p0: THREE.Vector3, p1: THREE.Vector3, normal: THREE.Vector3, w: number, depth: number, color: THREE.Color): void {
    const ax = p1.clone().sub(p0);
    const len = ax.length();
    ax.divideScalar(len);
    const ay = new THREE.Vector3().crossVectors(normal, ax);
    this.oriented(BOX, p0.clone().add(p1).multiplyScalar(0.5), ax, ay, normal, len, w, depth, color);
  }

  /** 下端 y0・上端 y1 の箱を置く。skip は描かない面 */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, skip: Side[] = []): void {
    const geo = skip.length ? boxWithout(skip) : BOX;
    this.add(geo, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color);
  }

  mesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    // 石の色で塗った所（石積み・石畳・石板）には石のドット絵、茶色の木材の所には木のドット絵を付ける（布・葉・漆喰は付けない）
    geo.setAttribute('aStone', new THREE.Float32BufferAttribute(this.stones, 1));
    const wood = new Float32Array(this.stones.length);
    const c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < wood.length; i++) {
      if (this.stones[i]) continue;
      c.fromArray(this.colors, i * 3).getHSL(hsl);
      wood[i] = hsl.h >= WOOD_HUE[0] && hsl.h <= WOOD_HUE[1] && hsl.s > WOOD_SATURATION ? 1 : 0;
    }
    geo.setAttribute('aWood', new THREE.BufferAttribute(wood, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, townVertex());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

export const ROCK = new THREE.Color(PALETTE.rock);
export const SAND = new THREE.Color(PALETTE.sand);
export const LEAF = new THREE.Color(PALETTE.leaf);
export const TRUNK = new THREE.Color(PALETTE.trunk);
export const BARK = new THREE.Color(PALETTE.bark);
export const GRASS = new THREE.Color(PALETTE.grass);
export const ACCENT = new THREE.Color(PALETTE.accent);
export const WATER = new THREE.Color(PALETTE.water);
export const MORTAR = markStone(ROCK.clone().multiplyScalar(0.5)); // 目地の奥に見える暗い色

/** 石の色。k は明るさ、y は高さ（低いと濡れて藻が付く） */
export function stoneColor(rand: () => number, k: number, y = 10): THREE.Color {
  const c = ROCK.clone();
  const tint = rand();
  if (tint < 0.25) c.lerp(SAND, 0.18 + rand() * 0.12); // 黄みがかった石
  else if (tint < 0.35) c.lerp(BARK, 0.12); // くすんだ石
  if (y < WET_LINE) c.lerp(LEAF, THREE.MathUtils.clamp((WET_LINE - y) * 0.5, 0.15, 0.4)).multiplyScalar(0.75);
  return markStone(c.multiplyScalar(k * (0.92 + rand() * 0.16)));
}

/** 当たり判定だけに使う、見えない箱を置く */
export function colliderBox(group: THREE.Group, solids: THREE.Mesh[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const mesh = new THREE.Mesh(BOX);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.scale.set(x1 - x0, y1 - y0, z1 - z0);
  mesh.visible = false;
  group.add(mesh);
  solids.push(mesh);
}

/** 当たり判定だけに使う、見えない円柱を置く（下端 y0） */
export function colliderCyl(group: THREE.Group, solids: THREE.Mesh[], x: number, y0: number, z: number, radius: number, h: number): void {
  const mesh = new THREE.Mesh(CYL_LOW);
  mesh.position.set(x, y0 + h / 2, z);
  mesh.scale.set(radius, h, radius);
  mesh.visible = false;
  group.add(mesh);
  solids.push(mesh);
}

/** 壁の面。軸に沿った線（along の範囲）と、外の向き */
export interface Face {
  /** 'x' なら面は X が一定（fixed）で Z に沿って伸びる。'z' なら Z が一定 */
  axis: 'x' | 'z';
  fixed: number;
  from: number;
  to: number;
  /** 外（海側・家の外）の向き（+1 / -1） */
  out: 1 | -1;
  /** 縁石を from・to の端から削る長さ（角で隣の面の縁石と重ならないように） */
  cut?: [number, number];
}

/** 面上の位置（along, 外への出っ張り）を X・Z にする */
export const facePoint = (f: Face, along: number, off: number): [number, number] =>
  f.axis === 'x' ? [f.fixed + f.out * off, along] : [along, f.fixed + f.out * off];

/** 面の裏（内側）を向いた箱の面の名前 */
export const backSide = (f: Face): Side => (f.axis === 'x' ? (f.out > 0 ? 'nx' : 'px') : f.out > 0 ? 'nz' : 'pz');

/** 面に沿った箱。along は a〜e、高さは y0〜y1、面からの出っ張りは off0〜off1 */
export function faceBox(b: Batch, f: Face, a: number, e: number, y0: number, y1: number, off0: number, off1: number, color: THREE.Color, skip: Side[] = []): void {
  const [x0, z0] = facePoint(f, a, off0);
  const [x1, z1] = facePoint(f, e, off1);
  b.box(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), color, skip);
}

/** 面の外向きの単位ベクトル */
export const faceNormal = (f: Face): THREE.Vector3 => (f.axis === 'x' ? new THREE.Vector3(f.out, 0, 0) : new THREE.Vector3(0, 0, f.out));

/** 面上の点（along, 高さ y, 出っ張り off）を3Dの点にする */
export function facePoint3(f: Face, along: number, y: number, off: number): THREE.Vector3 {
  const [x, z] = facePoint(f, along, off);
  return new THREE.Vector3(x, y, z);
}
