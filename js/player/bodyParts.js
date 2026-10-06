import * as THREE from 'three';
import { solid } from '../core/materials.js';
// 人の体を組み立てる部品（桟橋の住人とプレイヤーのアバターで使う）
/** 色を少し暗く・明るくする（パレットの色の濃淡だけを使う） */
export function shade(color, k) {
    return new THREE.Color(color).multiplyScalar(k).getHex();
}
/** 2色を混ぜる（パレットの色どうし） */
export function mix(a, b, t) {
    return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}
export function joint(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
}
export function box(parent, w, h, d, color, x, y, z) {
    const m = solid(new THREE.BoxGeometry(w, h, d), color);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
}
/** 関節から下へ伸びる、先細りの円柱（手足）。原点は上端 */
export function limb(parent, rTop, rBottom, length, color, y = 0) {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, length, 8);
    geo.translate(0, -length / 2, 0);
    const m = solid(geo, color);
    m.position.y = y;
    parent.add(m);
    return m;
}
/** (半径, 高さ) の輪郭を回して作る胴体。depth で前後につぶす */
export function lathe(points, depth, color) {
    const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 12);
    geo.scale(1, 1, depth);
    return solid(geo, color);
}
/** 頭：縦長の球。あごを細く、後頭部を少し出す。原点は首の付け根 */
export function headGeometry() {
    const geo = new THREE.SphereGeometry(0.115, 12, 9);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        const y = pos.getY(i);
        let z = pos.getZ(i);
        if (y < 0)
            x *= 1 - (-y / 0.115) ** 2 * 0.22; // あご（エラは残して先だけ細く）
        z *= z < 0 ? 1.1 : 1.05; // 後頭部
        pos.setXYZ(i, x, y * 1.15, z);
    }
    geo.computeVertexNormals();
    geo.translate(0, 0.11, 0.005);
    return geo;
}
