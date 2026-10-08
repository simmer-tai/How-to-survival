import * as THREE from 'three';
const SPLINTER_LENGTH = 0.22; // 木の破片（細長い針）の長さ（m）
const SPLINTER_WIDTH = 0.035; // 破片の幅（m）
const SPLINTER_THICK = 0.02; // 破片の厚み（m）
/** 木を叩いたときに飛ぶ破片の形。両端のとがった細長い針（Y 方向に伸びる） */
export const splinterGeo = new THREE.OctahedronGeometry(1, 0).scale(SPLINTER_THICK / 2, SPLINTER_LENGTH / 2, SPLINTER_WIDTH / 2);
/** 破片の向きと長さをばらつかせる（自分の画面だけの演出なので Math.random を使う） */
export function scatterSplinter(mesh, size) {
    mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    const len = size * (0.6 + Math.random() * 0.8);
    mesh.scale.set(size, len, size);
}
