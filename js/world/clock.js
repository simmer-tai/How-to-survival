// ワールドの時刻（共有ワールド）。全員が同じ時刻を見るので、マルチではホストが進めて、
// 途中参加した人には snapshot() で、遊んでいる人にはときどき時刻を送って合わせる（ワールドコマンドにはしない）
const DAY_SECONDS = 12 * 60; // 昼（6:00〜18:00）にかかる実時間（秒）
const NIGHT_SECONDS = 6 * 60; // 夜（18:00〜翌6:00）にかかる実時間（秒）。夜は短めにする
const START_MINUTES = 7 * 60; // 新しいワールドは 1日目の 7:00 から始まる
const SUNRISE = 6; // 日の出の時刻
const SUNSET = 18; // 日の入りの時刻
const DAY_MINUTES = 24 * 60;
export class WorldClock {
    /** 1日目の 0:00 からの経過時間（ゲーム内の分） */
    minutes = START_MINUTES;
    /** 何日目か（1 から） */
    get day() {
        return Math.floor(this.minutes / DAY_MINUTES) + 1;
    }
    /** その日の時刻（0〜24 の小数） */
    get hour() {
        return (this.minutes % DAY_MINUTES) / 60;
    }
    get isNight() {
        return this.hour < SUNRISE || this.hour >= SUNSET;
    }
    update(dt) {
        const span = (SUNSET - SUNRISE) * 60; // 昼の長さ（ゲーム内の分）
        this.minutes += dt * (this.isNight ? (DAY_MINUTES - span) / NIGHT_SECONDS : span / DAY_SECONDS);
    }
    serialize() {
        return { minutes: this.minutes };
    }
    restore(save) {
        this.minutes = Number.isFinite(save?.minutes) ? Math.max(0, save.minutes) : START_MINUTES;
    }
}
