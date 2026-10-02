import * as THREE from 'three';

// 3段階のトゥーン陰影
export const gradientMap = (() => {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const toonCache = new Map<number, THREE.MeshToonMaterial>();

export function toon(color: number): THREE.MeshToonMaterial {
  let mat = toonCache.get(color);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({ color, gradientMap });
    toonCache.set(color, mat);
  }
  return mat;
}

export function toonVertexColors(): THREE.MeshToonMaterial {
  // 非インデックスのジオメトリなので法線は面ごと＝フラットシェーディングになる
  return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
}

export function toonTransparent(color: number, opacity: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap, transparent: true, opacity });
}

/** 影を落とす・受けるトゥーン単色メッシュを作る */
export function solid(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
