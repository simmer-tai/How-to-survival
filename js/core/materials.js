import * as THREE from 'three';
// ローポリの面を見せるフラットシェーディング。
// 面ごとに法線が違うので、光の当たり方で面一枚ずつ明るさが変わる。
const flatCache = new Map();
export function flat(color) {
    let mat = flatCache.get(color);
    if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
        flatCache.set(color, mat);
    }
    return mat;
}
let vertexMat = null;
/** 頂点に塗った色（PALETTE の色）で描くフラットシェーディング。色の違う箱をひとつのジオメトリにまとめるときに使う */
export function flatVertex() {
    vertexMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    return vertexMat;
}
export function flatTransparent(color, opacity) {
    return new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true, opacity });
}
/** 影を落とす・受けるフラットシェーディングの単色メッシュを作る */
export function solid(geometry, color) {
    const mesh = new THREE.Mesh(geometry, flat(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
