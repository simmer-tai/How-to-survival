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
let woodMat = null;
/** 頂点の色に木目のドット絵を重ねるフラットシェーディング。UV は 1 が WOOD_SPAN_U / V の長さになるように振る */
export function woodVertex() {
    if (woodMat)
        return woodMat;
    const w = WOOD_GRAIN[0].length;
    const h = WOOD_GRAIN.length;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
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
/** ドットの番号から 0〜1 の乱数を返す GLSL の関数（誰の画面でも同じ）。使うシェーダーの先頭に入れる */
export const BLOTCH_HASH_GLSL = 'float blotchHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }';
/**
 * 四角いムラの明るさの倍率を float out に入れる GLSL。p は位置（m）の vec2 の式。
 * ムラはドットの番号から決めた乱数で散らすので、くり返しの柄にならない。遠くでは 1 に近づける（vViewPosition を使う）
 */
export function blotchGlsl(p, s, out) {
    const f = (n, d = 3) => n.toFixed(d);
    return `float ${out} = 1.0;
  {
    vec2 bp = (${p}) / (${f(s.dot)} * vec2(${f(s.stretch)}, 1.0));
${s.sizes
        .map((n, k) => `    { float h = blotchHash(floor((bp + vec2(${f(k * 1.7, 1)}, ${f(k * 2.3, 1)})) / ${f(n, 1)}) + ${f(k * 31, 1)});
      if (h < ${f(s.darkRate)}) ${out} = ${f(s.dark)};
      else if (h > ${f(1 - s.brightRate)}) ${out} = ${f(s.bright)}; }`)
        .join('\n')}
    ${out} = mix(1.0, ${out}, 1.0 - smoothstep(${f(s.fade * 0.5, 1)}, ${f(s.fade, 1)}, length(vViewPosition)));
  }`;
}
