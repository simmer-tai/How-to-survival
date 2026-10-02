import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { toon } from './materials.js';
import { woodPiece } from './drops.js';
import { buildLeafModel, buildStickModel } from './itemModels.js';

const WINDUP_END = 0.12; // 振りかぶり終わり（秒）
const IMPACT_AT = 0.2; // 振り下ろしきって当たるタイミング
const SWING_END = 0.42;
const WINDUP_ANGLE = 0.7;
const STRIKE_ANGLE = -1.2;

function part(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color));
  mesh.position.set(x, y, z);
  return mesh;
}

/** 斧頭の側面形（u=刃の方向, v=上）。柄の軸が u=0 */
function headShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.05, 0.035); // 背（峰）
  s.lineTo(0.05, 0.045);
  s.quadraticCurveTo(0.13, 0.05, 0.21, 0.12); // 上側へ反り上がる
  s.quadraticCurveTo(0.27, 0.0, 0.18, -0.15); // 弧を描く刃
  s.quadraticCurveTo(0.11, -0.05, 0.05, -0.045); // 下へ垂れたひげ
  s.lineTo(-0.05, -0.035);
  s.quadraticCurveTo(-0.066, 0, -0.05, 0.035);
  return s;
}

/** 原点が握りの位置。刃は -Z 側を向く */
export function buildAxe(): THREE.Group {
  const g = new THREE.Group();

  // ゆるく反った柄
  const haft = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.2, 0.03),
    new THREE.Vector3(0, -0.04, 0),
    new THREE.Vector3(0, 0.22, -0.012),
    new THREE.Vector3(0, 0.5, 0),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(haft, 8, 0.024, 6, false), toon(PALETTE.trunk)));
  g.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 6), PALETTE.trunk, 0, 0.5, 0)); // 柄の先のふた
  g.add(part(new THREE.CylinderGeometry(0.04, 0.03, 0.05, 6), PALETTE.trunk, 0, -0.205, 0.03)); // 柄尻
  g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.15, 6), PALETTE.accent, 0, -0.04, 0.002)); // 握りの布

  // 面取りした斧頭
  const depth = 0.034;
  const headGeo = new THREE.ExtrudeGeometry(headShape(), {
    depth, curveSegments: 4, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.007, bevelSegments: 1,
  });
  headGeo.translate(0, 0, -depth / 2);
  const head = part(headGeo, PALETTE.rock, 0, 0.43, 0);
  head.rotation.y = Math.PI / 2; // 形の +u を -Z（刃の向き）へ
  g.add(head);

  // 柄を差し込む部分の帯
  g.add(part(new THREE.BoxGeometry(0.06, 0.1, 0.05), PALETTE.rock, 0, 0.43, -0.005));
  return g;
}

/** 一人称視点で手に持つ斧（カメラの子として描画する） */
export class AxeHand {
  private readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private swingTime = -1; // 振っていないときは負
  private impacted = false;

  /** 振り下ろしが当たるタイミングで呼ばれる */
  onImpact: () => void = () => {};

  constructor(camera: THREE.Camera) {
    // 画面右下に構え、振り下ろす面が照準の先（約3m）で画面中央に来るよう少し内側へ向ける
    this.root.position.set(0.5, -0.56, -0.78);
    this.root.rotation.y = Math.atan2(0.5, 3);
    // 斧そのものは刃をほぼ正面に向け、横顔が少し見える程度にひねる
    const axe = buildAxe();
    axe.rotation.set(0.05, 0.12, 0.12);
    this.pivot.add(axe);
    this.root.add(this.pivot);
    this.root.visible = false;
    camera.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(v: boolean) {
    if (v === this.root.visible) return;
    this.root.visible = v;
    this.swingTime = -1;
    this.pivot.rotation.set(0, 0, 0);
  }

  swing(): void {
    if (!this.root.visible || this.swingTime >= 0) return;
    this.swingTime = 0;
    this.impacted = false;
  }

  update(dt: number): void {
    if (this.swingTime < 0) return;
    this.swingTime += dt;
    const t = this.swingTime;
    const lerp = THREE.MathUtils.lerp;
    let angle: number;
    if (t < WINDUP_END) {
      const k = t / WINDUP_END;
      angle = WINDUP_ANGLE * (1 - (1 - k) * (1 - k));
    } else if (t < IMPACT_AT) {
      const k = (t - WINDUP_END) / (IMPACT_AT - WINDUP_END);
      angle = lerp(WINDUP_ANGLE, STRIKE_ANGLE, k * k);
    } else {
      const k = Math.min((t - IMPACT_AT) / (SWING_END - IMPACT_AT), 1);
      angle = lerp(STRIKE_ANGLE, 0, THREE.MathUtils.smootherstep(k, 0, 1));
    }
    this.pivot.rotation.x = angle;

    if (!this.impacted && t >= IMPACT_AT) {
      this.impacted = true;
      this.onImpact();
    }
    if (t >= SWING_END) this.swingTime = -1;
  }
}

const HOLD = new THREE.Vector3(0.3, -0.27, -0.6); // 素材を構える位置（カメラ基準）
const RAISE_TIME = 0.18; // 持ち替えたときに下から持ち上がる時間

/** 手に持つ素材の見た目。持っている数に応じて slots の数まで重ねて見せる */
interface HoldStyle {
  build: () => THREE.Object3D;
  /** 1個目, 2個目, … の位置 [x, y, z] と向き [rx, ry, rz]（root 基準） */
  slots: [number, number, number, number, number, number][];
  rotation: [number, number, number];
  scale: number;
}

const HOLD_STYLES = {
  // 右下で、木口（明るい切り口）がこちらから見えるよう斜めに抱える。1本目を手前に、2・3本目はその上に俵積み
  wood: {
    build: woodPiece,
    slots: [[0, 0, 0, 0, -0.08, Math.PI / 2], [0.03, 0.27, -0.16, 0, 0, Math.PI / 2], [-0.03, 0.27, 0.16, 0, 0.08, Math.PI / 2]],
    rotation: [0.2, 0.6, 0.05],
    scale: 0.5,
  },
  // 束ねた枝を、先を左奥へ倒して握る
  stick: {
    build: buildStickModel,
    slots: [[0, 0, 0, 0, 0, 0], [0.07, 0.04, -0.04, 0, 1.2, 0.2], [-0.06, -0.03, -0.06, 0, -0.9, -0.16]],
    rotation: [-0.75, 0.2, 0.55],
    scale: 0.8,
  },
  // 葉柄をつまんで、葉の表をこちらへ向けて扇のように広げる
  leaf: {
    build: buildLeafModel,
    slots: [[0, 0, 0, 0, 0, 0.05], [0.01, 0, -0.015, 0, 0, -0.5], [-0.01, 0, -0.03, 0, 0, 0.6]],
    rotation: [-0.35, -0.25, -0.2],
    scale: 0.75,
  },
} satisfies Record<string, HoldStyle>;

export type HeldMaterial = keyof typeof HOLD_STYLES;

/** 一人称視点で手に持つ素材（木材・枝・葉っぱ）。持っている数に応じて最大3個まで重ねて見せる */
export class ItemHand {
  private readonly root = new THREE.Group();
  private readonly pieces: THREE.Object3D[] = [];
  private raise = 0; // 0→1 で持ち上がる
  private bob = 0;
  private bump = 0; // 拾ったときに少し跳ねる（1→0）
  private count = 0;

  constructor(camera: THREE.Camera, kind: HeldMaterial) {
    const style: HoldStyle = HOLD_STYLES[kind];
    this.root.position.copy(HOLD);
    this.root.rotation.set(...style.rotation);
    this.root.scale.setScalar(style.scale);
    for (const [x, y, z, rx, ry, rz] of style.slots) {
      const piece = style.build();
      piece.position.set(x, y, z);
      piece.rotation.set(rx, ry, rz);
      this.pieces.push(piece);
      this.root.add(piece);
    }
    this.root.visible = false;
    camera.add(this.root);
  }

  /** 持っている数（0 なら手に何も持たない） */
  setCount(count: number): void {
    if (count > this.count && this.count > 0) this.bump = 1;
    if (count > 0 && !this.root.visible) this.raise = 0;
    this.count = count;
    this.root.visible = count > 0;
    this.pieces.forEach((p, i) => (p.visible = i < Math.min(count, this.pieces.length)));
  }

  update(dt: number, moving: boolean): void {
    if (!this.root.visible) return;
    this.raise = Math.min(this.raise + dt / RAISE_TIME, 1);
    this.bump = Math.max(this.bump - dt * 5, 0);
    if (moving) this.bob += dt * 9;
    const lift = 1 - (1 - this.raise) ** 3;
    this.root.position.y = HOLD.y - (1 - lift) * 0.35 + Math.sin(this.bob) * 0.012 + Math.sin(this.bump * Math.PI) * 0.03;
    this.root.position.x = HOLD.x + Math.cos(this.bob * 0.5) * 0.01;
  }
}
