import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { RAPIER, COLLIDE, hullDesc } from '../core/physics.js';
const REACH = 3.2; // 斧が届く距離
const LOG_REACH = 4.2; // 地面に横たわる丸太は少し遠くまで届く
const TREE_HP = 4; // 何回叩くと倒れるか
const LOG_HP = 3; // 倒れた丸太を何回叩くとばらせるか
const TOPPLE_SPIN = 0.9; // 倒れ始めの回転速度（あとは重力で倒れる）
const HINGE_RELEASE = 1.4; // 根元の支点を外す傾き（rad）。このとき葉が地面に着いたとみなす
const LANDING_DAMP = 0.25; // 葉が地面に着いて勢いが削がれる（速度に掛ける）
const SETTLE_TIME = 1.2; // 倒れ始めてから、葉が縮み始めるまでの最短時間
const SETTLE_TILT = 0.8; // これ以上傾いて止まったら「倒れきった」とみなす（rad）
const SETTLE_TIMEOUT = 4; // 引っかかって止まらなくても葉を消し始める時間
const LOG_HIT = { hop: 0.7, push: 0.05 }; // 丸太を叩いたときの跳ね上がり・押し出し（速度 m/s）
const LOG_DAMPING = { linear: 0.4, angular: 2.5 }; // 丸太が坂を転がり続けないように
const LEAF_SHRINK_TIME = 0.5;
const BREAK_TIME = 0.25; // 丸太がばらけて消えるまで
const CROWN_MASS = 1.2; // 葉の重さ（幹の何倍か）。当たり判定はないが、重心を高くして倒れやすくする
const TRUNK_FLOOR = 0.25; // 幹の当たり判定は根元からこの高さより上（地面に埋まった部分を除く）
const CHIP_COUNT = 6;
const PUNCH_CHIP_COUNT = 2; // 素手で殴ったときの木くず
const BREAK_CHIP_COUNT = 18;
const UP = new THREE.Vector3(0, 1, 0);
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const chipGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
/** 斧で木を叩いて切り倒し、倒れた丸太をばらして木材にする */
export class TreeChopper {
    world;
    physics;
    states = new Map();
    /** セーブデータでの木の並び（props の生成順） */
    order;
    raycaster = new THREE.Raycaster();
    chips = [];
    q = new THREE.Quaternion();
    /** 丸太をばらしたときに呼ばれる（幹のメッシュと、散らばる木材の数） */
    onSplit = () => { };
    constructor(world, trees, physics) {
        this.world = world;
        this.physics = physics;
        this.order = trees.map((t) => t.object);
        const frame = new THREE.Matrix4();
        for (const tree of trees) {
            const obj = tree.object;
            // 剛体の原点は根元。拡大率はコライダーの形に焼き込む。葉には当たり判定を付けない
            const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
                .setTranslation(obj.position.x, obj.position.y, obj.position.z)
                .setRotation(obj.quaternion)
                .setAngularDamping(0.4));
            frame.compose(obj.position, obj.quaternion, new THREE.Vector3(1, 1, 1)).invert();
            physics.world.createCollider(hullDesc(tree.trunk, frame, TRUNK_FLOOR).setCollisionGroups(COLLIDE.wood).setFriction(0.9).setDensity(500), body);
            this.states.set(obj, {
                tree,
                phase: 'standing',
                body,
                hinge: null,
                base: obj.quaternion.clone(),
                baseScale: obj.scale.x,
                leafScales: tree.leaves.map((l) => l.scale.x),
                hp: TREE_HP,
                axis: new THREE.Vector3(),
                time: 0,
                shrinking: -1,
            });
        }
        this.raycaster.far = LOG_REACH;
    }
    /** 画面中央の先にある木・丸太を叩く。当たったら true */
    chop(camera) {
        const target = this.aim(camera);
        if (!target)
            return false;
        const { obj, s, hit, away } = target;
        if (s.phase === 'standing' && hit.distance > REACH)
            return false;
        this.spawnChips(hit.point, away, CHIP_COUNT);
        s.hp--;
        if (s.phase === 'log') {
            if (s.hp > 0) {
                // 重心ごと小さく跳ねるだけにする（叩いた点に押すと回って転がっていく）
                const m = s.body.mass();
                s.body.applyImpulse({ x: away.x * m * LOG_HIT.push, y: m * LOG_HIT.hop, z: away.z * m * LOG_HIT.push }, true);
                return true;
            }
            this.breakLog(obj, s, away);
            return true;
        }
        if (s.hp > 0)
            return true;
        // 叩いた向きの奥へ倒れるようにする
        s.axis.crossVectors(UP, away).normalize();
        this.topple(obj, s);
        return true;
    }
    /** 素手で殴る。木は傷つかず、木くずが少し飛ぶだけ（自分の画面だけの演出）。当たったら true */
    punch(camera, reach) {
        const target = this.aim(camera);
        if (!target || target.hit.distance > reach)
            return false;
        this.spawnChips(target.hit.point, target.away, PUNCH_CHIP_COUNT);
        return true;
    }
    /** 画面中央の先にある、立っている木か丸太 */
    aim(camera) {
        this.raycaster.setFromCamera(SCREEN_CENTER, camera);
        const targets = [];
        for (const [obj, s] of this.states)
            if (s.phase === 'standing' || s.phase === 'log')
                targets.push(obj);
        const hit = this.raycaster.intersectObjects(targets, true)[0];
        if (!hit)
            return null;
        let obj = hit.object;
        while (obj && !this.states.has(obj))
            obj = obj.parent;
        if (!obj)
            return null;
        const away = this.raycaster.ray.direction.clone().setY(0).normalize();
        return { obj, s: this.states.get(obj), hit, away };
    }
    update(dt) {
        for (const [obj, s] of this.states) {
            s.time += dt;
            if (s.phase === 'falling')
                this.updateFalling(s, dt);
            else if (s.phase === 'breaking') {
                const k = s.time / BREAK_TIME;
                if (k >= 1) {
                    obj.removeFromParent();
                    this.states.delete(obj);
                }
                else {
                    obj.scale.setScalar(s.baseScale * (1 - k));
                }
            }
        }
        for (let i = this.chips.length - 1; i >= 0; i--) {
            const c = this.chips[i];
            c.life -= dt;
            if (c.life <= 0) {
                c.mesh.removeFromParent();
                this.chips.splice(i, 1);
                continue;
            }
            c.velocity.y -= 18 * dt;
            c.mesh.position.addScaledVector(c.velocity, dt);
            c.mesh.rotation.x += dt * 9;
            c.mesh.rotation.z += dt * 7;
        }
    }
    serialize() {
        return this.order.map((obj) => {
            const s = this.states.get(obj);
            if (!s || s.phase === 'breaking')
                return null;
            if (s.phase === 'standing')
                return { hp: s.hp };
            // 倒れている途中の木は、その場で丸太になったものとして保存する
            const t = s.body.translation();
            const r = s.body.rotation();
            return { hp: s.phase === 'log' ? s.hp : LOG_HP, log: [t.x, t.y, t.z, r.x, r.y, r.z, r.w] };
        });
    }
    /** 生成直後（すべて立っている状態）に呼ぶ */
    restore(saves) {
        this.order.forEach((obj, i) => {
            const s = this.states.get(obj);
            const save = saves[i];
            if (!s || save === undefined)
                return;
            if (save === null) {
                obj.removeFromParent();
                this.physics.removeBody(s.body);
                this.states.delete(obj);
                return;
            }
            s.hp = save.hp;
            if (!save.log)
                return;
            const [x, y, z, qx, qy, qz, qw] = save.log;
            s.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            s.body.setTranslation({ x, y, z }, true);
            s.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
            s.body.setLinearDamping(LOG_DAMPING.linear);
            s.body.setAngularDamping(LOG_DAMPING.angular);
            obj.position.set(x, y, z);
            obj.quaternion.set(qx, qy, qz, qw);
            s.tree.crown.removeFromParent();
            for (const leaf of s.tree.leaves)
                leaf.removeFromParent();
            this.physics.link(s.body, obj);
            this.physics.addFloater(s.body, 0.5);
            s.phase = 'log';
        });
    }
    /** 幹の根元の、倒れる側の縁を支点にして、重力で倒れる剛体にする */
    topple(obj, s) {
        s.phase = 'falling';
        s.time = 0;
        // まとめて描いていた葉を、1つずつ縮められる元の部品に戻す
        s.tree.crown.removeFromParent();
        for (const leaf of s.tree.leaves)
            leaf.visible = true;
        const { world } = this.physics;
        s.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.addCrownMass(s);
        // 縁を中心に回れば幹の底面は持ち上がる側にしか動かないので、地面との接触を残したまま倒せる
        const pivot = this.pivotPoint(s);
        s.hinge = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pivot.x, pivot.y, pivot.z));
        const local = pivot.clone().sub(obj.position).applyQuaternion(s.base.clone().invert());
        world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, local), s.hinge, s.body, true);
        // 支点を中心に回り始める（重心の速度も回転に合わせる）
        const spin = s.axis.clone().multiplyScalar(TOPPLE_SPIN);
        const com = s.body.worldCom();
        const v = spin.clone().cross(new THREE.Vector3(com.x - pivot.x, com.y - pivot.y, com.z - pivot.z));
        s.body.setAngvel(spin, true);
        s.body.setLinvel(v, true);
        this.physics.link(s.body, obj);
        this.physics.addFloater(s.body, 0.5);
    }
    updateFalling(s, dt) {
        const { body } = s;
        if (s.shrinking < 0) {
            const v = body.linvel();
            const w = body.angvel();
            const still = Math.hypot(v.x, v.y, v.z) < 0.6 && Math.hypot(w.x, w.y, w.z) < 0.6;
            const r = body.rotation();
            const tilt = s.base.angleTo(this.q.set(r.x, r.y, r.z, r.w));
            const settled = (s.time > SETTLE_TIME && still && tilt > SETTLE_TILT) || s.time > SETTLE_TIMEOUT;
            if (s.hinge && (settled || tilt > HINGE_RELEASE)) {
                this.physics.world.removeRigidBody(s.hinge); // つながっていたジョイントも消える
                s.hinge = null;
                // 葉が地面に着いたものとして重さを外し、勢いを殺す（重さだけ残すと丸太が跳ね回る）
                body.setAdditionalMass(0, true);
                const lv = body.linvel();
                const av = body.angvel();
                body.setLinvel({ x: lv.x * LANDING_DAMP, y: lv.y * LANDING_DAMP, z: lv.z * LANDING_DAMP }, true);
                body.setAngvel({ x: av.x * LANDING_DAMP, y: av.y * LANDING_DAMP, z: av.z * LANDING_DAMP }, true);
            }
            if (settled) {
                // 倒れきったら葉を縮めていく
                s.shrinking = 0;
                body.setLinearDamping(LOG_DAMPING.linear);
                body.setAngularDamping(LOG_DAMPING.angular);
            }
            return;
        }
        s.shrinking += dt;
        const k = Math.min(s.shrinking / LEAF_SHRINK_TIME, 1);
        const f = 1 - k * k;
        s.tree.leaves.forEach((leaf, i) => leaf.scale.setScalar(s.leafScales[i] * f));
        if (k >= 1) {
            for (const leaf of s.tree.leaves)
                leaf.removeFromParent();
            s.phase = 'log';
            s.hp = LOG_HP;
            s.time = 0;
        }
    }
    /** 葉の位置に、当たり判定のない重さだけを足す */
    addCrownMass(s) {
        const { object, leaves } = s.tree;
        const box = new THREE.Box3();
        for (const leaf of leaves)
            box.expandByObject(leaf);
        const frame = new THREE.Matrix4().compose(object.position, s.base, new THREE.Vector3(1, 1, 1)).invert();
        box.applyMatrix4(frame); // 剛体（根元）基準にする
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const mass = s.body.mass() * CROWN_MASS;
        const inertia = (a, b) => (mass * (a * a + b * b)) / 12; // 直方体として近似
        s.body.setAdditionalMassProperties(mass, center, { x: inertia(size.y, size.z), y: inertia(size.x, size.z), z: inertia(size.x, size.y) }, { x: 0, y: 0, z: 0, w: 1 }, true);
    }
    /** 幹の当たり判定の底面のうち、倒れる向きにいちばん出っ張った点 */
    pivotPoint(s) {
        const { trunk, object } = s.tree;
        const away = new THREE.Vector3().crossVectors(s.axis, UP); // axis = UP × away なので
        const pos = trunk.geometry.getAttribute('position');
        const p = new THREE.Vector3();
        let best = 0;
        trunk.updateWorldMatrix(true, false);
        for (let i = 0; i < pos.count; i++) {
            p.fromBufferAttribute(pos, i).applyMatrix4(trunk.matrixWorld).sub(object.position);
            if (p.y < TRUNK_FLOOR + 0.3)
                best = Math.max(best, p.dot(away)); // 根元付近の頂点だけ見る
        }
        return object.position.clone().addScaledVector(away, best).add(new THREE.Vector3(0, TRUNK_FLOOR, 0));
    }
    breakLog(obj, s, away) {
        // 丸太全体から木くずを散らしてばらす
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        for (let n = 0; n < BREAK_CHIP_COUNT; n++) {
            const p = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * size.x, (Math.random() - 0.5) * size.y, (Math.random() - 0.5) * size.z));
            this.spawnChips(p, away, 1);
        }
        this.onSplit(s.tree.trunk, s.tree.wood);
        this.physics.removeBody(s.body);
        s.phase = 'breaking';
        s.time = 0;
    }
    /** 叩いた場所から木くずを飛ばす（手前側へ） */
    spawnChips(point, away, count) {
        for (let n = 0; n < count; n++) {
            const mesh = new THREE.Mesh(chipGeo, flat(PALETTE.trunk));
            mesh.position.copy(point);
            mesh.scale.setScalar(0.6 + Math.random() * 0.8);
            const velocity = away.clone().multiplyScalar(-2 - Math.random() * 2);
            velocity.x += (Math.random() - 0.5) * 3;
            velocity.z += (Math.random() - 0.5) * 3;
            velocity.y = 2 + Math.random() * 3;
            this.world.add(mesh);
            this.chips.push({ mesh, velocity, life: 0.6 + Math.random() * 0.3 });
        }
    }
}
