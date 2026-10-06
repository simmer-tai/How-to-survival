import { chartRandom, readChart } from '../items/islandChart.js';

// 場所（自分の島・街・島の地図から海図に載せた島）。どの場所も WORLD_SIZE 四方で中心が原点の、別々の場面として扱う。
// プレイヤーはどれか1つの場所にいて、その場所だけを描き、その場所の物とだけぶつかる（自分の画面の切り替え）。
// どの場所の状態も共有ワールドの一部で、マルチではホストが全部の場所の状態を持つ。
// 海図に載せた島（isle）は、載せた順の番号で呼ぶ（isle0, isle1 …。番号はホストが発行する）

const ISLE_CHART_SIZE = 0.1; // 海図に載せた島の、海図での大きさ（海図の幅に対する割合）
const ISLE_CHART_MARGIN = 0.12; // 海図の縁から、これだけ内側に置く
const ISLE_CHART_CLEAR = 0.17; // ほかの場所の印から、これだけ離して置く（海図の幅に対する割合）
const ISLE_CHART_TRIES = 40; // 離れた所が見つかるまで試す回数

/** 海図に載せた島 */
export type IsleId = `isle${number}`;
export type LocationId = 'island' | 'town' | IsleId;

export interface LocationDef {
  id: LocationId;
  name: string;
  /** 海図での位置（0〜1。左上が 0, 0） */
  chart: [number, number];
  /** 海図での島の大きさ（海図の幅に対する割合） */
  chartSize: number;
}

const FIXED: Record<'island' | 'town', LocationDef> = {
  island: { id: 'island', name: '自分の島', chart: [0.3, 0.55], chartSize: 0.22 },
  town: { id: 'town', name: '街', chart: [0.74, 0.4], chartSize: 0.12 },
};

/** 海図に載せた島（番号順） */
const isles: LocationDef[] = [];

export const isleId = (n: number): IsleId => `isle${n}`;

/** 海図に載せた島なら、その番号（ほかの場所なら null） */
export function isleIndex(loc: LocationId): number | null {
  return loc.startsWith('isle') ? Number(loc.slice(4)) : null;
}

/**
 * 海図に載せた島をすべて決め直す（charts は島の番号順の、島の地図の中身）。
 * 海図での位置は、地図の種と、それより前に載せた島の位置から決める（誰の画面でも同じになる）
 */
export function setIsles(charts: number[]): void {
  isles.length = 0;
  for (const chart of charts) addIsle(chart);
}

/** 海図に島を1つ足す（番号は今の数）。足した島の場所を返す */
export function addIsle(chart: number): LocationDef {
  const { seed, name } = readChart(chart);
  const rand = chartRandom(seed + 2);
  const taken = [...Object.values(FIXED), ...isles].map((d) => d.chart);
  let spot: [number, number] = [0.5, 0.5];
  for (let i = 0; i < ISLE_CHART_TRIES; i++) {
    spot = [ISLE_CHART_MARGIN + rand() * (1 - ISLE_CHART_MARGIN * 2), ISLE_CHART_MARGIN + rand() * (1 - ISLE_CHART_MARGIN * 2)];
    if (taken.every(([x, y]) => Math.hypot(x - spot[0], y - spot[1]) > ISLE_CHART_CLEAR)) break;
  }
  const def: LocationDef = { id: isleId(isles.length), name, chart: spot, chartSize: ISLE_CHART_SIZE };
  isles.push(def);
  return def;
}

/** 場所の名前や海図での位置（ない島なら自分の島） */
export function locationDef(loc: LocationId): LocationDef {
  const n = isleIndex(loc);
  return n === null ? FIXED[loc as 'island' | 'town'] : (isles[n] ?? FIXED.island);
}

/** 海図に並べる場所（自分の島・街・海図に載せた島） */
export function allLocations(): LocationDef[] {
  return [...Object.values(FIXED), ...isles];
}

/** セーブデータなどから読んだ値を場所にする（知らない値や、まだ海図にない島なら自分の島） */
export function toLocation(id: unknown): LocationId {
  if (id === 'town') return 'town';
  if (typeof id === 'string' && /^isle(0|[1-9]\d*)$/.test(id) && Number(id.slice(4)) < isles.length) return id as IsleId;
  return 'island';
}
