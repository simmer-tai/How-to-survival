import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { terrainHeight } from '../world/terrain.js';
import { WATER_LEVEL } from '../core/physics.js';
import { waveOffset } from '../core/waves.js';
import { BOBBER_R, buildBobberModel, buildFishModel } from '../items/itemModels.js';
import { FISH_KINDS, pickFish, type FishId } from '../items/fishKinds.js';
import { itemIcon } from '../items/itemIcons.js';
import type { ItemId } from '../items/inventory.js';
import type { FishingRodRig, ToolHand } from '../player/hand.js';
import type { Vec3 } from '../player/handModel.js';
import { showToast } from '../ui/title.js';

// 釣り：釣り竿を持って右クリックを押している間ゲージが溜まり、離すと溜めた分だけ遠くへウキを投げる。
// 左クリックを押している間は糸を巻き取る。水に浮いたウキに魚がかかったら、巻き上げて岸まで寄せると釣れる。
// 釣りはワールドを変えない自分だけの行動（釣れた魚は自分のインベントリに入るだけ）なので、ワールドコマンドにはせず、
// 魚がかかるまでの時間なども各自のブラウザで決める。マルチでは、ほかの人に見せるウキと糸の位置だけを送る

const CHARGE_TIME = 1.2; // ゲージが満タンになるまでの時間（秒）
const MIN_CAST_SPEED = 5; // ゲージが空のときに投げる速さ（m/秒）。約2〜3m先に落ちる
const MAX_CAST_SPEED = 16; // ゲージが満タンのときに投げる速さ。約20m先に落ちる
const CAST_LIFT = 0.45; // 視線より上へ投げ上げる分（大きいほど山なり）
const BOBBER_GRAVITY = 14; // 飛んでいるウキにかかる重力
const MAX_FLIGHT_TIME = 5; // これだけ飛んでも落ちなければ、その場に落ちたことにする
const MIN_DEPTH = 0.6; // この深さより浅い所では魚がかからない
const BITE_MIN = 3; // 水に落ちてから魚がかかるまでの最短時間（秒）
const BITE_MAX = 10; // 最長時間
const REEL_SPEED = 5; // 何もかかっていないときに巻き取る速さ（m/秒）
const HOOKED_REEL_SPEED = 2.4; // 魚がかかっているときに巻き上げる速さ
const FISH_PULL_SPEED = 1.1; // 巻いていないとき、魚がウキを沖へ引っぱる速さ
const RUN_PULL_SPEED = 1.8; // 魚が暴れて走っている間は、巻いていてもこれだけ引き戻される
const RUN_EVERY_MIN = 1.2; // 魚が走り出す間隔（秒）
const RUN_EVERY_MAX = 2.8;
const RUN_TIME_MIN = 0.5; // 魚が走り続ける時間（秒）
const RUN_TIME_MAX = 1.1;
const ESCAPE_TIME = 2.2; // かかった魚をこれだけ巻かずに放っておくと逃げられる（秒）
const CATCH_DIST = 2; // ウキが足元からこの距離まで寄ったら、釣り上げる・回収する
const MAX_LINE = 45; // 糸の長さ。ウキからこれ以上離れると、糸を巻き取ってしまう
const LINE_POINTS = 20; // 糸を描く点の数
// 竿のしなり（rad。竿先までの曲がりの合計）
const HOOK_BEND = 0.85; // 魚がかかっている間
const RUN_BEND = 0.45; // 魚が走っている間は、さらにこれだけ曲がる
const HOOK_SHAKE = 0.3; // 魚がかかっている間に、竿先が前後に震える大きさ
const HOOK_SWAY = 0.35; // 左右に振られる大きさ
const REEL_BEND = 0.15; // 何もかかっていないウキを巻き取っている間
const BEND_RATE = 10; // しなりが目標に近づく速さ
// 握りの構え（構えからの移動 [x,y,z] と回転 [x,y,z]）
const POSE_CHARGE: [Vec3, Vec3] = [[0.03, 0.09, 0.12], [0.75, 0, 0.05]]; // ゲージ満タンで振りかぶった構え
const POSE_FLICK: [Vec3, Vec3] = [[-0.02, -0.02, -0.12], [-0.7, 0, -0.03]]; // 投げた瞬間に前へ振り出す
const POSE_LINE_OUT: [Vec3, Vec3] = [[0, -0.03, -0.03], [-0.2, 0, 0]]; // 糸を出している間（竿先を下げる）
const POSE_HOOKED: [Vec3, Vec3] = [[0, -0.02, -0.06], [-0.4, 0, 0]]; // 魚に引かれている間
const FLICK_TIME = 0.14; // 前へ振り出している時間（秒）
const POSE_RATE = 14; // 構えが目標に近づく速さ
const BIG_POWER = 1.3; // 引く強さがこれ以上の魚は、かかったときに「大物だ！」と出す
const LEAP_TIME = 0.75; // 釣り上げた魚が水から跳ねて手元へ飛んでくる時間（秒）
const LEAP_HEIGHT = 2.2; // 跳ねる高さ（m）
const LEAP_MAX_SCALE = 2.4; // 飛んでくる魚の大きさの上限（手に持つモデルの何倍まで実寸に近づけるか）
const CARD_TIME = 2.6; // 釣れた魚のカードを出しておく時間（秒）
const SPLASH_GRAVITY = 14;
const splashGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);

/** idle=手元, charging=ゲージを溜めている, flying=ウキが飛んでいる, out=ウキが落ちている, hooked=魚がかかっている */
type State = 'idle' | 'charging' | 'flying' | 'out' | 'hooked';

interface Drop { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }
/** 釣り上げて手元へ飛んでくる魚（自分の画面にだけ出す演出） */
interface Leap { model: THREE.Group; from: THREE.Vector3; time: number }

export class Fisher {
  private state: State = 'idle';
  private charge = 0; // 0〜1
  private reeling = false;
  private readonly bobber = buildBobberModel();
  private readonly velocity = new THREE.Vector3();
  private flightTime = 0;
  private biteTimer = 0; // 魚がかかるまでの残り時間
  private escapeTimer = 0; // かかった魚を巻かずに放っている時間
  private running = false; // かかった魚が暴れて走っているか
  private runTimer = 0; // 走り出すまで・走り終わるまでの残り時間
  private flick = 0; // 前へ振り出している残り時間
  private splashTimer = 0;
  private time = 0;
  private bendForward = 0;
  private bendSide = 0;
  private readonly posePos = new THREE.Vector3();
  private readonly poseRot = new THREE.Vector3();
  private readonly line: THREE.Line;
  private readonly linePos: THREE.BufferAttribute;
  private readonly tipPos = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly drops: Drop[] = [];
  private kind: FishId = 'fish'; // かかっている魚
  private leap: Leap | null = null;
  private readonly card: HTMLElement;
  private cardTimer = 0;

  /** 魚を釣り上げたときに呼ばれる */
  onCatch: (item: ItemId, count: number) => void = () => {};

  constructor(
    private readonly world: THREE.Object3D,
    private readonly hand: ToolHand,
    private readonly rig: FishingRodRig,
    /** 飛んでいるウキが当たって止まる物（地形・岩・建てた部材など） */
    private readonly obstacles: THREE.Object3D[],
    /** 今が夜か（夜にだけ釣れる魚がいる） */
    private readonly isNight: () => boolean,
  ) {
    const geo = new THREE.BufferGeometry();
    this.linePos = new THREE.BufferAttribute(new Float32Array(LINE_POINTS * 3), 3);
    geo.setAttribute('position', this.linePos);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: PALETTE.bark }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    world.add(this.line);

    injectStyle();
    this.card = document.createElement('div');
    this.card.className = 'fish-card';
    document.body.append(this.card);
  }

  /** 右クリックを押した：ゲージを溜め始める */
  startCharge(): void {
    if (this.state !== 'idle') return;
    this.state = 'charging';
    this.charge = 0;
  }

  /** 右クリックを離した：溜めた分だけ遠くへ投げる */
  release(camera: THREE.Camera): void {
    if (this.state !== 'charging') return;
    this.rig.tip.getWorldPosition(this.bobber.position);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    dir.y += CAST_LIFT;
    this.velocity.copy(dir.normalize()).multiplyScalar(THREE.MathUtils.lerp(MIN_CAST_SPEED, MAX_CAST_SPEED, this.charge));
    this.bobber.rotation.set(0, 0, 0);
    this.world.add(this.bobber);
    this.state = 'flying';
    this.flightTime = 0;
    this.flick = FLICK_TIME;
  }

  /** 左クリックを押している間は巻き取る */
  setReeling(on: boolean): void {
    this.reeling = on;
  }

  /** ゲージを溜めている途中なら、投げずにやめる（一時停止したときなど） */
  stopCharge(): void {
    if (this.state === 'charging') this.state = 'idle';
  }

  /** 糸を引き上げて手元に戻す（釣り竿を持ち替えたときなど） */
  cancel(): void {
    this.state = 'idle';
    this.reeling = false;
    this.bobber.removeFromParent();
    this.line.visible = false;
  }

  /** ゲージを溜めているか、糸を出している */
  get busy(): boolean {
    return this.state !== 'idle';
  }

  /** 投げる力を溜めている間はその量（0〜1）。溜めていなければ null（クロスヘアの周りのチャージメーターに出す） */
  get chargeLevel(): number | null {
    return this.state === 'charging' ? this.charge : null;
  }

  /** 画面に出す操作の案内 */
  get hint(): string {
    switch (this.state) {
      case 'idle':
        return '[右長]：ためて投げる';
      case 'charging':
        return '[右]を離す：投げる';
      case 'hooked':
        return `${FISH_KINDS[this.kind].power >= BIG_POWER ? '大物だ！' : 'かかった！'} [左長]：巻き上げる`;
      case 'out':
        return this.depth() < MIN_DEPTH ? '[左長]：巻き取る（ここは浅くて魚がかからない）' : '[左長]：巻き取る';
      default:
        return '';
    }
  }

  /** active は釣り竿を手に持っているか（持っていなければ糸を引き上げる） */
  update(dt: number, camera: THREE.Camera, active: boolean): void {
    this.updateDrops(dt);
    this.updateLeap(dt, camera);
    this.cardTimer = Math.max(this.cardTimer - dt, 0);
    if (this.cardTimer <= 0) this.card.classList.remove('show');
    if (!active) {
      if (this.state !== 'idle') this.cancel();
      return;
    }
    this.time += dt;
    this.flick = Math.max(this.flick - dt, 0);
    this.rig.tip.getWorldPosition(this.tipPos);

    if (this.state === 'charging') this.charge = Math.min(this.charge + dt / CHARGE_TIME, 1);
    else if (this.state === 'flying') this.fly(dt);
    else if (this.state === 'out' || this.state === 'hooked') this.reel(dt, camera);
    if (this.state !== 'idle' && this.state !== 'charging' && this.tipPos.distanceTo(this.bobber.position) > MAX_LINE) this.cancel();

    this.animateRod(dt);
    this.drawLine();
  }

  // ---- ウキ ----

  /** 飛んでいるウキを進め、水面か地面・物に落ちたら止める */
  private fly(dt: number): void {
    this.flightTime += dt;
    this.velocity.y -= BOBBER_GRAVITY * dt;
    const from = this.bobber.position;
    const to = from.clone().addScaledVector(this.velocity, dt);
    const surface = WATER_LEVEL + waveOffset(to.x, to.z);
    if (to.y <= surface && terrainHeight(to.x, to.z) < surface - 0.05) {
      from.set(to.x, surface, to.z);
      this.land();
      this.splash(from, 10);
      return;
    }
    const step = to.clone().sub(from);
    this.raycaster.set(from, step.clone().normalize());
    this.raycaster.far = step.length();
    const hit = this.raycaster.intersectObjects(this.obstacles, true)[0];
    if (hit) {
      from.copy(hit.point).y += BOBBER_R;
      this.land();
    } else if (this.flightTime > MAX_FLIGHT_TIME) {
      this.land();
    } else {
      from.copy(to);
    }
  }

  private land(): void {
    this.state = 'out';
    this.biteTimer = THREE.MathUtils.lerp(BITE_MIN, BITE_MAX, Math.random());
  }

  /** ウキの下の水の深さ（陸なら負） */
  private depth(): number {
    const p = this.bobber.position;
    return WATER_LEVEL + waveOffset(p.x, p.z) - terrainHeight(p.x, p.z);
  }

  /** 落ちているウキを、巻き取って寄せる・魚に引かれる・浮かべる */
  private reel(dt: number, camera: THREE.Camera): void {
    const p = this.bobber.position;
    const toPlayer = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z);
    const dist = toPlayer.length();
    toPlayer.normalize();
    const hooked = this.state === 'hooked';

    // 寄せる速さ（負なら沖へ引かれる）
    let speed = 0;
    if (hooked) {
      this.runTimer -= dt;
      if (this.runTimer <= 0) {
        this.running = !this.running;
        this.runTimer = this.running
          ? THREE.MathUtils.lerp(RUN_TIME_MIN, RUN_TIME_MAX, Math.random())
          : THREE.MathUtils.lerp(RUN_EVERY_MIN, RUN_EVERY_MAX, Math.random());
      }
      // 強い魚ほど巻くのが重く、沖へ強く引っぱる
      const { power, patience } = FISH_KINDS[this.kind];
      speed = this.reeling ? HOOKED_REEL_SPEED / Math.sqrt(power) : -FISH_PULL_SPEED * power;
      if (this.running) speed -= RUN_PULL_SPEED * power;
      this.escapeTimer = this.reeling ? Math.max(this.escapeTimer - dt, 0) : this.escapeTimer + dt;
      if (this.escapeTimer >= ESCAPE_TIME * patience) {
        showToast('魚に逃げられた');
        this.state = 'out';
        this.land();
        return;
      }
    } else if (this.reeling) {
      speed = REEL_SPEED;
    }
    // 沖へ引かれるのは深い所だけ（浅瀬や陸へは引き戻されない）
    if (speed < 0 && this.depth() < MIN_DEPTH) speed = 0;
    p.addScaledVector(toPlayer, Math.min(speed * dt, dist));

    const depth = this.depth();
    const surface = WATER_LEVEL + waveOffset(p.x, p.z);
    if (depth > 0.05) {
      // 浮かぶ。魚がかかっていれば沈められて、左右に暴れる
      if (hooked) {
        const thrash = (this.running ? 2 : 1) * Math.min(FISH_KINDS[this.kind].power, 1.5);
        p.y = surface - 0.12 + Math.sin(this.time * 21) * 0.04 * thrash;
        this.bobber.rotation.set(Math.sin(this.time * 17) * 0.5 * thrash, 0, Math.sin(this.time * 13) * 0.5 * thrash);
        this.splashTimer -= dt;
        if (this.splashTimer <= 0) {
          this.splash(p, this.running ? 5 : 2);
          this.splashTimer = this.running ? 0.12 : 0.3;
        }
      } else {
        p.y = surface + Math.sin(this.time * 2.2) * 0.02;
        this.bobber.rotation.set(Math.sin(this.time * 1.7) * 0.1, 0, Math.sin(this.time * 1.3) * 0.1);
      }
    } else {
      // 陸の上を引きずる（引いていなければ、落ちた所（床の上など）にそのまま置いておく）
      const ground = terrainHeight(p.x, p.z) + BOBBER_R;
      p.y = speed > 0 ? Math.max(p.y - 6 * dt, ground) : Math.max(p.y, ground);
      this.bobber.rotation.set(0, 0, 0);
    }

    // 魚がかかったまま陸へ引き上げるか足元まで寄せたら釣れる。何もかかっていなければ手元に戻る
    if (hooked && (depth <= 0.05 || dist < CATCH_DIST)) {
      this.splash(p, 8);
      this.landCatch(p, camera);
      return;
    }
    if (!hooked && this.reeling && dist < CATCH_DIST) {
      this.cancel();
      return;
    }

    // 深い所に浮かべておくと、そのうち魚がかかる（巻いている間はかからない）
    if (!hooked && !this.reeling && depth >= MIN_DEPTH) {
      this.biteTimer -= dt;
      if (this.biteTimer <= 0) {
        this.state = 'hooked';
        this.kind = pickFish(depth, this.isNight());
        this.escapeTimer = 0;
        this.running = true; // かかった瞬間に走り出す
        this.runTimer = THREE.MathUtils.lerp(RUN_TIME_MIN, RUN_TIME_MAX, Math.random());
        this.splashTimer = 0;
        this.splash(p, 10);
      }
    }
  }

  // ---- 竿と糸 ----

  /** 構えとしなりを、今の状態に合わせて動かす */
  private animateRod(dt: number): void {
    const hooked = this.state === 'hooked';
    const running = hooked && this.running;
    // 構え
    let [pos, rot] =
      this.flick > 0 ? POSE_FLICK : hooked ? POSE_HOOKED : this.state === 'idle' ? [[0, 0, 0] as Vec3, [0, 0, 0] as Vec3] : POSE_LINE_OUT;
    if (this.state === 'charging') {
      pos = POSE_CHARGE[0].map((v) => v * this.charge) as Vec3;
      rot = POSE_CHARGE[1].map((v) => v * this.charge) as Vec3;
    }
    const k = 1 - Math.exp(-POSE_RATE * dt);
    this.posePos.lerp(new THREE.Vector3(...pos), k);
    this.poseRot.lerp(new THREE.Vector3(...rot), k);
    const shake = new THREE.Vector3();
    if (hooked) {
      const s = running ? 2 : 1;
      shake.set(Math.sin(this.time * 19) * 0.008 * s, Math.sin(this.time * 27) * 0.01 * s, 0);
    } else if (this.state === 'charging' && this.charge >= 1) {
      shake.set(0, Math.sin(this.time * 40) * 0.003, 0); // 満タンで力んで震える
    }
    this.hand.pose(this.posePos.clone().add(shake).toArray(), this.poseRot.toArray());

    // しなり：魚がかかっている間は大きく曲がって激しく震える
    let forward = 0;
    let side = 0;
    if (hooked) {
      forward = HOOK_BEND + (running ? RUN_BEND : 0) + (this.reeling ? 0.15 : 0);
      side = Math.sin(this.time * 2.3) * HOOK_SWAY;
    } else if (this.state === 'out' && this.reeling) {
      forward = REEL_BEND;
    } else if (this.state === 'charging') {
      forward = -0.12 * this.charge; // 振りかぶると竿先が後ろへ残る
    }
    const b = 1 - Math.exp(-BEND_RATE * dt);
    this.bendForward += (forward - this.bendForward) * b;
    this.bendSide += (side - this.bendSide) * b;
    let shakeF = 0;
    let shakeS = 0;
    if (hooked) {
      const s = running ? 1.6 : 1;
      shakeF = (Math.sin(this.time * 23) * 0.6 + Math.sin(this.time * 37) * 0.4) * HOOK_SHAKE * s;
      shakeS = (Math.sin(this.time * 13) * 0.6 + Math.sin(this.time * 31) * 0.4) * HOOK_SHAKE * 0.6 * s;
    }
    this.rig.bend(this.bendForward + shakeF, this.bendSide + shakeS);
    this.rig.tip.getWorldPosition(this.tipPos); // しならせたあとの竿先から糸を出す
    this.rig.hanging.visible = this.state === 'idle' || this.state === 'charging';
  }

  /** 竿先からウキまで糸を張る。たるんでいるほど下へ垂れる */
  private drawLine(): void {
    const out = this.state === 'flying' || this.state === 'out' || this.state === 'hooked';
    this.line.visible = out;
    if (!out) return;
    const a = this.tipPos;
    const b = this.bobber.position;
    const taut = this.state === 'hooked' || this.reeling;
    const sag = this.state === 'flying' ? 0.1 : taut ? 0.02 : Math.min(a.distanceTo(b) * 0.06, 1.5);
    const p = new THREE.Vector3();
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1);
      p.lerpVectors(a, b, t);
      p.y -= sag * 4 * t * (1 - t);
      this.linePos.setXYZ(i, p.x, p.y, p.z);
    }
    this.linePos.needsUpdate = true;
  }

  // ---- 釣り上げる ----

  /** かかっていた魚を釣り上げる：インベントリに入れ、水から跳ねて手元へ飛んでくる魚と、名前と大きさのカードを出す */
  private landCatch(from: THREE.Vector3, camera: THREE.Camera): void {
    const id = this.kind;
    const k = FISH_KINDS[id];
    this.cancel();
    this.onCatch(id, 1);
    const cm = Math.round(THREE.MathUtils.lerp(k.sizeCm[0], k.sizeCm[1], Math.pow(Math.random(), 1.6))); // 大きいのはたまにしか釣れない

    this.leap?.model.removeFromParent();
    const model = buildFishModel(id);
    model.scale.setScalar(THREE.MathUtils.clamp(cm / 100 / k.length, 0.6, LEAP_MAX_SCALE));
    this.world.add(model);
    this.leap = { model, from: from.clone(), time: 0 };
    this.updateLeap(0, camera);

    this.card.innerHTML = '';
    const icon = document.createElement('img');
    icon.src = itemIcon(id);
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'fish-card-title';
    title.textContent = `${k.name}が釣れた！`;
    const info = document.createElement('div');
    info.className = 'fish-card-info';
    const stars = document.createElement('span');
    stars.className = 'fish-card-stars';
    stars.textContent = '★'.repeat(k.rarity) + '☆'.repeat(3 - k.rarity);
    info.append(stars, ` ${cm} cm`);
    text.append(title, info);
    this.card.append(icon, text);
    this.card.classList.remove('show');
    void this.card.offsetWidth; // 続けて釣れたときも、もう一度ポンと出す
    this.cardTimer = CARD_TIME;
    this.card.classList.add('show');
  }

  /** 跳ねた魚を、水面から放物線を描いて目の前まで飛ばし、体をくねらせる */
  private updateLeap(dt: number, camera: THREE.Camera): void {
    const leap = this.leap;
    if (!leap) return;
    leap.time += dt;
    const t = leap.time / LEAP_TIME;
    if (t >= 1) {
      leap.model.removeFromParent();
      this.leap = null;
      return;
    }
    const to = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1.1));
    to.y -= 0.25;
    const m = leap.model;
    m.position.lerpVectors(leap.from, to, THREE.MathUtils.smoothstep(t, 0, 1));
    m.position.y += Math.sin(t * Math.PI) * LEAP_HEIGHT;
    // 体を横に向けて、頭を上げ下げしながら尾を振る
    const yaw = Math.atan2(to.x - leap.from.x, to.z - leap.from.z) + Math.PI / 2;
    m.rotation.set(Math.sin(leap.time * 30) * 0.35, yaw + Math.sin(leap.time * 22) * 0.4, (0.5 - t) * 1.6);
  }

  // ---- 水しぶき（自分の画面にだけ出す演出） ----

  private splash(point: THREE.Vector3, count: number): void {
    for (let n = 0; n < count; n++) {
      const mesh = new THREE.Mesh(splashGeo, flat(PALETTE.water));
      mesh.position.copy(point);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.8;
      const velocity = new THREE.Vector3(Math.cos(a) * r, 2 + Math.random() * 1.5, Math.sin(a) * r);
      this.world.add(mesh);
      this.drops.push({ mesh, velocity, life: 0.45 + Math.random() * 0.2 });
    }
  }

  private updateDrops(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        this.drops.splice(i, 1);
        continue;
      }
      d.velocity.y -= SPLASH_GRAVITY * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
    }
  }
}

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .fish-card {
      position: fixed; left: 50%; top: calc(90 * var(--u)); transform: translateX(-50%) scale(0.6);
      display: flex; align-items: center; gap: calc(12 * var(--u));
      padding: calc(10 * var(--u)) calc(22 * var(--u)) calc(10 * var(--u)) calc(12 * var(--u));
      border-radius: calc(18 * var(--u)); background: ${css(PALETTE.sand)}; color: #2b2633;
      border: calc(3 * var(--u)) solid #2b2633; box-shadow: 0 calc(5 * var(--u)) 0 rgba(43, 38, 51, 0.35);
      opacity: 0; pointer-events: none; z-index: 5; transition: opacity 0.2s, transform 0.25s cubic-bezier(.3, 1.6, .5, 1);
    }
    .fish-card.show { opacity: 1; transform: translateX(-50%) scale(1); }
    .fish-card img {
      width: calc(64 * var(--u)); height: calc(64 * var(--u)); border-radius: calc(12 * var(--u));
      background: ${css(PALETTE.sky)};
    }
    .fish-card-title { font-size: calc(22 * var(--u)); font-weight: bold; }
    .fish-card-info { font-size: calc(17 * var(--u)); margin-top: calc(2 * var(--u)); }
    .fish-card-stars { color: ${css(PALETTE.accent)}; letter-spacing: calc(2 * var(--u)); }
  `;
  document.head.append(style);
}
