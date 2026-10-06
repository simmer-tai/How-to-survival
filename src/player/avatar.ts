import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { solid } from '../core/materials.js';
import { box, headGeometry, joint, lathe, limb, mix, shade } from './bodyParts.js';
import { buildHeldModel } from './hand.js';

/** 自分の体を描くレイヤー。一人称のときは画面に映さず影だけ落とし、三人称のときはカメラに映す */
export const AVATAR_LAYER = 2;

// ---- 体の寸法（桟橋の住人と同じ。身長およそ 1.8m） ----
const HIP_Y = 0.93; // 腰の高さ
const THIGH = 0.42; // 太ももの長さ
const SHIN = 0.4; // すねの長さ
const SHOULDER_Y = 0.43; // 背骨の付け根から肩までの高さ
const SEAT_HIP = 1.0; // 船に座ったときの、足元（目の高さ - 1.7m）から腰までの高さ
const SWIM_PIVOT = 1.45; // 泳ぐときに体を前へ倒す中心の高さ（肩のあたり。頭が水から出たままになる）
const CROUCH_DROP = 0.26; // しゃがんだときに腰が下がる量

// ---- 動きの調整 ----
const STRIDE = 1.4; // 1歩で進む距離（m）。動く速さから脚を振る速さを決める
const WALK_SPEED = 6; // この速さで歩きの振りがいっぱいになる（プレイヤーの歩く速さ）
const RUN_EXTRA = 5; // 歩く速さからさらにこれだけ速いと、走りの振りがいっぱいになる
const LEG_SWING = 0.5; // 歩くときに脚を前後へ振る角度（走るとさらに大きく振る）
const ARM_SWING = 0.45; // 歩くときに腕を振る角度
const RUN_LEAN = 0.18; // 走るときに体を前へ倒す角度
const SWIM_LEAN = 1.2; // 泳いで進むときに体を前へ倒す角度
const HEAD_YAW_MAX = 0.9; // 体を回さずに顔だけ向けられる角度（これを超えると体がついてくる）
const BODY_TURN = 8; // 動いている間に、体が視線の向きへ追いつく速さ
const POSE_SPEED = 12; // しゃがむ・座る・泳ぐなどの姿勢が切り替わる速さ
const BREATH_SPEED = 1.5; // 呼吸の速さ
const BLINK_TIME = 0.12; // まばたきで目を閉じている時間（秒）
const LONG_TOOL_TILT = 2.25; // 槍や釣り竿を、前の上へ向けて持つための手首での傾き
const ITEM_ELBOW = -1.3; // 素材を持つときに肘を曲げて、前腕を前へ出す角度

/** 色の選択肢 */
export interface ColorChoice { name: string; color: number }

/** 肌の色 */
export const SKIN_TONES: ColorChoice[] = [
  { name: '色白', color: shade(mix(PALETTE.sand, PALETTE.accent, 0.15), 1.04) },
  { name: '小麦色', color: mix(mix(PALETTE.sand, PALETTE.accent, 0.3), PALETTE.trunk, 0.2) },
  { name: '褐色', color: mix(PALETTE.trunk, PALETTE.sand, 0.35) },
  { name: 'こげ茶', color: shade(PALETTE.trunk, 0.8) },
];

/** 髪の色 */
export const HAIR_COLORS: ColorChoice[] = [
  { name: '黒', color: shade(PALETTE.bark, 0.45) },
  { name: '茶', color: shade(PALETTE.bark, 0.9) },
  { name: '栗色', color: PALETTE.trunk },
  { name: '金', color: mix(PALETTE.sand, PALETTE.trunk, 0.25) },
  { name: '赤', color: mix(PALETTE.accent, PALETTE.bark, 0.35) },
  { name: '白', color: shade(PALETTE.rock, 1.35) },
];

/** シャツ・ズボンの色 */
export const CLOTH_COLORS: ColorChoice[] = [
  { name: '赤', color: PALETTE.accent },
  { name: '黄緑', color: PALETTE.grass },
  { name: '緑', color: PALETTE.leaf },
  { name: '水色', color: PALETTE.water },
  { name: '紺', color: shade(PALETTE.water, 0.5) },
  { name: '砂色', color: PALETTE.sand },
  { name: '白', color: shade(PALETTE.sand, 1.1) },
  { name: '灰', color: PALETTE.rock },
  { name: '茶', color: PALETTE.trunk },
  { name: 'こげ茶', color: PALETTE.bark },
];

export const HAIR_STYLES = ['短髪', '長髪', 'ポニーテール', 'おだんご'] as const;
export const HATS = ['なし', '麦わら帽子', 'バンダナ', 'ニット帽'] as const;

/** 見た目。どれも選択肢の番号（自分だけの状態。ワールドではなくブラウザに保存する。マルチでは参加するときに他の人へ送る） */
export interface AvatarLook { skin: number; hair: number; hairStyle: number; hat: number; shirt: number; pants: number }

export const LOOK_PARTS = {
  skin: SKIN_TONES.length,
  hair: HAIR_COLORS.length,
  hairStyle: HAIR_STYLES.length,
  hat: HATS.length,
  shirt: CLOTH_COLORS.length,
  pants: CLOTH_COLORS.length,
} satisfies Record<keyof AvatarLook, number>;

export const DEFAULT_LOOK: AvatarLook = { skin: 1, hair: 1, hairStyle: 0, hat: 0, shirt: 3, pants: 4 };

const LOOK_KEY = 'warfarming:avatar';

/** 保存してあった値や、マルチでほかの人から届いた値を見た目にする（おかしな値の所は最初の見た目にする） */
export function toLook(value: unknown): AvatarLook {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Partial<AvatarLook>;
  const look = { ...DEFAULT_LOOK };
  for (const key of Object.keys(LOOK_PARTS) as (keyof AvatarLook)[]) {
    const v = saved[key];
    if (Number.isInteger(v) && v! >= 0 && v! < LOOK_PARTS[key]) look[key] = v!;
  }
  return look;
}

/** ブラウザに保存した見た目を読む（なければ、読めなければ最初の見た目） */
export function loadLook(): AvatarLook {
  try {
    return toLook(JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLook(look: AvatarLook): void {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    // 保存できなくても、今の画面ではそのまま使う
  }
}

/** おまかせの見た目（自分の画面で選ぶだけなので Math.random() でよい） */
export function randomLook(): AvatarLook {
  const pick = (n: number) => Math.floor(Math.random() * n);
  const look = { ...DEFAULT_LOOK };
  for (const key of Object.keys(LOOK_PARTS) as (keyof AvatarLook)[]) look[key] = pick(LOOK_PARTS[key]);
  return look;
}

/**
 * 体の様子。プレイヤーが毎フレーム作る（マルチでは、他の人に見せる分としてこれを送る）
 */
export interface AvatarPose {
  /** 足元の位置（船に座っているときは、目の高さ - 1.7m） */
  p: THREE.Vector3;
  /** 視線の水平の向き（カメラと同じく 0 で -Z を向く） */
  yaw: number;
  /** 視線の上下（上が +） */
  pitch: number;
  /** 水平に動く速さ（m/秒） */
  speed: number;
  state: 'ground' | 'air' | 'swim' | 'sit';
  /** しゃがみ具合（0〜1） */
  crouch: number;
  /** 体の向き（船に座っているときの舳先の向き。yaw と同じ向きの取り方）。省くと視線に合わせて回る */
  bodyYaw?: number;
}

/** 腕の振り方（道具を振る・突く） */
export type AvatarSwing = 'chop' | 'thrust';

/** 振りのキーフレーム。t=秒、shoulder・elbow=右腕の関節の前後の角度。null は構えの角度 */
type ArmKey = [t: number, shoulder: number | null, elbow: number | null];
const SWINGS: Record<AvatarSwing, ArmKey[]> = {
  // 一人称の振りと同じ間合いで、肩の上へ振りかぶってから振り下ろす
  chop: [[0, null, null], [0.16, -2.9, -0.5], [0.25, -0.75, -0.1], [0.31, -0.65, -0.1], [0.52, null, null]],
  // 手元へ引いてから、前へまっすぐ突き出す
  thrust: [[0, null, null], [0.12, -0.7, -1.7], [0.2, -1.45, -0.05], [0.27, -1.45, -0.05], [0.5, null, null]],
};

/** 手に持っている物の持ち方 */
type Grip = 'none' | 'tool' | 'long' | 'item';

/** -π〜π に収める */
function wrap(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

const damp = THREE.MathUtils.damp;

/** 体を組み立てたときの関節（見た目を変えると作り直す） */
interface Rig {
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Mesh;
  neck: THREE.Group;
  head: THREE.Group;
  shoulders: THREE.Group[];
  elbows: THREE.Group[];
  /** 右手の、持ち物を付ける所 */
  holder: THREE.Group;
  thighs: THREE.Group[];
  knees: THREE.Group[];
  ankles: THREE.Group[];
  eyes: THREE.Group[];
}

/**
 * プレイヤーの体（アバター）。見た目は AvatarLook、動きは毎フレームの AvatarPose から決める。
 * 自分の体は、一人称では影だけ、三人称（V キー）では姿も見える。マルチでは他の人の体もこれで描く
 */
export class Avatar {
  readonly object = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly body = new THREE.Group();
  private rig!: Rig;
  private look: AvatarLook;

  private bodyYaw = Math.PI;
  private time = 0;
  private phase = 0; // 歩きの周期
  private stride = 0; // 歩きの振りの大きさ（0〜1）
  private run = 0; // 走りの振りの大きさ（0〜1）
  private crouch = 0;
  private sit = 0;
  private air = 0;
  private swim = 0;
  private swimLean = 0;
  private headYaw = 0;
  private headPitch = 0;
  private blinkTimer = 2;
  private blinkLeft = 0;
  private swingKind: AvatarSwing = 'chop';
  private swingTime = -1; // 振っていないときは負
  private charge = 0; // 槍を投げる力を溜めている間、腕を振りかぶる（0〜1）
  private chargeTarget = 0;
  private held: string | null = null;
  private grip: Grip = 'none';
  private heldModel: THREE.Object3D | null = null;

  /** layer は体を描くレイヤー（自分の体は AVATAR_LAYER。マルチで描く他の人の体は、いつも見える 0） */
  constructor(look: AvatarLook, private readonly layer = AVATAR_LAYER) {
    this.look = look;
    this.tilt.position.y = SWIM_PIVOT;
    this.body.position.y = -SWIM_PIVOT;
    this.tilt.add(this.body);
    this.object.add(this.tilt);
    this.build();
  }

  get currentLook(): AvatarLook {
    return { ...this.look };
  }

  /** 見た目を変える（体を作り直す。持っている物はそのまま） */
  setLook(look: AvatarLook): void {
    this.look = { ...look };
    for (const child of [...this.body.children]) {
      this.body.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose(); // 持ち物も一緒に捨てて、作り直す
      });
    }
    const held = this.held;
    this.held = null;
    this.heldModel = null;
    this.build();
    this.setHeld(held);
  }

  /** 右手に持つ物（ITEMS の id。何も持たなければ null） */
  setHeld(item: string | null): void {
    if (item === this.held) return;
    this.held = item;
    if (this.heldModel) {
      this.rig.holder.remove(this.heldModel);
      this.heldModel.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.heldModel = null;
    }
    const held = item ? buildHeldModel(item) : null;
    this.grip = !held ? 'none' : !held.tool ? 'item' : item === 'spear' || item === 'fishingRod' ? 'long' : 'tool';
    if (!held) return;
    const model = held.model;
    if (this.grip === 'tool') {
      // 柄を腕の延長に沿わせ、刃を振り下ろす向きへ向ける（振りかぶると頭が肩から一番遠くなる）
      model.rotation.set(-0.4, 0, Math.PI);
    } else if (this.grip === 'long') {
      model.rotation.x = LONG_TOOL_TILT;
    } else {
      // 肘を曲げた前腕の上に、水平にのせる
      model.rotation.x = -ITEM_ELBOW;
      model.position.set(0, -0.02, 0.06);
    }
    this.heldModel = model;
    this.rig.holder.add(model);
    this.toLayer(model);
  }

  /** 右腕で道具を振る（一人称の振りと同じ間合い） */
  swing(kind: AvatarSwing): void {
    if (this.swingTime >= 0) return;
    this.swingKind = kind;
    this.swingTime = 0;
  }

  /** 槍を投げる力を溜めている間は、腕を振りかぶる（溜めていなければ null） */
  setCharge(charge: number | null): void {
    this.chargeTarget = charge === null ? 0 : THREE.MathUtils.smootherstep(charge, 0, 1);
  }

  update(dt: number, pose: AvatarPose): void {
    this.time += dt;
    const r = this.rig;
    this.object.position.copy(pose.p);

    // ---- 体の向き：動いている間は視線の向きへ追いつき、止まっている間は首だけで向けない分だけ回る ----
    const look = pose.yaw + Math.PI; // 体の正面は +Z。カメラは yaw 0 で -Z を向く
    if (pose.bodyYaw !== undefined) this.bodyYaw = pose.bodyYaw + Math.PI;
    else {
      if (pose.speed > 0.5 || pose.state === 'swim') this.bodyYaw += wrap(look - this.bodyYaw) * (1 - Math.exp(-BODY_TURN * dt));
      const diff = wrap(look - this.bodyYaw);
      if (Math.abs(diff) > HEAD_YAW_MAX) this.bodyYaw = look - Math.sign(diff) * HEAD_YAW_MAX;
    }
    this.bodyYaw = wrap(this.bodyYaw);
    this.object.rotation.y = this.bodyYaw;

    // ---- 姿勢の切り替え（なめらかに移る） ----
    const swimming = pose.state === 'swim';
    this.crouch = damp(this.crouch, pose.state === 'ground' ? pose.crouch : 0, POSE_SPEED, dt);
    this.sit = damp(this.sit, pose.state === 'sit' ? 1 : 0, POSE_SPEED, dt);
    this.air = damp(this.air, pose.state === 'air' ? 1 : 0, POSE_SPEED, dt);
    this.swim = damp(this.swim, swimming ? 1 : 0, POSE_SPEED * 0.5, dt);
    this.swimLean = damp(this.swimLean, swimming ? SWIM_LEAN * THREE.MathUtils.clamp(pose.speed / 3, 0, 1) : 0, 4, dt);
    const walking = pose.state === 'ground';
    this.stride = damp(this.stride, walking ? THREE.MathUtils.clamp(pose.speed / WALK_SPEED, 0, 1) : 0, 10, dt);
    this.run = damp(this.run, walking ? THREE.MathUtils.clamp((pose.speed - WALK_SPEED) / RUN_EXTRA, 0, 1) : 0, 6, dt);
    // 歩いた距離だけ脚の周期を進める（止まると、そのときの脚の角度から振りが小さくなって止まる）
    this.phase += (walking ? pose.speed : 0) * dt * Math.PI / STRIDE;
    if (swimming) this.phase += dt * (2 + pose.speed);
    const c = this.crouch;
    const sit = this.sit;
    const air = this.air;
    const swim = this.swim;
    const stride = this.stride * (1 - sit);
    const legAmp = LEG_SWING * (stride + this.run * 0.5);
    const breath = Math.sin(this.time * BREATH_SPEED);
    const step = Math.abs(Math.sin(this.phase));

    // ---- 腰と背骨 ----
    this.tilt.rotation.x = this.swimLean;
    r.hips.position.set(0, THREE.MathUtils.lerp(HIP_Y - c * CROUCH_DROP - step * 0.035 * stride, SEAT_HIP, sit), -c * 0.1);
    r.hips.rotation.y = Math.sin(this.phase) * 0.12 * stride;
    r.spine.rotation.x = c * 0.35 + this.run * RUN_LEAN + air * 0.05;
    r.spine.rotation.y = -r.hips.rotation.y * 1.4; // 腰と逆にひねる
    r.chest.scale.set(1 + breath * 0.01, 1 + breath * 0.005, 1 + breath * 0.03);

    // ---- 脚：歩く・走る・しゃがむ・跳ぶ・座る・水をかく ----
    [0, 1].forEach((i) => {
      const s = Math.sin(this.phase + i * Math.PI);
      const kick = Math.sin(this.time * 7 + i * Math.PI); // 水中で足をばたつかせる
      let thigh = -c * 1.0 - s * legAmp - air * (i === 0 ? 0.5 : 0.1);
      let knee = c * 1.6 + Math.max(0, Math.sin(this.phase + i * Math.PI - 0.9)) * legAmp * 1.6 + air * (i === 0 ? 0.9 : 0.4);
      let ankle = -c * 0.6 - air * 0.2;
      thigh = THREE.MathUtils.lerp(thigh, kick * 0.3 - 0.15, swim);
      knee = THREE.MathUtils.lerp(knee, 0.3 + Math.max(0, kick) * 0.4, swim);
      ankle = THREE.MathUtils.lerp(ankle, 0.5, swim);
      r.thighs[i].rotation.x = THREE.MathUtils.lerp(thigh, -1.45, sit);
      r.knees[i].rotation.x = THREE.MathUtils.lerp(knee, 1.35, sit);
      r.ankles[i].rotation.x = THREE.MathUtils.lerp(ankle, 0.1, sit);
    });

    // ---- 腕：歩くと脚と逆に振る。泳ぐと水をかき、座ると前で櫂を握る。右手は持ち物の持ち方に合わせる ----
    const grip = this.grip;
    this.charge = damp(this.charge, this.chargeTarget, 14, dt);
    let swingArm: [number, number] | null = null;
    if (this.swingTime >= 0) {
      this.swingTime += dt;
      const keys = SWINGS[this.swingKind];
      const t = Math.min(this.swingTime, keys[keys.length - 1][0]);
      let k = 1;
      while (k < keys.length - 1 && t > keys[k][0]) k++;
      const [ta, sa, ea] = keys[k - 1];
      const [tb, sb, eb] = keys[k];
      const u = THREE.MathUtils.smoothstep((t - ta) / (tb - ta), 0, 1);
      const base = this.restArm(0);
      swingArm = [THREE.MathUtils.lerp(sa ?? base[0], sb ?? base[0], u), THREE.MathUtils.lerp(ea ?? base[1], eb ?? base[1], u)];
      if (this.swingTime >= keys[keys.length - 1][0]) this.swingTime = -1;
    }
    [-1, 1].forEach((side, i) => {
      const s = Math.sin(this.phase + i * Math.PI);
      const stroke = Math.sin(this.time * 3 + (pose.speed > 0.5 ? 0 : i * Math.PI));
      const [restShoulder, restElbow] = this.restArm(i);
      let shoulder = restShoulder + s * ARM_SWING * (stride + this.run * 0.6) * (i === 0 && grip !== 'none' ? 0.3 : 1) + air * -0.4;
      let elbow = restElbow - this.run * 0.6 - c * 0.3;
      let spread = side * (0.1 + air * 0.25);
      // 泳ぐ：前へ倒れて進むときは平泳ぎのように前へ伸ばしてかき、浮いているときは横へ広げて水をかく
      const lean = this.swimLean / SWIM_LEAN;
      shoulder = THREE.MathUtils.lerp(shoulder, THREE.MathUtils.lerp(-0.4 + stroke * 0.3, -2.4 + stroke * 0.5, lean), swim);
      elbow = THREE.MathUtils.lerp(elbow, -0.6 - Math.max(0, stroke) * 0.5 * lean, swim);
      spread = THREE.MathUtils.lerp(spread, side * THREE.MathUtils.lerp(0.9 + stroke * 0.2, 0.35 + stroke * 0.25, lean), swim);
      // 座る：両手を前へ出して櫂を握る
      shoulder = THREE.MathUtils.lerp(shoulder, -0.75, sit);
      elbow = THREE.MathUtils.lerp(elbow, -0.7, sit);
      spread = THREE.MathUtils.lerp(spread, side * 0.15, sit);
      if (i === 0) {
        // 槍を溜めている間は肩の上へ振りかぶる
        shoulder = THREE.MathUtils.lerp(shoulder, -2.7, this.charge);
        elbow = THREE.MathUtils.lerp(elbow, -0.9, this.charge);
        if (swingArm) [shoulder, elbow] = swingArm;
      }
      r.shoulders[i].position.y = SHOULDER_Y + breath * 0.004;
      r.shoulders[i].rotation.x = shoulder;
      r.shoulders[i].rotation.z = spread;
      r.elbows[i].rotation.x = elbow;
    });
    if (this.heldModel) this.heldModel.visible = swim < 0.5; // 泳いでいる間は持ち物をしまう

    // ---- 頭：視線の向きを向く（首を振るのは、首と頭で分け合う）。体を倒して泳ぐ間は前を見るように起こす ----
    const yawLimit = sit > 0.5 ? 1.5 : HEAD_YAW_MAX + 0.3;
    this.headYaw = damp(this.headYaw, THREE.MathUtils.clamp(wrap(look - this.bodyYaw), -yawLimit, yawLimit), 15, dt);
    const pitch = THREE.MathUtils.clamp(-pose.pitch - r.spine.rotation.x, -0.9, 0.8) - this.swimLean;
    this.headPitch = damp(this.headPitch, pitch, 15, dt);
    r.neck.rotation.y = this.headYaw * 0.4;
    r.head.rotation.y = this.headYaw * 0.6;
    r.neck.rotation.x = this.headPitch * 0.4;
    r.head.rotation.x = this.headPitch * 0.6;

    // ---- まばたき ----
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkLeft = BLINK_TIME;
      this.blinkTimer = 2 + Math.random() * 4;
    }
    this.blinkLeft -= dt;
    for (const eye of r.eyes) eye.scale.y = this.blinkLeft > 0 ? 0.12 : 1;
  }

  /** 構えた腕の角度 [肩, 肘]。i=0 が右腕 */
  private restArm(i: number): [number, number] {
    if (i !== 0) return [0, -0.2];
    switch (this.grip) {
      case 'tool':
        return [-0.15, -0.55];
      case 'long':
        return [-0.25, -1.2];
      case 'item':
        return [-0.15, ITEM_ELBOW];
      default:
        return [0, -0.2];
    }
  }

  /** look の見た目で体を組み立てる（住人の体と同じ作り。服は半袖のシャツとズボン） */
  private build(): void {
    const look = this.look;
    const skin = SKIN_TONES[look.skin].color;
    const hair = HAIR_COLORS[look.hair].color;
    const shirt = CLOTH_COLORS[look.shirt].color;
    const pants = CLOTH_COLORS[look.pants].color;
    const shoe = shade(PALETTE.bark, 0.75);

    // ---- 腰と脚 ----
    const hips = joint(this.body, 0, HIP_Y, 0);
    hips.add(lathe([[0, -0.11], [0.11, -0.115], [0.163, -0.045], [0.16, 0.05], [0.15, 0.08], [0, 0.08]], 0.68, pants));
    const belt = solid(new THREE.CylinderGeometry(0.153, 0.155, 0.035, 12), shade(PALETTE.bark, 0.9));
    belt.scale.z = 0.69;
    belt.position.y = 0.06;
    hips.add(belt);
    const thighs: THREE.Group[] = [];
    const knees: THREE.Group[] = [];
    const ankles: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const thigh = joint(hips, side * 0.09, -0.06, 0);
      limb(thigh, 0.08, 0.058, THIGH, pants);
      const knee = joint(thigh, 0, -THIGH, 0);
      knee.add(solid(new THREE.SphereGeometry(0.058, 8, 6), pants)); // 膝を曲げても継ぎ目が割れないように
      limb(knee, 0.057, 0.045, SHIN, pants);
      const ankle = joint(knee, 0, -SHIN, 0);
      box(ankle, 0.095, 0.07, 0.24, shoe, 0, -0.015, 0.055);
      box(ankle, 0.1, 0.02, 0.25, shade(shoe, 0.7), 0, -0.04, 0.055); // 靴底
      thighs.push(thigh);
      knees.push(knee);
      ankles.push(ankle);
    }

    // ---- 胴体 ----
    const spine = joint(hips, 0, 0.05, 0);
    const chest = lathe(
      [[0, 0], [0.15, 0], [0.158, 0.1], [0.172, 0.25], [0.19, 0.38], [0.186, 0.45], [0.12, 0.5], [0.05, 0.52], [0, 0.52]],
      0.6,
      shirt,
    );
    spine.add(chest);
    const hem = solid(new THREE.CylinderGeometry(0.152, 0.152, 0.03, 12), shade(shirt, 0.85)); // すその折り返し
    hem.scale.z = 0.62;
    hem.position.y = 0.015;
    spine.add(hem);
    const collar = solid(new THREE.CylinderGeometry(0.068, 0.08, 0.035, 10), shade(shirt, 0.85));
    collar.position.y = 0.505;
    spine.add(collar);

    // ---- 腕：半袖。i=0 が右腕（体の正面は +Z なので、右は -X） ----
    const shoulders: THREE.Group[] = [];
    const elbows: THREE.Group[] = [];
    let holder!: THREE.Group;
    for (const side of [-1, 1]) {
      const shoulder = joint(spine, side * 0.2, SHOULDER_Y, 0);
      const cap = solid(new THREE.SphereGeometry(0.06, 8, 6), shirt);
      cap.scale.set(1, 0.9, 0.95);
      shoulder.add(cap);
      limb(shoulder, 0.058, 0.054, 0.13, shirt);
      limb(shoulder, 0.047, 0.039, 0.29, skin);
      const elbow = joint(shoulder, 0, -0.29, 0);
      elbow.add(solid(new THREE.SphereGeometry(0.039, 8, 6), skin));
      limb(elbow, 0.039, 0.029, 0.25, skin);
      const wrist = joint(elbow, 0, -0.25, 0);
      box(wrist, 0.032, 0.09, 0.075, skin, 0, -0.045, 0); // 手のひら
      const fingers = box(wrist, 0.026, 0.075, 0.07, skin, -side * 0.004, -0.12, 0.004);
      fingers.rotation.x = -0.15;
      const thumb = box(wrist, 0.022, 0.06, 0.022, skin, -side * 0.01, -0.06, 0.045);
      thumb.rotation.x = -0.3;
      if (side === -1) holder = joint(wrist, 0, -0.09, 0);
      shoulders.push(shoulder);
      elbows.push(elbow);
    }

    // ---- 首と頭 ----
    const neck = joint(spine, 0, 0.49, 0);
    limb(neck, 0.046, 0.052, 0.1, skin, 0.09);
    const head = joint(neck, 0, 0.07, 0);
    head.rotation.order = 'YXZ'; // 横を向いてから、上下にうなずく
    head.add(solid(headGeometry(), skin));
    for (const side of [-1, 1]) {
      const ear = solid(new THREE.SphereGeometry(0.028, 6, 5), skin);
      ear.scale.set(0.38, 1, 0.62);
      ear.position.set(side * 0.112, 0.105, -0.005);
      head.add(ear);
    }
    const eyes: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const eye = joint(head, side * 0.04, 0.125, 0.107);
      box(eye, 0.028, 0.016, 0.01, shade(PALETTE.sand, 1.12), 0, 0, 0);
      box(eye, 0.012, 0.014, 0.006, shade(PALETTE.bark, 0.45), 0, 0, 0.004);
      eyes.push(eye);
      const brow = box(head, 0.036, 0.008, 0.012, hair, side * 0.042, 0.148, 0.108);
      brow.rotation.z = side * -0.12;
    }
    const nose = box(head, 0.022, 0.045, 0.03, shade(skin, 0.95), 0, 0.098, 0.121);
    nose.rotation.x = -0.25;
    box(head, 0.045, 0.01, 0.01, shade(skin, 0.55), 0, 0.058, 0.105); // 口
    this.buildHair(head, hair, look.hairStyle);
    this.buildHat(head, look.hat);

    this.rig = { hips, spine, chest, neck, head, shoulders, elbows, holder, thighs, knees, ankles, eyes };
    this.toLayer(this.body);
  }

  private buildHair(head: THREE.Group, hair: number, style: number): void {
    // どの髪型も、頭より少し大きい半球を後ろへ傾けてかぶせる（生え際を上げ、後ろ髪を下げる）
    const cap = solid(new THREE.SphereGeometry(0.123, 12, 6, 0, Math.PI * 2, 0, 1.55), hair);
    cap.scale.set(1.02, 1.15, 1.1);
    cap.position.set(0, 0.112, -0.004);
    cap.rotation.x = -0.65;
    head.add(cap);
    switch (HAIR_STYLES[style]) {
      case '長髪': {
        // 後ろ髪を肩まで下ろし、横の髪を耳の前に垂らす
        const back = solid(new THREE.BoxGeometry(0.23, 0.3, 0.06), hair);
        back.position.set(0, 0.0, -0.105);
        back.rotation.x = 0.12;
        head.add(back);
        for (const side of [-1, 1]) box(head, 0.03, 0.17, 0.07, hair, side * 0.115, 0.06, 0.02);
        break;
      }
      case 'ポニーテール': {
        const tie = solid(new THREE.SphereGeometry(0.03, 8, 6), shade(PALETTE.accent, 0.9));
        tie.position.set(0, 0.17, -0.13);
        head.add(tie);
        const tail = joint(head, 0, 0.17, -0.14);
        tail.rotation.x = -0.35;
        limb(tail, 0.035, 0.012, 0.26, hair);
        break;
      }
      case 'おだんご': {
        const bun = solid(new THREE.SphereGeometry(0.06, 10, 8), hair);
        bun.position.set(0, 0.25, -0.07);
        head.add(bun);
        break;
      }
    }
  }

  private buildHat(head: THREE.Group, hat: number): void {
    switch (HATS[hat]) {
      case '麦わら帽子': {
        const straw = shade(PALETTE.sand, 0.88);
        const g = joint(head, 0, 0.18, -0.008);
        g.rotation.x = -0.1;
        g.add(solid(new THREE.CylinderGeometry(0.205, 0.215, 0.012, 16), straw)); // つば
        const crown = solid(new THREE.CylinderGeometry(0.105, 0.125, 0.1, 14), straw);
        crown.position.y = 0.05;
        g.add(crown);
        const band = solid(new THREE.CylinderGeometry(0.127, 0.128, 0.025, 14), shade(PALETTE.bark, 0.9));
        band.position.y = 0.017;
        g.add(band);
        break;
      }
      case 'バンダナ': {
        // 額に巻いて、後ろで結ぶ
        const cloth = PALETTE.accent;
        const g = joint(head, 0, 0.165, 0);
        g.rotation.x = -0.25;
        const band = solid(new THREE.CylinderGeometry(0.13, 0.135, 0.04, 14), cloth);
        band.scale.set(1, 1, 1.12);
        g.add(band);
        const knot = box(g, 0.04, 0.035, 0.03, shade(cloth, 0.85), 0, 0, -0.15);
        knot.rotation.z = 0.4;
        for (const side of [-1, 1]) {
          const end = box(g, 0.03, 0.08, 0.01, cloth, side * 0.02, -0.05, -0.155);
          end.rotation.z = side * 0.3;
        }
        break;
      }
      case 'ニット帽': {
        const wool = shade(PALETTE.water, 0.6);
        const g = joint(head, 0, 0.13, -0.008);
        g.rotation.x = -0.2;
        const top = solid(new THREE.SphereGeometry(0.135, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), wool);
        top.scale.set(1, 1.05, 1.1);
        g.add(top);
        const rim = solid(new THREE.CylinderGeometry(0.14, 0.14, 0.045, 14), shade(wool, 0.85));
        rim.scale.z = 1.1;
        g.add(rim);
        const pom = solid(new THREE.SphereGeometry(0.035, 8, 6), shade(PALETTE.sand, 1.05));
        pom.position.y = 0.145;
        g.add(pom);
        break;
      }
    }
  }

  /** 体の部品を体のレイヤーに移し、影を落とすようにする */
  private toLayer(root: THREE.Object3D): void {
    root.traverse((o) => {
      o.layers.set(this.layer);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }
}
