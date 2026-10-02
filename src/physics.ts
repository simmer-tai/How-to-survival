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
const G = { ground: 0x1, wood: 0x2, player: 0x4, piece: 0x8 };
const groups = (member: number, filter: number) => (member << 16) | filter;
export const COLLIDE = {
  /** 地形・岩・桟橋 */
  ground: groups(G.ground, 0xffff),
  /** 木の幹・丸太 */
  wood: groups(G.wood, G.ground | G.wood | G.player | G.piece),
  player: groups(G.player, G.ground | G.wood | G.piece),
  piece: groups(G.piece, G.ground | G.wood | G.player | G.piece),
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
  private readonly links = new Map<RAPIER.RigidBody, THREE.Object3D>();
  private readonly floaters: Floater[] = [];

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  /** 描画している地形の三角形そのものを当たり判定にする */
  addTerrain(mesh: THREE.Mesh): void {
    const vertices = mesh.geometry.getAttribute('position').array as Float32Array;
    const indices = Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i);
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setCollisionGroups(COLLIDE.ground)
      .setFriction(0.9);
    this.world.createCollider(desc, this.ground);
  }

  /** 動かない物（岩・桟橋など）を形どおりの凸包で置く */
  addStatic(mesh: THREE.Mesh): void {
    const desc = hullDesc(mesh, new THREE.Matrix4()).setCollisionGroups(COLLIDE.ground).setFriction(0.8);
    this.world.createCollider(desc, this.ground);
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
      if (!body.isDynamic()) continue;
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
