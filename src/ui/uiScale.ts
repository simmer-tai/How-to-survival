/** UI の大きさを画面サイズに合わせて自動で変える。
 *  :root に CSS 変数 --u（UI の 1px に当たる長さ）を置き、各 UI の CSS は calc(N * var(--u)) で寸法を書く。
 *  ブラウザのウィンドウサイズが変わると CSS だけで追従するので、JS 側の処理は要らない */

const BASE_WIDTH = 1600; // この幅（px）の画面で --u がちょうど 1px になる
const BASE_HEIGHT = 900; // この高さ（px）の画面で --u がちょうど 1px になる（幅と高さの小さい方に合わせる）
const MIN_SCALE = 0.6; // 小さい画面でもこれ以上は縮めない（文字が読めなくなるため）
const MAX_SCALE = 1.6; // 大きい画面でもこれ以上は大きくしない

/** --u を定義する。ほかの UI より先に呼ぶ必要はない（CSS 変数は描画時に解決される） */
export function installUiScale(): void {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --u: clamp(${MIN_SCALE}px, min(100vw / ${BASE_WIDTH}, 100vh / ${BASE_HEIGHT}), ${MAX_SCALE}px);
    }
  `;
  document.head.append(style);
}
