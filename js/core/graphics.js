// 画質の設定（高・中・低）。自分だけの状態で、ワールドではなくこのブラウザに保存する（マルチでも同期しない）。
// 段階は自分で選ぶ。端末の様子から決めた「おすすめ」は設定画面に出すだけで、勝手には変えない
export const QUALITY_ORDER = ['high', 'mid', 'low'];
export const GRAPHICS = {
    high: {
        label: '高',
        note: 'いちばんきれい。性能の高いパソコン向け',
        pixelRatio: 2, antialias: true, shadowSize: 4096, shadowInterval: 2, viewScale: 1, grassDistance: 70, lodScale: 1,
    },
    mid: {
        label: '中',
        note: '影と遠くの景色を少し控えめにする',
        pixelRatio: 1, antialias: true, shadowSize: 2048, shadowInterval: 3, viewScale: 0.85, grassDistance: 45, lodScale: 0.75,
    },
    low: {
        label: '低',
        note: '粗めに描いて軽くする。Chromebook などの軽いパソコン向け',
        pixelRatio: 0.75, antialias: false, shadowSize: 1024, shadowInterval: 4, viewScale: 0.7, grassDistance: 28, lodScale: 0.5,
    },
};
const QUALITY_KEY = 'island.quality'; // 選んだ段階を入れる localStorage のキー
const DEFAULT_QUALITY = 'high'; // まだ選んでいないときの段階
const FEW_CORES = 4; // CPU のコアがこれ以下なら軽い端末とみる
const SMALL_MEMORY = 4; // メモリ（GB）がこれ以下なら軽い端末とみる
/** 軽いグラフィックス（ソフトウェア描画・スマホ向けの GPU）の名前に含まれる言葉 */
const WEAK_GPU = /swiftshader|llvmpipe|software|mali|adreno|powervr|videocore/i;
/** パソコンの CPU に入っているグラフィックスの名前に含まれる言葉 */
const BUILT_IN_GPU = /intel|uhd|iris|radeon\(tm\) graphics|vega \d+ graphics|apple gpu/i;
export function loadQuality() {
    try {
        const q = localStorage.getItem(QUALITY_KEY);
        if (q && QUALITY_ORDER.includes(q))
            return q;
    }
    catch {
        // 保存を読めないときは決まった段階で始める
    }
    return DEFAULT_QUALITY;
}
export function saveQuality(q) {
    try {
        localStorage.setItem(QUALITY_KEY, q);
    }
    catch {
        // 保存できなくても、今の画面にはかかる
    }
}
/** 端末の様子（グラフィックスの名前・CPU のコア数・メモリ）からおすすめの段階を決める */
export function recommendQuality(gl) {
    const gpu = gpuName(gl);
    const cores = navigator.hardwareConcurrency ?? 0;
    const memory = navigator.deviceMemory ?? 0;
    if (gpu && WEAK_GPU.test(gpu))
        return { quality: 'low', reason: '軽いグラフィックスを使っているようです' };
    if ((cores && cores <= FEW_CORES) || (memory && memory <= SMALL_MEMORY)) {
        return { quality: 'low', reason: 'CPU やメモリが控えめな端末のようです' };
    }
    if (gpu && BUILT_IN_GPU.test(gpu))
        return { quality: 'mid', reason: 'CPU に入っているグラフィックスを使っているようです' };
    if (!gpu)
        return { quality: 'mid', reason: 'グラフィックスの種類がわからないので、まんなかをおすすめします' };
    return { quality: 'high', reason: '性能に余裕がありそうです' };
}
/** グラフィックスの名前（ブラウザが教えてくれないときは空） */
function gpuName(gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : '';
}
