import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { buildBushBerry, buildLeafModel } from '../items/itemModels.js';
import { ITEMS, type ItemId } from '../items/inventory.js';
import type { BushRequest, HarvestBush, HarvestTool, OnIsle, PickBerry, Requester } from '../core/commands.js';

export const BUSH_HP = 10; // 茂みの耐久値。0 になると壊れる
const DAMAGE: Record<HarvestTool, number> = { fist: 1, knife: 2, axe: 2 }; // 1回叩くと減る耐久値（こぶし10回、ナイフ・斧5回）
// 壊すまでに採れる物と個数（いつも同じ）。叩いて減った耐久値の割合に合わせて、少しずつ手に入る
const YIELD: [ItemId, number][] = [['leaf', 3], ['stick', 2]];
const BERRY_REACH = 3.2; // F で実を摘める距離
const REGROW_TIME = 9 * 60; // 丸裸になってから生え直すまで（秒）。ゲームの中の半日
const GROW_TIME = 1.5; // 生え直すのにかかる時間
const SHAKE_TIME = 0.35; // 採ったときに揺れる時間
const SHRINK_TIME = 0.3; // 採り尽くして縮んで消えるまで
const LEAF_PARTICLES = 7;
const BERRIES = 3; // 茂みになっている実の数。F で1つずつ摘めるほか、叩くと耐久値の割合に合わせて落ちてくる
const BERRY_CHANCE = 0.5; // 茂みに実がなる確率（生え直すたびに決め直す）
const BERRY_SEED = 31337; // 実がなるかを決める乱数の種
const VINES = 2; // 石のナイフだけで壊したときに、さらに採れるツルの数（ナイフで叩くたびに少しずつ）
const BERRY_SIZE = 0.09; // 茂みになっている実の半径（m）
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const twigGeo = new THREE.BoxGeometry(0.03, 0.03, 0.22);

/** full: 採れる → shrinking: 採り尽くして縮む → gone: 生え直し待ち → growing: 生え直し中 */
type Phase = 'full' | 'shrinking' | 'gone' | 'growing';

interface BushState {
  mesh: THREE.Mesh;
  baseScale: THREE.Vector3;
  phase: Phase;
  hp: number; // のこりの耐久値
  berries: number; // なっている実の数
  berryMeshes: THREE.Mesh[]; // 実（berries 個だけ見せる）
  grown: number; // 生え直した回数（実がなるかはこれと茂みの番号で決まる）
  time: number; // 現フェーズに入ってからの時間
  shake: number; // 揺れの残り時間
}

/** セーブデータ上の茂み1つ。hp = 0 は壊れて生え直し待ち（time はその経過秒）。berries がなければ実は全部なっている。grown は生え直した回数 */
export interface BushSave { hp: number; time: number; berries?: number; grown?: number }

interface Particle { mesh: THREE.Object3D; velocity: THREE.Vector3; spin: THREE.Vector3; life: number }

/**
 * 茂みをこぶし・石のナイフ・斧で叩くと、壊れていくにつれて葉っぱと枝と実が少しずつ採れる（ナイフで叩くとツルも）。
 * 実は F で1つずつ摘むこともできる。壊れた茂みはしばらくすると生え直す。
 * 叩く・摘む操作はワールドコマンド（harvestBush・pickBerry）にして、茂みの番号で適用する
 */
export class BushForager {
  private readonly states = new Map<THREE.Object3D, BushState>();
  private readonly list: BushState[] = []; // 茂みの番号順（番号が茂みの ID）
  private readonly raycaster = new THREE.Raycaster();
  private readonly particles: Particle[] = [];

  /** 採れたアイテムごとに呼ばれる */
  onHarvest: (item: ItemId, count: number) => void = () => {};
  /** 共有ワールドを変える頼みを出す（main.ts が差し替える）。適用できたら true */
  request: Requester = () => false;
  /** どの島の物か（海図に載せた島なら { loc }。頼みとコマンドに入れて、main がその島へ振り分ける） */
  at: OnIsle = {};

  constructor(
    private readonly world: THREE.Object3D,
    bushes: THREE.Mesh[],
  ) {
    bushes.forEach((mesh, i) => {
      const berryMeshes = addBerries(mesh, i, BERRIES);
      const s: BushState = { mesh, baseScale: mesh.scale.clone(), phase: 'full', hp: BUSH_HP, berries: berriesFor(i, 0), berryMeshes, grown: 0, time: 0, shake: 0 };
      showBerries(s);
      this.states.set(mesh, s);
      this.list.push(s);
    });
  }

  /** 画面中央で狙っている、叩ける茂み */
  private aimed(camera: THREE.Camera, reach: number): BushState | undefined {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    const targets: THREE.Object3D[] = [];
    for (const [mesh, s] of this.states) if (s.phase === 'full') targets.push(mesh);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit && hit.distance <= reach ? this.states.get(hit.object) : undefined;
  }

  /** 狙っている茂みを叩く頼みを出す。reach より遠ければ叩かない。叩けたら true */
  harvest(camera: THREE.Camera, tool: HarvestTool, reach: number): boolean {
    const s = this.aimed(camera, reach);
    if (!s) return false;
    return this.request({ type: 'harvestBush', bush: this.list.indexOf(s), tool, ...this.at });
  }

  /** F で実を摘める茂みに視線が合っているか */
  canPick(camera: THREE.Camera): boolean {
    return (this.aimed(camera, BERRY_REACH)?.berries ?? 0) > 0;
  }

  /** 狙っている茂みの実を1つ摘む頼みを出す。摘めたら true */
  pick(camera: THREE.Camera): boolean {
    const s = this.aimed(camera, BERRY_REACH);
    if (!s || s.berries <= 0) return false;
    return this.request({ type: 'pickBerry', bush: this.list.indexOf(s), ...this.at });
  }

  // ---- ホスト側：頼みを確かめてコマンドにする ----

  /** 頼みを確かめてコマンドにする。叩くなら減る耐久値とその1回で採れる物を決める。できなければ null（マルチではホストだけが呼ぶ） */
  authorize(req: BushRequest): HarvestBush | PickBerry | null {
    const s = this.list[req.bush];
    if (!s || s.phase !== 'full' || s.hp <= 0) return null;
    if (req.type === 'pickBerry') return s.berries > 0 ? { type: 'pickBerry', bush: req.bush, ...this.at } : null;
    const damage = DAMAGE[req.tool];
    if (damage === undefined) return null;
    // 減った耐久値の割合に合わせて配る。最後まで叩くと、ちょうど YIELD の数になる
    const before = BUSH_HP - s.hp;
    const after = Math.min(before + damage, BUSH_HP);
    const share = (total: number) => Math.floor((total * after) / BUSH_HP) - Math.floor((total * before) / BUSH_HP);
    const items: [ItemId, number][] = [];
    for (const [item, total] of YIELD) if (share(total) > 0) items.push([item, share(total)]);
    if (req.tool === 'knife' && share(VINES) > 0) items.push(['vine', share(VINES)]);
    const fallen = s.berries - berryCap(BUSH_HP - after);
    if (fallen > 0) items.push(['berry', fallen]);
    return { type: 'harvestBush', bush: req.bush, damage, items, ...this.at };
  }

  // ---- 全員：コマンドを適用する ----

  /** 茂みの耐久値を減らす（実を摘むなら1つ減らす）。壊れたら縮んで消え、自分の頼み（mine）なら採れた物を受け取る */
  apply(cmd: HarvestBush | PickBerry, mine: boolean): void {
    const s = this.list[cmd.bush];
    if (!s || s.phase !== 'full' || s.hp <= 0) return;
    if (cmd.type === 'pickBerry') {
      if (s.berries <= 0) return;
      s.berries--;
      showBerries(s);
      if (mine) this.onHarvest('berry', 1);
      return;
    }
    s.hp = Math.max(s.hp - cmd.damage, 0);
    // 耐久値が減った分だけ実も落ちる（なっている数が上限を超えないようにする）
    s.berries = Math.min(s.berries, berryCap(s.hp));
    showBerries(s);
    s.shake = SHAKE_TIME;
    this.spawnParticles(s.mesh);
    if (mine) {
      for (const [item, count] of cmd.items) if (item in ITEMS) this.onHarvest(item as ItemId, count);
    }
    if (s.hp === 0) {
      s.phase = 'shrinking';
      s.time = 0;
    }
  }

  serialize(): BushSave[] {
    return this.list.map((s, i) => {
      const grown = s.grown;
      if (s.phase === 'full') return { hp: s.hp, time: 0, berries: s.berries, grown };
      if (s.phase === 'growing') return { hp: BUSH_HP, time: 0, berries: berriesFor(i, grown), grown };
      return { hp: 0, time: s.phase === 'gone' ? s.time : 0, berries: 0, grown };
    });
  }

  /** 生成直後（すべて採れる状態）に呼ぶ */
  restore(saves: BushSave[]): void {
    this.list.forEach((s, i) => {
      const save = saves[i];
      if (!save) return;
      s.hp = Math.min(save.hp, BUSH_HP);
      s.grown = save.grown ?? 0;
      // grown がない古いセーブは、どの茂みにも実がなっていたので、実がなるかをここで決め直す
      const berries = save.grown === undefined ? Math.min(save.berries ?? BERRIES, berriesFor(i, 0)) : save.berries ?? berriesFor(i, s.grown);
      s.berries = Math.min(berries, berryCap(s.hp));
      showBerries(s);
      if (save.hp > 0) return;
      s.mesh.visible = false;
      s.phase = 'gone';
      s.time = save.time;
    });
  }

  update(dt: number): void {
    this.list.forEach((s, i) => {
      s.time += dt;
      const { mesh, baseScale } = s;
      if (s.phase === 'full') {
        if (s.shake <= 0) return;
        s.shake = Math.max(s.shake - dt, 0);
        const k = s.shake / SHAKE_TIME;
        const wobble = Math.sin(s.shake * 45) * 0.09 * k;
        mesh.scale.set(baseScale.x * (1 + wobble), baseScale.y * (1 - wobble), baseScale.z * (1 + wobble));
      } else if (s.phase === 'shrinking') {
        const k = Math.min(s.time / SHRINK_TIME, 1);
        mesh.scale.copy(baseScale).multiplyScalar(1 - k * k);
        if (k >= 1) {
          mesh.visible = false;
          s.phase = 'gone';
          s.time = 0;
        }
      } else if (s.phase === 'gone') {
        if (s.time >= REGROW_TIME) {
          mesh.visible = true;
          mesh.scale.setScalar(0);
          s.phase = 'growing';
          s.grown++;
          s.time = 0;
        }
      } else {
        const k = Math.min(s.time / GROW_TIME, 1);
        mesh.scale.copy(baseScale).multiplyScalar(1 - (1 - k) * (1 - k));
        if (k >= 1) {
          s.phase = 'full';
          s.hp = BUSH_HP;
          s.berries = berriesFor(i, s.grown);
          s.time = 0;
          showBerries(s);
        }
      }
    });

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        this.particles.splice(i, 1);
        continue;
      }
      // 葉は空気抵抗でゆっくりひらひら落ちる
      p.velocity.y = Math.max(p.velocity.y - 9 * dt, -1.5);
      p.velocity.x *= 1 - 2 * dt;
      p.velocity.z *= 1 - 2 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
    }
  }

  /** 茂みのてっぺんから葉と小枝を舞い上げる */
  private spawnParticles(bush: THREE.Mesh): void {
    const box = new THREE.Box3().setFromObject(bush);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    for (let n = 0; n < LEAF_PARTICLES; n++) {
      const twig = n === 0;
      const mesh = twig ? new THREE.Mesh(twigGeo, flat(PALETTE.trunk)) : buildLeafModel();
      if (!twig) mesh.scale.setScalar(0.55);
      mesh.position.set(
        center.x + (Math.random() - 0.5) * size.x * 0.6,
        box.max.y - size.y * 0.2,
        center.z + (Math.random() - 0.5) * size.z * 0.6,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 4, Math.random() * 8);
      this.world.add(mesh);
      this.particles.push({ mesh, velocity, spin, life: 0.9 + Math.random() * 0.5 });
    }
  }
}

/** 耐久値が hp のときに、なっていられる実の数の上限（叩いて減るほど少なくなる） */
function berryCap(hp: number): number {
  return Math.ceil((BERRIES * hp) / BUSH_HP);
}

/**
 * 茂み index が grown 回目に生え直したときになる実の数（BERRY_CHANCE の確率で BERRIES 個、外れると 0 個）。
 * 茂みの番号と生え直した回数だけで決まるので、誰の画面でも同じになる
 */
function berriesFor(index: number, grown: number): number {
  let h = Math.imul(index + BERRY_SEED, 0x9e3779b1) ^ Math.imul(grown + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < BERRY_CHANCE ? BERRIES : 0;
}

/** なっている数だけ実を見せる */
function showBerries(s: BushState): void {
  s.berryMeshes.forEach((b, i) => (b.visible = i < s.berries));
}

/**
 * 茂みの上半分の面に実をつける。位置は茂みの番号から決まるので、誰の画面でも同じになる
 * （茂みは拡大率が縦横で違うので、実が潰れないように逆数を掛ける）
 */
function addBerries(bush: THREE.Mesh, index: number, count: number): THREE.Mesh[] {
  const pos = bush.geometry.getAttribute('position');
  const faces: { center: THREE.Vector3; normal: THREE.Vector3; order: number }[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  // 茂みの形が、実をつけてよい面（外から見える面）を教えてくれるときはその中から選ぶ
  const allowed: number[] | undefined = bush.geometry.userData.berryFaces;
  for (const f of allowed ?? Array.from({ length: pos.count / 3 }, (_, i) => i)) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
    if (normal.y < 0.1) continue; // 下側の面は地面に埋まっている
    const center = a.clone().add(b).add(c).divideScalar(3);
    const order = Math.sin(index * 12.9898 + f * 78.233) * 43758.5453 % 1;
    faces.push({ center, normal, order });
  }
  faces.sort((p, q) => p.order - q.order);
  const s = bush.scale;
  return faces.slice(0, count).map(({ center, normal }) => {
    const berry = buildBushBerry();
    berry.position.copy(center).addScaledVector(normal, 0.02);
    berry.scale.set(BERRY_SIZE / 0.1 / s.x, BERRY_SIZE / 0.1 / s.y, BERRY_SIZE / 0.1 / s.z);
    // 実は小さく影がほとんど見えないので、影は落とさない（影を描く回数を減らす）
    bush.add(berry);
    return berry;
  });
}
