import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { RAPIER, COLLIDE } from '../core/physics.js';
import { ITEMS, validDmg } from './inventory.js';
import { disposeModel, itemModel } from './itemIcons.js';
const PICKUP_REACH = 3.6; // 視線の先、この距離までの落とし物を拾える
const FLY_TIME = 0.22; // 拾ったときに吸い寄せられる時間
const PIECE_RADIUS = 0.16;
const PIECE_LENGTH = 0.75;
const DROP_MAX_SIZE = 0.6; // 落とした物の見た目の大きさの上限（これより大きいモデルは縮める）
const DROP_SIZE = { stone: 0.3, coin: 0.18, spear: 1.6 }; // 個別に大きさの上限を決める物（石は小石くらい、コインは手のひらに乗るくらい、槍は手に持つ長さのままにする）
const DROP_MIN_HALF = 0.04; // 当たり判定の箱の厚みの下限（薄すぎると地面をすり抜ける）
const SINKS = new Set(['stone']); // 水に浮かない物
const SCREEN_CENTER = new THREE.Vector2(0, 0);
// 側面は樹皮、切り口は明るい色
const pieceGeo = new THREE.CylinderGeometry(PIECE_RADIUS, PIECE_RADIUS, PIECE_LENGTH, 7);
pieceGeo.userData.shared = true; // 拾ったあと disposeModel で捨てられないように
const pieceMats = [flat(PALETTE.trunk), flat(PALETTE.sand), flat(PALETTE.sand)];
// 当たり判定も見た目と同じ七角柱にする（真円だといつまでも転がり続ける）
const pieceHull = pieceGeo.getAttribute('position').array;
/** 木材1個の見た目（軸は Y） */
export function woodPiece() {
    return new THREE.Mesh(pieceGeo, pieceMats);
}
/** 落とし物の通し番号から決まる乱数（誰の画面でも同じ値になる） */
function seeded(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** 木材以外の落とし物の見た目：アイテムのモデルを中心が原点になるように置き、大きすぎれば縮める */
function dropModel(item) {
    const model = itemModel(item);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = Math.min(1, (DROP_SIZE[item] ?? DROP_MAX_SIZE) / Math.max(size.x, size.y, size.z));
    model.position.sub(box.getCenter(new THREE.Vector3())).multiplyScalar(scale);
    model.scale.multiplyScalar(scale);
    const g = new THREE.Group();
    g.add(model);
    const half = size.multiplyScalar(scale / 2).max(new THREE.Vector3(DROP_MIN_HALF, DROP_MIN_HALF, DROP_MIN_HALF));
    return { model: g, half };
}
/**
 * 地面に落ちている物（物理で転がる）。木をばらしたときの木材や、プレイヤーが G で落とした物。
 * 視線を合わせて F で拾う。落とす・拾うはワールドコマンドにして apply で適用する
 */
export class ItemDrops {
    world;
    physics;
    drops = new Map();
    flyers = [];
    raycaster = new THREE.Raycaster();
    target = new THREE.Vector3();
    nextDid = 0;
    /** 拾った物が手元に届いたときに呼ばれる（dmg は使いかけの道具の減った耐久値） */
    onCollect = () => { };
    /** 共有ワールドへの頼みを出す（main が設定する）。適用できたら true */
    request = () => false;
    constructor(world, physics) {
        this.world = world;
        this.physics = physics;
        this.raycaster.far = PICKUP_REACH;
    }
    /**
     * 幹を count 個の木材に切り分けて弾けさせる（世界が出す頼みなので、マルチではホストだけが出せる）。
     * 飛び方はホストが決めてコマンドで配るので、Math.random() でよい
     */
    spawn(trunk, count) {
        trunk.updateWorldMatrix(true, false);
        const height = trunk.geometry.parameters.height;
        const rotation = trunk.getWorldQuaternion(new THREE.Quaternion());
        const center = trunk.localToWorld(new THREE.Vector3());
        for (let n = 0; n < count; n++) {
            const pos = trunk.localToWorld(new THREE.Vector3(0, ((n + 0.5) / count - 0.5) * height, 0));
            pos.y += 0.3;
            // 丸太の中心から外へ弾ける
            const out = pos.clone().sub(center).setY(0);
            if (out.lengthSq() < 1e-4)
                out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
            out.normalize().multiplyScalar(1 + Math.random() * 1.5);
            const v = [out.x + (Math.random() - 0.5), 3 + Math.random() * 2, out.z + (Math.random() - 0.5)];
            this.request({ type: 'dropItem', item: 'wood', count: 1, p: pos.toArray(), v, q: rotation.toArray() }, null);
        }
    }
    /** 条件に合う落とし物の数（位置はホストの物理で計算したもの） */
    count(match) {
        let n = 0;
        for (const d of this.drops.values())
            if (match(d.item, d.mesh.position))
                n++;
        return n;
    }
    // ---- 入力側：視線から対象を決めて頼みを出す ----
    /** 画面中央で狙っている落とし物（届く距離のもの） */
    aimed(camera) {
        this.raycaster.setFromCamera(SCREEN_CENTER, camera);
        const meshes = [...this.drops.values()].map((d) => d.mesh);
        let hit = this.raycaster.intersectObjects(meshes, true)[0]?.object ?? null;
        // モデルの部品に当たったら、落とし物の根元までたどる
        while (hit && !meshes.includes(hit))
            hit = hit.parent;
        return hit ? [...this.drops.values()].find((d) => d.mesh === hit) : undefined;
    }
    /** 拾える物に視線が合っているか */
    isAiming(camera) {
        return this.aimed(camera) !== undefined;
    }
    /** 狙っている物を拾う（room はインベントリにあと何個入るか）。狙っていれば、入りきらなくても true */
    collect(camera, room) {
        const d = this.aimed(camera);
        if (!d)
            return false;
        const count = Math.min(d.count, room(d.item));
        if (count <= 0)
            return true;
        this.request({ type: 'pickDrop', did: d.did, count });
        return true;
    }
    /** eye（目の位置）から look の向きへアイテムを投げ出す頼みを出す。落とせたら true */
    throw(item, count, dmg, eye, look) {
        const p = eye.clone().addScaledVector(look, 0.5);
        p.y -= 0.3;
        const v = look.clone().multiplyScalar(3.5);
        v.y += 1.5;
        return this.request({ type: 'dropItem', item, count, ...(dmg ? { dmg } : {}), p: p.toArray(), v: v.toArray() });
    }
    // ---- ホスト側：頼みを確かめてコマンドにする ----
    /** 頼みを確かめ、ID を付けたコマンドにする。できない頼みなら null（マルチではホストだけが呼ぶ） */
    authorize(req) {
        if (req.type === 'dropItem') {
            const def = ITEMS[req.item];
            const wellFormed = [...req.p, ...req.v].every(Number.isFinite) && Number.isInteger(req.count);
            if (!def || !wellFormed || req.count < 1 || req.count > def.maxStack)
                return null;
            if (req.dmg !== undefined && validDmg(req.item, req.dmg) === undefined)
                return null;
            if (req.q !== undefined && (req.q.length !== 4 || !req.q.every(Number.isFinite)))
                return null;
            return { ...req, did: this.nextDid++ };
        }
        // 同じ物を2人が拾おうとしたら、先に届いた方だけが拾える（残りの個数を超える分は拾えない）
        const d = this.drops.get(req.did);
        if (!d || !Number.isInteger(req.count) || req.count < 1)
            return null;
        return { ...req, count: Math.min(req.count, d.count) };
    }
    // ---- 適用側：コマンドの値だけで世界を変える（カメラや入力は見ない） ----
    /** mine は自分の頼みか（自分が拾ったときだけ、手元へ吸い寄せてインベントリに入れる） */
    apply(cmd, mine) {
        if (cmd.type === 'dropItem') {
            if (this.drops.has(cmd.did))
                return;
            const rand = seeded(cmd.did);
            const euler = new THREE.Euler(rand() * 6.3, rand() * 6.3, rand() * 6.3);
            const rotation = cmd.q ? new THREE.Quaternion(...cmd.q).normalize() : new THREE.Quaternion().setFromEuler(euler);
            const body = this.add(cmd.did, cmd.item, cmd.count, new THREE.Vector3(...cmd.p), rotation, cmd.dmg);
            body.setLinvel({ x: cmd.v[0], y: cmd.v[1], z: cmd.v[2] }, true);
            body.setAngvel({ x: (rand() - 0.5) * 6, y: (rand() - 0.5) * 6, z: (rand() - 0.5) * 6 }, true);
            return;
        }
        const d = this.drops.get(cmd.did);
        if (!d)
            return;
        const count = Math.min(cmd.count, d.count);
        if (count < d.count) {
            d.count -= count;
            // 一部だけ拾ったときは、拾った分の見た目を別に作って吸い寄せる
            if (mine)
                this.fly(d.item, count, d.dmg, this.buildMesh(d.item).mesh, d.mesh.position);
            return;
        }
        this.drops.delete(cmd.did);
        this.physics.removeBody(d.body);
        if (mine) {
            this.fly(d.item, count, d.dmg, d.mesh, d.mesh.position);
        }
        else {
            d.mesh.removeFromParent();
            disposeModel(d.mesh);
        }
    }
    // ---- マルチ：転がる動きはホストの物理で決めて配る ----
    /** 動いている落とし物の位置・向き・速さ。1つにつき [番号, x, y, z, qx, qy, qz, qw, vx, vy, vz]（ホストがときどき配る） */
    motion() {
        const out = [];
        for (const d of this.drops.values()) {
            if (d.body.isSleeping() || !d.body.isEnabled())
                continue;
            const t = d.body.translation();
            const r = d.body.rotation();
            const v = d.body.linvel();
            out.push([d.did, t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z]);
        }
        return out;
    }
    /** ホストから届いた動きに合わせる（参加者が呼ぶ。あいだは自分の物理でつなぐ） */
    setMotion(list) {
        for (const [did, x, y, z, qx, qy, qz, qw, vx, vy, vz] of list) {
            const d = this.drops.get(did);
            if (!d)
                continue;
            d.body.setTranslation({ x, y, z }, true);
            d.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
            d.body.setLinvel({ x: vx, y: vy, z: vz }, true);
        }
    }
    // ---- セーブ ----
    serialize() {
        const pose = ({ position: p, quaternion: q }) => [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
        const dmg = (d) => (d.dmg ? { dmg: d.dmg } : {});
        const list = [...this.drops.values()].map((d) => ({ did: d.did, item: d.item, count: d.count, ...dmg(d), p: pose(d.mesh) }));
        // 吸い寄せ中のものはまだインベントリに入っていないので、その場に落ちているものとして保存する
        let next = this.nextDid;
        for (const f of this.flyers)
            list.push({ did: next++, item: f.item, count: f.count, ...dmg(f), p: [...f.from.toArray(), 0, 0, 0, 1] });
        return { next, list };
    }
    restore(save) {
        for (const d of [...this.drops.values()]) {
            this.physics.removeBody(d.body);
            d.mesh.removeFromParent();
            disposeModel(d.mesh);
        }
        this.drops.clear();
        for (const { did, item, count, dmg, p: [x, y, z, qx, qy, qz, qw] } of save.list) {
            if (!(item in ITEMS) || count < 1)
                continue;
            this.add(did, item, count, new THREE.Vector3(x, y, z), new THREE.Quaternion(qx, qy, qz, qw), validDmg(item, dmg));
        }
        this.nextDid = Math.max(this.nextDid, save.next);
    }
    buildMesh(item) {
        if (item === 'wood') {
            return { mesh: woodPiece(), collider: RAPIER.ColliderDesc.convexHull(pieceHull), radius: PIECE_RADIUS };
        }
        const { model, half } = dropModel(item);
        return { mesh: model, collider: RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), radius: Math.min(half.x, half.y, half.z) };
    }
    add(did, item, count, pos, rotation, dmg) {
        const { mesh, collider, radius } = this.buildMesh(item);
        mesh.traverse((o) => {
            o.castShadow = true;
            o.receiveShadow = true;
        });
        this.world.add(mesh);
        const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation(rotation)
            .setLinearDamping(0.2)
            .setAngularDamping(0.8)
            .setCcdEnabled(true));
        this.physics.world.createCollider(collider.setCollisionGroups(COLLIDE.drop).setDensity(400).setFriction(0.8).setRestitution(0.2), body);
        this.physics.link(body, mesh);
        if (!SINKS.has(item))
            this.physics.addFloater(body, radius);
        mesh.position.copy(pos);
        mesh.quaternion.copy(rotation);
        this.drops.set(did, { did, item, count, dmg, mesh, body });
        this.nextDid = Math.max(this.nextDid, did + 1);
        return body;
    }
    fly(item, count, dmg, mesh, from) {
        if (!mesh.parent)
            this.world.add(mesh);
        mesh.position.copy(from);
        this.flyers.push({ item, count, dmg, mesh, from: from.clone(), time: 0 });
    }
    /** player はカメラ（目）の位置 */
    update(dt, player) {
        this.target.copy(player).y -= 0.6;
        for (let i = this.flyers.length - 1; i >= 0; i--) {
            const f = this.flyers[i];
            f.time += dt;
            const k = Math.min(f.time / FLY_TIME, 1);
            f.mesh.position.lerpVectors(f.from, this.target, k * k);
            f.mesh.position.y += Math.sin(k * Math.PI) * 0.6; // 少し弧を描く
            f.mesh.scale.setScalar(1 - k * 0.6);
            if (k >= 1) {
                f.mesh.removeFromParent();
                disposeModel(f.mesh);
                this.flyers.splice(i, 1);
                this.onCollect(f.item, f.count, f.dmg);
            }
        }
    }
}
