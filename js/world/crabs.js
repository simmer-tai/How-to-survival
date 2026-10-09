import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { mulberry32 } from './house.js';
import { isSandAt, withField } from './terrain.js';
// 砂浜を歩き回るカニ（敵ではない生き物）。素手・ツルハシ・斧・槍で叩くと体力が減り、尽きるとひっくり返って砂に沈む。
// しばらくするとすみかに戻ってくる。
// すみか（歩き回る範囲の中心）は場所ごとの種から決めるので誰の画面でも同じ所にいるが、
// 歩く先や止まる長さは各自のブラウザで決める（見た目だけ）。
// 体力とやられているかどうかは共有ワールド：叩く（hitCrab）・戻ってくる（reviveCrab）はワールドコマンドにし、セーブにも入れる。
// 歩く位置は人ごとに少しずれるので、当たったかどうかは叩いた人の画面で決める
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
const LEG_SWING = 0.35; // 歩くときに、付け根で脚を前後に振る角度（rad）
const LEG_LIFT = 0.3; // 歩くときに、脚を持ち上げる角度（rad。前へ戻す間だけ上げる）
const LEG_RATE = 18; // 脚を振る速さ（1秒あたりのラジアン）
const LEG_COUNT = 4; // 片側の脚の数
const LEG_THIGH = 0.17; // もも（付け根からひざまで）の長さ
const LEG_SHIN = 0.22; // すね（ひざから先まで）の長さ
const LEG_TIP = 0.06; // 脚の先の爪の長さ
const LEG_UP = 0.75; // ももを持ち上げる角度（rad）
const LEG_BEND = -2.1; // ひざで曲げる角度（rad。下へ折って先を地面につける）
const BODY_Y = 0.17; // 甲羅の中心の高さ（脚で持ち上げる高さ）
const CLAW_OPEN = 0.45; // はさみの指がいちばん開いたときの角度（rad）
const CLAW_RATE = 1.3; // 止まっている間に、はさみをゆっくり開け閉めする速さ（1秒あたりのラジアン）
const DRAW_DIST = 60; // カメラからこれより遠いカニは描かない・動かさない（m）
const SCALE = 0.55; // カニの大きさの倍率
const MAX_HP = 6; // カニの体力
/** 道具ごとに、1回叩いて減らす体力 */
const TOOL_DAMAGE = { fist: 1, pickaxe: 2, axe: 3, spear: 3 };
const RESPAWN = 300; // やられてから、すみかに戻ってくるまでの時間（秒）
const HIT_RADIUS = 0.3; // 叩ける範囲（甲羅のまわりの球の半径。m）
const HIT_Y = 0.12; // 叩ける範囲の中心の、地面からの高さ（m）
const HURT_TIME = 0.35; // 叩かれて跳ねる時間（秒）
const HURT_HOP = 0.12; // 叩かれて跳ねる高さ（m）
const FLIP_TIME = 0.5; // やられてひっくり返るまでの時間（秒）
const SINK_DELAY = 2.5; // ひっくり返ってから砂に沈み始めるまでの時間（秒）
const SINK_TIME = 1.5; // 砂に沈みきるまでの時間（秒）
const SINK_DEPTH = 0.3; // 沈む深さ（m）
const AIM_EPS = 0.05; // 狙いをさえぎる物との距離の余裕（m）
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const SHELL = new THREE.Color(PALETTE.accent);
const LEG = SHELL.clone().multiplyScalar(0.75);
const TIP = SHELL.clone().lerp(new THREE.Color(PALETTE.sand), 0.35); // 脚の先とはさみの指（白っぽい）
const EYE = new THREE.Color(PALETTE.bark).multiplyScalar(0.5);
/** 先の細い棒（関節の台の +x の向きに伸びる。脚の節に使う） */
function segment(length, base, tip, mat) {
    const geo = new THREE.CylinderGeometry(tip, base, length, 5);
    geo.rotateZ(-Math.PI / 2); // 軸を +x に向ける（細いほうが先）
    geo.translate(length / 2, 0, 0);
    return new THREE.Mesh(geo, mat);
}
/** 先の細いとがった指（+z の向きに伸びる。はさみの指に使う） */
function fingerShape(length, base, mat) {
    const geo = new THREE.CylinderGeometry(0.004, base, length, 5);
    geo.rotateX(Math.PI / 2); // 軸を +z に向ける（とがったほうが先）
    geo.translate(0, 0, length / 2);
    geo.scale(1, 0.75, 1); // 上下に少し平たく
    return new THREE.Mesh(geo, mat);
}
/** 脚1本を作る。右側の向き（付け根から +x の外へ）で組み、ひざで下へ折って先を地面につける */
function buildLeg(mat, tipMat) {
    const root = new THREE.Group();
    const hip = new THREE.Group();
    hip.rotation.z = LEG_UP; // ももは外へ、少し上向きに
    hip.add(segment(LEG_THIGH, 0.022, 0.016, mat));
    const knee = new THREE.Group();
    knee.position.x = LEG_THIGH;
    knee.rotation.z = LEG_BEND; // ひざで下へ折る
    knee.add(segment(LEG_SHIN, 0.016, 0.01, mat));
    // ひざの継ぎ目の玉と、脚の先のとがった爪
    const joint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), mat);
    const tip = segment(LEG_TIP, 0.01, 0.002, tipMat);
    tip.position.x = LEG_SHIN;
    tip.rotation.z = -0.35;
    knee.add(joint, tip);
    hip.add(knee);
    root.add(hip);
    return { root, hip, knee };
}
/** はさみ1本を作る。右側の向きで、肩から前へ腕を伸ばし、ひじで内へ曲げ、手のひらから上下2本の指が出る */
function buildClaw(shell, leg, tipMat, size) {
    const root = new THREE.Group();
    const shoulder = new THREE.Group();
    shoulder.rotation.set(-0.25, 0.55, 0); // 前・外向き、少し上へ
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.13).translate(0, 0, 0.065), leg);
    const elbow = new THREE.Group();
    elbow.position.z = 0.13;
    elbow.rotation.set(0.2, -1.05, 0); // ひじで内へ曲げる
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.09).translate(0, 0, 0.045), shell);
    const elbowJoint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), leg);
    const wrist = new THREE.Group();
    wrist.position.z = 0.09;
    wrist.rotation.y = 0.5; // 手首で少し外へ向け直す
    wrist.scale.setScalar(size);
    // 手のひら（ふくらんだ甲羅）と、下の動かない指・上の動く指
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), shell);
    palm.scale.set(0.85, 0.75, 1.25);
    palm.position.z = 0.07;
    const fixed = fingerShape(0.1, 0.034, tipMat);
    fixed.position.set(0, -0.018, 0.14);
    fixed.rotation.x = -0.12;
    const finger = new THREE.Group();
    finger.position.set(0, 0.025, 0.13);
    const moving = fingerShape(0.095, 0.028, tipMat);
    finger.add(moving);
    wrist.add(palm, fixed, finger);
    elbow.add(fore, elbowJoint, wrist);
    shoulder.add(upper, elbow);
    root.add(shoulder);
    return { root, finger };
}
/** カニ1匹の体（甲羅・はさみ・脚・目）。脚とはさみは関節ごとに動かす */
function buildCrab() {
    const root = new THREE.Group();
    const shell = flat(SHELL.getHex());
    const leg = flat(LEG.getHex());
    const tip = flat(TIP.getHex());
    const eye = flat(EYE.getHex());
    // 甲羅：横に広い平たい楕円に、前のふちのでこぼこ
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5), shell);
    body.scale.set(1.25, 0.45, 0.92);
    body.position.y = BODY_Y;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 3), leg);
    belly.scale.set(1.15, 0.25, 0.85);
    belly.position.y = BODY_Y - 0.035;
    root.add(body, belly);
    for (const x of [-0.1, 0, 0.1]) {
        const bump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), shell);
        bump.position.set(x, BODY_Y + 0.03, 0.18);
        root.add(bump);
    }
    // 目（甲羅の前から突き出た2本）
    for (const s of [-1, 1]) {
        const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), leg);
        stalk.position.set(s * 0.06, BODY_Y + 0.08, 0.16);
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028, 0), eye);
        ball.position.set(s * 0.06, BODY_Y + 0.125, 0.16);
        root.add(stalk, ball);
    }
    // はさみ（前の左右。右のほうが少し大きい）
    const claws = [];
    for (const s of [-1, 1]) {
        const { root: arm, finger } = buildClaw(shell, leg, tip, s > 0 ? 1.15 : 1);
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.13, BODY_Y, 0.15);
        pivot.scale.x = s; // 左は左右反転
        pivot.add(arm);
        root.add(pivot);
        claws.push({ pivot, finger, offset: s > 0 ? 0 : 1.7 });
    }
    // 脚（左右に4本ずつ。付け根の台を体のふちに置き、前から後ろへ扇のように向きを変える）
    const legs = [];
    for (const s of [-1, 1]) {
        for (let i = 0; i < LEG_COUNT; i++) {
            const { root: limb, hip, knee } = buildLeg(leg, tip);
            const pivot = new THREE.Group();
            const z = 0.09 - i * 0.075;
            pivot.position.set(s * 0.2, BODY_Y - 0.01, z);
            pivot.rotation.y = -s * (0.45 - i * 0.3); // 前の脚は前へ、後ろの脚は後ろへ向ける
            pivot.scale.x = s;
            pivot.add(limb);
            root.add(pivot);
            // 左右の同じ番号の脚、となりの脚どうしは逆のタイミングで動かす（交互に歩く）
            legs.push({ pivot, hip, knee, offset: i * Math.PI + (s > 0 ? Math.PI / 2 : 0) });
        }
    }
    root.scale.setScalar(SCALE);
    root.traverse((o) => {
        if (o instanceof THREE.Mesh)
            o.castShadow = true;
    });
    return { root, legs, claws };
}
/** 1つの場所の砂浜のカニたち */
export class Crabs {
    loc;
    field;
    request;
    group = new THREE.Group();
    crabs = [];
    raycaster = new THREE.Raycaster();
    sphere = new THREE.Sphere();
    hitPoint = new THREE.Vector3();
    /**
     * loc はこの場所の id、field はその場所の地形、seed はすみかを決める種、count は数。
     * request は頼みを出す関数（main の requestWorld）
     */
    constructor(loc, field, seed, count, request) {
        this.loc = loc;
        this.field = field;
        this.request = request;
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
            const { root, legs, claws } = buildCrab();
            const crab = {
                root,
                legs,
                claws,
                home,
                pos: home.clone(),
                target: home.clone(),
                yaw: rand() * Math.PI * 2,
                idle: rand() * IDLE.max,
                speed: SPEED,
                phase: rand() * 10,
                clawPhase: rand() * 10,
                hp: MAX_HP,
                respawn: null,
                hurt: 0,
                scared: false,
                dying: 0,
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
            c.root.visible = !far && c.dying < FLIP_TIME + SINK_DELAY + SINK_TIME;
            if (c.respawn !== null) {
                // やられた：ひっくり返って、しばらくしてから砂に沈む
                c.dying += dt;
                this.place(c);
                continue;
            }
            if (far)
                continue;
            if (c.hurt > 0)
                c.hurt = Math.max(0, c.hurt - dt);
            const near = Math.hypot(c.pos.x - camera.x, c.pos.y - camera.z) < FLEE_DIST;
            if (c.scared || (near && c.speed !== FLEE_SPEED)) {
                c.scared = false;
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
    // ---- 入力側：狙ったカニを叩く頼みを出す ----
    /** 視線の先 reach 以内にいる、生きているカニの番号（手前の targets にさえぎられていれば null） */
    aimed(camera, reach, targets) {
        this.raycaster.setFromCamera(SCREEN_CENTER, camera);
        const ray = this.raycaster.ray;
        let best = null;
        let bestDist = reach;
        this.crabs.forEach((c, i) => {
            if (c.respawn !== null || !c.root.visible)
                return;
            this.sphere.center.set(c.root.position.x, c.root.position.y + HIT_Y, c.root.position.z);
            this.sphere.radius = HIT_RADIUS;
            const hit = ray.intersectSphere(this.sphere, this.hitPoint);
            if (!hit)
                return;
            const d = hit.distanceTo(ray.origin);
            if (d < bestDist) {
                best = i;
                bestDist = d;
            }
        });
        if (best === null)
            return null;
        this.raycaster.far = bestDist;
        const block = this.raycaster.intersectObjects(targets, false)[0];
        this.raycaster.far = Infinity;
        return block && block.distance < bestDist - AIM_EPS ? null : best;
    }
    /** 狙ったカニを tool で叩く。叩けたら true（道具の耐久値を減らすのは呼んだ側） */
    hit(camera, tool, reach, targets) {
        const crab = this.aimed(camera, reach, targets);
        return crab !== null && this.request({ type: 'hitCrab', place: this.loc, crab, tool });
    }
    /** 時間を進める。やられたカニが戻ってくる時間になったら、世界の頼みとして戻す（ホストだけが出せる） */
    tick(dt) {
        this.crabs.forEach((c, crab) => {
            if (c.respawn === null)
                return;
            c.respawn = Math.max(0, c.respawn - dt);
            if (c.respawn <= 0)
                this.request({ type: 'reviveCrab', place: this.loc, crab }, null);
        });
    }
    // ---- 確かめる側（ホスト）：叩けるか・どれだけ減るかを決める ----
    authorize(req) {
        const c = this.crabs[req.crab];
        if (!c)
            return null;
        if (req.type === 'reviveCrab')
            return c.respawn !== null && c.respawn <= 0 ? req : null;
        const damage = TOOL_DAMAGE[req.tool];
        if (c.respawn !== null || !damage)
            return null;
        return { type: 'hitCrab', place: req.place, crab: req.crab, damage };
    }
    // ---- 適用側：コマンドの値だけでカニを変える ----
    apply(cmd) {
        const c = this.crabs[cmd.crab];
        if (!c)
            return;
        if (cmd.type === 'reviveCrab') {
            this.revive(c);
            return;
        }
        if (c.respawn !== null)
            return;
        c.hp = Math.max(0, c.hp - cmd.damage);
        c.hurt = HURT_TIME;
        c.scared = true;
        if (c.hp <= 0) {
            c.respawn = RESPAWN;
            c.dying = 0;
        }
    }
    /** やられたカニを、元気な姿ですみかに戻す */
    revive(c) {
        c.hp = MAX_HP;
        c.respawn = null;
        c.dying = 0;
        c.hurt = 0;
        c.pos.copy(c.home);
        c.target.copy(c.home);
        c.idle = IDLE.min;
        c.speed = SPEED;
        this.place(c);
    }
    serialize() {
        const out = [];
        this.crabs.forEach((c, i) => {
            if (c.hp < MAX_HP || c.respawn !== null)
                out.push([i, c.hp, c.respawn ?? -1]);
        });
        return out;
    }
    /** セーブや途中参加で受け取った状態に戻す（入っていないカニは元気） */
    restore(data) {
        for (const c of this.crabs)
            this.revive(c);
        if (!Array.isArray(data))
            return;
        for (const [i, hp, respawn] of data) {
            const c = this.crabs[i];
            if (!c)
                continue;
            c.hp = Math.min(MAX_HP, Math.max(0, hp));
            if (respawn >= 0) {
                c.respawn = respawn;
                c.dying = Infinity; // 読み込んだときには、もう沈みきっている
            }
        }
    }
    /** 脚を振る（moving が 1 なら歩いている） */
    swing(c, moving, dt) {
        c.phase += dt * LEG_RATE * moving * (c.speed / SPEED);
        c.clawPhase += dt * CLAW_RATE * (moving ? 4 : 1);
        for (const leg of c.legs) {
            const t = c.phase + leg.offset;
            // 付け根で前後に振り、前へ戻す間だけ脚を持ち上げて、ひざを少し伸ばす
            const lift = moving * Math.max(0, Math.cos(t)) * LEG_LIFT;
            leg.hip.rotation.y = moving * Math.sin(t) * LEG_SWING;
            leg.hip.rotation.z = LEG_UP + lift;
            leg.knee.rotation.z = LEG_BEND + lift * 0.6;
        }
        for (const claw of c.claws) {
            // 動く指を開けたり閉じたりする（逃げるときはせわしなく）
            claw.finger.rotation.x = -CLAW_OPEN * (0.5 + 0.5 * Math.sin(c.clawPhase + claw.offset));
        }
    }
    /** p が歩ける陸か（海の中と洞窟の上には入らない） */
    walkable(p) {
        return this.field.height(p.x, p.y) >= WALK_MIN_Y && !this.field.isDry(p.x, p.y);
    }
    /** 位置と向きを地面に合わせる */
    place(c) {
        let y = this.field.height(c.pos.x, c.pos.y);
        let flip = 0;
        if (c.respawn !== null) {
            // ひっくり返る（甲羅の高さを支点に、横へ転がす）。そのあと砂に沈む
            const k = Math.min(1, c.dying / FLIP_TIME);
            flip = Math.PI * k * k;
            y += Math.sin(flip) * HURT_HOP + (BODY_Y * SCALE * 2) * k;
            y -= SINK_DEPTH * Math.min(1, Math.max(0, (c.dying - FLIP_TIME - SINK_DELAY) / SINK_TIME));
        }
        else if (c.hurt > 0) {
            y += Math.sin((c.hurt / HURT_TIME) * Math.PI) * HURT_HOP; // 叩かれて跳ねる
        }
        c.root.position.set(c.pos.x, y, c.pos.y);
        c.root.rotation.set(0, c.yaw, flip, 'YXZ');
    }
}
