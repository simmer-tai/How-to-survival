import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { solid } from '../core/materials.js';
import { box, headGeometry, joint, lathe, limb, mix, shade } from '../player/bodyParts.js';
import { terrainHeight } from './terrain.js';

// ---- 置く場所 ----
const SIDE = 2.2; // 桟橋の中心線から横へずらす量（通り道をふさがないように）
const BACK = 1.2; // 桟橋の陸側の端から、陸のほうへ下がる量

// ---- 体の寸法（身長およそ 1.8m、頭は身長の 1/7 くらい） ----
const HIP_Y = 0.93; // 腰の高さ
const THIGH = 0.42; // 太ももの長さ
const SHIN = 0.4; // すねの長さ
const LEG = THIGH + SHIN; // 股関節から足首まで
const HEAD_Y = 1.68; // 目のおおよその高さ（視線の上下を決める）

// ---- 動きの調整 ----
const BREATH_SPEED = 1.5; // 呼吸の速さ
const WEIGHT_SHIFT = [6, 12]; // 体重を左右の足に乗せかえる間隔（秒）
const WEIGHT_SPEED = 1.2; // 体重を乗せかえる速さ
const LOOK_DISTANCE = 10; // プレイヤーがこれより近いと顔を向ける
const LOOK_MAX = 1.2; // 体を回さずに顔を向けられる最大の角度（ラジアン）
const LOOK_SPEED = 5; // 顔の向きが追いつく速さ
const TURN_START = 0.9; // プレイヤーがこの角度より横・後ろにいると、体ごと向き直る
const TURN_DELAY = 1.2; // 向き直るまでに待つ時間（秒）
const TURN_SPEED = 1.4; // 向き直るときの回る速さ（ラジアン／秒）
const STEP_RATE = 9; // 向き直るときの足踏みの速さ
const RETURN_DELAY = 6; // プレイヤーが離れてから、元の向きへ戻るまでの時間（秒）
const BLINK_TIME = 0.12; // まばたきで目を閉じている時間（秒）

const SCREEN_CENTER = new THREE.Vector2(0, 0);

/** -π〜π に収める */
function wrap(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** 住人の見た目 */
export interface NpcLook {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  /** 胸当てとつりひも付きの作業ズボン（ズボンと同じ色）。true なら胸ポケットとボタンは隠れる */
  overalls: boolean;
  /** 麦わら帽子のつばの半径（0 なら帽子をかぶらない） */
  brim: number;
  /** 丸めがねをかける */
  glasses?: boolean;
}

/** 桟橋の人：日焼けした肌、赤いシャツ、紺のズボン、麦わら帽子 */
export const PIER_LOOK: NpcLook = {
  skin: mix(mix(PALETTE.sand, PALETTE.accent, 0.3), PALETTE.trunk, 0.2),
  shirt: PALETTE.accent,
  pants: shade(PALETTE.water, 0.5),
  hair: shade(PALETTE.bark, 0.75),
  overalls: false,
  brim: 0.21,
};

/** 街の農家：生成りのシャツに緑の作業ズボン、つばの広い麦わら帽子 */
export const FARMER_LOOK: NpcLook = {
  skin: mix(mix(PALETTE.sand, PALETTE.accent, 0.25), PALETTE.trunk, 0.3),
  shirt: shade(PALETTE.sand, 1.02),
  pants: shade(PALETTE.leaf, 0.8),
  hair: shade(PALETTE.rock, 0.85),
  overalls: true,
  brim: 0.29,
};

/** 街の地図売り：青いシャツに茶色のズボン、帽子はかぶらず丸めがね。白髪まじり */
export const MAP_LOOK: NpcLook = {
  skin: mix(PALETTE.sand, PALETTE.trunk, 0.18),
  shirt: shade(PALETTE.water, 0.85),
  pants: shade(PALETTE.bark, 1.1),
  hair: mix(PALETTE.rock, PALETTE.sand, 0.35),
  overalls: false,
  brim: 0,
  glasses: true,
};

/** 桟橋の前に立つ位置と向き。pierFoot は桟橋の陸側の端で、桟橋は pierFoot から +Z へ伸びている */
export function pierSpot(pierFoot: THREE.Vector3): { position: THREE.Vector3; yaw: number } {
  const x = pierFoot.x + SIDE;
  const z = pierFoot.z - BACK;
  // 桟橋の上を歩いてくる人を迎えるように、桟橋の先（海側）を向く
  return { position: new THREE.Vector3(x, terrainHeight(x, z), z), yaw: Math.atan2(pierFoot.x - x, pierFoot.z + 6 - z) };
}

/**
 * 島や街に立っている住人。最初からいる動かない物なので、立つ位置は地形や建物から計算して誰の画面でも同じになる。
 * 呼吸・体重の乗せかえ・まばたき・よそ見・プレイヤーへ顔や体を向ける動きは、自分の画面だけの演出。
 * 状態を持たないのでセーブも同期もしない（演出の間合いには Math.random() を使う）
 */
export class Npc {
  readonly object = new THREE.Group();
  /** 当たり判定と視線をさえぎる用の、見えない円柱 */
  readonly collider: THREE.Mesh;

  private readonly hips: THREE.Group;
  private readonly spine: THREE.Group;
  private readonly chest: THREE.Mesh;
  private readonly neck: THREE.Group;
  private readonly head: THREE.Group;
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly thighs: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly ankles: THREE.Group[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly pupils: THREE.Mesh[] = [];

  /** プレイヤーが離れたときに戻る、元の向き */
  private readonly homeYaw: number;
  private time = 0;
  /** -1〜1。+1 なら右（+X 側）の足に体重を乗せている */
  private weight = 1;
  private weightTarget = 1;
  private weightTimer = 4;
  private blinkTimer = 2;
  private blinkLeft = 0;
  private idleYaw = 0;
  private idlePitch = 0;
  private idleTimer = 5;
  private lookYaw = 0;
  private lookPitch = 0;
  private uneasy = 0; // プレイヤーが横・後ろにいる時間
  private away = 0; // プレイヤーが離れている時間
  private turnTo: number | null = null;
  private stepPhase = 0;
  private readonly lifts = [0, 0];
  private readonly raycaster = new THREE.Raycaster();

  /** position は足元、homeYaw はふだん向いている向き */
  constructor(position: THREE.Vector3, homeYaw: number, look: NpcLook = PIER_LOOK) {
    this.object.position.copy(position);
    this.homeYaw = homeYaw;
    this.object.rotation.y = homeYaw;

    const { skin, shirt, pants, hair } = look;
    const shoe = shade(PALETTE.bark, 0.75);
    const straw = shade(PALETTE.sand, 0.88);

    // ---- 腰と脚 ----
    this.hips = joint(this.object, 0, HIP_Y, 0);
    const pelvis = lathe([[0, -0.11], [0.11, -0.115], [0.163, -0.045], [0.16, 0.05], [0.15, 0.08], [0, 0.08]], 0.68, pants);
    this.hips.add(pelvis);
    const belt = solid(new THREE.CylinderGeometry(0.153, 0.155, 0.035, 12), shade(PALETTE.bark, 0.9));
    belt.scale.z = 0.69;
    belt.position.y = 0.06;
    this.hips.add(belt);
    box(this.hips, 0.035, 0.03, 0.01, PALETTE.rock, 0, 0.06, 0.106); // バックル
    for (const side of [-1, 1]) {
      const thigh = joint(this.hips, side * 0.09, -0.06, 0);
      thigh.rotation.y = side * 0.08; // つま先を少し外へ
      limb(thigh, 0.08, 0.058, THIGH, pants);
      const knee = joint(thigh, 0, -THIGH, 0);
      knee.add(solid(new THREE.SphereGeometry(0.058, 8, 6), pants)); // 膝を曲げても継ぎ目が割れないように
      limb(knee, 0.057, 0.045, SHIN, pants);
      const ankle = joint(knee, 0, -SHIN, 0);
      box(ankle, 0.095, 0.07, 0.24, shoe, 0, -0.015, 0.055);
      box(ankle, 0.1, 0.02, 0.25, shade(shoe, 0.7), 0, -0.04, 0.055); // 靴底
      this.thighs.push(thigh);
      this.knees.push(knee);
      this.ankles.push(ankle);
    }

    // ---- 胴体 ----
    this.spine = joint(this.hips, 0, 0.05, 0);
    this.chest = lathe(
      [[0, 0], [0.15, 0], [0.158, 0.1], [0.172, 0.25], [0.19, 0.38], [0.186, 0.45], [0.12, 0.5], [0.05, 0.52], [0, 0.52]],
      0.6,
      shirt,
    );
    this.spine.add(this.chest);
    // 胸ポケットとボタン・作業ズボンの胸当ては、呼吸でふくらむ胸と一緒に動くように胸の子にする（z は胸の表面）
    if (look.overalls) {
      box(this.chest, 0.21, 0.24, 0.014, pants, 0, 0.13, 0.1); // 胸当て
      box(this.chest, 0.08, 0.06, 0.006, shade(pants, 0.85), 0, 0.17, 0.108); // 胸当てのポケット
      for (const side of [-1, 1]) {
        const strap = box(this.chest, 0.035, 0.24, 0.012, pants, side * 0.09, 0.36, 0.107); // つりひも（肩へ）
        strap.rotation.x = -0.25;
        box(this.chest, 0.022, 0.022, 0.01, PALETTE.rock, side * 0.085, 0.24, 0.108); // 留め金
      }
    } else {
      box(this.chest, 0.07, 0.08, 0.012, shade(shirt, 0.85), 0.085, 0.36, 0.11);
      for (const [y, z] of [[0.12, 0.097], [0.23, 0.103], [0.34, 0.111], [0.44, 0.112]]) box(this.chest, 0.014, 0.014, 0.01, shade(shirt, 0.7), 0, y, z);
    }
    const collar = solid(new THREE.CylinderGeometry(0.068, 0.08, 0.035, 10), shade(shirt, 0.9));
    collar.position.y = 0.505;
    this.spine.add(collar);

    // ---- 腕：袖は肘の手前まで、その先は日焼けした腕 ----
    for (const side of [-1, 1]) {
      const shoulder = joint(this.spine, side * 0.2, 0.43, 0);
      // 肩の丸みと袖（袖口はゆるく広がる）
      const cap = solid(new THREE.SphereGeometry(0.06, 8, 6), shirt);
      cap.scale.set(1, 0.9, 0.95);
      shoulder.add(cap);
      limb(shoulder, 0.058, 0.056, 0.16, shirt);
      limb(shoulder, 0.047, 0.039, 0.29, skin);
      const elbow = joint(shoulder, 0, -0.29, 0);
      elbow.add(solid(new THREE.SphereGeometry(0.039, 8, 6), skin));
      limb(elbow, 0.039, 0.029, 0.25, skin);
      const wrist = joint(elbow, 0, -0.25, 0);
      box(wrist, 0.032, 0.09, 0.075, skin, 0, -0.045, 0); // 手のひら
      const fingers = box(wrist, 0.026, 0.075, 0.07, skin, -side * 0.004, -0.12, 0.004);
      fingers.rotation.x = -0.15; // 指を少し曲げる
      const thumb = box(wrist, 0.022, 0.06, 0.022, skin, -side * 0.01, -0.06, 0.045);
      thumb.rotation.x = -0.3;
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }

    // ---- 首と頭 ----
    this.neck = joint(this.spine, 0, 0.49, 0);
    limb(this.neck, 0.046, 0.052, 0.1, skin, 0.09);
    this.head = joint(this.neck, 0, 0.07, 0);
    this.head.rotation.order = 'YXZ'; // 横を向いてから、上下にうなずく
    this.head.add(solid(headGeometry(), skin));
    // 髪：頭より少し大きい半球を後ろへ傾けて、生え際を上げ、後ろ髪を下げる
    const hairCap = solid(new THREE.SphereGeometry(0.123, 12, 6, 0, Math.PI * 2, 0, 1.55), hair);
    hairCap.scale.set(1.02, 1.15, 1.1);
    hairCap.position.set(0, 0.112, -0.004);
    hairCap.rotation.x = -0.65;
    this.head.add(hairCap);
    // 耳
    for (const side of [-1, 1]) {
      const ear = solid(new THREE.SphereGeometry(0.028, 6, 5), skin);
      ear.scale.set(0.38, 1, 0.62);
      ear.position.set(side * 0.112, 0.105, -0.005);
      this.head.add(ear);
    }
    // 目：白目と瞳。まばたきは目を縦につぶす。瞳は顔より先に見たい方へ動く
    for (const side of [-1, 1]) {
      const eye = joint(this.head, side * 0.04, 0.125, 0.107);
      box(eye, 0.028, 0.016, 0.01, shade(PALETTE.sand, 1.12), 0, 0, 0);
      this.pupils.push(box(eye, 0.012, 0.014, 0.006, shade(PALETTE.bark, 0.45), 0, 0, 0.004));
      this.eyes.push(eye);
      const brow = box(this.head, 0.036, 0.008, 0.012, hair, side * 0.042, 0.148, 0.108);
      brow.rotation.z = side * -0.12;
    }
    const nose = box(this.head, 0.022, 0.045, 0.03, shade(skin, 0.95), 0, 0.098, 0.121);
    nose.rotation.x = -0.25;
    box(this.head, 0.045, 0.01, 0.01, shade(skin, 0.55), 0, 0.058, 0.105); // 口
    // 麦わら帽子（少しあみだにかぶる）
    if (look.brim > 0) {
      const hat = joint(this.head, 0, 0.18, -0.008);
      hat.rotation.x = -0.1;
      const brim = solid(new THREE.CylinderGeometry(look.brim - 0.005, look.brim + 0.005, 0.012, 16), straw);
      hat.add(brim);
      const crown = solid(new THREE.CylinderGeometry(0.105, 0.125, 0.1, 14), straw);
      crown.position.y = 0.05;
      hat.add(crown);
      const band = solid(new THREE.CylinderGeometry(0.127, 0.128, 0.025, 14), shade(PALETTE.bark, 0.9));
      band.position.y = 0.017;
      hat.add(band);
    }
    // 丸めがね：目の前に細い輪を2つ、真ん中をつなぐ橋と、耳へ渡るつる
    if (look.glasses) {
      const rim = shade(PALETTE.bark, 0.6);
      for (const side of [-1, 1]) {
        const lens = solid(new THREE.TorusGeometry(0.026, 0.004, 4, 12), rim);
        lens.position.set(side * 0.04, 0.125, 0.122);
        this.head.add(lens);
        box(this.head, 0.004, 0.004, 0.11, rim, side * 0.068, 0.128, 0.068); // つる
      }
      box(this.head, 0.03, 0.004, 0.004, rim, 0, 0.13, 0.124); // 橋
    }

    this.collider = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2, 8));
    this.collider.position.y = 1;
    this.collider.visible = false;
    this.object.add(this.collider);
    this.object.updateMatrixWorld(true);
  }

  /** 視線の先に、reach より近くでこの住人が見えていれば true（blockers に当たり判定の collider も入れておく） */
  aimed(camera: THREE.Camera, blockers: THREE.Object3D[], reach: number): boolean {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    this.raycaster.far = reach;
    // 先に住人だけを調べ、当たらなければ地形などを含めた重い判定を省く（毎フレーム呼ばれるので）
    if (this.raycaster.intersectObject(this.collider, false).length === 0) return false;
    return this.raycaster.intersectObjects(blockers, true)[0]?.object === this.collider;
  }

  /** viewer はプレイヤーの目の位置 */
  update(dt: number, viewer: THREE.Vector3): void {
    this.time += dt;

    // ---- プレイヤーとの位置関係（体の向きから見た角度） ----
    const local = this.object.worldToLocal(viewer.clone());
    const dist = Math.hypot(local.x, local.z);
    const angle = Math.atan2(local.x, local.z);
    const near = dist < LOOK_DISTANCE;

    // ---- 体ごと向き直る：横や後ろにしばらくいられたら、足踏みしながらそちらを向く。離れたら元の向きへ戻る ----
    this.uneasy = near && Math.abs(angle) > TURN_START ? this.uneasy + dt : 0;
    this.away = near ? 0 : this.away + dt;
    if (near) {
      if (this.turnTo !== null || this.uneasy > TURN_DELAY) this.turnTo = Math.abs(angle) < 0.1 ? null : this.object.rotation.y + angle;
    } else if (this.turnTo === null && this.away > RETURN_DELAY && Math.abs(wrap(this.homeYaw - this.object.rotation.y)) > 0.1) {
      this.turnTo = this.homeYaw;
    }
    if (this.turnTo !== null) {
      const diff = wrap(this.turnTo - this.object.rotation.y);
      this.object.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * dt);
      this.stepPhase += dt * STEP_RATE;
      if (Math.abs(diff) < 0.02) this.turnTo = null;
    }
    const stepping = this.turnTo !== null;
    this.lifts.forEach((lift, i) => {
      const target = stepping ? Math.max(0, Math.sin(this.stepPhase + i * Math.PI)) : 0;
      this.lifts[i] = THREE.MathUtils.damp(lift, target, 18, dt);
    });

    // ---- 体重の乗せかえ（足踏み中は両足に半分ずつ） ----
    this.weightTimer -= dt;
    if (this.weightTimer <= 0) {
      this.weightTarget = -Math.sign(this.weightTarget) * (0.7 + Math.random() * 0.3);
      this.weightTimer = THREE.MathUtils.lerp(WEIGHT_SHIFT[0], WEIGHT_SHIFT[1], Math.random());
    }
    this.weight = THREE.MathUtils.damp(this.weight, stepping ? 0 : this.weightTarget, WEIGHT_SPEED, dt);
    const w = this.weight;
    const breath = Math.sin(this.time * BREATH_SPEED);

    // 腰は体重を乗せた足のほうへ出て、そちら側が上がる。肩は逆に傾けて釣り合いをとる
    this.hips.position.set(w * 0.03, HIP_Y - Math.abs(w) * 0.008, 0);
    this.hips.rotation.z = w * 0.045;
    this.spine.rotation.z = -w * 0.06;
    // 呼吸で胸がふくらむ
    this.chest.scale.set(1 + breath * 0.01, 1 + breath * 0.005, 1 + breath * 0.03);

    // ---- 脚：足の裏が地面から動かないように、腰のずれと傾きを打ち消す。体重を乗せていない足は膝をゆるめる ----
    [-1, 1].forEach((side, i) => {
      const relaxed = THREE.MathUtils.clamp((1 - side * w) / 2, 0, 1);
      const lift = this.lifts[i];
      this.thighs[i].rotation.z = -this.hips.rotation.z - this.hips.position.x / LEG;
      this.thighs[i].rotation.x = -0.14 * relaxed - 0.4 * lift;
      this.knees[i].rotation.x = 0.28 * relaxed + 0.8 * lift;
      this.ankles[i].rotation.x = -0.14 * relaxed - 0.4 * lift;
    });

    // ---- 腕：体の傾きを打ち消してまっすぐ垂らし、呼吸に合わせてわずかに揺らす ----
    const tilt = this.hips.rotation.z + this.spine.rotation.z;
    [-1, 1].forEach((side, i) => {
      this.shoulders[i].position.y = 0.43 + breath * 0.004;
      this.shoulders[i].rotation.z = side * 0.1 - tilt;
      this.shoulders[i].rotation.x = Math.sin(this.time * BREATH_SPEED * 0.5 + i) * 0.03 + (stepping ? Math.sin(this.stepPhase + i * Math.PI) * 0.12 : 0);
      this.elbows[i].rotation.x = -0.22;
    });

    // ---- 視線：近くのプレイヤーを見る。いなければ、ときどき海や島のほうをよそ見する ----
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      const glancing = this.idleYaw === 0 && Math.random() < 0.7;
      this.idleYaw = glancing ? (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6) : 0;
      this.idlePitch = glancing ? (Math.random() - 0.4) * 0.3 : 0;
      this.idleTimer = glancing ? 2 + Math.random() * 3 : 4 + Math.random() * 6;
    }
    let yaw = this.idleYaw;
    let pitch = this.idlePitch;
    if (near) {
      yaw = THREE.MathUtils.clamp(angle, -LOOK_MAX, LOOK_MAX);
      pitch = THREE.MathUtils.clamp(-Math.atan2(local.y - HEAD_Y, dist), -0.5, 0.45);
    }
    // 目が先に動き、顔があとから追いつく
    const yawBefore = this.lookYaw;
    this.lookYaw = THREE.MathUtils.damp(this.lookYaw, yaw, LOOK_SPEED, dt);
    this.lookPitch = THREE.MathUtils.damp(this.lookPitch, pitch, LOOK_SPEED, dt);
    for (const pupil of this.pupils) {
      pupil.position.x = THREE.MathUtils.clamp((yaw - this.lookYaw) * 0.012, -0.007, 0.007);
      pupil.position.y = THREE.MathUtils.clamp(-(pitch - this.lookPitch) * 0.01, -0.003, 0.003);
    }
    // 首を振るのは、背骨・首・頭で分け合う
    this.spine.rotation.y = this.lookYaw * 0.2;
    this.neck.rotation.y = this.lookYaw * 0.3;
    this.head.rotation.y = this.lookYaw * 0.5;
    this.neck.rotation.x = this.lookPitch * 0.4;
    this.head.rotation.x = this.lookPitch * 0.6;
    this.head.rotation.z = w * 0.03 - tilt * 0.5;

    // ---- まばたき（大きく視線を動かしたときにもする） ----
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 || (Math.abs(this.lookYaw - yawBefore) > dt * 2.5 && this.blinkLeft <= -0.6)) {
      this.blinkLeft = BLINK_TIME;
      this.blinkTimer = 2 + Math.random() * 4;
    }
    this.blinkLeft -= dt;
    for (const eye of this.eyes) eye.scale.y = this.blinkLeft > 0 ? 0.12 : 1;
  }
}
