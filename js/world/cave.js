import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { chartRandom } from '../items/islandChart.js';
// 海図に載せた島の洞窟。島の斜面をならした平らな所から、入口のトンネルが坂になって地下へ下り、地下の部屋に出る。
// 地下の部屋からはさらにトンネルが枝分かれし、より深い部屋へ続く（部屋とトンネルの網）。
// 形の作り方：島の下を細かい立方体のマス（VOXEL）に区切り、岩で埋まっている所からトンネル（楕円の断面の管）と
// 部屋（角の丸い箱のような形に、小部屋を重ねたもの）を削り取る。壁はノイズで削ってでこぼこにする。
// 削った所と岩の境目だけを三角形にする（サーフェスネッツ法：境目をまたぐマスごとに頂点を1つ置き、境目をまたぐ辺ごとに四角形を張る）。
// 削る形どうしは重ねるだけで1つの穴になるので、部屋とトンネルのつなぎ目に特別な処理はいらない。
// - 地面は高さだけで決めている。入口のトンネルは地面から顔を出し、そこだけ地面を切り抜く（caveHole()。HeightField の hole）。
//   切り抜く穴は削った穴より少し小さくし、地面のふちが削った壁に少しかぶさるようにする（すきまから外が見えないように）
// - 入口のほかは、削った所の上に岩を CLEAR 残す（地面から突き抜けない）。上の地面は world/isle.ts が盛っておく
// - 海の水面は島じゅうに張った1枚の面なので、洞窟の上（caveDry()）では海の水を消す。だから海面より深く掘れる
// 表は削った側（空洞）に向ける（当たり判定で、床の表が上を向くように）。殻は外側（影を落とす）と内側（色を塗る）の2枚の面で描く。
// 場所と形は島の地図の種から決まるので、誰の画面でも同じ（共有の状態は持たない）
const VOXEL = 1; // 削るマスの大きさ（m）
const ROCK = -3; // 何も削っていないマスの値
const NOISE_AMP = 1.1; // 壁を削るノイズの大きさ（m）
const NOISE_FREQ = 0.16; // 壁を削るノイズの細かさ（1m あたり）
const FINE_AMP = 0.35; // 壁の細かいでこぼこの大きさ（m）
const FINE_FREQ = 0.55;
const FLOOR_NOISE = 0.25; // 床のでこぼこの大きさ（m。歩けるよう小さく）
const FLOOR_FREQ = 0.3;
const TUBE_CENTER = 0.45; // トンネルの断面の楕円の中心の、床からの高さ（トンネルの高さに対する割合）
const TUBE_HALF = 0.6; // 断面の楕円の高さの半分（トンネルの高さに対する割合）。床より下は平らな床で切る
/** トンネルの天井の、床からの高さ（トンネルの高さに対する割合） */
export const TUBE_TOP = TUBE_CENTER + TUBE_HALF;
const ROOM_CENTER = 0.25; // 部屋の形の中心の、床からの高さ（部屋の高さに対する割合）。下は平らな床で切る
/** 入口のほかで、削った所の上に残す岩の厚さ（m）。マス2つ分より薄いと、天井と地面の境目が同じマスに入って面が欠ける */
export const CLEAR = 2;
/** 削った所の天井が、形の天井よりノイズで上がる分と、その上に残す岩の厚さ（m）。上の地面はこれだけ盛る */
export const ROOF_PAD = NOISE_AMP + FINE_AMP + CLEAR;
const RIM = 1.2; // 入口の、地面の近くで穴を広げる幅（m。ふちの角を丸く削る）
const RIM_DEPTH = 1.6; // 地面からどの深さまで広げるか（m）
/** 入口の穴の幅の半分が、トンネルの幅の半分より広がる分の最大（m） */
export const MOUTH = RIM + NOISE_AMP + FINE_AMP;
const HOLE_DEPTH = 0.3; // 地面を切り抜く穴は、地面からこの深さで削った形にする（m）
const RIM_LIFT = 0.35; // 入口のふちで、壁の上の端を地面よりこれだけ上まで伸ばす（m。地面の切り口の下にすきまが見えないように、地面に食いこませる）
const HOLE_MARGIN = 0.5; // 地面を切り抜く穴を、削った穴よりこれだけ小さくする（m。地面のふちを、地面より上まで上げた壁のふちに少しかぶせる）
const SPREAD_MIN = 0.55; // 向きによる広さの伸び縮みの、縮む側の下限（倍率）
export const ROOM_JOIN = 0.6; // トンネルの端を、地下の部屋の中心から口の向きへどこまで入れるか（その向きの部屋の半径に対する割合）
export const DRY_PAD = 2.5; // 洞窟の壁から外へ、海の水を消す（水面を描かない・泳がない）範囲を広げる幅（m）
// 穴のまわりの岩
const LINTEL = { along: 2.0, up: 1.9, out: 0.4, lift: 0.4, back: 0.8 }; // トンネルの口の上にかぶせる岩（奥行き・高さ・穴の幅からはみ出す長さ・地面から中心までの高さ（m）、奥行きのうち口より奥へ置く割合）
const JAMB_R = { min: 1.1, max: 1.5 }; // 口の上の岩の両脇に置く岩の大きさ（m）
const BOULDERS = { min: 3, max: 5 }; // 穴の両脇に置く岩の数
const BOULDER_R = { min: 0.7, max: 1.5 }; // 両脇の岩の大きさ（m）
const BOULDER_GAP = { min: 0.6, max: 2.2 }; // 穴のふちから岩の中心までの距離に、岩の大きさに足す分（m）
// 鍾乳石（地下の部屋の天井から下がる。見た目だけ）
const DRIP_SPOT = 0.7; // 天井のどこまで外側に下げるか（部屋の縁を 1 とした割合）
const DRIP_LEN = { min: 0.6, max: 2.6 }; // 長さ（m）
const DRIP_R = { min: 0.15, max: 0.5 }; // 根元の太さ（m）
const DRIP_CLEAR = 2.6; // 床から先までのすきまの最小（m。頭がぶつからないように）
const DRIP_STEP = 0.3; // 天井を探すときに上へ調べる間隔（m）
const OUTSIDE = new THREE.Color(PALETTE.rock).multiplyScalar(0.82); // 外側の岩の色（斜面の岩肌に溶け込まないよう少し暗く）
const MOUTH_LIGHT = 0.95; // 入口の、地面に近い岩の明るさ（外側に対する割合）
const INSIDE_DARK = 0.85; // 地面から少し下った所の岩の明るさ。洞窟の暗さは岩の色でなく、日の光を届かせないことで出す（main.ts の caveDarkness()）
const DEEP_DARK = 0.7; // いちばん深い所の岩の明るさ
const MOUTH_FADE = 6; // 入口の明るい岩から、中の岩の明るさに変わるまでの深さ（m）
const waveSum = (list, t) => list.reduce((n, w) => n + w.amp * Math.cos(w.k * t + w.phase), 0);
/** 向き t の広さの倍率 */
const spread = (c, t) => (c.shape ? Math.max(SPREAD_MIN, 1 + waveSum(c.shape.lobes, t)) : 1);
/** 壁を削るノイズで、形より外へ広がる分の最大（m） */
const roughness = (c) => (c.shape?.rough ?? 1) * NOISE_AMP + FINE_AMP;
/** (x, z) をドームから見た座標にする（l は向き、s は横） */
export function caveLocal(c, x, z) {
    const dx = x - c.x;
    const dz = z - c.z;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    return { l: dx * cs + dz * sn, s: -dx * sn + dz * cs };
}
/** (x, z) がドームの中心から見て、縁を 1 とした距離 */
export function domeQ(c, x, z) {
    const { l, s } = caveLocal(c, x, z);
    return Math.hypot(l / c.a, s / c.b) / spread(c, Math.atan2(s / c.b, l / c.a));
}
/** ドームの中心から、世界の向き ang（+X から +Z へ回る角度）の縁までの距離 */
export function domeRadius(c, ang) {
    const p = ang - c.yaw;
    return spread(c, Math.atan2(Math.sin(p) / c.b, Math.cos(p) / c.a)) / Math.hypot(Math.cos(p) / c.a, Math.sin(p) / c.b);
}
/** 天井のいちばん高い所の、床からの高さ（小部屋と、壁を削るノイズで上がる分も入れる） */
export function domeTop(c) {
    return Math.max(c.h, ...(c.shape?.blobs.map((b) => b.h) ?? [])) + roughness(c);
}
/** 重ねた小部屋が、部屋の中心からいちばん遠くまで届く距離 */
const blobReach = (c) => Math.max(0, ...(c.shape?.blobs.map((b) => Math.hypot(b.l, b.s) + Math.max(b.a, b.b)) ?? []));
/** 部屋の中心から縁までのいちばん遠い距離（小部屋と、ノイズで広がる分も入れる） */
export function domeSpan(c) {
    return Math.max(Math.max(c.a, c.b) * (1 + (c.shape?.lobes.reduce((n, w) => n + Math.abs(w.amp), 0) ?? 0)), blobReach(c)) + roughness(c);
}
/** 部屋の中心から、世界の向き ang の壁がいちばん外へ出た所までの距離（小部屋も入れる） */
export function domeReach(c, ang) {
    return Math.max(domeRadius(c, ang), blobReach(c)) + roughness(c);
}
/** (x, z) が穴のまわりの平らな所か、穴のそばの岩の所か（木や草を生やさない所） */
export function nearCave(c, x, z) {
    if (domeQ(c, x, z) < 1.2)
        return true;
    const t = c.tunnels[0];
    return alongPath(t.pts, 0, Math.min(t.trench + 2, t.pts.length - 1), x, z).d < t.w + MOUTH + BOULDER_GAP.max + BOULDER_R.max * 2;
}
/** 折れ線 pts の from〜to 番目の区間で、(x, z) にいちばん近い所の横の距離と、そこの床の高さ（区間の外へはみ出す所は Infinity） */
export function alongPath(pts, from, to, x, z) {
    let best = { d: Infinity, y: 0 };
    for (let i = from; i < to; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        const vx = q.x - p.x;
        const vz = q.z - p.z;
        const len2 = vx * vx + vz * vz;
        const t = ((x - p.x) * vx + (z - p.z) * vz) / len2;
        if (t < 0 || t > 1)
            continue;
        const d = Math.abs((x - p.x) * vz - (z - p.z) * vx) / Math.sqrt(len2);
        if (d < best.d)
            best = { d, y: p.y + (q.y - p.y) * t };
    }
    // 折れ目の外側のすきまは、点からの距離で埋める
    for (let i = from + 1; i < to; i++) {
        const d = Math.hypot(x - pts[i].x, z - pts[i].z);
        if (d < best.d)
            best = { d, y: pts[i].y };
    }
    return best;
}
/** (x, z) が、点の並び pts を pad だけ広げた四角の中か（遠い所を早く外すため） */
export function nearBox(pts, x, z, pad) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
    }
    return x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad;
}
/** (x, z) が洞窟のトンネル・地下の部屋の上か（海の水を消す所。洞窟の上の地面は海面より高いので、外からは変わらない） */
export function caveDry(c, x, z) {
    for (const t of c.tunnels) {
        const pad = t.w + (t.from < 0 ? MOUTH : NOISE_AMP + FINE_AMP) + DRY_PAD;
        if (!nearBox(t.pts, x, z, pad))
            continue;
        if (alongPath(t.pts, 0, t.pts.length - 1, x, z).d < pad || Math.hypot(x - t.pts[0].x, z - t.pts[0].z) < pad)
            return true;
    }
    return c.rooms.some((r) => Math.hypot(x - r.x, z - r.z) < domeReach(r, Math.atan2(z - r.z, x - r.x)) + DRY_PAD);
}
// ---- 削る形 ----
/** 座標の整数ごとの乱数（0〜1） */
function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** 3次元のなめらかなノイズ（-1〜1）。座標の整数ごとの乱数を、なめらかにつなぐ */
function noise3(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const lerp = (a, b, t) => a + (b - a) * t;
    const plane = (y0) => lerp(lerp(hash3(ix, y0, iz), hash3(ix + 1, y0, iz), ux), lerp(hash3(ix, y0, iz + 1), hash3(ix + 1, y0, iz + 1), ux), uz);
    return lerp(plane(iy), plane(iy + 1), uy) * 2 - 1;
}
const smooth01 = (t) => {
    const k = Math.min(Math.max(t, 0), 1);
    return k * k * (3 - 2 * k);
};
const carvings = new WeakMap();
function carving(c) {
    const known = carvings.get(c);
    if (known)
        return known;
    const rand = chartRandom(c.seed + 9);
    const ox = rand() * 1000;
    const oy = rand() * 1000;
    const oz = rand() * 1000;
    const carvers = [];
    const pad = NOISE_AMP * 1.6 + FINE_AMP + VOXEL;
    // トンネル：区間ごとに、楕円の断面の管（両端は丸い）。床は平らに切る
    for (const t of c.tunnels) {
        for (let i = 0; i < t.pts.length - 1; i++) {
            const p = t.pts[i];
            const q = t.pts[i + 1];
            const vx = q.x - p.x;
            const vz = q.z - p.z;
            const len2 = vx * vx + vz * vz || 1;
            const cy = t.th * TUBE_CENTER;
            const hy = t.th * TUBE_HALF;
            const scale = Math.min(t.w, hy);
            const open = t.from < 0 && i <= t.trench;
            const side = t.w + pad + (open ? RIM : 0);
            carvers.push({
                x0: Math.min(p.x, q.x) - side,
                x1: Math.max(p.x, q.x) + side,
                z0: Math.min(p.z, q.z) - side,
                z1: Math.max(p.z, q.z) + side,
                y0: Math.min(p.y, q.y) - pad,
                y1: Math.max(p.y, q.y) + t.th * TUBE_TOP + pad + (open ? RIM : 0),
                open,
                rough: 1,
                shape(x, y, z, g, out) {
                    const u = Math.min(Math.max(((x - p.x) * vx + (z - p.z) * vz) / len2, 0), 1);
                    const yf = p.y + (q.y - p.y) * u;
                    const d = Math.hypot(x - p.x - vx * u, z - p.z - vz * u);
                    let wall = (1 - Math.hypot(d / t.w, (y - yf - cy) / hy)) * scale;
                    // 入口：地面の近くほど穴を広げ、ふちの角を丸くする
                    if (open && g - y < RIM_DEPTH)
                        wall += RIM * smooth01(1 - Math.max(g - y, 0) / RIM_DEPTH);
                    out[0] = wall;
                    out[1] = yf;
                },
            });
        }
    }
    // 地下の部屋：角の丸い箱のような形（roof が大きいほど箱に近い）に、小部屋を重ねる。床は平らに切る
    for (const r of c.rooms) {
        const cs = Math.cos(r.yaw);
        const sn = Math.sin(r.yaw);
        const e = r.shape?.roof ?? 2;
        const span = domeSpan(r) + pad;
        /** 床が r.floor の、中心 (l, s)・大きさ a, b, h の形の内側への深さ（spr は向きによる広さの倍率） */
        const body = (l, s, y, a, b, h, spr) => {
            const rh = Math.hypot(l / a, s / b) / spr;
            const dy = Math.abs((y - r.floor - h * ROOM_CENTER) / (h * (1 - ROOM_CENTER)));
            const q = (rh ** e + dy ** e) ** (1 / e);
            return (1 - q) * Math.min(a, b, h * (1 - ROOM_CENTER));
        };
        carvers.push({
            x0: r.x - span,
            x1: r.x + span,
            z0: r.z - span,
            z1: r.z + span,
            y0: r.floor - pad,
            y1: r.floor + domeTop(r) + pad,
            open: false,
            rough: r.shape?.rough ?? 1,
            shape(x, y, z, _g, out) {
                const dx = x - r.x;
                const dz = z - r.z;
                const l = dx * cs + dz * sn;
                const s = -dx * sn + dz * cs;
                let v = body(l, s, y, r.a, r.b, r.h, spread(r, Math.atan2(s / r.b, l / r.a)));
                for (const b of r.shape?.blobs ?? [])
                    v = Math.max(v, body(l - b.l, s - b.s, y, b.a, b.b, b.h, 1));
                out[0] = v;
                out[1] = r.floor;
            },
        });
    }
    const made = {
        carvers,
        noise(x, y, z, out) {
            out[0] =
                NOISE_AMP * noise3(x * NOISE_FREQ + ox, y * NOISE_FREQ * 1.4 + oy, z * NOISE_FREQ + oz) +
                    FINE_AMP * noise3(x * FINE_FREQ + oz, y * FINE_FREQ + ox, z * FINE_FREQ + oy);
            out[1] = FLOOR_NOISE * noise3(x * FLOOR_FREQ + oy, 0.5, z * FLOOR_FREQ + ox);
        },
    };
    carvings.set(c, made);
    return made;
}
/** 削る形1つの値（正なら削る）。base はノイズなしの形（Carver.shape の結果）、n はノイズ（Carving.noise の結果）、g はそこの地面の高さ */
function carveValue(k, base, n, y, g) {
    const v = Math.min(base[0] + n[0] * k.rough, y - base[1] + n[1]);
    return k.open ? v : Math.min(v, g - CLEAR - y); // 入口のほかは、地面の下に岩を残す
}
/** (x, y, z) を削るか（正なら削る。g はそこの地面の高さ）。only を渡すと、それが true の形だけ調べる */
function carveAt(c, x, y, z, g, only) {
    const { carvers, noise } = carving(c);
    const base = new Float64Array(2);
    const n = new Float64Array(2);
    let noised = false;
    let v = ROCK;
    for (const k of carvers) {
        if (x < k.x0 || x > k.x1 || y < k.y0 || y > k.y1 || z < k.z0 || z > k.z1)
            continue;
        if (only && !only(k))
            continue;
        k.shape(x, y, z, g, base);
        if (!noised) {
            noise(x, y, z, n);
            noised = true;
        }
        v = Math.max(v, carveValue(k, base, n, y, g));
    }
    return v;
}
/**
 * 地面を切り抜く穴の中か。穴の中で正、ふちで 0、外で負（m）。g はそこの地面の高さ。
 * 入口のトンネルを地面から少し下で削った形を、HOLE_MARGIN だけ小さくしたもの
 */
export function caveHole(c, x, z, g) {
    const t = c.tunnels[0];
    if (!nearBox(t.pts.slice(0, t.trench + 2), x, z, t.w + MOUTH + 2))
        return -10;
    return carveAt(c, x, g - HOLE_DEPTH, z, g, (k) => k.open) - HOLE_MARGIN;
}
// ---- 形を三角形にする ----
/** 削った所と岩の境目を三角形にする（表は削った側）。ground は地面の高さ、dark(y, g) は高さ y・上の地面の高さ g の岩の明るさ */
function carveMesh(c, ground, dark) {
    const { carvers, noise } = carving(c);
    // マスの範囲：削る形の箱を全部含む
    const x0 = Math.min(...carvers.map((k) => k.x0)) - VOXEL * 2;
    const y0 = Math.min(...carvers.map((k) => k.y0)) - VOXEL * 2;
    const z0 = Math.min(...carvers.map((k) => k.z0)) - VOXEL * 2;
    const nx = Math.ceil((Math.max(...carvers.map((k) => k.x1)) + VOXEL * 2 - x0) / VOXEL) + 1;
    const ny = Math.ceil((Math.max(...carvers.map((k) => k.y1)) + VOXEL * 2 - y0) / VOXEL) + 1;
    const nz = Math.ceil((Math.max(...carvers.map((k) => k.z1)) + VOXEL * 2 - z0) / VOXEL) + 1;
    const at = (i, j, k) => i + nx * (k + nz * j);
    const carve = new Float32Array(nx * ny * nz).fill(ROCK);
    const g = new Float32Array(nx * nz);
    for (let k = 0; k < nz; k++)
        for (let i = 0; i < nx; i++)
            g[i + nx * k] = ground(x0 + i * VOXEL, z0 + k * VOXEL);
    // ノイズはマスごとに1回だけ計算する
    const noiseW = new Float32Array(nx * ny * nz).fill(NaN);
    const noiseF = new Float32Array(nx * ny * nz);
    const base = new Float64Array(2);
    const n = new Float64Array(2);
    const reach = NOISE_AMP * 1.6 + FINE_AMP;
    for (const k of carvers) {
        const i0 = Math.max(0, Math.floor((k.x0 - x0) / VOXEL));
        const i1 = Math.min(nx - 1, Math.ceil((k.x1 - x0) / VOXEL));
        const j0 = Math.max(0, Math.floor((k.y0 - y0) / VOXEL));
        const j1 = Math.min(ny - 1, Math.ceil((k.y1 - y0) / VOXEL));
        const k0 = Math.max(0, Math.floor((k.z0 - z0) / VOXEL));
        const k1 = Math.min(nz - 1, Math.ceil((k.z1 - z0) / VOXEL));
        for (let j = j0; j <= j1; j++) {
            const y = y0 + j * VOXEL;
            for (let kk = k0; kk <= k1; kk++) {
                const z = z0 + kk * VOXEL;
                for (let i = i0; i <= i1; i++) {
                    const x = x0 + i * VOXEL;
                    const id = at(i, j, kk);
                    const gg = g[i + nx * kk];
                    k.shape(x, y, z, gg, base);
                    if (base[0] + reach * k.rough < carve[id])
                        continue; // ノイズを足しても今の値を超えない
                    if (Number.isNaN(noiseW[id])) {
                        noise(x, y, z, n);
                        noiseW[id] = n[0];
                        noiseF[id] = n[1];
                    }
                    n[0] = noiseW[id];
                    n[1] = noiseF[id];
                    const v = carveValue(k, base, n, y, gg);
                    if (v > carve[id])
                        carve[id] = v;
                }
            }
        }
    }
    // 岩の値（正なら岩）：地面より下で、削っていない所
    const rock = new Float32Array(nx * ny * nz);
    for (let j = 0; j < ny; j++) {
        const y = y0 + j * VOXEL;
        for (let k = 0; k < nz; k++)
            for (let i = 0; i < nx; i++)
                rock[at(i, j, k)] = Math.min(g[i + nx * k] - y, -carve[at(i, j, k)]);
    }
    // マスごとの頂点：境目をまたぐマスの辺の、境目の点の平均
    const cellAt = (i, j, k) => i + (nx - 1) * (k + (nz - 1) * j);
    const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const verts = [];
    const corner = [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    const edges = [
        [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const vals = new Float32Array(8);
    for (let j = 0; j < ny - 1; j++) {
        for (let k = 0; k < nz - 1; k++) {
            for (let i = 0; i < nx - 1; i++) {
                let inside = 0;
                let carved = false;
                let above = false;
                for (let q = 0; q < 8; q++) {
                    const [a, b, d] = corner[q];
                    const id = at(i + a, j + b, k + d);
                    vals[q] = rock[id];
                    if (vals[q] > 0)
                        inside++;
                    if (carve[id] > 0)
                        carved = true;
                    if (g[i + a + nx * (k + d)] < y0 + (j + b) * VOXEL)
                        above = true;
                }
                if (inside === 0 || inside === 8)
                    continue;
                let sx = 0;
                let sy = 0;
                let sz = 0;
                let m = 0;
                for (const [p, q] of edges) {
                    if (vals[p] > 0 === vals[q] > 0)
                        continue;
                    const t = vals[p] / (vals[p] - vals[q]);
                    sx += corner[p][0] + (corner[q][0] - corner[p][0]) * t;
                    sy += corner[p][1] + (corner[q][1] - corner[p][1]) * t;
                    sz += corner[p][2] + (corner[q][2] - corner[p][2]) * t;
                    m++;
                }
                const vx = x0 + (i + sx / m) * VOXEL;
                const vz = z0 + (k + sz / m) * VOXEL;
                let vy = y0 + (j + sy / m) * VOXEL;
                // 入口のふち（削った所が地面に出ているマス）：壁の上の端を地面より少し上まで上げ、地面とすきまなくつなぐ
                if (carved && above)
                    vy = Math.max(vy, ground(vx, vz) + RIM_LIFT);
                cellVert[cellAt(i, j, k)] = verts.length / 3;
                verts.push(vx, vy, vz);
            }
        }
    }
    // 境目をまたぐ辺ごとに、まわりの4つのマスの頂点で四角形を張る。地面の境目（削っていない所と地面の上の境目）は張らない
    const positions = [];
    const colors = [];
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const C = new THREE.Vector3();
    const D = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const col = new THREE.Color();
    const vert = (v, id) => v.set(verts[id * 3], verts[id * 3 + 1], verts[id * 3 + 2]);
    const pushTri = (p, q, r) => {
        const cy = (p.y + q.y + r.y) / 3;
        const gy = ground((p.x + q.x + r.x) / 3, (p.z + q.z + r.z) / 3);
        col.copy(OUTSIDE).multiplyScalar(dark(cy, gy));
        for (const v of [p, q, r]) {
            positions.push(v.x, v.y, v.z);
            colors.push(col.r, col.g, col.b);
        }
    };
    // 軸ごと：辺の向き d と、辺を囲む2つの軸 u・v
    const axes = [
        { d: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
        { d: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
        { d: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    ];
    const ids = [0, 0, 0, 0];
    for (const { d, u, v } of axes) {
        for (let j = 0; j < ny; j++) {
            for (let k = 0; k < nz; k++) {
                for (let i = 0; i < nx; i++) {
                    const i2 = i + d[0];
                    const j2 = j + d[1];
                    const k2 = k + d[2];
                    if (i2 >= nx || j2 >= ny || k2 >= nz)
                        continue;
                    const ra = rock[at(i, j, k)];
                    const rb = rock[at(i2, j2, k2)];
                    if (ra > 0 === rb > 0)
                        continue;
                    // 空洞の側の端が削った所なら洞窟の壁（地面より上なだけの所は、地面のメッシュが描く）
                    if (carve[ra > 0 ? at(i2, j2, k2) : at(i, j, k)] <= 0)
                        continue;
                    // 辺を囲む4つのマス
                    let ok = true;
                    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b], q) => {
                        const ci = i - u[0] * (1 - a) - v[0] * (1 - b);
                        const cj = j - u[1] * (1 - a) - v[1] * (1 - b);
                        const ck = k - u[2] * (1 - a) - v[2] * (1 - b);
                        const id = ci < 0 || cj < 0 || ck < 0 || ci >= nx - 1 || cj >= ny - 1 || ck >= nz - 1 ? -1 : cellVert[cellAt(ci, cj, ck)];
                        if (id < 0)
                            ok = false;
                        ids[q] = id;
                    });
                    if (!ok)
                        continue;
                    vert(A, ids[0]);
                    vert(B, ids[1]);
                    vert(C, ids[2]);
                    vert(D, ids[3]);
                    // 表を削った側（空洞）へ向ける：岩から空洞へ向かう向きが辺の向きと同じか
                    const want = ra > 0 ? 1 : -1;
                    const nrm = e1.subVectors(C, A).cross(e2.subVectors(D, B));
                    if ((nrm.x * d[0] + nrm.y * d[1] + nrm.z * d[2]) * want > 0) {
                        pushTri(A, B, C);
                        pushTri(A, C, D);
                    }
                    else {
                        pushTri(A, C, B);
                        pushTri(A, D, C);
                    }
                }
            }
        }
    }
    return { positions, colors };
}
/** 地下の部屋の天井から下がる鍾乳石（1つのメッシュにまとめる。見た目だけで、当たり判定はない） */
function buildDrips(c, ground) {
    const positions = [];
    const colors = [];
    const cone = new THREE.ConeGeometry(1, 1, 5, 1).toNonIndexed();
    cone.rotateX(Math.PI); // 先を下に向ける（ConeGeometry は先が上）
    cone.translate(0, -0.5, 0); // 根元を原点に（先は y = -1）
    const unit = cone.getAttribute('position');
    const col = new THREE.Color(OUTSIDE).multiplyScalar(DEEP_DARK * 1.1);
    for (const r of c.rooms) {
        if (!r.shape)
            continue;
        const rand = chartRandom(r.seed + 3);
        const cs = Math.cos(r.yaw);
        const sn = Math.sin(r.yaw);
        for (let n = 0; n < r.shape.drips; n++) {
            const t = rand() * Math.PI * 2;
            const q = Math.sqrt(rand()) * DRIP_SPOT;
            const len0 = DRIP_LEN.min + rand() * (DRIP_LEN.max - DRIP_LEN.min);
            const rad = DRIP_R.min + rand() * (DRIP_R.max - DRIP_R.min);
            const tilt = rand() * Math.PI * 2;
            const l = r.a * q * spread(r, t) * Math.cos(t);
            const s = r.b * q * spread(r, t) * Math.sin(t);
            const x = r.x + l * cs - s * sn;
            const z = r.z + l * sn + s * cs;
            const g = ground(x, z);
            // 床から上へ、削っていない所（天井）を探す
            let ceil = NaN;
            for (let y = r.floor + DRIP_CLEAR; y < r.floor + domeTop(r) + 2; y += DRIP_STEP) {
                if (carveAt(c, x, y, z, g) <= 0) {
                    ceil = y - DRIP_STEP * 0.5;
                    break;
                }
            }
            if (Number.isNaN(ceil))
                continue;
            const len = Math.min(len0, ceil - r.floor - DRIP_CLEAR);
            if (len < DRIP_LEN.min)
                continue;
            for (let i = 0; i < unit.count; i++) {
                const ux = unit.getX(i);
                const uz = unit.getZ(i);
                const rx = ux * Math.cos(tilt) - uz * Math.sin(tilt);
                const rz = ux * Math.sin(tilt) + uz * Math.cos(tilt);
                positions.push(x + rx * rad, ceil + 0.4 + unit.getY(i) * (len + 0.4), z + rz * rad);
                colors.push(col.r, col.g, col.b);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}
/**
 * 穴のまわりの岩（1つのメッシュにまとめる）。トンネルの口の上にかぶせる大きな岩と、穴の両脇の岩。
 * 頂点は世界の座標で持つ（そのまま当たり判定の三角形にする）
 */
function buildBoulders(c) {
    const rand = chartRandom(c.seed + 2);
    const { pts, trench, w } = c.tunnels[0];
    const W = w + MOUTH * 0.7; // 穴のふちのあたり
    const a = pts[0];
    const b = pts[trench];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / len;
    const tz = (b.z - a.z) / len;
    const positions = [];
    const unit = new THREE.IcosahedronGeometry(1, 1).getAttribute('position');
    /** 穴の向きにそろえた岩を1つ足す。(l, sv) は穴の始まりから見た位置、r は奥行き・高さ・横の大きさ。minY より下の頂点は持ち上げる */
    const add = (l, sv, y, r, minY = -Infinity) => {
        const bumps = new Map();
        const cx = a.x + tx * l - tz * sv;
        const cz = a.z + tz * l + tx * sv;
        for (let i = 0; i < unit.count; i++) {
            const ux = unit.getX(i);
            const uy = unit.getY(i);
            const uz = unit.getZ(i);
            const key = `${ux.toFixed(3)},${uy.toFixed(3)},${uz.toFixed(3)}`;
            if (!bumps.has(key))
                bumps.set(key, 0.85 + rand() * 0.25);
            const k = bumps.get(key);
            const pl = ux * r[0] * k; // 穴の向き
            const ps = uz * r[2] * k; // 横
            positions.push(cx + tx * pl - tz * ps, Math.max(y + uy * r[1] * k, minY), cz + tz * pl + tx * ps);
        }
    };
    // トンネルの口の上：トンネルが地面の下に入る所にかぶせ、少し穴の上へ張り出す
    add(len + LINTEL.along * LINTEL.back, (rand() - 0.5) * 0.6, c.floor + LINTEL.lift, [LINTEL.along, LINTEL.up, W + LINTEL.out], c.floor - 0.25);
    // その両脇に岩を寄せ、口の形にする
    for (const side of [-1, 1]) {
        const r = JAMB_R.min + rand() * (JAMB_R.max - JAMB_R.min);
        add(len + r * 0.3, side * (W + r * 0.55), c.floor + r * 0.3, [r, r * (0.75 + rand() * 0.2), r * (0.85 + rand() * 0.2)], c.floor - 0.25);
    }
    // 穴の両脇：浅い所（入口）はあけておく
    const placed = [];
    const n = BOULDERS.min + Math.floor(rand() * (BOULDERS.max - BOULDERS.min + 1));
    for (let i = 0, tries = 0; i < n && tries < 60; tries++) {
        const r = BOULDER_R.min + rand() * (BOULDER_R.max - BOULDER_R.min);
        const l = len * (0.3 + rand() * 0.5); // 奥の角は口の脇の岩があるので、手前から半ばまで
        const sv = (rand() < 0.5 ? -1 : 1) * (W + r * 0.6 + BOULDER_GAP.min + rand() * (BOULDER_GAP.max - BOULDER_GAP.min));
        if (placed.some((o) => Math.hypot(o.l - l, o.sv - sv) < o.r + r + 0.3))
            continue;
        placed.push({ l, sv, r });
        add(l, sv, c.floor + r * 0.25, [r * (0.9 + rand() * 0.4), r * (0.6 + rand() * 0.3), r * (0.9 + rand() * 0.4)]);
        i++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: OUTSIDE, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
/**
 * 洞窟の壁（削った所の境目）と、天井の鍾乳石と、穴のまわりの岩。ground は地面の高さ（描いている地面の三角形そのもの）。
 * solids は当たり判定とねらいの対象にするメッシュ（1番目の内側の面は外側と同じ三角形）
 */
export function buildCave(c, ground) {
    const deepest = Math.min(...c.tunnels.flatMap((t) => t.pts.map((p) => p.y)), ...c.rooms.map((r) => r.floor));
    const top = c.floor;
    /** 高さ y・その上の地面の高さ g の岩の明るさ：入口の地面に近い所は明るく、深いほど暗く */
    const dark = (y, g) => {
        const inside = INSIDE_DARK + (DEEP_DARK - INSIDE_DARK) * Math.min(Math.max((top - y) / Math.max(top - deepest, 1), 0), 1);
        return MOUTH_LIGHT + (inside - MOUTH_LIGHT) * smooth01((g - y) / MOUTH_FADE);
    };
    const { positions, colors } = carveMesh(c, ground, dark);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // 外側の面（裏）は影を落とすため（洞窟の中に日の光が差しこまないように）
    const outer = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: OUTSIDE, flatShading: true, side: THREE.BackSide }));
    outer.castShadow = true;
    outer.receiveShadow = true;
    const inner = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    inner.receiveShadow = true;
    const boulders = buildBoulders(c);
    const group = new THREE.Group();
    group.add(outer, inner, boulders, buildDrips(c, ground));
    return { group, solids: [outer, inner, boulders] };
}
