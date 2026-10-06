import * as THREE from 'three';
import { ACCENT, BALL, BARK, BOX, Batch, CYL, GRASS, LEAF, ROCK, SAND, TRUNK, WATER, colliderBox, colliderCyl, faceBox, facePoint3, } from './townKit.js';
import { BAND, BEAM, EAVE_OVER, GABLE_OVER, GF_H, PLASTER, UNDER_ROOF, gable, gableRoof, mulberry32, quoins, stoneWall, windowPane, } from './house.js';
import { glassMesh } from './lamps.js';
// 街の地図屋。石積みの平屋に石板ぶきの切妻屋根がのり、正面の戸口には扉が無く、そのまま中へ入れる。
// 中は板張りの床と天井、漆喰の壁。奥に売り台があり、その後ろに地図売りが立つ。奥の壁には大きな海図と、巻いた地図を並べた棚がある。
// 家の中の座標で組み立て（原点は床の真ん中、戸口のある正面が +Z、棟は Z に沿う）、置く位置と向きは buildMapShop に渡す。
// 形は固定シードの乱数で決めるので、誰の画面でも同じになる
// ---- 大きさ ----
const W = 7; // 幅（X）
const D = 6; // 奥行き（Z）
const WALL_T = 0.4; // 壁の厚さ
const DOOR_HALF = 0.7; // 戸口の幅の半分
const DOOR_TOP = 2.2; // 戸口の高さ
const DOOR_STEP = 0.06; // 戸口の踏み石の高さ
const WAINSCOT = 0.9; // 中の壁の下に張った板の高さ
const SHOP_PITCH = THREE.MathUtils.degToRad(45); // 屋根の傾き（街の家より少しゆるい）
// ---- 中の物 ----
const COUNTER_FRONT = -0.7; // 売り台の前（戸口の側）の面の Z
const COUNTER_D = 0.7; // 売り台の奥行き
const COUNTER_HALF = 2; // 売り台の幅の半分
const COUNTER_H = 1.0; // 売り台の高さ
const KEEPER_Z = -2.05; // 地図売りが立つ位置の Z（売り台と奥の壁の間）
const SHELF_DEPTH = 0.32; // 奥の壁の棚の奥行き
const SHELF_FROM = 1.0; // 棚を置く X の範囲（真ん中から左右へ。真ん中には海図を掛ける）
const SHELF_TO = 2.75;
const SHELF_LEVELS = [0.55, 1.15, 1.75, 2.35]; // 棚板の高さ
const LANTERN_INTENSITY = 3.5; // 中のランタンが灯っているときの明かりの強さ
const LANTERN_RANGE = 7; // 中のランタンの明かりがとどく距離
const SHOP_SEED = 2024; // 石や板の大きさ・色のばらつきを決める乱数のシード
const PAPER = SAND.clone().multiplyScalar(1.04); // 地図の紙
const SEA_INK = WATER.clone().lerp(SAND, 0.55); // 地図に描いた海
const FLOOR = TRUNK.clone().multiplyScalar(0.95); // 床板
const LIT_PANE = WATER.clone().lerp(BARK, 0.55).multiplyScalar(0.45); // 外から見た窓ガラス（昼は暗く、夜は中の明かりで光る）
/** 巻いた地図を1本置く。c は真ん中、dir は巻きの軸の向き（単位ベクトル）、len は長さ */
function roll(b, c, dir, len, r, color) {
    // 円柱の Y を dir に向ける
    const helper = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const ax = new THREE.Vector3().crossVectors(dir, helper).normalize();
    const az = new THREE.Vector3().crossVectors(ax, dir);
    b.oriented(CYL, c, ax, dir, az, r, len, r, color);
    // 両端の紙の巻き口（少し濃い）
    for (const s of [-1, 1])
        b.oriented(CYL, c.clone().addScaledVector(dir, (s * len) / 2), ax, dir, az, r * 0.6, 0.01, r * 0.6, color.clone().multiplyScalar(0.8));
}
/** 島の形の染み（地図に描く島）。面 f の上、along・高さの位置に、横 w・縦 h の大きさで */
function isle(b, f, along, y, w, h, off) {
    const p = facePoint3(f, along, y, off);
    const sx = f.axis === 'x' ? 0.005 : w / 2;
    const sz = f.axis === 'x' ? w / 2 : 0.005;
    b.add(BALL, p.x, p.y, p.z, sx, h / 2, sz, GRASS.clone().lerp(SAND, 0.25));
    const q = facePoint3(f, along + w * 0.08, y + h * 0.05, off + 0.004);
    b.add(BALL, q.x, q.y, q.z, sx * (f.axis === 'x' ? 1 : 0.55), h * 0.28, sz * (f.axis === 'x' ? 0.55 : 1), LEAF);
}
/** 奥の壁に掛けた大きな海図：木の額に、海と島と、島から島への赤い点線 */
function wallChart(b, f, a, e, y0, y1) {
    faceBox(b, f, a - 0.08, e + 0.08, y0 - 0.08, y1 + 0.08, 0, 0.04, BEAM); // 額
    faceBox(b, f, a, e, y0, y1, 0.04, 0.05, PAPER);
    faceBox(b, f, a + 0.08, e - 0.08, y0 + 0.08, y1 - 0.08, 0.05, 0.055, SEA_INK);
    const w = e - a;
    const h = y1 - y0;
    // 西の小さな島（自分の島）と、東の大きな島（街）
    isle(b, f, a + w * 0.26, y0 + h * 0.4, w * 0.22, h * 0.3, 0.06);
    isle(b, f, a + w * 0.72, y0 + h * 0.58, w * 0.32, h * 0.42, 0.06);
    isle(b, f, a + w * 0.5, y0 + h * 0.2, w * 0.08, h * 0.1, 0.06);
    // 航路の点線
    for (let i = 1; i < 8; i++) {
        const t = i / 8;
        const s = a + w * (0.32 + 0.3 * t);
        const y = y0 + h * (0.42 + 0.12 * t + Math.sin(t * Math.PI) * 0.12);
        faceBox(b, f, s - 0.025, s + 0.025, y - 0.012, y + 0.012, 0.055, 0.065, ACCENT);
    }
    // 方位の印（右上の隅）
    const cs = e - 0.22;
    const cy = y1 - 0.24;
    faceBox(b, f, cs - 0.012, cs + 0.012, cy - 0.11, cy + 0.11, 0.055, 0.065, BARK);
    faceBox(b, f, cs - 0.11, cs + 0.11, cy - 0.012, cy + 0.012, 0.055, 0.065, BARK);
    faceBox(b, f, cs - 0.02, cs + 0.02, cy + 0.05, cy + 0.12, 0.06, 0.07, ACCENT); // 北
}
/** 机に広げた地図。中心 (x, y, z)、紙の大きさ w×d */
function deskMap(b, x, y, z, w, d, rotY) {
    b.add(BOX, x, y + 0.004, z, w, 0.008, d, PAPER, rotY);
    b.add(BOX, x, y + 0.009, z, w * 0.86, 0.003, d * 0.82, SEA_INK, rotY);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const at = (u, v) => [x + u * c + v * s, z - u * s + v * c];
    for (const [u, v, r] of [[-0.12, 0.03, 0.08], [0.1, -0.05, 0.11], [0.02, 0.1, 0.04]]) {
        const [px, pz] = at(u * w * 1.6, v * d * 1.6);
        b.add(BALL, px, y + 0.012, pz, r, 0.004, r * 0.75, GRASS.clone().lerp(SAND, 0.25), rotY);
    }
    // 両端を押さえる重しの石
    for (const u of [-0.45, 0.45]) {
        const [px, pz] = at(u * w, -0.4 * d);
        b.add(BALL, px, y + 0.03, pz, 0.04, 0.03, 0.04, ROCK.clone().multiplyScalar(0.85));
    }
}
/** 地図屋を1つ建てて group に入れる。当たり判定の見えない箱は solids に、中のランタンの明かりは lamps に足す */
export function buildMapShop(group, solids, lamps, spot) {
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y, spot.z);
    g.rotation.y = spot.yaw;
    group.add(g);
    const b = new Batch();
    const glass = new Batch(); // 灯ると光る物（ランタンのガラスと、外から見た窓）
    const rand = mulberry32(SHOP_SEED);
    const hx = W / 2;
    const hz = D / 2;
    const ix = hx - WALL_T; // 中の壁の面
    const iz = hz - WALL_T;
    // ---- 壁：外は石積み、中は漆喰 ----
    // 壁の芯（目地の奥に見える）。正面は戸口の左右と上に分ける
    const core = ROCK.clone().multiplyScalar(0.5);
    b.box(-hx, 0, -hz, hx, GF_H, -iz, core, ['ny']);
    b.box(-hx, 0, -iz, -ix, GF_H, iz, core, ['ny']);
    b.box(ix, 0, -iz, hx, GF_H, iz, core, ['ny']);
    b.box(-hx, 0, iz, -DOOR_HALF, GF_H, hz, core, ['ny']);
    b.box(DOOR_HALF, 0, iz, hx, GF_H, hz, core, ['ny']);
    b.box(-DOOR_HALF, DOOR_TOP, iz, DOOR_HALF, GF_H, hz, core, ['ny']);
    const win = (a, e, flowers = false) => ({ a, e, y0: 1.0, y1: 2.0, flowers });
    const front = [{ a: -DOOR_HALF, e: DOOR_HALF, y0: DOOR_STEP, y1: DOOR_TOP, door: true, open: true }, win(-2.3, -1.65, true), win(1.65, 2.3, true)];
    const outside = [
        [{ axis: 'z', fixed: hz, from: -hx, to: hx, out: 1 }, front],
        [{ axis: 'z', fixed: -hz, from: -hx, to: hx, out: -1 }, []],
        [{ axis: 'x', fixed: -hx, from: -hz, to: hz, out: -1 }, [win(-0.5, 0.5)]],
        [{ axis: 'x', fixed: hx, from: -hz, to: hz, out: 1 }, [win(-0.5, 0.5)]],
    ];
    for (const [f, openings] of outside) {
        stoneWall(b, rand, f, openings);
        // 窓ガラスの外に、夜は中の明かりで光る面を重ねる（窓の桟はその手前に出ている）
        for (const o of openings)
            if (!o.door)
                faceBox(glass, f, o.a, o.e, o.y0, o.y1, 0.016, 0.022, LIT_PANE);
    }
    quoins(b, rand, hx, hz);
    // 戸口の中の、壁の厚みの面（わき柱）
    for (const s of [-1, 1])
        b.box(s > 0 ? DOOR_HALF - 0.02 : -DOOR_HALF, 0, iz, s > 0 ? DOOR_HALF : -DOOR_HALF + 0.02, DOOR_TOP, hz - 0.1, PLASTER);
    b.box(-DOOR_HALF, DOOR_TOP - 0.02, iz, DOOR_HALF, DOOR_TOP, hz - 0.1, BEAM);
    // 中の壁：漆喰と、下に張った板。中から見える窓も描く（面の外向きは部屋の中）
    const inside = [
        [{ axis: 'z', fixed: -iz, from: -ix, to: ix, out: 1 }, []],
        [{ axis: 'x', fixed: -ix, from: -iz, to: iz, out: 1 }, [[-0.5, 0.5]]],
        [{ axis: 'x', fixed: ix, from: -iz, to: iz, out: -1 }, [[-0.5, 0.5]]],
        [{ axis: 'z', fixed: iz, from: -ix, to: -DOOR_HALF, out: -1 }, [[-2.3, -1.65]]],
        [{ axis: 'z', fixed: iz, from: DOOR_HALF, to: ix, out: -1 }, [[1.65, 2.3]]],
    ];
    for (const [f, windows] of inside) {
        faceBox(b, f, f.from, f.to, 0, GF_H, -0.02, 0.01, PLASTER);
        faceBox(b, f, f.from, f.to, 0, WAINSCOT, 0, 0.03, TRUNK.clone().multiplyScalar(0.85));
        faceBox(b, f, f.from, f.to, WAINSCOT, WAINSCOT + 0.06, 0, 0.05, BEAM); // 板の上の見切り
        for (const [a, e] of windows) {
            windowPane(b, f, a, e, 1.0, 2.0, BEAM);
            faceBox(b, f, a - 0.08, e + 0.08, 0.92, 1.0, 0, 0.12, BEAM); // 窓台
        }
    }
    faceBox(b, { axis: 'z', fixed: iz, from: -DOOR_HALF, to: DOOR_HALF, out: -1 }, -DOOR_HALF, DOOR_HALF, DOOR_TOP, GF_H, -0.02, 0.01, PLASTER);
    // ---- 床と天井 ----
    for (let x = -ix, i = 0; x < ix - 0.02; x += 0.32, i++) {
        const xe = Math.min(x + 0.32, ix);
        b.box(x + 0.01, 0, -iz, xe - 0.01, 0.04, iz, FLOOR.clone().multiplyScalar(0.88 + rand() * 0.2), ['ny']);
    }
    b.box(-ix, -0.02, -iz, ix, 0.02, iz, BARK, ['ny']); // 板のすきまの奥
    b.box(-DOOR_HALF, 0, iz, DOOR_HALF, 0.04, hz - 0.1, FLOOR, ['ny']); // 戸口の敷居
    b.box(-ix, GF_H - 0.04, -iz, ix, GF_H, iz, TRUNK.clone().multiplyScalar(1.05)); // 天井板
    for (let z = -iz + 0.6; z < iz - 0.3; z += 1.1)
        b.box(-ix, GF_H - 0.24, z - 0.08, ix, GF_H - 0.04, z + 0.08, BEAM); // 天井の梁
    // ---- 屋根 ----
    const eaveY = GF_H + BAND;
    b.box(-hx - 0.05, GF_H, -hz - 0.05, hx + 0.05, eaveY, hz + 0.05, BEAM); // 壁の上の梁の帯
    const rise = hx * Math.tan(SHOP_PITCH);
    const gHalf = hx - UNDER_ROOF / Math.sin(SHOP_PITCH);
    const gRise = rise - UNDER_ROOF / Math.cos(SHOP_PITCH);
    for (const out of [1, -1])
        gable(b, { axis: 'z', fixed: out * hz, from: -gHalf, to: gHalf, out }, eaveY, gHalf, gRise);
    const ridgeY = eaveY + rise;
    gableRoof(b, rand, new THREE.Vector3(0, ridgeY, 0), new THREE.Vector3(0, 0, 1), hx + EAVE_OVER, SHOP_PITCH, (hz + GABLE_OVER) * 2);
    // ---- 売り台 ----
    const cz0 = COUNTER_FRONT - COUNTER_D;
    const cz1 = COUNTER_FRONT;
    b.box(-COUNTER_HALF, 0, cz0, COUNTER_HALF, COUNTER_H - 0.05, cz1, TRUNK.clone().multiplyScalar(0.9), ['ny']);
    for (let x = -COUNTER_HALF + 0.25; x < COUNTER_HALF - 0.1; x += 0.5)
        b.box(x - 0.02, 0, cz1, x + 0.02, COUNTER_H - 0.05, cz1 + 0.02, BEAM, ['ny']); // 前の板の継ぎ目
    b.box(-COUNTER_HALF - 0.06, COUNTER_H - 0.05, cz0 - 0.04, COUNTER_HALF + 0.06, COUNTER_H, cz1 + 0.06, BARK.clone().multiplyScalar(1.3));
    colliderBox(g, solids, -COUNTER_HALF - 0.06, 0, cz0 - 0.04, COUNTER_HALF + 0.06, COUNTER_H, cz1 + 0.06);
    // 売り台の上：広げた地図、巻いた地図の束、インク壺と羽ペン
    deskMap(b, -0.35, COUNTER_H, (cz0 + cz1) / 2 + 0.02, 0.62, 0.44, 0.08);
    const rollDir = new THREE.Vector3(0.15, 0, 1).normalize();
    const rz = (cz0 + cz1) / 2;
    for (const [x, y] of [[0.95, 0], [1.05, 0], [1.0, 1]]) {
        const r = 0.042;
        roll(b, new THREE.Vector3(x, COUNTER_H + r + y * r * 1.7, rz), rollDir, 0.5, r, PAPER.clone().multiplyScalar(0.92 + rand() * 0.1));
    }
    const inkX = 0.45;
    const inkZ = cz0 + 0.18;
    b.add(CYL, inkX, COUNTER_H + 0.04, inkZ, 0.045, 0.08, 0.045, BARK.clone().multiplyScalar(0.5));
    b.beam(new THREE.Vector3(inkX, COUNTER_H + 0.05, inkZ), new THREE.Vector3(inkX + 0.08, COUNTER_H + 0.3, inkZ - 0.05), new THREE.Vector3(0, 0, 1), 0.035, 0.008, PAPER);
    // ---- 奥の壁：真ん中に海図、左右に巻いた地図を並べた棚 ----
    const back = { axis: 'z', fixed: -iz, from: -ix, to: ix, out: 1 };
    wallChart(b, back, -0.8, 0.8, 1.3, 2.45);
    for (const side of [-1, 1]) {
        const x0 = side * SHELF_FROM;
        const x1 = side * SHELF_TO;
        const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
        for (const x of [xa, xb])
            b.box(x - 0.04, 0, -iz, x + 0.04, SHELF_LEVELS[SHELF_LEVELS.length - 1] + 0.3, -iz + SHELF_DEPTH, BEAM); // 側板
        for (const y of [0.08, ...SHELF_LEVELS]) {
            b.box(xa, y - 0.04, -iz, xb, y, -iz + SHELF_DEPTH, TRUNK.clone().multiplyScalar(1.05));
            if (y > SHELF_LEVELS[SHELF_LEVELS.length - 2])
                continue; // いちばん上の棚板の上には何も置かない
            // 巻いた地図を、口をこちらへ向けて積む
            for (let x = xa + 0.1; x < xb - 0.08; x += 0.1) {
                if (rand() < 0.15)
                    continue;
                const r = 0.035 + rand() * 0.012;
                const len = SHELF_DEPTH - 0.02 - rand() * 0.05;
                const tint = PAPER.clone().multiplyScalar(0.85 + rand() * 0.18);
                if (rand() < 0.2)
                    tint.lerp(TRUNK, 0.25); // 古びた紙
                roll(b, new THREE.Vector3(x, y + r, -iz + len / 2 + 0.01), new THREE.Vector3(0, 0, 1), len, r, tint);
                if (rand() < 0.5)
                    roll(b, new THREE.Vector3(x + 0.05, y + r * 2.7, -iz + len / 2 + 0.03), new THREE.Vector3(0, 0, 1), len - 0.04, r * 0.9, tint.clone().multiplyScalar(0.95));
            }
        }
        colliderBox(g, solids, xa - 0.04, 0, -iz, xb + 0.04, SHELF_LEVELS[SHELF_LEVELS.length - 1] + 0.3, -iz + SHELF_DEPTH);
    }
    // ---- 左の手前：地球儀をのせた小さな丸机 ----
    const gx = -ix + 0.65;
    const gz = iz - 1.1;
    b.add(CYL, gx, 0.36, gz, 0.06, 0.72, 0.06, BEAM);
    b.add(CYL, gx, 0.02, gz, 0.28, 0.04, 0.28, BEAM);
    b.add(CYL, gx, 0.74, gz, 0.4, 0.04, 0.4, TRUNK.clone().multiplyScalar(1.05));
    b.add(CYL, gx, 0.81, gz, 0.07, 0.1, 0.07, BARK);
    b.add(BALL, gx, 1.1, gz, 0.24, 0.24, 0.24, WATER.clone().lerp(SAND, 0.2));
    for (const [ry, rx, s] of [[0.3, 0.2, 0.12], [2.1, -0.3, 0.09], [4.0, 0.5, 0.1], [5.2, -0.1, 0.07]]) {
        // 球の表面に大陸の染みをのせる
        const p = new THREE.Vector3(Math.cos(ry) * Math.cos(rx), Math.sin(rx), Math.sin(ry) * Math.cos(rx)).multiplyScalar(0.215);
        b.add(BALL, gx + p.x, 1.1 + p.y, gz + p.z, s, s * 0.8, s, GRASS.clone().lerp(SAND, 0.3), ry);
    }
    b.oriented(CYL, new THREE.Vector3(gx, 1.1, gz), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), 0.27, 0.025, 0.27, BARK.clone().multiplyScalar(1.2)); // 子午線の輪（細い円盤で見せる）
    colliderCyl(g, solids, gx, 0, gz, 0.42, 1.35);
    // ---- 右の手前：巻いた地図を立てて入れた樽 ----
    const bx = ix - 0.55;
    const bz = iz - 1.0;
    const wood = TRUNK.clone().multiplyScalar(0.9);
    b.add(CYL, bx, 0.38, bz, 0.34, 0.76, 0.34, wood);
    for (const y of [0.12, 0.64])
        b.add(CYL, bx, y, bz, 0.35, 0.05, 0.35, BARK.clone().multiplyScalar(0.8));
    for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        const rr = i === 0 ? 0 : 0.17;
        const len = 0.7 + rand() * 0.25;
        roll(b, new THREE.Vector3(bx + Math.cos(a) * rr, 0.45 + len / 2, bz + Math.sin(a) * rr), new THREE.Vector3(Math.cos(a) * 0.12, 1, Math.sin(a) * 0.12).normalize(), len, 0.04, PAPER.clone().multiplyScalar(0.85 + rand() * 0.15));
    }
    colliderCyl(g, solids, bx, 0, bz, 0.36, 0.8);
    // ---- 戸口から売り台までの敷物と、天井から下げたランタン ----
    b.box(-0.9, 0.04, cz1 + 0.35, 0.9, 0.055, iz - 0.2, ACCENT.clone().lerp(BARK, 0.35), ['ny']);
    b.box(-0.75, 0.055, cz1 + 0.5, 0.75, 0.06, iz - 0.35, SAND.clone().lerp(ACCENT, 0.3), ['ny']);
    const lz = (cz1 + iz) / 2;
    b.add(CYL, 0, GF_H - 0.32, lz, 0.012, 0.16, 0.012, BARK);
    glass.box(-0.11, GF_H - 0.64, lz - 0.11, 0.11, GF_H - 0.42, lz + 0.11, SAND.clone().multiplyScalar(1.08)); // 明かりの窓
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        b.box(cx * 0.11 - 0.015, GF_H - 0.64, lz + cz * 0.11 - 0.015, cx * 0.11 + 0.015, GF_H - 0.42, lz + cz * 0.11 + 0.015, BEAM); // 窓の枠の柱
    lamps.add(g, new THREE.Vector3(0, GF_H - 0.53, lz), LANTERN_INTENSITY, LANTERN_RANGE);
    b.box(-0.14, GF_H - 0.44, lz - 0.14, 0.14, GF_H - 0.39, lz + 0.14, BEAM);
    b.box(-0.13, GF_H - 0.68, lz - 0.13, 0.13, GF_H - 0.63, lz + 0.13, BEAM);
    // ---- 正面の看板：戸口の右に下げた、巻いた地図と方位の印の板 ----
    const sf = { axis: 'z', fixed: hz, from: -hx, to: hx, out: 1 };
    const sa = DOOR_HALF + 0.55;
    const iron = BARK.clone().lerp(ROCK, 0.25).multiplyScalar(0.55);
    faceBox(b, sf, sa - 0.04, sa + 0.04, 2.5, 2.57, 0, 1.15, iron);
    b.beam(facePoint3(sf, sa, 2.05, 0.1), facePoint3(sf, sa, 2.52, 0.8), new THREE.Vector3(1, 0, 0), 0.05, 0.05, iron);
    for (const off of [0.45, 1.0])
        faceBox(b, sf, sa - 0.01, sa + 0.01, 2.3, 2.5, off - 0.01, off + 0.01, iron);
    faceBox(b, sf, sa - 0.03, sa + 0.03, 1.7, 2.3, 0.35, 1.1, TRUNK.clone().multiplyScalar(1.1));
    for (const side of [-1, 1]) {
        const x = sa + side * 0.04;
        const p = facePoint3(sf, x, 2.08, 0.72);
        roll(b, p, new THREE.Vector3(0, 0, 1), 0.5, 0.06, PAPER);
        faceBox(b, sf, x - 0.005, x + 0.005, 1.8, 1.96, 0.71, 0.73, ACCENT); // 方位の針
        faceBox(b, sf, x - 0.005, x + 0.005, 1.87, 1.89, 0.64, 0.8, BARK);
    }
    g.add(b.mesh());
    g.add(glassMesh(glass));
    // ---- 当たり判定：壁（正面は戸口の左右と上） ----
    colliderBox(g, solids, -hx - 0.12, 0, -hz - 0.12, hx + 0.12, GF_H, -iz);
    colliderBox(g, solids, -hx - 0.12, 0, -iz, -ix, GF_H, iz);
    colliderBox(g, solids, ix, 0, -iz, hx + 0.12, GF_H, iz);
    colliderBox(g, solids, -hx - 0.12, 0, iz, -DOOR_HALF, GF_H, hz + 0.12);
    colliderBox(g, solids, DOOR_HALF, 0, iz, hx + 0.12, GF_H, hz + 0.12);
    colliderBox(g, solids, -DOOR_HALF, DOOR_TOP, iz, DOOR_HALF, GF_H, hz + 0.12);
    colliderBox(g, solids, -hx - 0.12, GF_H, -hz - 0.12, hx + 0.12, eaveY, hz + 0.12); // 天井
    g.updateMatrixWorld(true);
    const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
    return {
        keeperSpot: { position: toWorld(0, 0, KEEPER_Z), yaw: spot.yaw },
        corners: [toWorld(-hx, 0, -hz), toWorld(hx, 0, -hz), toWorld(hx, 0, hz), toWorld(-hx, 0, hz)],
    };
}
