import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
export const WORLD_SIZE = 200;
const SEGMENTS = 90;
const STEP = WORLD_SIZE / SEGMENTS;
const HALF = WORLD_SIZE / 2;
const ISLAND_RADIUS = 58;
// 島の中心から海岸線までを 1 としたとき、高台から海底まで下る範囲（広いほど斜面がゆるい）
const SLOPE_INNER = 0.55;
const SLOPE_OUTER = 1.3;
export const SEA_FLOOR = -6;
const NORMAL_EPS = STEP; // 法線を求めるときに傾きを測る幅（広いほど陰影がなめらか）
// ---- ノイズ ----
function hash(ix, iz) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}
export function valueNoise(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uz) * 2 - 1;
}
export function fbm(x, z) {
    return valueNoise(x, z) * 0.6 + valueNoise(x * 2.1, z * 2.1) * 0.3 + valueNoise(x * 4.3, z * 4.3) * 0.1;
}
const smoothstep = THREE.MathUtils.smoothstep;
function rawHeight(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    // 海岸線を揺らして円形っぽさを消す
    const coast = ISLAND_RADIUS + Math.sin(a * 3 + 0.5) * 6 + Math.sin(a * 5 + 2.1) * 3.5 + Math.sin(a * 8) * 1.5;
    const land = 1 - smoothstep(r / coast, SLOPE_INNER, SLOPE_OUTER);
    let h = SEA_FLOOR + land * 8.5;
    // 大きな起伏はほぼ平らにする
    h += land * land * fbm(x * 0.03, z * 0.03) * 0.15;
    return h;
}
/**
 * 場所（島・街）ごとの地形。高さの関数 raw をグリッドの頂点で測り、その三角形を描いて歩く面にもする。
 * どの場所も WORLD_SIZE 四方で、中心が原点
 */
export class HeightField {
    raw;
    /** グリッド頂点の高さ（メッシュと歩行判定で共有する） */
    heights = new Float32Array((SEGMENTS + 1) * (SEGMENTS + 1));
    constructor(raw) {
        this.raw = raw;
        for (let j = 0; j <= SEGMENTS; j++) {
            for (let i = 0; i <= SEGMENTS; i++) {
                this.heights[j * (SEGMENTS + 1) + i] = raw(-HALF + i * STEP, -HALF + j * STEP);
            }
        }
    }
    h(i, j) {
        return this.heights[j * (SEGMENTS + 1) + i];
    }
    /** 描画されている三角形そのものの高さを返す */
    height(x, z) {
        const gx = (x + HALF) / STEP;
        const gz = (z + HALF) / STEP;
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        if (i < 0 || j < 0 || i >= SEGMENTS || j >= SEGMENTS)
            return SEA_FLOOR;
        const fx = gx - i;
        const fz = gz - j;
        const h00 = this.h(i, j);
        const h10 = this.h(i + 1, j);
        const h01 = this.h(i, j + 1);
        const h11 = this.h(i + 1, j + 1);
        if (fx + fz < 1)
            return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
        return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }
    /** 地形のメッシュ（砂浜・草地・岩肌に塗り分ける） */
    createMesh() {
        return buildTerrainMesh((i, j) => this.h(i, j), this.raw);
    }
}
/** 自分の島の地形 */
export const islandField = new HeightField(rawHeight);
/** 今プレイヤーがいる場所の地形（terrainHeight が使う） */
let activeField = islandField;
/** プレイヤーがいる場所を変えたときに、その場所の地形にする（自分の画面で使う地形が切り替わる） */
export function setActiveField(field) {
    activeField = field;
}
/** 今いる場所の、描画されている三角形そのものの高さを返す */
export function terrainHeight(x, z) {
    return activeField.height(x, z);
}
const SAND_TOP = 1.5; // これより低いところは砂浜
/** 負なら砂浜。ノイズで境界線をゆるやかに波打たせる */
function sandLine(p) {
    return p.y + fbm(p.x * 0.07 + 31, p.z * 0.07 - 17) * 0.45 - SAND_TOP;
}
const probe = new THREE.Vector3();
/** 砂浜か（地面の色分けと同じ境界線で判定する） */
export function isSandAt(x, z) {
    return sandLine(probe.set(x, terrainHeight(x, z), z)) < 0;
}
/** 草地（砂浜でも岩肌でもない）か。margin だけ砂浜の境界から内側に入ったところに限る */
export function isGrassAt(x, z, margin = 0) {
    const y = terrainHeight(x, z);
    if (sandLine(probe.set(x, y, z)) < margin)
        return false;
    const dx = terrainHeight(x + 0.5, z) - terrainHeight(x - 0.5, z);
    const dz = terrainHeight(x, z + 0.5) - terrainHeight(x, z - 0.5);
    return 1 / Math.hypot(1, dx, dz) >= 0.8; // 地面の色分けと同じく、急な斜面は岩肌
}
/** 自分の島の地形のメッシュ */
export function createTerrain() {
    return islandField.createMesh();
}
/** h(i, j) はグリッド頂点の高さ、raw は法線を求める高さの関数 */
function buildTerrainMesh(h, raw) {
    const positions = [];
    const colors = [];
    const sand = new THREE.Color(PALETTE.sand);
    const grass = new THREE.Color(PALETTE.grass);
    const rock = new THREE.Color(PALETTE.rock);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    // 多角形（凸、4頂点まで）を扇形に三角形分割して1色で塗る
    const pushPolygon = (poly, col) => {
        for (let k = 1; k + 1 < poly.length; k++) {
            for (const v of [poly[0], poly[k], poly[k + 1]]) {
                positions.push(v.x, v.y, v.z);
                colors.push(col.r, col.g, col.b);
            }
        }
    };
    // 砂浜と草地の境界線で三角形を切り分け、境目をギザギザでなく揺らいだ線にする
    const pushTri = (p, q, r) => {
        const normalY = ab.subVectors(q, p).cross(ac.subVectors(r, p)).normalize().y;
        const upper = normalY < 0.78 ? rock : grass;
        const tri = [p.clone(), q.clone(), r.clone()];
        const f = tri.map(sandLine);
        const below = [];
        const above = [];
        for (let k = 0; k < 3; k++) {
            const n = (k + 1) % 3;
            (f[k] < 0 ? below : above).push(tri[k]);
            if (f[k] < 0 !== f[n] < 0) {
                const cut = tri[k].clone().lerp(tri[n], f[k] / (f[k] - f[n]));
                below.push(cut);
                above.push(cut);
            }
        }
        if (below.length >= 3)
            pushPolygon(below, sand);
        if (above.length >= 3)
            pushPolygon(above, upper);
    };
    for (let j = 0; j < SEGMENTS; j++) {
        for (let i = 0; i < SEGMENTS; i++) {
            const x0 = -HALF + i * STEP;
            const z0 = -HALF + j * STEP;
            const p00 = new THREE.Vector3(x0, h(i, j), z0);
            const p10 = new THREE.Vector3(x0 + STEP, h(i + 1, j), z0);
            const p01 = new THREE.Vector3(x0, h(i, j + 1), z0 + STEP);
            const p11 = new THREE.Vector3(x0 + STEP, h(i + 1, j + 1), z0 + STEP);
            pushTri(a.copy(p00), b.copy(p01), c.copy(p10));
            pushTri(a.copy(p10), b.copy(p01), c.copy(p11));
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // 法線は三角形ごとではなく高さの関数の傾きから求め、面の継ぎ目が見えないなめらかな陰影にする
    const normals = [];
    const n = new THREE.Vector3();
    for (let k = 0; k < positions.length; k += 3) {
        const x = positions[k];
        const z = positions[k + 2];
        const dx = raw(x + NORMAL_EPS, z) - raw(x - NORMAL_EPS, z);
        const dz = raw(x, z + NORMAL_EPS) - raw(x, z - NORMAL_EPS);
        n.set(-dx, 2 * NORMAL_EPS, -dz).normalize();
        normals.push(n.x, n.y, n.z);
    }
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
}
