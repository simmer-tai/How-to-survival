import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';

// ローポリの右手。手首が原点で、指は +Y、手のひらは -Z、親指は -X 側を向く。
// 手首から指先までを1枚のつながった面（スキンメッシュ）で作り、中に入れた骨を回して指を曲げる。
// 関節のまわりの頂点は前後の骨に半分ずつ付けてあるので、曲げても継ぎ目ができずなめらかに折れる。

const SKIN = PALETTE.sand; // 肌の色
const SLEEVE = PALETTE.leaf; // 袖の色
const CUFF = PALETTE.trunk; // 袖口の帯の色

const HAND_SCALE = 1.3; // 手全体の大きさ（下の寸法はすべてこの倍率で拡大される）

const PALM_WIDTH = 0.11; // 手のひらの幅（親指側〜小指側）
const PALM_LENGTH = 0.085; // 手首〜指の付け根
const PALM_THICK = 0.052; // 手のひらの厚み
const SLEEVE_LENGTH = 0.6; // 袖の長さ（画面の外まで伸ばす）
const SLEEVE_RADIUS = 0.064;
const FINGER_SIDES = 6; // 指の断面の角数
const PALM_SIDES = 8; // 手のひら・手首の断面の角数

/** 人差し指〜小指。x・y は付け根の位置、segs は付け根から先への節の長さ、r は太さ */
const FINGERS = [
  { x: -0.039, y: 0, segs: [0.036, 0.023, 0.02], r: 0.0185 }, // 人差し指
  { x: -0.013, y: 0.004, segs: [0.039, 0.025, 0.021], r: 0.019 }, // 中指
  { x: 0.0135, y: 0.001, segs: [0.037, 0.024, 0.02], r: 0.0185 }, // 薬指
  { x: 0.0385, y: -0.007, segs: [0.03, 0.019, 0.017], r: 0.017 }, // 小指
];
const THUMB_BASE = new THREE.Vector3(-0.036, 0.016, -0.006); // 親指の付け根（手首寄りの親指側）
const THUMB_SEGS = [0.036, 0.026, 0.022];
const THUMB_R = 0.021;
const THUMB_ROOT_SHARE = 0.3; // 親指の付け根の関節の皮膚を、手のひらの骨に付ける割合（残りは親指の骨）

export type Vec3 = [number, number, number];
type Bend = [number, number];

/** place() で位置合わせに使う手の基準点。grip は握った柄の中心、pinch は親指と人差し指の先の間 */
export type HandAnchor = 'wrist' | 'palm' | 'grip' | 'pinch';
const GRIP_POINT = new THREE.Vector3(0, 0.074, -0.062); // grip ポーズで握った柄の中心（手のローカル座標）

/** 手の形。曲げ角は rad で、負の値で手のひら側へ曲がる */
export interface HandPose {
  /** 人差し指〜小指の [付け根, 先の丸め]。先の丸めは第二・第一関節に分けて曲げる */
  fingers: Bend[];
  /** 指ごとの開き（Z 回転）。正で親指側へ */
  spread: number[];
  /** 親指の伸びる向きと、曲げたときに指先が向かう向き（どちらも手のローカル座標） */
  thumbDir: Vec3;
  thumbBend: Vec3;
  /** 親指の [付け根, 先の丸め] */
  thumb: Bend;
  /** 親指の付け根を THUMB_BASE からずらす量（手のローカル座標）。握りこむときは付け根ごと手のひらの前へ出す */
  thumbBase?: Vec3;
}

export const HAND_POSES = {
  // 何も持っていないときの、力を抜いた手。小指側ほど深く丸め、親指は人差し指の横に添える
  relaxed: {
    fingers: [[-0.5, -1.0], [-0.65, -1.1], [-0.8, -1.2], [-0.95, -1.3]],
    spread: [0.05, 0.01, -0.03, -0.06],
    thumbDir: [-0.4, 0.8, -0.45],
    thumbBend: [0.6, 0, -1],
    thumb: [-0.15, -0.45],
  },
  // 何も持たずに固く握ったこぶし。指を手のひらに折りこみ、親指を折った人差し指と中指の前へ横に渡す
  // （付け根を前へ出さないと、親指が折った指の中に埋まる）
  fist: {
    fingers: [[-1.46, -2.28], [-1.69, -2.2], [-1.55, -2.15], [-1.6, -2.15]],
    spread: [0.02, 0, -0.02, -0.04],
    thumbDir: [-0.1, 0.39, -0.59],
    thumbBend: [0.59, -0.13, 0.32],
    thumb: [-0.06, -1.68],
    thumbBase: [-0.009, -0.005, -0.032],
  },
  // 柄を握りこむ（斧・枝）。柄は手のひらの前を X 軸方向に通る
  grip: {
    fingers: [[-0.75, -1.6], [-0.7, -1.55], [-0.75, -1.6], [-0.85, -1.75]],
    spread: [0.03, 0, -0.02, -0.05],
    thumbDir: [0.15, 0.45, -0.9],
    thumbBend: [1, 0.3, 0.2],
    thumb: [-0.3, -0.7],
  },
  // 手のひらを上にして物をのせる（木材・ベリー）。指は軽く丸める
  cup: {
    fingers: [[-0.3, -0.5], [-0.32, -0.55], [-0.36, -0.6], [-0.42, -0.7]],
    spread: [0.08, 0.02, -0.03, -0.1],
    thumbDir: [-0.75, 0.6, -0.15],
    thumbBend: [0.3, 0, -1],
    thumb: [-0.1, -0.25],
  },
  // 親指と人差し指でつまむ（葉っぱ）。残りの指は握る
  pinch: {
    fingers: [[-0.95, -1.2], [-1.25, -2.1], [-1.4, -2.3], [-1.5, -2.4]],
    spread: [0.1, 0, -0.03, -0.06],
    thumbDir: [-0.1, 0.65, -0.75],
    thumbBend: [1, 0.3, 0],
    thumb: [-0.2, -0.5],
  },
} satisfies Record<string, HandPose>;

export type HandPoseName = keyof typeof HAND_POSES;

const PIP_SHARE = 0.58; // 先の丸めのうち第二関節が受け持つ割合（残りは第一関節）

const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _x = new THREE.Vector3();
const _base = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/** 頂点を付ける骨と重み。[骨の番号, 重み] の組 */
type Weights = [number, number][];

/** 骨の重み付きの頂点を積み上げて、1枚のスキンメッシュ用ジオメトリを作る */
class SkinBuilder {
  private readonly pos: number[] = [];
  private readonly index: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];

  private vertex(x: number, y: number, z: number, w: Weights): number {
    this.pos.push(x, y, z);
    for (let i = 0; i < 4; i++) {
      this.skinIndex.push(w[i]?.[0] ?? 0);
      this.skinWeight.push(w[i]?.[1] ?? 0);
    }
    return this.pos.length / 3 - 1;
  }

  /** Y 軸に垂直な断面の輪（楕円を sides 角形で近似）。最初の頂点の番号を返す */
  ring(cx: number, y: number, cz: number, rx: number, rz: number, sides: number, w: Weights): number {
    const start = this.pos.length / 3;
    const offset = sides === PALM_SIDES ? Math.PI / sides : 0; // 手のひらは平らな面を表と裏に向ける
    for (let i = 0; i < sides; i++) {
      const a = offset + (i / sides) * Math.PI * 2;
      this.vertex(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz, w);
    }
    return start;
  }

  /** 下の輪 a と上の輪 b を面でつなぐ（法線は外向き） */
  bridge(a: number, b: number, sides: number): void {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.index.push(a + i, b + i, a + j, a + j, b + i, b + j);
    }
  }

  /** 輪をとがった先端で閉じる。up が true なら上向きのふた */
  cap(ring: number, sides: number, x: number, y: number, z: number, w: Weights, up: boolean): void {
    const tip = this.vertex(x, y, z, w);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (up) this.index.push(ring + i, tip, ring + j);
      else this.index.push(ring + i, ring + j, tip);
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    geo.setIndex(this.index);
    geo.computeVertexNormals();
    return geo;
  }
}

/**
 * 指（または親指）1本ぶんの筒を足す。骨はまっすぐ +Y に並んだ状態で作る。
 * root は付け根より手前（手のひらの中）の骨、bones は付け根から先への3本の骨。
 * inner は手のひらの中に埋める根元の輪の位置（付け根からのずれ [x, y]）
 */
function addDigit(
  sb: SkinBuilder, x: number, y: number, z: number, segs: number[], r: number, root: number, bones: number[],
  inner: [number, number] = [0, -r * 1.4],
  rootShare = 0.5,
): void {
  const [a, b, c] = bones;
  const s = FINGER_SIDES;
  const rz = r * 0.85; // 少しつぶして指の背を平らに見せる
  const j1 = y + segs[0];
  const j2 = j1 + segs[1];
  const end = j2 + segs[2];
  const half = (p: number, q: number): Weights => [[p, 0.5], [q, 0.5]];
  const rings = [
    sb.ring(x + inner[0], y + inner[1], z, r * 1.05, rz * 1.05, s, [[root, 1]]), // 手のひらの中に埋まる根元
    sb.ring(x, y, z, r * 1.05, rz * 1.05, s, [[root, rootShare], [a, 1 - rootShare]]), // 付け根の関節
    sb.ring(x, y + segs[0] * 0.5, z, r, rz, s, [[a, 1]]),
    sb.ring(x, j1, z, r * 0.95, rz * 0.95, s, half(a, b)), // 第二関節
    sb.ring(x, j2, z, r * 0.88, rz * 0.88, s, half(b, c)), // 第一関節
    sb.ring(x, end - r * 0.5, z, r * 0.8, rz * 0.78, s, [[c, 1]]),
  ];
  for (let i = 0; i + 1 < rings.length; i++) sb.bridge(rings[i], rings[i + 1], s);
  sb.cap(rings[rings.length - 1], s, x, end + r * 0.15, z + rz * 0.1, [[c, 1]], true);
}

// 骨の番号
const B_HAND = 0;
const B_FOREARM = 1;
const fingerBone = (finger: number, joint: number): number => 2 + finger * 3 + joint;
const thumbBone = (joint: number): number => 14 + joint;
const BONE_COUNT = 17;

/** ローポリの右手（手首から先と袖） */
export class HandModel {
  readonly root = new THREE.Group();
  /** 手首の骨。rotation で手首を曲げる（手のひらは動かさず、腕と袖の向きだけ変わる） */
  readonly forearm: THREE.Bone;
  private readonly bones: THREE.Bone[] = [];

  constructor(pose: HandPoseName = 'relaxed') {
    // 骨（まっすぐ伸ばした状態）
    for (let i = 0; i < BONE_COUNT; i++) this.bones.push(new THREE.Bone());
    const hand = this.bones[B_HAND];
    this.forearm = this.bones[B_FOREARM];
    hand.add(this.forearm);
    FINGERS.forEach((f, i) => {
      const [a, b, c] = [0, 1, 2].map((k) => this.bones[fingerBone(i, k)]);
      a.position.set(f.x, PALM_LENGTH + f.y - 0.006, 0);
      b.position.y = f.segs[0];
      c.position.y = f.segs[1];
      a.rotation.order = 'ZXY'; // 開いてから曲げる
      hand.add(a);
      a.add(b);
      b.add(c);
    });
    const [t0, t1, t2] = [0, 1, 2].map((k) => this.bones[thumbBone(k)]);
    t0.position.copy(THUMB_BASE);
    t1.position.y = THUMB_SEGS[0];
    t2.position.y = THUMB_SEGS[1];
    hand.add(t0);
    t0.add(t1);
    t1.add(t2);

    // 皮膚：腕〜手首〜手のひらを1本の筒で作り、そこから指と親指の筒を生やす
    const sb = new SkinBuilder();
    const p = PALM_SIDES;
    const hx = PALM_WIDTH / 2;
    const hz = PALM_THICK / 2;
    const body = [
      sb.ring(0, -0.1, 0, 0.044, 0.034, p, [[B_FOREARM, 1]]), // 袖の中
      sb.ring(0, -0.03, 0, 0.045, 0.033, p, [[B_FOREARM, 1]]),
      sb.ring(0, 0, 0, 0.047, 0.03, p, [[B_FOREARM, 0.5], [B_HAND, 0.5]]), // 手首
      sb.ring(0, 0.025, -0.002, hx * 0.9, hz, p, [[B_HAND, 1]]),
      sb.ring(0, 0.06, 0, hx, hz, p, [[B_HAND, 1]]),
      sb.ring(0, PALM_LENGTH - 0.004, 0.001, hx * 0.96, hz * 0.88, p, [[B_HAND, 1]]),
    ];
    for (let i = 0; i + 1 < body.length; i++) sb.bridge(body[i], body[i + 1], p);
    sb.cap(body[body.length - 1], p, 0, PALM_LENGTH + 0.004, 0.002, [[B_HAND, 1]], true);
    sb.cap(body[0], p, 0, -0.11, 0, [[B_FOREARM, 1]], false);
    FINGERS.forEach((f, i) => {
      addDigit(sb, f.x, PALM_LENGTH + f.y - 0.006, 0, f.segs, f.r, B_HAND, [0, 1, 2].map((k) => fingerBone(i, k)));
    });
    // 親指の根元は手のひらの中ほどに埋める（手首の縁に置くと、親指を回したときに皮膚が引っぱられてとがる）
    // 付け根の関節は親指の骨寄りに付ける（半分ずつだと、親指を大きく回したときに輪がねじれてつぶれ、こぶになる）
    addDigit(sb, THUMB_BASE.x, THUMB_BASE.y, THUMB_BASE.z, THUMB_SEGS, THUMB_R, B_HAND, [0, 1, 2].map(thumbBone), [0.02, 0.012], THUMB_ROOT_SHARE);

    const skin = new THREE.SkinnedMesh(sb.build(), flat(SKIN));
    skin.frustumCulled = false; // 骨で動くので、作ったときの大きさで画面外判定させない
    skin.add(hand);
    skin.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton(this.bones));
    this.root.add(skin);

    // 袖（服なので別の部品のまま、手首の骨に付ける）
    const cuffR = SLEEVE_RADIUS * 1.08;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(cuffR, cuffR, 0.03, 7).translate(0, -0.03, 0), flat(CUFF));
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(SLEEVE_RADIUS, SLEEVE_RADIUS * 1.25, SLEEVE_LENGTH, 7).translate(0, -0.045 - SLEEVE_LENGTH / 2, 0),
      flat(SLEEVE),
    );
    this.forearm.add(cuff, sleeve);

    this.root.scale.setScalar(HAND_SCALE);
    this.setPose(HAND_POSES[pose]);
  }

  /**
   * 手の anchor の点が at に来るように置き、指が fingers の向き、手のひらが palm の向きを向くように回す（親の座標で指定）。
   * fingers と palm が直交していなくても、fingers を優先して合わせる
   */
  place(at: Vec3, fingers: Vec3, palm: Vec3, anchor: HandAnchor = 'wrist'): void {
    const y = _y.set(...fingers).normalize();
    const z = _z.set(...palm).negate(); // 手のひらは -Z
    z.addScaledVector(y, -z.dot(y)).normalize();
    this.orient(_x.crossVectors(y, z), y, z, at, anchor);
  }

  /**
   * grip ポーズで、at を通り up（親指側）へ伸びる柄を握る。指は柄に直交する範囲で fingers の向きへ近づける。
   * 柄の向きを優先するので、柄が手から抜けない
   */
  grip(at: Vec3, up: Vec3, fingers: Vec3): void {
    const x = _x.set(...up).normalize().negate(); // 親指は -X
    const y = _y.set(...fingers);
    y.addScaledVector(x, -y.dot(x)).normalize();
    this.orient(x, y, _z.crossVectors(x, y), at, 'grip');
  }

  /** 手首を曲げて、腕（袖）を dir の向きへ伸ばす。dir は place()・grip() と同じ親の座標で、place()・grip() のあとに呼ぶ */
  pointForearm(dir: Vec3): void {
    const local = _y.set(...dir).normalize().applyQuaternion(_q.copy(this.root.quaternion).invert());
    this.forearm.quaternion.setFromUnitVectors(DOWN, local);
  }

  private orient(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, at: Vec3, anchor: HandAnchor): void {
    this.root.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
    const offset = this.anchorPoint(anchor).multiplyScalar(HAND_SCALE).applyQuaternion(this.root.quaternion);
    this.root.position.set(...at).sub(offset);
  }

  /** 手のローカル座標での基準点 */
  private anchorPoint(anchor: HandAnchor): THREE.Vector3 {
    switch (anchor) {
      case 'wrist':
        return new THREE.Vector3();
      case 'palm':
        return new THREE.Vector3(0, PALM_LENGTH * 0.55, -PALM_THICK / 2);
      case 'grip':
        return GRIP_POINT.clone();
      case 'pinch': {
        // 今のポーズでの親指と人差し指の先の中間
        this.root.updateMatrixWorld(true);
        const inv = this.root.matrixWorld.clone().invert();
        const tip = (bone: number, len: number) =>
          this.bones[bone].localToWorld(new THREE.Vector3(0, len, 0)).applyMatrix4(inv);
        const a = tip(fingerBone(0, 2), FINGERS[0].segs[2]);
        const b = tip(thumbBone(2), THUMB_SEGS[2]);
        return a.lerp(b, 0.5);
      }
    }
  }

  setPose(pose: HandPose): void {
    FINGERS.forEach((_, i) => {
      const [mcp, curl] = pose.fingers[i];
      this.bones[fingerBone(i, 0)].rotation.set(mcp, 0, pose.spread[i]);
      this.bones[fingerBone(i, 1)].rotation.x = curl * PIP_SHARE;
      this.bones[fingerBone(i, 2)].rotation.x = curl * (1 - PIP_SHARE);
    });
    // 親指の付け根：+Y を伸びる向きに、-Z（曲がる側）を曲げる向きに合わせてから、付け根を曲げる
    const y = _y.set(...pose.thumbDir).normalize();
    const z = _z.set(...pose.thumbBend);
    z.addScaledVector(y, -z.dot(y)).normalize().negate();
    const x = _x.crossVectors(y, z);
    const t0 = this.bones[thumbBone(0)];
    t0.position.copy(THUMB_BASE);
    if (pose.thumbBase) t0.position.add(_base.set(...pose.thumbBase));
    t0.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
    t0.rotateX(pose.thumb[0]);
    this.bones[thumbBone(1)].rotation.x = pose.thumb[1] * PIP_SHARE;
    this.bones[thumbBone(2)].rotation.x = pose.thumb[1] * (1 - PIP_SHARE);
  }
}
