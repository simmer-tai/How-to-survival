import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import type { FireCommand, WorldRequest } from '../core/commands.js';
import { ITEMS, type ItemId, type Stack } from '../items/inventory.js';
import type { PieceInfo } from './build.js';
import { FIRE_RING } from './pieces.js';
import { WIND_DIR } from '../world/wind.js';

// 焚火。石と枝でクラフトしたアイテムを手に持って置き（置くのは actions/build.ts）、F で燃料の欄を開いて燃料を入れる。
// 燃料の欄と、今燃えている燃料ののこり時間は共有ワールドの状態（誰が見ても同じ焚火が燃えている）。
// 燃料を入れる・取り出すのはワールドコマンド（addFuel・takeFuel）で、燃え尽きて次の燃料に移るのは時間を進めるホストが出す burnFuel

/** 燃料になる物。time は1つが燃える時間（秒）、size は燃えているときの炎の大きさ（木材を 1 とする） */
export const FUELS: Partial<Record<ItemId, { time: number; size: number }>> = {
  wood: { time: 120, size: 1 }, // 丸太から取った木材は太いので長く大きく燃える
  plank: { time: 60, size: 0.85 },
  stick: { time: 30, size: 0.7 },
  vine: { time: 15, size: 0.6 },
  leaf: { time: 8, size: 0.55 }, // 葉っぱはすぐ燃え尽きる
};

const FLAME_HEIGHT = 0.75; // いちばん大きい炎の高さ（size 1 のとき）
const FLAME_RADIUS = 0.2; // いちばん大きい炎の根元の太さ
const FLICKER = 0.12; // 炎の高さの揺らぎ（割合）
const FADE_TIME = 20; // のこりがこの秒数を切ると、炎が小さくなっていく
const FADE_MIN = 0.45; // 燃え尽きる直前の炎の大きさ（割合）
const GROW_SPEED = 3; // 炎の大きさが目標へ近づく速さ（1/秒）。燃え上がる・消えるときになめらかに変わる
const FLARE = 0.5; // 燃料に火がついた瞬間に、炎がこの割合だけ大きく燃え上がる
const FLARE_TIME = 0.8; // 燃え上がった炎が元の大きさに戻る時間
const LIGHT_INTENSITY = 6; // 火の明かりの強さ（size 1 のとき）
const LIGHT_RANGE = 14; // 火の明かりが届く距離
const LIGHT_HEIGHT = 0.6; // 火の明かりを置く高さ
const SPARK_RATE = 6; // 1秒に飛ぶ火の粉の数（size 1 のとき）
const SPARK_LIFE = 1.1; // 火の粉が消えるまでの時間
const SPARK_RISE = 1.4; // 火の粉が上がる速さ
const SPARK_SIZE = 0.035;
const COALS = 5; // 燃えている間、真ん中で赤く光る熾火の数
// 煙：炎の先から丸い煙のかたまりが立ちのぼり、ふくらみながら風下へ流れて薄れる。火が消えたあともしばらくくすぶる
const SMOKE_RATE = 2.5; // 燃えている間に1秒に出る煙のかたまりの数（size 1 のとき）
const SMOLDER_RATE = 4; // 消えた直後のくすぶりで、1秒に出る煙のかたまりの数
const SMOLDER_TIME = 10; // 火が消えてから、くすぶりの煙が出なくなるまでの時間
const SMOKE_LIFE = 4.5; // 煙のかたまりが消えるまでの時間
const SMOKE_RISE = 0.9; // 煙が上がり始める速さ
const SMOKE_DRAG = 0.35; // 上がる速さが落ちていく割合（1/秒）。上へ行くほどゆっくり広がる
const SMOKE_START = 0.07; // 出たばかりの煙のかたまりの大きさ
const SMOKE_END = 0.55; // 消える頃の煙のかたまりの大きさ
const SMOKE_OPACITY = 0.42; // 煙のいちばん濃いときの不透明度（くすぶりはこれより濃い）
const SMOLDER_OPACITY = 0.6;
const SMOKE_WIND = 0.5; // 風がいちばん強いとき、煙が風下へ流される加速度（風がなくても少しは流れる）
const SMOKE_SWIRL = 0.25; // 煙が左右に揺らぎながら上がる強さ
const SMOKE_LUMPS = 3; // 煙のかたまり1つを作る丸い玉の数（重ねてもこもこさせる）
const SMOKE_MAX = 40; // 焚火1つの煙のかたまりの数の上限
const AIM_HEIGHT = 1; // 焚火を狙える高さ（低い石の輪だけでなく、炎のあたりを見ても使えるように）

const AIM_EPS = 0.05;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const flameGeo = new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0); // 底面の中心が原点、高さ 1・半径 1
const sparkGeo = new THREE.BoxGeometry(SPARK_SIZE, SPARK_SIZE, SPARK_SIZE);
const coalGeo = new THREE.BoxGeometry(0.09, 0.05, 0.07);
// 炎・熾火・火の粉は自分で光っているので、光の当たり方に関係なく同じ色で描く
const flameOuterMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent });
const flameInnerMat = new THREE.MeshBasicMaterial({ color: PALETTE.sand });
const sparkMat = new THREE.MeshBasicMaterial({ color: PALETTE.sand });
const lightColor = new THREE.Color(PALETTE.accent).lerp(new THREE.Color(PALETTE.sand), 0.5);
const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
// 煙の色：出たては濃い灰色、上がるにつれて空に溶ける明るい灰色になる
const SMOKE_DARK = new THREE.Color(PALETTE.rock).lerp(new THREE.Color(PALETTE.bark), 0.35);
const SMOKE_LIGHT = new THREE.Color(PALETTE.rock).lerp(new THREE.Color(PALETTE.sky), 0.55);

/**
 * 炎1枚の形：[太さ, 高さ, 根元の x, 根元の z, 揺れの速さ]。太さ・位置は FLAME_RADIUS、高さは FLAME_HEIGHT に対する割合。
 * 赤い炎を黄色い芯のまわりに少しずつずらして立て、すき間から芯が見えるようにする
 */
const FLAME_SHAPES: [number, number, number, number, number][] = [
  [0.4, 1, 0, 0, 7.3],
  [0.6, 0.8, 0.55, 0.1, 9.1],
  [0.55, 0.7, -0.35, 0.45, 8.2],
  [0.55, 0.75, -0.3, -0.5, 10.3],
];
const INNER_SHAPE: [number, number, number, number, number] = [0.75, 0.6, 0, 0, 11.7];
const FLAME_SWAY = 0.1; // 炎が左右に傾いて揺れる角度（rad）

/** 火の粉1つ（自分の画面だけの演出） */
interface Spark { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }

/** 煙のかたまり1つ（自分の画面だけの演出）。玉を重ねたグループで、マテリアルはかたまりごとに持って薄れさせる */
interface Puff { group: THREE.Group; mat: THREE.MeshLambertMaterial; vel: THREE.Vector3; age: number; life: number; size: number; opacity: number; spin: number }

interface Fire {
  pid: number;
  /** 燃料の欄に入っている、まだ燃やしていない燃料 */
  fuel: Stack | null;
  /** 今燃えている燃料（消えていれば null） */
  item: ItemId | null;
  /** 今燃えている燃料ののこり時間（秒） */
  left: number;
  // ---- 見た目（自分の画面だけ） ----
  root: THREE.Group;
  flames: THREE.Mesh[];
  coals: THREE.Group;
  light: THREE.PointLight;
  sparks: Spark[];
  puffs: Puff[];
  /** 使い終わって、また使える煙のかたまり */
  spare: Puff[];
  /** 煙を出すまでの時間 */
  smokeWait: number;
  /** くすぶりののこり（火が消えたときに 1、0 で煙が止まる） */
  smolder: number;
  /** 前のフレームで燃えていたか（消えた瞬間を知るため） */
  burning: boolean;
  /** 今の炎の大きさ（0 で消えている） */
  level: number;
  /** 燃え上がりののこり（1→0） */
  flare: number;
  /** 火の粉を出すまでの時間 */
  sparkWait: number;
  /** 揺らぎを焚火ごとにずらす */
  phase: number;
}

/** セーブデータ上の焚火1つ。pid は部材の番号、fuel は燃料の欄、item・left は今燃えている燃料とのこり時間（消えていれば省く） */
export interface FireSave { pid: number; fuel?: Stack; item?: string; left?: number }

/** 焚火の燃料の欄を見る画面に出す、焚火のようす */
export interface FireInfo {
  fuel: Stack | null;
  item: ItemId | null;
  left: number;
  /** 今燃えている燃料が、1つで燃える時間 */
  total: number;
  /** 燃料の欄の分も合わせて、あと何秒燃えるか */
  remaining: number;
}

/** 燃料になる物か */
export function isFuel(item: ItemId): boolean {
  return FUELS[item] !== undefined;
}

/** 秒を「分:秒」にする */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 置いてある焚火の燃料と火。焚火の部材そのもの（置く・壊す）は Builder が持ち、ここは部材の番号ごとに燃料と火を持つ。
 * 入力側（燃料の欄の画面 campfireMenu.ts）は request で頼みを出すだけにし、apply はコマンドの値だけで火を変える
 */
export class Campfires {
  private readonly fires = new Map<number, Fire>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly box = new THREE.Box3();
  private readonly hitPoint = new THREE.Vector3();

  /** 共有ワールドへの頼みを出す（main が requestWorld を入れる）。適用できたら true */
  request: (req: WorldRequest) => boolean = () => false;

  constructor(private readonly world: THREE.Object3D) {}

  /** その番号の焚火がまだあるか */
  has(pid: number): boolean {
    return this.fires.has(pid);
  }

  /**
   * 視線の先、reach 以内にある焚火の番号（なければ null）。石の輪の上、炎のあたりの高さまでを狙える。
   * targets（地形・岩・部材など）のほうが手前に当たれば、さえぎられているとみなす
   */
  aimed(camera: THREE.Camera, reach: number, targets: THREE.Object3D[]): number | null {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    const ray = this.raycaster.ray;
    let best: number | null = null;
    let bestDist = reach;
    for (const f of this.fires.values()) {
      if (!f.root.layers.test(this.raycaster.layers)) continue; // 今いない場所（島にいない間）の焚火は狙えない
      const { x, y, z } = f.root.position;
      const r = FIRE_RING + 0.1;
      this.box.min.set(x - r, y, z - r);
      this.box.max.set(x + r, y + AIM_HEIGHT, z + r);
      const hit = ray.intersectBox(this.box, this.hitPoint);
      if (!hit) continue;
      const d = hit.distanceTo(ray.origin);
      if (d < bestDist) {
        best = f.pid;
        bestDist = d;
      }
    }
    if (best === null) return null;
    this.raycaster.far = bestDist;
    const block = this.raycaster.intersectObjects(targets, false)[0];
    this.raycaster.far = Infinity;
    return block && block.distance < bestDist - AIM_EPS && !this.isFireMesh(block.object, best) ? null : best;
  }

  /** 焚火の番号ごとの、石の輪の部材のメッシュ（さえぎっている物が焚火そのものなら、さえぎりとみなさない） */
  private isFireMesh(o: THREE.Object3D, pid: number): boolean {
    const f = this.fires.get(pid);
    return !!f && o.position.distanceTo(f.root.position) < 0.01;
  }

  /** 焚火のようす（燃料の欄の画面に出す）。なければ null */
  info(pid: number): FireInfo | null {
    const f = this.fires.get(pid);
    if (!f) return null;
    const total = f.item ? FUELS[f.item]!.time : 0;
    const queued = f.fuel ? FUELS[f.fuel.item]!.time * f.fuel.count : 0;
    return { fuel: f.fuel, item: f.item, left: f.item ? Math.max(f.left, 0) : 0, total, remaining: (f.item ? Math.max(f.left, 0) : 0) + queued };
  }

  /** 燃料の欄に入っている物（ハンマーで解体したとき、焚火と一緒にインベントリへ戻す） */
  contents(pid: number): Stack[] {
    const f = this.fires.get(pid);
    return f?.fuel ? [{ ...f.fuel }] : [];
  }

  /** 置いてある焚火の部材に合わせて、焚火を足したり除いたりする（部材が増えた・減ったときに呼ぶ） */
  sync(list: PieceInfo[]): void {
    const alive = new Set(list.map((p) => p.pid));
    for (const pid of [...this.fires.keys()]) if (!alive.has(pid)) this.removeFire(pid);
    for (const p of list) if (!this.fires.has(p.pid)) this.addFire(p);
  }

  // ---- ホスト側：頼みを確かめてコマンドにする ----

  /** 頼みを確かめてコマンドにする。できなければ null（マルチではホストだけが呼ぶ） */
  authorize(req: FireCommand): FireCommand | null {
    const f = this.fires.get(req.pid);
    if (!f) return null;
    if (req.type === 'addFuel') {
      const item = req.item as ItemId;
      if (!(item in ITEMS) || !isFuel(item) || !Number.isInteger(req.count) || req.count < 1) return null;
      if (f.fuel && f.fuel.item !== item) return null; // 燃料の欄には1種類だけ入る
      if ((f.fuel?.count ?? 0) + req.count > ITEMS[item].maxStack) return null;
      return { type: 'addFuel', pid: req.pid, item, count: req.count };
    }
    if (req.type === 'takeFuel') {
      if (!f.fuel || !Number.isInteger(req.count) || req.count < 1 || req.count > f.fuel.count) return null;
      return { type: 'takeFuel', pid: req.pid, count: req.count };
    }
    return f.item !== null && f.left <= 0 ? { type: 'burnFuel', pid: req.pid } : null;
  }

  /**
   * 燃えている燃料の時間を進め、燃え尽きたら次の燃料を燃やす頼みを出す（マルチではホストだけが呼ぶ）。
   * のこり時間はセーブに入るので、ロードしたあとも続きから燃える
   */
  tick(dt: number): void {
    for (const f of this.fires.values()) {
      if (f.item === null) continue;
      f.left -= dt;
      if (f.left <= 0) this.request({ type: 'burnFuel', pid: f.pid });
    }
  }

  // ---- 適用側：コマンドの値だけで焚火を変える ----

  apply(cmd: FireCommand): void {
    const f = this.fires.get(cmd.pid);
    if (!f) return;
    if (cmd.type === 'addFuel') {
      const item = cmd.item as ItemId;
      f.fuel = f.fuel ? { item: f.fuel.item, count: f.fuel.count + cmd.count } : { item, count: cmd.count };
      if (f.item === null) this.burnNext(f); // 消えていたら、入れた燃料ですぐ燃え上がる
    } else if (cmd.type === 'takeFuel') {
      if (!f.fuel) return;
      const count = f.fuel.count - cmd.count;
      f.fuel = count > 0 ? { item: f.fuel.item, count } : null;
    } else {
      this.burnNext(f);
    }
  }

  /** 燃料の欄から1つ燃やす。燃料がなければ火が消える */
  private burnNext(f: Fire): void {
    if (!f.fuel) {
      f.item = null;
      f.left = 0;
      return;
    }
    f.item = f.fuel.item;
    f.left = FUELS[f.item]!.time;
    f.fuel = f.fuel.count > 1 ? { item: f.fuel.item, count: f.fuel.count - 1 } : null;
    f.flare = 1;
  }

  serialize(): FireSave[] {
    return [...this.fires.values()].map((f) => ({
      pid: f.pid,
      ...(f.fuel ? { fuel: { ...f.fuel } } : {}),
      ...(f.item ? { item: f.item, left: Math.round(Math.max(f.left, 0) * 10) / 10 } : {}),
    }));
  }

  /** 部材を戻した（sync した）あとに呼ぶ。セーブにない焚火は、燃料のない消えた焚火にする */
  restore(save: FireSave[]): void {
    for (const f of this.fires.values()) {
      f.fuel = null;
      f.item = null;
      f.left = 0;
      f.level = 0;
      f.smolder = 0;
    }
    for (const s of save) {
      const f = this.fires.get(s.pid);
      if (!f) continue;
      const fuel = s.fuel;
      if (fuel && fuel.item in ITEMS && isFuel(fuel.item) && Number.isInteger(fuel.count) && fuel.count > 0) {
        f.fuel = { item: fuel.item, count: Math.min(fuel.count, ITEMS[fuel.item].maxStack) };
      }
      if (s.item && s.item in ITEMS && isFuel(s.item as ItemId) && Number.isFinite(s.left)) {
        f.item = s.item as ItemId;
        f.left = Math.min(Math.max(s.left!, 0), FUELS[f.item]!.time);
        f.level = this.targetLevel(f); // ロードしたときは燃え上がらせずに、そのままの大きさで始める
        f.flare = 0;
      }
    }
    for (const f of this.fires.values()) f.burning = f.item !== null; // ロードしたときにくすぶらせない
  }

  // ---- 見た目（自分の画面だけ） ----

  private addFire(p: PieceInfo): void {
    const root = new THREE.Group();
    root.position.set(...p.p);
    const flames = [...FLAME_SHAPES, INNER_SHAPE].map(([, , x, z], i) => {
      const m = new THREE.Mesh(flameGeo, i === FLAME_SHAPES.length ? flameInnerMat : flameOuterMat);
      m.position.set(x * FLAME_RADIUS, 0.04, z * FLAME_RADIUS);
      return m;
    });
    // 熾火：焚火の番号から並びを決める（誰の画面でも同じ）
    const coals = new THREE.Group();
    for (let i = 0; i < COALS; i++) {
      const a = (i / COALS) * Math.PI * 2 + p.pid;
      const coal = new THREE.Mesh(coalGeo, flameOuterMat);
      coal.position.set(Math.sin(a) * FIRE_RING * 0.35, 0.03, Math.cos(a) * FIRE_RING * 0.35);
      coal.rotation.y = a * 1.7;
      coals.add(coal);
    }
    // 消えている間も明かりは残し、強さを 0 にする（明かりの数が変わるとシェーダーを作り直して一瞬止まるので）
    const light = new THREE.PointLight(lightColor, 0, LIGHT_RANGE, 1);
    light.position.y = LIGHT_HEIGHT;
    root.add(...flames, coals, light);
    this.world.add(root);
    this.fires.set(p.pid, {
      pid: p.pid,
      fuel: null,
      item: null,
      left: 0,
      root,
      flames,
      coals,
      light,
      sparks: [],
      puffs: [],
      spare: [],
      smokeWait: 0,
      smolder: 0,
      burning: false,
      level: 0,
      flare: 0,
      sparkWait: 0,
      phase: (p.pid * 2.399) % (Math.PI * 2),
    });
  }

  private removeFire(pid: number): void {
    const f = this.fires.get(pid);
    if (!f) return;
    f.root.removeFromParent();
    for (const s of f.sparks) s.mesh.removeFromParent();
    for (const p of [...f.puffs, ...f.spare]) p.mat.dispose();
    this.fires.delete(pid);
  }

  /** 今燃えている燃料での炎の大きさ（消えていれば 0。燃え尽きる前は小さくなる） */
  private targetLevel(f: Fire): number {
    if (f.item === null) return 0;
    const fade = THREE.MathUtils.clamp(f.left / FADE_TIME, 0, 1);
    return FUELS[f.item]!.size * (FADE_MIN + (1 - FADE_MIN) * fade);
  }

  /** 炎を揺らし、火の粉と煙を飛ばす。t は経過時間、wind は風の強さ（0〜1。煙を風下へ流す） */
  update(dt: number, t: number, wind: number): void {
    for (const f of this.fires.values()) {
      if (f.burning && f.item === null) f.smolder = 1; // 今消えた
      f.burning = f.item !== null;
      f.smolder = Math.max(f.smolder - dt / SMOLDER_TIME, 0);
      // 今いない場所（街にいる間の島）の焚火は隠れているので、火の粉や煙を新しく出さない（出すと隠れずに見えてしまう）
      const shown = f.root.layers.isEnabled(0);
      const target = this.targetLevel(f);
      f.level += (target - f.level) * Math.min(dt * GROW_SPEED, 1);
      if (target === 0 && f.level < 0.01) f.level = 0;
      f.flare = Math.max(f.flare - dt / FLARE_TIME, 0);
      const level = f.level * (1 + FLARE * f.flare * f.flare);
      const lit = level > 0;

      const shapes = [...FLAME_SHAPES, INNER_SHAPE];
      f.flames.forEach((m, i) => {
        m.visible = lit;
        if (!lit) return;
        const [r, h, , , speed] = shapes[i];
        const flicker = 1 + FLICKER * (Math.sin(t * speed + f.phase + i) + 0.5 * Math.sin(t * speed * 1.9 + i * 2.1));
        m.scale.set(FLAME_RADIUS * r * level, FLAME_HEIGHT * h * level * flicker, FLAME_RADIUS * r * level);
        m.rotation.set(FLAME_SWAY * Math.sin(t * speed * 0.37 + i), t * 0.6 * (i % 2 === 0 ? 1 : -1) + i, FLAME_SWAY * Math.sin(t * speed * 0.29 + i * 1.3));
      });
      f.coals.visible = f.item !== null;
      f.light.intensity = lit ? LIGHT_INTENSITY * level * (1 + 0.08 * Math.sin(t * 13 + f.phase) + 0.05 * Math.sin(t * 7.1)) : 0;

      // 火の粉（Math.random は自分の画面だけの演出なので使ってよい）
      if (lit && shown) {
        f.sparkWait -= dt;
        while (f.sparkWait <= 0) {
          f.sparkWait += 1 / (SPARK_RATE * level) * (0.5 + Math.random());
          const mesh = new THREE.Mesh(sparkGeo, sparkMat);
          mesh.position.set((Math.random() - 0.5) * 0.2, 0.25 * level, (Math.random() - 0.5) * 0.2);
          f.root.add(mesh);
          const vel = new THREE.Vector3((Math.random() - 0.5) * 0.5, SPARK_RISE * (0.6 + Math.random() * 0.8), (Math.random() - 0.5) * 0.5);
          f.sparks.push({ mesh, vel, life: SPARK_LIFE * (0.6 + Math.random() * 0.6) });
        }
      }
      for (let i = f.sparks.length - 1; i >= 0; i--) {
        const s = f.sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          s.mesh.removeFromParent();
          f.sparks.splice(i, 1);
          continue;
        }
        s.vel.x += Math.sin(t * 5 + i) * dt * 0.8; // ふらふらと舞い上がる
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.scale.setScalar(Math.min(s.life / (SPARK_LIFE * 0.5), 1));
      }
      this.updateSmoke(f, dt, t, lit ? level : 0, wind, shown);
    }
  }

  /** 煙を出して、上らせ、ふくらませ、薄れさせる（Math.random は自分の画面だけの演出なので使ってよい） */
  private updateSmoke(f: Fire, dt: number, t: number, level: number, wind: number, shown: boolean): void {
    const rate = SMOKE_RATE * level + SMOLDER_RATE * f.smolder;
    if (rate > 0.05 && shown) {
      f.smokeWait -= dt;
      while (f.smokeWait <= 0) {
        f.smokeWait += (1 / rate) * (0.6 + Math.random() * 0.8);
        if (f.puffs.length >= SMOKE_MAX) continue;
        // くすぶりの煙は熾火のすぐ上から、燃えているときは炎の先から出る
        const top = level > 0 ? FLAME_HEIGHT * level * 0.8 : 0.08;
        this.spawnPuff(f, top, level > 0 ? SMOKE_OPACITY : SMOLDER_OPACITY);
      }
    } else {
      f.smokeWait = 0;
    }
    const drift = SMOKE_WIND * (0.15 + wind);
    for (let i = f.puffs.length - 1; i >= 0; i--) {
      const p = f.puffs[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.group.removeFromParent();
        f.puffs.splice(i, 1);
        f.spare.push(p);
        continue;
      }
      // 上がる勢いは落ち、風下へは流されていく。揺らぎで左右にうねる
      p.vel.y *= Math.exp(-SMOKE_DRAG * dt);
      p.vel.x += (WIND_DIR.x * drift + Math.sin(t * 1.3 + p.spin * 7) * SMOKE_SWIRL) * dt;
      p.vel.z += (WIND_DIR.y * drift + Math.cos(t * 1.1 + p.spin * 5) * SMOKE_SWIRL) * dt;
      p.group.position.addScaledVector(p.vel, dt);
      p.group.rotation.y += p.spin * dt;
      // 大きさは出たてで素早く、あとはゆっくりふくらむ。濃さはすぐ濃くなって、だんだん薄れる
      const grow = 1 - (1 - k) * (1 - k);
      p.group.scale.setScalar(p.size * (SMOKE_START + (SMOKE_END - SMOKE_START) * grow));
      p.mat.opacity = p.opacity * Math.min(k / 0.12, 1) * (1 - k) * (1 - k * 0.3);
      p.mat.color.copy(SMOKE_DARK).lerp(SMOKE_LIGHT, Math.min(k * 1.6, 1));
    }
  }

  private spawnPuff(f: Fire, y: number, opacity: number): void {
    let p = f.spare.pop();
    if (!p) {
      const mat = new THREE.MeshLambertMaterial({ color: SMOKE_DARK, flatShading: true, transparent: true, opacity: 0, depthWrite: false });
      const group = new THREE.Group();
      for (let i = 0; i < SMOKE_LUMPS; i++) {
        const lump = new THREE.Mesh(smokeGeo, mat);
        lump.renderOrder = 2; // 炎より後に描いて、炎が煙に透けて見えるようにする
        group.add(lump);
      }
      p = { group, mat, vel: new THREE.Vector3(), age: 0, life: 0, size: 1, opacity, spin: 0 };
    }
    // 玉の並びはかたまりごとに変える（でこぼこした煙にする）
    p.group.children.forEach((lump, i) => {
      const r = i === 0 ? 0 : 0.55;
      const a = Math.random() * Math.PI * 2;
      lump.position.set(Math.cos(a) * r, (Math.random() - 0.3) * 0.5, Math.sin(a) * r);
      lump.scale.set(0.7 + Math.random() * 0.4, 0.6 + Math.random() * 0.35, 0.7 + Math.random() * 0.4).multiplyScalar(i === 0 ? 1 : 0.75);
    });
    // 隠れている間に使い終えたかたまりは隠れたレイヤーのままなので、見えるレイヤーに戻す
    p.group.traverse((o) => {
      o.layers.set(0);
      delete o.userData.shownLayers;
    });
    p.group.position.set((Math.random() - 0.5) * 0.12, y, (Math.random() - 0.5) * 0.12);
    p.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
    p.group.scale.setScalar(0.001);
    p.vel.set((Math.random() - 0.5) * 0.15, SMOKE_RISE * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 0.15);
    p.age = 0;
    p.life = SMOKE_LIFE * (0.75 + Math.random() * 0.5);
    p.size = 0.8 + Math.random() * 0.5;
    p.opacity = opacity;
    p.spin = (Math.random() - 0.5) * 0.8;
    p.mat.opacity = 0;
    f.root.add(p.group);
    f.puffs.push(p);
  }
}
