import * as THREE from 'three';

const WALK_REF = 6; // 揺れの大きさの基準にする歩く速さ（m/秒）
const STEP_SWAY_X = 0.012; // 歩くときの左右の揺れ（1歩ごとに左右へ）
const STEP_SWAY_Y = 0.009; // 歩くときの上下の揺れ（1歩ごとに上下へ。左右と合わせて8の字を描く）
const STEP_ROLL = 0.012; // 歩くときに手元が傾く量（ラジアン）
const STEP_FADE = 8; // 歩き出し・止まったときに揺れが大きく・小さくなる速さ
const LOOK_LAG = 0.6; // 視点を回したとき、手元が遅れてついてくる割合
const LOOK_LAG_MAX = 0.07; // 遅れの最大（ラジアン）
const LOOK_RETURN = 10; // 遅れが戻る速さ
const MOVE_TILT = 0.004; // 横へ動くと手元が傾く量（速さ1m/秒あたり、ラジアン）
const MOVE_PUSH = 0.0025; // 前後へ動くと手元が引かれる量（速さ1m/秒あたり、m）
const MOVE_SMOOTH = 6; // 移動による傾きの追従の速さ
const AIR_LIFT = 0.004; // 跳んでいる間、上下の速さ1m/秒あたり手元が逆へずれる量（m）
const AIR_LIFT_MAX = 0.035; // 跳んでいる間のずれの最大（m）
const LAND_KICK = 0.06; // 着地したとき、落ちる速さ1m/秒あたり手元を沈める勢い
const LAND_KICK_MAX = 0.9; // 着地で沈める勢いの最大
const SPRING = 110; // 上下のばねの強さ（跳ぶ・着地の動きを戻す）
const DAMPING = 13; // 上下のばねの減衰（小さいほど弾む）
const SWIM_SWAY = 0.012; // 泳いでいる間のゆったりした揺れ（m）

/** 体の動き（Player から受け取る） */
export interface SwayInput {
  velocity: THREE.Vector3; // 体の速さ（m/秒、ワールド座標）
  grounded: boolean; // 地面に立っているか
  swimming: boolean;
  stepPhase: number; // 歩く足取りの位相（頭の上下の揺れと合わせる）
}

/**
 * 一人称の手元を、歩く・走る・跳ぶ・着地する・視点を回すのに合わせてなめらかに揺らす。
 * 手や道具はカメラでなく root の子にする。自分の画面だけの演出
 */
export class HandSway {
  readonly root = new THREE.Group();
  private amount = 0; // 歩く揺れの大きさ（0〜）
  private lagYaw = 0;
  private lagPitch = 0;
  private lastYaw: number | null = null;
  private lastPitch = 0;
  private tilt = 0; // 横へ動いたときの傾き
  private push = 0; // 前後へ動いたときの手元のずれ
  private lift = 0; // 跳ぶ・着地の上下のずれ（ばね）
  private liftVel = 0;
  private airVy = 0; // 直前まで空中にいたときの上下の速さ
  private wasGrounded = true;
  private time = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly local = new THREE.Vector3();

  constructor(private readonly camera: THREE.Camera) {
    camera.add(this.root);
  }

  update(dt: number, input: SwayInput): void {
    if (dt <= 0) return;
    this.time += dt;
    const { velocity, grounded, swimming } = input;

    // 視点を回すと、手元は少し遅れてついてくる
    this.euler.setFromQuaternion(this.camera.quaternion);
    const yaw = this.euler.y;
    const pitch = this.euler.x;
    if (this.lastYaw !== null) {
      const dYaw = Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw));
      const dPitch = pitch - this.lastPitch;
      this.lagYaw = THREE.MathUtils.clamp(this.lagYaw - dYaw * LOOK_LAG, -LOOK_LAG_MAX, LOOK_LAG_MAX);
      this.lagPitch = THREE.MathUtils.clamp(this.lagPitch - dPitch * LOOK_LAG, -LOOK_LAG_MAX, LOOK_LAG_MAX);
    }
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.lagYaw = THREE.MathUtils.damp(this.lagYaw, 0, LOOK_RETURN, dt);
    this.lagPitch = THREE.MathUtils.damp(this.lagPitch, 0, LOOK_RETURN, dt);

    // 移動の向きをカメラの向き（水平だけ）で見る：横へ動くと傾き、前へ進むと手元が少し引かれる
    this.local.copy(velocity).setY(0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    const side = THREE.MathUtils.clamp(this.local.x, -12, 12); // 右が +
    const forward = THREE.MathUtils.clamp(-this.local.z, -12, 12);
    this.tilt = THREE.MathUtils.damp(this.tilt, -side * MOVE_TILT, MOVE_SMOOTH, dt);
    this.push = THREE.MathUtils.damp(this.push, forward * MOVE_PUSH, MOVE_SMOOTH, dt);

    // 歩く揺れは、地面の上で動いている間だけ。速く動くほど大きい
    const speed = Math.hypot(velocity.x, velocity.z);
    const target = grounded && speed > 0.5 ? Math.min(speed / WALK_REF, 1.5) : 0;
    this.amount = THREE.MathUtils.damp(this.amount, target, STEP_FADE, dt);

    // 跳んでいる間は上下の速さと逆へずらし、着地で沈ませる（どちらもばねでなめらかに戻す）
    let liftTarget = 0;
    if (!grounded && !swimming) {
      this.airVy = velocity.y;
      liftTarget = THREE.MathUtils.clamp(-velocity.y * AIR_LIFT, -AIR_LIFT_MAX, AIR_LIFT_MAX);
    } else if (!this.wasGrounded && grounded && this.airVy < -1) {
      this.liftVel -= Math.min(-this.airVy * LAND_KICK, LAND_KICK_MAX);
    }
    if (grounded || swimming) this.airVy = 0;
    this.wasGrounded = grounded || swimming;
    this.liftVel += ((liftTarget - this.lift) * SPRING - this.liftVel * DAMPING) * dt;
    this.lift += this.liftVel * dt;

    // 足取りに合わせて8の字に揺らす（頭が下がるときに手元も遅れて下がる）
    const phase = input.stepPhase;
    const a = this.amount;
    let x = Math.sin(phase) * STEP_SWAY_X * a;
    let y = -Math.abs(Math.sin(phase)) * STEP_SWAY_Y * a * 2 + STEP_SWAY_Y * a;
    if (swimming) {
      x += Math.sin(this.time * 1.3) * SWIM_SWAY * 0.6;
      y += Math.sin(this.time * 2.1) * SWIM_SWAY;
    }

    this.root.position.set(x, y + this.lift, this.push);
    this.root.rotation.set(this.lagPitch, this.lagYaw, this.tilt + Math.sin(phase) * STEP_ROLL * a);
  }
}
