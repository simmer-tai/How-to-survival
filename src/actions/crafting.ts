import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flatTransparent } from '../core/materials.js';
import { RAPIER } from '../core/physics.js';
import { VIEW_LAYER } from '../player/hand.js';
import { disposeModel, itemIcon, itemModel } from '../items/itemIcons.js';
import { ITEMS, type Inventory, type ItemId, type Stack } from '../items/inventory.js';
import { candidates, ingredients, totals, type Recipe } from '../items/recipes.js';
import { BENCH_D, BENCH_H, BENCH_W } from './pieces.js';
import type { PieceInfo } from './build.js';
import { keyGuide } from '../ui/keyGuide.js';

const MAT_W = 0.8; // 手元の台（インベントリを開いたとき画面に出る半透明のグリッド）の幅
const MAT_D = 0.4; // 手元の台の奥行き
const GRID_CELL = 0.1; // 手元の台のマス目の大きさ
const GRID_FILL_OPACITY = 0.18; // 手元の台の面の不透明度
const GRID_LINE_OPACITY = 0.6; // 手元の台の線の不透明度
const MAT_POS = new THREE.Vector3(0, 0.16, -1.05); // 手元の台の、カメラから見た位置
const MAT_TILT = 0.95; // 手元の台を手前に傾けて、上面がよく見えるようにする（rad）
const HAND_ITEM = 0.1; // 手元の台に置く素材1つの大きさ
const BENCH_ITEM = 0.2; // 作業台に置く素材1つの大きさ
const BENCH_TOP = 0.012; // 天板の設計図の上に置く
// 作業台を使うときのカメラ：天板の正面の斜め上から見下ろす
const VIEW_DIST = 0.95; // 天板の中心から、水平にこれだけ手前へ
const VIEW_UP = 0.85; // 天板から上へ
const LOOK_DOWN = 0.3; // 天板の中心より下を見て、天板を画面の上寄りに映す（下にインベントリがあるので）
const ZOOM_TIME = 0.35; // 作業台に寄る時間
const MAX_ITEMS = 40; // 台に置ける素材の数
const HOVER_SCALE = 1.12;
/** 寝かせて置く素材（道具や枝・葉は立てると不自然なので、アイコンの正面を上に向ける） */
const FLAT_ITEMS: ItemId[] = ['stick', 'leaf', 'vine', 'hoe', 'axe', 'sword', 'stoneKnife', 'hammer', 'pickaxe', 'fishingRod', 'fish'];
const UP = new THREE.Vector3(0, 1, 0);

// ---- 台の上の物理演算 ----
// 台ごとに小さな物理ワールドを別に作る（本編の物理とは混ぜない）。
// 長さは「素材1つの大きさ = 1」の単位で計算し、見た目に戻すときに itemSize を掛ける
const TABLE_GRAVITY = 40; // 素材の大きさを1とした単位での重力
const DROP_HEIGHT = 2.2; // 置いた素材を、台からこの高さ（素材の大きさの倍数）から落とす
const DROP_SPIN = 2; // 落とすときの回転の速さの最大（rad/s）
const RIM_HEIGHT = 1.5; // 台の縁の見えない壁の高さ（素材が転がり落ちないように。高すぎると壁に立てかかって浮いて見える）
const ITEM_FRICTION = 0.7;
const ITEM_BOUNCE = 0.15;
const ITEM_DAMPING = 0.4;
// 完成品の出方：台の中心から、ぼわっと煙を上げて飛び出す
const POP_UP = 13; // 飛び出す上向きの速さ（素材の大きさ = 1 の単位 / 秒）
const POP_SIDE = 2; // 横方向の速さの最大
const POP_SPIN = 8; // 回転の速さの最大（rad/s）
const POP_TIME = 0.3; // 小さい状態から元の大きさに膨らむ時間
const PUFF_TIME = 0.6; // 煙が消えるまでの時間
const PUFF_COUNT = 12; // 完成したときの煙の粒の数（使った素材の場所には半分）
const PUFF_SPEED = 4; // 煙の粒の広がる速さ（素材の大きさ = 1 の単位 / 秒）
const PUFF_GEO = new THREE.IcosahedronGeometry(1, 0);
const STEP = 1 / 60; // 物理演算の1歩の時間（画面の更新が遅くても同じ速さで動くように、決まった刻みで進める）
const MAX_STEPS = 6; // 1フレームで進める歩数の上限（重いときに遅れを取り戻そうとして固まらないように）

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** 素材を置く台の上面。root の y = 0 の面に置き、x・z は ±halfW・±halfD まで */
interface Surface { root: THREE.Group; halfW: number; halfD: number; itemSize: number; layer: number }

/**
 * 台の上の素材1つ。閉じている間は obj も body もない。pop は出現の膨らみの進み具合（1 で元の大きさ）。
 * dmg は使いかけの道具の減った耐久値（台に置いて戻しても耐久値が戻らないように持っておく）
 */
interface TableItem { item: ItemId; dmg?: number; obj: THREE.Group | null; body: RAPIER.RigidBody | null; pop: number }

/** 煙の粒のまとまり（見た目だけの演出） */
interface Puff { group: THREE.Group; mat: THREE.Material & { opacity: number }; parts: { mesh: THREE.Mesh; vel: THREE.Vector3 }[]; age: number }

/**
 * 台の上に素材をドラッグして1つずつ置き、置いた素材から作れる物の候補を出すクラフト。
 * E でインベントリを開くと画面に手元の小さな台が出て、作業台で F を押すと本物の天板に寄って、その上に置く。
 * 置いた素材は物理演算で転がって積み重なる。
 * クラフトは自分のインベントリだけで完結する（台に置いた素材も、その物理演算も自分の画面だけ）ので、ワールドコマンドにはしない
 */
export class Crafting {
  isOpen = false;
  /** 使っている作業台（手元の台なら null） */
  private bench: PieceInfo | null = null;
  private surface: Surface | null = null;
  private readonly handSurface: Surface;
  private items: TableItem[] = [];
  private hovered: TableItem | null = null;
  private physics: RAPIER.World | null = null;
  /** まだ物理演算に回していない時間 */
  private pending = 0;
  private puffs: Puff[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  // 作業台に寄るカメラの動き
  private zoom = 0;
  /** 天板の長い辺のうち、どちら側から見るか（1：天板の +Z 側　-1：-Z 側） */
  private side = 1;
  private readonly savedQuat = new THREE.Quaternion();
  private readonly viewPos = new THREE.Vector3();
  private readonly viewQuat = new THREE.Quaternion();

  private readonly headEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly candEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  /** 候補の一覧を最後に作ったときの素材（変わったときだけ作り直す。null なら必ず作り直す） */
  private candKey: string | null = null;

  /** その番号の作業台がまだあるか（壊されたら閉じる） */
  benchExists: (pid: number) => boolean = () => true;

  constructor(
    private readonly world: THREE.Object3D,
    private readonly camera: THREE.Camera,
    canvas: HTMLElement,
    private readonly inventory: Inventory,
  ) {
    this.raycaster.layers.enableAll();
    this.handSurface = this.buildHandSurface();
    inventory.pending = () => this.stacks();

    injectStyle();
    this.headEl = el('div', 'craft-head');
    this.titleEl = el('div', 'craft-title');
    this.hintEl = el('div', 'craft-hint');
    this.headEl.append(this.titleEl, this.hintEl);
    this.candEl = el('div', 'craft-cands');
    this.labelEl = el('div', 'craft-label hidden');
    document.body.append(this.headEl, this.candEl, this.labelEl);

    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
  }

  /** 作業台を使う（インベントリを開くと、その天板に寄る） */
  useBench(info: PieceInfo): void {
    this.bench = info;
    this.inventory.setOpen(true);
  }

  /** インベントリの開閉に合わせて呼ぶ */
  setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) {
      const s = (this.surface = this.bench ? this.buildBenchSurface(this.bench) : this.handSurface);
      s.root.visible = true;
      this.physics = buildTablePhysics(s);
      // 前に入りきらず台に残した素材があれば、また落とす
      for (const t of this.items) this.spawn(t, { x: (Math.random() - 0.5) * s.halfW, z: (Math.random() - 0.5) * s.halfD });
      this.titleEl.textContent = this.bench ? '作業台' : '手元';
      this.candKey = null;
      this.render();
      if (this.bench) {
        this.savedQuat.copy(this.camera.quaternion);
        this.zoom = 0;
        // 長い辺のうち、プレイヤーがいる側から見る
        const toPlayer = this.camera.position.clone().sub(new THREE.Vector3(...this.bench.p));
        this.side = benchFront(this.bench).dot(toPlayer) < 0 ? -1 : 1;
      }
    } else {
      // 台に残した素材はインベントリに戻す（入りきらない分は台に残して、次に開いたときに出す）
      for (const t of this.items) this.despawn(t);
      const rest: TableItem[] = [];
      for (const s of this.stacks()) {
        const left = this.inventory.putBack(s);
        for (let i = 0; i < (left?.count ?? 0); i++) rest.push({ item: s.item, dmg: s.dmg, obj: null, body: null, pop: 1 });
      }
      this.items = rest;
      for (const f of this.puffs) this.removePuff(f);
      this.puffs = [];
      this.physics?.free();
      this.physics = null;
      if (this.surface === this.handSurface) this.handSurface.root.visible = false;
      else this.surface?.root.removeFromParent();
      if (this.bench) this.camera.quaternion.copy(this.savedQuat); // 視線を元に戻す
      this.surface = null;
      this.bench = null;
      this.setHovered(null);
    }
    this.headEl.classList.toggle('open', open);
    this.candEl.classList.toggle('open', open);
  }

  /** 作業台を使っているか（main 側で手を隠すのに使う） */
  get atBench(): boolean {
    return this.isOpen && this.bench !== null;
  }

  /** カメラを作業台に寄せ、台の上の物理演算を進める。player.update のあとに呼ぶ */
  update(dt: number): void {
    if (!this.isOpen) return;
    if (this.bench && !this.benchExists(this.bench.pid)) {
      this.inventory.setOpen(false, false); // 使っている作業台がなくなった
      return;
    }
    if (this.bench) {
      this.zoom = Math.min(this.zoom + dt / ZOOM_TIME, 1);
      const k = THREE.MathUtils.smootherstep(this.zoom, 0, 1);
      this.benchView(this.bench);
      this.camera.position.lerp(this.viewPos, k);
      this.camera.quaternion.slerpQuaternions(this.savedQuat, this.viewQuat, k);
      this.camera.updateMatrixWorld();
    }

    const s = this.surface!;
    if (this.physics) {
      this.pending = Math.min(this.pending + dt, STEP * MAX_STEPS);
      for (; this.pending >= STEP; this.pending -= STEP) this.physics.step();
    }
    for (const t of this.items) {
      if (!t.obj || !t.body) continue;
      const p = t.body.translation();
      // 台の外へ飛び出してしまったら、台の中心の上に戻す
      if (Math.abs(p.x) * s.itemSize > s.halfW + s.itemSize || Math.abs(p.z) * s.itemSize > s.halfD + s.itemSize || p.y < -1) {
        t.body.setTranslation({ x: 0, y: DROP_HEIGHT, z: 0 }, true);
        t.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      const q = t.body.rotation();
      t.obj.position.set(p.x * s.itemSize, p.y * s.itemSize, p.z * s.itemSize);
      t.obj.quaternion.set(q.x, q.y, q.z, q.w);
      if (t.pop < 1) {
        t.pop = Math.min(t.pop + dt / POP_TIME, 1);
        t.obj.scale.setScalar(easeOutBack(t.pop) * (t === this.hovered ? HOVER_SCALE : 1));
      }
    }
    this.updatePuffs(dt);

    // 指している素材の名前
    const h = this.hovered;
    if (h?.obj) {
      const v = h.obj.position.clone().addScaledVector(UP, s.itemSize * 1.1);
      s.root.localToWorld(v).project(this.camera);
      this.labelEl.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    }
  }

  /** 作業台の天板を手前の長い辺から見下ろすカメラの位置と向き */
  private benchView(b: PieceInfo): void {
    const center = new THREE.Vector3(b.p[0], b.p[1] + BENCH_H, b.p[2]);
    const dir = benchFront(b).multiplyScalar(this.side);
    this.viewPos.copy(center).addScaledVector(dir, VIEW_DIST).addScaledVector(UP, VIEW_UP);
    const look = center.clone().addScaledVector(UP, -LOOK_DOWN);
    this.viewQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.viewPos, look, UP));
  }

  // ---- 台の上の操作：持ったまま左クリックで1つずつ落とす・つまむ・右クリックでインベントリに返す ----
  // ドラッグして台の上で離しても落とさない（持ったままになる）。落とすのは、持った状態で台を左クリックしたときだけ

  private onDown(e: MouseEvent): void {
    if (!this.isOpen || !this.surface) return;
    e.preventDefault();
    this.aim(e);
    if (e.button === 2) {
      this.returnItem(this.itemAt());
      return;
    }
    if (e.button !== 0) return;
    if (this.inventory.holding) {
      this.dropOne();
      return;
    }
    const t = this.itemAt();
    if (!t) return;
    // 1つつまむ。そのままインベントリのマスで離すと戻せる
    this.removeItem(t);
    this.inventory.hold(t.dmg ? { item: t.item, count: 1, dmg: t.dmg } : { item: t.item, count: 1 }, true);
    this.render();
  }

  /** 台の上の素材をインベントリに返す（いっぱいで入らなければ台に残す） */
  private returnItem(t: TableItem | null): void {
    if (!t || this.inventory.add(t.item, 1, t.dmg) > 0) return;
    this.removeItem(t);
    this.render();
  }

  /** つまんでいる物を、マウスの先に1つ落とす（残りは持ったまま） */
  private dropOne(): void {
    const held = this.inventory.holding!;
    const at = this.surfacePoint();
    if (!at || this.items.length >= MAX_ITEMS) return;
    const t: TableItem = { item: held.item, dmg: held.dmg, obj: null, body: null, pop: 1 };
    this.items.push(t);
    this.spawn(t, at);
    held.count -= 1;
    this.inventory.hold(held.count > 0 ? held : null);
    this.render();
  }

  private onMove(e: MouseEvent): void {
    if (!this.isOpen || !this.surface) return;
    this.aim(e);
    this.setHovered(this.inventory.holding ? null : this.itemAt());
    (e.target as HTMLElement).style.cursor = this.hovered ? 'grab' : '';
  }

  private setHovered(t: TableItem | null): void {
    if (t === this.hovered) return;
    this.hovered?.obj?.scale.setScalar(1);
    this.hovered = t;
    t?.obj?.scale.setScalar(HOVER_SCALE);
    this.labelEl.textContent = t ? ITEMS[t.item].name : '';
    this.labelEl.classList.toggle('hidden', !t);
  }

  private aim(e: MouseEvent): void {
    this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  /** マウスの先の、台の上の位置。台から外れていれば null */
  private surfacePoint(): { x: number; z: number } | null {
    const s = this.surface!;
    s.root.updateMatrixWorld();
    const normal = UP.clone().applyQuaternion(s.root.getWorldQuaternion(new THREE.Quaternion()));
    this.plane.setFromNormalAndCoplanarPoint(normal, s.root.getWorldPosition(new THREE.Vector3()));
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!hit) return null;
    const local = s.root.worldToLocal(hit);
    const slack = s.itemSize * 1.5; // 縁から少しはみ出しても、台の内側に寄せて置く
    if (Math.abs(local.x) > s.halfW + slack || Math.abs(local.z) > s.halfD + slack) return null;
    // 縁ぎりぎりに落とすと壁に立てかかるので、素材1つ分内側に寄せる
    const mx = s.halfW - s.itemSize;
    const mz = s.halfD - s.itemSize;
    return { x: THREE.MathUtils.clamp(local.x, -mx, mx), z: THREE.MathUtils.clamp(local.z, -mz, mz) };
  }

  private itemAt(): TableItem | null {
    const objs = this.items.flatMap((t) => (t.obj ? [t.obj] : []));
    const hit = this.raycaster.intersectObjects(objs, true)[0];
    if (!hit) return null;
    return this.items.find((t) => {
      let o: THREE.Object3D | null = hit.object;
      while (o && o !== t.obj) o = o.parent;
      return o !== null;
    }) ?? null;
  }

  /**
   * 素材の模型と剛体を作り、台の上 (x, z) の少し上から落とす。見た目だけの動きなので乱数は Math.random でよい。
   * launch なら、完成品として台の中心から上へ飛び出させる
   */
  private spawn(t: TableItem, at: { x: number; z: number }, launch = false): void {
    const s = this.surface!;
    const obj = tableModel(t.item, s.itemSize);
    obj.traverse((o) => {
      o.layers.set(s.layer);
      if (o instanceof THREE.Mesh) o.castShadow = s.layer === 0;
    });
    s.root.add(obj);
    t.obj = obj;

    // 当たり判定は模型を囲む箱（素材の大きさ = 1 の単位）。模型は底面が原点なので、箱を半分持ち上げる
    const half = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).multiplyScalar(0.5 / s.itemSize);
    const tilt = new THREE.Euler((Math.random() - 0.5) * 0.6, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6);
    const q = new THREE.Quaternion().setFromEuler(tilt);
    const rand = (max: number) => (Math.random() - 0.5) * 2 * max;
    const spin = launch ? POP_SPIN : DROP_SPIN;
    const body = this.physics!.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x / s.itemSize, launch ? 0.5 : DROP_HEIGHT, at.z / s.itemSize)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(launch ? rand(POP_SIDE) : 0, launch ? POP_UP * (0.85 + Math.random() * 0.3) : 0, launch ? rand(POP_SIDE) : 0)
        .setAngvel({ x: rand(spin), y: rand(spin), z: rand(spin) })
        .setLinearDamping(ITEM_DAMPING)
        .setAngularDamping(ITEM_DAMPING),
    );
    this.physics!.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(half.x, 0.05), Math.max(half.y, 0.05), Math.max(half.z, 0.05))
        .setTranslation(0, half.y, 0)
        .setFriction(ITEM_FRICTION)
        .setRestitution(ITEM_BOUNCE),
      body,
    );
    t.body = body;
    if (launch) {
      t.pop = 0;
      obj.scale.setScalar(0.01);
    }
  }

  /** 模型と剛体を消す（素材のデータは残す） */
  private despawn(t: TableItem): void {
    if (t.obj) {
      t.obj.removeFromParent();
      disposeModel(t.obj);
      t.obj = null;
    }
    if (t.body && this.physics) this.physics.removeRigidBody(t.body);
    t.body = null;
  }

  private removeItem(t: TableItem): void {
    this.despawn(t);
    this.items = this.items.filter((o) => o !== t);
    if (this.hovered === t) this.setHovered(null);
  }

  /** 台の上の素材を、アイテムごとのスタックにまとめる（使いかけの道具は1つずつ別にする） */
  private stacks(): Stack[] {
    const worn = this.items.filter((t) => t.dmg).map((t) => ({ item: t.item, count: 1, dmg: t.dmg }));
    const fresh = totals(this.items.filter((t) => !t.dmg).map(({ item }) => ({ item, count: 1 })));
    return [...[...fresh].map(([item, count]) => ({ item, count })), ...worn];
  }

  private have(): Map<ItemId, number> {
    return totals(this.items.map(({ item }) => ({ item, count: 1 })));
  }

  // ---- 候補：台の上の素材から作れる物 ----

  /**
   * 候補を押す：台の素材を使って作る。完成品は台の中心から煙を上げて飛び出し、台の上に落ちる（Shift なら作れるだけ作る）。
   * 台に置ききれない分はインベントリへ入れる
   */
  private craft(recipe: Recipe, e: MouseEvent): void {
    e.preventDefault();
    const canMake = () => ingredients(recipe).every(([item, n]) => (this.have().get(item) ?? 0) >= n);
    if (!canMake()) return;
    do {
      this.consume(recipe);
      for (let i = 0; i < recipe.count; i++) {
        if (this.items.length >= MAX_ITEMS) {
          this.inventory.add(recipe.result, 1);
          continue;
        }
        const t: TableItem = { item: recipe.result, obj: null, body: null, pop: 1 };
        this.items.push(t);
        this.spawn(t, { x: 0, z: 0 }, true);
      }
    } while (e.shiftKey && canMake());
    this.puff(0, 0, 1);
    this.render();
  }

  /** 台の上から、レシピ1回分の素材を使う（あとに置いた物から使う）。消えた素材の場所に小さな煙を出す */
  private consume(recipe: Recipe): void {
    for (const [item, need] of ingredients(recipe)) {
      for (const t of this.items.filter((o) => o.item === item).slice(-need)) {
        if (t.obj) this.puff(t.obj.position.x, t.obj.position.z, 0.5);
        this.removeItem(t);
      }
    }
  }

  // ---- 煙（見た目だけの演出なので乱数は Math.random でよい） ----

  /** 台の上 (x, z) に、ぼわっと煙を出す。size は粒の数と大きさの倍率 */
  private puff(x: number, z: number, size: number): void {
    const s = this.surface!;
    const mat = flatTransparent(PALETTE.sand, 0.9);
    mat.depthWrite = false;
    const group = new THREE.Group();
    group.position.set(x, s.itemSize * 0.3, z);
    const parts: Puff['parts'] = [];
    for (let i = 0; i < Math.round(PUFF_COUNT * size); i++) {
      const mesh = new THREE.Mesh(PUFF_GEO, mat);
      mesh.scale.setScalar(s.itemSize * (0.12 + Math.random() * 0.12) * (0.6 + size * 0.4));
      mesh.layers.set(s.layer);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
      parts.push({ mesh, vel: dir.multiplyScalar(PUFF_SPEED * s.itemSize * (0.6 + Math.random() * 0.6)) });
      group.add(mesh);
    }
    group.layers.set(s.layer);
    s.root.add(group);
    this.puffs.push({ group, mat, parts, age: 0 });
  }

  private updatePuffs(dt: number): void {
    for (const f of [...this.puffs]) {
      f.age += dt;
      const k = f.age / PUFF_TIME;
      if (k >= 1) {
        this.removePuff(f);
        this.puffs = this.puffs.filter((o) => o !== f);
        continue;
      }
      for (const { mesh, vel } of f.parts) {
        mesh.position.addScaledVector(vel, dt);
        vel.multiplyScalar(Math.max(0, 1 - 5 * dt)); // すぐに勢いが落ちて、ふわっと広がる
        mesh.scale.multiplyScalar(1 + 1.5 * dt);
      }
      f.mat.opacity = 0.9 * (1 - k * k);
    }
  }

  private removePuff(f: Puff): void {
    f.group.removeFromParent();
    f.mat.dispose(); // 粒のジオメトリは共有なので残す
  }

  /** 候補の一覧。台の上の素材が変わったときだけ作り直す（押している最中に要素を消さないように） */
  private render(): void {
    const have = this.have();
    const key = [...have].map(([item, n]) => `${item}:${n}`).join(',');
    if (key === this.candKey) return;
    this.candKey = key;
    this.hintEl.innerHTML = keyGuide(
      have.size > 0
        ? '候補を [左] で作る（[Shift]+[左]：作れるだけ） ／ 台の素材は [右] でインベントリに戻る'
        : '素材をドラッグして台に1つずつ置くと、作れる物が出てくる' + (this.bench ? '' : '（作業台を置いて [F] で使うと、もっといろいろ作れる）'));
    this.candEl.innerHTML = '';
    const list = candidates(this.bench ? 'workbench' : null, have);
    if (have.size > 0 && list.length === 0) {
      const note = el('div', 'craft-note');
      note.textContent = 'この素材で作れる物はない';
      this.candEl.append(note);
    }
    for (const { recipe, times } of list) {
      const row = el('div', 'craft-cand' + (times > 0 ? '' : ' lack'));
      const cost = ingredients(recipe)
        .map(([item, n]) => {
          const got = have.get(item) ?? 0;
          return `<span class="craft-cost${got < n ? ' short' : ''}"><img src="${itemIcon(item)}" alt="" draggable="false">${got}/${n}</span>`;
        })
        .join('');
      const count = recipe.count > 1 ? ` ×${recipe.count}` : '';
      row.innerHTML =
        `<img class="craft-icon" src="${itemIcon(recipe.result)}" alt="" draggable="false">` +
        `<div><div class="craft-name">${ITEMS[recipe.result].name}${count}</div><div>${cost}<span class="craft-times">${times > 0 ? `${times}回作れる` : '素材が足りない'}</span></div></div>`;
      row.addEventListener('mousedown', (e) => this.craft(recipe, e));
      this.candEl.append(row);
    }
  }

  // ---- 台 ----

  /** 手元の台：カメラの前に浮かぶ半透明のグリッド。手や持ち物と同じく、世界の上に重ねて描く */
  private buildHandSurface(): Surface {
    const root = new THREE.Group();
    const fillMat = flatTransparent(PALETTE.sky, GRID_FILL_OPACITY);
    fillMat.depthWrite = false;
    fillMat.side = THREE.DoubleSide;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(MAT_W, MAT_D).rotateX(-Math.PI / 2), fillMat);
    // マス目の線（外枠も含む）
    const hw = MAT_W / 2;
    const hd = MAT_D / 2;
    const pts: number[] = [];
    for (let i = 0; i <= Math.round(MAT_W / GRID_CELL); i++) {
      const x = -hw + i * GRID_CELL;
      pts.push(x, 0.001, -hd, x, 0.001, hd);
    }
    for (let i = 0; i <= Math.round(MAT_D / GRID_CELL); i++) {
      const z = -hd + i * GRID_CELL;
      pts.push(-hw, 0.001, z, hw, 0.001, z);
    }
    const lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: PALETTE.sky, transparent: true, opacity: GRID_LINE_OPACITY, depthWrite: false });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    root.add(fill, lines);
    root.position.copy(MAT_POS);
    root.rotation.x = MAT_TILT;
    root.traverse((o) => o.layers.set(VIEW_LAYER));
    root.visible = false;
    this.camera.add(root);
    return { root, halfW: MAT_W / 2 - 0.01, halfD: MAT_D / 2 - 0.01, itemSize: HAND_ITEM, layer: VIEW_LAYER };
  }

  /** 作業台の天板の上（見えない面。素材だけをここに置く） */
  private buildBenchSurface(b: PieceInfo): Surface {
    const root = new THREE.Group();
    root.position.set(b.p[0], b.p[1] + BENCH_H + BENCH_TOP, b.p[2]);
    root.rotation.y = (b.r * Math.PI) / 2;
    this.world.add(root);
    return { root, halfW: BENCH_W / 2 - 0.08, halfD: BENCH_D / 2 - 0.06, itemSize: BENCH_ITEM, layer: 0 };
  }
}

/** 少し行き過ぎてから戻る膨らみ方（0 → 1） */
function easeOutBack(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/** 台の物理ワールド：上面の床と、縁を囲む見えない壁（素材の大きさ = 1 の単位） */
function buildTablePhysics(s: Surface): RAPIER.World {
  const w = new RAPIER.World({ x: 0, y: -TABLE_GRAVITY, z: 0 });
  w.timestep = STEP;
  const hw = s.halfW / s.itemSize;
  const hd = s.halfD / s.itemSize;
  const t = 0.5; // 床と壁の厚みの半分
  const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
    w.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(ITEM_FRICTION));
  fixed(hw + 2 * t, t, hd + 2 * t, 0, -t, 0);
  for (const sx of [-1, 1]) fixed(t, RIM_HEIGHT, hd + 2 * t, sx * (hw + t), RIM_HEIGHT, 0);
  for (const sz of [-1, 1]) fixed(hw + 2 * t, RIM_HEIGHT, t, 0, RIM_HEIGHT, sz * (hd + t));
  return w;
}

/** 作業台の天板の +Z 方向（長い辺に直角な向き） */
function benchFront(b: PieceInfo): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, (b.r * Math.PI) / 2);
}

/** 台に置く素材の模型：アイコンのモデルを寝かせるか立て、底面を y = 0 にして size の大きさにそろえる */
function tableModel(item: ItemId, size: number): THREE.Group {
  const model = itemModel(item);
  const wrap = new THREE.Group();
  if (FLAT_ITEMS.includes(item)) {
    model.rotation.set(0, 0, 0);
    wrap.rotation.x = -Math.PI / 2; // アイコンの正面を上に向けて寝かせる
  } else {
    model.rotation.x = 0; // アイコン用の傾きをなくして、まっすぐ立てる
    model.rotation.z = 0;
  }
  wrap.add(model);
  const outer = new THREE.Group();
  outer.add(wrap);
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const dims = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = size / Math.max(dims.x, dims.y, dims.z);
  wrap.scale.setScalar(k);
  wrap.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  return outer;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .craft-head, .craft-cands { display: none; position: fixed; z-index: 5; color: #fff; user-select: none; text-shadow: 0 1px 0 #2b2633, 0 0 calc(4 * var(--u)) #2b2633; }
    .craft-head.open, .craft-cands.open { display: block; }
    .craft-head { left: 50%; top: calc(18 * var(--u)); transform: translateX(-50%); text-align: center; pointer-events: none; }
    .craft-title { font-size: calc(20 * var(--u)); font-weight: 700; letter-spacing: 0.15em; }
    .craft-hint { font-size: calc(13 * var(--u)); opacity: 0.9; margin-top: calc(2 * var(--u)); }
    .craft-cands {
      right: calc(24 * var(--u)); top: calc(90 * var(--u)); width: calc(250 * var(--u));
      max-height: calc(100vh - 360 * var(--u)); overflow-y: auto;
    }
    .craft-cand { display: flex; align-items: center; gap: calc(10 * var(--u)); padding: calc(4 * var(--u)) 0; cursor: pointer; }
    .craft-icon {
      width: calc(54 * var(--u)); height: calc(54 * var(--u)); transition: transform 0.12s;
      filter: drop-shadow(0 calc(2 * var(--u)) calc(2 * var(--u)) rgba(43, 38, 51, 0.6));
    }
    .craft-cand:hover .craft-icon { transform: scale(1.15) rotate(-4deg); }
    .craft-cand:hover .craft-name { color: ${css(PALETTE.sand)}; }
    .craft-cand.lack { cursor: default; opacity: 0.5; }
    .craft-cand.lack:hover .craft-icon { transform: none; }
    .craft-cand.lack:hover .craft-name { color: #fff; }
    .craft-name { font-size: calc(15 * var(--u)); font-weight: 700; }
    .craft-cost { display: inline-flex; align-items: center; gap: calc(2 * var(--u)); margin-right: calc(6 * var(--u)); font-size: calc(12 * var(--u)); font-weight: 700; }
    .craft-cost img { width: calc(18 * var(--u)); height: calc(18 * var(--u)); }
    .craft-cost.short { color: ${css(PALETTE.accent)}; }
    .craft-times { font-size: calc(11 * var(--u)); opacity: 0.85; }
    .craft-note { font-size: calc(13 * var(--u)); opacity: 0.85; }
    .craft-label {
      position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; color: #fff; white-space: nowrap;
      font-size: calc(14 * var(--u)); font-weight: 700; text-shadow: 0 1px 0 #2b2633, 0 0 calc(3 * var(--u)) #2b2633;
    }
    .craft-label.hidden { display: none; }
  `;
  document.head.append(style);
}
