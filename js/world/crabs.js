import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { mulberry32 } from './house.js';
import { isSandAt, withField } from './terrain.js';
// 砂浜を歩き回るカニ（敵ではない、眺めるだけの生き物）。自分の画面だけの演出。
// すみか（歩き回る範囲の中心）は場所ごとの種から決めるので誰の画面でも同じ所にいるが、
// 歩く先や止まる長さは各自のブラウザで決める（見た目だけで、ワールドの状態は変えない。セーブもしない）
const HOME_TRIES = 6000; // すみかを探す回数
const HOME_MIN_Y = 0.15; // すみかにする砂浜の高さ（波打ち際より少し上から）
const HOME_MAX_Y = 2.2;
const WALK_MIN_Y = 0.05; // 歩く先はこれより高い所だけ（海に入らない）
const HOME_GAP = 6; // すみかどうしを離す距離（m）
const ROAM = 3.5; // すみかから歩き回る範囲（m）
const SPEED = 1.1; // 歩く速さ（m／秒）
const FLEE_SPEED = 2.6; // 人から逃げるときの速さ
const FLEE_DIST = 3; // 人がこれより近づくと逃げる（m）
const IDLE = { min: 1.5, max: 6 }; // 止まっている時間（秒）
const LEG_SWING = 0.5; // 歩くときに脚を振る角度（rad）
const LEG_RATE = 18; // 脚を振る速さ（1秒あたりのラジアン）
const DRAW_DIST = 60; // カメラからこれより遠いカニは描かない・動かさない（m）
const SCALE = 0.55; // カニの大きさの倍率
const SHELL = new THREE.Color(PALETTE.accent);
const LEG = SHELL.clone().multiplyScalar(0.75);
const EYE = new THREE.Color(PALETTE.bark).multiplyScalar(0.5);
/** カニ1匹の体（甲羅・はさみ・脚・目）。脚は振って歩かせるので別の部品にする */
function buildCrab() {
    const root = new THREE.Group();
    const shell = flat(SHELL.getHex());
    const leg = flat(LEG.getHex());
    const eye = flat(EYE.getHex());
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 4), shell);
    body.scale.set(1.2, 0.45, 0.9);
    body.position.y = 0.16;
    root.add(body);
    // はさみ（前の左右）
    for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.16), leg);
        arm.position.set(s * 0.15, 0.15, 0.2);
        arm.rotation.y = -s * 0.5;
        const claw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), shell);
        claw.scale.set(0.9, 0.7, 1.3);
        claw.position.set(s * 0.2, 0.16, 0.31);
        root.add(arm, claw);
    }
    // 目（甲羅の前から突き出た2本）
    for (const s of [-1, 1]) {
        const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.08, 0.025), leg);
        stalk.position.set(s * 0.06, 0.24, 0.15);
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), eye);
        ball.position.set(s * 0.06, 0.29, 0.15);
        root.add(stalk, ball);
    }
    // 脚（左右に3本ずつ。付け根で振れるように、付け根を原点にした台に付ける）
    const legs = [];
    for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const pivot = new THREE.Group();
            pivot.position.set(s * 0.2, 0.15, 0.08 - i * 0.1);
            pivot.rotation.y = s * (0.15 - i * 0.2);
            const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), leg);
            seg.position.set(s * 0.09, -0.05, 0);
            seg.rotation.z = s * -0.5;
            pivot.add(seg);
            pivot.userData.side = s;
            pivot.userData.offset = i * 2.1 + (s > 0 ? Math.PI : 0); // 脚ごとに振るタイミングをずらす
            root.add(pivot);
            legs.push(pivot);
        }
    }
    root.scale.setScalar(SCALE);
    root.traverse((o) => {
        if (o instanceof THREE.Mesh)
            o.castShadow = true;
    });
    return { root, legs };
}
/** 1つの場所の砂浜のカニたち */
export class Crabs {
    field;
    group = new THREE.Group();
    crabs = [];
    /** field はその場所の地形、seed はすみかを決める種、count は数 */
    constructor(field, seed, count) {
        this.field = field;
        const rand = mulberry32(seed);
        const homes = [];
        withField(field, () => {
            for (let t = 0; t < HOME_TRIES && homes.length < count; t++) {
                const x = (rand() * 2 - 1) * field.half;
                const z = (rand() * 2 - 1) * field.half;
                const y = field.height(x, z);
                if (y < HOME_MIN_Y || y > HOME_MAX_Y || !isSandAt(x, z))
                    continue;
                if (field.isDry(x, z))
                    continue; // 洞窟の上は避ける
                if (homes.some((h) => Math.hypot(h.x - x, h.y - z) < HOME_GAP))
                    continue;
                homes.push(new THREE.Vector2(x, z));
            }
        });
        for (const home of homes) {
            const { root, legs } = buildCrab();
            const crab = {
                root,
                legs,
                home,
                pos: home.clone(),
                target: home.clone(),
                yaw: rand() * Math.PI * 2,
                idle: rand() * IDLE.max,
                speed: SPEED,
                phase: rand() * 10,
            };
            this.place(crab);
            this.group.add(root);
            this.crabs.push(crab);
        }
    }
    /** 毎フレーム動かす（今いる場所のカニだけ）。camera はカメラの位置（近づくと逃げる） */
    update(dt, camera) {
        for (const c of this.crabs) {
            const far = Math.hypot(c.pos.x - camera.x, c.pos.y - camera.z) > DRAW_DIST;
            c.root.visible = !far;
            if (far)
                continue;
            const near = Math.hypot(c.pos.x - camera.x, c.pos.y - camera.z) < FLEE_DIST;
            if (near && c.speed !== FLEE_SPEED) {
                // 人から離れる向きへ逃げる（すみかの範囲の中で）
                const away = new THREE.Vector2(c.pos.x - camera.x, c.pos.y - camera.z).normalize().multiplyScalar(ROAM);
                const t = c.pos.clone().add(away).sub(c.home).clampLength(0, ROAM * 1.4).add(c.home);
                if (this.walkable(t))
                    c.target.copy(t);
                c.idle = 0;
                c.speed = FLEE_SPEED;
            }
            if (c.idle > 0) {
                c.idle -= dt;
                if (c.idle <= 0) {
                    // 次に歩く先を、すみかのまわりの陸から選ぶ（見つからなければ、その場で足踏みしてまた止まる）
                    for (let k = 0; k < 6; k++) {
                        const a = Math.random() * Math.PI * 2;
                        const r = Math.sqrt(Math.random()) * ROAM;
                        const t = new THREE.Vector2(c.home.x + Math.cos(a) * r, c.home.y + Math.sin(a) * r);
                        if (this.walkable(t)) {
                            c.target.copy(t);
                            break;
                        }
                    }
                    c.speed = SPEED;
                }
                this.swing(c, 0, dt);
                continue;
            }
            const to = c.target.clone().sub(c.pos);
            const dist = to.length();
            const step = c.speed * dt;
            if (dist <= step) {
                c.pos.copy(c.target);
                c.idle = IDLE.min + Math.random() * (IDLE.max - IDLE.min);
            }
            else {
                c.pos.addScaledVector(to, step / dist);
                // 横歩き：進む向きを体の横（左右どちらか近いほう）にする
                const move = Math.atan2(to.x, to.y);
                const side = move + Math.PI / 2;
                let d = Math.atan2(Math.sin(side - c.yaw), Math.cos(side - c.yaw));
                if (Math.abs(d) > Math.PI / 2)
                    d -= Math.sign(d) * Math.PI;
                c.yaw += d * Math.min(1, dt * 6);
            }
            this.swing(c, c.idle > 0 ? 0 : 1, dt);
            this.place(c);
        }
    }
    /** 脚を振る（moving が 1 なら歩いている） */
    swing(c, moving, dt) {
        c.phase += dt * LEG_RATE * moving * (c.speed / SPEED);
        for (const leg of c.legs) {
            leg.rotation.z = moving * Math.sin(c.phase + leg.userData.offset) * LEG_SWING * leg.userData.side;
        }
    }
    /** p が歩ける陸か（海の中と洞窟の上には入らない） */
    walkable(p) {
        return this.field.height(p.x, p.y) >= WALK_MIN_Y && !this.field.isDry(p.x, p.y);
    }
    /** 位置と向きを地面に合わせる */
    place(c) {
        c.root.position.set(c.pos.x, this.field.height(c.pos.x, c.pos.y), c.pos.y);
        c.root.rotation.y = c.yaw;
    }
}
