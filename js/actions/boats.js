import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flatTransparent } from '../core/materials.js';
import { RAPIER, COLLIDE, WATER_LEVEL } from '../core/physics.js';
import { waveOffset } from '../core/waves.js';
import { BOAT_H, BOAT_SEAT, buildBoatModel, buildBoatOpening } from '../items/itemModels.js';
import { WORLD_SIZE, islandField, terrainHeight } from '../world/terrain.js';
import { townField } from '../world/town.js';
import { LOCATIONS, toLocation } from '../world/location.js';
const BOAT_SCALE = 3.2; // アイテムのモデル（長さ 1）を何倍にして浮かべるか（長さ約 3.2、人が2人乗れるくらい）
const DRAFT = 0.28; // 船底が水面より沈む深さ
const MIN_DEPTH = 0.45; // 船の下の水の深さがこれ以上ないと浮かべられない（波の谷で底に着かないように）
const PLACE_REACH = 7; // 視線の先、この距離までの水面に浮かべられる
const PICK_REACH = 3.5; // F でしまえる距離
const TILT = 0.7; // 波の傾きにどれだけ合わせて船を傾けるか（1 で水面の傾きそのまま）
const DEPTH_SAMPLES = 4; // 船の下の深さを調べる点の数（長さ・幅それぞれ。この数 + 1 の格子で調べる）
const HULL_SHRINK = 0.85; // 当たり判定の箱を、見た目の箱よりこれだけ細くする（両端がとがっているので）
const CHECK_H = 1.2; // 浮かべるとき、水面からこの高さまでに物（泳いでいるプレイヤーなど）がないか調べる
const ROW_SPEED = 4; // 漕いで進む速さ（m/s）
const ROW_FAST = 6.5; // Shift を押して力いっぱい漕ぐ速さ
const BACK_SPEED = 2; // 後ろへ漕ぐ速さ
const ROW_ACCEL = 1.2; // 速さが目標の速さに近づく速さ（大きいほどすぐ加速・減速する。水の上なので小さめ）
const TURN_SPEED = 1.1; // 向きを変える速さ（rad/s）
const TURN_ACCEL = 4; // 向きを変える速さが目標に近づく速さ
const BUMP_SLOW = 3; // 岸や岩をこすって進むときに速さが落ちる割合（毎秒）
const MOVE_DEPTH = DRAFT + 0.04; // 漕いで進める水の深さの下限（これより浅い所には乗り上げずに止まる）
const MOVE_CLEAR = 0.5; // 漕いで進むとき、水面からこの高さまでに物がないか調べる（低い桟橋の下はくぐれない）
const MOVE_BOUND = WORLD_SIZE / 2 - 6; // 世界の端からこれだけ内側までしか漕いでいけない
const SIT_EYE = 0.8; // 座ったときの、座り板から目までの高さ
const STEP_OFF = 0.8; // 船から降りるとき、船の縁からこれだけ離れた所に降りる
const LAND_MIN = -0.6; // 降りる先の地面が水面からこの高さより上なら、そこに立つ（それより深ければ水に降りる）
const SWIM_FEET = -1.3; // 水に降りるときの、水面からの足元の高さ
const MAP_EDGE = WORLD_SIZE / 2 - 10; // ここより外へ漕ぎ出すと海図を開く（MOVE_BOUND より内側）
const EDGE_RESET = 4; // 海図を閉じたあと、MAP_EDGE よりこれだけ内側へ戻るまでは、また開かない
const ARRIVE_OUT = WORLD_SIZE / 2 - 18; // 別の場所へ渡ったとき、その場所の中心からこれだけ離れた沖に着く（MAP_EDGE - EDGE_RESET より内側）
const ARRIVE_GAP = 5; // 着いた所にほかの船があれば、これだけ横にずらす
const ARRIVE_CLEAR = 4.5; // 着いた所から、ほかの船の中心がこれより近ければ重なるとみなす
const STEP_LIFT = 0.2; // 降りるとき、足元を地面からこれだけ浮かせて置く（斜面に体が引っかからないように。すぐ着地する）
const SCREEN_CENTER = new THREE.Vector2(0, 0);
/** 浮かべた船の大きさ（アイテムのモデルを拡大した見た目から測る） */
const SIZE = (() => {
    const model = buildBoatModel();
    model.scale.setScalar(BOAT_SCALE);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.traverse((o) => o.geometry?.dispose());
    return { halfL: size.x / 2, halfW: size.z / 2, height: size.y, centerY: center.y };
})();
/** 場所ごとの地形（今いない場所の浅瀬を調べるのに使う） */
const FIELDS = { island: islandField, town: townField };
/** 水面から、船のモデルの原点までの高さ（船底が DRAFT だけ沈む） */
const FLOAT_Y = SIZE.height / 2 - SIZE.centerY - DRAFT;
/** 船の局所座標（舳先が +X、右舷が +Z）の点を、世界の水平位置にする */
function toWorld(x, z, yaw, lx, lz) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [x + lx * c + lz * s, z - lx * s + lz * c];
}
/** (x, z) に yaw の向きで浮かぶ船の、波に合わせた位置と向き（波は時刻から決まるので、誰の画面でも同じ動きになる） */
function floatPose(x, z, yaw, pos, rot) {
    const at = (lx, lz) => waveOffset(...toWorld(x, z, yaw, lx, lz));
    const bow = at(SIZE.halfL, 0);
    const stern = at(-SIZE.halfL, 0);
    const right = at(0, SIZE.halfW);
    const left = at(0, -SIZE.halfW);
    const mid = (waveOffset(x, z) * 2 + bow + stern + right + left) / 6;
    const pitch = Math.atan2(bow - stern, SIZE.halfL * 2) * TILT; // 舳先が上がると +Z まわり
    const roll = Math.atan2(right - left, SIZE.halfW * 2) * TILT; // 右舷が上がると -X まわり
    pos.set(x, WATER_LEVEL + mid + FLOAT_Y, z);
    rot.setFromEuler(new THREE.Euler(-roll, yaw, pitch, 'YXZ'));
}
/**
 * 船の中に海の水面が見えないようにする蓋の材質。色は描かずに奥行きだけを書き込む。
 * 海（半透明）より先に描くので、船の中では海の水面が蓋に隠れて描かれない（船の中の物は先に描き終わっている）
 */
const lidMat = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, side: THREE.DoubleSide });
/** 浮かべた船の見た目。影を落とす。lid なら船の口に見えない蓋をして、中に海の水面が見えないようにする */
function boatObject(lid) {
    const g = new THREE.Group();
    const model = buildBoatModel();
    model.scale.setScalar(BOAT_SCALE);
    model.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
    });
    if (lid) {
        const cover = new THREE.Mesh(buildBoatOpening(), lidMat);
        cover.renderOrder = -1; // 海（renderOrder 0）より先に描く
        model.add(cover);
    }
    g.add(model);
    return g;
}
/**
 * 水に浮かべた木製の船（共有ワールド）。船を手に持って左クリックで視線の先の水面に浮かべる。
 * 船を見て F で乗り、W/S で漕いで A/D で向きを変え、F で降りる。Q でしまう。
 * 乗ったまま世界の端まで漕いでいくと海図を開き、ほかの場所（島・街）へ船ごと渡れる。船はどれか1つの場所に浮かんでいる。
 * 浮かんでいる船は波の式から揺れ方を決めるので、物理の計算はせず、ホストから揺れを配る必要もない。
 * 漕いでいる間の船の位置は、プレイヤーの位置と同じく乗っている人が決め（マルチでは他の人に配る）、降りたときにワールドコマンドで書き込む。
 * 入力側（視線から場所を決めて頼みを出す）と、適用側（apply：コマンドの値だけで世界を変える）を分けている
 */
export class Boats {
    world;
    camera;
    physics;
    targets;
    inventory;
    boats = new Map();
    /** 次に発行する船の番号（ホストが発行する） */
    nextBid = 0;
    raycaster = new THREE.Raycaster();
    ghost = boatObject(false); // 見本は半透明なので、蓋をしない
    okMat = flatTransparent(PALETTE.grass, 0.55);
    ngMat = flatTransparent(PALETTE.accent, 0.55);
    spot = null;
    blocked = null;
    pos = new THREE.Vector3();
    rot = new THREE.Quaternion();
    /** 自分が乗っている船（乗っていなければ null） */
    ride = null;
    keys = new Set();
    /** プレイヤーが今いる場所（この場所の船だけを描き、当たり判定を付ける） */
    location = 'island';
    /** 世界の端に着いたら海図を開いてよいか（開いたあと、少し内側へ戻るまでは開かない） */
    edgeReady = true;
    /** 乗っている船で世界の端まで漕いでいったときに呼ばれる（main が海図を開く） */
    onEdge = () => { };
    /** 共有ワールドへの頼みを出す（main が設定する）。適用できたら true */
    request = () => false;
    /** 自分の乗っている船が別の場所へ渡り終えたときに呼ばれる（main がプレイヤーの場所を切り替える） */
    onSail = () => { };
    constructor(world, camera, physics, 
    /** 視線をさえぎる物（地形・岩・桟橋・建てた部材など） */
    targets, inventory) {
        this.world = world;
        this.camera = camera;
        this.physics = physics;
        this.targets = targets;
        this.inventory = inventory;
        for (const m of [this.okMat, this.ngMat])
            m.depthWrite = false;
        this.ghost.traverse((o) => {
            o.castShadow = false;
            o.receiveShadow = false;
            o.renderOrder = 10;
        });
        this.ghost.visible = false;
        world.add(this.ghost);
        addEventListener('keydown', (e) => this.keys.add(e.code));
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
    }
    /** 船に乗っているか */
    get riding() {
        return this.ride !== null;
    }
    /** 乗っている船の番号（乗っていなければ null。セーブに入れて、ロードしたときに乗り直す） */
    get ridingBid() {
        return this.ride?.bid ?? null;
    }
    /** 船に乗っているときに出す操作の案内 */
    get rideHint() {
        return '[W]/[S]：漕ぐ ／ [A]/[D]：向きを変える ／ [Shift]：力いっぱい漕ぐ ／ [F]：降りる';
    }
    /** 船の剛体か（別の場所へ移るとき、ほかの剛体と一緒に止めないように） */
    owns(body) {
        for (const b of this.boats.values())
            if (b.body === body)
                return true;
        return false;
    }
    /** プレイヤーが別の場所へ移ったときに呼ぶ。その場所の船だけを見せ、当たり判定を付ける */
    setLocation(loc) {
        this.location = loc;
        for (const b of this.boats.values())
            this.refresh(b);
    }
    /** 船がプレイヤーのいる場所にあれば見せて当たり判定を付け、なければ隠して当たり判定を止める */
    refresh(b) {
        const here = b.loc === this.location;
        b.object.visible = here;
        b.body.setEnabled(here);
    }
    /** 乗っている船で、別の場所 loc へ渡る頼みを出す。渡り終えたら onSail が呼ばれる（そこで main がプレイヤーの場所を切り替える） */
    sail(loc) {
        const b = this.ride && this.boats.get(this.ride.bid);
        return !!b && this.request({ type: 'sailBoat', bid: b.bid, loc });
    }
    /** 乗っている船の番号と、漕いで動かした位置・向き [番号, x, z, yaw]（マルチで他の人に配る。乗っていなければ null） */
    get ridePose() {
        const b = this.ride && this.boats.get(this.ride.bid);
        return b ? [b.bid, b.x, b.z, b.yaw] : null;
    }
    /** ほかの人が漕いでいる船の位置・向きを、その人から届いた値にする（自分が乗っている船は自分で動かすので変えない） */
    follow(bid, x, z, yaw) {
        const b = this.boats.get(bid);
        if (!b || this.ride?.bid === bid || ![x, z, yaw].every(Number.isFinite))
            return;
        b.x = x;
        b.z = z;
        b.yaw = yaw;
    }
    /** その人が乗っている船（ホストが、抜けた人の船を降ろすのに使う） */
    riddenBy(id) {
        return [...this.boats.values()].filter((b) => b.rider === id).map((b) => ({ bid: b.bid, p: [b.x, b.z], yaw: b.yaw }));
    }
    /** 乗る頼みをホストに断られたとき（先に誰かが乗った）、乗ったことを取り消す */
    cancelRide(bid) {
        if (this.ride?.bid === bid)
            this.ride = null;
    }
    /** 乗っている船の舳先が向いている向きを、カメラの水平の向き（0 で -Z を向く）にしたもの（乗っていなければ null） */
    get heading() {
        const b = this.ride && this.boats.get(this.ride.bid);
        return b ? b.yaw - Math.PI / 2 : null; // 舳先は yaw 0 で +X を向く
    }
    /** 乗っている船の座り板に座ったときの目の位置（船の揺れに合わせて動く） */
    seatEye(out) {
        const b = this.ride && this.boats.get(this.ride.bid);
        if (!b)
            return out;
        out.copy(BOAT_SEAT).multiplyScalar(BOAT_SCALE);
        out.y += SIT_EYE;
        return out.applyQuaternion(b.object.quaternion).add(b.object.position);
    }
    /** 船を手に持っているか */
    get holding() {
        return this.inventory.selectedStack?.item === 'boat';
    }
    /** 船を持っているときに出す操作の案内 */
    get hint() {
        if (!this.spot)
            return '水面を狙うと船を浮かべられる';
        if (this.blocked === 'shallow')
            return 'ここは浅すぎて浮かべられない';
        if (this.blocked === 'obstacle')
            return 'ぶつかる物があって浮かべられない';
        return '[左]：船を水に浮かべる';
    }
    // ---- 入力側：視線から場所・対象を決めて、頼みを出す ----
    /** 視線の先の水面に船を浮かべる。浮かべられたら true */
    place() {
        const spot = this.spot;
        if (!this.holding || !spot || this.blocked)
            return false;
        if (!this.request({ type: 'placeBoat', loc: this.location, p: [spot.x, spot.z], yaw: spot.yaw }))
            return false;
        // 船のアイテムは自分のインベントリ（自分だけの状態）なので、浮かべられたと決まってから減らす
        this.inventory.removeSelected(1);
        return true;
    }
    /** 狙っている船をしまう。インベントリに入りきらなければしまわない。狙っていれば true */
    pick() {
        const b = this.ride ? undefined : this.aimed();
        if (!b)
            return false;
        if (this.inventory.room('boat') < 1)
            return true;
        this.request({ type: 'pickBoat', bid: b.bid }); // 船のアイテムは、しまえたと決まってから（apply で）受け取る
        return true;
    }
    /** 狙っている船に乗る。狙っていれば true */
    board() {
        const b = this.ride ? undefined : this.aimed();
        if (!b)
            return false;
        this.boardById(b.bid);
        return true;
    }
    /** 番号の船に乗る（ロードしたときに乗り直すのにも使う）。乗れたら true */
    boardById(bid) {
        if (this.ride || !this.request({ type: 'boardBoat', bid }))
            return false;
        this.ride = { bid, speed: 0, turn: 0 };
        return true;
    }
    /**
     * 船から降りる。視線の向きに近い順に船の左右・前後を調べ、陸や桟橋に立てればそこへ、なければ船の横の水へ降りる。
     * ground は地面（桟橋なども含む）の高さ、canStand は体がぶつからないか。降りた足元の位置を返す（降りる場所がなければ null）
     */
    leave(ground, canStand) {
        const b = this.ride && this.boats.get(this.ride.bid);
        if (!b)
            return null;
        const look = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const sides = [[0, SIZE.halfW + STEP_OFF], [0, -SIZE.halfW - STEP_OFF], [SIZE.halfL + STEP_OFF, 0], [-SIZE.halfL - STEP_OFF, 0]];
        const spots = sides
            .map(([lx, lz]) => {
            const [x, z] = toWorld(b.x, b.z, b.yaw, lx, lz);
            return { x, z, toward: (x - b.x) * look.x + (z - b.z) * look.z };
        })
            .sort((p, q) => q.toward - p.toward);
        for (const onLand of [true, false]) {
            for (const { x, z } of spots) {
                const g = ground(x, z);
                if (onLand !== g > WATER_LEVEL + LAND_MIN)
                    continue;
                const feet = new THREE.Vector3(x, Math.max(g, onLand ? g : WATER_LEVEL + SWIM_FEET) + STEP_LIFT, z);
                if (!canStand(feet))
                    continue;
                this.release();
                return feet;
            }
        }
        return null;
    }
    /** 今いる場所で船を降りたことにする（力尽きたときなど。プレイヤーの位置は動かさない） */
    release() {
        const b = this.ride && this.boats.get(this.ride.bid);
        this.ride = null;
        if (b)
            this.request({ type: 'leaveBoat', bid: b.bid, p: [b.x, b.z], yaw: b.yaw });
    }
    /** 乗ったりしまったりできる距離の船に視線が合っているか */
    isAiming() {
        return !this.ride && this.aimed() !== undefined;
    }
    /** 視線の先、手が届く距離にある、誰も乗っていない船（手前に地形や桟橋などがあれば undefined） */
    aimed() {
        this.raycaster.setFromCamera(SCREEN_CENTER, this.camera);
        this.raycaster.far = PICK_REACH;
        const objects = [...this.boats.values()].filter((b) => b.rider === null && b.loc === this.location).map((b) => b.object);
        const hit = this.raycaster.intersectObjects(objects, true)[0];
        if (!hit)
            return undefined;
        const block = this.raycaster.intersectObjects(this.targets, false)[0];
        if (block && block.distance < hit.distance)
            return undefined;
        let o = hit.object;
        while (o && !objects.includes(o))
            o = o.parent;
        return [...this.boats.values()].find((b) => b.object === o);
    }
    /** 視線の先の水面（陸や桟橋に先に当たったり、水中から見上げていたりすれば null）。舳先は視線の向き */
    aim() {
        this.raycaster.setFromCamera(SCREEN_CENTER, this.camera);
        this.raycaster.far = PLACE_REACH;
        const { origin, direction } = this.raycaster.ray;
        if (origin.y < WATER_LEVEL || direction.y > -1e-3)
            return null;
        const t = (WATER_LEVEL - origin.y) / direction.y;
        if (t > PLACE_REACH)
            return null;
        const block = this.raycaster.intersectObjects(this.targets, false)[0];
        if (block && block.distance < t)
            return null;
        const p = this.raycaster.ray.at(t, new THREE.Vector3());
        return { x: p.x, z: p.z, yaw: Math.atan2(-direction.z, direction.x) };
    }
    // ---- ホスト側：頼みを確かめてコマンドにする ----
    /**
     * 頼みを確かめ、ID を付けたコマンドにする。by は頼んだ人（降りる・渡るは、乗っている本人だけができる）。
     * できない頼みなら null（マルチではホストだけが呼ぶ）
     */
    authorize(req, by) {
        if (req.type === 'placeBoat') {
            const wellFormed = req.p.length === 2 && [...req.p, req.yaw].every(Number.isFinite) && req.loc === toLocation(req.loc);
            if (!wellFormed || this.check(req.loc, req.p[0], req.p[1], req.yaw))
                return null;
            return { ...req, bid: this.nextBid++ };
        }
        const b = this.boats.get(req.bid);
        if (!b)
            return null;
        if (req.type === 'sailBoat') {
            if (b.rider === null || b.rider !== by || req.loc !== toLocation(req.loc) || req.loc === b.loc)
                return null;
            return { ...req, ...this.arrival(b, req.loc) };
        }
        if (req.type === 'leaveBoat') {
            const wellFormed = req.p.length === 2 && [...req.p, req.yaw].every(Number.isFinite);
            return wellFormed && b.rider !== null && b.rider === by ? req : null;
        }
        // 乗っている船はしまえない。同じ船に2人が乗ろうとしたら、先に届いた方だけが乗れる
        return b.rider !== null || by === null ? null : req;
    }
    /**
     * 場所 loc の、その位置・向きに船を浮かべられるか。浮かべられなければ理由を返す。
     * 浅瀬はその場所の地形で調べる。ぶつかる物は、当たり判定が動いている場所（確かめる人が今いる場所）でしか調べられないので、
     * ほかの場所なら調べない（マルチでは、頼んだ参加者が自分のいる場所で先に調べている）
     */
    check(loc, x, z, yaw) {
        if (loc !== this.location)
            return this.shallowAt(FIELDS[loc], x, z, yaw, MIN_DEPTH) ? 'shallow' : null;
        // 岩・桟橋・ほかの船・部材・プレイヤーとぶつからないか（波で上下しても当たらないよう、水面の上まで高く調べる）
        return this.blockedAt(x, z, yaw, MIN_DEPTH, CHECK_H, COLLIDE.boatQuery);
    }
    /** field の地形で、(x, z) に yaw の向きで浮かぶ船の下が depth より浅いか */
    shallowAt(field, x, z, yaw, depth) {
        for (let i = 0; i <= DEPTH_SAMPLES; i++) {
            for (let j = 0; j <= DEPTH_SAMPLES; j++) {
                const lx = SIZE.halfL * ((2 * i) / DEPTH_SAMPLES - 1);
                const lz = SIZE.halfW * HULL_SHRINK * ((2 * j) / DEPTH_SAMPLES - 1);
                if (field.height(...toWorld(x, z, yaw, lx, lz)) > WATER_LEVEL - depth)
                    return true;
            }
        }
        return false;
    }
    /**
     * 船が今いる場所の (x, z) に yaw の向きで浮かべないか。船の下が depth より浅いか、水面から clear の高さまでに groups の物があれば、その理由を返す。
     * self の当たり判定とは比べない（漕いでいる船自身）
     */
    blockedAt(x, z, yaw, depth, clear, groups, self) {
        for (let i = 0; i <= DEPTH_SAMPLES; i++) {
            for (let j = 0; j <= DEPTH_SAMPLES; j++) {
                const lx = SIZE.halfL * ((2 * i) / DEPTH_SAMPLES - 1);
                const lz = SIZE.halfW * HULL_SHRINK * ((2 * j) / DEPTH_SAMPLES - 1);
                if (terrainHeight(...toWorld(x, z, yaw, lx, lz)) > WATER_LEVEL - depth)
                    return 'shallow';
            }
        }
        const bottom = WATER_LEVEL - DRAFT;
        const shape = new RAPIER.Cuboid(SIZE.halfL * HULL_SHRINK, (clear + DRAFT) / 2, SIZE.halfW * HULL_SHRINK);
        const terrain = this.physics.terrainCollider;
        const hit = this.physics.world.intersectionWithShape({ x, y: bottom + (clear + DRAFT) / 2, z }, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups, undefined, undefined, (c) => c.handle !== terrain?.handle && c.handle !== self?.handle);
        return hit ? 'obstacle' : null;
    }
    /**
     * 船 b が別の場所 to へ渡ったときに着く所。to の沖の、海図で b が今いる場所の側に、to の中心へ舳先を向けて着く。
     * 着いた所にほかの船があれば、横へずらす
     */
    arrival(b, to) {
        const [fx, fz] = LOCATIONS[b.loc].chart;
        const [tx, tz] = LOCATIONS[to].chart;
        const dir = new THREE.Vector2(fx - tx, fz - tz).normalize(); // 海図の右が +X、下が +Z
        const yaw = Math.atan2(dir.y, -dir.x); // 中心へ（-dir の向きへ）舳先を向ける
        const others = [...this.boats.values()].filter((o) => o !== b && o.loc === to);
        for (let k = 0;; k++) {
            const shift = Math.ceil(k / 2) * (k % 2 === 0 ? 1 : -1) * ARRIVE_GAP; // 0, -1, +1, -2, +2 … 個分ずらす
            const x = dir.x * ARRIVE_OUT - dir.y * shift;
            const z = dir.y * ARRIVE_OUT + dir.x * shift;
            if (k > 20 || others.every((o) => Math.hypot(o.x - x, o.z - z) > ARRIVE_CLEAR))
                return { p: [x, z], yaw };
        }
    }
    /** 漕いでいる船が (x, z)・yaw へ進めないか（浅瀬・岩・桟橋・世界の端） */
    moveBlocked(b, x, z, yaw) {
        if (Math.max(Math.abs(x), Math.abs(z)) > MOVE_BOUND)
            return true;
        return this.blockedAt(x, z, yaw, MOVE_DEPTH, MOVE_CLEAR, COLLIDE.boatMove, b.collider) !== null;
    }
    /** 乗っている船を、W/S・A/D の入力で漕いで動かす（自分だけの処理。マルチでは動かした位置を他の人に配る） */
    row(dt) {
        const ride = this.ride;
        const b = this.boats.get(ride.bid);
        if (!b) {
            this.ride = null; // 船がなくなった
            return;
        }
        const input = document.pointerLockElement !== null && !this.inventory.isOpen;
        const key = (code) => input && this.keys.has(code);
        const forward = Number(key('KeyW')) - Number(key('KeyS'));
        const steer = Number(key('KeyA')) - Number(key('KeyD')); // 左へ曲がると yaw が増える
        const fast = key('ShiftLeft') || key('ShiftRight');
        const target = forward > 0 ? (fast ? ROW_FAST : ROW_SPEED) : forward < 0 ? -BACK_SPEED : 0;
        ride.speed = THREE.MathUtils.damp(ride.speed, target, ROW_ACCEL, dt);
        ride.turn = THREE.MathUtils.damp(ride.turn, steer * TURN_SPEED, TURN_ACCEL, dt);
        // 今いる場所がもう何かに重なっていたら（ほかの船が寄ってきたなど）、抜け出せるようにどこへでも動ける
        const stuck = this.moveBlocked(b, b.x, b.z, b.yaw);
        const ok = (x, z, yaw) => stuck || !this.moveBlocked(b, x, z, yaw);
        const yaw = b.yaw + ride.turn * dt;
        if (ok(b.x, b.z, yaw))
            b.yaw = yaw;
        else
            ride.turn = 0;
        const dx = Math.cos(b.yaw) * ride.speed * dt;
        const dz = -Math.sin(b.yaw) * ride.speed * dt;
        if (ok(b.x + dx, b.z + dz, b.yaw)) {
            b.x += dx;
            b.z += dz;
        }
        else if (ok(b.x + dx, b.z, b.yaw)) {
            b.x += dx; // 岸や岩に沿ってこすりながら進む
            ride.speed *= 1 - Math.min(BUMP_SLOW * dt, 1);
        }
        else if (ok(b.x, b.z + dz, b.yaw)) {
            b.z += dz;
            ride.speed *= 1 - Math.min(BUMP_SLOW * dt, 1);
        }
        else {
            ride.speed = 0; // ぶつかって止まる
        }
        // 世界の端まで来たら、海図を開いてほかの場所へ渡れるようにする
        const out = Math.max(Math.abs(b.x), Math.abs(b.z));
        if (out > MAP_EDGE && this.edgeReady) {
            this.edgeReady = false;
            ride.speed = 0;
            ride.turn = 0;
            this.onEdge();
        }
        else if (out < MAP_EDGE - EDGE_RESET) {
            this.edgeReady = true;
        }
    }
    // ---- 適用側：コマンドの値だけで世界を変える（カメラや入力は見ない） ----
    /** by は頼んだ人（乗った人として覚える）、mine は自分の頼みか（しまった船を受け取る・渡り終えたら知らせる） */
    apply(cmd, by, mine) {
        if (cmd.type === 'placeBoat')
            return this.add(cmd.bid, cmd.loc, cmd.p[0], cmd.p[1], cmd.yaw);
        if (cmd.type === 'pickBoat') {
            if (!this.boats.has(cmd.bid))
                return;
            this.remove(cmd.bid);
            if (mine)
                this.inventory.add('boat', 1);
            return;
        }
        const b = this.boats.get(cmd.bid);
        if (!b)
            return;
        if (cmd.type === 'sailBoat') {
            b.loc = cmd.loc;
            [b.x, b.z] = cmd.p;
            b.yaw = cmd.yaw;
            this.refresh(b);
            if (mine && this.ride?.bid === b.bid) {
                this.ride.speed = 0;
                this.ride.turn = 0;
                this.onSail(cmd.loc);
            }
            return;
        }
        b.rider = cmd.type === 'boardBoat' ? by : null;
        if (cmd.type === 'leaveBoat') {
            [b.x, b.z] = cmd.p;
            b.yaw = cmd.yaw;
        }
    }
    serialize() {
        return {
            next: this.nextBid,
            list: [...this.boats.values()].map(({ bid, loc, x, z, yaw }) => ({ bid, p: [x, z], yaw, ...(loc !== 'island' ? { loc } : {}) })),
        };
    }
    restore(save) {
        this.ride = null;
        for (const bid of [...this.boats.keys()])
            this.remove(bid);
        for (const { bid, p, yaw, loc } of save.list)
            this.add(bid, toLocation(loc), p[0], p[1], yaw);
        this.nextBid = Math.max(this.nextBid, save.next);
    }
    add(bid, loc, x, z, yaw) {
        if (this.boats.has(bid))
            return;
        const object = boatObject(true);
        floatPose(x, z, yaw, object.position, object.quaternion);
        this.world.add(object);
        // 当たり判定は、波に合わせて動かす剛体に付けた箱（物理では動かさないので、誰の画面でも同じ位置になる）
        const { x: px, y: py, z: pz } = object.position;
        const { x: qx, y: qy, z: qz, w: qw } = object.quaternion;
        const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(px, py, pz).setRotation({ x: qx, y: qy, z: qz, w: qw }));
        // 箱の高さは真ん中の船べりまで（両端の反り上がりは含めない。乗ったときに浮いて見えないように）
        const desc = RAPIER.ColliderDesc.cuboid(SIZE.halfL * HULL_SHRINK, (BOAT_H * BOAT_SCALE) / 2, SIZE.halfW * HULL_SHRINK)
            .setCollisionGroups(COLLIDE.ground)
            .setFriction(0.8);
        const collider = this.physics.world.createCollider(desc, body);
        const b = { bid, loc, x, z, yaw, object, body, collider, rider: null };
        this.boats.set(bid, b);
        this.refresh(b);
        this.nextBid = Math.max(this.nextBid, bid + 1);
    }
    remove(bid) {
        const b = this.boats.get(bid);
        if (!b)
            return;
        this.boats.delete(bid);
        if (this.ride?.bid === bid)
            this.ride = null;
        b.object.removeFromParent();
        b.object.traverse((o) => o.geometry?.dispose()); // マテリアルは共有なので捨てない
        this.physics.world.removeRigidBody(b.body);
    }
    /** 乗っている船を漕いで動かし、波に合わせて船を揺らし、船を持っていれば浮かべる場所の見本を出す。physics.step より前に呼ぶ */
    update(dt) {
        if (this.ride)
            this.row(dt);
        for (const b of this.boats.values()) {
            floatPose(b.x, b.z, b.yaw, b.object.position, b.object.quaternion);
            const { x, y, z } = b.object.position;
            const { x: qx, y: qy, z: qz, w: qw } = b.object.quaternion;
            b.body.setNextKinematicTranslation({ x, y, z });
            b.body.setNextKinematicRotation({ x: qx, y: qy, z: qz, w: qw });
        }
        this.ghost.visible = false;
        this.spot = null;
        if (!this.holding || this.inventory.isOpen || document.pointerLockElement === null)
            return;
        const spot = this.aim();
        if (!spot)
            return;
        this.spot = spot;
        this.blocked = this.check(this.location, spot.x, spot.z, spot.yaw);
        floatPose(spot.x, spot.z, spot.yaw, this.pos, this.rot);
        this.ghost.position.copy(this.pos);
        this.ghost.quaternion.copy(this.rot);
        const mat = this.blocked ? this.ngMat : this.okMat;
        this.ghost.traverse((o) => {
            if (o.isMesh)
                o.material = mat;
        });
        this.ghost.visible = true;
    }
}
