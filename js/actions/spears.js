import * as THREE from 'three';
import { RAPIER, COLLIDE } from '../core/physics.js';
import { ITEMS, validDmg } from '../items/inventory.js';
import { SPEAR_LENGTH, buildSpear } from '../player/hand.js';
// 投げた石の槍。右クリック長押しで力を溜め、離すと視線の向きへ投げる。
// 飛んでいる槍・刺さった槍は共有ワールドの物なので、投げる・拾うはワールドコマンドにする。
// どこに刺さるかはホストが投げた時点で物理の当たり判定から決め、コマンドには「投げた位置・速さ・刺さるまでの時間」を入れる。
// 飛ぶ道すじは放物線の式だけで決まるので、誰の画面でも同じように飛んで同じ場所に刺さる
const MIN_SPEED = 10; // 少しだけ溜めて投げたときの速さ（m/s）
const MAX_SPEED = 28; // いっぱいまで溜めて投げたときの速さ
const SPEAR_GRAVITY = 14; // 飛んでいる槍にかかる重力（m/s²）。プレイヤーの重力より弱くして、遠くまで飛ぶようにする
const MAX_FLIGHT = 5; // これだけ飛んでも何にも当たらなければ、槍は見失ってなくなる（秒）
const TRACE_STEP = 1 / 60; // 刺さる場所を探すときに、放物線を刻む時間
const THROW_FORWARD = 0.3; // 投げた槍の穂先が出てくる位置（目から視線の向きへ）
const EMBED = 0.18; // 刺さったときに穂先がめり込む深さ
const PICKUP_REACH = 3.6; // 刺さった槍を拾える距離
const SUPPORT_INTERVAL = 0.5; // 刺さった先が無くなっていないか調べる間隔（秒）
const SUPPORT_RADIUS = 0.08; // 刺さった先を調べる球の半径
// 槍が刺さる物：地形・岩・桟橋・立っている木・建てた部材。動く物（倒れた丸太・落とし物・船・プレイヤー）には刺さらない
const HIT_FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
const HIT_GROUPS = COLLIDE.drop; // 落とし物と同じく、地形・木・部材とだけ比べる
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = new THREE.Vector3(0, -SPEAR_GRAVITY, 0);
/** t 秒後の穂先の位置 */
function tipAt(from, velocity, t, out = new THREE.Vector3()) {
    return out.copy(from).addScaledVector(velocity, t).addScaledVector(GRAVITY, 0.5 * t * t);
}
/** t 秒後の飛んでいく向き */
function dirAt(velocity, t, out = new THREE.Vector3()) {
    return out.copy(velocity).addScaledVector(GRAVITY, t).normalize();
}
export class Spears {
    world;
    physics;
    spears = new Map();
    raycaster = new THREE.Raycaster();
    nextSid = 0;
    /** 自分が投げた槍の番号（壊れたときに知らせる） */
    mine = new Set();
    supportTimer = 0;
    /** 拾った槍がインベントリに入るときに呼ばれる */
    onCollect = () => { };
    /** 自分が投げた槍が刺さった拍子に壊れたときに呼ばれる */
    onBreak = () => { };
    /** 共有ワールドへの頼みを出す（main が設定する）。適用できたら true */
    request = () => false;
    constructor(world, physics) {
        this.world = world;
        this.physics = physics;
        this.raycaster.far = PICKUP_REACH;
    }
    // ---- 入力側：視線から対象を決めて頼みを出す ----
    /** eye（目の位置）から look の向きへ、charge（0〜1）だけ溜めた力で槍を投げる頼みを出す。投げられたら true */
    throw(dmg, eye, look, charge) {
        const p = eye.clone().addScaledVector(look, THROW_FORWARD);
        const v = look.clone().normalize().multiplyScalar(THREE.MathUtils.lerp(MIN_SPEED, MAX_SPEED, charge));
        return this.request({ type: 'throwSpear', ...(dmg ? { dmg } : {}), p: p.toArray(), v: v.toArray() });
    }
    /** 画面中央で狙っている、刺さった槍（届く距離のもの） */
    aimed(camera) {
        this.raycaster.setFromCamera(SCREEN_CENTER, camera);
        const landed = [...this.spears.values()].filter((s) => !s.flying);
        const meshes = landed.map((s) => s.mesh);
        let hit = this.raycaster.intersectObjects(meshes, true)[0]?.object ?? null;
        while (hit && !meshes.includes(hit))
            hit = hit.parent;
        return hit ? landed.find((s) => s.mesh === hit) : undefined;
    }
    /** 拾える槍に視線が合っているか */
    isAiming(camera) {
        return this.aimed(camera) !== undefined;
    }
    /** 狙っている槍を拾う（room はインベントリにあと何個入るか）。狙っていれば、入りきらなくても true */
    collect(camera, room) {
        const s = this.aimed(camera);
        if (!s)
            return false;
        if (room('spear') <= 0)
            return true;
        this.request({ type: 'pickSpear', sid: s.sid });
        return true;
    }
    // ---- ホスト側：頼みを確かめてコマンドにする ----
    /** 頼みを確かめ、ID と刺さるまでの時間を付けたコマンドにする。できない頼みなら null（マルチではホストだけが呼ぶ） */
    authorize(req) {
        if (req.type === 'pickSpear') {
            const s = this.spears.get(req.sid);
            return s && !s.flying ? req : null; // 同じ槍を2人が拾おうとしたら、先に届いた方だけが拾える
        }
        const wellFormed = [...req.p, ...req.v].every(Number.isFinite) && new THREE.Vector3(...req.v).length() <= MAX_SPEED + 1e-3;
        if (!wellFormed)
            return null;
        if (req.dmg !== undefined && validDmg('spear', req.dmg) === undefined)
            return null;
        const { t, hit } = this.trace(new THREE.Vector3(...req.p), new THREE.Vector3(...req.v));
        return { ...req, sid: this.nextSid++, t, hit };
    }
    /** 放物線を少しずつ刻んで、最初に当たる物を探す。当たるまでの時間と、当たったかどうか */
    trace(from, velocity) {
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        for (let t = 0; t < MAX_FLIGHT; t += TRACE_STEP) {
            tipAt(from, velocity, t, a);
            tipAt(from, velocity, t + TRACE_STEP, b);
            const d = b.sub(a);
            // 方向を正規化しないので、当たるまでの距離（toi）は「この1歩のうちのどこで当たったか」の割合になる
            const ray = new RAPIER.Ray({ x: a.x, y: a.y, z: a.z }, { x: d.x, y: d.y, z: d.z });
            const hit = this.physics.world.castRay(ray, 1, true, HIT_FLAGS, HIT_GROUPS);
            if (hit)
                return { t: t + hit.timeOfImpact * TRACE_STEP, hit: true };
        }
        return { t: MAX_FLIGHT, hit: false };
    }
    // ---- 適用側：コマンドの値だけで世界を変える（カメラや入力は見ない） ----
    /** mine は自分の頼みか（自分が投げた槍は壊れたら知らせ、自分が拾った槍はインベントリに入れる） */
    apply(cmd, mine) {
        if (cmd.type === 'throwSpear') {
            if (this.spears.has(cmd.sid))
                return;
            const s = this.add(cmd.sid, cmd.dmg);
            if (mine)
                this.mine.add(cmd.sid);
            s.from.fromArray(cmd.p);
            s.velocity.fromArray(cmd.v);
            s.flight = cmd.t;
            s.hit = cmd.hit;
            s.flying = true;
            this.pose(s);
            return;
        }
        const s = this.spears.get(cmd.sid);
        if (!s)
            return;
        this.remove(s);
        if (mine)
            this.onCollect('spear', 1, s.dmg);
    }
    // ---- セーブ ----
    serialize() {
        const list = [];
        for (const s of this.spears.values()) {
            // 飛んでいる途中の槍は、刺さったあとの姿で保存する（壊れる・見失うものは保存しない）
            const landing = s.flying ? this.landing(s) : { dmg: s.dmg, tip: s.tip, quaternion: s.mesh.quaternion };
            if (!landing)
                continue;
            const q = landing.quaternion;
            list.push({ sid: s.sid, ...(landing.dmg ? { dmg: landing.dmg } : {}), p: [...landing.tip.toArray(), q.x, q.y, q.z, q.w] });
        }
        return { next: this.nextSid, list };
    }
    restore(save) {
        for (const s of [...this.spears.values()])
            this.remove(s);
        for (const { sid, dmg, p: [x, y, z, qx, qy, qz, qw] } of save.list) {
            const s = this.add(sid, validDmg('spear', dmg));
            this.stick(s, new THREE.Vector3(x, y, z), new THREE.Quaternion(qx, qy, qz, qw));
        }
        this.nextSid = Math.max(this.nextSid, save.next);
    }
    // ---- 内部 ----
    add(sid, dmg) {
        const mesh = buildSpear();
        mesh.traverse((o) => {
            o.castShadow = true;
            o.receiveShadow = true;
        });
        this.world.add(mesh);
        const s = { sid, dmg, mesh, from: new THREE.Vector3(), velocity: new THREE.Vector3(), flight: 0, hit: false, age: 0, flying: false, tip: new THREE.Vector3() };
        this.spears.set(sid, s);
        this.nextSid = Math.max(this.nextSid, sid + 1);
        return s;
    }
    remove(s) {
        this.spears.delete(s.sid);
        this.mine.delete(s.sid);
        s.mesh.removeFromParent();
    }
    /**
     * 飛んでいる槍が刺さったあとの姿。刺さると耐久値が 1 減り、尽きたら壊れる。
     * 壊れる・何にも当たらず見失うなら null
     */
    landing(s) {
        if (!s.hit)
            return null;
        const dmg = (s.dmg ?? 0) + 1;
        if (dmg >= (ITEMS.spear.durability ?? Infinity))
            return null;
        const dir = dirAt(s.velocity, s.flight);
        const tip = tipAt(s.from, s.velocity, s.flight).addScaledVector(dir, EMBED);
        return { dmg, tip, quaternion: new THREE.Quaternion().setFromUnitVectors(UP, dir) };
    }
    /** 穂先を tip に置き、quaternion の向きで刺さった姿にする */
    stick(s, tip, quaternion) {
        s.flying = false;
        s.tip.copy(tip);
        s.mesh.quaternion.copy(quaternion);
        s.mesh.position.copy(tip).addScaledVector(UP.clone().applyQuaternion(quaternion), -SPEAR_LENGTH);
    }
    /** 飛んでいる槍を、投げてからの時間に合わせた位置と向きにする */
    pose(s) {
        const dir = dirAt(s.velocity, s.age);
        s.mesh.quaternion.setFromUnitVectors(UP, dir);
        tipAt(s.from, s.velocity, s.age, s.mesh.position).addScaledVector(dir, -SPEAR_LENGTH);
    }
    update(dt) {
        for (const s of [...this.spears.values()]) {
            if (!s.flying)
                continue;
            s.age = Math.min(s.age + dt, s.flight);
            if (s.age < s.flight) {
                this.pose(s);
                continue;
            }
            const landing = this.landing(s);
            if (!landing) {
                if (s.hit && this.mine.has(s.sid))
                    this.onBreak();
                this.remove(s);
                continue;
            }
            s.dmg = landing.dmg;
            this.stick(s, landing.tip, landing.quaternion);
        }
        // 刺さった先（木・部材・岩）が無くなった槍は、その場に落とし物として落とす（マルチではホストだけが行う）
        this.supportTimer += dt;
        if (this.supportTimer < SUPPORT_INTERVAL)
            return;
        this.supportTimer = 0;
        for (const s of [...this.spears.values()]) {
            if (s.flying)
                continue;
            // めり込んだ穂先ではなく、刺さった面の位置で調べる（地形は中身の詰まった形ではないので、地面の下では当たらない）
            const surface = s.tip.clone().addScaledVector(UP.clone().applyQuaternion(s.mesh.quaternion), -EMBED);
            const touching = this.physics.world.intersectionWithShape({ x: surface.x, y: surface.y, z: surface.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(SUPPORT_RADIUS), HIT_FLAGS, HIT_GROUPS);
            if (touching)
                continue;
            const center = s.mesh.localToWorld(new THREE.Vector3(0, SPEAR_LENGTH / 2, 0));
            const dmg = s.dmg;
            if (this.request({ type: 'pickSpear', sid: s.sid }, null)) {
                this.request({ type: 'dropItem', item: 'spear', count: 1, ...(dmg ? { dmg } : {}), p: center.toArray(), v: [0, 0, 0] }, null);
            }
        }
    }
}
