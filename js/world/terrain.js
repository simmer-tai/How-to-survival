import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { BLOTCH_HASH_GLSL, blotchGlsl } from '../core/materials.js';
export const WORLD_SIZE = 200; // 自分の島と街の広さ（m）。海図に載せた島は world/isle.ts の ISLE_SIZE
const CELL = WORLD_SIZE / 90; // 地形のグリッドの1マスの大きさ（m）。広い場所はマスの数を増やす
const ISLAND_RADIUS = 58;
// 島の中心から海岸線までを 1 としたとき、高台から海底まで下る範囲（広いほど斜面がゆるい）
const SLOPE_INNER = 0.55;
const SLOPE_OUTER = 1.3;
export const SEA_FLOOR = -6;
const NORMAL_EPS = CELL * 0.5; // 法線を求めるときに傾きを測る幅（広いほど陰影がなめらか。狭いほど小さな凹凸まで陰影に出る）
const SLOPE_SHADE = 0.18; // 草地が岩肌に変わる手前の急な斜面で、地面と草の色を暗くする割合（凹凸を見やすくする）
// 地面のドット絵（海の水面と同じく、四角いムラを場所から決めた乱数で散らし、色の明るさだけを変える）
const GROUND_BLOTCH = {
    dot: 0.5, // 1ドットの大きさ（m）
    stretch: 1,
    sizes: [3, 2, 1],
    bright: 1.04,
    dark: 0.95,
    brightRate: 0.12,
    darkRate: 0.16,
    fade: 120,
};
const ROCK_NORMAL_Y = 0.78; // 面の向きの上向き成分がこれより小さい（急な）所は岩肌
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
export class HeightField {
    raw;
    size;
    look;
    /** 場所の中心から端までの距離（m） */
    half;
    /** 1辺のマスの数と、1マスの大きさ */
    segs;
    step;
    /** グリッド頂点の高さ（メッシュと歩行判定で共有する） */
    heights;
    constructor(raw, size = WORLD_SIZE, look = {}) {
        this.raw = raw;
        this.size = size;
        this.look = look;
        this.half = size / 2;
        this.segs = Math.round(size / CELL);
        this.step = size / this.segs;
        const n = this.segs + 1;
        this.heights = new Float32Array(n * n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                this.heights[j * n + i] = raw(-this.half + i * this.step, -this.half + j * this.step);
            }
        }
    }
    h(i, j) {
        return this.heights[j * (this.segs + 1) + i];
    }
    /** 描画されている三角形そのものの高さを返す */
    height(x, z) {
        const gx = (x + this.half) / this.step;
        const gz = (z + this.half) / this.step;
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        if (i < 0 || j < 0 || i >= this.segs || j >= this.segs)
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
    /** 海の水が来ない所（洞窟の中）か */
    isDry(x, z) {
        return this.look.dry?.(x, z) ?? false;
    }
    /** 法線（高さの関数の傾きから求める。地形の陰影と同じ向き）を target に入れて返す */
    normal(x, z, target) {
        return rawNormal(this.raw, x, z, target);
    }
    /** 地形のメッシュ（砂浜・草地・岩肌に塗り分ける） */
    createMesh() {
        return buildTerrainMesh((i, j) => this.h(i, j), this.raw, this.segs, this.half, this.step, this.look);
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
/** fn の間だけ field を今の地形にする（今いない島の木や草を、その島の地形に合わせて置くとき） */
export function withField(field, fn) {
    const prev = activeField;
    activeField = field;
    try {
        return fn();
    }
    finally {
        activeField = prev;
    }
}
/** 今いる場所の、中心から端までの距離（m） */
export function placeHalf() {
    return activeField.half;
}
/** 今いる場所の、描画されている三角形そのものの高さを返す */
export function terrainHeight(x, z) {
    return activeField.height(x, z);
}
/** 今いる場所の地形の法線を target に入れて返す */
export function terrainNormal(x, z, target) {
    return activeField.normal(x, z, target);
}
function rawNormal(raw, x, z, target) {
    const dx = raw(x + NORMAL_EPS, z) - raw(x - NORMAL_EPS, z);
    const dz = raw(x, z + NORMAL_EPS) - raw(x, z - NORMAL_EPS);
    return target.set(-dx, 2 * NORMAL_EPS, -dz).normalize();
}
/** 斜面の草地の色に掛ける明るさ（平らなら 1、岩肌に変わる手前ほど暗い） */
export function slopeShade(normalY) {
    return 1 - SLOPE_SHADE * smoothstep(1 - normalY, 0, 1 - ROCK_NORMAL_Y);
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
let groundMat = null;
/** 地面のマテリアル（どの場所の地面も同じ1つ）。頂点の色に、四角いムラのドット絵（GROUND_BLOTCH）を掛ける */
function groundMaterial() {
    if (groundMat)
        return groundMat;
    groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    groundMat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vGroundPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec2 vGroundPos;\n${BLOTCH_HASH_GLSL}`)
            .replace('#include <color_fragment>', `#include <color_fragment>
        ${blotchGlsl('vGroundPos', GROUND_BLOTCH, 'groundMul')}
        diffuseColor.rgb *= groundMul;`);
    };
    return groundMat;
}
/** h(i, j) はグリッド頂点の高さ、raw は法線を求める高さの関数。segs × segs マスで、1マスは step、中心から端まで half */
function buildTerrainMesh(h, raw, segs, half, step, look = {}) {
    const positions = [];
    const colors = [];
    const sand = new THREE.Color(PALETTE.sand);
    const grass = new THREE.Color(PALETTE.grass);
    const rock = new THREE.Color(PALETTE.rock);
    const slopeGrass = new THREE.Color();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    // 凸多角形を扇形に三角形分割して1色で塗る
    const pushPolygon = (poly, col) => {
        for (let k = 1; k + 1 < poly.length; k++) {
            for (const v of [poly[0], poly[k], poly[k + 1]]) {
                positions.push(v.x, v.y, v.z);
                colors.push(col.r, col.g, col.b);
            }
        }
    };
    // 凸多角形 poly を、頂点の値 f が負の側と正の側に切り分ける（境目は f を辺に沿って線形に補った 0 の所）
    const split = (poly, f) => {
        const below = [];
        const above = [];
        for (let k = 0; k < poly.length; k++) {
            const n = (k + 1) % poly.length;
            (f[k] < 0 ? below : above).push(poly[k]);
            if (f[k] < 0 !== f[n] < 0) {
                const cut = poly[k].clone().lerp(poly[n], f[k] / (f[k] - f[n]));
                below.push(cut);
                above.push(cut);
            }
        }
        return { below, above };
    };
    // 砂浜と草地の境界線で三角形を切り分け、境目をギザギザでなく揺らいだ線にする。穴（洞窟）はふちの線で切り抜く
    const pushTri = (p, q, r) => {
        let poly = [p.clone(), q.clone(), r.clone()];
        if (look.hole) {
            const f = poly.map((v) => {
                const h = look.hole(v.x, v.z);
                return h > 0 ? h : Math.min(h, -1e-6); // ちょうどふちの頂点は残す側に入れる
            });
            if (f.some((v) => v > 0))
                poly = split(poly, f).below;
            if (poly.length < 3)
                return;
        }
        const cx = (p.x + q.x + r.x) / 3;
        const cz = (p.z + q.z + r.z) / 3;
        const painted = look.paint?.(cx, cz);
        if (painted) {
            pushPolygon(poly, painted);
            return;
        }
        const normalY = ab.subVectors(q, p).cross(ac.subVectors(r, p)).normalize().y;
        const upper = normalY < ROCK_NORMAL_Y ? rock : slopeGrass.copy(grass).multiplyScalar(slopeShade(normalY));
        const { below, above } = split(poly, poly.map(sandLine));
        if (below.length >= 3)
            pushPolygon(below, sand);
        if (above.length >= 3)
            pushPolygon(above, upper);
    };
    for (let j = 0; j < segs; j++) {
        for (let i = 0; i < segs; i++) {
            const x0 = -half + i * step;
            const z0 = -half + j * step;
            const p00 = new THREE.Vector3(x0, h(i, j), z0);
            const p10 = new THREE.Vector3(x0 + step, h(i + 1, j), z0);
            const p01 = new THREE.Vector3(x0, h(i, j + 1), z0 + step);
            const p11 = new THREE.Vector3(x0 + step, h(i + 1, j + 1), z0 + step);
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
        rawNormal(raw, positions[k], positions[k + 2], n);
        normals.push(n.x, n.y, n.z);
    }
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, groundMaterial());
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
}
