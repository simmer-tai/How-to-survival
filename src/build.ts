import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';
import { solid, toon, toonTransparent } from './materials.js';
import { modelIcon, itemIcon } from './itemIcons.js';
import { ITEMS, type Inventory, type ItemId } from './inventory.js';
import type { Platform } from './props.js';
import type { Physics } from './physics.js';

const REACH = 7; // 視線の先、この距離まで置ける
const CELL = 2; // 建築グリッドの1マス（床1枚の大きさ）
const WALL_H = 2;
const THIN = 0.2; // 床・壁の厚み
const POP_TIME = 0.15; // 置いたときにぽんと膨らむ時間
const SCREEN_CENTER = new THREE.Vector2(0, 0);

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** cell：マスの中央に置く　edge：マスの辺に沿って置く（壁・柵） */
type Snap = 'cell' | 'edge';

interface PieceDef {
  id: string;
  name: string;
  cost: Partial<Record<ItemId, number>>;
  snap: Snap;
  color: number;
  /** 原点は底面の中央。edge のものは X 方向に伸びる */
  geometry: THREE.BufferGeometry;
  /** 上に乗れる平らな面か（泳いでいるときのよじ登り判定に使う） */
  platform: boolean;
}

/** 底面が y = 0 になる箱 */
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
}

/** -Z へ向かって上る4段の階段（当たり判定は凸包なのでなめらかな坂になる） */
function stairsGeometry(): THREE.BufferGeometry {
  const steps = 4;
  const depth = CELL / steps;
  const parts = Array.from({ length: steps }, (_, i) =>
    box(CELL, (WALL_H / steps) * (i + 1), depth, 0, 0, CELL / 2 - depth * (i + 0.5)),
  );
  return mergeGeometries(parts)!;
}

export const PIECES: PieceDef[] = [
  { id: 'floor', name: '木の床', cost: { wood: 2 }, snap: 'cell', color: PALETTE.trunk, geometry: box(CELL, THIN, CELL), platform: true },
  { id: 'wall', name: '木の壁', cost: { wood: 3 }, snap: 'edge', color: PALETTE.trunk, geometry: box(CELL, WALL_H, THIN), platform: false },
  { id: 'fence', name: '木の柵', cost: { wood: 1 }, snap: 'edge', color: PALETTE.trunk, geometry: box(CELL, 0.9, 0.12), platform: false },
  { id: 'stairs', name: '木の階段', cost: { wood: 4 }, snap: 'cell', color: PALETTE.trunk, geometry: stairsGeometry(), platform: false },
  { id: 'foundation', name: '石の土台', cost: { stone: 4 }, snap: 'cell', color: PALETTE.rock, geometry: box(CELL, 1, CELL), platform: true },
];

interface Built { def: PieceDef; mesh: THREE.Mesh; baseY: number; bounds: THREE.Box3; pop: number }

/** セーブデータ上の部材1つ。p は底面中央の位置、r は 90° 単位の向き */
export interface BuiltSave { id: string; p: number[]; r: number }

const snapCenter = (v: number) => Math.round(v / CELL) * CELL;
const snapEdge = (v: number) => Math.round((v - CELL / 2) / CELL) * CELL + CELL / 2;

/** Q で開く建築メニューと、選んだ部材を視線の先に置く操作 */
export class Builder {
  menuOpen = false;
  /** 置こうとしている部材（null なら建築していない） */
  private current: PieceDef | null = null;
  private rotation = 0; // 90° 単位
  private readonly built: Built[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ghost: THREE.Mesh;
  private readonly okMat = toonTransparent(PALETTE.grass, 0.55);
  private readonly ngMat = toonTransparent(PALETTE.accent, 0.55);
  private valid = false;
  private readonly menuEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hintEl: HTMLElement;

  /** メニューの開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};

  constructor(
    private readonly world: THREE.Object3D,
    /** 視線が当たる物（地形・岩・桟橋など）。置いた部材はこの中に足していく */
    private readonly targets: THREE.Object3D[],
    private readonly physics: Physics,
    private readonly platforms: Platform[],
    private readonly inventory: Inventory,
  ) {
    this.raycaster.far = REACH;
    for (const m of [this.okMat, this.ngMat]) m.depthWrite = false;
    this.ghost = new THREE.Mesh(PIECES[0].geometry, this.okMat);
    this.ghost.renderOrder = 10;
    this.ghost.visible = false;
    world.add(this.ghost);

    injectStyle();
    this.menuEl = document.createElement('div');
    this.menuEl.className = 'build';
    this.menuEl.innerHTML = `
      <div class="build-panel">
        <div class="build-title">建築</div>
        <div class="build-list"></div>
        <div class="build-help">クリックで選ぶ ／ 左クリック：設置 ／ R：回転 ／ 右クリック：やめる ／ Q・Esc：閉じる</div>
      </div>`;
    this.listEl = this.menuEl.querySelector('.build-list')!;
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'build-hint hidden';
    document.body.append(this.menuEl, this.hintEl);

    addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ') {
        if (this.menuOpen) this.setMenuOpen(false);
        else if (document.pointerLockElement !== null && !inventory.isOpen) this.setMenuOpen(true);
      } else if (e.code === 'Escape' && this.menuOpen) {
        this.setMenuOpen(false, false);
      } else if (e.code === 'KeyR' && this.current && !this.menuOpen) {
        this.rotation = (this.rotation + 1) % 4;
      }
    });
  }

  /** 建築中（部材を選んで置こうとしている）か */
  get active(): boolean {
    return this.current !== null;
  }

  setMenuOpen(open: boolean, resume = true): void {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    if (open) this.renderMenu();
    this.menuEl.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  /** 建築をやめる */
  cancel(): void {
    this.current = null;
    this.ghost.visible = false;
    this.hintEl.classList.add('hidden');
  }

  private choose(def: PieceDef): void {
    if (!this.canAfford(def)) return;
    this.current = def;
    this.ghost.geometry = def.geometry;
    this.setMenuOpen(false);
  }

  private canAfford(def: PieceDef): boolean {
    return costs(def).every(([item, n]) => this.inventory.count(item) >= n);
  }

  /** 視線の先に置けるなら置く。置けたら true */
  place(): boolean {
    const def = this.current;
    if (!def || !this.ghost.visible || !this.valid) return false;
    for (const [item, n] of costs(def)) this.inventory.remove(item, n);
    this.addPiece(def, this.ghost.position, this.rotation);
    this.updateHint();
    if (!this.canAfford(def)) this.cancel();
    return true;
  }

  serialize(): BuiltSave[] {
    return this.built.map(({ def, mesh }) => ({
      id: def.id,
      p: [mesh.position.x, mesh.position.y, mesh.position.z],
      r: Math.round(mesh.rotation.y / (Math.PI / 2)) & 3,
    }));
  }

  restore(saves: BuiltSave[]): void {
    for (const save of saves) {
      const def = PIECES.find((d) => d.id === save.id);
      if (!def) continue;
      const [x, y, z] = save.p;
      this.addPiece(def, new THREE.Vector3(x, y, z), save.r, false);
    }
  }

  /** pop：置いたときにぽんと膨らませるか */
  private addPiece(def: PieceDef, position: THREE.Vector3, rotation: number, pop = true): void {
    const mesh = solid(def.geometry, def.color);
    mesh.position.copy(position);
    mesh.rotation.set(0, (rotation * Math.PI) / 2, 0);
    mesh.updateMatrixWorld();
    this.world.add(mesh);
    this.physics.addStatic(mesh); // 当たり判定は大きさ 1 の状態で作る
    const bounds = new THREE.Box3().setFromObject(mesh).expandByScalar(-0.05);
    this.built.push({ def, mesh, baseY: mesh.position.y, bounds, pop: pop ? 0 : 1 });
    this.targets.push(mesh);
    if (def.platform) {
      const b = new THREE.Box3().setFromObject(mesh);
      this.platforms.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, top: b.max.y });
    }
    if (pop) mesh.scale.setScalar(0.85);
  }

  /** eye はカメラ（目）の位置 */
  update(dt: number, camera: THREE.Camera, eye: THREE.Vector3): void {
    for (const b of this.built) {
      if (b.pop >= 1) continue;
      b.pop = Math.min(b.pop + dt / POP_TIME, 1);
      b.mesh.scale.setScalar(0.85 + 0.15 * Math.sin((b.pop * Math.PI) / 2) + 0.06 * Math.sin(b.pop * Math.PI));
    }

    const def = this.current;
    this.ghost.visible = false;
    if (!def || this.menuOpen || document.pointerLockElement === null) {
      this.hintEl.classList.add('hidden');
      return;
    }
    this.updateHint();
    this.hintEl.classList.remove('hidden');

    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    const hit = this.raycaster.intersectObjects(this.targets, false)[0];
    if (!hit) return;

    // 置く高さ：既にある部材に当てたときは、その部材の高さにそろえる
    let y = hit.point.y;
    const on = this.built.find((b) => b.mesh === hit.object);
    if (on) {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      const sameLayer = def.snap === 'cell' && on.def.snap === 'cell' && on.def.id === def.id;
      if (sameLayer || normal.y < 0.7) y = on.baseY; // 床の隣に床、壁の横に壁
      else y = on.bounds.max.y + 0.05; // 上に積む
    }

    const turned = this.rotation % 2 === 1; // edge の部材が Z 方向に伸びている
    let x: number;
    let z: number;
    if (def.snap === 'cell') {
      x = snapCenter(hit.point.x);
      z = snapCenter(hit.point.z);
    } else {
      x = turned ? snapEdge(hit.point.x) : snapCenter(hit.point.x);
      z = turned ? snapCenter(hit.point.z) : snapEdge(hit.point.z);
    }
    this.ghost.position.set(x, y, z);
    this.ghost.rotation.set(0, (this.rotation * Math.PI) / 2, 0);
    this.ghost.visible = true;

    // 他の部材やプレイヤーと重なっていないか
    this.ghost.updateMatrixWorld();
    const ghostBox = new THREE.Box3().setFromObject(this.ghost).expandByScalar(-0.05);
    const feet = eye.y - 1.7;
    const playerBox = new THREE.Box3(new THREE.Vector3(eye.x - 0.4, feet, eye.z - 0.4), new THREE.Vector3(eye.x + 0.4, eye.y + 0.2, eye.z + 0.4));
    this.valid =
      this.canAfford(def) &&
      !ghostBox.intersectsBox(playerBox) &&
      this.built.every((b) => !b.bounds.intersectsBox(ghostBox));
    this.ghost.material = this.valid ? this.okMat : this.ngMat;
  }

  private updateHint(): void {
    const def = this.current;
    if (!def) return;
    const cost = costs(def)
      .map(([item, n]) => `${ITEMS[item].name} ${this.inventory.count(item)}/${n}`)
      .join('　');
    this.hintEl.innerHTML =
      `<b>${def.name}</b>　<span class="build-hint-cost">${cost}</span><br>` +
      `左クリック：設置 ／ R：回転 ／ Q：選び直す ／ 右クリック：やめる`;
  }

  private renderMenu(): void {
    this.listEl.innerHTML = '';
    for (const def of PIECES) {
      const ok = this.canAfford(def);
      const card = document.createElement('button');
      card.className = 'build-card' + (ok ? '' : ' lack') + (def === this.current ? ' current' : '');
      const cost = costs(def)
        .map(([item, n]) => {
          const short = this.inventory.count(item) < n;
          return `<span class="build-cost${short ? ' short' : ''}"><img src="${itemIcon(item)}" alt="">${n}</span>`;
        })
        .join('');
      card.innerHTML = `<img class="build-icon" src="${pieceIcon(def)}" alt=""><div class="build-name">${def.name}</div><div>${cost}</div>`;
      card.title = ok ? def.name : `${def.name}（材料が足りない）`;
      card.addEventListener('click', () => this.choose(def));
      this.listEl.append(card);
    }
  }
}

function costs(def: PieceDef): [ItemId, number][] {
  return Object.entries(def.cost) as [ItemId, number][];
}

function pieceIcon(def: PieceDef): string {
  return modelIcon(`piece:${def.id}`, () => {
    // アイコン描画後にジオメトリが捨てられるので複製を渡す
    const mesh = new THREE.Mesh(def.geometry.clone(), toon(def.color));
    const g = new THREE.Group();
    g.add(mesh);
    g.rotation.set(0.45, def.id === 'stairs' ? 2.4 : -0.6, 0);
    return g;
  });
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .build {
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      z-index: 7; user-select: none; background: rgba(43, 38, 51, 0.25);
    }
    .build.open { display: flex; }
    .build-panel {
      padding: 14px 16px; border-radius: 12px; background: rgba(43, 38, 51, 0.8); color: #fff;
      max-width: calc(100vw - 32px); box-sizing: border-box;
    }
    .build-title { font-size: 18px; font-weight: 700; margin-bottom: 10px; letter-spacing: 0.1em; }
    .build-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .build-card {
      width: 108px; padding: 8px 6px; border: none; border-radius: 8px; cursor: pointer;
      background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.12);
      color: #fff; font: inherit; display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .build-card:hover { background: rgba(255, 255, 255, 0.28); }
    .build-card.current { box-shadow: inset 0 0 0 3px ${css(PALETTE.sand)}; }
    .build-card.lack { cursor: not-allowed; opacity: 0.55; }
    .build-card.lack:hover { background: rgba(255, 255, 255, 0.14); }
    .build-icon { width: 64px; height: 64px; filter: drop-shadow(0 2px 1px rgba(43, 38, 51, 0.45)); }
    .build-name { font-size: 14px; font-weight: 700; }
    .build-cost { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; font-weight: 700; }
    .build-cost img { width: 22px; height: 22px; }
    .build-cost.short { color: ${css(PALETTE.accent)}; }
    .build-help { margin-top: 10px; font-size: 12px; opacity: 0.8; }
    .build-hint {
      position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); pointer-events: none;
      padding: 6px 14px; border-radius: 8px; background: rgba(43, 38, 51, 0.55);
      color: #fff; font-size: 13px; text-align: center; line-height: 1.5; white-space: nowrap;
    }
    .build-hint b { font-size: 15px; }
    .build-hint.hidden { display: none; }
  `;
  document.head.append(style);
}
