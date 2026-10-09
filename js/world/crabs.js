import * as THREE from 'three';
import { BODY_Y, LEG_BEND, LEG_UP, SCALE, buildCrab, foldCrab } from '../items/crabModel.js';
import { mulberry32 } from './house.js';
import { isSandAt, withField } from './terrain.js';
// 砂浜を歩き回るカニ（敵ではない生き物）。素手・ツルハシ・斧・槍で叩くと体力が減り、尽きるとひっくり返って脚を閉じ、
// 落とし物の「カニ」（脚を閉じた姿）になる。しばらくすると、すみかに新しいカニが戻ってくる。
// すみか（歩き回る範囲の中心）は場所ごとの種から決めるので誰の画面でも同じ所にいるが、
// 歩く先や止まる長さは各自のブラウザで決める（見た目だけ）。
// 体力とやられているかどうかは共有ワールド：叩く（hitCrab）・戻ってくる（reviveCrab）はワールドコマンドにし、セーブにも入れる。
// 歩く位置は人ごとに少しずれるので、当たったかどうかと、倒れた位置は叩いた人の画面で決める。
// 倒れたカニの落とし物は、ひっくり返り終わってからホストが世界の頼み（dropItem）で落とす
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
const CLAW_OPEN = 0.45; // はさみの指がいちばん開いたときの角度（rad）
const CLAW_RATE = 1.3; // 止まっている間に、はさみをゆっくり開け閉めする速さ（1秒あたりのラジアン）
const DRAW_DIST = 60; // カメラからこれより遠いカニは描かない・動かさない（m）
const MAX_HP = 6; // カニの体力
/** 道具ごとに、1回叩いて減らす体力 */
const TOOL_DAMAGE = { fist: 1, pickaxe: 2, axe: 3, spear: 3 };
const RESPAWN = 300; // やられてから、すみかに戻ってくるまでの時間（秒）
const HIT_RADIUS = 0.3; // 叩ける範囲（甲羅のまわりの球の半径。m）
const HIT_Y = 0.12; // 叩ける範囲の中心の、地面からの高さ（m）
const HURT_TIME = 0.35; // 叩かれて跳ねる時間（秒）
const HURT_HOP = 0.12; // 叩かれて跳ねる高さ（m）
const FLIP_TIME = 0.45; // やられてひっくり返り、脚を閉じきるまでの時間（秒）。過ぎると落とし物に替わる
const DROP_Y = 0.15; // 落とし物を置く、地面からの高さ（m）
const HIT_SPREAD = ROAM * 2; // 叩いた人の画面のカニの位置を、すみかからこの距離までなら信じる（m）
const AIM_EPS = 0.05; // 狙いをさえぎる物との距離の余裕（m）
const SCREEN_CENTER = new THREE.Vector2(0, 0);
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
                dropIn: null,
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
            c.root.visible = !far && (c.respawn === null || c.dying < FLIP_TIME);
            if (c.respawn !== null) {
                // やられた：ひっくり返りながら脚を閉じる（閉じきったら隠し、落とし物に替わる）
                c.dying += dt;
                foldCrab(c, Math.min(1, c.dying / FLIP_TIME));
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
        if (crab === null)
            return false;
        const { pos } = this.crabs[crab];
        return this.request({ type: 'hitCrab', place: this.loc, crab, tool, p: [pos.x, pos.y] });
    }
    /** 時間を進める。やられたカニが戻ってくる時間になったら、世界の頼みとして戻す（ホストだけが出せる） */
    tick(dt) {
        this.crabs.forEach((c, crab) => {
            if (c.respawn === null)
                return;
            if (c.dropIn !== null) {
                c.dropIn -= dt;
                if (c.dropIn <= 0) {
                    c.dropIn = null;
                    this.dropBody(c);
                }
            }
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
        // 叩いた人の画面の位置が、すみかから離れすぎていればすみかにする
        const [x, z] = req.p;
        const p = Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - c.home.x, z - c.home.y) <= HIT_SPREAD ? [x, z] : [c.home.x, c.home.y];
        return { type: 'hitCrab', place: req.place, crab: req.crab, damage, p };
    }
    // ---- 適用側：コマンドの値だけでカニを変える ----
    /** 叩かれた（跳ねる・ダメージの数を出す見た目のため）。p はカニの位置、mine は自分が叩いたか */
    onHit = () => { };
    /** mine は自分の頼みか */
    apply(cmd, mine) {
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
        const killed = c.hp <= 0;
        if (killed) {
            // 叩いた人の画面の位置で倒れる
            c.pos.set(cmd.p[0], cmd.p[1]);
            c.target.copy(c.pos);
            c.respawn = RESPAWN;
            c.dying = 0;
            c.dropIn = FLIP_TIME; // 落とすのは世界の頼みなので、ホストの頼みだけが通る
            this.place(c);
        }
        this.onHit(new THREE.Vector3(c.root.position.x, c.root.position.y + HIT_Y * 2, c.root.position.z), cmd.damage, killed, mine);
    }
    /** 倒れたカニを落とし物にする（世界の頼み。ひっくり返った向きで落とす） */
    dropBody(c) {
        const y = this.field.height(c.pos.x, c.pos.y) + DROP_Y;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.yaw, Math.PI, 'YXZ'));
        const at = this.loc === 'island' ? {} : { loc: this.loc };
        this.request({ type: 'dropItem', item: 'crab', count: 1, p: [c.pos.x, y, c.pos.y], v: [0, 0, 0], q: q.toArray(), ...at }, null);
    }
    /** やられたカニを、元気な姿ですみかに戻す */
    revive(c) {
        c.hp = MAX_HP;
        c.respawn = null;
        c.dying = 0;
        c.dropIn = null;
        c.hurt = 0;
        foldCrab(c, 0);
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
                c.dying = Infinity; // 読み込んだときには、もう落とし物に替わっている
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
            // ひっくり返る（甲羅の高さを支点に、横へ転がす）
            const k = Math.min(1, c.dying / FLIP_TIME);
            flip = Math.PI * k * k;
            y += Math.sin(flip) * HURT_HOP + BODY_Y * SCALE * 2 * k;
        }
        else if (c.hurt > 0) {
            y += Math.sin((c.hurt / HURT_TIME) * Math.PI) * HURT_HOP; // 叩かれて跳ねる
        }
        c.root.position.set(c.pos.x, y, c.pos.y);
        c.root.rotation.set(0, c.yaw, flip, 'YXZ');
    }
}
