import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { toon } from './materials.js';
import { buildAxe } from './hand.js';
import { buildLeafModel, buildStickModel } from './itemModels.js';
const ICON_SIZE = 128; // 描画解像度（px）。表示はこれより小さく縮める
const FOV = 24;
function part(geometry, color, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, typeof color === 'number' ? toon(color) : color);
    mesh.position.set(x, y, z);
    return mesh;
}
/** 道具を「柄が左下 → 先端が右上」の斜めに寝かせる */
function diagonal(model) {
    const g = new THREE.Group();
    model.rotation.z -= Math.PI / 4;
    g.add(model);
    return g;
}
/** 丸太を3本積んだ山。側面は樹皮、切り口は明るい色 */
function buildWood() {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.13, 0.13, 0.62, 7);
    const mats = [toon(PALETTE.trunk), toon(PALETTE.sand), toon(PALETTE.sand)];
    for (const [x, y] of [[-0.135, 0], [0.135, 0], [0, 0.23]]) {
        const log = part(geo, mats, x, y, 0);
        log.rotation.x = Math.PI / 2; // 切り口を手前へ
        g.add(log);
    }
    g.rotation.set(0.35, -0.6, 0);
    return g;
}
/** 付け根で重なった2枚の葉っぱ */
function buildLeafIcon() {
    const g = new THREE.Group();
    for (const [x, tilt] of [[-0.01, 0.4], [0.01, -0.3]]) { // 葉柄の付け根をそろえて V 字に
        const leaf = buildLeafModel();
        leaf.position.x = x;
        leaf.rotation.z = tilt;
        g.add(leaf);
    }
    g.rotation.set(0.35, -0.3, 0);
    return g;
}
function buildStone() {
    const g = new THREE.Group();
    const rock = part(new THREE.DodecahedronGeometry(0.3, 0), PALETTE.rock);
    rock.scale.set(1.15, 0.75, 0.95);
    rock.rotation.set(0.3, 0.5, 0.15);
    const pebble = part(new THREE.DodecahedronGeometry(0.13, 0), PALETTE.rock, 0.3, -0.12, 0.12);
    pebble.rotation.set(0.8, 0.2, 0.4);
    g.add(rock, pebble);
    g.rotation.set(0.4, -0.3, 0);
    return g;
}
/** 芽の出たたね */
function buildSeed() {
    const g = new THREE.Group();
    const seedGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const seed = (x, y, z, tilt) => {
        const s = part(seedGeo, PALETTE.sand, x, y, z);
        s.scale.set(0.8, 1.15, 0.8);
        s.rotation.z = tilt;
        g.add(s);
    };
    seed(-0.15, -0.08, 0, 0.5);
    seed(0.12, -0.12, 0.08, -0.4);
    seed(0, 0.05, -0.05, 0.1);
    // 芽：茎と2枚の葉
    g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 5), PALETTE.grass, 0, 0.24, -0.05));
    const leafGeo = new THREE.SphereGeometry(0.1, 8, 6);
    for (const side of [-1, 1]) {
        const leaf = part(leafGeo, PALETTE.grass, side * 0.09, 0.36, -0.05);
        leaf.scale.set(1, 0.35, 0.6);
        leaf.rotation.z = side * 0.4;
        g.add(leaf);
    }
    g.rotation.set(0.3, -0.4, 0);
    return g;
}
function buildBerry() {
    const g = new THREE.Group();
    const berryGeo = new THREE.SphereGeometry(0.15, 12, 10);
    for (const [x, y, z] of [[-0.14, -0.1, 0.05], [0.14, -0.1, 0.05], [0, 0.1, 0], [0, -0.06, -0.15]]) {
        g.add(part(berryGeo, PALETTE.accent, x, y, z));
    }
    // へたの葉
    const leafGeo = new THREE.SphereGeometry(0.1, 8, 6);
    for (const side of [-1, 1]) {
        const leaf = part(leafGeo, PALETTE.leaf, side * 0.1, 0.3, 0);
        leaf.scale.set(1, 0.3, 0.55);
        leaf.rotation.z = side * 0.5;
        g.add(leaf);
    }
    g.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 5), PALETTE.leaf, 0, 0.27, 0));
    g.rotation.set(0.35, -0.3, 0);
    return g;
}
function buildHoe() {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.024, 0.024, 0.8, 6), PALETTE.trunk, 0, 0.05, 0));
    g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), PALETTE.accent, 0, -0.22, 0)); // 握りの布
    g.add(part(new THREE.BoxGeometry(0.07, 0.08, 0.07), PALETTE.rock, 0, 0.42, 0)); // 柄を差し込む部分
    // 柄の先から手前（柄尻側）へ折れた刃
    const blade = new THREE.Group();
    blade.position.set(0, 0.42, 0);
    blade.rotation.z = 0.55;
    blade.add(part(new THREE.BoxGeometry(0.22, 0.035, 0.13), PALETTE.rock, -0.12, 0, 0));
    g.add(blade);
    return g;
}
function buildSword() {
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-0.04, 0);
    s.lineTo(0.04, 0);
    s.lineTo(0.04, 0.5);
    s.lineTo(0, 0.6);
    s.lineTo(-0.04, 0.5);
    s.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(s, {
        depth: 0.01, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1,
    });
    bladeGeo.translate(0, 0.02, -0.005);
    g.add(part(bladeGeo, PALETTE.rock));
    g.add(part(new THREE.BoxGeometry(0.24, 0.04, 0.06), PALETTE.trunk, 0, 0.0, 0)); // つば
    g.add(part(new THREE.CylinderGeometry(0.026, 0.026, 0.15, 6), PALETTE.accent, 0, -0.095, 0)); // 握り
    g.add(part(new THREE.SphereGeometry(0.04, 8, 6), PALETTE.trunk, 0, -0.18, 0)); // 柄頭
    return g;
}
function buildAxeIcon() {
    const axe = buildAxe();
    axe.rotation.y = Math.PI / 2; // 刃（-Z）を画面の左へ向けて横顔を見せる
    const g = new THREE.Group();
    g.add(axe);
    return g;
}
/** アイテムごとの 3D モデル（新しいアイテムはここに追加する） */
const MODELS = {
    wood: buildWood,
    stick: () => tools(buildStickModel()),
    leaf: buildLeafIcon,
    stone: buildStone,
    seed: buildSeed,
    berry: buildBerry,
    hoe: () => tools(buildHoe()),
    axe: () => tools(buildAxeIcon()),
    sword: () => tools(buildSword()),
};
/** 道具は斜めに置いて、少し奥行きが見える角度から見る */
function tools(model) {
    const g = diagonal(model);
    g.rotation.set(0.3, -0.45, 0);
    return g;
}
// ---- アイコン撮影用のスタジオ（ゲーム画面とは別の小さなレンダラー） ----
let studio = null;
function getStudio() {
    if (studio)
        return studio;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(ICON_SIZE, ICON_SIZE, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(PALETTE.sky, PALETTE.grass, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.5, 2.5, 3);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
    studio = { renderer, scene, camera };
    return studio;
}
const cache = new Map();
/** アイテムの 3D アイコン（PNG の data URL）。初回だけ描画してキャッシュする */
export function itemIcon(id) {
    return modelIcon(`item:${id}`, MODELS[id]);
}
/** 任意の 3D モデルのアイコン。key ごとに初回だけ描画してキャッシュする */
export function modelIcon(key, build) {
    const cached = cache.get(key);
    if (cached)
        return cached;
    const { renderer, scene, camera } = getStudio();
    const model = build();
    scene.add(model);
    // 画面に映る幅・高さがちょうど収まる距離にカメラを置く（カメラは -Z 向きなので xy がそのまま画面の縦横）
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const half = (Math.max(size.x, size.y) / 2) * 1.08;
    const dist = half / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) + size.z / 2;
    camera.position.set(center.x, center.y, center.z + dist);
    camera.lookAt(center);
    camera.near = dist - size.z;
    camera.far = dist + size.z;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    cache.set(key, url);
    scene.remove(model);
    model.traverse((o) => {
        // マテリアルはゲームと共有なので捨てない。itemModels のジオメトリも共有なので残す
        if (o instanceof THREE.Mesh && !o.geometry.userData.shared)
            o.geometry.dispose();
    });
    return url;
}
