import type { WorldRequest } from '../core/commands.js';
import type { ItemDrops } from '../items/drops.js';
import { isSandAt, terrainHeight } from './terrain.js';

const PEBBLE_MAX = 24; // 砂浜に落ちている小石の数の上限
const PEBBLE_INTERVAL = 30; // 上限より少ないとき、1個増えるまでの時間（秒）
const PEBBLE_MIN_HEIGHT = 0.3; // これより低い（波打ち際の）砂浜には置かない
const PEBBLE_TRIES = 60; // 置き場所を探す回数
const PEBBLE_SEED = 41017;
const AREA = 70; // 島の中心からこの範囲で探す

/** セーブデータ上の小石の湧き具合。seq はこれまでに置いた数（置き場所の乱数に使う） */
export interface PebblesSave { seq: number; time: number }

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 砂浜に拾える小石（アイテムは石）を落としておく。拾われて減ると、時間がたつと別の場所に増える。
 * 置くのは落とし物の dropItem コマンドなので、マルチではホストだけが update を呼ぶ
 */
export class BeachPebbles {
  private seq = 0;
  private time = 0;

  /** 共有ワールドへの頼みを出す（main が設定する） */
  request: (req: WorldRequest) => boolean = () => false;

  /** blocked は、岩や木・桟橋などがあって小石を置きたくない場所なら true */
  constructor(
    private readonly drops: ItemDrops,
    private readonly blocked: (x: number, z: number) => boolean,
  ) {}

  /** 砂浜に落ちている石の数（プレイヤーが落とした石も数える） */
  private get onBeach(): number {
    return this.drops.count((item, p) => item === 'stone' && isSandAt(p.x, p.z));
  }

  /** 上限まで一度に置く（新しいワールドを始めたとき） */
  fill(): void {
    for (let n = this.onBeach; n < PEBBLE_MAX; n++) this.spawn();
  }

  update(dt: number): void {
    if (this.onBeach >= PEBBLE_MAX) {
      this.time = 0;
      return;
    }
    this.time += dt;
    if (this.time < PEBBLE_INTERVAL) return;
    this.time = 0;
    this.spawn();
  }

  private spawn(): void {
    const rand = mulberry32(PEBBLE_SEED + this.seq++);
    for (let k = 0; k < PEBBLE_TRIES; k++) {
      const x = (rand() - 0.5) * AREA * 2;
      const z = (rand() - 0.5) * AREA * 2;
      const y = terrainHeight(x, z);
      if (y < PEBBLE_MIN_HEIGHT || !isSandAt(x, z) || this.blocked(x, z)) continue;
      this.request({ type: 'dropItem', item: 'stone', count: 1, p: [x, y + 0.15, z], v: [0, 0, 0] });
      return;
    }
  }

  // ---- セーブ ----

  serialize(): PebblesSave {
    return { seq: this.seq, time: this.time };
  }

  /** 一度も置いていないワールドなら、上限まで置く（落とし物を戻したあとに呼ぶ） */
  restore(save: PebblesSave): void {
    this.seq = save.seq;
    this.time = save.time;
    if (this.seq === 0) this.fill();
  }
}
