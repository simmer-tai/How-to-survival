import { PALETTE } from '../core/palette.js';
import { ITEMS, type ItemId } from '../items/inventory.js';
import { itemIcon } from '../items/itemIcons.js';

/** 手に入れた素材を画面の右下に1行ずつ出す（自分だけの UI。同期しない） */

const SHOW_TIME = 3000; // 1行を表示しておく時間（ミリ秒）。同じ素材をまた手に入れると延びる
const FADE_TIME = 400; // 消えるときのフェードの時間（ミリ秒）
const MAX_ROWS = 5; // 同時に出す行の上限。超えたら古い行から消す

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface Row {
  item: ItemId;
  gained: number; // この行にまとめた個数
  el: HTMLElement;
  timer: number;
}

export class PickupFeed {
  private readonly root: HTMLElement;
  private rows: Row[] = [];

  constructor() {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'pickup';
    document.body.append(this.root);
  }

  /**
   * 手に入れたことを知らせる。total は入れたあとの所持数、lost は持ちきれずに失った個数。
   * 表示中の同じ素材の行があれば、そこに個数を足す
   */
  show(item: ItemId, gained: number, total: number, lost = 0): void {
    if (gained <= 0 && lost <= 0) return;
    let row = this.rows.find((r) => r.item === item);
    if (row) {
      row.gained += gained;
      clearTimeout(row.timer);
      this.root.append(row.el); // 新しい行と同じく一番下へ
      // 個数が増えたことがわかるように、少し弾ませる
      row.el.classList.remove('bump');
      void row.el.offsetWidth;
      row.el.classList.add('bump');
    } else {
      const el = document.createElement('div');
      el.className = 'pickup-row';
      row = { item, gained, el, timer: 0 };
      this.rows.push(row);
      this.root.append(el);
      while (this.rows.length > MAX_ROWS) this.drop(this.rows[0]);
    }
    this.rows = [...this.rows.filter((r) => r !== row), row];
    row.el.classList.remove('out');
    row.el.innerHTML =
      `<img src="${itemIcon(item)}" alt="" draggable="false">` +
      (row.gained > 0 ? `<span class="pickup-gain">+${row.gained}</span>` : '') +
      `<span class="pickup-name">${ITEMS[item].name}</span>` +
      `<span class="pickup-total">所持 ${total}</span>` +
      (lost > 0 ? `<span class="pickup-lost">持ちきれない</span>` : '');
    const r = row;
    row.timer = window.setTimeout(() => this.drop(r), SHOW_TIME);
  }

  /** 行をフェードさせて消す */
  private drop(row: Row): void {
    clearTimeout(row.timer);
    this.rows = this.rows.filter((r) => r !== row);
    row.el.classList.add('out');
    window.setTimeout(() => row.el.remove(), FADE_TIME);
  }
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .pickup {
      position: fixed; right: calc(16 * var(--u)); bottom: calc(16 * var(--u)); z-index: 5;
      display: flex; flex-direction: column; align-items: flex-end; gap: calc(4 * var(--u));
      pointer-events: none; user-select: none;
    }
    .pickup-row {
      display: flex; align-items: center; gap: calc(8 * var(--u));
      padding: calc(4 * var(--u)) calc(12 * var(--u)) calc(4 * var(--u)) calc(6 * var(--u));
      border-radius: calc(8 * var(--u)); background: rgba(43, 38, 51, 0.55); color: #fff;
      font-size: calc(15 * var(--u)); font-weight: 700; text-shadow: 0 1px 0 #2b2633;
      animation: pickup-in 0.25s ease-out;
      transition: opacity ${FADE_TIME}ms, transform ${FADE_TIME}ms;
    }
    .pickup-row.out { opacity: 0; transform: translateX(calc(24 * var(--u))); }
    .pickup-row.bump .pickup-gain { animation: pickup-bump 0.25s ease-out; }
    .pickup-row img {
      width: calc(32 * var(--u)); height: calc(32 * var(--u));
      filter: drop-shadow(1px 0 0 #2b2633) drop-shadow(-1px 0 0 #2b2633) drop-shadow(0 1px 0 #2b2633) drop-shadow(0 -1px 0 #2b2633);
    }
    .pickup-gain { color: ${css(PALETTE.grass)}; font-size: calc(18 * var(--u)); display: inline-block; }
    .pickup-total { font-size: calc(12 * var(--u)); opacity: 0.75; }
    .pickup-lost { font-size: calc(12 * var(--u)); color: ${css(PALETTE.accent)}; }
    @keyframes pickup-in {
      from { opacity: 0; transform: translateX(calc(24 * var(--u))); }
      to { opacity: 1; transform: none; }
    }
    @keyframes pickup-bump {
      0% { transform: scale(1); }
      40% { transform: scale(1.35); }
      100% { transform: scale(1); }
    }
  `;
  document.head.append(style);
}
