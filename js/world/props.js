import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flatVertex, solid } from '../core/materials.js';
import { terrainHeight } from './terrain.js';
function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// ---- 木の形の調整 ----
const PINE_TRUNK_HEIGHT = 6.5; // 針葉樹の幹の長さ（葉の段の中まで通す）
const PINE_TIERS = 5; // 針葉樹の葉の段の数
const ROUND_BRANCHES = 3; // 広葉樹の幹から分かれる枝の数
const PALM_RINGS = 10; // ヤシの幹の節の数
const PALM_YOUNG_FRONDS = 3; // ヤシのてっぺんから立ち上がる若い葉の数
const ROUGHNESS = 0.12; // 葉のかたまりの頂点をずらす量（大きさに対する割合）。形のいびつさ
// ---- 茂みの形の調整 ----
const BUSH_RING = 5; // まんなかのかたまりを囲む、葉のかたまりの数
const BUSH_ROUGHNESS = 0.2; // 茂みのかたまりの頂点をずらす量（かたまりの大きさに対する割合）
const BUSH_SPRIGS = 10; // 表面から飛び出す葉先の数（輪郭をギザギザにする）
const BUSH_YOUNG = 0.2; // 上向きの面のうち、明るい若葉の色にする割合
const UP = new THREE.Vector3(0, 1, 0);
/** 色を少し暗く・明るくする（パレットの色の濃淡だけを使う） */
function shade(color, k) {
    return new THREE.Color(color).multiplyScalar(k).getHex();
}
/**
 * 頂点を、位置から決まる量だけずらして形をいびつにする。
 * 同じ位置にある頂点（面の継ぎ目）は同じだけ動くので、面が割れない
 */
function rough(geo, amount, shape) {
    const seed = Math.floor(shape() * 2 ** 31);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const r = mulberry32(seed ^ Math.imul(Math.round(x * 1000), 73856093) ^ Math.imul(Math.round(y * 1000), 19349663) ^ Math.imul(Math.round(z * 1000), 83492791));
        pos.setXYZ(i, x + (r() - 0.5) * 2 * amount, y + (r() - 0.5) * 2 * amount, z + (r() - 0.5) * 2 * amount);
    }
    geo.computeVertexNormals();
    return geo;
}
/** ヤシの葉：根元と先が細く、両側の小葉が垂れて、全体が弓なりにしなる。原点は根元 */
function frondGeometry() {
    const LENGTH = 3.8;
    const geo = new THREE.BoxGeometry(1.1, 0.05, LENGTH, 2, 1, 8);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const t = pos.getZ(i) / LENGTH + 0.5; // 0 = 根元、1 = 先
        const width = Math.max(Math.sin(Math.PI * (0.12 + t * 0.86)), 0.06);
        const x = pos.getX(i) * width;
        const y = pos.getY(i) - Math.abs(x) * 0.45 - t * t * 1.5;
        pos.setXYZ(i, x, y, pos.getZ(i) + LENGTH / 2);
    }
    geo.computeVertexNormals();
    return geo;
}
/**
 * objects の中のメッシュを、root から見た位置のまま、頂点に色を塗った1つのメッシュにまとめる。
 * 色の違う部品をまとめて1回で描けるようにする（見た目は元と同じ）
 */
function mergeLooks(root, objects) {
    root.updateMatrixWorld(true);
    const toRoot = root.matrixWorld.clone().invert();
    const positions = [];
    const colors = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const o of objects) {
        o.traverse((child) => {
            if (!(child instanceof THREE.Mesh))
                return;
            m.multiplyMatrices(toRoot, child.matrixWorld);
            const geo = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
            const pos = geo.getAttribute('position');
            const c = child.material.color;
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(m);
                positions.push(v.x, v.y, v.z);
                colors.push(c.r, c.g, c.b);
            }
        });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, flatVertex());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
/** 木の葉・枝・実を1つにまとめた crown を足し、元の部品は隠しておく（倒れたら元の部品に戻す） */
function addCrown(object, leaves) {
    const crown = mergeLooks(object, leaves);
    object.add(crown);
    for (const leaf of leaves)
        leaf.visible = false;
    return crown;
}
/** start から dir の向きに length だけ伸びる枝 */
function branch(start, dir, length, radius) {
    const m = solid(new THREE.CylinderGeometry(radius * 0.5, radius, length, 5), PALETTE.trunk);
    m.position.copy(start).addScaledVector(dir, length / 2);
    m.quaternion.setFromUnitVectors(UP, dir);
    return m;
}
// 共有ジオメトリ（ローポリ・誇張したプロポーション）
const GEO = {
    palmFrond: frondGeometry(),
    coconut: new THREE.IcosahedronGeometry(0.2, 0),
    rock: new THREE.DodecahedronGeometry(1, 0),
    plank: new THREE.BoxGeometry(2.8, 0.22, 0.5),
};
function slopeAt(x, z) {
    const dx = terrainHeight(x + 1, z) - terrainHeight(x - 1, z);
    const dz = terrainHeight(x, z + 1) - terrainHeight(x, z - 1);
    return Math.hypot(dx, dz) / 2;
}
/** 針葉樹：まっすぐな幹に、垂れ下がった葉の段を重ねる。段ごとに大きさと傾きを少しずつ変える */
function pineTree(scale, shape) {
    const g = new THREE.Group();
    const trunk = solid(rough(new THREE.CylinderGeometry(0.16, 0.45, PINE_TRUNK_HEIGHT, 7, 4), 0.04, shape), PALETTE.trunk);
    trunk.position.y = PINE_TRUNK_HEIGHT / 2;
    g.add(trunk);
    const leaves = [];
    for (let k = 0; k < PINE_TIERS; k++) {
        const t = k / (PINE_TIERS - 1); // 0 = いちばん下の段
        const radius = THREE.MathUtils.lerp(2.7, 0.75, t) * (0.9 + shape() * 0.2);
        const height = THREE.MathUtils.lerp(2.3, 1.7, t);
        const geo = new THREE.ConeGeometry(radius, height, 9, 2);
        // 段の縁を下げて、枝先が垂れたスカートのような形にする
        const pos = geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
            const out = Math.hypot(pos.getX(i), pos.getZ(i)) / radius;
            if (pos.getY(i) < 0)
                pos.setY(i, pos.getY(i) - out * out * radius * 0.25);
        }
        const tier = solid(rough(geo, radius * ROUGHNESS, shape), shade(PALETTE.leaf, k % 2 ? 1 : 0.9));
        tier.position.y = 2.7 + t * 6.2;
        tier.rotation.set((shape() - 0.5) * 0.14, shape() * Math.PI * 2, (shape() - 0.5) * 0.14);
        g.add(tier);
        leaves.push(tier);
    }
    g.scale.setScalar(scale);
    return { group: g, trunk, leaves };
}
/** 広葉樹：幹が数本の枝に分かれ、枝先ごとに葉のかたまりが付く */
function roundTree(scale, rand, shape) {
    // 配置用の乱数はこの2回だけ使う（回数を変えると、あとに置く茂みや岩の位置と ID が変わる）
    const turn = rand() * Math.PI * 2;
    const crownSize = 0.9 + rand() * 0.25;
    const g = new THREE.Group();
    const trunkHeight = 3.4;
    const trunk = solid(rough(new THREE.CylinderGeometry(0.26, 0.5, trunkHeight, 7, 3), 0.05, shape), PALETTE.trunk);
    trunk.position.y = trunkHeight / 2;
    g.add(trunk);
    const leaves = [];
    const fork = new THREE.Vector3(0, trunkHeight - 0.5, 0);
    const blob = (center, size, color) => {
        const m = solid(rough(new THREE.IcosahedronGeometry(1, 0), ROUGHNESS * 1.5, shape), color);
        m.position.copy(center);
        m.scale.set(size, size * 0.8, size);
        m.rotation.set(shape() * Math.PI, shape() * Math.PI, 0);
        g.add(m);
        leaves.push(m);
    };
    for (let k = 0; k < ROUND_BRANCHES; k++) {
        const a = turn + (k / ROUND_BRANCHES) * Math.PI * 2 + (shape() - 0.5) * 0.7;
        const lean = 0.55 + shape() * 0.35;
        const length = 1.5 + shape() * 0.6;
        const dir = new THREE.Vector3(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a));
        const b = branch(fork, dir, length, 0.17);
        g.add(b);
        leaves.push(b); // 枝も倒れたら葉と一緒に消える（幹の当たり判定に入れない）
        const tip = fork.clone().addScaledVector(dir, length).add(new THREE.Vector3(0, 0.35, 0));
        blob(tip, (1.3 + shape() * 0.4) * crownSize, shade(PALETTE.leaf, 0.92 + shape() * 0.1));
    }
    // てっぺんのいちばん大きなかたまり
    blob(new THREE.Vector3(0, trunkHeight + 1.3, 0), 1.8 * crownSize, PALETTE.leaf);
    g.scale.setScalar(scale);
    return { group: g, trunk, leaves };
}
/** ヤシ：節のある幹が海側へ弓なりに反り、てっぺんから垂れた葉と実が付く */
function palmTree(outward, rand, shape) {
    const g = new THREE.Group();
    g.rotation.y = Math.atan2(-outward.y, outward.x); // ローカル+Xを海側へ向ける
    const tilt = 0.25 + rand() * 0.2;
    const length = 5 + rand() * 1.5;
    const bend = Math.sin(tilt) * length * 1.3; // てっぺんが根元から海側へずれる量
    // 幹：根元はまっすぐ立ち、上ほど海側へ反る。節ごとに少し太くする
    const geo = new THREE.CylinderGeometry(0.2, 0.36, length, 7, PALM_RINGS);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / length + 0.5;
        const ring = Math.round(t * PALM_RINGS) % 2 === 0 ? 1.12 : 1;
        pos.setX(i, pos.getX(i) * ring + bend * t * t);
        pos.setZ(i, pos.getZ(i) * ring);
    }
    geo.computeVertexNormals();
    const trunk = solid(geo, PALETTE.trunk);
    trunk.position.y = length / 2;
    g.add(trunk);
    const top = new THREE.Vector3(bend, length, 0);
    const leaves = [];
    const frond = (yaw, pitch, size) => {
        const pivot = new THREE.Group();
        pivot.position.copy(top);
        pivot.rotation.y = yaw;
        const droop = new THREE.Group();
        droop.rotation.x = pitch;
        const leaf = solid(GEO.palmFrond, PALETTE.leaf);
        leaf.scale.setScalar(size);
        droop.add(leaf);
        pivot.add(droop);
        g.add(pivot);
        leaves.push(pivot);
    };
    // 配置用の乱数はこの6枚の分だけ使う（回数を変えると、あとに置く木や茂みの位置と ID が変わる）
    const count = 6;
    for (let k = 0; k < count; k++) {
        frond((k / count) * Math.PI * 2 + rand() * 0.3, -0.25 + rand() * 0.25, 0.95 + shape() * 0.15);
    }
    // 真ん中から立ち上がる若い葉
    for (let k = 0; k < PALM_YOUNG_FRONDS; k++) {
        frond(shape() * Math.PI * 2, -0.8 - shape() * 0.3, 0.6 + shape() * 0.15);
    }
    // 実
    for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + shape();
        const nut = solid(GEO.coconut, shade(PALETTE.trunk, 0.8));
        nut.position.copy(top).add(new THREE.Vector3(Math.cos(a) * 0.24, -0.3, Math.sin(a) * 0.24));
        g.add(nut);
        leaves.push(nut);
    }
    return { group: g, trunk, leaves };
}
/**
 * 茂み：まんなかの大きなかたまりを、小さめのかたまりが囲み、てっぺんにもう1つ載る。表面から葉先が飛び出す。
 * 下ほど暗く、上ほど明るい。ところどころ若葉の明るい色が混じる。原点は茂みの中心で、地面は y = -0.3 あたり。
 * ほかのかたまりに埋まって見えない面は省く。実をつけてよい（外から見える上向きの）面の番号を userData.berryFaces に入れる
 */
function bushGeometry(shape) {
    const clumps = [{ center: new THREE.Vector3(0, 0.1, 0), radius: 0.62 }];
    const turn = shape() * Math.PI * 2;
    for (let k = 0; k < BUSH_RING; k++) {
        const a = turn + (k / BUSH_RING) * Math.PI * 2 + (shape() - 0.5) * 0.6;
        const d = 0.42 + shape() * 0.15;
        clumps.push({ center: new THREE.Vector3(Math.cos(a) * d, -0.05 + shape() * 0.15, Math.sin(a) * d), radius: 0.36 + shape() * 0.14 });
    }
    clumps.push({ center: new THREE.Vector3((shape() - 0.5) * 0.3, 0.42, (shape() - 0.5) * 0.3), radius: 0.38 + shape() * 0.1 });
    const positions = [];
    const colors = [];
    const berryFaces = [];
    const leaf = new THREE.Color(PALETTE.leaf);
    const young = new THREE.Color(PALETTE.grass);
    const color = new THREE.Color();
    const tri = new THREE.Triangle();
    const mid = new THREE.Vector3();
    const normal = new THREE.Vector3();
    /** 点 p が、self 以外のかたまりの中（半径 × margin より内側）にあるか */
    const buried = (p, self, margin) => clumps.some((o, j) => j !== self && p.distanceTo(o.center) < o.radius * margin);
    const addFace = (k) => {
        for (const v of [tri.a, tri.b, tri.c]) {
            positions.push(v.x, v.y, v.z);
            colors.push(color.r * k, color.g * k, color.b * k);
        }
    };
    clumps.forEach((clump, i) => {
        const geo = rough(new THREE.IcosahedronGeometry(clump.radius, 1), clump.radius * BUSH_ROUGHNESS, shape);
        geo.rotateY(shape() * Math.PI * 2);
        geo.scale(1, 0.85, 1);
        geo.translate(clump.center.x, clump.center.y, clump.center.z);
        const pos = geo.getAttribute('position');
        for (let f = 0; f < pos.count / 3; f++) {
            tri.a.fromBufferAttribute(pos, f * 3);
            tri.b.fromBufferAttribute(pos, f * 3 + 1);
            tri.c.fromBufferAttribute(pos, f * 3 + 2);
            if ([tri.a, tri.b, tri.c].every((v) => buried(v, i, 0.85)))
                continue; // 全部埋まっている面は省く
            tri.getMidpoint(mid);
            tri.getNormal(normal);
            const height = THREE.MathUtils.clamp((mid.y + 0.45) / 1.15, 0, 1); // 0 = 根元、1 = てっぺん
            let k = 0.62 + height * 0.5 + (shape() - 0.5) * 0.14;
            if (buried(mid, i, 1))
                k *= 0.7; // かたまりどうしの谷間は影になる
            color.copy(leaf);
            if (normal.y > 0.3 && shape() < BUSH_YOUNG)
                color.lerp(young, 0.4);
            if (normal.y > 0.1 && height > 0.3 && !buried(mid, i, 1.15))
                berryFaces.push(positions.length / 9);
            addFace(k);
        }
    });
    // 葉先：上側のかたまりの表面から外へ、細い三角すいを突き出す
    for (let n = 0; n < BUSH_SPRIGS; n++) {
        const clump = clumps[1 + Math.floor(shape() * (clumps.length - 1))];
        const a = shape() * Math.PI * 2;
        const up = 0.1 + shape() * 0.8;
        const dir = new THREE.Vector3(Math.cos(a) * Math.cos(up), Math.sin(up), Math.sin(a) * Math.cos(up));
        const length = 0.22 + shape() * 0.14;
        const geo = new THREE.ConeGeometry(0.06, length, 3).toNonIndexed();
        geo.translate(0, length / 2, 0);
        geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
        // 根元はかたまりの表面の少し内側（かたまりは縦に 0.85 倍つぶしてある）
        const root = new THREE.Vector3(dir.x, dir.y * 0.85, dir.z).multiplyScalar(clump.radius * 0.8).add(clump.center);
        geo.translate(root.x, root.y, root.z);
        const pos = geo.getAttribute('position');
        color.copy(leaf).lerp(young, shape() * 0.35);
        const k = 0.95 + shape() * 0.15;
        for (let f = 0; f < pos.count / 3; f++) {
            tri.a.fromBufferAttribute(pos, f * 3);
            tri.b.fromBufferAttribute(pos, f * 3 + 1);
            tri.c.fromBufferAttribute(pos, f * 3 + 2);
            addFace(k);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.userData.berryFaces = berryFaces;
    return geo;
}
function rock(rand, size) {
    const m = solid(GEO.rock, PALETTE.rock);
    m.scale.set(size * (0.8 + rand() * 0.6), size * (0.5 + rand() * 0.4), size * (0.8 + rand() * 0.6));
    m.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    return m;
}
export function buildProps() {
    const group = new THREE.Group();
    const solids = [];
    const platforms = [];
    const trees = [];
    const bushes = [];
    const rocks = [];
    const rand = mulberry32(20261002);
    const placed = [];
    // 木の細かい形は、配置用とは別に木の番号から作った乱数で決める（形を変えても配置がずれない）
    const shapeRand = (id) => mulberry32(7000 + id);
    const isFree = (x, z, spacing) => placed.every((p) => Math.hypot(p.x - x, p.y - z) > spacing);
    // ---- 桟橋（南側の浜から海へ） ----
    const pierX = -6;
    let shoreZ = 0;
    for (let z = 0; z < 90; z += 0.5) {
        if (terrainHeight(pierX, z) < 0.5) {
            shoreZ = z;
            break;
        }
    }
    const pierTop = 1.0;
    const pierStart = shoreZ - 4;
    const pierEnd = shoreZ + 15;
    const pierHalfW = 1.4;
    const pierParts = [];
    for (let z = pierStart; z < pierEnd; z += 0.62) {
        const plank = solid(GEO.plank, PALETTE.trunk);
        plank.position.set(pierX + (rand() - 0.5) * 0.08, pierTop - 0.11, z);
        plank.rotation.y = (rand() - 0.5) * 0.04;
        group.add(plank);
        solids.push(plank);
        pierParts.push(plank);
    }
    for (let z = pierStart + 1; z < pierEnd; z += 3) {
        for (const side of [-1, 1]) {
            const bottom = terrainHeight(pierX + side * 1.3, z) - 0.5;
            const height = pierTop + 0.6 - bottom;
            const post = solid(new THREE.CylinderGeometry(0.18, 0.18, height, 6), PALETTE.trunk);
            post.position.set(pierX + side * 1.3, bottom + height / 2, z);
            group.add(post);
            solids.push(post);
            pierParts.push(post);
        }
    }
    // 板と柱は当たり判定のために残して隠し、見た目は1つにまとめて描く
    group.add(mergeLooks(group, pierParts));
    for (const part of pierParts)
        part.visible = false;
    platforms.push({ minX: pierX - pierHalfW, maxX: pierX + pierHalfW, minZ: pierStart - 0.3, maxZ: pierEnd, top: pierTop });
    for (let z = pierStart; z < pierEnd + 2; z += 2)
        placed.push(new THREE.Vector2(pierX, z));
    // ---- ヤシ（浜辺） ----
    for (let n = 0, tries = 0; n < 16 && tries < 4000; tries++) {
        const x = (rand() - 0.5) * 120;
        const z = (rand() - 0.5) * 120;
        const y = terrainHeight(x, z);
        if (y < 0.4 || y > 1.4 || !isFree(x, z, 5))
            continue;
        const outward = new THREE.Vector2(x, z).normalize();
        const { group: palm, trunk, leaves } = palmTree(outward, rand, shapeRand(trees.length));
        palm.position.set(x, y - 0.1, z);
        group.add(palm);
        trees.push({ object: palm, trunk, leaves, crown: addCrown(palm, leaves), wood: 3 });
        placed.push(new THREE.Vector2(x, z));
        n++;
    }
    // ---- 森 ----
    for (let n = 0, tries = 0; n < 70 && tries < 8000; tries++) {
        const x = (rand() - 0.5) * 110;
        const z = (rand() - 0.5) * 110;
        const y = terrainHeight(x, z);
        if (y < 1.8 || slopeAt(x, z) > 0.9 || !isFree(x, z, 4))
            continue;
        const s = 0.8 + rand() * 0.6;
        const shape = shapeRand(trees.length);
        const { group: tree, trunk, leaves } = rand() < 0.6 ? pineTree(s, shape) : roundTree(s, rand, shape);
        tree.position.set(x, y - 0.2, z);
        tree.rotation.y = rand() * Math.PI * 2;
        group.add(tree);
        trees.push({ object: tree, trunk, leaves, crown: addCrown(tree, leaves), wood: Math.round(3 * s) + 1 });
        placed.push(new THREE.Vector2(x, z));
        n++;
    }
    // ---- 茂み ----
    for (let n = 0, tries = 0; n < 40 && tries < 4000; tries++) {
        const x = (rand() - 0.5) * 110;
        const z = (rand() - 0.5) * 110;
        const y = terrainHeight(x, z);
        if (y < 1.7 || slopeAt(x, z) > 0.8 || !isFree(x, z, 2.5))
            continue;
        // 細かい形は配置用とは別に茂みの番号から作った乱数で決める（形を変えても配置と ID がずれない）
        const bush = new THREE.Mesh(bushGeometry(mulberry32(9000 + bushes.length)), flatVertex());
        bush.castShadow = true;
        bush.receiveShadow = true;
        const s = 0.7 + rand() * 0.7;
        bush.scale.set(s * 1.3, s, s * 1.3);
        bush.rotation.y = rand() * Math.PI;
        bush.position.set(x, y + 0.3 * s, z);
        group.add(bush);
        bushes.push(bush);
        placed.push(new THREE.Vector2(x, z));
        n++;
    }
    // ---- 岩（陸と浅瀬） ----
    for (let n = 0, tries = 0; n < 34 && tries < 4000; tries++) {
        const x = (rand() - 0.5) * 120;
        const z = (rand() - 0.5) * 120;
        const y = terrainHeight(x, z);
        if (y < -3 || !isFree(x, z, 3))
            continue;
        const size = y < 0.5 ? 1.2 + rand() * 1.6 : 0.6 + rand() * 1.2;
        const r = rock(rand, size);
        r.position.set(x, y + size * 0.2, z);
        group.add(r);
        solids.push(r);
        rocks.push(r);
        placed.push(new THREE.Vector2(x, z));
        n++;
    }
    const spawn = new THREE.Vector3(pierX, pierTop, pierEnd - 3);
    return {
        group,
        solids,
        trees,
        bushes,
        rocks,
        platforms,
        spawn,
    };
}
