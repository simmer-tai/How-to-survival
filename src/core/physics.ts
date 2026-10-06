import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { waveOffset } from './waves.js';

export { RAPIER };

export const GRAVITY = 20;
export const WATER_LEVEL = 0;
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

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
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

  /** park で止めた剛体を動かし直す（止めている間に消えた剛体は飛ばす） */
  unpark(parked: RAPIER.RigidBody[]): void {
    for (const body of parked) if (this.world.bodies.contains(body.handle)) body.setEnabled(true);
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
      const depth = WATER_LEVEL + waveOffset(com.x, com.z) - com.y; // 波に合わせて上下する
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
