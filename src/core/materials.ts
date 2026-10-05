import * as THREE from 'three';

// ローポリの面を見せるフラットシェーディング。
// 面ごとに法線が違うので、光の当たり方で面一枚ずつ明るさが変わる。
const flatCache = new Map<number, THREE.MeshLambertMaterial>();

export function flat(color: number): THREE.MeshLambertMaterial {
  let mat = flatCache.get(color);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    flatCache.set(color, mat);
  }
  return mat;
}

let vertexMat: THREE.MeshLambertMaterial | null = null;

/** 頂点に塗った色（PALETTE の色）で描くフラットシェーディング。色の違う箱をひとつのジオメトリにまとめるときに使う */
export function flatVertex(): THREE.MeshLambertMaterial {
  vertexMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return vertexMat;
}

export function flatTransparent(color: number, opacity: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true, opacity });
}

/** 影を落とす・受けるフラットシェーディングの単色メッシュを作る */
export function solid(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, flat(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
