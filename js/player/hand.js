import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { woodPiece } from '../items/drops.js';
import { PLANK_T, buildBerryModel, buildSeedModel, buildBobberModel, buildFishModel, buildLeafModel, buildPlankModel, buildStickModel, buildBoatModel, buildBlueprintModel, buildMapModel, buildIslandMapModel, buildLandInfoModel, buildDirtModel } from '../items/itemModels.js';
import { FISH_KINDS } from '../items/fishKinds.js';
import { perLandInfo } from '../items/landInfo.js';
import { HandModel } from './handModel.js';
import { pieceIconModel } from '../actions/pieces.js';
/** 腕を伸ばす向き（カメラ基準）。どの持ち方でも、画面の右下手前から手へまっすぐ腕が伸びる */
const ARM_DIR = [0.25, -0.5, 0.83];
/** カメラ基準の向きを、q で回した座標の中での向きに直す */
function toLocal(v, q) {
    return new THREE.Vector3(...v).applyQuaternion(q.clone().invert()).toArray();
}
/** 手や持ち物を描くレイヤー。世界を描いたあとに深度を消して重ねるので、木や岩にめり込まない */
export const VIEW_LAYER = 1;
function toViewLayer(root) {
    root.traverse((o) => o.layers.set(VIEW_LAYER));
}
const SWING_KEYS = [
    { t: 0, pos: [0, 0, 0], rot: [0, 0, 0], ease: 'smooth' }, // 構え
    { t: 0.16, pos: [0.02, 0.13, 0.1], rot: [0.42, 0, 0.08], ease: 'out' }, // 肩の上へ振りかぶる
    { t: 0.25, pos: [-0.1, -0.09, -0.12], rot: [-0.95, -0.1, 0.22], ease: 'in' }, // 画面中央へ振り下ろす
    { t: 0.31, pos: [-0.11, -0.11, -0.11], rot: [-1.02, -0.1, 0.24], ease: 'out' }, // 当たって少し食い込む
    { t: 0.52, pos: [0, 0, 0], rot: [0, 0, 0], ease: 'smooth' }, // 構えに戻る
];
const IMPACT_AT = 0.25; // 振り下ろしきって当たるタイミング（秒）
/** 斧・ハンマー・ナイフ・ツルハシの、肩の上から振り下ろす動き */
const CHOP_MOTION = { keys: SWING_KEYS, impactAt: IMPACT_AT };
/** 槍の、いったん手元へ引いてから前へまっすぐ突き出す動き（槍は前へ水平近くに構えたまま、向きを変えずに押し出す） */
export const THRUST_MOTION = {
    keys: [
        { t: 0, pos: [0, 0, 0], rot: [0, 0, 0], ease: 'smooth' }, // 構え
        { t: 0.12, pos: [0.01, -0.01, 0.16], rot: [0, 0, 0], ease: 'out' }, // まっすぐ手元へ引く
        { t: 0.19, pos: [-0.03, 0.02, -0.5], rot: [0, 0, 0], ease: 'in' }, // 前へまっすぐ突き出す
        { t: 0.26, pos: [-0.03, 0.02, -0.52], rot: [0, 0, 0], ease: 'out' }, // 突き刺さって止まる
        { t: 0.48, pos: [0, 0, 0], rot: [0, 0, 0], ease: 'smooth' }, // 構えに戻る
    ],
    impactAt: 0.19,
};
/** 肩の位置（構えた握りから ARM_DIR 方向へこの距離）。振っている間も腕はここから伸びる */
const SHOULDER_DIST = 0.55;
const HAMMER_HEAD_Y = 0.4; // ハンマーの頭の高さ（握りから）
const HAMMER_HEAD_R = 0.07; // ハンマーの頭の太さ
const HAMMER_HEAD_L = 0.24; // ハンマーの頭の長さ
function ease(k, e) {
    if (e === 'out')
        return 1 - (1 - k) * (1 - k);
    if (e === 'in')
        return k * k;
    return THREE.MathUtils.smootherstep(k, 0, 1);
}
function part(geometry, color, x, y, z) {
    const mesh = new THREE.Mesh(geometry, flat(color));
    mesh.position.set(x, y, z);
    return mesh;
}
const AXE_HEAD_Y = 0.43; // 石の斧頭の高さ（握りから）
const AXE_HEAD_DEPTH = 0.07; // 石の斧頭の、柄のところでの厚み
const AXE_EDGE_THIN = 0.8; // 刃先でどれだけ薄くなるか（0=厚いまま, 1=刃先で厚み0）
const AXE_CHIP = 0.007; // 打ち欠いた面のでこぼこの大きさ
/** 石の斧頭の側面形（u=刃の方向, v=上）。柄の軸が u=0。打ち欠いた石らしく直線の角ばった輪郭にする */
function stoneHeadShape() {
    const pts = [
        [-0.075, 0.025], // 柄の後ろへ出た石の尻
        [-0.03, 0.058],
        [0.04, 0.066],
        [0.11, 0.08],
        [0.18, 0.082], // 刃の上の角
        [0.218, 0.03], // 刃先
        [0.212, -0.04],
        [0.17, -0.095], // 刃の下の角
        [0.1, -0.072],
        [0.03, -0.062],
        [-0.045, -0.05],
        [-0.08, -0.012],
    ];
    const s = new THREE.Shape();
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1))
        s.lineTo(...p);
    s.closePath();
    return s;
}
/** 位置から決まる -1〜1 の値。同じ位置の頂点は同じだけ動くので、面が裂けない */
function hash3(x, y, z) {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
}
/** 刃先へ向かって薄くなり、表面が打ち欠いたように角ばった石の斧頭 */
function buildStoneHead() {
    const geo = new THREE.ExtrudeGeometry(stoneHeadShape(), {
        depth: AXE_HEAD_DEPTH, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 1,
    });
    geo.translate(0, 0, -AXE_HEAD_DEPTH / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const k = THREE.MathUtils.smoothstep(x, 0.02, 0.22);
        const j = (a) => hash3(x + a, y - a, z + a * 2) * AXE_CHIP;
        pos.setXYZ(i, x + j(1), y + j(2), z * (1 - AXE_EDGE_THIN * k) + j(3));
    }
    geo.computeVertexNormals();
    return geo;
}
/** 原点が握りの位置。石の刃は -Z 側を向く */
export function buildAxe() {
    const g = new THREE.Group();
    // ゆるく反った柄。先は斧頭の上へ少し突き出す
    const haft = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.2, 0.03),
        new THREE.Vector3(0, -0.04, 0),
        new THREE.Vector3(0, 0.22, -0.012),
        new THREE.Vector3(0, 0.55, 0),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(haft, 8, 0.024, 6, false), flat(PALETTE.trunk)));
    g.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 6), PALETTE.trunk, 0, 0.55, 0)); // 柄の先のふた
    g.add(part(new THREE.CylinderGeometry(0.04, 0.03, 0.05, 6), PALETTE.trunk, 0, -0.205, 0.03)); // 柄尻
    g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.15, 6), PALETTE.accent, 0, -0.04, 0.002)); // 握りの布
    // 石の斧頭と、柄に縛りつけるつる。形の +u を -Z（刃の向き）へ回す
    const head = new THREE.Group();
    head.position.y = AXE_HEAD_Y;
    head.rotation.y = Math.PI / 2;
    head.add(part(buildStoneHead(), PALETTE.rock, 0, 0, 0));
    // 斧頭の上下で柄に巻いたつる
    const ring = new THREE.TorusGeometry(0.03, 0.009, 4, 8);
    for (const y of [-0.085, -0.068, 0.09, 0.107]) {
        const r = part(ring, PALETTE.bark, 0, y, 0);
        r.rotation.x = Math.PI / 2;
        head.add(r);
    }
    // 斧頭の両面で X 字に交差させたつる
    const strap = new THREE.BoxGeometry(0.016, 0.2, 0.012);
    const face = AXE_HEAD_DEPTH / 2 + 0.016;
    for (const z of [-face, face]) {
        for (const tilt of [-0.55, 0.55]) {
            const s = part(strap, PALETTE.bark, 0, 0.008, z);
            s.rotation.z = tilt;
            head.add(s);
        }
    }
    g.add(head);
    return g;
}
/** 木づちのハンマー。原点が握りの位置で、打つ面は -Z 側を向く */
export function buildHammer() {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.022, 0.026, 0.62, 6), PALETTE.trunk, 0, 0.1, 0)); // 柄
    g.add(part(new THREE.CylinderGeometry(0.036, 0.03, 0.04, 6), PALETTE.trunk, 0, -0.21, 0)); // 柄尻
    g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.15, 6), PALETTE.accent, 0, -0.04, 0)); // 握りの布
    // 丸太を切った頭。両端に帯を巻く
    const head = new THREE.Group();
    head.position.y = HAMMER_HEAD_Y;
    head.rotation.x = Math.PI / 2; // 円柱の軸を Z（打つ向き）へ
    head.add(part(new THREE.CylinderGeometry(HAMMER_HEAD_R, HAMMER_HEAD_R, HAMMER_HEAD_L, 10), PALETTE.sand, 0, 0, 0));
    const band = new THREE.CylinderGeometry(HAMMER_HEAD_R + 0.006, HAMMER_HEAD_R + 0.006, 0.03, 10);
    for (const side of [-1, 1])
        head.add(part(band, PALETTE.trunk, 0, side * (HAMMER_HEAD_L / 2 - 0.04), 0));
    g.add(head);
    return g;
}
const KNIFE_DEPTH = 0.032; // 石のナイフの厚み（握りと峰のところ）
const KNIFE_EDGE_THIN = 0.8; // 刃先でどれだけ薄くなるか（0=厚いまま, 1=刃先で厚み0）
const KNIFE_GRIP_TOP = 0.02; // ここより下は刃を付けず、厚いまま握りにする
/**
 * 石のナイフの側面形（u=刃の方向, v=上）。石を打ち欠いて作った1枚の石片で、下の太い部分を握る。
 * 峰が u<0 側、刃が u>0 側。打ち欠いた石らしく直線の角ばった輪郭にする
 */
function stoneKnifeShape() {
    const pts = [
        [-0.022, -0.17], // 握りの尻
        [0.018, -0.175],
        [0.03, -0.1],
        [0.034, KNIFE_GRIP_TOP], // 握りと刃の境
        [0.05, 0.1], // 刃のふくらみ
        [0.044, 0.19],
        [0.022, 0.27],
        [-0.006, 0.33], // 切っ先
        [-0.026, 0.23],
        [-0.034, 0.1],
        [-0.03, -0.02],
        [-0.034, -0.11],
    ];
    const s = new THREE.Shape();
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1))
        s.lineTo(...p);
    s.closePath();
    return s;
}
/** 石を打ち欠いたナイフ。刃の部分だけ刃の方向へ薄くなり、表面は角ばってでこぼこにする */
function buildStoneKnifeGeometry() {
    const geo = new THREE.ExtrudeGeometry(stoneKnifeShape(), {
        depth: KNIFE_DEPTH, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1,
    });
    geo.translate(0, 0, -KNIFE_DEPTH / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const k = THREE.MathUtils.smoothstep(x, -0.01, 0.05) * THREE.MathUtils.smoothstep(y, KNIFE_GRIP_TOP - 0.03, KNIFE_GRIP_TOP + 0.05);
        const j = (a) => hash3(x + a, y - a, z + a * 2) * AXE_CHIP;
        pos.setXYZ(i, x + j(1), y + j(2), z * (1 - KNIFE_EDGE_THIN * k) + j(3));
    }
    geo.computeVertexNormals();
    return geo;
}
/** 石のナイフ（石だけでできている）。原点が握りの位置で、刃は -Z 側を向く */
export function buildStoneKnife() {
    const g = new THREE.Group();
    const knife = part(buildStoneKnifeGeometry(), PALETTE.rock, 0, 0, 0);
    knife.rotation.y = Math.PI / 2; // 形の +u（刃）を -Z へ
    g.add(knife);
    return g;
}
const SPEAR_SHAFT_BOTTOM = -0.35; // 石の槍の柄尻の高さ（握りから）
const SPEAR_SHAFT_TOP = 1.0; // 柄の先の高さ。ここに石のナイフを縛りつける
const SPEAR_SHAFT_R = 0.022; // 柄（枝）の太さ
const SPEAR_TIP_SCALE = 0.7; // 穂先にする石のナイフの大きさ（手に持つナイフに対する倍率）
/** 握り（原点）から穂先の切っ先までの長さ（石のナイフの切っ先は形の v = 0.33） */
export const SPEAR_LENGTH = SPEAR_SHAFT_TOP + 0.33 * SPEAR_TIP_SCALE;
/** 石の槍。枝の先に石のナイフの握りを差しこみ、ツルで縛りつけてある。原点が握りの位置で、穂先は +Y、刃は -Z 側を向く */
export function buildSpear() {
    const g = new THREE.Group();
    const len = SPEAR_SHAFT_TOP - SPEAR_SHAFT_BOTTOM;
    g.add(part(new THREE.CylinderGeometry(SPEAR_SHAFT_R * 0.9, SPEAR_SHAFT_R, len, 6), PALETTE.trunk, 0, (SPEAR_SHAFT_TOP + SPEAR_SHAFT_BOTTOM) / 2, 0)); // 柄
    g.add(part(new THREE.CylinderGeometry(SPEAR_SHAFT_R + 0.006, SPEAR_SHAFT_R + 0.006, 0.15, 6), PALETTE.bark, 0, -0.04, 0)); // 握りに巻いたツル
    // 穂先：石のナイフの握りの部分を柄の先に重ねる
    const tip = part(buildStoneKnifeGeometry(), PALETTE.rock, 0, SPEAR_SHAFT_TOP, 0);
    tip.scale.setScalar(SPEAR_TIP_SCALE);
    tip.rotation.y = Math.PI / 2; // 形の +u（刃）を -Z へ
    g.add(tip);
    // 穂先と柄の重なったところに巻いたツル
    const ring = new THREE.TorusGeometry(SPEAR_SHAFT_R + 0.01, 0.008, 4, 8);
    for (const dy of [-0.1, -0.075, -0.05, -0.025]) {
        const r = part(ring, PALETTE.bark, 0, SPEAR_SHAFT_TOP + dy, 0);
        r.rotation.x = Math.PI / 2;
        g.add(r);
    }
    return g;
}
const PICK_HEAD_Y = 0.42; // ツルハシの頭の高さ（握りから）
const PICK_HEAD_DEPTH = 0.06; // ツルハシの頭の、柄のところでの厚み
const PICK_TIP_THIN = 0.7; // 先端でどれだけ細くなるか（0=太いまま, 1=先端で厚み0）
/** ツルハシの頭の側面形（u=前の先端の方向, v=上）。柄の軸が u=0。両端がとがって少し下へ反った石 */
function pickHeadShape() {
    const pts = [
        [0.245, -0.065], // 前の先端
        [0.18, -0.005],
        [0.1, 0.03],
        [0.03, 0.045],
        [-0.05, 0.042],
        [-0.12, 0.022],
        [-0.175, -0.012],
        [-0.205, -0.05], // 後ろの先端
        [-0.185, -0.058],
        [-0.12, -0.032],
        [-0.05, -0.022],
        [0.04, -0.024],
        [0.12, -0.036],
        [0.2, -0.062],
    ];
    const s = new THREE.Shape();
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1))
        s.lineTo(...p);
    s.closePath();
    return s;
}
/** 両端へ向かって細くなり、表面が打ち欠いたように角ばったツルハシの頭 */
function buildPickHead() {
    const geo = new THREE.ExtrudeGeometry(pickHeadShape(), {
        depth: PICK_HEAD_DEPTH, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1,
    });
    geo.translate(0, 0, -PICK_HEAD_DEPTH / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const k = THREE.MathUtils.smoothstep(Math.abs(x), 0.04, 0.22);
        const j = (a) => hash3(x + a, y - a, z + a * 2) * AXE_CHIP;
        pos.setXYZ(i, x + j(1), y + j(2), z * (1 - PICK_TIP_THIN * k) + j(3));
    }
    geo.computeVertexNormals();
    return geo;
}
/** 石のツルハシ。原点が握りの位置で、前の先端は -Z 側を向く */
export function buildPickaxe() {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.022, 0.026, 0.68, 6), PALETTE.trunk, 0, 0.13, 0)); // 柄
    g.add(part(new THREE.CylinderGeometry(0.038, 0.03, 0.05, 6), PALETTE.trunk, 0, -0.205, 0)); // 柄尻
    g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.15, 6), PALETTE.accent, 0, -0.04, 0)); // 握りの布
    // 石の頭と、柄に縛りつけるつる。形の +u を -Z へ回す
    const head = new THREE.Group();
    head.position.y = PICK_HEAD_Y;
    head.rotation.y = Math.PI / 2;
    head.add(part(buildPickHead(), PALETTE.rock, 0, 0, 0));
    // 頭の上下で柄に巻いたつる
    const ring = new THREE.TorusGeometry(0.028, 0.009, 4, 8);
    for (const y of [-0.045, -0.03, 0.06, 0.075]) {
        const r = part(ring, PALETTE.bark, 0, y, 0);
        r.rotation.x = Math.PI / 2;
        head.add(r);
    }
    // 頭の両面で X 字に交差させたつる
    const strap = new THREE.BoxGeometry(0.014, 0.13, 0.01);
    const face = PICK_HEAD_DEPTH / 2 + 0.014;
    for (const z of [-face, face]) {
        for (const tilt of [-0.6, 0.6]) {
            const s = part(strap, PALETTE.bark, 0, 0.01, z);
            s.rotation.z = tilt;
            head.add(s);
        }
    }
    g.add(head);
    return g;
}
const SHOVEL_BLADE_Y = 0.5; // スコップの刃の付け根の高さ（握りから）
const SHOVEL_BLADE_HW = 0.078; // 刃の幅の半分（肩のところ）
const SHOVEL_BLADE_L = 0.27; // 刃の付け根から先端までの長さ
const SHOVEL_SHOULDER = 0.05; // 付け根から肩まで広がる長さ
const SHOVEL_TIP_START = 0.17; // ここから先端へ向かって丸くすぼまる
const SHOVEL_NECK_HW = 0.026; // 柄に縛りつける首の幅の半分
const SHOVEL_NECK_L = 0.08; // 付け根から下へ出た首の長さ
const SHOVEL_ROOT_T = 0.017; // 刃の付け根の厚みの半分
const SHOVEL_TIP_T = 0.005; // 刃先の厚みの半分
const SHOVEL_DISH = 0.014; // 刃をくぼませる深さ（ふちが前へ出て、土をすくえる形）
const SHOVEL_BEND = 0.018; // 刃先が前（-Z）へ反る量
const SHOVEL_CARVE = 0.0018; // 削って作ったふちのでこぼこの大きさ
const SHOVEL_TILT = 0.07; // 刃を前へ倒す角度。柄から少し折れている
const SHOVEL_HAFT_R = 0.023; // 柄の太さ
const SHOVEL_ROWS = 14; // 刃を縦に分ける数
const SHOVEL_COLS = 8; // 刃を横に分ける数
/** 付け根からの距離 v での刃の幅の半分（首・肩・まっすぐな胴・丸い先端） */
function shovelHalfWidth(v) {
    if (v < 0)
        return SHOVEL_NECK_HW;
    if (v < SHOVEL_SHOULDER) {
        const k = THREE.MathUtils.smootherstep(v / SHOVEL_SHOULDER, 0, 1);
        return SHOVEL_NECK_HW + (SHOVEL_BLADE_HW - SHOVEL_NECK_HW) * k;
    }
    if (v < SHOVEL_TIP_START)
        return SHOVEL_BLADE_HW * (1 - 0.04 * (v - SHOVEL_SHOULDER) / (SHOVEL_TIP_START - SHOVEL_SHOULDER));
    const k = (v - SHOVEL_TIP_START) / (SHOVEL_BLADE_L - SHOVEL_TIP_START);
    return Math.max(SHOVEL_BLADE_HW * 0.96 * Math.sqrt(1 - k ** 2.6), 0.02);
}
/** 刃の面の中心が前へ出る量（-Z が前）。s=-1〜1 は横の位置 */
function shovelFace(s, v) {
    const dish = SHOVEL_DISH * s * s * THREE.MathUtils.smoothstep(v, 0, SHOVEL_SHOULDER);
    const bend = SHOVEL_BEND * Math.max(v / SHOVEL_BLADE_L, 0) ** 2;
    return -dish - bend;
}
/**
 * 板を削ったスコップの刃。原点が刃の付け根で、+Y が先端、面は -Z を向く。
 * 下へ出た首を柄に縛りつける。ふちが前へ出たくぼんだ面で、先端へ向かって薄くなる
 */
function buildShovelBlade() {
    const v0 = -SHOVEL_NECK_L, v1 = SHOVEL_BLADE_L;
    const front = [], back = [];
    for (let i = 0; i <= SHOVEL_ROWS; i++) {
        // 肩と先端のあたりを細かく分ける
        const v = v0 + (v1 - v0) * (i / SHOVEL_ROWS) ** 0.9;
        const hw = shovelHalfWidth(v);
        const t = THREE.MathUtils.lerp(SHOVEL_ROOT_T, SHOVEL_TIP_T, THREE.MathUtils.smoothstep(v, 0, v1));
        const f = [], b = [];
        for (let j = 0; j <= SHOVEL_COLS; j++) {
            const s = (j / SHOVEL_COLS) * 2 - 1;
            const edge = Math.abs(s) === 1 || i === SHOVEL_ROWS;
            const carve = edge ? hash3(s, v, 1) * SHOVEL_CARVE : 0;
            const x = s * (hw + carve);
            const th = t * (1 - 0.55 * s * s); // ふちほど薄い
            const z = shovelFace(s, v);
            f.push([x, v + (i === SHOVEL_ROWS ? carve : 0), z - th]);
            b.push([x, v + (i === SHOVEL_ROWS ? carve : 0), z + th]);
        }
        front.push(f);
        back.push(b);
    }
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < SHOVEL_ROWS; i++) {
        for (let j = 0; j < SHOVEL_COLS; j++) {
            quad(front[i][j], front[i + 1][j], front[i + 1][j + 1], front[i][j + 1]);
            quad(back[i][j], back[i][j + 1], back[i + 1][j + 1], back[i + 1][j]);
        }
        // 両側のふち
        quad(front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]);
        quad(front[i][SHOVEL_COLS], front[i + 1][SHOVEL_COLS], back[i + 1][SHOVEL_COLS], back[i][SHOVEL_COLS]);
    }
    // 先端と首の下のふち
    for (let j = 0; j < SHOVEL_COLS; j++) {
        const n = SHOVEL_ROWS;
        quad(front[n][j], back[n][j], back[n][j + 1], front[n][j + 1]);
        quad(front[0][j], front[0][j + 1], back[0][j + 1], back[0][j]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
}
/** 首と柄をまとめて巻いたツルの輪（楕円）。中心 z、横の半径 rx、前後の半径 rz */
function lashLoop(rx, rz, z) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * rx, 0, z + Math.sin(a) * rz));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 10, 0.007, 4, true);
}
/** 木のスコップ。枝の柄の先に板を削った刃をツルで縛りつける。原点が握りの位置で、刃の面は -Z を向く */
export function buildShovel() {
    const g = new THREE.Group();
    // 刃の裏に沿わせる柄。根元から刃の付け根へゆるく反り、刃の裏で細く削って終わる
    const backZ = SHOVEL_ROOT_T + SHOVEL_HAFT_R * 0.7; // 刃の裏に当たる柄の中心
    const haft = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.21, 0.015),
        new THREE.Vector3(0, -0.04, 0),
        new THREE.Vector3(0, 0.25, 0),
        new THREE.Vector3(0, SHOVEL_BLADE_Y - SHOVEL_NECK_L, 0),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(haft, 8, SHOVEL_HAFT_R, 6, false), flat(PALETTE.trunk)));
    g.add(part(new THREE.CylinderGeometry(0.038, 0.03, 0.05, 6), PALETTE.trunk, 0, -0.215, 0.015)); // 柄尻
    g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.15, 6), PALETTE.accent, 0, -0.04, 0.002)); // 握りの布
    // 刃。柄の先が刃の裏に来るよう、刃を前へずらす
    const head = new THREE.Group();
    head.position.set(0, SHOVEL_BLADE_Y, -backZ);
    head.rotation.x = -SHOVEL_TILT;
    head.add(part(buildShovelBlade(), PALETTE.sand, 0, 0, 0)); // 削ったばかりの明るい木肌
    // 刃の裏に重なる柄の先。上へ行くほど細い
    const tipLen = SHOVEL_NECK_L + 0.075;
    head.add(part(new THREE.CylinderGeometry(SHOVEL_HAFT_R * 0.55, SHOVEL_HAFT_R, tipLen, 6), PALETTE.trunk, 0, tipLen / 2 - SHOVEL_NECK_L, backZ));
    // 表の木目
    const grain = new THREE.BoxGeometry(0.004, 0.13, 0.004);
    for (const [s, v, len] of [[-0.42, 0.11, 1], [0.3, 0.13, 0.75], [0.05, 0.19, 0.5]]) {
        const line = part(grain, PALETTE.bark, s * SHOVEL_BLADE_HW, v, 0);
        line.scale.y = len;
        // くぼんだ面に沿わせ、面から少しだけ浮かせる
        const t = THREE.MathUtils.lerp(SHOVEL_ROOT_T, SHOVEL_TIP_T, THREE.MathUtils.smoothstep(v, 0, SHOVEL_BLADE_L)) * (1 - 0.55 * s * s);
        line.position.z = shovelFace(s, v) - t - 0.001;
        line.rotation.x = -Math.atan((2 * SHOVEL_BEND * v) / SHOVEL_BLADE_L ** 2); // 刃先の反りに合わせて傾ける
        head.add(line);
    }
    // 首と柄をまとめて巻いたツル
    const loopZ = backZ / 2;
    const loop = lashLoop(SHOVEL_NECK_HW + 0.008, backZ / 2 + SHOVEL_HAFT_R + 0.004, loopZ);
    for (const v of [-0.068, -0.05, -0.032, -0.014])
        head.add(part(loop, PALETTE.bark, 0, v, 0));
    // 刃の裏で柄の先を留めるツル
    const top = lashLoop(SHOVEL_HAFT_R * 0.8 + 0.006, SHOVEL_HAFT_R * 0.8 + 0.004, backZ);
    for (const v of [0.035, 0.05])
        head.add(part(top, PALETTE.bark, 0, v, -0.002));
    g.add(head);
    return g;
}
const ROD_LENGTH = 1.25; // 釣り竿の、握りから竿先までの長さ
const ROD_BUTT = 0.2; // 握りより下へ出た竿尻の長さ
const ROD_BASE_R = 0.024; // 竿の元の太さ
const ROD_TIP_R = 0.007; // 竿先の太さ
const ROD_SEGMENTS = 8; // 竿をいくつの節に分けてしならせるか
const ROD_REST_BEND = 0.14; // 何もしていないときに、竿先が前（-Z）へしなっている角度の合計
const ROD_LINE_DROP = 0.42; // 竿先から垂らした糸の長さ
/**
 * 枝をつないだ釣り竿。ツルを糸にして竿先から垂らし、先にウキを付ける。
 * 原点が握りの位置で、竿は +Y へ伸びる。節ごとの関節を回してしならせる
 */
export function buildFishingRodRig() {
    const root = new THREE.Group();
    const segLength = (ROD_LENGTH + ROD_BUTT) / ROD_SEGMENTS;
    const radius = (i) => THREE.MathUtils.lerp(ROD_BASE_R, ROD_TIP_R, i / ROD_SEGMENTS);
    const joints = [];
    let parent = root;
    for (let i = 0; i < ROD_SEGMENTS; i++) {
        const joint = new THREE.Group();
        joint.position.y = i === 0 ? -ROD_BUTT : segLength;
        const seg = new THREE.CylinderGeometry(radius(i + 1), radius(i), segLength, 6).translate(0, segLength / 2, 0);
        joint.add(new THREE.Mesh(seg, flat(PALETTE.trunk)));
        parent.add(joint);
        joints.push(joint);
        parent = joint;
    }
    const tip = new THREE.Group();
    tip.position.y = segLength;
    parent.add(tip);
    root.add(part(new THREE.CylinderGeometry(ROD_BASE_R, ROD_BASE_R, 0.01, 6), PALETTE.trunk, 0, -ROD_BUTT, 0)); // 竿尻のふた
    root.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 6), PALETTE.accent, 0, -0.04, 0)); // 握りの布
    // 枝の継ぎ目と竿先に巻いたツル
    const ring = new THREE.TorusGeometry(0.019, 0.007, 4, 8);
    for (const [i, y] of [[4, -0.012], [4, 0.012], [ROD_SEGMENTS - 1, segLength * 0.85]]) {
        const r = part(ring, PALETTE.bark, 0, y, 0);
        r.rotation.x = Math.PI / 2;
        r.scale.setScalar(radius(i) / ROD_BASE_R);
        joints[i].add(r);
    }
    // 竿先から垂らしたツルの糸と、先に結んだウキ
    const hanging = new THREE.Group();
    hanging.add(part(new THREE.CylinderGeometry(0.004, 0.004, ROD_LINE_DROP, 4), PALETTE.bark, 0, -ROD_LINE_DROP / 2, 0));
    const bobber = buildBobberModel();
    bobber.position.y = -ROD_LINE_DROP - 0.04;
    bobber.scale.setScalar(0.7);
    hanging.add(bobber);
    tip.add(hanging);
    // 竿先ほど大きく曲げる（i 番目の節の重みは i に比例。根元の節は握っているので曲げない）
    const weightSum = (ROD_SEGMENTS * (ROD_SEGMENTS - 1)) / 2;
    const bend = (forward, side) => {
        for (let i = 1; i < ROD_SEGMENTS; i++) {
            const w = i / weightSum;
            joints[i].rotation.x = -(ROD_REST_BEND + forward) * w;
            joints[i].rotation.z = -side * w;
        }
        // 垂れている糸は、竿の曲がりを打ち消して下へ垂らす
        hanging.rotation.x = ROD_REST_BEND + forward;
        hanging.rotation.z = side;
    };
    bend(0, 0);
    return { root, tip, hanging, bend };
}
/** アイコンなどに使う、しなっていない釣り竿 */
export function buildFishingRod() {
    return buildFishingRodRig().root;
}
/** 一人称視点で手に持つ道具（斧・ハンマー・ナイフ・ツルハシ・釣り竿）。カメラの子として描画し、左クリックで振り下ろす */
export class ToolHand {
    motion;
    root = new THREE.Group();
    pivot = new THREE.Group();
    swingTime = -1; // 振っていないときは負
    impacted = false;
    grip;
    tool;
    shoulder = new THREE.Vector3(); // root 基準の肩の位置
    /** 振り下ろしが当たるタイミングで呼ばれる */
    onImpact = () => { };
    /**
     * tool は原点が握りで、柄が +Y、刃や打つ面が -Z を向いたモデル（buildAxe・buildHammer・buildStoneKnife・buildSpear・buildPickaxe・buildFishingRod）。
     * lean は構えたときに道具を前へ倒す角度（釣り竿のように長い物が画面の上へはみ出さないように）。
     * motion は左クリックで振る動き（槍は THRUST_MOTION で突く）
     */
    constructor(camera, tool, lean = 0, motion = CHOP_MOTION) {
        this.motion = motion;
        // 画面右下に構え、振り下ろす面が照準の先（約3m）で画面中央に来るよう少し内側へ向ける
        this.root.position.set(0.48, -0.42, -0.78);
        this.root.rotation.y = Math.atan2(0.5, 3);
        // 道具そのものは刃をほぼ正面に向け、横顔が少し見える程度にひねる
        tool.rotation.set(0.05 - lean, 0.12, 0.12);
        // 握りの布を右手で握る。指は刃の向き（-Z）、手のひらは左を向く
        const grip = new HandModel('grip');
        grip.grip([0, -0.04, 0], [0, 1, 0], [0, 0, -1]);
        grip.pointForearm(toLocal(ARM_DIR, this.root.quaternion.clone().multiply(tool.quaternion)));
        this.grip = grip;
        this.tool = tool;
        this.shoulder.set(...toLocal(ARM_DIR, this.root.quaternion)).multiplyScalar(SHOULDER_DIST);
        tool.add(grip.root);
        this.pivot.add(tool);
        this.root.add(this.pivot);
        this.root.visible = false;
        toViewLayer(this.root);
        camera.add(this.root);
    }
    get visible() {
        return this.root.visible;
    }
    set visible(v) {
        if (v === this.root.visible)
            return;
        this.root.visible = v;
        this.swingTime = -1;
        this.applySwing(this.motion.keys[0].pos, this.motion.keys[0].rot);
    }
    /** 振っていないときの、構えからの握りの移動 pos と回転 rot（釣り竿を振りかぶる・魚に引かれるときに使う） */
    pose(pos, rot) {
        if (this.swingTime < 0)
            this.applySwing(pos, rot);
    }
    swing() {
        if (!this.root.visible || this.swingTime >= 0)
            return;
        this.swingTime = 0;
        this.impacted = false;
    }
    update(dt) {
        if (this.swingTime < 0)
            return;
        this.swingTime += dt;
        const keys = this.motion.keys;
        const end = keys[keys.length - 1].t;
        const t = Math.min(this.swingTime, end);
        let i = 1;
        while (i < keys.length - 1 && t > keys[i].t)
            i++;
        const a = keys[i - 1];
        const b = keys[i];
        const k = ease((t - a.t) / (b.t - a.t), b.ease);
        const mix = (p, q) => [0, 1, 2].map((j) => THREE.MathUtils.lerp(p[j], q[j], k));
        this.applySwing(mix(a.pos, b.pos), mix(a.rot, b.rot));
        if (!this.impacted && t >= this.motion.impactAt) {
            this.impacted = true;
            this.onImpact();
        }
        if (t >= end)
            this.swingTime = -1;
    }
    /** 握りを動かし、手首から肩へ向けて腕を伸ばし直す */
    applySwing(pos, rot) {
        this.pivot.position.set(...pos);
        this.pivot.rotation.set(...rot);
        const toShoulder = this.shoulder.clone().sub(this.pivot.position);
        const q = this.pivot.quaternion.clone().multiply(this.tool.quaternion);
        this.grip.pointForearm(toLocal(toShoulder.toArray(), q));
    }
}
const HOLD = new THREE.Vector3(0.3, -0.27, -0.6); // 素材を構える位置（カメラ基準）
const RAISE_TIME = 0.18; // 持ち替えたときに下から持ち上がる時間
const MOUTH = new THREE.Vector3(0.02, -0.16, -0.32); // 食べるときに手を運ぶ位置（カメラ基準）
/** 魚の持ち方。大きい魚も手のひらに収まるよう長さをそろえ、体の高さに合わせて少しずつずらして重ねる */
function fishHold(id) {
    const k = FISH_KINDS[id];
    const scale = 0.32 / k.length;
    const step = k.length * k.height * (k.flat ? 1.1 : 0.35);
    return {
        build: () => buildFishModel(id),
        slots: [[0, 0.04, 0, 0, 0, 0], [0.02, 0.04 + step, -0.02, 0, 0.25, 0.05], [-0.02, 0.04 + step * 2, 0.02, 0, -0.2, -0.05]],
        rotation: [0.2, 0.5, 0.05],
        scale,
        hand: { pose: 'cup', at: [0, -0.06, 0.02], fingers: [-0.4, 0.15, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    };
}
/** 設計図の持ち方。手のひらにのせ、図面が見えるようにこちらへ傾ける */
function blueprintHold(kind) {
    return {
        build: () => buildBlueprintModel(kind),
        slots: [[0, 0.004, 0, 0, 0, 0]],
        rotation: [0.75, 0.15, 0.05],
        scale: 0.85,
        hand: { pose: 'cup', at: [0, -0.01, 0.08], fingers: [-0.3, 0.1, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    };
}
/** 地図（白紙の地図・島の地図） */
function mapHold(build) {
    return {
        build,
        slots: [[0, 0.004, 0, 0, 0, 0]],
        rotation: [0.75, -0.1, 0.05],
        scale: 0.75,
        hand: { pose: 'cup', at: [0, -0.01, 0.06], fingers: [-0.3, 0.1, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    };
}
/** 地形のメモ：設計図と同じように手のひらにのせ、絵が見えるようにこちらへ傾ける */
function landInfoHold(kind) {
    return {
        build: () => buildLandInfoModel(kind),
        slots: [[0, 0.004, 0, 0, 0, 0]],
        rotation: [0.75, 0.1, 0.05],
        scale: 0.95,
        hand: { pose: 'cup', at: [0, -0.01, 0.06], fingers: [-0.3, 0.1, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    };
}
const HOLD_STYLES = {
    // 右下で、木口（明るい切り口）がこちらから見えるよう斜めに抱える。1本目を手前に、2・3本目はその上に俵積み
    wood: {
        build: woodPiece,
        slots: [[0, 0, 0, 0, -0.08, Math.PI / 2], [0.03, 0.27, -0.16, 0, 0, Math.PI / 2], [-0.03, 0.27, 0.16, 0, 0.08, Math.PI / 2]],
        rotation: [0.2, 0.6, 0.05],
        scale: 0.5,
        hand: { pose: 'cup', at: [0, -0.17, 0.05], fingers: [-0.4, 0.15, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    },
    // 束ねた枝を、たいまつのように立てて握る（先は少し左奥へ倒す）
    stick: {
        build: buildStickModel,
        // 握る位置（y=-0.04）で3本が重なり、上で扇のように開くように傾ける
        slots: [[0, 0.22, 0, 0, 0, 0], [-0.035, 0.25, -0.008, 0, 1.2, 0.12], [0.024, 0.2, 0.008, 0, -0.9, -0.1]],
        rotation: [-0.4, 0.15, 0.3],
        scale: 0.8,
        hand: { pose: 'grip', at: [0, -0.04, 0], fingers: [-0.15, 0, -1], anchor: 'grip' },
    },
    // 葉柄をつまんで、葉の表をこちらへ向けて扇のように広げる
    leaf: {
        build: buildLeafModel,
        slots: [[0, 0, 0, 0, 0, 0.05], [0.01, 0, -0.015, 0, 0, -0.5], [-0.01, 0, -0.03, 0, 0, 0.6]],
        rotation: [-0.35, -0.25, -0.2],
        scale: 0.75,
        hand: { pose: 'pinch', at: [0, -0.04, 0], fingers: [0.27, 0.75, -0.61], palm: [-0.84, 0, -0.54], anchor: 'pinch' },
    },
    // 重ねた板を手のひらにのせ、長い向きを前へ突き出す（手前の端の近くを下から支える）
    plank: {
        build: buildPlankModel,
        slots: [
            [0, 0, 0, 0, Math.PI / 2, 0],
            [0.012, PLANK_T, -0.02, 0, Math.PI / 2 + 0.08, 0],
            [-0.01, PLANK_T * 2, 0.015, 0, Math.PI / 2 - 0.06, 0],
        ],
        rotation: [0.15, 0.35, 0.05],
        scale: 0.6,
        hand: { pose: 'cup', at: [0, -PLANK_T / 2, 0.16], fingers: [-0.3, 0.1, -1], palm: [0, 1, 0.1], anchor: 'palm' },
    },
    // 魚：手のひらに横たえて、頭を左奥へ向ける
    fish: fishHold('fish'),
    clownfish: fishHold('clownfish'),
    snapper: fishHold('snapper'),
    puffer: fishHold('puffer'),
    flounder: fishHold('flounder'),
    bonito: fishHold('bonito'),
    // 手のひらに数粒のせる
    berry: {
        build: buildBerryModel,
        slots: [[0, 0.16, 0, 0.3, 0, 0.2], [0.19, 0.13, 0.06, -0.2, 0.5, -0.3], [0.08, 0.25, -0.17, 0.1, 1, 0.4]],
        rotation: [0.25, -0.3, 0],
        scale: 0.42,
        hand: { pose: 'cup', at: [0.08, 0.03, 0.02], fingers: [-0.35, 0.35, -0.85], palm: [0, 0.8, 0.6], anchor: 'palm' },
    },
    // 木の種：ベリーと同じように手のひらに数粒のせる
    seed: {
        build: buildSeedModel,
        slots: [[0, 0.14, 0, 0.3, 0, 1.3], [0.17, 0.12, 0.05, -0.2, 0.5, 1.6], [0.07, 0.2, -0.15, 0.1, 1, 1.1]],
        rotation: [0.25, -0.3, 0],
        scale: 0.36,
        hand: { pose: 'cup', at: [0.08, 0.03, 0.02], fingers: [-0.35, 0.35, -0.85], palm: [0, 0.8, 0.6], anchor: 'palm' },
    },
    // 土：手のひらにかたまりをのせる（たくさん持つと積み重なる）
    dirt: {
        build: buildDirtModel,
        slots: [[0, 0.1, 0, 0, 0, 0], [0.12, 0.13, -0.08, 0.3, 1.2, 0.2], [-0.06, 0.2, -0.04, -0.2, 2.3, -0.1]],
        rotation: [0.25, -0.3, 0],
        scale: 0.55,
        hand: { pose: 'cup', at: [0.04, -0.02, 0.02], fingers: [-0.35, 0.35, -0.85], palm: [0, 0.8, 0.6], anchor: 'palm' },
    },
    // 設計図：手のひらにのせ、図面が見えるようにこちらへ傾ける
    boatBlueprint: blueprintHold('boat'),
    pickaxeBlueprint: blueprintHold('pickaxe'),
    spearBlueprint: blueprintHold('spear'),
    hammerBlueprint: blueprintHold('hammer'),
    fishingRodBlueprint: blueprintHold('fishingRod'),
    draftingTableBlueprint: blueprintHold('draftingTable'),
    // 白紙の地図・島の地図：設計図と同じように手のひらにのせ、紙の表が見えるようにこちらへ傾ける
    map: mapHold(buildMapModel),
    islandMap: mapHold(buildIslandMapModel),
    // 地形のメモ
    ...perLandInfo(landInfoHold),
    // 木製の船：持ち物の中では小さく見せて、手のひらにのせる（舳先を左奥へ）
    boat: {
        build: buildBoatModel,
        slots: [[0, 0.1, 0, 0, Math.PI * 0.8, 0]],
        rotation: [0.25, 0.4, 0.05],
        scale: 0.45,
        hand: { pose: 'cup', at: [0, -0.05, 0.02], fingers: [-0.4, 0.15, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    },
    // 焚火：組んだ石と薪を、小さくして手のひらにのせる
    campfire: {
        build: () => {
            const g = pieceIconModel('campfire');
            g.rotation.set(0, 0, 0);
            return g;
        },
        slots: [[0, 0.02, 0, 0, 0.4, 0]],
        rotation: [0.35, 0.3, 0.05],
        scale: 0.17,
        hand: { pose: 'cup', at: [0, -0.03, 0.02], fingers: [-0.4, 0.15, -1], palm: [0, 1, 0.15], anchor: 'palm' },
    },
};
/** 振って使う道具の見た目 */
const TOOL_MODELS = {
    axe: buildAxe,
    hammer: buildHammer,
    stoneKnife: buildStoneKnife,
    pickaxe: buildPickaxe,
    shovel: buildShovel,
    spear: buildSpear,
    fishingRod: buildFishingRod,
};
/**
 * 三人称の体の手に持たせる、持ち物の見た目（1個分）。tool なら原点が握りで、柄が +Y、刃が -Z を向く。
 * 素材なら一人称と同じ縮尺にして、原点に置く。手に見せない物は null
 */
export function buildHeldModel(item) {
    const tool = TOOL_MODELS[item];
    if (tool)
        return { model: tool(), tool: true };
    if (!(item in HOLD_STYLES))
        return null;
    const style = HOLD_STYLES[item];
    const model = new THREE.Group();
    const piece = style.build();
    piece.scale.setScalar(style.scale);
    model.add(piece);
    return { model, tool: false };
}
/** 一人称視点で手に持つ素材（木材・板・枝・葉っぱ・魚・ベリー・木の種・土・設計図・船）。持っている数に応じて最大3個まで重ねて見せる */
export class ItemHand {
    root = new THREE.Group();
    pieces = [];
    raise = 0; // 0→1 で持ち上がる
    bob = 0;
    bump = 0; // 拾ったときに少し跳ねる（1→0）
    count = 0;
    eatTime = -1; // 口へ運んでいる間の経過時間（-1 なら食べていない）
    eatDuration = 0;
    constructor(camera, kind) {
        const style = HOLD_STYLES[kind];
        this.root.position.copy(HOLD);
        this.root.rotation.set(...style.rotation);
        this.root.scale.setScalar(style.scale);
        for (const [x, y, z, rx, ry, rz] of style.slots) {
            const piece = style.build();
            piece.position.set(x, y, z);
            piece.rotation.set(rx, ry, rz);
            this.pieces.push(piece);
            this.root.add(piece);
        }
        const { pose, at, fingers, palm, anchor } = style.hand;
        const hand = new HandModel(pose);
        // root ごと縮めているので、手だけ元の大きさに戻す（位置も縮めた座標に合わせる）
        const handScale = new THREE.Group();
        handScale.scale.setScalar(1 / style.scale);
        // 向きはカメラ基準で指定しているので、root の回転を打ち消して root 基準に直す
        const local = (v) => toLocal(v, this.root.quaternion);
        const pos = [at[0] * style.scale, at[1] * style.scale, at[2] * style.scale];
        if (palm)
            hand.place(pos, local(fingers), local(palm), anchor);
        else
            hand.grip(pos, [0, 1, 0], local(fingers));
        hand.pointForearm(local(ARM_DIR));
        handScale.add(hand.root);
        this.root.add(handScale);
        this.root.visible = false;
        toViewLayer(this.root);
        camera.add(this.root);
    }
    /** 持っている数（0 なら手に何も持たない） */
    setCount(count) {
        if (count > this.count && this.count > 0)
            this.bump = 1;
        if (count > 0 && !this.root.visible)
            this.raise = 0;
        this.count = count;
        this.root.visible = count > 0;
        this.pieces.forEach((p, i) => (p.visible = i < Math.min(count, this.pieces.length)));
    }
    /** duration 秒かけて口へ運び、戻す */
    eat(duration) {
        this.eatTime = 0;
        this.eatDuration = duration;
    }
    update(dt, moving) {
        if (!this.root.visible) {
            this.eatTime = -1;
            return;
        }
        this.raise = Math.min(this.raise + dt / RAISE_TIME, 1);
        this.bump = Math.max(this.bump - dt * 5, 0);
        if (moving)
            this.bob += dt * 9;
        const lift = 1 - (1 - this.raise) ** 3;
        this.root.position.y = HOLD.y - (1 - lift) * 0.35 + Math.sin(this.bob) * 0.012 + Math.sin(this.bump * Math.PI) * 0.03;
        this.root.position.x = HOLD.x + Math.cos(this.bob * 0.5) * 0.01;
        if (this.eatTime >= 0) {
            this.eatTime += dt;
            const k = Math.min(this.eatTime / this.eatDuration, 1);
            // 口元へ寄せて、もぐもぐと小刻みに揺らしてから戻す
            const toMouth = Math.sin(k * Math.PI) ** 0.5;
            this.root.position.lerp(MOUTH, toMouth);
            this.root.position.y += Math.sin(this.eatTime * 40) * 0.01 * toMouth;
            if (k >= 1)
                this.eatTime = -1;
        }
    }
}
const EMPTY_HOLD = new THREE.Vector3(0.34, -0.36, -0.62); // 素手を構える位置（カメラ基準・右手）
/** 肩の位置（構えたこぶしから ARM_DIR 方向へこの距離）。殴るときも腕はここからまっすぐ伸びる */
const EMPTY_SHOULDER_DIST = 0.55;
const FIST_PALM = [-1, -0.6, 0]; // 構えたときの手のひらの向き（内側下）
const PUNCH_PALM = [-0.35, -1, 0]; // 突き出したとき（手首をひねって手のひらが下）
const PUNCH_KEYS = [
    { t: 0, pos: [0, 0, 0], twist: 0, ease: 'smooth' }, // 構え
    { t: 0.06, pos: [0.02, -0.03, 0.05], twist: 0, ease: 'out' }, // 少し引く
    { t: 0.13, pos: [-0.24, 0.15, -0.33], twist: 1, ease: 'in' }, // 画面中央へ突き出す
    { t: 0.18, pos: [-0.23, 0.14, -0.31], twist: 1, ease: 'out' }, // 当たって少し押し返される
    { t: 0.38, pos: [0, 0, 0], twist: 0, ease: 'smooth' }, // 構えに戻る
];
const PUNCH_IMPACT_AT = 0.13; // 突き出しきって当たるタイミング（秒）
const PUNCH_END = PUNCH_KEYS[PUNCH_KEYS.length - 1].t;
/** 何も持っていないときに見せる、両手のこぶし。左手は右手を左右反転したもの。左クリックで左右交互に殴る */
export class EmptyHand {
    /** [右手, 左手] */
    roots = [new THREE.Group(), new THREE.Group()];
    hands = [];
    punchTime = [-1, -1]; // 殴っていないときは負
    offsets = [new THREE.Vector3(), new THREE.Vector3()]; // 構えからのこぶしの移動（右手基準）
    shoulder = new THREE.Vector3(...ARM_DIR).multiplyScalar(EMPTY_SHOULDER_DIST); // 構えたこぶしから見た肩
    next = 0; // 次に殴る手
    shown = false;
    raise = 0;
    bob = 0;
    /** こぶしが当たるタイミングで呼ばれる */
    onImpact = () => { };
    constructor(camera) {
        this.roots.forEach((root, i) => {
            const hand = new HandModel('fist');
            this.hands.push(hand);
            root.add(hand.root);
            if (i === 1)
                root.scale.x = -1; // 左手：右手を鏡に映す
            this.aim(i, 0);
            root.visible = false;
            toViewLayer(root);
            camera.add(root);
        });
    }
    get visible() {
        return this.shown;
    }
    set visible(v) {
        if (v === this.shown)
            return;
        this.shown = v;
        for (const root of this.roots)
            root.visible = v;
        if (v)
            this.raise = 0;
        this.punchTime.fill(-1);
        this.offsets.forEach((o, i) => {
            o.set(0, 0, 0);
            this.aim(i, 0);
        });
    }
    /** 右手・左手を交互に突き出す */
    punch() {
        const i = this.next;
        if (!this.shown || this.raise < 1 || this.punchTime[i] >= 0)
            return;
        this.punchTime[i] = 0;
        this.next = 1 - i;
    }
    update(dt, moving) {
        if (!this.shown)
            return;
        this.raise = Math.min(this.raise + dt / RAISE_TIME, 1);
        if (moving)
            this.bob += dt * 9;
        const lift = 1 - (1 - this.raise) ** 3;
        this.roots.forEach((root, i) => {
            let twist = 0;
            if (this.punchTime[i] >= 0) {
                const before = this.punchTime[i];
                const t = Math.min((this.punchTime[i] += dt), PUNCH_END);
                let n = 1;
                while (n < PUNCH_KEYS.length - 1 && t > PUNCH_KEYS[n].t)
                    n++;
                const a = PUNCH_KEYS[n - 1];
                const b = PUNCH_KEYS[n];
                const k = ease((t - a.t) / (b.t - a.t), b.ease);
                this.offsets[i].set(...a.pos).lerp(new THREE.Vector3(...b.pos), k);
                twist = THREE.MathUtils.lerp(a.twist, b.twist, k);
                if (before < PUNCH_IMPACT_AT && t >= PUNCH_IMPACT_AT)
                    this.onImpact();
                if (t >= PUNCH_END)
                    this.punchTime[i] = -1;
                this.aim(i, twist);
            }
            const phase = this.bob + i * Math.PI; // 歩くと左右の手が交互に揺れる
            const o = this.offsets[i];
            root.position.set((EMPTY_HOLD.x + o.x + Math.cos(phase * 0.5) * 0.01) * root.scale.x, EMPTY_HOLD.y + o.y - (1 - lift) * 0.35 + Math.sin(phase) * 0.012, EMPTY_HOLD.z + o.z);
        });
    }
    /** こぶしを肩から今の位置へまっすぐ向ける（腕と一直線のまま、手首だけひねる） */
    aim(i, twist) {
        const dir = this.offsets[i].clone().sub(this.shoulder).normalize(); // 肩 → こぶし
        const palm = new THREE.Vector3(...FIST_PALM).lerp(new THREE.Vector3(...PUNCH_PALM), twist);
        const hand = this.hands[i];
        hand.place([0, 0, 0], dir.toArray(), palm.toArray(), 'palm');
        hand.pointForearm(dir.negate().toArray());
    }
}
