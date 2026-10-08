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

// 木目のドット絵。明るさだけの模様（頂点の色に掛ける）なので、色は PALETTE のまま。
// 横（u）に木目が流れる。0 がいちばん明るく、数字が大きいほど暗い
const WOOD_GRAIN = [
  '00000000000000000000000000000000',
  '11110000000000000000011111110000',
  '00001111111100000000000000001111',
  '00000000000011111000000000000000',
  '00000000000000000000000000000000',
  '22221000000000000000001222222222',
  '00000122222222100000000000000000',
  '00000000000000011111110000000000',
  '00000000000000000000000000000000',
  '00000000011100000000000000000000',
  '11111111100011111100000000111111',
  '00000000000000000011111111000000',
  '00000000000000000000122100000000',
  '00000000000000000001233210000000',
  '22222100000000000000122100012222',
  '00000122222222222100000002210000',
];
const WOOD_SHADES = [1, 0.9, 0.8, 0.68]; // 模様の数字ごとの明るさ
export const WOOD_SPAN_U = 1; // 木目の模様1枚が覆う長さ（m）。木目の向き
export const WOOD_SPAN_V = 0.5; // 木目と直角の向き（m）。1ドットが約3cm になる

let woodMat: THREE.MeshLambertMaterial | null = null;

/** 頂点の色に木目のドット絵を重ねるフラットシェーディング。UV は 1 が WOOD_SPAN_U / V の長さになるように振る */
export function woodVertex(): THREE.MeshLambertMaterial {
  if (woodMat) return woodMat;
  const w = WOOD_GRAIN[0].length;
  const h = WOOD_GRAIN.length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(WOOD_SHADES[Number(WOOD_GRAIN[y][x] ?? 0)] * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter; // 近くではドットをくっきり
  tex.minFilter = THREE.NearestMipmapLinearFilter; // 遠くではちらつかないようにならす
  woodMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: tex });
  return woodMat;
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
