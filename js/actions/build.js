import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat, flatVertex, flatTransparent } from '../core/materials.js';
import { RAPIER, COLLIDE } from '../core/physics.js';
import { ITEMS } from '../items/inventory.js';
import { itemIcon } from '../items/itemIcons.js';
import { buildPlan, ingredients } from '../items/recipes.js';
import { CELL, PIECES, pieceDef } from './pieces.js';
import { BuildMenu } from './buildMenu.js';
import { terrainHeight } from '../world/terrain.js';
import { keyGuide } from '../ui/keyGuide.js';
const REACH = 7; // 視線の先、この距離まで置ける
const LAYER = 0.125; // 置く高さの刻み。部材の高さもこの倍数にして、積んだときに刻みからずれないようにする
const MATCH_HEIGHT = 0.75; // 地面に置くとき、隣の部材との高さの差がこれ以内ならそろえる
const PLATFORM_CLEAR = 0.03; // 床・土台を地面に置くとき、上面を地面のいちばん高い所からこれだけ上にする（地面が床から突き出して歩きにくくならないように）
const GROUND_SAMPLES = 4; // 部材の下の地面の高さを調べる点の数（1辺あたり。この数 + 1 の格子で調べる）
const NUDGE = 0.1; // 視線が当たった点を面から離す量（面がマスの境目にあるとき、どちらのマスか決まるように）
const MARGIN = 0.05; // 物との重なりを調べるとき、部材の箱をこれだけ縮める（接しているだけなら置ける）
const MIN_CHECK_H = 1; // 薄い部材も、この高さまでは物と重なっていないか調べる（木の幹は根元近くに当たり判定がない）
const GRASS_MARGIN = 0.3; // 地面に置いた部材のまわり、この幅まで草を隠す
const GRASS_CLEAR = 0.6; // 部材の底面が地面からこの高さ以内なら、下の草を隠す
const EPS = 0.01;
const POP_TIME = 0.15; // 置いたときにぽんと膨らむ時間
/** 叩いたときに耐久値を減らす量（部材の耐久値は pieces.ts の hp） */
const STRIKE_DAMAGE = { axe: 2, fist: 1 };
const SHAKE_TIME = 0.25; // 叩かれた部材が震える時間
const SHAKE_SCALE = 0.04; // 震えるときに縮む量（大きさに対する比）
const HIT_DEBRIS = 4; // 叩いたときに飛ぶ破片の数
const BREAK_DEBRIS = 26; // 壊れたときに飛ぶ破片の数
const DEBRIS_LIFE = 0.8; // 破片が消えるまでの時間
const GRAVITY = 18;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const debrisGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const snapCenter = (v) => Math.round(v / CELL) * CELL;
const yaw = (r) => new THREE.Quaternion().setFromAxisAngle(UP, (r * Math.PI) / 2);
/**
 * 部材が使うグリッドの枠。cell はマス、edge はマスの辺（X 方向の辺と Z 方向の辺は別の枠）。
 * 同じ枠で高さの範囲が重なる部材は置けない。違う枠どうし（床と、その縁の壁など）は重なってよい。
 * free の部材は枠を使わない（null。物とぶつからないかだけで置けるか決める）
 */
function slotKey(def, x, z, r) {
    if (def.snap === 'free')
        return null;
    if (def.snap === 'cell')
        return `c${Math.round(x / CELL)},${Math.round(z / CELL)}`;
    return r % 2 === 0
        ? `z${Math.round(x / CELL)},${Math.round((z - CELL / 2) / CELL)}`
        : `x${Math.round((x - CELL / 2) / CELL)},${Math.round(z / CELL)}`;
}
/**
 * 視線の先に部材を置く操作と、狙った部材を壊す操作。
 * ハンマーを持つと、右クリックのメニューで選んだ部材を素材から建てられ、X で壊すと素材が戻る。
 * 斧や素手で叩くと耐久値が減り、0 になると壊れる（素材は戻らない）。
 * 作業台と焚火はアイテムとして手に持って置く（ハンマーを作るのに作業台が要るので）。
 * 入力側（視線から置き場所を決めてリクエストを作る）と、適用側（apply：コマンドの値だけで世界を変える）を分けている
 */
export class Builder {
    world;
    camera;
    terrain;
    targets;
    blockers;
    physics;
    platforms;
    inventory;
    rotation = 0; // 90° 単位
    pieces = new Map();
    /** グリッドの枠ごとの部材 */
    slots = new Map();
    byMesh = new Map();
    /** 次に発行する部材の番号（ホストが発行する） */
    nextPid = 0;
    raycaster = new THREE.Raycaster();
    ghost;
    okMat = flatTransparent(PALETTE.grass, 0.55);
    ngMat = flatTransparent(PALETTE.accent, 0.55);
    spot = null;
    valid = false;
    hintEl;
    hintHtml = '';
    /** クロスヘアの右に出す、建てるのに使う素材 */
    costEl;
    costHtml = '';
    debris = [];
    /**
     * 共有ワールドへの頼みを出す。ひとりで遊ぶときはその場でホストとして確かめて適用し、できたら true を返す。
     * （マルチでは、ホストの返事を待つ形になる）
     */
    request = () => false;
    /** 部材が増えた・減ったときに呼ばれる */
    onChange = () => { };
    /** 自分が部材を建てた・壊したときに呼ばれる（ハンマーを振って見せる） */
    onWork = () => { };
    /** ハンマーで建てる部材を選ぶメニュー */
    menu;
    /** 建てられない場所（街）にいるか。建てた部材は自分の島にだけ置ける */
    disabled = false;
    /** 部材に入れてある物（焚火の燃料など）。ハンマーで解体すると、部材と一緒にインベントリへ戻る */
    contents = () => [];
    constructor(world, camera, terrain, 
    /** 視線が当たる物（地形・岩・桟橋など）。置いた部材はこの中に足していく */
    targets, 
    /** 視線をさえぎるが、上には置けない物（木・茂み） */
    blockers, physics, platforms, inventory) {
        this.world = world;
        this.camera = camera;
        this.terrain = terrain;
        this.targets = targets;
        this.blockers = blockers;
        this.physics = physics;
        this.platforms = platforms;
        this.inventory = inventory;
        this.raycaster.far = REACH;
        for (const m of [this.okMat, this.ngMat])
            m.depthWrite = false;
        this.ghost = new THREE.Mesh(PIECES[0].geometry, this.okMat);
        this.ghost.renderOrder = 10;
        this.ghost.visible = false;
        world.add(this.ghost);
        injectStyle();
        this.hintEl = document.createElement('div');
        this.hintEl.className = 'build-hint hidden';
        this.costEl = document.createElement('div');
        this.costEl.className = 'build-cost hidden';
        document.body.append(this.hintEl, this.costEl);
        this.menu = new BuildMenu(inventory);
        addEventListener('keydown', (e) => {
            if (document.pointerLockElement === null || inventory.isOpen)
                return;
            if (e.code === 'KeyR' && this.current)
                this.rotation = (this.rotation + 1) % 4;
            else if (e.code === 'KeyX' && this.hammer)
                this.dismantle();
        });
    }
    /** ハンマーを手に持っているか */
    get hammer() {
        return this.inventory.selectedStack?.item === 'hammer';
    }
    /** 今置こうとしている部材（ハンマーも部材のアイテムも持っていなければ null） */
    get current() {
        const held = this.inventory.selectedStack;
        if (!held)
            return null;
        if (held.item === 'hammer') {
            const plan = this.menu.plan;
            return { def: pieceDef(plan.piece), name: plan.name, plan };
        }
        const def = pieceDef(held.item);
        return def ? { def, name: ITEMS[held.item].name, plan: null } : null;
    }
    /** 建築中（ハンマーか部材を手に持っている）か */
    get active() {
        return !this.disabled && this.current !== null;
    }
    /** ハンマーで建てるのに必要な素材がそろっているか */
    affordable(plan) {
        return ingredients(plan).every(([item, n]) => this.inventory.count(item) >= n);
    }
    /** 視線の先、reach 以内にある部材（何もなければ null）。作業台を使うときに見る */
    aimedPiece(reach) {
        this.raycaster.setFromCamera(SCREEN_CENTER, this.camera);
        if (!this.builtInReach(reach))
            return null;
        const hit = this.raycaster.intersectObjects(this.targets, false)[0];
        const b = hit && hit.distance <= reach ? this.byMesh.get(hit.object) : undefined;
        if (!b)
            return null;
        const { x, y, z } = b.mesh.position;
        return { pid: b.pid, id: b.def.id, p: [x, y, z], r: b.r };
    }
    /** その番号の部材がまだあるか（使っている作業台が壊されたら閉じるのに使う） */
    has(pid) {
        return this.pieces.has(pid);
    }
    /** 置いてある、その種類の部材の一覧 */
    listOf(id) {
        const out = [];
        for (const b of this.pieces.values()) {
            if (b.def.id !== id)
                continue;
            const { x, y, z } = b.mesh.position;
            out.push({ pid: b.pid, id, p: [x, y, z], r: b.r });
        }
        return out;
    }
    /** その種類の部材が、島のどこかに1つでも置かれているか */
    hasKind(id) {
        for (const b of this.pieces.values())
            if (b.def.id === id)
                return true;
        return false;
    }
    // ---- 入力側：視線から置き場所を決めて、頼みを出す ----
    /** 視線の先に置けるなら置く。置けたら true */
    place() {
        const cur = this.disabled ? null : this.current;
        const spot = this.spot;
        if (!cur || !spot || !this.valid)
            return false;
        if (cur.plan && !this.affordable(cur.plan))
            return false;
        if (!this.request({ type: 'placePiece', id: cur.def.id, p: spot.p, r: spot.r }))
            return false;
        // 素材や部材のアイテムは自分のインベントリ（自分だけの状態）なので、置けたと決まってから減らす
        if (cur.plan)
            for (const [item, n] of ingredients(cur.plan))
                this.inventory.remove(item, n);
        else
            this.inventory.removeSelected(1);
        this.onWork();
        return true;
    }
    /** 狙っている部材を壊して、素材（作業台ならアイテム）に戻す。壊せたら true */
    dismantle() {
        this.raycaster.setFromCamera(SCREEN_CENTER, this.camera);
        const hit = this.raycaster.intersectObjects(this.targets, false)[0];
        const b = hit && this.byMesh.get(hit.object);
        if (!b)
            return false;
        const inside = this.contents(b.pid); // 取り除くと分からなくなるので、先に見ておく
        if (!this.request({ type: 'removePiece', pid: b.pid }))
            return false;
        // インベントリに入りきらなければ捨てる
        const plan = buildPlan(b.def.id);
        if (plan)
            for (const [item, n] of ingredients(plan))
                this.inventory.add(item, n);
        else if (b.def.id in ITEMS)
            this.inventory.add(b.def.id, 1);
        for (const s of inside)
            this.inventory.add(s.item, s.count, s.dmg);
        this.onWork();
        return true;
    }
    /** 視線の先、reach 以内の部材を叩く。木や茂みのほうが手前にあれば叩かない。部材に当たったら true */
    strike(tool, reach) {
        const b = this.aimedBuilt(reach);
        if (!b)
            return false;
        this.request({ type: 'hitPiece', pid: b.pid, tool });
        return true;
    }
    /** 視線の先、reach 以内にある傷ついた部材の耐久値（無傷か、何も狙っていなければ null） */
    durability(reach) {
        const b = this.aimedBuilt(reach);
        return b && b.damage > 0 ? { hp: b.def.hp - b.damage, max: b.def.hp } : null;
    }
    /**
     * 視線（setFromCamera 済み）が reach 以内でどれかの部材に当たるか。
     * 当たらなければ、地形などを含めた重い判定をしなくても「部材は狙っていない」と分かる（毎フレーム呼ばれるので）
     */
    builtInReach(reach) {
        if (this.byMesh.size === 0)
            return false;
        const hit = this.raycaster.intersectObjects([...this.byMesh.keys()], false)[0];
        return hit !== undefined && hit.distance <= reach;
    }
    /** 叩ける距離で、いちばん手前に見えている部材 */
    aimedBuilt(reach) {
        this.raycaster.setFromCamera(SCREEN_CENTER, this.camera);
        if (!this.builtInReach(reach))
            return null;
        const hit = this.raycaster.intersectObjects(this.targets, false)[0];
        const b = hit && hit.distance <= reach ? this.byMesh.get(hit.object) : undefined;
        if (!b)
            return null;
        const blockers = this.blockers.filter((o) => o.parent !== null && o.visible);
        const block = this.raycaster.intersectObjects(blockers, true)[0];
        return block && block.distance < hit.distance ? null : b;
    }
    /** 視線の先の置き場所。置けそうな面に当たっていなければ null */
    aim(def) {
        this.raycaster.setFromCamera(SCREEN_CENTER, this.camera);
        const hit = this.raycaster.intersectObjects(this.targets, false)[0];
        if (!hit)
            return null;
        // 木や茂みのほうが手前にあれば、その奥には置かない
        const blockers = this.blockers.filter((o) => o.parent !== null && o.visible);
        const block = this.raycaster.intersectObjects(blockers, true)[0];
        if (block && block.distance < hit.distance)
            return null;
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : UP.clone();
        const point = hit.point.clone().addScaledVector(normal, NUDGE);
        const on = this.byMesh.get(hit.object);
        if (def.snap === 'free')
            return this.aimFree(def, hit.point, normal, hit.object === this.terrain, on);
        // 同じマスの部材の上面を狙ったとき（床の上で床を選んでいるなど）は、上に重ねずに隣のマスへ広げる
        const extend = on !== undefined && on.def === def && def.snap === 'cell' && normal.y > 0.7;
        // ---- 横の位置と向き ----
        let x;
        let z;
        let r;
        if (def.snap === 'cell') {
            x = snapCenter(point.x);
            z = snapCenter(point.z);
            r = this.rotation;
            if (extend && on) {
                const dx = hit.point.x - on.mesh.position.x;
                const dz = hit.point.z - on.mesh.position.z;
                x = on.mesh.position.x + (Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) * CELL : 0);
                z = on.mesh.position.z + (Math.abs(dx) > Math.abs(dz) ? 0 : Math.sign(dz) * CELL);
            }
        }
        else {
            // 狙った点にいちばん近いマスの辺に置く。R は裏返し
            const cx = snapCenter(point.x);
            const cz = snapCenter(point.z);
            const dx = point.x - cx;
            const dz = point.z - cz;
            if (Math.abs(dx) > Math.abs(dz)) {
                x = cx + Math.sign(dx) * (CELL / 2);
                z = cz;
                r = 1;
            }
            else {
                x = cx;
                z = cz + (dz < 0 ? -1 : 1) * (CELL / 2);
                r = 0;
            }
            r = (r + (this.rotation % 2) * 2) % 4;
        }
        // ---- 高さ ----
        let y;
        if (on) {
            if (normal.y > 0.7 && !extend)
                y = on.baseY + on.def.height; // 上に積む
            else if (normal.y < -0.7)
                y = on.baseY - def.height; // 下に付ける
            else
                y = on.baseY; // 横に並べる
        }
        else {
            const ground = hit.object === this.terrain ? this.groundUnder(def, x, z, r) : hit.point.y;
            // 地形の上は近い刻みへ、岩や桟橋の上は埋まらないように上の刻みへそろえる
            y = hit.object === this.terrain ? Math.round(ground / LAYER) * LAYER : Math.ceil((ground - EPS) / LAYER) * LAYER;
            // 上に乗る部材（床・土台）は、上面から地面が突き出さない高さより下げない
            const minY = def.platform && hit.object === this.terrain
                ? Math.ceil((ground + PLATFORM_CLEAR - def.height - EPS) / LAYER) * LAYER
                : -Infinity;
            y = this.matchNeighbor(def, x, Math.max(y, minY), z, minY);
        }
        return { p: [x, y, z], r };
    }
    /**
     * free の部材（作業台・焚火）の置き場所：グリッドに沿わず、狙った点にそのまま置く。
     * 向きは他の部材と同じく R で 90° ずつ回す。上を向いた面にだけ置ける。部材の上は床・土台にだけ置ける（焚火に焚火を積まない）
     */
    aimFree(def, point, normal, onTerrain, on) {
        if (normal.y < 0.7 || (on && !on.def.platform))
            return null;
        const { x, z } = point;
        const r = this.rotation;
        let y;
        if (on)
            y = on.baseY + on.def.height; // 床などの上に乗せる
        else if (onTerrain)
            y = this.groundUnder(def, x, z, r);
        else
            y = point.y; // 岩や桟橋の上
        return { p: [x, y, z], r };
    }
    /** 部材の底面の範囲で、いちばん高い地面の高さ */
    groundUnder(def, x, z, r) {
        const hx = def.halfX - 0.1;
        const hz = def.halfZ - 0.1;
        const turn = (r * Math.PI) / 2;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        let top = -Infinity;
        for (let i = 0; i <= GROUND_SAMPLES; i++) {
            for (let j = 0; j <= GROUND_SAMPLES; j++) {
                // 部材の中の点を、部材の向きに回して地面の高さを調べる
                const lx = hx * ((2 * i) / GROUND_SAMPLES - 1);
                const lz = hz * ((2 * j) / GROUND_SAMPLES - 1);
                top = Math.max(top, terrainHeight(x + lx * cos + lz * sin, z - lx * sin + lz * cos));
            }
        }
        return top;
    }
    /** 隣に同じ置き方の部材があり、高さが近ければ、その高さにそろえる（地面の凹凸で床の段がずれないように）。minY より下にはそろえない */
    matchNeighbor(def, x, y, z, minY = -Infinity) {
        let best = y;
        let bestDiff = MATCH_HEIGHT + EPS;
        for (const b of this.pieces.values()) {
            if (b.def.snap !== def.snap)
                continue;
            if (Math.hypot(b.mesh.position.x - x, b.mesh.position.z - z) > CELL + EPS)
                continue;
            if (b.baseY < minY - EPS)
                continue;
            const diff = Math.abs(b.baseY - y);
            if (diff < bestDiff) {
                best = b.baseY;
                bestDiff = diff;
            }
        }
        return best;
    }
    // ---- ホスト側：頼みを確かめてコマンドにする ----
    /** 頼みを確かめ、ID を付けたコマンドにする。できない頼みなら null（マルチではホストだけが呼ぶ） */
    authorize(req) {
        if (req.type === 'placePiece') {
            const def = pieceDef(req.id);
            const wellFormed = Number.isInteger(req.r) && req.r >= 0 && req.r < 4 && req.p.length === 3 && req.p.every(Number.isFinite);
            if (!def || !wellFormed || !this.canPlace(def, req.p, req.r))
                return null;
            return { ...req, pid: this.nextPid++ };
        }
        if (!this.pieces.has(req.pid))
            return null;
        if (req.type === 'hitPiece') {
            const damage = STRIKE_DAMAGE[req.tool];
            return damage ? { type: 'hitPiece', pid: req.pid, damage } : null;
        }
        return req;
    }
    /** その場所・向きに部材を置けるか（他の部材と枠が重ならず、地形以外の物やプレイヤーにもぶつからない） */
    canPlace(def, [x, y, z], r) {
        const top = y + def.height;
        const key = slotKey(def, x, z, r);
        const list = key === null ? undefined : this.slots.get(key);
        if (list?.some((b) => y < b.baseY + b.def.height - EPS && b.baseY < top - EPS))
            return false;
        const rotation = yaw(r);
        const center = new THREE.Vector3();
        for (const [w, h, d, px, py, pz] of def.collision) {
            const checkH = Math.max(h, MIN_CHECK_H);
            center.set(px, py + checkH / 2, pz).applyQuaternion(rotation).add(new THREE.Vector3(x, y, z));
            const shape = new RAPIER.Cuboid(w / 2 - MARGIN, checkH / 2 - MARGIN, d / 2 - MARGIN);
            const terrain = this.physics.terrainCollider;
            const hit = this.physics.world.intersectionWithShape(center, rotation, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLIDE.placeQuery, undefined, undefined, (c) => c.handle !== terrain?.handle);
            if (hit)
                return false;
        }
        return true;
    }
    // ---- 適用側：コマンドの値だけで世界を変える（カメラや入力は見ない） ----
    apply(cmd) {
        if (cmd.type === 'placePiece') {
            const def = pieceDef(cmd.id);
            if (!def || this.pieces.has(cmd.pid))
                return;
            this.addPiece(cmd.pid, def, cmd.p, cmd.r, true);
        }
        else if (cmd.type === 'hitPiece') {
            const b = this.pieces.get(cmd.pid);
            if (!b)
                return;
            b.damage += cmd.damage;
            if (b.damage < b.def.hp) {
                b.shake = SHAKE_TIME;
                this.burst(b, HIT_DEBRIS);
                return; // 形は変わらないので onChange は呼ばない
            }
            this.burst(b, BREAK_DEBRIS);
            this.removePiece(cmd.pid);
        }
        else {
            this.removePiece(cmd.pid);
        }
        this.onChange();
    }
    serialize() {
        return {
            next: this.nextPid,
            pieces: [...this.pieces.values()].map(({ pid, def, mesh, r, damage }) => ({
                pid,
                id: def.id,
                p: [mesh.position.x, mesh.position.y, mesh.position.z],
                r,
                ...(damage > 0 ? { dmg: damage } : {}),
            })),
        };
    }
    restore(save) {
        for (const pid of [...this.pieces.keys()])
            this.removePiece(pid);
        for (const s of save.pieces) {
            const def = pieceDef(s.id);
            if (def)
                this.addPiece(s.pid, def, s.p, s.r, false, s.dmg ?? 0);
        }
        this.nextPid = Math.max(this.nextPid, save.next);
        this.onChange();
    }
    /** (x, z) の地面（高さ y）が、地面に置いたマスの部材で覆われているか（草を隠すのに使う） */
    covers(x, y, z) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const key = `c${Math.round((x + sx * GRASS_MARGIN) / CELL)},${Math.round((z + sz * GRASS_MARGIN) / CELL)}`;
            if (this.slots.get(key)?.some((b) => b.baseY - (b.def.legs ?? 0) - y < GRASS_CLEAR))
                return true;
        }
        return false;
    }
    /** pop：置いたときにぽんと膨らませるか。damage：減っている耐久値 */
    addPiece(pid, def, [x, y, z], r, pop, damage = 0) {
        r &= 3;
        const rotation = yaw(r);
        const mesh = new THREE.Mesh(def.looks[pid % def.looks.length], flatVertex()); // 板の並び方は部材の ID で選ぶ（誰の画面でも同じ）
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(x, y, z);
        mesh.quaternion.copy(rotation);
        if (def.details)
            mesh.add(def.details());
        mesh.updateMatrixWorld();
        this.world.add(mesh);
        // 当たり判定：部材ごとに動かない剛体を作り、箱（坂なら凸包）を付ける。壊すときは剛体ごと消す
        const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(rotation));
        const descs = def.hull
            ? [RAPIER.ColliderDesc.convexHull(def.hull)]
            : def.colliders.map(([w, h, d, px, py, pz]) => RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(px, py + h / 2, pz));
        for (const desc of descs)
            this.physics.world.createCollider(desc.setCollisionGroups(COLLIDE.piece).setFriction(0.8), body);
        let platform = null;
        if (def.platform) {
            const b = new THREE.Box3().setFromObject(mesh);
            platform = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, top: y + def.height };
            this.platforms.push(platform);
        }
        const slot = slotKey(def, x, z, r) ?? `f${pid}`; // free の部材は自分だけの枠に入れる
        const built = { pid, def, r, mesh, body, slot, baseY: y, platform, pop: pop ? 0 : 1, damage, shake: 0 };
        this.pieces.set(pid, built);
        this.slots.set(slot, [...(this.slots.get(slot) ?? []), built]);
        this.byMesh.set(mesh, built);
        this.targets.push(mesh);
        this.nextPid = Math.max(this.nextPid, pid + 1);
        if (pop)
            mesh.scale.setScalar(0.85); // 当たり判定は剛体に別に作ってあるので、見た目だけ膨らませる
    }
    removePiece(pid) {
        const b = this.pieces.get(pid);
        if (!b)
            return;
        this.pieces.delete(pid);
        b.mesh.removeFromParent();
        // 飾りは部材ごとに作ったものなので捨てる（部材本体のジオメトリは共有なので残す）
        for (const child of b.mesh.children)
            child.traverse((o) => o.geometry?.dispose());
        this.physics.world.removeRigidBody(b.body); // 付いているコライダーも消える
        const rest = this.slots.get(b.slot).filter((o) => o !== b);
        if (rest.length > 0)
            this.slots.set(b.slot, rest);
        else
            this.slots.delete(b.slot);
        this.byMesh.delete(b.mesh);
        remove(this.targets, b.mesh);
        if (b.platform)
            remove(this.platforms, b.platform);
    }
    /** 部材の箱の中から、部材の色の破片を飛ばす（Math.random は自分の画面だけの演出なので使ってよい） */
    burst(b, count) {
        const box = new THREE.Box3().setFromObject(b.mesh);
        const size = box.getSize(new THREE.Vector3());
        for (let n = 0; n < count; n++) {
            const mesh = new THREE.Mesh(debrisGeo, flat(b.def.color));
            mesh.position.set(box.min.x + Math.random() * size.x, box.min.y + Math.random() * size.y, box.min.z + Math.random() * size.z);
            mesh.scale.setScalar(0.6 + Math.random() * 1.2);
            const velocity = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
            this.world.add(mesh);
            this.debris.push({ mesh, velocity, life: DEBRIS_LIFE * (0.7 + Math.random() * 0.5) });
        }
    }
    update(dt) {
        for (const b of this.pieces.values()) {
            if (b.pop >= 1 && b.shake <= 0)
                continue;
            b.pop = Math.min(b.pop + dt / POP_TIME, 1);
            let scale = 0.85 + 0.15 * Math.sin((b.pop * Math.PI) / 2) + 0.06 * Math.sin(b.pop * Math.PI);
            if (b.shake > 0) {
                // 叩かれると小刻みに縮んで戻る（当たり判定は剛体に別に作ってあるので、見た目だけ）
                b.shake = Math.max(b.shake - dt, 0);
                const k = b.shake / SHAKE_TIME;
                scale *= 1 - SHAKE_SCALE * k * Math.abs(Math.sin(k * Math.PI * 4));
            }
            b.mesh.scale.setScalar(scale);
        }
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i];
            d.life -= dt;
            if (d.life <= 0) {
                d.mesh.removeFromParent();
                this.debris.splice(i, 1);
                continue;
            }
            d.velocity.y -= GRAVITY * dt;
            d.mesh.position.addScaledVector(d.velocity, dt);
            d.mesh.rotation.x += dt * 8;
            d.mesh.rotation.z += dt * 6;
        }
        // ハンマーを持ち替えたら、部材を選ぶメニューも閉じる
        if (this.menu.isOpen && !this.hammer)
            this.menu.setOpen(false, false);
        const cur = this.disabled ? null : this.current;
        this.ghost.visible = false;
        this.spot = null;
        if (!cur || this.inventory.isOpen || document.pointerLockElement === null) {
            this.hintEl.classList.add('hidden');
            this.costEl.classList.add('hidden');
            return;
        }
        this.updateHint(cur);
        this.hintEl.classList.remove('hidden');
        this.updateCost(cur.plan);
        const { def } = cur;
        const spot = this.aim(def);
        if (!spot)
            return;
        this.spot = spot;
        this.ghost.geometry = def.geometry;
        this.ghost.position.set(...spot.p);
        this.ghost.quaternion.copy(yaw(spot.r));
        this.ghost.visible = true;
        this.valid = this.canPlace(def, spot.p, spot.r);
        // 素材が足りないときも赤く見せる（置く場所の判定とは別）
        const ok = this.valid && (!cur.plan || this.affordable(cur.plan));
        this.ghost.material = ok ? this.okMat : this.ngMat;
    }
    updateHint({ def, name, plan }) {
        const turn = def.snap === 'edge' ? '[R]：裏返す' : '[R]：回転';
        const html = plan
            ? `<b>${name}</b><br>` +
                `[左]：建てる ／ [右]：部材を選ぶ ／ ${turn} ／ [X]：狙った部材を解体（素材が戻る）`
            : `<b>${name}</b>　<span class="build-hint-count">のこり ${this.inventory.count(def.id)}</span><br>` +
                `[左]：設置 ／ ${turn}（壊すときはハンマーで [X]）`;
        if (html === this.hintHtml)
            return; // 変わったときだけ書き換える
        this.hintHtml = html;
        this.hintEl.innerHTML = keyGuide(html);
    }
    /** 使う素材をアイコンと「持っている数/使う数」でクロスヘアの右に出す（足りない素材は赤くする） */
    updateCost(plan) {
        this.costEl.classList.toggle('hidden', !plan);
        if (!plan)
            return;
        const html = ingredients(plan)
            .map(([item, n]) => {
            const have = this.inventory.count(item);
            return (`<div class="build-cost-row${have < n ? ' short' : ''}">` +
                `<img src="${itemIcon(item)}" alt="" draggable="false"><span>${have}/${n}</span></div>`);
        })
            .join('');
        if (html === this.costHtml)
            return; // 変わったときだけ書き換える
        this.costHtml = html;
        this.costEl.innerHTML = html;
    }
}
function remove(list, item) {
    const i = list.indexOf(item);
    if (i >= 0)
        list.splice(i, 1);
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .build-hint {
      position: fixed; left: 50%; bottom: calc(96 * var(--u)); transform: translateX(-50%); pointer-events: none;
      padding: calc(6 * var(--u)) calc(14 * var(--u)); border-radius: calc(8 * var(--u)); background: rgba(43, 38, 51, 0.55);
      color: #fff; font-size: calc(13 * var(--u)); text-align: center; line-height: 1.5; white-space: nowrap;
    }
    .build-hint b { font-size: calc(15 * var(--u)); }
    .build-hint.hidden { display: none; }
    .build-cost {
      position: fixed; left: 50%; top: 50%; transform: translate(calc(22 * var(--u)), -50%); pointer-events: none;
      display: flex; flex-direction: column; gap: calc(3 * var(--u));
      padding: calc(5 * var(--u)) calc(9 * var(--u)) calc(5 * var(--u)) calc(6 * var(--u));
      border-radius: calc(8 * var(--u)); background: rgba(43, 38, 51, 0.55);
    }
    .build-cost.hidden { display: none; }
    .build-cost-row {
      display: flex; align-items: center; gap: calc(5 * var(--u));
      color: #fff; font-size: calc(17 * var(--u)); font-weight: 700; line-height: 1;
      text-shadow: 0 calc(1 * var(--u)) 0 #2b2633;
    }
    .build-cost-row img { width: calc(28 * var(--u)); height: calc(28 * var(--u)); }
    .build-cost-row.short { color: ${css(PALETTE.accent)}; }
  `;
    document.head.append(style);
}
