import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { waveOffset } from './waves.js';

export { RAPIER };

export const GRAVITY = 20;
export const WATER_LEVEL = 0;

/** 海の水が来ない所（洞窟の中）。今いる場所が変わったら入れ替える */
let dryZone: ((x: number, z: number) => boolean) | null = null;

/** 今いる場所の、海の水が来ない所を決める（なければ null） */
export function setDryZone(fn: ((x: number, z: number) => boolean) | null): void {
  dryZone = fn;
}

/** (x, z) の海の水面の高さ。海の水が来ない所（洞窟の中）では -Infinity（泳がず、浮かばない） */
export function seaSurface(x: number, z: number): number {
  return dryZone?.(x, z) ? -Infinity : WATER_LEVEL + waveOffset(x, z);
}
const BUOYANCY = 1.7; // 完全に沈んだときの浮力（重力の何倍か）
const WATER_DRAG = 1.5;
const WATER_DRAG_VERTICAL = 8; // 上下の揺れはすぐ収まるように強め

// 衝突グループ（上位16bit：所属、下位16bit：ぶつかる相手）
const G = { ground: 0x1, wood: 0x2, player: 0x4, piece: 0x8, drop: 0x10 };
const groups = (member: number, filter: number) => (member << 16) | filter;
export const COLLIDE = {
  /** 地形・岩・桟橋 */
  ground: groups(G.ground, 0xffff),
  /** 木の幹・丸太 */
  wood: groups(G.wood, G.ground | G.wood | G.player | G.piece | G.drop),
  player: groups(G.player, G.ground | G.wood | G.piece),
  /** 建築物 */
  piece: groups(G.piece, G.ground | G.wood | G.player | G.piece | G.drop),
  /** 落ちている物。プレイヤーとはぶつからない（すり抜けて歩ける） */
  drop: groups(G.drop, G.ground | G.wood | G.piece | G.drop),
  /** 部材を置けるか調べる問い合わせ。部材どうしの重なりはグリッドで調べるので、ここでは部材以外とだけ比べる */
  placeQuery: groups(G.piece, G.ground | G.wood | G.player),
  /** 船を浮かべられるか調べる問い合わせ。船は ground の仲間なので、地形・岩・桟橋・ほかの船・丸太・プレイヤー・部材と比べる（落とし物は押しのけるので見ない） */
  boatQuery: groups(G.ground, G.ground | G.wood | G.player | G.piece),
  /** 漕いでいる船が進めるか調べる問い合わせ。地形以外の動かない物（岩・桟橋・ほかの船）と部材にだけ止められる（丸太や落とし物は押しのけ、プレイヤーとは比べない） */
  boatMove: groups(G.ground, G.ground | G.piece),
  /** 頭の上に雨よけがあるか調べる問い合わせ。地形・岩・桟橋・街の建物と部材に当たる（木の幹・丸太は雨よけにしない） */
  shelterQuery: groups(G.player, G.ground | G.piece),
};

const tmpMatrix = new THREE.Matrix4();
const tmpVec = new THREE.Vector3();

/** mesh の形を、frameInverse を基準にした凸包コライダーにする。minY より下の点は持ち上げる */
export function hullDesc(mesh: THREE.Mesh, frameInverse: THREE.Matrix4, minY = -Infinity): RAPIER.ColliderDesc {
  mesh.updateWorldMatrix(true, false);
  tmpMatrix.multiplyMatrices(frameInverse, mesh.matrixWorld);
  const pos = mesh.geometry.getAttribute('position');
  const points = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    tmpVec.fromBufferAttribute(pos, i).applyMatrix4(tmpMatrix);
    points.set([tmpVec.x, Math.max(tmpVec.y, minY), tmpVec.z], i * 3);
  }
  const desc = RAPIER.ColliderDesc.convexHull(points);
  if (!desc) throw new Error('convex hull failed');
  return desc;
}

interface Floater { body: RAPIER.RigidBody; radius: number }

/** Rapier のワールドと、剛体 → 見た目（Object3D）の同期 */
export class Physics {
  readonly world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  /** 地形などの動かないコライダーをまとめて持つ剛体（原点） */
  readonly ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  /** 地形のコライダー（addTerrain で作る） */
  terrainCollider: RAPIER.Collider | null = null;
  private readonly links = new Map<RAPIER.RigidBody, THREE.Object3D>();
  private readonly floaters: Floater[] = [];
  /** プレイヤーが今いる場所（world/location.ts の LocationId）。ほかの場所の剛体は止めておく */
  private here = 'island';
  /** within() の中で、今作っている剛体がどの場所の物か（null なら今いる場所） */
  private scope: string | null = null;
  /** 場所ごとの、止めている剛体 */
  private readonly parkedAt = new Map<string, RAPIER.RigidBody[]>();

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    // 今いない場所の剛体として作られた物は、作ったその場で止める（その場所へ移ったときに動かし直す）。
    // ほかの人が別の島で切った木の丸太・落とした物などが、今いる場所の物とぶつからないように
    const create = this.world.createRigidBody.bind(this.world);
    this.world.createRigidBody = (desc) => {
      const body = create(desc);
      const loc = this.scope ?? this.here;
      if (loc !== this.here && body.isEnabled()) {
        body.setEnabled(false);
        this.parked(loc).push(body);
      }
      return body;
    };
  }

  /** fn の中で作った剛体を、場所 loc の物にする（今いない場所なら止めておく） */
  within<T>(loc: string, fn: () => T): T {
    const prev = this.scope;
    this.scope = loc;
    try {
      return fn();
    } finally {
      this.scope = prev;
    }
  }

  /** プレイヤーが場所 loc へ移る。今の場所の剛体を止め（keep に当てはまる物は残す）、loc で止めていた剛体を動かし直す */
  moveTo(loc: string, keep: (body: RAPIER.RigidBody) => boolean): void {
    if (loc === this.here) return;
    this.parked(this.here).push(...this.park(keep));
    this.unpark(this.parked(loc));
    this.parkedAt.delete(loc);
    this.here = loc;
  }

  private parked(loc: string): RAPIER.RigidBody[] {
    let list = this.parkedAt.get(loc);
    if (!list) this.parkedAt.set(loc, (list = []));
    return list;
  }

  /**
   * 描画している地形の三角形そのものを当たり判定にする。body は付ける剛体（街など別の場所の物は、その場所の剛体に付ける）。
   * 自分の島の地形（body を省いたとき）は terrainCollider にもする
   */
  addTerrain(mesh: THREE.Mesh, body: RAPIER.RigidBody = this.ground): RAPIER.Collider {
    const vertices = mesh.geometry.getAttribute('position').array as Float32Array;
    const indices = Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i);
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setCollisionGroups(COLLIDE.ground)
      .setFriction(0.9);
    const collider = this.world.createCollider(desc, body);
    if (body === this.ground) this.terrainCollider = collider;
    return collider;
  }

  /** 動かない物（岩・桟橋など）を形どおりの凸包で置く。body は付ける剛体 */
  addStatic(mesh: THREE.Mesh, body: RAPIER.RigidBody = this.ground): RAPIER.Collider {
    const desc = hullDesc(mesh, new THREE.Matrix4()).setCollisionGroups(COLLIDE.ground).setFriction(0.8);
    return this.world.createCollider(desc, body);
  }

  /** keep に当てはまらない、動いている剛体をすべて止める（プレイヤーが別の場所へ移るとき）。止めた剛体を返す */
  park(keep: (body: RAPIER.RigidBody) => boolean): RAPIER.RigidBody[] {
    const parked: RAPIER.RigidBody[] = [];
    this.world.bodies.forEach((body) => {
      if (!body.isEnabled() || keep(body)) return;
      body.setEnabled(false);
      parked.push(body);
    });
    return parked;
  }

  /**
   * park で止めた剛体を動かし直す（止めている間に消えた剛体は飛ばす）。
   * 消えた剛体の番号（handle）は新しい剛体が使い回すことがあるので、番号でなく同じ剛体かどうかで確かめる
   */
  unpark(parked: RAPIER.RigidBody[]): void {
    for (const body of parked) if (this.world.bodies.get(body.handle) === body) body.setEnabled(true);
  }

  /** 剛体の位置・向きを毎フレーム object に写す */
  link(body: RAPIER.RigidBody, object: THREE.Object3D): void {
    this.links.set(body, object);
  }

  /** 水に浮く剛体として登録する（radius はおおよその太さ） */
  addFloater(body: RAPIER.RigidBody, radius: number): void {
    this.floaters.push({ body, radius });
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.links.delete(body);
    const i = this.floaters.findIndex((f) => f.body === body);
    if (i >= 0) this.floaters.splice(i, 1);
    this.world.removeRigidBody(body);
  }

  step(dt: number): void {
    for (const { body, radius } of this.floaters) {
      if (!body.isDynamic() || !body.isEnabled()) continue;
      const com = body.worldCom();
      const depth = seaSurface(com.x, com.z) - com.y; // 波に合わせて上下する
      const k = THREE.MathUtils.clamp(depth / (2 * radius) + 0.5, 0, 1); // 沈んでいる割合
      if (k <= 0) continue;
      const m = body.mass();
      const v = body.linvel();
      const drag = m * WATER_DRAG * k * dt;
      const lift = m * GRAVITY * BUOYANCY * k * dt - v.y * m * WATER_DRAG_VERTICAL * k * dt;
      body.applyImpulse({ x: -v.x * drag, y: lift, z: -v.z * drag }, true);
      const w = body.angvel();
      const spin = 1 - Math.min(WATER_DRAG * k * dt, 1);
      body.setAngvel({ x: w.x * spin, y: w.y * spin, z: w.z * spin }, true);
    }

    this.world.timestep = dt;
    this.world.step();

    for (const [body, object] of this.links) {
      const t = body.translation();
      const r = body.rotation();
      object.position.set(t.x, t.y, t.z);
      object.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
