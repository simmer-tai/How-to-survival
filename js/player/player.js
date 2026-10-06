import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { WORLD_SIZE, terrainHeight } from '../world/terrain.js';
import { RAPIER, COLLIDE, WATER_LEVEL } from '../core/physics.js';
import { waveOffset } from '../core/waves.js';
const EYE_HEIGHT = 1.7;
const BODY_RADIUS = 0.4;
const BODY_HALF = 0.5; // カプセルの円柱部分の半分（全高 = 2 × (0.5 + 0.4) = 1.8）
const BODY_CENTER = BODY_HALF + BODY_RADIUS; // 足元からカプセル中心まで
const CROUCH_HALF = 0.15; // しゃがんだときの円柱部分の半分（全高 = 2 × (0.15 + 0.4) = 1.1）
const CROUCH_DROP = 0.65; // しゃがんだときに目線が下がる量（目の高さ 1.05）
const CROUCH_SPEED = 2.8;
const MASS = 60; // 木材や丸太を押すときの重さ
const WALK_SPEED = 6;
const RUN_SPEED = 11;
const JUMP_SPEED = 8.5;
const GRAVITY = 26;
const SWIM_DEPTH = 1.25; // 足元がこれより深く水に浸かると泳ぎになる
const SWIM_SPEED = 3.2;
const SWIM_FAST = 5.5;
const FLOAT_EYE = 0.35; // 水面に浮いているときの、水面からの目の高さ（頭だけ出る）
const CLIMB_REACH = 2.6; // 水面から手が届く段差の高さ（足元から）
const SNAP = 0.5;
const EYE_SMOOTH = 14; // 地面を歩くときの視点の高さの追従の速さ。地面の面の継ぎ目で視点がカクつかないようにする
const EYE_LAG_MAX = 0.3; // 視点の高さが体から遅れてよい最大の量
const SLIDE_ANGLE = 75; // これ以上急な斜面には立っていられず滑り落ちる（度）
const SLIDE_COS = Math.cos(THREE.MathUtils.degToRad(SLIDE_ANGLE));
const UP = new THREE.Vector3(0, 1, 0);
export class Player {
    physics;
    platforms;
    controls;
    camera;
    position = new THREE.Vector3();
    velocity = new THREE.Vector3();
    keys = new Set();
    onGround = false;
    swimming = false;
    crouched = false;
    /** 目線の下がり具合（0 = 立ち、1 = しゃがみ）。なめらかに追従させる */
    crouchAmount = 0;
    bobPhase = 0;
    /** なめらかに追従させた目の高さ */
    smoothEye = 0;
    /** いまいる場所の水面の高さ（波で上下する） */
    surface = WATER_LEVEL;
    /** 船に座っているか（座っている間は自分では動かず、目の位置は船が決める） */
    seated = false;
    body;
    collider;
    mover;
    constructor(camera, dom, physics, platforms, spawn) {
        this.physics = physics;
        this.platforms = platforms;
        this.camera = camera;
        this.controls = new PointerLockControls(camera, dom);
        this.position.copy(spawn).y += EYE_HEIGHT;
        this.smoothEye = this.position.y;
        // 当たり判定は Rapier のキャラクターコントローラーに任せる
        const { world } = physics;
        this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + BODY_CENTER, spawn.z));
        this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(BODY_HALF, BODY_RADIUS).setCollisionGroups(COLLIDE.player), this.body);
        this.mover = world.createCharacterController(0.02);
        this.mover.enableAutostep(0.45, 0.2, true);
        this.mover.enableSnapToGround(SNAP);
        this.mover.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50));
        this.mover.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(SLIDE_ANGLE));
        this.mover.setApplyImpulsesToDynamicBodies(true);
        this.mover.setCharacterMass(MASS);
        camera.position.copy(this.position);
        camera.lookAt(0, this.position.y + 2, 0);
        // ブラウザ（特に Windows の Chrome）はポインタロック中、たまに実際の操作と無関係な巨大な
        // movementX/Y を送ってきて視点が瞬間移動する。PointerLockControls より先に受け取って捨てる
        let lockedAt = 0;
        let lastMove = 0;
        this.controls.addEventListener('lock', () => {
            lockedAt = performance.now();
            lastMove = 0;
        });
        addEventListener('mousemove', (e) => {
            if (document.pointerLockElement !== dom)
                return;
            const move = Math.hypot(e.movementX, e.movementY);
            // ロック直後のイベントや、直前の動きから飛び抜けて大きい値はスパイクとみなす
            const spike = performance.now() - lockedAt < 100 || (move > 150 && move > lastMove * 6 + 40);
            if (spike) {
                e.stopImmediatePropagation();
                return;
            }
            lastMove = move;
        }, { capture: true });
        addEventListener('keydown', (e) => {
            this.keys.add(e.code);
            if (e.code === 'Space')
                e.preventDefault();
            // プレイ中は Ctrl・Shift と組み合わせたブラウザのショートカットを止める
            if ((e.ctrlKey || e.shiftKey) && this.controls.isLocked)
                e.preventDefault();
        });
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
    }
    /** 水平に yaw の向きを見る（rad。three.js のカメラと同じく 0 で -Z を向く） */
    face(yaw) {
        this.camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    }
    /** プレイヤーの体の剛体（別の場所へ移るときに、止めずに残す） */
    get rigidBody() {
        return this.body;
    }
    /** 地面を歩いて（走って）いるか */
    get walking() {
        return this.onGround && !this.swimming && Math.hypot(this.velocity.x, this.velocity.z) > 0.5;
    }
    /** しゃがんでいるか */
    get isCrouching() {
        return this.crouched;
    }
    /** 泳いでいるか */
    get isSwimming() {
        return this.swimming;
    }
    /** 体の様子を out に入れて返す（自分のアバターを動かすのに使う。マルチでは、他の人に見せる分としてこれを送る） */
    pose(out) {
        const look = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        // 足元の高さは、地面の凹凸をならした目の高さから決める（体ががたつかないように）
        out.p.set(this.position.x, this.smoothEye - EYE_HEIGHT, this.position.z);
        out.yaw = look.y;
        out.pitch = look.x;
        out.speed = this.seated ? 0 : Math.hypot(this.velocity.x, this.velocity.z);
        out.state = this.seated ? 'sit' : this.swimming ? 'swim' : this.onGround ? 'ground' : 'air';
        out.crouch = this.crouchAmount;
        delete out.bodyYaw;
        return out;
    }
    serialize() {
        const look = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        return { p: [this.position.x, this.position.y - EYE_HEIGHT, this.position.z], yaw: look.y, pitch: look.x };
    }
    restore(save) {
        this.seated = false;
        const [x, y, z] = save.p;
        this.position.set(x, y + EYE_HEIGHT, z);
        this.smoothEye = this.position.y;
        this.velocity.set(0, 0, 0);
        this.body.setTranslation({ x, y: y + this.bodyCenter, z }, true);
        this.camera.position.copy(this.position);
        this.camera.quaternion.setFromEuler(new THREE.Euler(save.pitch, save.yaw, 0, 'YXZ'));
    }
    groundAt(x, z) {
        let y = terrainHeight(x, z);
        for (const p of this.platforms) {
            if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ)
                y = Math.max(y, p.top);
        }
        return y;
    }
    /** 船に座る。eye は目の位置（毎フレーム、船の揺れに合わせて渡す） */
    sitAt(eye) {
        if (!this.seated) {
            this.seated = true;
            this.velocity.set(0, 0, 0);
            this.swimming = false;
            if (this.crouched)
                this.setCrouched(false);
        }
        this.position.copy(eye);
        this.smoothEye = eye.y;
        this.camera.position.copy(eye);
        this.body.setNextKinematicTranslation({ x: eye.x, y: eye.y - EYE_HEIGHT + this.bodyCenter, z: eye.z });
    }
    /** 船に座るのをやめて、その場に立つ（乗る頼みをホストに断られたときなど） */
    stand() {
        if (!this.seated)
            return;
        this.standAt(new THREE.Vector3(this.position.x, this.position.y - EYE_HEIGHT, this.position.z));
    }
    /** 足元を feet に置いたとき、体が何にもぶつからないか（船から降りる場所を探すのに使う） */
    canStandAt(feet) {
        const hit = this.physics.world.intersectionWithShape({ x: feet.x, y: feet.y + BODY_CENTER, z: feet.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(BODY_HALF, BODY_RADIUS), RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLIDE.player, this.collider);
        return hit === null && this.inBounds(feet.x, feet.z);
    }
    /** 船から降りて、足元を feet に置く */
    standAt(feet) {
        this.seated = false;
        this.position.set(feet.x, feet.y + EYE_HEIGHT, feet.z);
        this.smoothEye = this.position.y;
        this.velocity.set(0, 0, 0);
        this.onGround = false;
        this.body.setTranslation({ x: feet.x, y: feet.y + this.bodyCenter, z: feet.z }, true);
        this.camera.position.copy(this.position);
    }
    update(dt) {
        if (this.seated)
            return; // 船に座っている間は、船が目の位置を動かす
        // インベントリを開いている間も重力などは働かせ、操作入力だけ止める
        const input = this.controls.isLocked;
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
        const wantCrouch = input && this.keys.has('KeyC');
        const running = input && !this.crouched && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
        const feet = this.position.y - EYE_HEIGHT;
        this.surface = WATER_LEVEL + waveOffset(this.position.x, this.position.z);
        const submerged = this.surface - feet;
        const wasSwimming = this.swimming;
        // 浅瀬に足が着いている間は歩き、それより深いと泳ぐ
        this.swimming = submerged > SWIM_DEPTH && !(this.onGround && submerged < SWIM_DEPTH + 0.15);
        if (this.swimming !== wasSwimming) {
            if (this.swimming)
                this.mover.disableSnapToGround(); // 海底に吸い付かないように
            else
                this.mover.enableSnapToGround(SNAP);
        }
        if (this.swimming)
            this.swim(dt, input, running);
        else
            this.walk(dt, input, running, forward, right, submerged > 0);
        // 世界の端には進めないようにする
        const desired = this.velocity.clone().multiplyScalar(dt);
        if (!this.inBounds(this.position.x + desired.x, this.position.z)) {
            desired.x = 0;
            this.velocity.x = 0;
        }
        if (!this.inBounds(this.position.x, this.position.z + desired.z)) {
            desired.z = 0;
            this.velocity.z = 0;
        }
        // 立っている間は下へ押さず、地面への吸い付きは snapToGround に任せる。
        // 下へ押すと、平らな箱（床など）の上で引っかかって横の動きまで止まる
        if (this.onGround && !this.swimming && desired.y < 0)
            desired.y = 0;
        const wasGrounded = this.onGround;
        this.mover.computeColliderMovement(this.collider, desired, undefined, COLLIDE.player);
        const m = this.mover.computedMovement();
        const moved = new THREE.Vector3(m.x, m.y, m.z);
        // 急斜面にしか触れていなければ立っていられず、斜面に沿って滑り落ちる
        const support = this.swimming ? null : this.supportNormal();
        const sliding = support !== null && support.y < SLIDE_COS;
        this.onGround = this.mover.computedGrounded() && !sliding;
        // 立っていられる斜面では、重力が斜面に沿って流されて横へずれる分を捨てる。
        // 水平に動く量を入力した分までに抑え、高さも同じ割合で縮める（止まっていれば動かない）
        if (wasGrounded && this.onGround && this.velocity.y <= 0) {
            const want = Math.hypot(desired.x, desired.z);
            const got = Math.hypot(moved.x, moved.z);
            if (got > want)
                moved.multiplyScalar(got > 1e-6 ? want / got : 0);
        }
        if (this.onGround && this.velocity.y < 0)
            this.velocity.y = 0;
        if (this.velocity.y > 0 && moved.y < desired.y * 0.5)
            this.velocity.y = 0; // 頭をぶつけた
        // 障害物に当たって止められた分だけ水平速度も落とす
        if (dt > 0) {
            this.velocity.x = moved.x / dt;
            this.velocity.z = moved.z / dt;
        }
        if (sliding && dt > 0) {
            // 実際に滑った分を速度として持ち越し、斜面に食い込む成分は捨てる
            this.velocity.y = moved.y / dt;
            const into = this.velocity.dot(support);
            if (into < 0)
                this.velocity.addScaledVector(support, -into);
        }
        this.position.x += moved.x;
        this.position.y += moved.y;
        this.position.z += moved.z;
        // 体の大きさは移動を計算し終えてから変える（次の物理ステップで新しい位置に収まる）
        if (wantCrouch && !this.swimming && !this.crouched)
            this.setCrouched(true);
        else if ((!wantCrouch || this.swimming) && this.crouched && this.canStand())
            this.setCrouched(false);
        this.body.setNextKinematicTranslation({
            x: this.position.x,
            y: this.position.y - EYE_HEIGHT + this.bodyCenter,
            z: this.position.z,
        });
        this.crouchAmount = THREE.MathUtils.damp(this.crouchAmount, this.crouched ? 1 : 0, 12, dt);
        // 歩行時の頭の揺れ
        const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
        const stepping = this.onGround && !this.swimming;
        if (stepping && horizontal > 0.5)
            this.bobPhase += horizontal * dt * 1.4;
        const bob = stepping ? Math.sin(this.bobPhase * 2) * 0.05 * Math.min(horizontal / WALK_SPEED, 1.5) : 0;
        // 歩いている間は地面の凹凸による上下をならす。跳んだり泳いだりしている間はそのまま追う
        if (stepping) {
            this.smoothEye = THREE.MathUtils.damp(this.smoothEye, this.position.y, EYE_SMOOTH, dt);
            this.smoothEye = THREE.MathUtils.clamp(this.smoothEye, this.position.y - EYE_LAG_MAX, this.position.y + EYE_LAG_MAX);
        }
        else {
            this.smoothEye = this.position.y;
        }
        const eye = this.smoothEye - this.crouchAmount * CROUCH_DROP;
        this.camera.position.set(this.position.x, eye + bob, this.position.z);
    }
    /** 足元からカプセル中心までの高さ */
    get bodyCenter() {
        return (this.crouched ? CROUCH_HALF : BODY_HALF) + BODY_RADIUS;
    }
    setCrouched(crouched) {
        this.crouched = crouched;
        this.collider.setHalfHeight(crouched ? CROUCH_HALF : BODY_HALF);
    }
    /** 頭上に立ち上がれるだけの空きがあるか */
    canStand() {
        const feet = this.position.y - EYE_HEIGHT;
        const hit = this.physics.world.intersectionWithShape({ x: this.position.x, y: feet + BODY_CENTER + 0.02, z: this.position.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(BODY_HALF, BODY_RADIUS - 0.02), RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLIDE.player, this.collider);
        return hit === null;
    }
    walk(dt, input, running, forward, right, inWater) {
        const wish = new THREE.Vector3();
        if (input && this.keys.has('KeyW'))
            wish.add(forward);
        if (input && this.keys.has('KeyS'))
            wish.sub(forward);
        if (input && this.keys.has('KeyD'))
            wish.add(right);
        if (input && this.keys.has('KeyA'))
            wish.sub(right);
        if (wish.lengthSq() > 0)
            wish.normalize();
        let speed = this.crouched ? CROUCH_SPEED : running ? RUN_SPEED : WALK_SPEED;
        if (inWater)
            speed *= 0.55;
        const accel = this.onGround ? 12 : 3;
        this.velocity.x = THREE.MathUtils.damp(this.velocity.x, wish.x * speed, accel, dt);
        this.velocity.z = THREE.MathUtils.damp(this.velocity.z, wish.z * speed, accel, dt);
        if (input && this.onGround && !this.crouched && this.keys.has('Space')) {
            this.velocity.y = JUMP_SPEED;
            this.onGround = false;
        }
        this.velocity.y -= GRAVITY * dt;
    }
    /** 視線の方向へ泳ぐ（下を向いて W で潜る）。Space で浮上、C で潜行、何もしなければ水面へ浮かぶ */
    swim(dt, input, running) {
        const look = new THREE.Vector3();
        this.camera.getWorldDirection(look);
        const right = new THREE.Vector3().crossVectors(look, UP).normalize();
        const floatEye = this.surface + FLOAT_EYE;
        const atSurface = this.position.y >= floatEye - 0.15;
        const wish = new THREE.Vector3();
        if (input && this.keys.has('KeyW'))
            wish.add(look);
        if (input && this.keys.has('KeyS'))
            wish.sub(look);
        if (input && this.keys.has('KeyD'))
            wish.add(right);
        if (input && this.keys.has('KeyA'))
            wish.sub(right);
        // 水面にいるときは前を向いて泳いでも水から飛び出さない
        if (atSurface)
            wish.y = Math.min(wish.y, 0);
        const up = input && this.keys.has('Space');
        const down = input && this.keys.has('KeyC');
        if (up)
            wish.y += 1;
        if (down)
            wish.y -= 1;
        if (wish.lengthSq() > 1)
            wish.normalize();
        if (up && atSurface) {
            // 目の前に桟橋や岸があれば、水面で Space を押してよじ登る
            const fwd = new THREE.Vector3(look.x, 0, look.z).normalize();
            const feet = this.position.y - EYE_HEIGHT;
            const ledge = this.groundAt(this.position.x + fwd.x * 1.0, this.position.z + fwd.z * 1.0);
            const rise = ledge - feet;
            if (rise > 0.3 && rise < CLIMB_REACH) {
                this.velocity.set(fwd.x * 3, Math.sqrt(2 * GRAVITY * (rise + 0.3)), fwd.z * 3);
                this.onGround = false;
                return;
            }
        }
        const speed = running ? SWIM_FAST : SWIM_SPEED;
        // 上下の操作をしていなければ浮力でゆっくり水面へ戻る
        const float = up || down ? 0 : THREE.MathUtils.clamp((floatEye - this.position.y) * 1.5, -2, 1.2);
        const target = new THREE.Vector3(wish.x * speed, wish.y * speed + float, wish.z * speed);
        this.velocity.x = THREE.MathUtils.damp(this.velocity.x, target.x, 4, dt);
        this.velocity.y = THREE.MathUtils.damp(this.velocity.y, target.y, 4, dt);
        this.velocity.z = THREE.MathUtils.damp(this.velocity.z, target.z, 4, dt);
    }
    /** 直前の移動で触れた面のうち、いちばん平らな床の法線（床に触れていなければ null） */
    supportNormal() {
        let best = null;
        for (let i = 0; i < this.mover.numComputedCollisions(); i++) {
            const hit = this.mover.computedCollision(i);
            if (!hit)
                continue;
            // normal1 はキャラクター側の法線なので、反転すると触れた面の向きになる
            const n = new THREE.Vector3(-hit.normal1.x, -hit.normal1.y, -hit.normal1.z);
            if (n.y > 0 && (!best || n.y > best.y))
                best = n;
        }
        return best;
    }
    inBounds(x, z) {
        const limit = WORLD_SIZE / 2 - 2;
        return Math.abs(x) <= limit && Math.abs(z) <= limit;
    }
}
