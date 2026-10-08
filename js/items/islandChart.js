import { LAND_KINDS, LAND_NAMES } from './landInfo.js';
// 島の地図の中身。製図台で白紙の地図と地形のメモを組み合わせると、島の地図が1枚できる。
// 地図は「種（seed）」と「組み合わせたメモ（told）」だけを持ち、1つの整数（chart）にまとめてスタックに入れる。
// 本当に島にある地形（lands）は、seed と told からいつも同じ計算で決める（誰の画面でも同じ島になる）。
// メモの地形はかならず島に出る。ただしメモどおりの島になるとは限らず、メモにない地形が混ざることがある。
// 混ざる見込みはプレイヤーには見せない。
// 地図を作るのはインベントリの中で完結する自分だけの行動なので、種は作った人のブラウザで決める（釣りの魚と同じ）
export const CHART_MAX_TOLD = 5; // 1枚の地図に組み合わせられるメモの数
const EXTRA_SLOTS = 2; // メモにない地形が混ざる数の最大
const EXTRA_BASE = 0.25; // メモを1つだけ組み合わせたとき、混ざる枠1つごとに地形が混ざる見込み
const EXTRA_STEP = 0.08; // メモが1つ増えるごとに、混ざる見込みがこれだけ上がる（欲張るほど地図があいまいになる）
const SEED_BITS = 30; // 種の大きさ
const FIRST_KINDS = 11; // 最初からある地形の数（空洞まで）。この地形のメモは chart の下の桁、あとから足した地形のメモは種より上の桁に並べる
const KIND_BITS = LAND_KINDS.length; // 組み合わせたメモを並べたビットの数
// 島の名前：頭の字と、つなぎ（「ヶ」「の」など）を種から選ぶ
const NAME_HEADS = ['霧', '凪', '潮', '月', '星', '鴎', '汐', '朧', '暁', '碧', '蛍', '雫', '琥珀', '珊瑚', '鯨', '燕'];
const NAME_JOINS = ['ヶ', 'の', ''];
/** 組み合わせたメモから、新しい地図の chart を作る（種はここで決める） */
export function newChart(told) {
    const seed = Math.floor(Math.random() * 2 ** SEED_BITS);
    const mask = told.reduce((m, k) => m | (1 << LAND_KINDS.indexOf(k)), 0);
    return encode(seed, mask);
}
// chart の並び：下の桁から、最初からある地形のメモ（FIRST_KINDS）・種（SEED_BITS）・あとから足した地形のメモ。
// あとから足した地形を種より上に置くので、地形を足す前に作った地図の chart はそのまま読める
const LOW = 2 ** FIRST_KINDS;
const encode = (seed, mask) => (Math.floor(mask / LOW) * 2 ** SEED_BITS + seed) * LOW + (mask % LOW);
const seedOf = (chart) => Math.floor(chart / LOW) % 2 ** SEED_BITS;
const maskOf = (chart) => Math.floor(chart / (LOW * 2 ** SEED_BITS)) * LOW + (chart % LOW);
/** chart として正しい値ならその値（メモが 1〜CHART_MAX_TOLD 個入っていること） */
export function validChart(chart) {
    if (!Number.isSafeInteger(chart) || chart < 0 || chart >= 2 ** (SEED_BITS + KIND_BITS))
        return undefined;
    const n = toldOf(chart).length;
    return n >= 1 && n <= CHART_MAX_TOLD ? chart : undefined;
}
function toldOf(chart) {
    const mask = maskOf(chart);
    return LAND_KINDS.filter((_, i) => mask & (1 << i));
}
/** chart を読み解く（本当の地形も、ここで決める） */
export function readChart(chart) {
    const seed = seedOf(chart);
    const told = toldOf(chart);
    const rand = chartRandom(seed);
    // メモの地形は全部出る
    const kept = [...told];
    // メモにない地形が混ざる
    const extra = Math.min(EXTRA_BASE + EXTRA_STEP * (told.length - 1), 1);
    const others = LAND_KINDS.slice(0, FIRST_KINDS).filter((k) => !told.includes(k));
    for (let i = 0; i < EXTRA_SLOTS && others.length > 0; i++) {
        if (rand() >= extra)
            continue;
        kept.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
    }
    const name = NAME_HEADS[Math.floor(rand() * NAME_HEADS.length)] + NAME_JOINS[Math.floor(rand() * NAME_JOINS.length)] + '島';
    // あとから足した地形は、名前を決めたあとの乱数で1つずつ混ぜる（足す前に作った地図の島の地形と名前を変えないため）
    for (const k of LAND_KINDS.slice(FIRST_KINDS))
        if (!kept.includes(k) && rand() < extra)
            kept.push(k);
    const lands = LAND_KINDS.filter((k) => kept.includes(k));
    return { seed, told, lands, name };
}
/** メモの呼び名を「・」でつないだもの */
export function toldNames(told) {
    return told.map((k) => LAND_NAMES[k]).join('・');
}
/** 0〜1 の乱数を返す関数（種が同じなら、いつも同じ並び。mulberry32） */
export function chartRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
