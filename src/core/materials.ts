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
// 筋ではなく、大きさの違う四角いムラをすき間なく敷きつめる。ムラは横（u。木目の向き）に少し長い。
// 1 が地の明るさで、0 は地より明るいムラ、2・3 は暗いムラ
const WOOD_GRAIN = [
  '11110000222221133331110000022222',
  '11110000222221133331110000022222',
  '33310000222221133331112222211111',
  '33311111100000111110002222211111',
  '33311111100000111110002222211333',
  '00002222111333300000111111111333',
  '00002222111333300000111111111333',
  '11102222111333300222221133300000',
  '11122221111111111222221133300000',
  '22222221110000222222221133311111',
  '22211111110000222111113330011111',
  '00011333110000111111113330011222',
  '00011333111222211100000111111222',
  '11111333111222211100000111222222',
  '11100001111222233311111111222111',
  '11100001111111133311110000022111',
];
const WOOD_SHADES = [1, 0.985, 0.97, 0.957]; // 模様の数字ごとの明るさ。差をごく小さくして、ムラが板の上で浮かないようにする
export const WOOD_SPAN_U = 1.6; // 木目の模様1枚が覆う長さ（m）。木目の向き。長くして、ムラを木目に沿った細長い形にする
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
  tex.minFilter = THREE.LinearMipmapLinearFilter; // 少し離れたらムラの境目をぼかしてならす（ドットのちらつきも出ない）
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

/** 四角いムラのドット絵（明るさだけの模様）の決め方。海の水面と地面で使う */
export interface BlotchSpec {
  /** 1ドットの大きさ（m） */
  dot: number;
  /** ドットを横（x）に伸ばす割合 */
  stretch: number;
  /** 重ねるムラの大きさ（ドット数）。大きい順に塗り、小さいムラが上に乗る */
  sizes: number[];
  /** 明るいムラ・暗いムラの明るさ */
  bright: number;
  dark: number;
  /** ムラのうち明るく・暗くなる割合（大きさごと） */
  brightRate: number;
  darkRate: number;
  /** カメラからこの距離（m）までに、模様をだんだん薄くして消す（遠くでちらつかないように） */
  fade: number;
}

/** ドットの番号（2次元・3次元）から 0〜1 の乱数を返す GLSL の関数（誰の画面でも同じ）。使うシェーダーの先頭に入れる */
export const BLOTCH_HASH_GLSL = `float blotchHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
float blotchHash(vec3 c) { return fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`;

/**
 * 四角いムラの明るさの倍率を float out に入れる GLSL。p は位置（m）の式で、dims が 2 なら vec2、3 なら vec3（立体の物は3次元のマスで散らす）。
 * ムラはドットの番号から決めた乱数で散らすので、くり返しの柄にならない。遠くでは 1 に近づける（vViewPosition を使う）
 */
export function blotchGlsl(p: string, s: BlotchSpec, out: string, dims: 2 | 3 = 2): string {
  const f = (n: number, d = 3) => n.toFixed(d);
  const vec = `vec${dims}`;
  const rest = dims === 3 ? ', 1.0, 1.0' : ', 1.0';
  const shift = (k: number) => [k * 1.7, k * 2.3, k * 0.9].slice(0, dims).map((n) => f(n, 1)).join(', ');
  return `float ${out} = 1.0;
  {
    ${vec} bp = (${p}) / (${f(s.dot)} * ${vec}(${f(s.stretch)}${rest}));
${s.sizes
  .map(
    (n, k) => `    { float h = blotchHash(floor((bp + ${vec}(${shift(k)})) / ${f(n, 1)}) + ${f(k * 31, 1)});
      if (h < ${f(s.darkRate)}) ${out} = ${f(s.dark)};
      else if (h > ${f(1 - s.brightRate)}) ${out} = ${f(s.bright)}; }`,
  )
  .join('\n')}
    ${out} = mix(1.0, ${out}, 1.0 - smoothstep(${f(s.fade * 0.5, 1)}, ${f(s.fade, 1)}, length(vViewPosition)));
  }`;
}

/**
 * マテリアルに四角いムラのドット絵を足す（頂点の位置＝物の中の座標で、3次元のマスに散らす。物が動いても模様はついていく）。
 * もとの onBeforeCompile（風の揺れなど）は先に動かす。key はシェーダーを見分ける名前（ムラの決め方ごとに変える）
 */
export function withBlotch<T extends THREE.Material>(mat: T, s: BlotchSpec, key: string): T {
  const beforeSrc = mat.onBeforeCompile.toString();
  const before = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBlotchPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlotchPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBlotchPos;\n${BLOTCH_HASH_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${blotchGlsl('vBlotchPos', s, 'blotchMul', 3)}\ndiffuseColor.rgb *= blotchMul;`);
  };
  mat.customProgramCacheKey = () => `${beforeSrc}|blotch:${key}`;
  return mat;
}

/** 木の幹・葉・茂みのドット絵（木目と同じくらい薄く。物の中の座標の3次元のマスで散らす） */
export const TREE_BLOTCH: BlotchSpec = {
  dot: 0.15, // 1ドットの大きさ（m）
  stretch: 1,
  sizes: [3, 2, 1],
  bright: 1.02,
  dark: 0.957,
  brightRate: 0.12,
  darkRate: 0.18,
  fade: 70,
};

const treeFlatCache = new Map<number, THREE.MeshLambertMaterial>();

/** flat() に木のドット絵（TREE_BLOTCH）を足したもの（木の幹や葉の部品に使う） */
export function treeFlat(color: number | THREE.Color): THREE.MeshLambertMaterial {
  const key = typeof color === 'number' ? color : color.getHex();
  let mat = treeFlatCache.get(key);
  if (!mat) {
    mat = withBlotch(new THREE.MeshLambertMaterial({ color: key, flatShading: true }), TREE_BLOTCH, 'tree');
    treeFlatCache.set(key, mat);
  }
  return mat;
}

let treeVertexMat: THREE.MeshLambertMaterial | null = null;

/** flatVertex() に木のドット絵（TREE_BLOTCH）を足したもの（遠くの木・茂みに使う） */
export function treeVertex(): THREE.MeshLambertMaterial {
  treeVertexMat ??= withBlotch(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), TREE_BLOTCH, 'tree');
  return treeVertexMat;
}
