import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { solid } from './materials.js';
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
// 共有ジオメトリ（ローポリ・誇張したプロポーション）
const GEO = {
    pineTrunk: new THREE.CylinderGeometry(0.3, 0.45, 4.4, 6),
    pineCone1: new THREE.ConeGeometry(2.4, 3.2, 7),
    pineCone2: new THREE.ConeGeometry(1.8, 2.8, 7),
    pineCone3: new THREE.ConeGeometry(1.1, 2.2, 7),
    roundTrunk: new THREE.CylinderGeometry(0.35, 0.5, 2.6, 6),
    roundCrown: new THREE.IcosahedronGeometry(2.3, 0),
    palmTrunk: new THREE.CylinderGeometry(0.22, 0.35, 1, 6),
    palmLeaf: new THREE.BoxGeometry(0.9, 0.12, 3.4),
    rock: new THREE.DodecahedronGeometry(1, 0),
    bush: new THREE.IcosahedronGeometry(0.9, 0),
    plank: new THREE.BoxGeometry(2.8, 0.22, 0.5),
};
function slopeAt(x, z) {
    const dx = terrainHeight(x + 1, z) - terrainHeight(x - 1, z);
    const dz = terrainHeight(x, z + 1) - terrainHeight(x, z - 1);
    return Math.hypot(dx, dz) / 2;
}
function pineTree(scale) {
    const g = new THREE.Group();
    const trunk = solid(GEO.pineTrunk, PALETTE.trunk);
    trunk.position.y = 2.2;
    const c1 = solid(GEO.pineCone1, PALETTE.leaf);
    c1.position.y = 5.4;
    const c2 = solid(GEO.pineCone2, PALETTE.leaf);
    c2.position.y = 7.0;
    const c3 = solid(GEO.pineCone3, PALETTE.leaf);
    c3.position.y = 8.4;
    g.add(trunk, c1, c2, c3);
    g.scale.setScalar(scale);
    return { group: g, trunk, leaves: [c1, c2, c3] };
}
function roundTree(scale, rand) {
    const g = new THREE.Group();
    const trunk = solid(GEO.roundTrunk, PALETTE.trunk);
    trunk.position.y = 1.3;
    const crown = solid(GEO.roundCrown, PALETTE.leaf);
    crown.position.y = 3.9;
    crown.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
    crown.scale.set(1, 1.15, 1);
    g.add(trunk, crown);
    g.scale.setScalar(scale);
    return { group: g, trunk, leaves: [crown] };
}
function palmTree(outward, rand) {
    const g = new THREE.Group();
    g.rotation.y = Math.atan2(-outward.y, outward.x); // ローカル+Xを海側へ向ける
    const tilt = 0.25 + rand() * 0.2;
    const length = 5 + rand() * 1.5;
    const trunk = solid(GEO.palmTrunk, PALETTE.trunk);
    trunk.scale.y = length;
    trunk.position.set((Math.sin(tilt) * length) / 2, (Math.cos(tilt) * length) / 2, 0);
    trunk.rotation.z = -tilt;
    g.add(trunk);
    const top = new THREE.Vector3(Math.sin(tilt) * length, Math.cos(tilt) * length, 0);
    const count = 6;
    const leaves = [];
    for (let k = 0; k < count; k++) {
        const pivot = new THREE.Group();
        pivot.position.copy(top);
        pivot.rotation.y = (k / count) * Math.PI * 2 + rand() * 0.3;
        const droop = new THREE.Group();
        droop.rotation.x = 0.35 + rand() * 0.25;
        const leaf = solid(GEO.palmLeaf, PALETTE.leaf);
        leaf.position.z = 1.6;
        droop.add(leaf);
        pivot.add(droop);
        g.add(pivot);
        leaves.push(pivot);
    }
    return { group: g, trunk, leaves };
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
    for (let z = pierStart; z < pierEnd; z += 0.62) {
        const plank = solid(GEO.plank, PALETTE.trunk);
        plank.position.set(pierX + (rand() - 0.5) * 0.08, pierTop - 0.11, z);
        plank.rotation.y = (rand() - 0.5) * 0.04;
        group.add(plank);
        solids.push(plank);
    }
    for (let z = pierStart + 1; z < pierEnd; z += 3) {
        for (const side of [-1, 1]) {
            const bottom = terrainHeight(pierX + side * 1.3, z) - 0.5;
            const height = pierTop + 0.6 - bottom;
            const post = solid(new THREE.CylinderGeometry(0.18, 0.18, height, 6), PALETTE.trunk);
            post.position.set(pierX + side * 1.3, bottom + height / 2, z);
            group.add(post);
            solids.push(post);
        }
    }
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
        const { group: palm, trunk, leaves } = palmTree(outward, rand);
        palm.position.set(x, y - 0.1, z);
        group.add(palm);
        trees.push({ object: palm, trunk, leaves, wood: 3 });
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
        const { group: tree, trunk, leaves } = rand() < 0.6 ? pineTree(s) : roundTree(s, rand);
        tree.position.set(x, y - 0.2, z);
        tree.rotation.y = rand() * Math.PI * 2;
        group.add(tree);
        trees.push({ object: tree, trunk, leaves, wood: Math.round(3 * s) + 1 });
        placed.push(new THREE.Vector2(x, z));
        n++;
    }
    // ---- 茂み ----
    for (let n = 0, tries = 0; n < 40 && tries < 4000; tries++) {
        const x = (rand() - 0.5) * 110;
        const z = (rand() - 0.5) * 110;
        const y = terrainHeight(x, z);
        if (y < 1.2 || slopeAt(x, z) > 0.8 || !isFree(x, z, 2.5))
            continue;
        const bush = solid(GEO.bush, PALETTE.leaf);
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
