import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import type { Physics, RAPIER } from '../core/physics.js';
import { ITEMS, type ItemId } from '../items/inventory.js';
import { terrainHeight } from '../world/terrain.js';
import type { MineRock, MineTool, RockRequest, WorldRequest } from '../core/commands.js';

const HP_PER_SIZE = 5; // 岩の大きさ 1 あたりの耐久値（大きい岩ほど叩く回数が多い）
const MIN_HP = 3;
const TRICKLE_PER_SIZE = 3; // 岩の大きさ 1 あたりの、叩いている間に採れる石の数（叩くたびに少しずつ）
const MIN_TRICKLE = 1;
const BREAK_PER_SIZE = 5; // 岩の大きさ 1 あたりの、壊したときにまとめて採れる石の数
const MIN_BREAK = 3;
const DAMAGE: Record<MineTool, number> = { pickaxe: 1 }; // 1回叩くと減る耐久値
const SHAKE_TIME = 0.25; // 叩いたときに揺れる時間
const CHIPS_PER_HIT = 5; // 叩いたときに飛ぶ石のかけら
const CHIPS_ON_BREAK = 10; // 壊れたときに飛ぶ石のかけら
// ---- 壊れたときに岩がばらける大きな塊 ----
const CHUNKS_MIN = 4; // 塊の数（小さい岩）
const CHUNKS_MAX = 7; // 塊の数（大きい岩）
const CHUNK_SCALE = 0.42; // 塊の大きさ（もとの岩に対する割合）
const CHUNK_SPEED = 2.4; // 塊が外へ飛び出す速さ（m/秒）
const CHUNK_HOP = 2.5; // 塊が上へ跳ねる速さ
const CHUNK_BOUNCE = 0.3; // 地面で跳ね返るときに残る速さの割合
const CHUNK_FRICTION = 4; // 地面を滑るときの減速の強さ
const CHUNK_REST = 0.9; // 飛び散ってから縮み始めるまで（秒）
const CHUNK_SHRINK = 0.6; // 縮んで消えるまで（秒）
const CHIP_SIZE = 0.06; // かけらの大きさ（m）
const GRAVITY = 12;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const chipGeo = new THREE.DodecahedronGeometry(1, 0);

/** full: 叩ける → gone: 壊れてなくなった */
type Phase = 'full' | 'gone';

interface RockState {
  mesh: THREE.Mesh;
  baseScale: THREE.Vector3;
  collider: RAPIER.Collider;
  maxHp: number;
  trickle: number; // 叩いている間に採れる石の数
  burst: number; // 壊したときに採れる石の数
  hp: number;
  phase: Phase;
  shake: number; // 揺れの残り時間
}

/** セーブデータ上の岩1つの、のこりの耐久値（0 は壊れてなくなった） */
export type RockSave = number;

interface Chip { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3; life: number }

/** 壊れた岩がばらけた塊。radius は地面に沈まないようにする半径のめやす */
interface Chunk { mesh: THREE.Mesh; baseScale: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3; radius: number; time: number }

/**
 * 岩を石のツルハシで叩くと、叩くたびに石が少しずつ採れ、耐久値が 0 になると石がまとめて採れて、岩は大きな塊にばらけて消える（岩は生え直さない）。
 * 叩く操作はワールドコマンド（mineRock）にして、岩の番号（生成順）で適用する
 */
export class RockMiner {
  private readonly list: RockState[] = []; // 岩の番号順（番号が岩の ID）
  private readonly byMesh = new Map<THREE.Object3D, RockState>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly chips: Chip[] = [];
  private readonly chunks: Chunk[] = [];

  /** 採れたアイテムごとに呼ばれる */
  onHarvest: (item: ItemId, count: number) => void = () => {};
  /** 共有ワールドを変える頼みを出す（main.ts が差し替える）。適用できたら true */
  request: (req: WorldRequest) => boolean = () => false;
  private claiming = -1; // 自分が叩いている岩の番号（自分の頼みの結果だけインベントリに入れる）

  /**
   * targets は視線をさえぎる物（地形・岩・桟橋・建てた部材）、blockers は木や茂み。岩はこの中で一番手前のときだけ叩ける。
   * 岩の当たり判定はここで付ける（壊れたら外すため）
   */
  constructor(
    private readonly world: THREE.Object3D,
    rocks: THREE.Mesh[],
    private readonly physics: Physics,
    private readonly targets: THREE.Object3D[],
    private readonly blockers: THREE.Object3D[],
  ) {
    for (const mesh of rocks) {
      const s = mesh.scale;
      const size = Math.cbrt(s.x * s.y * s.z);
      const maxHp = Math.max(MIN_HP, Math.round(HP_PER_SIZE * size));
      const trickle = Math.max(MIN_TRICKLE, Math.round(TRICKLE_PER_SIZE * size));
      const burst = Math.max(MIN_BREAK, Math.round(BREAK_PER_SIZE * size));
      const collider = physics.addStatic(mesh);
      const r: RockState = { mesh, baseScale: s.clone(), collider, maxHp, trickle, burst, hp: maxHp, phase: 'full', shake: 0 };
      this.list.push(r);
      this.byMesh.set(mesh, r);
    }
  }

  /** 画面中央で狙っている、叩ける岩（手前に木・茂み・部材などがあれば叩けない） */
  private aimed(camera: THREE.Camera, reach: number): RockState | undefined {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    this.raycaster.far = reach;
    const blockers = this.blockers.filter((o) => o.parent !== null && o.visible);
    const hit = this.raycaster.intersectObjects([...this.targets, ...blockers], true)[0];
    this.raycaster.far = Infinity;
    const r = hit && this.byMesh.get(hit.object);
    return r?.phase === 'full' ? r : undefined;
  }

  /** 狙っている岩を叩く頼みを出す。叩けたら true */
  mine(camera: THREE.Camera, tool: MineTool, reach: number): boolean {
    const r = this.aimed(camera, reach);
    if (!r) return false;
    this.claiming = this.list.indexOf(r);
    const ok = this.request({ type: 'mineRock', rock: this.claiming, tool });
    this.claiming = -1;
    return ok;
  }

  /** 狙っている岩ののこりの耐久値（傷ついていなければ null） */
  durability(camera: THREE.Camera, reach: number): { hp: number; max: number } | null {
    const r = this.aimed(camera, reach);
    return r && r.hp < r.maxHp ? { hp: r.hp, max: r.maxHp } : null;
  }

  // ---- ホスト側：頼みを確かめてコマンドにする ----

  /** 頼みを確かめてコマンドにする。減る耐久値とその1回で採れる石の数を決める。できなければ null（マルチではホストだけが呼ぶ） */
  authorize(req: RockRequest): MineRock | null {
    const r = this.list[req.rock];
    const damage = DAMAGE[req.tool];
    if (!r || r.phase !== 'full' || r.hp <= 0 || damage === undefined) return null;
    // 叩いている間は減った耐久値の割合に合わせて配り、壊したときに残りをまとめて渡す
    const before = r.maxHp - r.hp;
    const after = Math.min(before + damage, r.maxHp);
    const share = Math.floor((r.trickle * after) / r.maxHp) - Math.floor((r.trickle * before) / r.maxHp);
    const n = share + (after === r.maxHp ? r.burst : 0);
    return { type: 'mineRock', rock: req.rock, damage, items: n > 0 ? [['stone', n]] : [] };
  }

  // ---- 全員：コマンドを適用する ----

  /** 岩の耐久値を減らす。壊れたら大きな塊にばらけて消え、自分の頼みなら採れた物を受け取る */
  apply(cmd: MineRock): void {
    const r = this.list[cmd.rock];
    if (!r || r.phase !== 'full' || r.hp <= 0) return;
    r.hp = Math.max(r.hp - cmd.damage, 0);
    r.shake = SHAKE_TIME;
    if (cmd.rock === this.claiming) {
      for (const [item, count] of cmd.items) if (item in ITEMS) this.onHarvest(item as ItemId, count);
    }
    this.spawnChips(r.mesh, CHIPS_PER_HIT);
    if (r.hp === 0) {
      r.mesh.scale.copy(r.baseScale);
      this.spawnChips(r.mesh, CHIPS_ON_BREAK);
      this.spawnChunks(r);
      this.remove(r);
      r.mesh.visible = false;
      r.phase = 'gone';
    }
  }

  serialize(): RockSave[] {
    return this.list.map((r) => (r.phase === 'full' ? r.hp : 0));
  }

  /** 生成直後（すべて無傷の状態）に呼ぶ。セーブデータに無い岩は無傷のまま */
  restore(saves: RockSave[]): void {
    this.list.forEach((r, i) => {
      const save = saves[i];
      if (typeof save !== 'number') return;
      r.hp = Math.min(Math.max(Math.round(save), 0), r.maxHp);
      if (r.hp > 0) return;
      this.remove(r);
      r.mesh.visible = false;
      r.phase = 'gone';
    });
  }

  /** 壊れた岩の当たり判定と、視線の的を外す */
  private remove(r: RockState): void {
    this.physics.world.removeCollider(r.collider, false);
    const i = this.targets.indexOf(r.mesh);
    if (i >= 0) this.targets.splice(i, 1);
  }

  update(dt: number): void {
    for (const r of this.list) {
      if (r.phase !== 'full' || r.shake <= 0) continue;
      r.shake = Math.max(r.shake - dt, 0);
      const k = r.shake / SHAKE_TIME;
      r.mesh.scale.copy(r.baseScale).multiplyScalar(1 + Math.sin(r.shake * 60) * 0.03 * k);
    }

    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.time += dt;
      const shrink = (c.time - CHUNK_REST) / CHUNK_SHRINK;
      if (shrink >= 1) {
        c.mesh.removeFromParent();
        this.chunks.splice(i, 1);
        continue;
      }
      // 放物線で飛び、地面に当たったら弱く跳ねて、滑りながら止まる
      c.velocity.y -= GRAVITY * dt;
      const p = c.mesh.position.addScaledVector(c.velocity, dt);
      const floor = terrainHeight(p.x, p.z) + c.radius * 0.5;
      if (p.y <= floor) {
        p.y = floor;
        if (c.velocity.y < 0) c.velocity.y *= -CHUNK_BOUNCE;
        const slow = Math.max(1 - CHUNK_FRICTION * dt, 0);
        c.velocity.x *= slow;
        c.velocity.z *= slow;
        c.spin.multiplyScalar(slow);
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (shrink > 0) c.mesh.scale.copy(c.baseScale).multiplyScalar(1 - shrink * shrink);
    }

    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.removeFromParent();
        this.chips.splice(i, 1);
        continue;
      }
      c.velocity.y -= GRAVITY * dt;
      c.mesh.position.addScaledVector(c.velocity, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
    }
  }

  /** 壊れた岩を、いくつかの大きな塊にばらけさせる（自分の画面だけの演出）。塊は外へ転がって、縮んで消える */
  private spawnChunks(r: RockState): void {
    const s = r.baseScale;
    const size = Math.cbrt(s.x * s.y * s.z);
    const count = Math.round(THREE.MathUtils.clamp(CHUNKS_MIN + (size - 0.6) * 1.5, CHUNKS_MIN, CHUNKS_MAX));
    const center = r.mesh.position;
    const offset = Math.random() * Math.PI * 2;
    const jitter = () => 0.8 + Math.random() * 0.4;
    for (let n = 0; n < count; n++) {
      const a = offset + (n / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const mesh = new THREE.Mesh(r.mesh.geometry, r.mesh.material);
      const k = CHUNK_SCALE * (0.75 + Math.random() * 0.5);
      const baseScale = new THREE.Vector3(s.x * k * jitter(), s.y * k * jitter(), s.z * k * jitter());
      mesh.scale.copy(baseScale);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      // 岩があった所の中から、外側へずらして置く
      mesh.position.set(center.x + dir.x * s.x * 0.35, center.y + s.y * Math.random() * 0.3, center.z + dir.z * s.z * 0.35);
      mesh.castShadow = true;
      const velocity = dir.multiplyScalar(CHUNK_SPEED * (0.6 + Math.random() * 0.7)).setY(CHUNK_HOP * (0.5 + Math.random() * 0.7));
      const spin = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      this.world.add(mesh);
      this.chunks.push({ mesh, baseScale, velocity, spin, radius: Math.min(baseScale.x, baseScale.y, baseScale.z), time: 0 });
    }
  }

  /** 岩の上のほうから石のかけらを飛ばす（自分の画面だけの演出） */
  private spawnChips(rock: THREE.Mesh, count: number): void {
    const box = new THREE.Box3().setFromObject(rock);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    for (let n = 0; n < count; n++) {
      const mesh = new THREE.Mesh(chipGeo, flat(PALETTE.rock));
      mesh.scale.setScalar(CHIP_SIZE * (0.6 + Math.random() * 0.8));
      mesh.position.set(
        center.x + (Math.random() - 0.5) * size.x * 0.6,
        center.y + size.y * (0.1 + Math.random() * 0.3),
        center.z + (Math.random() - 0.5) * size.z * 0.6,
      );
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
      const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.world.add(mesh);
      this.chips.push({ mesh, velocity, spin, life: 0.6 + Math.random() * 0.4 });
    }
  }
}
