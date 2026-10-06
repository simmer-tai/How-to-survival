import { LAND_KINDS, LAND_NAMES, type LandKind } from './landInfo.js';

// 島の地図の中身。製図台で白紙の地図と地形のメモを組み合わせると、島の地図が1枚できる。
// 地図は「種（seed）」と「組み合わせたメモ（told）」だけを持ち、1つの整数（chart）にまとめてスタックに入れる。
// 本当に島にある地形（lands）は、seed と told からいつも同じ計算で決める（誰の画面でも同じ島になる）。
// メモどおりの島になるとは限らない：メモの地形が抜け落ちたり、メモにない地形が混ざったりする。
// 出る見込みはプレイヤーには見せない。
// 地図を作るのはインベントリの中で完結する自分だけの行動なので、種は作った人のブラウザで決める（釣りの魚と同じ）

export const CHART_MAX_TOLD = 5; // 1枚の地図に組み合わせられるメモの数
const SHOW_BASE = 0.95; // メモを1つだけ組み合わせたとき、その地形が島に出る見込み
const SHOW_DECAY = 0.88; // メモが1つ増えるごとに、どの地形も出る見込みがこの割合に下がる（2つ：84%・3つ：74%・4つ：65%・5つ：57%）
const EXTRA_SLOTS = 2; // メモにない地形が混ざる数の最大
const EXTRA_BASE = 0.25; // メモを1つだけ組み合わせたとき、混ざる枠1つごとに地形が混ざる見込み
const EXTRA_STEP = 0.08; // メモが1つ増えるごとに、混ざる見込みがこれだけ上がる（欲張るほど地図があいまいになる）
const SEED_BITS = 30; // 種の大きさ（chart の上の桁）
const KIND_BITS = LAND_KINDS.length; // 組み合わせたメモを並べたビット（chart の下の桁）

// 島の名前：頭の字と、つなぎ（「ヶ」「の」など）を種から選ぶ
const NAME_HEADS = ['霧', '凪', '潮', '月', '星', '鴎', '汐', '朧', '暁', '碧', '蛍', '雫', '琥珀', '珊瑚', '鯨', '燕'];
const NAME_JOINS = ['ヶ', 'の', ''];

/** 島の地図の中身。lands は本当に島にある地形（プレイヤーには、渡ってみるまで見せない） */
export interface IslandChart {
  seed: number;
  told: LandKind[];
  lands: LandKind[];
  name: string;
}

/** 組み合わせたメモから、新しい地図の chart を作る（種はここで決める） */
export function newChart(told: LandKind[]): number {
  const seed = Math.floor(Math.random() * 2 ** SEED_BITS);
  const mask = told.reduce((m, k) => m | (1 << LAND_KINDS.indexOf(k)), 0);
  return seed * 2 ** KIND_BITS + mask;
}

/** chart として正しい値ならその値（メモが 1〜CHART_MAX_TOLD 個入っていること） */
export function validChart(chart: unknown): number | undefined {
  if (!Number.isSafeInteger(chart) || (chart as number) < 0 || (chart as number) >= 2 ** (SEED_BITS + KIND_BITS)) return undefined;
  const n = toldOf(chart as number).length;
  return n >= 1 && n <= CHART_MAX_TOLD ? (chart as number) : undefined;
}

function toldOf(chart: number): LandKind[] {
  const mask = chart % 2 ** KIND_BITS;
  return LAND_KINDS.filter((_, i) => mask & (1 << i));
}

/** chart を読み解く（本当の地形も、ここで決める） */
export function readChart(chart: number): IslandChart {
  const seed = Math.floor(chart / 2 ** KIND_BITS);
  const told = toldOf(chart);
  const rand = chartRandom(seed);
  // メモの地形が出るか（数が多いほど、どれも出にくくなる）。全部外れたら、1つだけは必ず出す
  const show = SHOW_BASE * SHOW_DECAY ** (told.length - 1);
  const kept = told.filter(() => rand() < show);
  if (kept.length === 0) kept.push(told[Math.floor(rand() * told.length)]);
  // メモにない地形が混ざる
  const extra = Math.min(EXTRA_BASE + EXTRA_STEP * (told.length - 1), 1);
  const others = LAND_KINDS.filter((k) => !told.includes(k));
  for (let i = 0; i < EXTRA_SLOTS && others.length > 0; i++) {
    if (rand() >= extra) continue;
    kept.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
  }
  const lands = LAND_KINDS.filter((k) => kept.includes(k));
  const name = NAME_HEADS[Math.floor(rand() * NAME_HEADS.length)] + NAME_JOINS[Math.floor(rand() * NAME_JOINS.length)] + '島';
  return { seed, told, lands, name };
}

/** メモの呼び名を「・」でつないだもの */
export function toldNames(told: LandKind[]): string {
  return told.map((k) => LAND_NAMES[k]).join('・');
}

/** 0〜1 の乱数を返す関数（種が同じなら、いつも同じ並び。mulberry32） */
export function chartRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
