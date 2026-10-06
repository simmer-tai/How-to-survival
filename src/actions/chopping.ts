import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import type { Tree } from '../world/props.js';
import { RAPIER, COLLIDE, hullDesc, type Physics } from '../core/physics.js';
import type { ChopTree, OnIsle, Requester } from '../core/commands.js';

const REACH = 3.2; // 斧が届く距離
const LOG_REACH = 4.2; // 地面に横たわる丸太は少し遠くまで届く
const TREE_HP = 4; // 何回叩くと倒れるか
const LOG_HP = 3; // 倒れた丸太を何回叩くとばらせるか
const TOPPLE_SPIN = 0.9; // 倒れ始めの回転速度（あとは重力で倒れる）
const HINGE_RELEASE = 1.4; // 根元の支点を外す傾き（rad）。このとき葉が地面に着いたとみなす
const LANDING_DAMP = 0.25; // 葉が地面に着いて勢いが削がれる（速度に掛ける）
const SETTLE_TIME = 1.2; // 倒れ始めてから、葉が縮み始めるまでの最短時間
const SETTLE_TILT = 0.8; // これ以上傾いて止まったら「倒れきった」とみなす（rad）
const SETTLE_TIMEOUT = 4; // 引っかかって止まらなくても葉を消し始める時間
const LOG_HIT = { hop: 0.7, push: 0.05 }; // 丸太を叩いたときの跳ね上がり・押し出し（速度 m/s）
const LOG_DAMPING = { linear: 0.4, angular: 2.5 }; // 丸太が坂を転がり続けないように
const LEAF_SHRINK_TIME = 0.5;
const BREAK_TIME = 0.25; // 丸太がばらけて消えるまで
const CROWN_MASS = 1.2; // 葉の重さ（幹の何倍か）。当たり判定はないが、重心を高くして倒れやすくする
const TRUNK_FLOOR = 0.25; // 幹の当たり判定は根元からこの高さより上（地面に埋まった部分を除く）
const CHIP_COUNT = 6;
const PUNCH_CHIP_COUNT = 2; // 素手で殴ったときの木くず
const BREAK_CHIP_COUNT = 18;
const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const chipGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);

/** standing: 立っている → falling: 倒れて葉が縮む → log: 丸太 → breaking: ばらけて消える */
type Phase = 'standing' | 'falling' | 'log' | 'breaking';

interface TreeState {
  tree: Tree;
  phase: Phase;
  body: RAPIER.RigidBody;
  hinge: RAPIER.RigidBody | null; // 倒れている間、幹の根元の縁を支点として留めておく固定剛体
  base: THREE.Quaternion; // 立っているときの姿勢
  baseScale: number;
  leafScales: number[];
  hp: number;
  axis: THREE.Vector3; // 倒れる回転軸
  time: number; // 現フェーズに入ってからの時間
  shrinking: number; // 葉が縮み始めてからの時間（-1 ならまだ）
}

interface Chip { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }

/** セーブデータ上の木1本。null は丸太をばらして消えた木。log は倒れた丸太の位置・向き [x, y, z, qx, qy, qz, qw] */
export type TreeSave = { hp: number; log?: number[] } | null;

/**
 * 斧で木を叩いて切り倒し、倒れた丸太をばらして木材にする。
 * 叩く操作はワールドコマンド（chopTree）にして、木の番号で適用する。倒れる・転がる動きはホストの物理で決めて配る
 */
export class TreeChopper {
  private readonly states = new Map<THREE.Object3D, TreeState>();
  /** 木の番号 → 木。最初から島にある木は props の生成順の番号、種から育てた木はあとから addTree で足す */
  private readonly byId = new Map<number, THREE.Object3D>();
  private readonly idOf = new Map<THREE.Object3D, number>();
  /** 最初から島にある木の数（セーブデータの trees の並び） */
  private readonly fixedCount: number;
  private readonly raycaster = new THREE.Raycaster();
  private readonly chips: Chip[] = [];
  private readonly q = new THREE.Quaternion();

  /** 丸太をばらしたときに呼ばれる（幹のメッシュと、散らばる木材の数。木材の落とし物はホストが出す） */
  onSplit: (trunk: THREE.Mesh, wood: number) => void = () => {};
  /** 共有ワールドを変える頼みを出す（main.ts が差し替える） */
  request: Requester = () => false;
  /** 丸太をばらし終えて、木がなくなったときに呼ばれる（木の番号） */
  onRemove: (id: number) => void = () => {};
  /** どの島の物か（海図に載せた島なら { loc }。頼みとコマンドに入れて、main がその島へ振り分ける） */
  at: OnIsle = {};

  constructor(
    private readonly world: THREE.Object3D,
    trees: Tree[],
    private readonly physics: Physics,
  ) {
    this.fixedCount = trees.length;
    trees.forEach((tree, i) => this.addTree(i, tree));
    this.raycaster.far = LOG_REACH;
  }

  /**
   * 立っている木を、木の番号 id で足す（種から育ちきった木もこれで足す）。木はワールドに置いてから渡す。
   * 作った幹の剛体を返す
   */
  addTree(id: number, tree: Tree): RAPIER.RigidBody {
    const obj = tree.object;
    // 剛体の原点は根元。拡大率はコライダーの形に焼き込む。葉には当たり判定を付けない
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(obj.position.x, obj.position.y, obj.position.z)
        .setRotation(obj.quaternion)
        .setAngularDamping(0.4),
    );
    const frame = new THREE.Matrix4().compose(obj.position, obj.quaternion, new THREE.Vector3(1, 1, 1)).invert();
    this.physics.world.createCollider(
      hullDesc(tree.trunk, frame, TRUNK_FLOOR).setCollisionGroups(COLLIDE.wood).setFriction(0.9).setDensity(500),
      body,
    );
    this.states.set(obj, {
      tree,
      phase: 'standing',
      body,
      hinge: null,
      base: obj.quaternion.clone(),
      baseScale: obj.scale.x,
      leafScales: tree.leaves.map((l) => l.scale.x),
      hp: TREE_HP,
      axis: new THREE.Vector3(),
      time: 0,
      shrinking: -1,
    });
    this.byId.set(id, obj);
    this.idOf.set(obj, id);
    return body;
  }

  /** 木をなくす（丸太をばらし終えたとき・ばらした木をロードしたとき） */
  private forget(obj: THREE.Object3D): void {
    obj.removeFromParent();
    this.states.delete(obj);
    const id = this.idOf.get(obj);
    if (id === undefined) return;
    this.idOf.delete(obj);
    this.byId.delete(id);
    this.onRemove(id);
  }

  // ---- 入力側：視線から叩く木を決めて、頼みを出す ----

  /** 画面中央の先にある木・丸太を叩く頼みを出す。当たったら true */
  chop(camera: THREE.Camera): boolean {
    const target = this.aim(camera);
    if (!target) return false;
    const { obj, s, hit, away } = target;
    if (s.phase === 'standing' && hit.distance > REACH) return false;
    return this.request({ type: 'chopTree', tree: this.idOf.get(obj)!, p: hit.point.toArray(), away: [away.x, away.z], ...this.at });
  }

  // ---- ホスト側：頼みを確かめてコマンドにする ----

  /** 立っている木か、倒れきった丸太なら叩ける（倒れている途中は叩けない）。できなければ null（マルチではホストだけが呼ぶ） */
  authorize(req: ChopTree): ChopTree | null {
    const obj = this.byId.get(req.tree);
    const s = obj && this.states.get(obj);
    const wellFormed = req.p.length === 3 && req.away.length === 2 && [...req.p, ...req.away].every(Number.isFinite);
    if (!s || !wellFormed || (s.phase !== 'standing' && s.phase !== 'log')) return null;
    return { type: 'chopTree', tree: req.tree, p: [...req.p], away: [...req.away], ...this.at };
  }

  // ---- 適用側：コマンドの値だけで木を変える（カメラや入力は見ない） ----

  /** 耐久値を1減らす。立っている木は 0 で叩いた向きの奥へ倒れ、丸太は 0 でばらけて木材になる（木材は onSplit でホストが出す） */
  apply(cmd: ChopTree): void {
    const obj = this.byId.get(cmd.tree);
    const s = obj && this.states.get(obj);
    if (!s || (s.phase !== 'standing' && s.phase !== 'log')) return;
    const away = new THREE.Vector3(cmd.away[0], 0, cmd.away[1]);
    if (away.lengthSq() < 1e-8) away.set(1, 0, 0);
    away.normalize();
    this.spawnChips(new THREE.Vector3(...cmd.p), away, CHIP_COUNT);
    s.hp--;

    if (s.phase === 'log') {
      if (s.hp > 0) {
        // 重心ごと小さく跳ねるだけにする（叩いた点に押すと回って転がっていく）
        const m = s.body.mass();
        s.body.applyImpulse({ x: away.x * m * LOG_HIT.push, y: m * LOG_HIT.hop, z: away.z * m * LOG_HIT.push }, true);
        return;
      }
      this.breakLog(obj, s, away);
      return;
    }

    if (s.hp > 0) return;
    // 叩いた向きの奥へ倒れるようにする
    s.axis.crossVectors(UP, away).normalize();
    this.topple(obj, s);
  }

  // ---- マルチ：倒れている木・丸太の動きはホストの物理で決めて配る ----

  /**
   * 物理で動いている木（倒れている途中・丸太）の位置・向き・速さ。
   * 1つにつき [木の番号, x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz]（ホストがときどき配る）
   */
  motion(): number[][] {
    const out: number[][] = [];
    this.byId.forEach((obj, i) => {
      const s = this.states.get(obj);
      if (!s || (s.phase !== 'falling' && s.phase !== 'log') || s.body.isSleeping()) return;
      const t = s.body.translation();
      const r = s.body.rotation();
      const v = s.body.linvel();
      const w = s.body.angvel();
      out.push([i, t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z]);
    });
    return out;
  }

  /** ホストから届いた動きに合わせる（参加者が呼ぶ。あいだは自分の物理でつなぐ） */
  setMotion(list: number[][]): void {
    for (const [i, x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz] of list) {
      const obj = this.byId.get(i);
      const s = obj && this.states.get(obj);
      if (!s || (s.phase !== 'falling' && s.phase !== 'log')) continue;
      s.body.setTranslation({ x, y, z }, true);
      s.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
      s.body.setLinvel({ x: vx, y: vy, z: vz }, true);
      s.body.setAngvel({ x: wx, y: wy, z: wz }, true);
    }
  }

  /** 素手で殴る。木は傷つかず、木くずが少し飛ぶだけ（自分の画面だけの演出）。当たったら true */
  punch(camera: THREE.Camera, reach: number): boolean {
    const target = this.aim(camera);
    if (!target || target.hit.distance > reach) return false;
    this.spawnChips(target.hit.point, target.away, PUNCH_CHIP_COUNT);
    return true;
  }

  /** 画面中央の先にある、立っている木か丸太 */
  private aim(camera: THREE.Camera) {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    const targets: THREE.Object3D[] = [];
    for (const [obj, s] of this.states) if (s.phase === 'standing' || s.phase === 'log') targets.push(obj);
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;

    let obj: THREE.Object3D | null = hit.object;
    while (obj && !this.states.has(obj)) obj = obj.parent;
    if (!obj) return null;
    const away = this.raycaster.ray.direction.clone().setY(0).normalize();
    return { obj, s: this.states.get(obj)!, hit, away };
  }

  update(dt: number): void {
    for (const [obj, s] of this.states) {
      s.time += dt;
      if (s.phase === 'falling') this.updateFalling(s, dt);
      else if (s.phase === 'breaking') {
        const k = s.time / BREAK_TIME;
        if (k >= 1) this.forget(obj);
        else {
          obj.scale.setScalar(s.baseScale * (1 - k));
        }
      }
    }

    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.removeFromParent();
        this.chips.splice(i, 1);
        continue;
      }
      c.velocity.y -= 18 * dt;
      c.mesh.position.addScaledVector(c.velocity, dt);
      c.mesh.rotation.x += dt * 9;
      c.mesh.rotation.z += dt * 7;
    }
  }

  /** 最初から島にある木（props の生成順）の状態。種から育てた木は serializeTree で植えた木と一緒に保存する */
  serialize(): TreeSave[] {
    return Array.from({ length: this.fixedCount }, (_, i) => this.serializeTree(i));
  }

  /** 木の番号 id の木の状態（なくなった木は null） */
  serializeTree(id: number): TreeSave {
    const obj = this.byId.get(id);
    const s = obj && this.states.get(obj);
    if (!s || s.phase === 'breaking') return null;
    if (s.phase === 'standing') return { hp: s.hp };
    // 倒れている途中の木は、その場で丸太になったものとして保存する
    const t = s.body.translation();
    const r = s.body.rotation();
    return { hp: s.phase === 'log' ? s.hp : LOG_HP, log: [t.x, t.y, t.z, r.x, r.y, r.z, r.w] };
  }

  /** 生成直後（すべて立っている状態）に呼ぶ */
  restore(saves: TreeSave[]): void {
    for (let i = 0; i < this.fixedCount; i++) if (saves[i] !== undefined) this.restoreTree(i, saves[i]);
  }

  /** 立っている状態の木の番号 id の木を、セーブした状態に戻す */
  restoreTree(id: number, save: TreeSave): void {
    const obj = this.byId.get(id);
    const s = obj && this.states.get(obj);
    if (!obj || !s) return;
    if (save === null) {
      this.physics.removeBody(s.body);
      this.forget(obj);
      return;
    }
    s.hp = save.hp;
    if (!save.log) return;
    const [x, y, z, qx, qy, qz, qw] = save.log;
    s.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    s.body.setTranslation({ x, y, z }, true);
    s.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
    s.body.setLinearDamping(LOG_DAMPING.linear);
    s.body.setAngularDamping(LOG_DAMPING.angular);
    obj.position.set(x, y, z);
    obj.quaternion.set(qx, qy, qz, qw);
    s.tree.crown.removeFromParent();
    for (const leaf of s.tree.leaves) leaf.removeFromParent();
    this.physics.link(s.body, obj);
    this.physics.addFloater(s.body, 0.5);
    s.phase = 'log';
  }

  /** 幹の根元の、倒れる側の縁を支点にして、重力で倒れる剛体にする */
  private topple(obj: THREE.Object3D, s: TreeState): void {
    s.phase = 'falling';
    s.time = 0;
    // まとめて描いていた葉を、1つずつ縮められる元の部品に戻す
    s.tree.crown.removeFromParent();
    for (const leaf of s.tree.leaves) leaf.visible = true;
    const { world } = this.physics;
    s.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.addCrownMass(s);
    // 縁を中心に回れば幹の底面は持ち上がる側にしか動かないので、地面との接触を残したまま倒せる
    const pivot = this.pivotPoint(s);
    s.hinge = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pivot.x, pivot.y, pivot.z));
    const local = pivot.clone().sub(obj.position).applyQuaternion(s.base.clone().invert());
    world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, local), s.hinge, s.body, true);
    // 支点を中心に回り始める（重心の速度も回転に合わせる）
    const spin = s.axis.clone().multiplyScalar(TOPPLE_SPIN);
    const com = s.body.worldCom();
    const v = spin.clone().cross(new THREE.Vector3(com.x - pivot.x, com.y - pivot.y, com.z - pivot.z));
    s.body.setAngvel(spin, true);
    s.body.setLinvel(v, true);
    this.physics.link(s.body, obj);
    this.physics.addFloater(s.body, 0.5);
  }

  private updateFalling(s: TreeState, dt: number): void {
    const { body } = s;
    if (s.shrinking < 0) {
      const v = body.linvel();
      const w = body.angvel();
      const still = Math.hypot(v.x, v.y, v.z) < 0.6 && Math.hypot(w.x, w.y, w.z) < 0.6;
      const r = body.rotation();
      const tilt = s.base.angleTo(this.q.set(r.x, r.y, r.z, r.w));
      const settled = (s.time > SETTLE_TIME && still && tilt > SETTLE_TILT) || s.time > SETTLE_TIMEOUT;
      if (s.hinge && (settled || tilt > HINGE_RELEASE)) {
        this.physics.world.removeRigidBody(s.hinge); // つながっていたジョイントも消える
        s.hinge = null;
        // 葉が地面に着いたものとして重さを外し、勢いを殺す（重さだけ残すと丸太が跳ね回る）
        body.setAdditionalMass(0, true);
        const lv = body.linvel();
        const av = body.angvel();
        body.setLinvel({ x: lv.x * LANDING_DAMP, y: lv.y * LANDING_DAMP, z: lv.z * LANDING_DAMP }, true);
        body.setAngvel({ x: av.x * LANDING_DAMP, y: av.y * LANDING_DAMP, z: av.z * LANDING_DAMP }, true);
      }
      if (settled) {
        // 倒れきったら葉を縮めていく
        s.shrinking = 0;
        body.setLinearDamping(LOG_DAMPING.linear);
        body.setAngularDamping(LOG_DAMPING.angular);
      }
      return;
    }

    s.shrinking += dt;
    const k = Math.min(s.shrinking / LEAF_SHRINK_TIME, 1);
    const f = 1 - k * k;
    s.tree.leaves.forEach((leaf, i) => leaf.scale.setScalar(s.leafScales[i] * f));
    if (k >= 1) {
      for (const leaf of s.tree.leaves) leaf.removeFromParent();
      s.phase = 'log';
      s.hp = LOG_HP;
      s.time = 0;
    }
  }

  /** 葉の位置に、当たり判定のない重さだけを足す */
  private addCrownMass(s: TreeState): void {
    const { object, leaves } = s.tree;
    const box = new THREE.Box3();
    for (const leaf of leaves) box.expandByObject(leaf);
    const frame = new THREE.Matrix4().compose(object.position, s.base, new THREE.Vector3(1, 1, 1)).invert();
    box.applyMatrix4(frame); // 剛体（根元）基準にする
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const mass = s.body.mass() * CROWN_MASS;
    const inertia = (a: number, b: number) => (mass * (a * a + b * b)) / 12; // 直方体として近似
    s.body.setAdditionalMassProperties(
      mass,
      center,
      { x: inertia(size.y, size.z), y: inertia(size.x, size.z), z: inertia(size.x, size.y) },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  /** 幹の当たり判定の底面のうち、倒れる向きにいちばん出っ張った点 */
  private pivotPoint(s: TreeState): THREE.Vector3 {
    const { trunk, object } = s.tree;
    const away = new THREE.Vector3().crossVectors(s.axis, UP); // axis = UP × away なので
    const pos = trunk.geometry.getAttribute('position');
    const p = new THREE.Vector3();
    let best = 0;
    trunk.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(trunk.matrixWorld).sub(object.position);
      if (p.y < TRUNK_FLOOR + 0.3) best = Math.max(best, p.dot(away)); // 根元付近の頂点だけ見る
    }
    return object.position.clone().addScaledVector(away, best).add(new THREE.Vector3(0, TRUNK_FLOOR, 0));
  }

  private breakLog(obj: THREE.Object3D, s: TreeState, away: THREE.Vector3): void {
    // 丸太全体から木くずを散らしてばらす
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    for (let n = 0; n < BREAK_CHIP_COUNT; n++) {
      const p = center.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * size.x, (Math.random() - 0.5) * size.y, (Math.random() - 0.5) * size.z,
      ));
      this.spawnChips(p, away, 1);
    }
    this.onSplit(s.tree.trunk, s.tree.wood);
    this.physics.removeBody(s.body);
    s.phase = 'breaking';
    s.time = 0;
  }

  /** 叩いた場所から木くずを飛ばす（手前側へ） */
  private spawnChips(point: THREE.Vector3, away: THREE.Vector3, count: number): void {
    for (let n = 0; n < count; n++) {
      const mesh = new THREE.Mesh(chipGeo, flat(PALETTE.trunk));
      mesh.position.copy(point);
      mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      const velocity = away.clone().multiplyScalar(-2 - Math.random() * 2);
      velocity.x += (Math.random() - 0.5) * 3;
      velocity.z += (Math.random() - 0.5) * 3;
      velocity.y = 2 + Math.random() * 3;
      this.world.add(mesh);
      this.chips.push({ mesh, velocity, life: 0.6 + Math.random() * 0.3 });
    }
  }
}
