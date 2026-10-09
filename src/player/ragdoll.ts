import * as THREE from 'three';

// 力尽きた体のラグドール（崩れ落ちて、地面に横たわる）。見た目だけの演出で、各自の画面で計算する（同期しない・セーブしない）。
// 体の関節を点にして、点どうしの長さを保ちながら重力で落とす（ベルレ積分）。点は地面（建てた床も）より下へは沈まず、水の中では浮く。
// 計算した点の位置から、アバターの関節の向きを決め直す。Rapier の剛体は使わない（落とし物などの物理に混ざらないように）

const GRAVITY = 9.8; // 重力（m/秒²）
const STEP = 1 / 60; // 1回の計算で進める時間（秒）
const MAX_STEPS = 4; // 1フレームで計算する回数の上限（重いフレームで追いつこうとしすぎない）
const ITERATIONS = 10; // 長さをそろえ直す回数（多いほど体が伸び縮みしない）
const DAMPING = 0.985; // 1回の計算で残す速さの割合（空気の抵抗）
const RADIUS = 0.07; // 点の太さ（地面からこれだけ浮かせる。m）
const FRICTION = 0.5; // 地面に触れている点の、横の速さを残す割合
const PUSH = 1.4; // 倒れはじめに、上半身を倒れる向きへ押す速さ（m/秒。頭のあたりで）
const KNEE_BUCKLE = 0.8; // 倒れはじめに、膝を前へ折る速さ（m/秒）
const BUOYANCY = 12; // 水の中で受ける浮く力（m/秒²。重力より少し大きいので浮いてくる）
const WATER_DAMPING = 0.9; // 水の中で1回の計算で残す速さの割合
const SETTLE_TIME = 6; // 倒れてからこれだけたつと、計算をやめて止める（秒）
const HEAD_TOP = 0.2; // 頭の点を置く、首の付け根からの高さ（m）
const ARM_MIN = 0.55; // 腕を折りたたんでも、肩から手首までをこの割合（腕の長さに対する）より近づけない
const LEG_MIN = 0.6; // 脚を折りたたんでも、付け根から足首までをこの割合（脚の長さに対する）より近づけない

/** 地面と水面の高さ（main が決める。地面は建てた床なども含む） */
export interface RagdollEnv {
  /** (x, z) の、y より下にある地面の高さ（見つからなければ -Infinity） */
  ground(x: number, y: number, z: number): number;
  /** (x, z) の水面の高さ（水がなければ -Infinity） */
  water(x: number, z: number): number;
}

let env: RagdollEnv = { ground: () => -Infinity, water: () => -Infinity };

/** 地面と水面の高さの調べ方を決める（main が一度だけ呼ぶ） */
export function setRagdollEnv(e: RagdollEnv): void {
  env = e;
}

/** ラグドールで動かす体の関節（アバターの Rig と同じ形。[0] が右、[1] が左） */
export interface RagdollRig {
  hips: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  shoulders: THREE.Group[];
  elbows: THREE.Group[];
  thighs: THREE.Group[];
  knees: THREE.Group[];
  ankles: THREE.Group[];
  /** 持ち物を付ける所（親が手首） */
  holders: THREE.Group[];
}

// 点の番号：腰・首・頭、肩・肘・手首・脚の付け根・膝・足首（どれも [右, 左]）
const P = 0;
const N = 1;
const H = 2;
const S = [3, 4];
const E = [5, 6];
const W = [7, 8];
const T = [9, 10];
const K = [11, 12];
const A = [13, 14];
const COUNT = 15;

/** 点どうしの長さの決まり。min は「これより近づけない」だけ */
interface Link { a: number; b: number; length: number; min: boolean }

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();

export class Ragdoll {
  private readonly pos: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly links: Link[] = [];
  private time = 0;
  private carry = 0;

  /**
   * いまの体の姿勢から始める。velocity は倒れはじめの体の速さ、fall は倒れる向き（水平）
   */
  constructor(private readonly rig: RagdollRig, root: THREE.Object3D, velocity: THREE.Vector3, fall: THREE.Vector3) {
    root.updateMatrixWorld(true);
    const at = (o: THREE.Object3D, y = 0) => o.localToWorld(new THREE.Vector3(0, y, 0));
    this.pos[P] = at(rig.hips);
    this.pos[N] = at(rig.neck);
    this.pos[H] = at(rig.head, HEAD_TOP);
    for (const i of [0, 1]) {
      this.pos[S[i]] = at(rig.shoulders[i]);
      this.pos[E[i]] = at(rig.elbows[i]);
      this.pos[W[i]] = at(rig.holders[i].parent!); // 手首（持ち物を付ける所の親）
      this.pos[T[i]] = at(rig.thighs[i]);
      this.pos[K[i]] = at(rig.knees[i]);
      this.pos[A[i]] = at(rig.ankles[i]);
    }
    // 速さ：体ごと動いていた速さに、上半身を倒れる向きへ押す速さと、膝を折る速さを足す
    const foot = Math.min(this.pos[A[0]].y, this.pos[A[1]].y);
    const tall = Math.max(0.1, this.pos[H].y - foot);
    for (let i = 0; i < COUNT; i++) {
      const v = velocity.clone().addScaledVector(fall, (PUSH * (this.pos[i].y - foot)) / tall);
      if (i === K[0] || i === K[1]) v.addScaledVector(fall, KNEE_BUCKLE);
      this.prev[i] = this.pos[i].clone().addScaledVector(v, -STEP);
    }
    // 骨：首から頭、腕、脚
    const bone = (a: number, b: number, min = false) => this.links.push({ a, b, length: this.pos[a].distanceTo(this.pos[b]), min });
    bone(N, H);
    for (const i of [0, 1]) {
      bone(S[i], E[i]);
      bone(E[i], W[i]);
      bone(T[i], K[i]);
      bone(K[i], A[i]);
      // 肘・膝を折りたたみすぎない
      const arm = this.pos[S[i]].distanceTo(this.pos[E[i]]) + this.pos[E[i]].distanceTo(this.pos[W[i]]);
      this.links.push({ a: S[i], b: W[i], length: arm * ARM_MIN, min: true });
      const leg = this.pos[T[i]].distanceTo(this.pos[K[i]]) + this.pos[K[i]].distanceTo(this.pos[A[i]]);
      this.links.push({ a: T[i], b: A[i], length: leg * LEG_MIN, min: true });
      // 頭を胸へめり込ませない
      bone(H, S[i], true);
    }
    // 胴体は曲がらない箱にする（腰・首・両肩・両脚の付け根のすべての組）
    const torso = [P, N, S[0], S[1], T[0], T[1]];
    for (let i = 0; i < torso.length; i++) for (let j = i + 1; j < torso.length; j++) bone(torso[i], torso[j]);
  }

  /** 腰の位置（カメラが見る所） */
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos[P]);
  }

  /** 時間を進める */
  step(dt: number): void {
    if (this.time > SETTLE_TIME) return;
    this.time += dt;
    this.carry = Math.min(this.carry + dt, STEP * MAX_STEPS);
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.integrate();
    }
  }

  private integrate(): void {
    const ground: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      const p = this.pos[i];
      const prev = this.prev[i];
      const wet = p.y < env.water(p.x, p.z);
      const keep = wet ? WATER_DAMPING : DAMPING;
      const vx = (p.x - prev.x) * keep;
      const vy = (p.y - prev.y) * keep;
      const vz = (p.z - prev.z) * keep;
      prev.copy(p);
      const ay = wet ? BUOYANCY - GRAVITY : -GRAVITY;
      p.set(p.x + vx, p.y + vy + ay * STEP * STEP, p.z + vz);
      ground[i] = env.ground(p.x, Math.max(p.y, prev.y) + 0.5, p.z) + RADIUS;
    }
    for (let k = 0; k < ITERATIONS; k++) {
      for (const l of this.links) {
        const a = this.pos[l.a];
        const b = this.pos[l.b];
        v1.subVectors(b, a);
        const d = v1.length();
        if (d < 1e-6 || (l.min && d >= l.length)) continue;
        v1.multiplyScalar((d - l.length) / d / 2);
        a.add(v1);
        b.sub(v1);
      }
      for (let i = 0; i < COUNT; i++) {
        const p = this.pos[i];
        if (p.y >= ground[i]) continue;
        p.y = ground[i];
        // 地面に触れた点は、横へすべりにくくする
        const prev = this.prev[i];
        prev.x = p.x - (p.x - prev.x) * FRICTION;
        prev.z = p.z - (p.z - prev.z) * FRICTION;
      }
    }
  }

  /**
   * 点の位置に合わせて体を置く。root はアバターの一番外の台（腰の位置へ動かす）、
   * inner はその中の、腰までの台（向きを消す）
   */
  apply(root: THREE.Object3D, inner: THREE.Object3D[]): void {
    const r = this.rig;
    root.position.copy(this.pos[P]);
    root.quaternion.identity();
    for (const o of inner) o.quaternion.identity();
    root.updateMatrixWorld(true);
    // 腰をいまの腰の点へ置いてから、腰と胸の向きを、両脚の付け根・両肩と首の点から決める
    r.hips.position.copy(r.hips.parent!.worldToLocal(this.pos[P].clone()));
    this.orient(r.hips, this.pos[T[1]], this.pos[T[0]]);
    this.orient(r.spine, this.pos[S[1]], this.pos[S[0]]);
    for (const i of [0, 1]) {
      aim(r.thighs[i], this.pos[K[i]], DOWN);
      aim(r.knees[i], this.pos[A[i]], DOWN);
      r.ankles[i].quaternion.identity();
      aim(r.shoulders[i], this.pos[E[i]], DOWN);
      aim(r.elbows[i], this.pos[W[i]], DOWN);
    }
    aim(r.neck, this.pos[H], UP);
    r.head.quaternion.identity();
  }

  /** 体の正面を +Z、上を首へ、左を +X にして、関節 joint の向きを決める（left・right は左右の点） */
  private orient(joint: THREE.Object3D, left: THREE.Vector3, right: THREE.Vector3): void {
    const x = v1.subVectors(left, right).normalize();
    const y = v2.subVectors(this.pos[N], this.pos[P]).normalize();
    const z = v3.crossVectors(x, y).normalize();
    x.crossVectors(y, z);
    q1.setFromRotationMatrix(m1.makeBasis(x, y, z));
    joint.parent!.getWorldQuaternion(q2);
    joint.quaternion.copy(q2.invert().multiply(q1));
    joint.updateMatrixWorld(true);
  }
}

/** 関節 joint の axis（関節の中での手足の向き）が、target の点を向くようにする */
function aim(joint: THREE.Object3D, target: THREE.Vector3, axis: THREE.Vector3): void {
  joint.parent!.updateWorldMatrix(true, false);
  const from = joint.getWorldPosition(v1);
  const dir = v2.subVectors(target, from);
  if (dir.lengthSq() < 1e-8) return;
  joint.parent!.getWorldQuaternion(q2);
  dir.normalize().applyQuaternion(q2.invert());
  joint.quaternion.setFromUnitVectors(axis, dir);
  joint.updateMatrixWorld(true);
}

/** ラグドールをやめて立ち上がるときに、関節の向きを元に戻す（ふだんの動きは回転の一部しか書き直さないので） */
export function resetRig(rig: RagdollRig): void {
  for (const o of [rig.hips, rig.spine, rig.neck, rig.head, ...rig.shoulders, ...rig.elbows, ...rig.thighs, ...rig.knees, ...rig.ankles]) {
    o.quaternion.identity();
  }
}
