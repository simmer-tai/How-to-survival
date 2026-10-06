import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat, flatVertex } from '../core/materials.js';
import { WATER_LEVEL } from '../core/physics.js';
import { ITEMS, type ItemId } from '../items/inventory.js';
import { islandField } from '../world/terrain.js';
import type { DigHole, DigTool, FillHole, HoleCommand, HoleRequest, Requester } from '../core/commands.js';

const HOLE_RADIUS = 0.32; // 穴の口の半径（m）
const HOLE_DEPTH = 0.22; // 穴の深さ（m）
const HOLE_WOBBLE = 0.14; // 穴の口のふちを、まん丸からどれだけゆがめるか（半径に対する割合）
const HOLE_GAP = 0.8; // ほかの穴の中心とこれより近い所は掘れない（m）。となりの穴の地面の下に広げたふちが、この穴の中に見えないだけ離す
const RINGS = 4; // 穴の底からふちまでの段の数
const SEGMENTS = 14; // 穴のまわりの分割数
const MASK_INSET = 0.94; // 地面を抜く範囲（穴の口に対する割合。ふちの少し内側だけ抜いて、すき間が見えないように）
const MASK_LIFT = 0.012; // 地面を抜く面を、地面からどれだけ浮かせるか
const SKIRT = 1.25; // 穴の口のまわりの地面の下に、お椀のふちをこの割合まで広げる（地面を抜いた所のふちから、斜めに見ても穴の外の地下が透けないように）
const MIN_NORMAL_Y = 0.8; // 地面の傾きがこれより急（法線の上向きの成分が小さい）な所は掘れない（岩肌）
const MIN_HEIGHT = WATER_LEVEL + 0.15; // これより低い（水の中や波打ち際の）地面は掘れない
const DIRT_PER_HOLE: Record<DigTool, number> = { shovel: 1 }; // 1つ掘ると採れる土の数
const MOUNDS_MIN = 4; // 穴のまわりに盛る土の山の数
const MOUNDS_MAX = 6;
const MOUND_SIZE = 0.09; // 土の山の大きさ（m）
const FILL_TIME = 18 * 60; // 掘ってからこの時間（秒）がたつと、穴はひとりでに埋まる（18分 ＝ ゲームの中の1日）
const CLODS = 9; // 掘ったとき・埋めたときに飛ぶ土くれ
const CLOD_SIZE = 0.045;
const GRAVITY = 12;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const HOLE_SEED = 33013;

/** 色を少し暗くする（パレットの色の濃淡だけを使う） */
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);
const RIM_COLOR = shade(PALETTE.trunk, 0.62); // 穴のふちの土
const BOTTOM_COLOR = shade(PALETTE.bark, 0.5); // 穴の底（暗くして深く見せる）
const DIRT_COLOR = shade(PALETTE.trunk, 0.72).getHex(); // 盛った土・飛ぶ土くれ

const moundGeo = new THREE.DodecahedronGeometry(1, 0);
// 穴の形は描かず、深さだけを書き込んで、その上の地面を描かせない（穴の中が見えるようにする）
const maskMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** セーブデータ上の穴1つ。p は穴の中心の水平位置 [x, z]、t は掘ってからたった時間（秒） */
export interface HoleSave { hid: number; p: [number, number]; t?: number }

/** セーブデータ上の穴。next は次に発行する穴の番号 */
export interface HolesSave { next: number; list: HoleSave[] }

/** age は掘ってからたった時間（秒）。マルチではホストだけが進める */
interface Hole { hid: number; x: number; z: number; age: number; group: THREE.Group }

interface Clod { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3; life: number }

/**
 * スコップで地面を掘ると、小さな穴があいて土が採れる。穴は自分の島の地面にだけ掘れる。
 * 穴は土を1つ使うと埋められ、埋めなくても時間がたつとひとりでに埋まる。
 * 掘る・埋める操作はワールドコマンド（digHole・fillHole）にして、ホストが発行する穴の番号（hid）で持つ。
 * 穴の形は穴の番号から決めるので、誰の画面でも同じになる。歩くときの地面（当たり判定）は変えない
 */
export class GroundDigger {
  private readonly holes = new Map<number, Hole>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly clods: Clod[] = [];
  private nextHid = 0;

  /** 採れたアイテムごとに呼ばれる */
  onHarvest: (item: ItemId, count: number) => void = () => {};
  /** 穴が増えたり減ったりしたら呼ばれる（穴の中から草が生えないようにする） */
  onChange: () => void = () => {};
  /** 共有ワールドを変える頼みを出す（main.ts が差し替える）。適用できたら true */
  request: Requester = () => false;
  /** (x, z) に穴を掘ってよいか（建てた部材や桟橋の下などを除く。main.ts が差し替える） */
  canDigAt: (x: number, z: number) => boolean = () => true;

  /**
   * ground は掘れる地面（自分の島の地形）、targets は視線をさえぎる物（地形・岩・桟橋・建てた部材）、blockers は木や茂み。
   * 地面がこの中で一番手前のときだけ掘れる
   */
  constructor(
    private readonly world: THREE.Object3D,
    private readonly ground: THREE.Object3D,
    private readonly targets: THREE.Object3D[],
    private readonly blockers: THREE.Object3D[],
  ) {}

  /** 画面中央で狙っている地面（手前に木・茂み・岩などがあれば null） */
  private aimedGround(camera: THREE.Camera, reach: number): THREE.Intersection | null {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    this.raycaster.far = reach;
    const blockers = this.blockers.filter((o) => o.parent !== null && o.visible);
    const hit = this.raycaster.intersectObjects([...this.targets, ...blockers], true)[0];
    this.raycaster.far = Infinity;
    return hit && hit.object === this.ground && hit.face ? hit : null;
  }

  /** 画面中央で狙っている、掘れる地面の位置 [x, z]（掘れなければ null） */
  private aimed(camera: THREE.Camera, reach: number): [number, number] | null {
    const hit = this.aimedGround(camera, reach);
    if (!hit || hit.face!.normal.y < MIN_NORMAL_Y) return null; // 地形はワールドに直接置いているので、面の法線がそのまま上向きの成分
    const p: [number, number] = [Math.round(hit.point.x * 100) / 100, Math.round(hit.point.z * 100) / 100];
    return this.diggable(p[0], p[1]) ? p : null;
  }

  /** 画面中央で狙っている穴（なければ undefined） */
  private aimedHole(camera: THREE.Camera, reach: number): Hole | undefined {
    const hit = this.aimedGround(camera, reach);
    if (!hit) return undefined;
    for (const h of this.holes.values()) if (Math.hypot(h.x - hit.point.x, h.z - hit.point.z) < HOLE_RADIUS * (1 + HOLE_WOBBLE)) return h;
    return undefined;
  }

  /** (x, z) に新しく穴を掘れるか（水の中・ほかの穴のそば・建てた部材の下などは掘れない） */
  private diggable(x: number, z: number): boolean {
    if (islandField.height(x, z) < MIN_HEIGHT) return false;
    for (const h of this.holes.values()) if (Math.hypot(h.x - x, h.z - z) < HOLE_GAP) return false;
    return this.canDigAt(x, z);
  }

  /** 狙っている地面を掘る頼みを出す。掘れたら true */
  dig(camera: THREE.Camera, tool: DigTool, reach: number): boolean {
    const p = this.aimed(camera, reach);
    if (!p) return false;
    return this.request({ type: 'digHole', p, tool });
  }

  /** 狙っている所を掘れるか（操作の案内に使う） */
  canDig(camera: THREE.Camera, reach: number): boolean {
    return this.aimed(camera, reach) !== null;
  }

  /** 狙っている穴を埋める頼みを出す（使う土はインベントリから main.ts が減らす）。埋められたら true */
  fill(camera: THREE.Camera, reach: number): boolean {
    const h = this.aimedHole(camera, reach);
    return !!h && this.request({ type: 'fillHole', hid: h.hid });
  }

  /** 穴を狙っているか（操作の案内に使う） */
  canFill(camera: THREE.Camera, reach: number): boolean {
    return this.aimedHole(camera, reach) !== undefined;
  }

  /**
   * 穴の時間を進め、時間がたった穴を埋める頼みを出す（マルチではホストだけが呼ぶ）。
   * 掘ってからの時間はセーブに入るので、ロードしたあとも続きから進む
   */
  tick(dt: number): void {
    for (const h of this.holes.values()) {
      h.age += dt;
      if (h.age >= FILL_TIME) this.request({ type: 'fillHole', hid: h.hid }, null);
    }
  }

  /** (x, z) が穴の口の中か（穴の中から草が生えないようにする） */
  covers(x: number, z: number): boolean {
    for (const h of this.holes.values()) if (Math.hypot(h.x - x, h.z - z) < HOLE_RADIUS * (1 + HOLE_WOBBLE)) return true;
    return false;
  }

  // ---- ホスト側：頼みを確かめてコマンドにする ----

  /** 頼みを確かめてコマンドにする。掘るなら穴の番号と採れる土の数を決める。できなければ null（マルチではホストだけが呼ぶ） */
  authorize(req: HoleRequest): HoleCommand | null {
    if (req.type === 'fillHole') return this.holes.has(req.hid) ? { type: 'fillHole', hid: req.hid } : null;
    const [x, z] = req.p;
    const dirt = DIRT_PER_HOLE[req.tool];
    if (!Number.isFinite(x) || !Number.isFinite(z) || dirt === undefined || !this.diggable(x, z)) return null;
    return { type: 'digHole', hid: this.nextHid, p: [x, z], items: [['dirt', dirt]] };
  }

  // ---- 全員：コマンドを適用する ----

  /** mine は自分の頼みか（自分が掘ったときだけ、採れた土を受け取る） */
  apply(cmd: HoleCommand, mine: boolean): void {
    if (cmd.type === 'digHole') this.applyDig(cmd, mine);
    else this.applyFill(cmd);
  }

  /** 穴をあける。自分の頼みなら採れた物を受け取る */
  private applyDig(cmd: DigHole, mine: boolean): void {
    if (this.holes.has(cmd.hid)) return;
    this.addHole(cmd.hid, cmd.p[0], cmd.p[1], 0);
    this.nextHid = Math.max(this.nextHid, cmd.hid + 1);
    if (mine) {
      for (const [item, count] of cmd.items) if (item in ITEMS) this.onHarvest(item as ItemId, count);
    }
    this.spawnClods(cmd.p[0], cmd.p[1]);
    this.onChange();
  }

  /** 穴を埋めて、もとの地面に戻す */
  private applyFill(cmd: FillHole): void {
    const h = this.holes.get(cmd.hid);
    if (!h) return;
    this.holes.delete(cmd.hid);
    h.group.removeFromParent();
    h.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== moundGeo) o.geometry.dispose(); // 盛った土のジオメトリは共有なので残す
    });
    this.spawnClods(h.x, h.z);
    this.onChange();
  }

  serialize(): HolesSave {
    return { next: this.nextHid, list: [...this.holes.values()].map((h) => ({ hid: h.hid, p: [h.x, h.z], t: Math.round(h.age) })) };
  }

  /** 生成直後（穴が1つもない状態）に呼ぶ */
  restore(save: HolesSave): void {
    for (const h of save.list) {
      if (!Number.isInteger(h.hid) || this.holes.has(h.hid) || !Number.isFinite(h.p?.[0]) || !Number.isFinite(h.p?.[1])) continue;
      this.addHole(h.hid, h.p[0], h.p[1], Number.isFinite(h.t) ? Math.max(h.t!, 0) : 0);
      this.nextHid = Math.max(this.nextHid, h.hid + 1);
    }
    this.nextHid = Math.max(this.nextHid, Number.isInteger(save.next) ? save.next : 0);
    this.onChange();
  }

  update(dt: number): void {
    for (let i = this.clods.length - 1; i >= 0; i--) {
      const c = this.clods[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.removeFromParent();
        this.clods.splice(i, 1);
        continue;
      }
      c.velocity.y -= GRAVITY * dt;
      c.mesh.position.addScaledVector(c.velocity, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
    }
  }

  /**
   * 穴の見た目を作る。地面の下にお椀形の穴を描き、穴の口の上だけ地面を描かせない（深さだけ書き込む面をかぶせる）。
   * 口のゆがみと、まわりに盛った土の山は穴の番号から決める
   */
  private addHole(hid: number, x: number, z: number, age: number): void {
    const rand = mulberry32(HOLE_SEED + hid);
    const wobble = Array.from({ length: SEGMENTS }, () => 1 + (rand() - 0.5) * 2 * HOLE_WOBBLE);
    const ground = (dx: number, dz: number) => islandField.height(x + dx, z + dz);
    /** 段 k（0 が底の中心、RINGS が口、RINGS + 1 が地面の下に広げたふち）の、角度 s 番目の点（穴の中心からの位置） */
    const point = (k: number, s: number): THREE.Vector3 => {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const t = Math.min(k / RINGS, 1);
      const r = HOLE_RADIUS * wobble[s % SEGMENTS] * (k > RINGS ? SKIRT : t);
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      return new THREE.Vector3(dx, ground(dx, dz) - HOLE_DEPTH * (1 - t * t) - 0.004, dz);
    };

    // お椀：底は暗く、ふちへ行くほど土の色にする
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const tri = (a: [THREE.Vector3, number], b: [THREE.Vector3, number], c: [THREE.Vector3, number]) => {
      // 穴の内側（上）から見て表になる向きにそろえる
      if (ab.subVectors(b[0], a[0]).cross(ac.subVectors(c[0], a[0])).dot(up) < 0) [b, c] = [c, b];
      for (const [p, k] of [a, b, c]) {
        positions.push(p.x, p.y, p.z);
        color.copy(BOTTOM_COLOR).lerp(RIM_COLOR, Math.min(k / RINGS, 1) ** 1.5);
        colors.push(color.r, color.g, color.b);
      }
    };
    for (let k = 0; k <= RINGS; k++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const p00: [THREE.Vector3, number] = [point(k, s), k];
        const p01: [THREE.Vector3, number] = [point(k, s + 1), k];
        const p10: [THREE.Vector3, number] = [point(k + 1, s), k + 1];
        const p11: [THREE.Vector3, number] = [point(k + 1, s + 1), k + 1];
        if (k > 0) tri(p00, p10, p01);
        tri(p01, p10, p11);
      }
    }
    const bowlGeo = new THREE.BufferGeometry();
    bowlGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    bowlGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    bowlGeo.computeVertexNormals();
    const bowl = new THREE.Mesh(bowlGeo, flatVertex());
    bowl.renderOrder = -3; // 穴の口の面と地面より先に描く

    // 穴の口の面：地面より少し上に、口のふちの少し内側までの円盤を置き、深さだけ書き込む
    const maskPos: number[] = [];
    const rim = (s: number) => {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const r = HOLE_RADIUS * wobble[s % SEGMENTS] * MASK_INSET;
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      return [dx, ground(dx, dz) + MASK_LIFT, dz];
    };
    const center = [0, ground(0, 0) + MASK_LIFT, 0];
    for (let s = 0; s < SEGMENTS; s++) maskPos.push(...center, ...rim(s + 1), ...rim(s));
    const maskGeo = new THREE.BufferGeometry();
    maskGeo.setAttribute('position', new THREE.Float32BufferAttribute(maskPos, 3));
    const mask = new THREE.Mesh(maskGeo, maskMaterial);
    mask.renderOrder = -2; // お椀を描いたあと、地面や草より先に描く

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.add(bowl, mask);

    // まわりに、掘り出した土を小さく盛る
    const mounds = MOUNDS_MIN + Math.floor(rand() * (MOUNDS_MAX - MOUNDS_MIN + 1));
    const offset = rand() * Math.PI * 2;
    for (let n = 0; n < mounds; n++) {
      const a = offset + (n / mounds) * Math.PI * 2 + (rand() - 0.5) * 0.7;
      const r = HOLE_RADIUS * (1.12 + rand() * 0.3);
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      const size = MOUND_SIZE * (0.7 + rand() * 0.6);
      const mound = new THREE.Mesh(moundGeo, flat(DIRT_COLOR));
      mound.scale.set(size * (1 + rand() * 0.5), size * 0.55, size * (1 + rand() * 0.5));
      mound.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
      mound.position.set(dx, ground(dx, dz) + size * 0.15, dz);
      mound.castShadow = true;
      mound.receiveShadow = true;
      group.add(mound);
    }

    this.world.add(group);
    this.holes.set(hid, { hid, x, z, age, group });
  }

  /** 穴から土くれを飛ばす（掘ったとき・埋めたとき。自分の画面だけの演出） */
  private spawnClods(x: number, z: number): void {
    const y = islandField.height(x, z);
    for (let n = 0; n < CLODS; n++) {
      const mesh = new THREE.Mesh(moundGeo, flat(DIRT_COLOR));
      mesh.scale.setScalar(CLOD_SIZE * (0.6 + Math.random() * 0.8));
      mesh.position.set(x + (Math.random() - 0.5) * HOLE_RADIUS, y + 0.05, z + (Math.random() - 0.5) * HOLE_RADIUS);
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.world.add(mesh);
      this.clods.push({ mesh, velocity, spin, life: 0.5 + Math.random() * 0.3 });
    }
  }
}
