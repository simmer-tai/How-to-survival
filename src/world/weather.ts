import type { SetWeather, WeatherRequest } from '../core/commands.js';

// ワールドの天気（共有ワールド）。ふだんの天気はワールドの時刻だけから決まる（固定シードで区切りごとに選ぶ）ので、
// 時刻がそろっていれば誰の画面でも同じ天気になる。
// コマンドメニューで天気を決めたとき（setWeather）だけは、その指定を共有ワールドの状態として持ち、セーブする。
// 見た目（空・雲・雨・雷・波の高さ）は sky.ts・rain.ts・main.ts がここの値から決める

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm';

/** 天気ごとの見た目の強さ（区切りの変わり目では前後の天気のあいだを補う） */
interface WeatherLook {
  /** 雲の多さ（0〜1）。空を灰色にし、日差しを弱める */
  cover: number;
  /** 雨の強さ（0〜1） */
  rain: number;
  /** 波の高さの倍率 */
  waves: number;
  /** 雷の起こりやすさ（0〜1） */
  storm: number;
}

const LOOKS: Record<WeatherKind, WeatherLook> = {
  clear: { cover: 0.15, rain: 0, waves: 1, storm: 0 },
  cloudy: { cover: 0.65, rain: 0, waves: 1.15, storm: 0 },
  rain: { cover: 0.9, rain: 0.55, waves: 1.35, storm: 0 },
  storm: { cover: 1, rain: 1, waves: 1.9, storm: 1 },
};

const SPAN_MINUTES = 6 * 60; // 1つの天気が続く長さ（ゲーム内の分）
const CHANGE_MINUTES = 60; // 次の天気へ移り変わるのにかかる長さ（ゲーム内の分）
const CLEAR_SPANS = 2; // 1日目の 12:00 までは晴れにする（新しいワールドの最初は晴れから）
const WIND_CALM = 0.2; // 晴れの日の風の強さ（嵐を 1 とする）
const FORCE_MINUTES = 20; // コマンドで天気を変えたとき、移り変わるのにかかる長さ（ゲーム内の分）
const WEATHER_SEED = 7331; // 天気を選ぶ固定シード
/** 天気ごとの選ばれやすさ */
const CHANCES: [WeatherKind, number][] = [
  ['clear', 0.45],
  ['cloudy', 0.25],
  ['rain', 0.2],
  ['storm', 0.1],
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** span 番目の区切り（1日目の 0:00 から SPAN_MINUTES ごと）の天気 */
export function weatherOfSpan(span: number): WeatherKind {
  if (span < CLEAR_SPANS) return 'clear';
  let r = mulberry32(WEATHER_SEED + span * 977)();
  for (const [kind, chance] of CHANCES) {
    if (r < chance) return kind;
    r -= chance;
  }
  return 'clear';
}

const smooth = (k: number) => k * k * (3 - 2 * k);

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm'];

/** 見た目の強さを [cover, rain, waves, storm] の並びにしたもの（コマンドとセーブに入れる） */
export type WeatherValues = [number, number, number, number];

/**
 * コマンドで決めた天気。kind の天気へ、at（ワールドの時刻）の見た目 from から移り変わり、そのまま続く。
 * kind が null なら、ふだんの天気へ戻る途中（戻りきったら指定がないのと同じ）
 */
export interface WeatherSave {
  kind: WeatherKind | null;
  at: number;
  from: WeatherValues;
}

export class Weather implements WeatherLook {
  /** 今の天気（移り変わりの途中では、半分を過ぎたら次の天気） */
  kind: WeatherKind = 'clear';
  cover = LOOKS.clear.cover;
  rain = 0;
  waves = 1;
  storm = 0;
  /** コマンドで決めた天気（なければ null） */
  private forced: WeatherSave | null = null;

  /** 風の強さ（0〜1）。波の高さから決める（晴れでそよ風、嵐で 1） */
  get wind(): number {
    return Math.min(Math.max(WIND_CALM + ((1 - WIND_CALM) * (this.waves - 1)) / (LOOKS.storm.waves - 1), 0), 1);
  }

  /** コマンドで決めた天気（自動のときは null） */
  get forcedKind(): WeatherKind | null {
    return this.forced?.kind ?? null;
  }

  // ---- ホスト側：頼みを確かめて、コマンドにする ----

  /** いつから・今のどの見た目から変えるかはホストが決める（minutes はホストのワールドの時刻） */
  authorize(req: WeatherRequest, minutes: number): SetWeather | null {
    if (req.kind !== null && !WEATHER_KINDS.includes(req.kind)) return null;
    if (req.kind === this.forcedKind) return null;
    return { type: 'setWeather', kind: req.kind, at: minutes, from: [this.cover, this.rain, this.waves, this.storm] };
  }

  // ---- 適用側：コマンドの値だけで変える ----

  apply(cmd: SetWeather): void {
    this.forced = { kind: cmd.kind, at: cmd.at, from: [...cmd.from] };
  }

  serialize(): WeatherSave | null {
    return this.forced && { ...this.forced, from: [...this.forced.from] };
  }

  restore(save: WeatherSave | null | undefined): void {
    const ok = save && (save.kind === null || WEATHER_KINDS.includes(save.kind)) && Number.isFinite(save.at) && save.from?.length === 4;
    this.forced = ok ? { kind: save.kind, at: save.at, from: [...save.from] } : null;
  }

  /** minutes はワールドの時刻（WorldClock.minutes） */
  update(minutes: number): void {
    this.updateNatural(minutes);
    const f = this.forced;
    if (!f) return;
    const k = smooth(Math.min(Math.max((minutes - f.at) / FORCE_MINUTES, 0), 1));
    if (f.kind === null && k >= 1) {
      this.forced = null; // ふだんの天気へ戻りきった
      return;
    }
    // 目標の見た目（自動へ戻るときは、今のふだんの天気）
    const b = f.kind ? LOOKS[f.kind] : { cover: this.cover, rain: this.rain, waves: this.waves, storm: this.storm };
    if (f.kind) this.kind = f.kind;
    const [cover, rain, waves, storm] = f.from;
    this.cover = cover + (b.cover - cover) * k;
    this.rain = rain + (b.rain - rain) * k;
    this.waves = waves + (b.waves - waves) * k;
    this.storm = storm + (b.storm - storm) * k;
  }

  /** 時刻から決まる、ふだんの天気 */
  private updateNatural(minutes: number): void {
    const span = Math.floor(minutes / SPAN_MINUTES);
    const into = minutes - span * SPAN_MINUTES;
    const next = weatherOfSpan(span);
    const prev = into < CHANGE_MINUTES ? weatherOfSpan(span - 1) : next;
    const k = into < CHANGE_MINUTES ? smooth(into / CHANGE_MINUTES) : 1;
    this.kind = k < 0.5 ? prev : next;
    const a = LOOKS[prev];
    const b = LOOKS[next];
    this.cover = a.cover + (b.cover - a.cover) * k;
    this.rain = a.rain + (b.rain - a.rain) * k;
    this.waves = a.waves + (b.waves - a.waves) * k;
    this.storm = a.storm + (b.storm - a.storm) * k;
  }
}
