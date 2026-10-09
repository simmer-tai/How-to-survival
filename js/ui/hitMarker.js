import { PALETTE } from '../core/palette.js';
// クロスヘアのヒットの合図（自分の画面だけの UI。同期しない）。
// 叩いて当たったとき、クロスヘアのまわりに斜めの4本の線がはじけるように出て消え、真ん中の点も一瞬ふくらむ。
// 倒したときは色を変えて、少し大きく長く出す。線はクロスヘアの子なので、三人称でクロスヘアが動いてもついていく
const HIT_TIME = 220; // 当たったときの合図の長さ（ミリ秒）
const KILL_TIME = 420; // 倒したときの合図の長さ（ミリ秒）
const css = (c) => '#' + c.toString(16).padStart(6, '0');
export class HitMarker {
    crosshair;
    marks;
    /** crosshair はクロスヘアの要素（index.html の #crosshair） */
    constructor(crosshair) {
        this.crosshair = crosshair;
        injectStyle();
        this.marks = document.createElement('div');
        this.marks.className = 'hit-marks';
        for (let i = 0; i < 4; i++)
            this.marks.append(document.createElement('i'));
        crosshair.append(this.marks);
    }
    /** 合図を出す（続けて当てても、はじめから出し直す） */
    play(killed) {
        for (const el of [this.marks, this.crosshair]) {
            el.classList.remove('hit', 'kill');
            void el.offsetWidth; // アニメーションを最初からやり直させる
            el.classList.add(killed ? 'kill' : 'hit');
        }
    }
}
let injected = false;
function injectStyle() {
    if (injected)
        return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
    .hit-marks { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; pointer-events: none; }
    .hit-marks i {
      position: absolute; left: calc(-1.5 * var(--u)); top: calc(-7 * var(--u)); width: calc(3 * var(--u)); height: calc(8 * var(--u));
      border-radius: calc(2 * var(--u)); background: #fff;
      transform-origin: 50% calc(7 * var(--u));
    }
    .hit-marks i:nth-child(1) { transform: rotate(45deg) translateY(calc(-9 * var(--u))); }
    .hit-marks i:nth-child(2) { transform: rotate(135deg) translateY(calc(-9 * var(--u))); }
    .hit-marks i:nth-child(3) { transform: rotate(225deg) translateY(calc(-9 * var(--u))); }
    .hit-marks i:nth-child(4) { transform: rotate(315deg) translateY(calc(-9 * var(--u))); }
    .hit-marks.hit { animation: hit-marks ${HIT_TIME}ms ease-out; }
    .hit-marks.kill { animation: hit-marks-kill ${KILL_TIME}ms ease-out; }
    .hit-marks.kill i { background: ${css(PALETTE.accent)}; }
    #crosshair.hit { animation: hit-dot ${HIT_TIME}ms ease-out; }
    #crosshair.kill { animation: hit-dot ${KILL_TIME}ms ease-out; }
    @keyframes hit-marks {
      0% { opacity: 1; transform: scale(0.6); }
      35% { opacity: 1; transform: scale(1.15); }
      100% { opacity: 0; transform: scale(1.3); }
    }
    @keyframes hit-marks-kill {
      0% { opacity: 1; transform: scale(0.7) rotate(0deg); }
      30% { opacity: 1; transform: scale(1.45) rotate(0deg); }
      70% { opacity: 1; transform: scale(1.35) rotate(0deg); }
      100% { opacity: 0; transform: scale(1.6) rotate(0deg); }
    }
    @keyframes hit-dot {
      0% { scale: 1.8; }
      100% { scale: 1; }
    }
  `;
    document.head.append(style);
}
