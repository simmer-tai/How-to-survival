import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat, flatVertex } from '../core/materials.js';
import { FISH_IDS, FISH_KINDS } from './fishKinds.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const LEAF_LENGTH = 0.36;
const LEAF_WIDTH = 0.12;
const LEAF_FOLD = 0.3; // 葉脈を谷にして左右の葉身を起こす角度（rad）
export const PLANK_L = 0.8; // 板の長さ
const PLANK_W = 0.22; // 板の幅
export const PLANK_T = 0.06; // 板の厚み
/** 葉身の片側（葉脈 x=0 から side の向きへふくらむ）。根元が原点、先端が +Y */
function halfLeafShape(side) {
    const w = LEAF_WIDTH * side;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(w * 0.9, LEAF_LENGTH * 0.08, w * 1.05, LEAF_LENGTH * 0.6, 0, LEAF_LENGTH);
    s.lineTo(0, 0);
    return s;
}
function extrudeThin(shape) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.01, curveSegments: 5, bevelEnabled: false });
    geo.translate(0, 0, -0.005);
    return geo;
}
export const BOBBER_R = 0.06; // ウキの玉の半径
/** 薄いひれ。pts は付け根を原点にした輪郭（x=後ろ, y=上） */
function finGeometry(pts) {
    const s = new THREE.Shape();
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1))
        s.lineTo(...p);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    geo.translate(0, 0, -0.006);
    return geo;
}
// 茂みから舞う葉などで何度も作るので、ジオメトリは共有する
const GEO = {
    halfLeft: extrudeThin(halfLeafShape(-1)),
    halfRight: extrudeThin(halfLeafShape(1)),
    midrib: new THREE.CylinderGeometry(0.006, 0.01, LEAF_LENGTH * 0.92, 4).translate(0, LEAF_LENGTH * 0.46, 0),
    petiole: new THREE.CylinderGeometry(0.008, 0.01, 0.07, 4).translate(0, -0.035, 0),
    stickLower: new THREE.CylinderGeometry(0.03, 0.036, 0.42, 6).translate(0, 0.21, 0),
    stickUpper: new THREE.CylinderGeometry(0.022, 0.03, 0.34, 6).translate(0, 0.17, 0),
    twig: new THREE.CylinderGeometry(0.012, 0.018, 0.2, 5).translate(0, 0.1, 0),
    knot: new THREE.DodecahedronGeometry(0.04, 0),
    clod: new THREE.DodecahedronGeometry(1, 0), // 土くれ（大きさは使う所で決める）
    berry: new THREE.SphereGeometry(0.1, 10, 8),
    seed: new THREE.SphereGeometry(0.12, 10, 8),
    berryStem: new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4).translate(0, 0.03, 0),
    plank: new THREE.BoxGeometry(PLANK_L, PLANK_T, PLANK_W),
    grain: new THREE.BoxGeometry(PLANK_L * 0.8, 0.004, 0.012),
    // ウキ：上半分と下半分の色を分けた玉と、上に立てた細い棒
    bobberTop: new THREE.SphereGeometry(BOBBER_R, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    bobberBottom: new THREE.SphereGeometry(BOBBER_R, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    bobberStem: new THREE.CylinderGeometry(0.006, 0.006, BOBBER_R * 1.2, 4).translate(0, BOBBER_R * 1.4, 0),
};
for (const geo of Object.values(GEO))
    geo.userData.shared = true; // アイコン撮影後に捨てられないように
/** 色を少し暗くする（パレットの色の濃淡だけを使う） */
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
/** 葉っぱ1枚。葉脈で少し折れた形。原点は葉柄の付け根で、先端が +Y、表が +Z */
export function buildLeafModel() {
    const g = new THREE.Group();
    const left = new THREE.Mesh(GEO.halfLeft, flat(PALETTE.leaf));
    left.rotation.y = LEAF_FOLD;
    const right = new THREE.Mesh(GEO.halfRight, flat(PALETTE.leaf));
    right.rotation.y = -LEAF_FOLD;
    const midrib = new THREE.Mesh(GEO.midrib, flat(PALETTE.grass));
    midrib.position.z = 0.008;
    const petiole = new THREE.Mesh(GEO.petiole, flat(PALETTE.grass));
    petiole.position.y = 0.005;
    g.add(left, right, midrib, petiole);
    return g;
}
/** ベリー1粒（軸付き）。原点は実の中心 */
export function buildBerryModel() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(GEO.berry, flat(PALETTE.accent)));
    const stem = new THREE.Mesh(GEO.berryStem, flat(PALETTE.leaf));
    stem.position.y = 0.08;
    g.add(stem);
    return g;
}
/** 木の種1粒（少し縦長）。原点は木の種の中心 */
export function buildSeedModel() {
    const g = new THREE.Group();
    const seed = new THREE.Mesh(GEO.seed, flat(PALETTE.sand));
    seed.scale.set(0.8, 1.15, 0.8);
    g.add(seed);
    return g;
}
const DIRT_CLODS = [
    // 土のかたまりを作る土くれ [x, y, z, 大きさ]
    [0, 0, 0, 0.17],
    [0.12, -0.03, 0.05, 0.11],
    [-0.11, -0.02, 0.06, 0.1],
    [0.02, 0.09, -0.04, 0.1],
    [-0.04, -0.04, -0.11, 0.09],
];
/** 土ひとかたまり（土くれを寄せた、少し平たい山）。原点はかたまりの中心 */
export function buildDirtModel() {
    const g = new THREE.Group();
    DIRT_CLODS.forEach(([x, y, z, s], i) => {
        const clod = new THREE.Mesh(GEO.clod, flat(shade(i % 2 ? PALETTE.bark : PALETTE.trunk, i % 2 ? 0.95 : 0.72)));
        clod.position.set(x, y, z);
        clod.scale.set(s, s * 0.8, s);
        clod.rotation.set(i * 0.7, i * 1.3, i * 0.4);
        g.add(clod);
    });
    return g;
}
/** 茂みになっている実（軸なし）。ジオメトリは共有 */
export function buildBushBerry() {
    return new THREE.Mesh(GEO.berry, flat(PALETTE.accent));
}
/** 小枝と葉が1枚ついた、途中で少し曲がった枝。原点は枝の中ほどで、軸は Y */
export function buildStickModel() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = -0.38; // 全長の中ほどを原点にする
    g.add(body);
    body.add(new THREE.Mesh(GEO.stickLower, flat(PALETTE.trunk)));
    const upper = new THREE.Mesh(GEO.stickUpper, flat(PALETTE.trunk));
    upper.position.y = 0.41;
    upper.rotation.z = 0.2; // 節で少し折れ曲がる
    body.add(upper);
    const knot = new THREE.Mesh(GEO.knot, flat(PALETTE.trunk));
    knot.position.y = 0.41;
    knot.scale.set(1, 0.8, 1);
    body.add(knot);
    // 節から分かれた小枝と、その先の葉
    const twig = new THREE.Group();
    twig.position.y = 0.3;
    twig.rotation.z = -0.75;
    twig.add(new THREE.Mesh(GEO.twig, flat(PALETTE.trunk)));
    const leaf = buildLeafModel();
    leaf.position.y = 0.19;
    leaf.rotation.z = 0.35;
    leaf.scale.setScalar(0.45);
    twig.add(leaf);
    body.add(twig);
    return g;
}
/** 板1枚。茶色で、上面に濃い木目が2本。長さは X、原点は板の中心 */
export function buildPlankModel() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(GEO.plank, flat(PALETTE.trunk)));
    for (const [x, z] of [[-0.04, -0.05], [0.05, 0.04]]) {
        const grain = new THREE.Mesh(GEO.grain, flat(PALETTE.bark));
        grain.position.set(x, PLANK_T / 2 + 0.002, z);
        g.add(grain);
    }
    return g;
}
/** 釣り糸の先に付けるウキ。原点は玉の中心で、上半分が赤、下半分が砂色 */
export function buildBobberModel() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(GEO.bobberTop, flat(PALETTE.accent)));
    g.add(new THREE.Mesh(GEO.bobberBottom, flat(PALETTE.sand)));
    g.add(new THREE.Mesh(GEO.bobberStem, flat(PALETTE.trunk)));
    return g;
}
const COIN_R = 0.3; // 硬貨の半径
const COIN_T = 0.05; // 硬貨の厚み
const COIN_HOLE = 0.09; // 硬貨の真ん中の四角い穴の一辺
/** 硬貨1枚。縁の盛り上がりと、真ん中の四角い穴のまわりの刻印。面は +Z を向き、原点は中心 */
export function buildCoinModel() {
    const g = new THREE.Group();
    const gold = PALETTE.sand;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_T, 28), flat(shade(gold, 0.92)));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    for (const side of [-1, 1]) {
        // 縁と、穴のまわりの内側の輪
        const rim = new THREE.Mesh(new THREE.TorusGeometry(COIN_R - 0.02, 0.022, 5, 28), flat(gold));
        rim.position.z = (side * COIN_T) / 2;
        g.add(rim);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(COIN_HOLE * 0.95, 0.014, 4, 4), flat(gold));
        inner.rotation.z = Math.PI / 4; // 4角の輪を四角い穴に沿わせる
        inner.position.z = (side * COIN_T) / 2;
        g.add(inner);
        // 穴の上下左右に1つずつ刻印
        for (const [x, y] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
            const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.012), flat(shade(gold, 0.72)));
            mark.position.set(x * 0.17, y * 0.17, (side * COIN_T) / 2);
            mark.rotation.z = Math.PI / 4;
            g.add(mark);
        }
    }
    // 四角い穴（向こうが透けて見えるように、濃い色でふさいでおく）
    g.add(new THREE.Mesh(new THREE.BoxGeometry(COIN_HOLE, COIN_HOLE, COIN_T + 0.004), flat(shade(PALETTE.bark, 0.8))));
    return g;
}
const BOAT_L = 1; // 船の長さ（X。舳先が +X）
const BOAT_W = 0.38; // 船の幅（Z。真ん中の船べり）
export const BOAT_H = 0.2; // 船の深さ（真ん中の、竜骨の底から船べりまで。両端は少し反り上がる）
const BOW_SHEER = 0.07; // 舳先で船べりが反り上がる量
const STERN_SHEER = 0.03; // 艫で船べりが反り上がる量
const BOW_RISE = 0.19; // 舳先で船底が持ち上がる量（舳先の柱につながる）
const STERN_RISE = 0.035; // 艫で船底が持ち上がる量
const TRANSOM_W = 0.62; // 艫の板の幅（真ん中の幅に対する割合）
const TRANSOM_T = 0.012; // 艫の板の厚み
const BILGE = 3; // 断面の丸み（2 で丸い船底、大きいほど船底が平らで角張る）
const STRAKES = 5; // 片舷に張る外板の枚数（船底から船べりまで）
const LAP = 0.008; // 外板の下の縁を、下の板に重ねて外へ出す量（重ね張り。段は濃い色にして板の継ぎ目に見せる）
const SKIN = 0.008; // 外板の厚み
const STATIONS = 24; // 長さ方向の分割数
const GIRTH = 10; // 船の内側の、断面の分割数
const KEEL_W = 0.018; // 竜骨の幅
const KEEL_H = 0.016; // 竜骨の高さ（船底から下へ出る）
const STEM_H = 0.025; // 舳先の柱が船べりより上に出る量
const RAIL_W = 0.022; // 船べりの縁材の幅（外板の厚みより広くして、内側・外側へ少しはみ出させる）
const RAIL_H = 0.016; // 船べりの縁材の高さ
const RIBS = [-0.78, -0.48, -0.2, 0.2, 0.46, 0.7]; // 肋材を入れる位置（長さ方向、-1〜1）
const RIB_W = 0.014; // 肋材の幅
const RIB_T = 0.008; // 肋材の厚み
const THWARTS = [-0.6, 0.02, 0.56]; // 座り板の位置（長さ方向、-1〜1）
const THWART_D = 0.065; // 座り板の奥行き
const THWART_T = 0.012; // 座り板の厚み
const SEAT_Y = 0.05; // 座り板の上面の高さ
const FLOOR_PLANKS = [-0.05, 0, 0.05]; // 床板を並べる位置（Z）
const OARLOCK_U = -0.2; // オール受けの位置（漕ぐ人は真ん中の座り板に艫を向いて座る）
const HALF_L = BOAT_L / 2;
const HALF_H = BOAT_H / 2;
/** 真ん中の座り板の上面の中央（船に乗ったプレイヤーが座る所） */
export const BOAT_SEAT = new THREE.Vector3(THWARTS[1] * HALF_L, SEAT_Y, 0);
const BOAT_UP = new THREE.Vector3(0, 1, 0);
/** 長さ方向の位置 u（-1 が艫、1 が舳先）での、船べりの幅の半分 */
function boatBeam(u) {
    return (BOAT_W / 2) * (u >= 0 ? Math.pow(1 - Math.pow(u, 2.4), 0.75) : 1 - (1 - TRANSOM_W) * Math.pow(-u, 2.2));
}
/** u での船べりの高さ */
function boatSheer(u) {
    return HALF_H + u * u * (u > 0 ? BOW_SHEER : STERN_SHEER);
}
/** u での、外板の底（竜骨の上）の高さ */
function boatKeel(u) {
    return -HALF_H + KEEL_H + Math.pow(u, 4) * (u > 0 ? BOW_RISE : STERN_RISE);
}
/** 外板の外側の点。phi 0 が船底の中心、π/2 が船べり。side は 1 で右舷（+Z）、-1 で左舷 */
function hullPoint(u, phi, side) {
    const s = boatSheer(u);
    const k = boatKeel(u);
    const z = boatBeam(u) * Math.pow(Math.sin(phi), 2 / BILGE);
    const y = s - (s - k) * Math.pow(Math.cos(phi), 2 / BILGE);
    return new THREE.Vector3(u * HALF_L, y, side * z);
}
/** 外板の、断面に沿った外向きの向き */
function hullNormal(u, phi, side) {
    const e = 1e-3;
    const t = hullPoint(u, Math.min(phi + e, Math.PI / 2), side).sub(hullPoint(u, Math.max(phi - e, 0), side));
    return new THREE.Vector3(0, -side * t.z, side * t.y).normalize();
}
/** 外板の内側の点 */
function hullInner(u, phi, side, depth = SKIN) {
    return hullPoint(u, phi, side).addScaledVector(hullNormal(u, phi, side), -depth);
}
/** 外板の高さが y になる phi（座り板や受け木の位置を決める） */
function hullPhiAt(u, y) {
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (hullPoint(u, mid, 1).y < y)
            lo = mid;
        else
            hi = mid;
    }
    return (lo + hi) / 2;
}
/** 三角形を並べて面を作る。向きは out の側が表になるようにそろえる */
class Faces {
    pos = [];
    ab = new THREE.Vector3();
    ac = new THREE.Vector3();
    tri(a, b, c, out) {
        const n = this.ab.subVectors(b, a).cross(this.ac.subVectors(c, a));
        if (n.lengthSq() < 1e-14)
            return;
        if (n.dot(out) < 0)
            [b, c] = [c, b];
        this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    /** a → b → c → d と回る四角形 */
    quad(a, b, c, d, out) {
        this.tri(a, b, c, out);
        this.tri(a, c, d, out);
    }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.computeVertexNormals();
        return g;
    }
}
/**
 * 点の列に沿って、なめらかにつながった角材を作る。
 * up(i) は i 番目の点での厚み h の向き、幅 w はそれと直角の向き
 */
function sweep(points, w, h, up) {
    const f = new Faces();
    const rings = points.map((p, i) => {
        const t = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(i - 1, 0)]).normalize();
        const u = up(i).clone();
        u.addScaledVector(t, -u.dot(t)).normalize();
        const v = new THREE.Vector3().crossVectors(t, u);
        const corner = (a, b) => p.clone().addScaledVector(v, (a * w) / 2).addScaledVector(u, (b * h) / 2);
        return { corners: [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)], u, v, t };
    });
    for (let i = 0; i + 1 < rings.length; i++) {
        const [a, b] = [rings[i], rings[i + 1]];
        const outs = [a.u, a.v.clone().negate(), a.u.clone().negate(), a.v];
        for (let k = 0; k < 4; k++) {
            const k1 = (k + 1) % 4;
            f.quad(a.corners[k], a.corners[k1], b.corners[k1], b.corners[k], outs[k]);
        }
    }
    // 両端のふた
    for (const [ring, dir] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
        const out = ring.t.clone().multiplyScalar(dir);
        f.quad(ring.corners[0], ring.corners[1], ring.corners[2], ring.corners[3], out);
    }
    return f.build();
}
/** from〜to を n 等分した n + 1 個の値 */
function steps(from, to, n) {
    return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}
/** 外板（重ね張り）。板ごとに下の縁を外へ出して、下の板に重ねる。[板, 重ねた縁の段] */
function hullPlanks() {
    const f = new Faces();
    const ledges = new Faces();
    const us = steps(-1, 1, STATIONS);
    const phiAt = (j) => (j / STRAKES) * (Math.PI / 2);
    for (const side of [1, -1]) {
        for (let j = 0; j < STRAKES; j++) {
            const rows = [phiAt(j), (phiAt(j) + phiAt(j + 1)) / 2, phiAt(j + 1)];
            const lap = j === 0 ? [0, 0, 0] : [LAP, LAP / 2, 0];
            const grid = us.map((u) => rows.map((phi, r) => hullPoint(u, phi, side).addScaledVector(hullNormal(u, phi, side), lap[r])));
            for (let i = 0; i < STATIONS; i++) {
                const u = (us[i] + us[i + 1]) / 2;
                for (let r = 0; r < 2; r++) {
                    f.quad(grid[i][r], grid[i + 1][r], grid[i + 1][r + 1], grid[i][r + 1], hullNormal(u, (rows[r] + rows[r + 1]) / 2, side));
                }
                // 重ねた縁の下側（下の板とのあいだの段）
                if (j > 0) {
                    const down = hullPoint(u, rows[0], side).sub(hullPoint(u, rows[0] + 0.05, side));
                    ledges.quad(hullPoint(us[i], rows[0], side), hullPoint(us[i + 1], rows[0], side), grid[i + 1][0], grid[i][0], down);
                }
            }
        }
    }
    return [f.build(), ledges.build()];
}
/** 外板の内側の面と、船べりの上の面 */
function hullInside() {
    const f = new Faces();
    const us = steps(-1, 1, STATIONS);
    const phis = steps(0, Math.PI / 2, GIRTH);
    const top = Math.PI / 2;
    for (const side of [1, -1]) {
        for (let i = 0; i < STATIONS; i++) {
            const [u0, u1] = [us[i], us[i + 1]];
            for (let r = 0; r < GIRTH; r++) {
                const [p0, p1] = [phis[r], phis[r + 1]];
                const into = hullNormal((u0 + u1) / 2, (p0 + p1) / 2, side).negate();
                f.quad(hullInner(u0, p0, side), hullInner(u1, p0, side), hullInner(u1, p1, side), hullInner(u0, p1, side), into);
            }
            f.quad(hullPoint(u0, top, side), hullPoint(u1, top, side), hullInner(u1, top, side), hullInner(u0, top, side), BOAT_UP);
        }
    }
    return f.build();
}
/** 艫の板（断面の形に切った厚い板。外板の端をふさぐ） */
function transom() {
    const f = new Faces();
    const phis = steps(0, Math.PI / 2, GIRTH);
    const outline = [...[...phis].reverse().map((p) => hullPoint(-1, p, 1)), ...phis.slice(1).map((p) => hullPoint(-1, p, -1))];
    const mid = (boatKeel(-1) + boatSheer(-1)) / 2;
    // 外板の重ねた縁も隠れるように、少し外へ広げる
    const grow = (p, x) => {
        const out = new THREE.Vector3(0, Math.min(p.y - mid, 0), p.z).normalize();
        return p.clone().setX(x).addScaledVector(out, LAP);
    };
    const back = outline.map((p) => grow(p, -HALF_L - TRANSOM_T / 2));
    const front = outline.map((p) => grow(p, -HALF_L + TRANSOM_T / 2));
    const n = outline.length;
    const center = (x) => new THREE.Vector3(x, mid, 0);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        f.tri(center(-HALF_L - TRANSOM_T / 2), back[i], back[j], new THREE.Vector3(-1, 0, 0));
        f.tri(center(-HALF_L + TRANSOM_T / 2), front[i], front[j], new THREE.Vector3(1, 0, 0));
        const out = back[i].clone().add(back[j]).multiplyScalar(0.5).sub(center(back[i].x)).setX(0);
        f.quad(back[i], back[j], front[j], front[i], out);
    }
    return f.build();
}
/**
 * 船べりの内側の縁を結んだ、船の口をふさぐ面（buildBoatModel と同じ座標）。
 * 水に浮かべた船で、船の中に海の水面が見えないように隠すのに使う
 */
export function buildBoatOpening() {
    const f = new Faces();
    const us = steps(-1, 1, STATIONS);
    const edge = (u, side) => hullInner(u, Math.PI / 2, side);
    for (let i = 0; i < STATIONS; i++) {
        f.quad(edge(us[i], -1), edge(us[i + 1], -1), edge(us[i + 1], 1), edge(us[i], 1), BOAT_UP);
    }
    // 艫は外板の端が艫の板の厚みの真ん中にあるので、艫の板の外側まで伸ばしてすき間をなくす
    const stern = (side) => edge(-1, side).setX(-HALF_L - TRANSOM_T / 2);
    f.quad(stern(-1), edge(-1, -1), edge(-1, 1), stern(1), BOAT_UP);
    return f.build();
}
/** 木製の船（重ね張りの小舟）。舳先が +X、原点は船の中心。中は空いていて、肋材・座り板・床板が入っている */
export function buildBoatModel() {
    const [planks, ledges] = hullPlanks();
    const trunk = [planks, hullInside(), transom()];
    const bark = [ledges];
    // 竜骨：船底の真ん中を通り、舳先で立ち上がって柱になる
    const keel = steps(-1, 1, STATIONS).map((u) => new THREE.Vector3(u * HALF_L, boatKeel(u) - KEEL_H / 2 + 0.002, 0));
    keel.push(new THREE.Vector3(HALF_L + 0.006, boatSheer(1) + STEM_H, 0));
    bark.push(sweep(keel, KEEL_W, KEEL_H, (i) => {
        const d = keel[Math.min(i + 1, keel.length - 1)].clone().sub(keel[Math.max(i - 1, 0)]);
        return new THREE.Vector3(-d.y, d.x, 0);
    }));
    const riserY = SEAT_Y - THWART_T - 0.01; // 座り板を受ける横木の高さ
    const riserUs = steps(-0.78, 0.66, 12);
    for (const side of [1, -1]) {
        // 船べりの縁材
        const rail = steps(-1, 0.97, STATIONS).map((u) => hullPoint(u, Math.PI / 2, side).addScaledVector(hullNormal(u, Math.PI / 2, side), RAIL_W / 2 - SKIN - 0.003).setY(boatSheer(u) + 0.006 - RAIL_H / 2));
        bark.push(sweep(rail, RAIL_W, RAIL_H, () => BOAT_UP));
        // 座り板を受ける横木（内側に沿わせる）
        const riser = riserUs.map((u) => hullInner(u, hullPhiAt(u, riserY), side, SKIN + 0.006));
        bark.push(sweep(riser, 0.022, 0.012, (i) => hullNormal(riserUs[i], hullPhiAt(riserUs[i], riserY), side).negate()));
        // オール受け：船べりの上に小さな杭を2本
        const top = hullPoint(OARLOCK_U, Math.PI / 2, side);
        for (const dx of [-0.012, 0.012]) {
            bark.push(new THREE.BoxGeometry(0.008, 0.028, 0.012).translate(top.x + dx, boatSheer(OARLOCK_U) + 0.02, top.z));
        }
    }
    // 肋材：内側に沿って、片方の船べりから反対の船べりまで
    for (const u of RIBS) {
        const phis = steps(0, Math.PI / 2 - 0.04, GIRTH);
        const ends = [...[...phis].reverse().map((p) => [p, -1]), ...phis.slice(1).map((p) => [p, 1])];
        const path = ends.map(([p, side]) => hullInner(u, p, side, SKIN + RIB_T / 2));
        bark.push(sweep(path, RIB_W, RIB_T, (i) => {
            const [p, side] = ends[i];
            return hullNormal(u, p, side).negate();
        }));
    }
    // 座り板：両舷の受け木に渡す
    for (const u of THWARTS) {
        const y = SEAT_Y - THWART_T / 2;
        const half = hullInner(u, hullPhiAt(u, y), 1).z;
        trunk.push(new THREE.BoxGeometry(THWART_D, THWART_T, half * 2 + 0.004).translate(u * HALF_L, y, 0));
    }
    // 床板：肋材の上に、すき間をあけて縦に並べる
    const floorY = boatKeel(0) + SKIN + RIB_T + 0.003;
    for (const z of FLOOR_PLANKS)
        trunk.push(new THREE.BoxGeometry(0.95 * HALF_L, 0.006, 0.038).translate(-0.075 * HALF_L, floorY, z));
    // 色ごとにひとつのメッシュにまとめる（位置と法線だけにそろえる）
    const g = new THREE.Group();
    for (const [list, color] of [[trunk, PALETTE.trunk], [bark, PALETTE.bark]]) {
        const parts = list.map((geo) => {
            const plain = geo.index ? geo.toNonIndexed() : geo;
            for (const name of Object.keys(plain.attributes))
                if (name !== 'position' && name !== 'normal')
                    plain.deleteAttribute(name);
            return plain;
        });
        g.add(new THREE.Mesh(mergeGeometries(parts), flat(color)));
    }
    return g;
}
const SHEET_W = 0.42; // 設計図の紙の横
const SHEET_D = 0.3; // 設計図の紙の縦
/** 線を1本引く（設計図の図面用）。(x1, z1) から (x2, z2) へ、紙の上に */
function drawLine(g, x1, z1, x2, z2, color) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const line = new THREE.Mesh(new THREE.BoxGeometry(len, 0.004, 0.008), flat(color));
    line.position.set((x1 + x2) / 2, 0.004, (z1 + z2) / 2);
    line.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    g.add(line);
}
/** 木製の船の設計図。青い紙に、船を横から見た図面。紙の表が +Y、原点は紙の中心。奥の端は少し巻いている */
export function buildBlueprintModel() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(SHEET_W, 0.004, SHEET_D), flat(PALETTE.water)));
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, SHEET_W, 10), flat(PALETTE.water));
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.02, -SHEET_D / 2);
    g.add(roll);
    // 図面：船を横から見た形（船べり・底・舳先・艫）と、座る板、寸法線
    const ink = PALETTE.sky;
    drawLine(g, -0.15, -0.03, 0.16, -0.03, ink); // 船べり
    drawLine(g, -0.09, 0.06, 0.08, 0.06, ink); // 底
    drawLine(g, 0.08, 0.06, 0.16, -0.03, ink); // 舳先
    drawLine(g, -0.09, 0.06, -0.15, -0.03, ink); // 艫
    drawLine(g, -0.05, -0.03, -0.05, 0.02, ink); // 座る板
    drawLine(g, 0.05, -0.03, 0.05, 0.02, ink);
    drawLine(g, -0.15, 0.1, 0.16, 0.1, ink); // 寸法線
    drawLine(g, -0.15, 0.085, -0.15, 0.115, ink);
    drawLine(g, 0.16, 0.085, 0.16, 0.115, ink);
    return g;
}
const MAP_W = 0.36; // 地図の紙の横
const MAP_D = 0.28; // 地図の紙の縦
const MAP_FOLDS = 3; // 地図の折り目で分かれる面の数（横に並ぶ）
const MAP_FOLD_TILT = 0.05; // 折り目で面を山・谷に傾ける角度（rad）
/** 地図。生成りの紙を三つ折りにした跡が残り、海の中に島が2つと、赤い × の印。紙の表が +Y、原点は紙の中心 */
export function buildMapModel() {
    const g = new THREE.Group();
    const pw = MAP_W / MAP_FOLDS;
    const sea = new THREE.Color(PALETTE.water).lerp(new THREE.Color(PALETTE.sand), 0.55).getHex();
    for (let i = 0; i < MAP_FOLDS; i++) {
        // 折り目ごとに山と谷を交互に付ける
        const panel = new THREE.Group();
        panel.position.x = -MAP_W / 2 + pw * (i + 0.5);
        panel.rotation.z = (i - (MAP_FOLDS - 1) / 2) * MAP_FOLD_TILT * (i % 2 === 0 ? 1 : -1);
        panel.add(new THREE.Mesh(new THREE.BoxGeometry(pw, 0.004, MAP_D), flat(PALETTE.sand)));
        const ink = new THREE.Mesh(new THREE.BoxGeometry(pw - (i === 0 || i === MAP_FOLDS - 1 ? 0.02 : 0), 0.002, MAP_D - 0.03), flat(sea));
        ink.position.set(i === 0 ? 0.01 : i === MAP_FOLDS - 1 ? -0.01 : 0, 0.003, 0);
        panel.add(ink);
        g.add(panel);
    }
    // 島（低い楕円）と、宝の在りかのような × 印
    for (const [x, z, sx, sz, color] of [[-0.09, 0.03, 0.06, 0.045, PALETTE.grass], [0.08, -0.04, 0.07, 0.05, PALETTE.grass], [-0.09, 0.03, 0.03, 0.022, PALETTE.leaf], [0.085, -0.035, 0.035, 0.025, PALETTE.leaf]]) {
        const blob = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.004, 10), flat(color));
        blob.scale.set(sx, 1, sz);
        blob.position.set(x, color === PALETTE.leaf ? 0.009 : 0.007, z);
        g.add(blob);
    }
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const stroke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.004, 0.009), flat(PALETTE.accent));
        stroke.position.set(0.1, 0.012, -0.05);
        stroke.rotation.y = r;
        g.add(stroke);
    }
    drawLine(g, -0.06, 0.02, 0.07, -0.03, PALETTE.accent); // 島から島への航路
    return g;
}
// ---- 魚 ----
// 胴は輪切りを並べたローポリで、面ごとに背中→腹のグラデーションと模様を塗り分ける（面の境目がくっきり出る）
const FISH_RINGS = 16; // 胴の輪切りの数
const FISH_SIDES = 10; // 輪切り1枚の角の数
const FISH_PEDUNCLE = 0.16; // 尾の付け根の太さ（いちばん太い所を 1 として）
const FISH_EYE_AT = 0.13; // 目の位置（0=口先, 1=尾の付け根）
const FISH_SPIKES = 26; // フグのトゲの数
const FISH_SPOTS = 14; // 水玉の数（左右合わせて）
/** 胴の太さ（0=口先, 1=尾の付け根）。口先は少し丸く、太い所から尾の付け根へ細くなる */
function fishProfile(t, fat) {
    if (t < fat)
        return 0.25 + 0.75 * Math.pow(Math.sin((Math.PI / 2) * (t / fat)), 0.7);
    return FISH_PEDUNCLE + (1 - FISH_PEDUNCLE) * Math.pow(Math.cos((Math.PI / 2) * ((t - fat) / (1 - fat))), 1.1);
}
/** 模様のための、面の番号から決まる 0〜1 の値（誰の画面でも同じ） */
function fishHash(i, j, seed) {
    let h = (i * 131 + j * 7919 + seed * 104729) | 0;
    for (let n = 0; n < 2; n++) {
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        h ^= h >>> 16;
    }
    return (h >>> 0) / 4294967295;
}
/** 面の真ん中の位置（t=前後, up=上下 -1〜1）から、その面の色を決める */
// 縦じまにする輪切りの番号（頭の後ろ・胴の真ん中・尾の付け根）
const FISH_BAND_RINGS = [3, 4, 8, 9, 14, 15];
function fishFaceColor(k, i, t, up) {
    const back = new THREE.Color(k.back);
    const belly = new THREE.Color(k.belly);
    const c = belly.lerp(back, THREE.MathUtils.smoothstep(up, -0.45, 0.55));
    if (up > 0.7)
        c.multiplyScalar(0.85); // 背中のてっぺんは濃く
    const pc = new THREE.Color(k.patternColor);
    switch (k.pattern) {
        case 'bands':
            if (FISH_BAND_RINGS.includes(i))
                return pc;
            break;
        case 'stripes':
            // 体の横を通る線（側線）と、腹の横縞
            if (Math.abs(up) < 0.12 && t > 0.15)
                return pc;
            if (k.back === PALETTE.bark && up < -0.2 && up > -0.7 && t > 0.25)
                return c.lerp(new THREE.Color(PALETTE.bark), 0.35);
            break;
    }
    return c;
}
/** 胴。頭が -X、尾の付け根が +X。面ごとに色を塗った（インデックスの無い）ジオメトリ */
function fishBodyGeometry(k) {
    const L = k.length;
    const h = (L * k.height) / 2;
    const w = (L * k.width) / 2;
    const point = (i, j) => {
        const t = i / FISH_RINGS;
        const a = (j / FISH_SIDES) * Math.PI * 2;
        const r = fishProfile(t, k.fat);
        const up = Math.cos(a);
        return new THREE.Vector3(-L / 2 + t * L, up * h * r * (up < 0 ? 1.08 : 1), Math.sin(a) * w * r);
    };
    const pos = [];
    const col = [];
    for (let i = 0; i < FISH_RINGS; i++) {
        for (let j = 0; j < FISH_SIDES; j++) {
            const p00 = point(i, j), p01 = point(i, j + 1), p10 = point(i + 1, j), p11 = point(i + 1, j + 1);
            const c = fishFaceColor(k, i, (i + 0.5) / FISH_RINGS, Math.cos(((j + 0.5) / FISH_SIDES) * Math.PI * 2));
            for (const p of [p00, p11, p10, p00, p01, p11]) {
                pos.push(p.x, p.y, p.z);
                col.push(c.r, c.g, c.b);
            }
        }
    }
    // 口先と尾の付け根をふさぐ
    for (const [i, x] of [[0, -L / 2 - L * 0.02], [FISH_RINGS, L / 2]]) {
        const tip = new THREE.Vector3(x, 0, 0);
        const c = new THREE.Color(i === 0 ? k.back : k.fin);
        for (let j = 0; j < FISH_SIDES; j++) {
            const tri = i === 0 ? [tip, point(i, j + 1), point(i, j)] : [tip, point(i, j), point(i, j + 1)];
            for (const p of tri) {
                pos.push(p.x, p.y, p.z);
                col.push(c.r, c.g, c.b);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
}
/** 尾びれの輪郭（付け根が原点、x=後ろ、y=上）。s は大きさ */
function tailOutline(shape, s) {
    const root = s * 0.12;
    switch (shape) {
        case 'fork':
            return [[0, root], [s * 0.75, s * 0.7], [s * 0.95, s * 0.62], [s * 0.5, 0], [s * 0.95, -s * 0.62], [s * 0.75, -s * 0.7], [0, -root]];
        case 'lunate':
            return [[0, root], [s * 0.35, s * 0.3], [s * 0.85, s * 0.95], [s * 0.6, s * 0.2], [s * 0.55, 0], [s * 0.6, -s * 0.2], [s * 0.85, -s * 0.95], [s * 0.35, -s * 0.3], [0, -root]];
        case 'round':
        case 'fan': {
            const pts = [[0, root]];
            const n = 7;
            for (let a = 0; a <= n; a++) {
                const ang = Math.PI / 2 - (a / n) * Math.PI;
                const r = s * 0.55 * (shape === 'fan' && a % 2 === 1 ? 0.85 : 1); // 扇はふちを波打たせる
                pts.push([s * 0.35 + Math.cos(ang) * r, Math.sin(ang) * r]);
            }
            pts.push([0, -root]);
            return pts;
        }
    }
}
const fishTemplates = new Map();
function shared(geo) {
    geo.userData.shared = true; // アイコン撮影後に捨てられないように
    return geo;
}
/** 魚1匹のひな形を作る（ジオメトリは種類ごとに1度だけ作り、clone で使い回す） */
function buildFishTemplate(id) {
    const k = FISH_KINDS[id];
    const seed = FISH_IDS.indexOf(id);
    const L = k.length;
    const h = (L * k.height) / 2;
    const w = (L * k.width) / 2;
    const g = new THREE.Group();
    const body = new THREE.Mesh(shared(fishBodyGeometry(k)), flatVertex());
    g.add(body);
    const finMat = flat(k.fin);
    const darkFin = flat(shade(k.fin, 0.8));
    const surfaceY = (t) => h * fishProfile(t, k.fat);
    const surfaceZ = (t) => w * fishProfile(t, k.fat);
    // 尾びれ（平たい魚は横に寝かせる）
    const tailSize = L * (k.flat ? 0.3 : 0.26 + k.height * 0.25);
    const tail = new THREE.Mesh(shared(finGeometry(tailOutline(k.tail, tailSize))), finMat);
    tail.position.x = L / 2 - L * 0.02;
    if (k.flat)
        tail.rotation.x = Math.PI / 2;
    g.add(tail);
    if (k.flat) {
        // ヒラメ：体のふちをぐるりと囲むひれ
        for (const side of [-1, 1]) {
            const pts = [];
            for (let n = 0; n <= 8; n++) {
                const t = 0.12 + (n / 8) * 0.8;
                pts.push([t * L, L * 0.05 * Math.sin((n / 8) * Math.PI) + 0.004]);
            }
            pts.push([0.92 * L, 0], [0.12 * L, 0]);
            const fringe = new THREE.Mesh(shared(finGeometry(pts)), darkFin);
            fringe.rotation.x = side * Math.PI / 2;
            fringe.position.set(-L / 2, 0, side * 0.002);
            // 輪郭に沿わせるため、ひれの根元を胴のふちの外へ少しずつ押し出す
            const posAttr = fringe.geometry.getAttribute('position');
            for (let v = 0; v < posAttr.count; v++) {
                const t = THREE.MathUtils.clamp(posAttr.getX(v) / L, 0, 1);
                if (posAttr.getY(v) >= 0)
                    posAttr.setY(v, posAttr.getY(v) + surfaceZ(t) * 0.92);
            }
            posAttr.needsUpdate = true;
            fringe.geometry.computeVertexNormals();
            g.add(fringe);
        }
    }
    else {
        // 背びれ
        if (k.dorsal > 0) {
            const fw = L * 0.42;
            const fh = L * 0.13 * k.dorsal;
            const dorsal = new THREE.Mesh(shared(finGeometry([[0, -fh * 0.3], [fw * 0.12, fh], [fw * 0.35, fh * 0.9], [fw * 0.7, fh * 0.55], [fw, -fh * 0.3]])), finMat);
            dorsal.position.set(-L / 2 + L * 0.3, surfaceY(0.45) * 0.92, 0);
            g.add(dorsal);
        }
        // しりびれ
        const aw = L * 0.22;
        const ah = L * 0.08 * Math.max(k.dorsal, 0.5);
        const anal = new THREE.Mesh(shared(finGeometry([[0, ah * 0.3], [aw * 0.2, -ah], [aw * 0.6, -ah * 0.8], [aw, ah * 0.3]])), finMat);
        anal.position.set(-L / 2 + L * 0.58, -surfaceY(0.68) * 1.0, 0);
        g.add(anal);
    }
    // 胸びれ（左右に少し開く）
    const pw = L * 0.16;
    const pectoral = shared(finGeometry([[0, 0.006], [pw * 0.9, pw * 0.35], [pw, 0], [pw * 0.5, -pw * 0.15], [0, -0.006]]));
    for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(pectoral, darkFin);
        if (k.flat) {
            fin.position.set(-L / 2 + L * 0.28, surfaceY(0.28) * 0.6, side * surfaceZ(0.28) * 0.7);
            fin.rotation.set(-Math.PI / 2, side * 0.6, 0);
        }
        else {
            fin.position.set(-L / 2 + L * 0.27, -surfaceY(0.27) * 0.25, side * surfaceZ(0.27) * 0.95);
            fin.rotation.set(0, side * -0.5, -0.35);
        }
        g.add(fin);
    }
    // 目：大きな白目に黒目と光（平たい魚は両目とも上）
    const eyeR = Math.max(L * 0.075, 0.022);
    const white = shared(new THREE.SphereGeometry(eyeR, 8, 6).scale(1, 1, 0.45));
    const pupil = shared(new THREE.SphereGeometry(eyeR * 0.58, 8, 6).scale(1, 1, 0.5));
    const shine = shared(new THREE.SphereGeometry(eyeR * 0.22, 5, 4));
    const ex = -L / 2 + L * FISH_EYE_AT;
    for (const side of [-1, 1]) {
        const eye = new THREE.Group();
        const p = new THREE.Mesh(pupil, flat(PALETTE.bark));
        p.position.set(-eyeR * 0.12, 0, eyeR * 0.22);
        const sp = new THREE.Mesh(shine, flat(PALETTE.sky));
        sp.position.set(-eyeR * 0.3, eyeR * 0.25, eyeR * 0.46);
        eye.add(new THREE.Mesh(white, flat(PALETTE.sand)), p, sp);
        if (k.flat) {
            eye.position.set(ex + side * eyeR * 0.3, surfaceY(FISH_EYE_AT) + eyeR * 0.1, side * eyeR * 1.1);
            eye.rotation.x = -Math.PI / 2;
        }
        else {
            eye.position.set(ex, surfaceY(FISH_EYE_AT) * 0.3, side * (surfaceZ(FISH_EYE_AT) * 0.95 + eyeR * 0.05));
            if (side < 0)
                eye.rotation.y = Math.PI;
        }
        g.add(eye);
    }
    // 水玉：胴の表面に小さな円盤を貼る（位置は固定の並びで決める）
    if (k.pattern === 'spots') {
        const dot = shared(new THREE.SphereGeometry(L * 0.032, 6, 4).scale(1, 1, 0.3));
        const mat = flat(k.patternColor);
        for (let n = 0; n < FISH_SPOTS; n++) {
            const t = 0.22 + 0.62 * fishHash(n, 2, seed);
            const side = n % 2 ? 1 : -1;
            // 平たい魚は背中（上）に、ほかは体の横の上半分に散らす
            const a = k.flat ? (fishHash(n, 3, seed) - 0.5) * 2.2 : side * (Math.PI / 2 - 0.15 - fishHash(n, 3, seed) * 1.1);
            const r = fishProfile(t, k.fat);
            const dir = new THREE.Vector3(0, Math.cos(a) * h * r, Math.sin(a) * w * r);
            const s = new THREE.Mesh(dot, mat);
            s.position.set(-L / 2 + t * L, dir.y, dir.z).addScaledVector(dir.clone().normalize(), L * 0.004);
            s.lookAt(s.position.clone().add(new THREE.Vector3(0, Math.cos(a) / h, Math.sin(a) / w))); // 円盤を表面の向きに合わせる
            s.scale.setScalar(0.7 + fishHash(n, 4, seed) * 0.6);
            g.add(s);
        }
    }
    // フグのトゲ：胴の表面から外へ向けて生やす（位置は固定の並びで決める）
    if (k.spikes) {
        const spike = shared(new THREE.ConeGeometry(L * 0.025, L * 0.08, 4).translate(0, L * 0.04, 0));
        const mat = flat(shade(k.belly, 0.85));
        for (let n = 0; n < FISH_SPIKES; n++) {
            const t = 0.25 + 0.55 * fishHash(n, 1, 99);
            const a = (n / FISH_SPIKES) * Math.PI * 2 * 3.7;
            const r = fishProfile(t, k.fat);
            const dir = new THREE.Vector3(0, Math.cos(a) * h * r, Math.sin(a) * w * r);
            const s = new THREE.Mesh(spike, mat);
            s.position.set(-L / 2 + t * L, dir.y, dir.z);
            s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            g.add(s);
        }
    }
    return g;
}
/** 釣れた魚。頭が -X、尾が +X を向き、原点は胴の中心 */
export function buildFishModel(id = 'fish') {
    let template = fishTemplates.get(id);
    if (!template) {
        template = buildFishTemplate(id);
        fishTemplates.set(id, template);
    }
    return template.clone();
}
