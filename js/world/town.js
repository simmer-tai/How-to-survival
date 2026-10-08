import * as THREE from 'three';
import { HeightField, SEA_FLOOR, fbm } from './terrain.js';
import { buildPier } from './props.js';
import { ACCENT, BALL, BARK, BOX, Batch, CYL, GRASS, LEAF, MORTAR, ROCK, SAND, TOP_ONLY, TRUNK, backSide, colliderBox, colliderCyl, facePoint, markStone, stoneColor, } from './townKit.js';
import { buildHouse } from './house.js';
import { buildMapShop } from './mapShop.js';
import { Lamps, glassMesh } from './lamps.js';
// 街の島。西（-X。自分の島から船で来る側）に石造りの港がある。広場には農家の屋台と、木組みの家が1軒、中に入れる地図屋が1軒ある（ほかの家や住人はこれから足す）。
// 港は、石積みの岸壁に囲まれた石畳の広場と、海へ突き出た石の突堤、水面へ下りる石段、木の桟橋でできている。
// 形は固定（乱数は固定シード）なので、誰の画面でも同じになる
// ---- 島の形 ----
const ISLE_X = 18; // 島の中心（港は島の西の端に作る）
const ISLE_RADIUS = 40; // 島の中心から海岸線までの半径
const LOW_LAND = 0.8; // 港の裏の平地の高さ
const HILL_TOP = 7; // 港の奥（東）の丘の高さ
const HARBOR_FLOOR = -4; // 岸壁の前の海底の深さ（船を岸壁に付けられるように深く掘ってある）
// ---- 港 ----
const QUAY_TOP = 1.05; // 岸壁と広場の石畳の上面の高さ
const QUAY_X = -16; // 岸壁の海側の面の X
const PLAZA_EAST = 12; // 石畳の広場の東の端の X
const PLAZA_HALF = 24; // 石畳の広場の南北の幅の半分
const JETTY_Z = -8; // 石の突堤の中心の Z
const JETTY_HALF = 3; // 突堤の幅の半分
const JETTY_END = -38; // 突堤の先の X
const PIER_Z = 15; // 木の桟橋の Z
const PIER_LAND = 4; // 桟橋が海岸線から陸側へ入る長さ（props.ts の PIER_LAND と同じ）
const WALL_BOTTOM = HARBOR_FLOOR - 0.6; // 岸壁の石積みの下端
// ---- 石の細かさ ----
const COURSE_H = 0.42; // 岸壁の石積みの1段の高さ
const BLOCK_MIN = 0.7; // 岸壁の石の長さ（最小・最大）
const BLOCK_MAX = 1.5;
const JOINT = 0.05; // 石と石のすきま（目地）
const CORE_INSET = 0.06; // 岸壁の芯（目地の奥に見える暗い箱）を石の面からどれだけ奥に置くか
const SETT_X = 0.62; // 広場の敷石の大きさ（X・Z）
const SETT_Z = 0.46;
const SLAB = 1.1; // 突堤の板石の長さ
const COPING_W = 0.6; // 岸壁の縁石の奥行き
const COPING_H = 0.3; // 縁石の高さ
const STAIR_W = 1.5; // 石段の幅（壁から海へ出る長さ）
const STAIR_RISE = 0.2; // 石段の1段の高さ
const STAIR_RUN = 0.42; // 石段の1段の奥行き
const STAIR_STEPS = 9; // 石段の段数（いちばん下は水の中）
// ---- 家（広場の北東の角。妻側の正面が西＝港のほうを向く） ----
const HOUSE_X = 7; // 家の真ん中の X
const HOUSE_Z = 14; // 家の真ん中の Z
// ---- 地図屋（広場の南東の角。戸口が西＝港のほうを向く） ----
const MAP_SHOP_X = 7; // 地図屋の真ん中の X
const MAP_SHOP_Z = -12; // 地図屋の真ん中の Z
// ---- 農家の屋台（売り台が西＝港のほうを向く） ----
const STALL_X = 1; // 売り台の前（西）の面の X
const STALL_Z = 2; // 屋台の中心の Z
const STALL_W = 3.2; // 屋台の幅（南北）
const STALL_DEPTH = 2.4; // 売り台の前から後ろの柱までの奥行き
const COUNTER_D = 0.7; // 売り台の奥行き
const COUNTER_H = 0.95; // 売り台の高さ（石畳から）
const ROOF_H = 2.45; // 日よけの高さ（石畳から）
const ROOF_OVER = 0.45; // 日よけが売り台より前へ張り出す長さ
const AWNING_STRIPES = 6; // 日よけの縞の数
const FARMER_BACK = 0.55; // 農家が売り台の後ろの面からどれだけ下がって立つか
// ---- 街灯の明かり ----
const LAMP_INTENSITY = 5; // 灯っているときの明かりの強さ
const LAMP_RANGE = 12; // 明かりがとどく距離
const PIER_SEED = 31337; // 桟橋の板のばらつきを決める乱数のシード
const STONE_SEED = 4242; // 石の大きさ・色のばらつきを決める乱数のシード
/** 海図の模型に描く、街のおおまかな間取り（広場・突堤・建物の真ん中） */
export const TOWN_PLAN = {
    plaza: { x0: QUAY_X, x1: PLAZA_EAST, halfZ: PLAZA_HALF, top: QUAY_TOP },
    jetty: { x0: JETTY_END, x1: QUAY_X, z: JETTY_Z, half: JETTY_HALF },
    buildings: [
        { x: HOUSE_X, z: HOUSE_Z },
        { x: MAP_SHOP_X, z: MAP_SHOP_Z },
    ],
    stall: { x: STALL_X, z: STALL_Z },
};
function townRaw(x, z) {
    const dx = x - ISLE_X;
    const r = Math.hypot(dx, z);
    const a = Math.atan2(z, dx);
    // 海岸線を揺らして円形っぽさを消す
    const coast = ISLE_RADIUS + Math.sin(a * 3 + 1.3) * 2.5 + Math.sin(a * 5 + 0.4) * 1.2;
    const land = 1 - THREE.MathUtils.smoothstep(r / coast, 0.8, 1.2);
    const hill = THREE.MathUtils.smoothstep(x, PLAZA_EAST, PLAZA_EAST + 24) * HILL_TOP;
    let h = SEA_FLOOR + land * (LOW_LAND - SEA_FLOOR) + land * (hill + fbm(x * 0.05 + 40, z * 0.05 - 12) * 0.6);
    // 広場の下は石畳より低くしておく（地形の三角形が石畳を突き抜けないよう、1マス広めに）
    const m = 2.5;
    if (x > QUAY_X - m && x < PLAZA_EAST + m && Math.abs(z) < PLAZA_HALF + m)
        h = Math.min(h, LOW_LAND);
    // 岸壁の前は深く掘ってある
    const basin = (1 - THREE.MathUtils.smoothstep(x, QUAY_X + 0.5, QUAY_X + 2.5)) *
        (1 - THREE.MathUtils.smoothstep(Math.abs(z), PLAZA_HALF + 2, PLAZA_HALF + 12));
    return THREE.MathUtils.lerp(h, Math.min(h, HARBOR_FLOOR), basin);
}
/** 街の地形 */
export const townField = new HeightField(townRaw);
function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * 石積みの壁の面に、段ごとに長さの違う石を並べる（隣の段とは継ぎ目をずらす）。
 * 地面に埋まる段は省く。上端は縁石の下
 */
function masonry(b, rand, f, ground) {
    const top = QUAY_TOP - COPING_H;
    for (let y1 = top, row = 0; y1 > WALL_BOTTOM; y1 -= COURSE_H, row++) {
        const y0 = Math.max(WALL_BOTTOM, y1 - COURSE_H);
        let s = f.from + (row % 2 === 0 ? 0 : -BLOCK_MIN / 2);
        while (s < f.to) {
            const len = BLOCK_MIN + rand() * (BLOCK_MAX - BLOCK_MIN);
            const a = Math.max(s, f.from);
            const e = Math.min(s + len, f.to);
            s += len;
            if (e - a < 0.2)
                continue;
            const [gx, gz] = facePoint(f, (a + e) / 2, 0.8);
            if (y1 < ground(gx, gz) - 0.2)
                continue; // 外側の地面に埋まっている
            const bulge = 0.03 + rand() * 0.07; // 石ごとに少し出っ張らせて凹凸を出す
            const [x0, z0] = facePoint(f, a + JOINT / 2, -0.25);
            const [x1, z1] = facePoint(f, e - JOINT / 2, bulge);
            const color = stoneColor(rand, 0.78, (y0 + y1) / 2);
            b.box(Math.min(x0, x1), y0 + JOINT / 2, Math.min(z0, z1), Math.max(x0, x1), y1 - JOINT / 2, Math.max(z0, z1), color, [backSide(f)]);
        }
    }
    // 縁石：大きめの石を少し海側へ張り出して並べる
    const [cut0, cut1] = f.cut ?? [0, 0];
    for (let s = f.from + cut0; s < f.to - cut1 - 0.05;) {
        const len = Math.min(1.0 + rand() * 0.5, f.to - cut1 - s);
        const [x0, z0] = facePoint(f, s + JOINT / 2, -COPING_W);
        const [x1, z1] = facePoint(f, s + len - JOINT / 2, 0.08);
        b.box(Math.min(x0, x1), QUAY_TOP - COPING_H, Math.min(z0, z1), Math.max(x0, x1), QUAY_TOP + 0.02, Math.max(z0, z1), stoneColor(rand, 0.98), ['ny', backSide(f)]);
        s += len;
    }
}
/** 岸壁の芯。石積みの奥に暗い箱を置き、石と石のすきまから向こうの空や海が透けて見えないようにする */
function wallCore(b, x0, z0, x1, z1) {
    const k = CORE_INSET;
    b.box(x0 + k, WALL_BOTTOM, z0 + k, x1 - k, QUAY_TOP - COPING_H, z1 - k, MORTAR, ['py', 'ny']);
}
/** 石畳。x・z の範囲に、横に半分ずつずらした敷石を並べる（size は1枚の X・Z の大きさ） */
function paving(b, rand, x0, z0, x1, z1, sx, sz) {
    b.box(x0, QUAY_TOP - 0.5, z0, x1, QUAY_TOP - 0.06, z1, MORTAR, TOP_ONLY); // 目地の奥（すきまから上面だけ見える）
    for (let z = z0, row = 0; z < z1 - 0.05; z += sz, row++) {
        const ze = Math.min(z + sz, z1);
        for (let x = x0 - (row % 2) * sx * 0.5; x < x1 - 0.05; x += sx) {
            const xa = Math.max(x, x0);
            const xe = Math.min(x + sx, x1);
            if (xe - xa < 0.08)
                continue;
            const lift = (rand() - 0.5) * 0.02; // 敷石ごとに高さを少しばらつかせる
            b.box(xa + JOINT / 2, QUAY_TOP - 0.1, z + JOINT / 2, xe - JOINT / 2, QUAY_TOP + lift, ze - JOINT / 2, stoneColor(rand, 1), TOP_ONLY);
        }
    }
}
// ---- 港の小物 ----
/** 係船柱（船をつなぐ短い柱） */
function bollard(b, group, solids, x, z) {
    const iron = BARK.clone().lerp(ROCK, 0.25).multiplyScalar(0.7);
    b.add(CYL, x, QUAY_TOP + 0.25, z, 0.17, 0.5, 0.17, iron);
    b.add(CYL, x, QUAY_TOP + 0.53, z, 0.24, 0.08, 0.24, iron);
    colliderCyl(group, solids, x, QUAY_TOP, z, 0.24, 0.58);
}
/** 木箱（一辺 s） */
function crate(b, rand, group, solids, x, y, z, s, rotY) {
    const wood = TRUNK.clone().multiplyScalar(0.9 + rand() * 0.2);
    b.add(BOX, x, y + s / 2, z, s, s, s, wood, rotY);
    // 縁の枠
    const frame = BARK.clone().multiplyScalar(0.95 + rand() * 0.1);
    for (const dy of [0.06, s - 0.06])
        b.add(BOX, x, y + dy, z, s + 0.04, 0.1, s + 0.04, frame, rotY);
    const c = Math.cos(rotY);
    const sn = Math.sin(rotY);
    for (const [ux, uz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const lx = (ux * s) / 2;
        const lz = (uz * s) / 2;
        b.add(BOX, x + lx * c + lz * sn, y + s / 2, z - lx * sn + lz * c, 0.1, s, 0.1, frame, rotY);
    }
    const mesh = new THREE.Mesh(BOX);
    mesh.position.set(x, y + s / 2, z);
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(s + 0.04);
    mesh.visible = false;
    group.add(mesh);
    solids.push(mesh);
}
/** 樽 */
function barrel(b, rand, group, solids, x, z) {
    const wood = TRUNK.clone().multiplyScalar(0.85 + rand() * 0.2);
    const hoop = BARK.clone().multiplyScalar(0.8);
    const h = 0.95;
    b.add(CYL, x, QUAY_TOP + h / 2, z, 0.36, h * 0.6, 0.36, wood); // 胴のふくらみ
    for (const [y, r] of [[0.12, 0.31], [h - 0.12, 0.31]])
        b.add(CYL, x, QUAY_TOP + y, z, r, 0.24, r, wood);
    for (const y of [0.2, h / 2 - 0.12, h / 2 + 0.12, h - 0.2])
        b.add(CYL, x, QUAY_TOP + y, z, 0.355, 0.05, 0.355, hoop);
    colliderCyl(group, solids, x, QUAY_TOP, z, 0.36, h);
}
/** 街灯。腕を arm（[x, z] の向き）へ出して、ランタンを吊るす。ランタンのガラスは glass にまとめ、明かりを lamps に足す */
function lamp(b, glass, lamps, group, solids, x, z, arm) {
    const pole = BARK.clone().multiplyScalar(0.8);
    const H = 3.2;
    b.add(CYL, x, QUAY_TOP + 0.15, z, 0.2, 0.3, 0.2, markStone(ROCK.clone().multiplyScalar(0.8))); // 石の台
    b.add(CYL, x, QUAY_TOP + H / 2, z, 0.07, H, 0.07, pole);
    const [ax, az] = arm;
    b.add(BOX, x + ax * 0.3, QUAY_TOP + H - 0.12, z + az * 0.3, 0.06 + Math.abs(ax) * 0.55, 0.06, 0.06 + Math.abs(az) * 0.55, pole);
    const lx = x + ax * 0.52;
    const lz = z + az * 0.52;
    glass.add(BOX, lx, QUAY_TOP + H - 0.42, lz, 0.26, 0.34, 0.26, SAND.clone().multiplyScalar(1.05)); // 明かりの窓
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        b.add(BOX, lx + cx * 0.13, QUAY_TOP + H - 0.42, lz + cz * 0.13, 0.035, 0.36, 0.035, pole); // 窓の枠の柱
    lamps.add(group, new THREE.Vector3(lx, QUAY_TOP + H - 0.42, lz), LAMP_INTENSITY, LAMP_RANGE);
    b.add(BOX, lx, QUAY_TOP + H - 0.22, lz, 0.32, 0.06, 0.32, pole); // 屋根
    b.add(BOX, lx, QUAY_TOP + H - 0.62, lz, 0.3, 0.05, 0.3, pole); // 底
    colliderCyl(group, solids, x, QUAY_TOP, z, 0.2, H);
}
/** 麻袋（たねや粉を入れる）。口をひもで縛ってある */
function sack(b, rand, group, solids, x, z, h) {
    const cloth = SAND.clone().lerp(TRUNK, 0.25 + rand() * 0.1);
    const rot = rand() * Math.PI;
    b.add(BALL, x, QUAY_TOP + h * 0.42, z, 0.3, h * 0.45, 0.27, cloth, rot);
    b.add(CYL, x, QUAY_TOP + h * 0.88, z, 0.1, 0.12, 0.1, cloth, rot); // 縛った口
    b.add(CYL, x, QUAY_TOP + h * 0.84, z, 0.115, 0.03, 0.115, BARK, rot); // ひも
    b.add(BALL, x, QUAY_TOP + h * 0.96, z, 0.13, 0.06, 0.13, cloth, rot); // 口の先の広がり
    colliderCyl(group, solids, x, QUAY_TOP, z, 0.3, h);
}
/** 浅い木の箱に、作物を山盛りにする（top は箱の底の高さ。color は作物の色、r は1つの大きさ） */
function produceTray(b, rand, x, top, z, sx, sz, color, r) {
    const wood = TRUNK.clone().multiplyScalar(1.05);
    b.box(x - sx / 2, top, z - sz / 2, x + sx / 2, top + 0.03, z + sz / 2, wood, ['ny']); // 底
    for (const [dx, dz, w, d] of [[-1, 0, 0.03, sz], [1, 0, 0.03, sz], [0, -1, sx, 0.03], [0, 1, sx, 0.03]]) {
        const cx = x + (dx * (sx - 0.03)) / 2;
        const cz = z + (dz * (sz - 0.03)) / 2;
        b.box(cx - w / 2, top, cz - d / 2, cx + w / 2, top + 0.1, cz + d / 2, wood, ['ny']); // 縁
    }
    // 真ん中ほど高く積む
    const n = Math.round((sx * sz) / (r * r * 1.6));
    for (let i = 0; i < n; i++) {
        const u = rand() - 0.5;
        const v = rand() - 0.5;
        const heap = (1 - Math.max(Math.abs(u), Math.abs(v)) * 2) * 0.08;
        const c = color.clone().multiplyScalar(0.85 + rand() * 0.25);
        b.add(BALL, x + u * (sx - r * 2.5), top + 0.03 + r + heap * rand(), z + v * (sz - r * 2.5), r, r * 0.9, r, c, rand() * 3);
    }
}
/**
 * 農家の屋台。売り台が西（港）を向き、後ろに農家が立つ。上には縞の日よけを張る。
 * 農家が立つ位置と向きを返す
 */
function stall(b, rand, group, solids) {
    const z0 = STALL_Z - STALL_W / 2;
    const z1 = STALL_Z + STALL_W / 2;
    const back = STALL_X + STALL_DEPTH;
    const y0 = QUAY_TOP;
    const top = y0 + COUNTER_H;
    const roof = y0 + ROOF_H;
    const frame = BARK.clone().multiplyScalar(1.1);
    // 売り台：板張りの箱に、少し張り出した天板をのせる
    b.box(STALL_X, y0, z0, STALL_X + COUNTER_D, top - 0.05, z1, TRUNK.clone().multiplyScalar(0.95), ['ny']);
    for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.4)
        b.box(STALL_X - 0.02, y0, z - 0.02, STALL_X, top - 0.05, z + 0.02, frame, ['ny']); // 前の板の継ぎ目
    b.box(STALL_X - 0.06, top - 0.05, z0 - 0.06, STALL_X + COUNTER_D + 0.04, top, z1 + 0.06, BARK.clone().multiplyScalar(1.3));
    colliderBox(group, solids, STALL_X - 0.06, y0, z0 - 0.06, STALL_X + COUNTER_D + 0.04, top, z1 + 0.06);
    // 柱と、日よけを支える枠
    const posts = [[STALL_X + 0.06, z0 + 0.06], [STALL_X + 0.06, z1 - 0.06], [back - 0.06, z0 + 0.06], [back - 0.06, z1 - 0.06]];
    for (const [x, z] of posts) {
        b.box(x - 0.06, y0, z - 0.06, x + 0.06, roof, z + 0.06, frame, ['ny']);
        colliderBox(group, solids, x - 0.06, y0, z - 0.06, x + 0.06, roof, z + 0.06);
    }
    for (const x of [STALL_X + 0.06, back - 0.06])
        b.box(x - 0.05, roof - 0.12, z0, x + 0.05, roof, z1, frame);
    for (const z of [z0 + 0.06, z1 - 0.06])
        b.box(STALL_X - ROOF_OVER, roof - 0.12, z - 0.05, back, roof, z + 0.05, frame);
    // 縞の日よけ。前の縁には短い垂れ幕を下げる
    const stripeW = STALL_W / AWNING_STRIPES;
    const green = LEAF.clone().lerp(GRASS, 0.4);
    for (let i = 0; i < AWNING_STRIPES; i++) {
        const c = i % 2 === 0 ? green : SAND.clone().multiplyScalar(1.02);
        const za = z0 - 0.08 + i * stripeW;
        const zb = za + stripeW + (i === AWNING_STRIPES - 1 ? 0.16 : 0);
        b.box(STALL_X - ROOF_OVER, roof, za, back + 0.1, roof + 0.05, zb, c);
        b.box(STALL_X - ROOF_OVER - 0.02, roof - 0.3, za, STALL_X - ROOF_OVER + 0.02, roof, zb, c.clone().multiplyScalar(0.95));
    }
    // 日よけの前の真ん中に、ベリーの絵の看板を下げる
    b.box(STALL_X - ROOF_OVER - 0.06, roof - 0.62, STALL_Z - 0.4, STALL_X - ROOF_OVER - 0.02, roof - 0.3, STALL_Z + 0.4, TRUNK.clone().multiplyScalar(1.15));
    for (const [dz, dy] of [[-0.1, -0.48], [0.08, -0.5], [-0.01, -0.41]])
        b.add(BALL, STALL_X - ROOF_OVER - 0.07, roof + dy, STALL_Z + dz, 0.03, 0.065, 0.065, ACCENT);
    b.add(BALL, STALL_X - ROOF_OVER - 0.07, roof - 0.36, STALL_Z + 0.02, 0.025, 0.035, 0.08, LEAF);
    // 売り台の上の作物：ベリー・葉物・たね
    const mid = STALL_X + COUNTER_D / 2;
    produceTray(b, rand, mid, top, STALL_Z - 1, 0.5, 0.8, ACCENT, 0.05);
    produceTray(b, rand, mid, top, STALL_Z, 0.5, 0.8, GRASS, 0.08);
    produceTray(b, rand, mid, top, STALL_Z + 1, 0.5, 0.8, SAND.clone().multiplyScalar(0.95), 0.035);
    // 屋台のわきに、たねの麻袋と、作物を入れた木箱
    sack(b, rand, group, solids, STALL_X + 0.4, z1 + 0.45, 0.75);
    sack(b, rand, group, solids, STALL_X + 0.95, z1 + 0.5, 0.65);
    sack(b, rand, group, solids, STALL_X + 0.6, z1 + 1.05, 0.7);
    crate(b, rand, group, solids, STALL_X + 0.5, y0, z0 - 0.75, 0.8, 0.15);
    produceTray(b, rand, STALL_X + 0.5, y0 + 0.8 - 0.06, z0 - 0.75, 0.66, 0.66, GRASS, 0.08);
    // 農家は売り台の後ろに立ち、港のほう（西）を向く
    return { position: new THREE.Vector3(STALL_X + COUNTER_D + FARMER_BACK, QUAY_TOP, STALL_Z), yaw: -Math.PI / 2 };
}
/**
 * 壁ぞいに海へ下りる石段。f の面の along = s0 から s1 の向きへ下りていく（s1 > s0 なら along が増える向き）。
 * 1段ずつ海底まで詰まった石の塊にする
 */
function stairs(b, rand, group, solids, platforms, f, s0, dir) {
    for (let i = 0; i < STAIR_STEPS; i++) {
        const top = QUAY_TOP - (i + 1) * STAIR_RISE;
        const a = s0 + dir * i * STAIR_RUN;
        const e = a + dir * STAIR_RUN;
        const [x0, z0] = facePoint(f, Math.min(a, e), 0);
        const [x1, z1] = facePoint(f, Math.max(a, e), STAIR_W);
        const [minX, maxX, minZ, maxZ] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)];
        b.box(minX, WALL_BOTTOM, minZ, maxX, top - 0.08, maxZ, stoneColor(rand, 0.7, top - 0.3), ['ny', backSide(f)]);
        // 踏み面の石（少し前に張り出す）
        b.box(minX - 0.02, top - 0.1, minZ - 0.02, maxX + 0.02, top, maxZ + 0.02, stoneColor(rand, 0.95, top), ['ny']);
        colliderBox(group, solids, minX, WALL_BOTTOM, minZ, maxX, top, maxZ);
        platforms.push({ minX, maxX, minZ, maxZ, top });
    }
}
/** 街の島を作る */
export function buildTown() {
    const group = new THREE.Group();
    const terrain = townField.createMesh();
    group.add(terrain);
    const solids = [];
    const platforms = [];
    const rand = mulberry32(STONE_SEED);
    const ground = (x, z) => townField.height(x, z);
    const b = new Batch();
    const glass = new Batch(); // 灯ると光るランタンのガラス
    const lamps = new Lamps();
    // 石畳の広場と、それを囲む岸壁
    const jetty = { minX: JETTY_END, maxX: QUAY_X, minZ: JETTY_Z - JETTY_HALF, maxZ: JETTY_Z + JETTY_HALF };
    const plaza = { minX: QUAY_X, maxX: PLAZA_EAST, minZ: -PLAZA_HALF, maxZ: PLAZA_HALF };
    const inset = COPING_W; // 縁石のぶん、石畳を内側から敷く
    paving(b, rand, plaza.minX + inset, plaza.minZ + inset, plaza.maxX - inset, plaza.maxZ - inset, SETT_X, SETT_Z);
    // 岸壁の西の面は、突堤の付け根で二つに分ける
    for (const f of [
        { axis: 'x', fixed: QUAY_X, from: plaza.minZ, to: jetty.minZ, out: -1 },
        { axis: 'x', fixed: QUAY_X, from: jetty.maxZ, to: plaza.maxZ, out: -1 },
        { axis: 'z', fixed: plaza.minZ, from: QUAY_X, to: PLAZA_EAST, out: -1, cut: [inset, inset] },
        { axis: 'z', fixed: plaza.maxZ, from: QUAY_X, to: PLAZA_EAST, out: 1, cut: [inset, inset] },
        { axis: 'x', fixed: PLAZA_EAST, from: plaza.minZ, to: plaza.maxZ, out: 1 }, // 陸側の縁（ほとんど地面に埋まる）
    ])
        masonry(b, rand, f, ground);
    wallCore(b, plaza.minX, plaza.minZ, plaza.maxX, plaza.maxZ);
    colliderBox(group, solids, plaza.minX, WALL_BOTTOM, plaza.minZ, plaza.maxX, QUAY_TOP, plaza.maxZ);
    platforms.push({ ...plaza, top: QUAY_TOP });
    // 石の突堤。上は大きめの板石。付け根は広場の縁石の幅まで入れて、広場の石畳とつなぐ
    paving(b, rand, jetty.minX + inset, jetty.minZ + inset, QUAY_X + inset, jetty.maxZ - inset, SLAB, JETTY_HALF - inset);
    for (const f of [
        { axis: 'z', fixed: jetty.minZ, from: jetty.minX, to: QUAY_X + inset, out: -1, cut: [inset, 0] },
        { axis: 'z', fixed: jetty.maxZ, from: jetty.minX, to: QUAY_X + inset, out: 1, cut: [inset, 0] },
        { axis: 'x', fixed: jetty.minX, from: jetty.minZ, to: jetty.maxZ, out: -1 },
    ])
        masonry(b, rand, f, ground);
    wallCore(b, jetty.minX, jetty.minZ, jetty.maxX, jetty.maxZ);
    colliderBox(group, solids, jetty.minX, WALL_BOTTOM, jetty.minZ, jetty.maxX, QUAY_TOP, jetty.maxZ);
    platforms.push({ ...jetty, top: QUAY_TOP });
    // 水面へ下りる石段：突堤の北側（付け根から先へ下りる）と、岸壁の南寄り（北から南へ下りる）
    stairs(b, rand, group, solids, platforms, { axis: 'z', fixed: jetty.maxZ, from: 0, to: 0, out: 1 }, QUAY_X - 3, -1);
    stairs(b, rand, group, solids, platforms, { axis: 'x', fixed: QUAY_X, from: 0, to: 0, out: -1 }, -15, -1);
    // 係船柱：岸壁と突堤の縁に並べる
    for (let z = -PLAZA_HALF + 3; z < PLAZA_HALF - 1; z += 6) {
        if (Math.abs(z - JETTY_Z) < JETTY_HALF + 1 || Math.abs(z - PIER_Z) < 2.5 || (z < -14 && z > -20))
            continue;
        bollard(b, group, solids, QUAY_X + 0.35, z);
    }
    for (let x = JETTY_END + 2; x < QUAY_X - 1; x += 5) {
        bollard(b, group, solids, x, jetty.minZ + 0.35);
        if (x < QUAY_X - 3 - STAIR_STEPS * STAIR_RUN - 0.5)
            bollard(b, group, solids, x, jetty.maxZ - 0.35);
    }
    // 荷物：木箱と樽を何か所かに積んでおく
    crate(b, rand, group, solids, -11, QUAY_TOP, 6, 1, 0.1);
    crate(b, rand, group, solids, -11.2, QUAY_TOP, 7.15, 1, -0.05);
    crate(b, rand, group, solids, -11.1, QUAY_TOP + 1.04, 6.5, 0.85, 0.3);
    crate(b, rand, group, solids, -9.8, QUAY_TOP, 6.4, 0.8, 0.6);
    for (const [x, z] of [[-10.6, 4.5], [-9.8, 4.1], [-10.3, 3.6], [-5, -16], [-4.3, -16.6], [-5.2, -17.3]])
        barrel(b, rand, group, solids, x, z);
    crate(b, rand, group, solids, -6.5, QUAY_TOP, -17, 1.1, 0.2);
    crate(b, rand, group, solids, -33, QUAY_TOP, JETTY_Z - 1.2, 0.9, 0.4);
    barrel(b, rand, group, solids, -31.8, JETTY_Z - 1.5);
    // 街灯：岸壁ぞいと、突堤の先と、広場の屋台の南北
    for (const z of [-20, -2, 10, 21])
        lamp(b, glass, lamps, group, solids, QUAY_X + 2.2, z, [-1, 0]);
    lamp(b, glass, lamps, group, solids, JETTY_END + 1.2, JETTY_Z + JETTY_HALF - 1, [0, 1]);
    lamp(b, glass, lamps, group, solids, JETTY_END + 1.2, JETTY_Z - JETTY_HALF + 1, [0, -1]);
    for (const z of [-4, 9])
        lamp(b, glass, lamps, group, solids, -1.5, z, [1, 0]);
    // 広場の農家の屋台
    const farmerSpot = stall(b, rand, group, solids);
    group.add(b.mesh());
    group.add(glassMesh(glass));
    // 広場の北東の家（正面の戸口と妻が港を向く）
    const house = buildHouse(group, solids, { x: HOUSE_X, y: QUAY_TOP, z: HOUSE_Z, yaw: -Math.PI / 2 });
    // 広場の南東の地図屋（戸口が港を向く。中に入ると、売り台の後ろに地図売りがいる）
    const mapShop = buildMapShop(group, solids, lamps, { x: MAP_SHOP_X, y: QUAY_TOP, z: MAP_SHOP_Z, yaw: -Math.PI / 2 });
    const stallBox = [[STALL_X - ROOF_OVER, STALL_Z - STALL_W / 2], [STALL_X + STALL_DEPTH, STALL_Z - STALL_W / 2], [STALL_X + STALL_DEPTH, STALL_Z + STALL_W / 2], [STALL_X - ROOF_OVER, STALL_Z + STALL_W / 2]]
        .map(([x, z]) => new THREE.Vector3(x, QUAY_TOP, z));
    // 木の桟橋：岸壁の北寄りから海へ出す（岸壁の外から始め、陸側の端がちょうど岸壁に付くようにする）
    buildPier(group, solids, platforms, mulberry32(PIER_SEED), QUAY_X - PIER_LAND, PIER_Z, [-1, 0], ground);
    return {
        group, terrain, solids, platforms, farmerSpot,
        mapKeeperSpot: mapShop.keeperSpot,
        buildings: [stallBox, house, mapShop.corners],
        marks: [
            { name: '農家の屋台', x: STALL_X + STALL_DEPTH / 2, z: STALL_Z },
            { name: '地図屋', x: MAP_SHOP_X, z: MAP_SHOP_Z - 5.5 }, // 名前は建物の北に書く（中にいると自分の矢印に隠れるので）
            { name: '港', x: QUAY_X + 4, z: JETTY_Z },
        ],
        lamps,
    };
}
