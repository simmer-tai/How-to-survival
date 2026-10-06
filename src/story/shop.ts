import { PALETTE } from '../core/palette.js';
import { ITEMS, isCurrency, type Inventory, type ItemId } from '../items/inventory.js';
import { itemIcon } from '../items/itemIcons.js';
import { TRADES, type MerchantId, type Trade } from '../items/trades.js';
import { keyGuide } from '../ui/keyGuide.js';
import { FARMER_NAME, MAPMAKER_NAME, NPC_NAME } from './quests.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

const COLS = 5; // 品物のマスを横に並べる数

/** 取引の画面に出す、住人の名前とひとこと */
const MERCHANTS: Record<MerchantId, { name: string; say: string }> = {
  pier: { name: NPC_NAME, say: '何か持ってきたかい？' },
  farmer: { name: FARMER_NAME, say: '島でとれた物なら高く買うよ。木の種も分けてあげよう' },
  mapmaker: { name: MAPMAKER_NAME, say: 'いらっしゃい。地図があれば、どこにいても迷わないよ。持って[右]で広げてごらん' },
};

/** sell：持ち物を渡してお金をもらう取引。buy：お金などを渡して品物をもらう取引 */
type Tab = 'sell' | 'buy';
const TAB_NAMES: Record<Tab, string> = { sell: '売る', buy: '買う' };

interface Amount { item: ItemId; count: number }

const tabOf = (trade: Trade): Tab => (isCurrency(trade.get.item) ? 'sell' : 'buy');
const give = (trade: Trade): Amount[] => Object.entries(trade.give).map(([item, count]) => ({ item: item as ItemId, count: count! }));
/** マスに出す品物（売るなら渡す物、買うならもらう物） */
const goods = (trade: Trade): Amount => (tabOf(trade) === 'sell' ? give(trade)[0] : trade.get);
/** マスの下に出す値段（売るならもらうお金、買うなら渡すお金） */
const price = (trade: Trade): Amount => (tabOf(trade) === 'sell' ? trade.get : give(trade)[0]);

/**
 * 住人と取引する画面（桟橋の人は作業台の頼みごとを終えたあと、街の農家と地図売りはいつでも、話しかけると開く）。
 * インベントリと同じマスの見た目で品物を並べ、「売る」「買う」のタブで切り替える。マスを選ぶと下に交換の中身が出る。
 * 変わるのは自分のインベントリだけなので、自分だけの行動としてその場で処理する
 */
export class Shop {
  isOpen = false;
  /** 開いた時刻（開いたのと同じ [F] で閉じないように） */
  private openedAt = 0;
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly sayEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly dealEl: HTMLElement;
  private readonly purseEl: HTMLElement;
  /** 今取引している住人 */
  private merchant: MerchantId = 'pier';
  private tab: Tab = 'sell';
  /** 選んでいる取引（今のタブの中の何番目か） */
  private selected = 0;

  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** 受け取った物をインベントリに入れる（main が獲得ログにも出す） */
  onGain: (item: ItemId, count: number) => void = () => {};

  constructor(private readonly inventory: Inventory) {
    injectStyle();
    this.root = el('div', 'shop');
    const head = el('div', 'shop-head');
    this.titleEl = el('div', 'shop-title');
    this.sayEl = el('div', 'shop-say');
    head.append(this.titleEl, this.sayEl);
    this.tabsEl = el('div', 'shop-tabs');
    for (const tab of ['sell', 'buy'] as Tab[]) {
      const button = el('button', 'shop-tab');
      button.dataset.tab = tab;
      button.textContent = TAB_NAMES[tab];
      button.addEventListener('click', () => this.setTab(tab));
      this.tabsEl.append(button);
    }
    this.gridEl = el('div', 'shop-grid');
    this.dealEl = el('div', 'shop-deal');
    this.purseEl = el('div', 'shop-purse');
    const hint = el('div', 'shop-hint');
    hint.innerHTML = keyGuide('[左]：品物を選ぶ ／ [Shift]+[左]：できるだけ交換する ／ [F] [Esc]：閉じる');
    const panel = el('div', 'shop-panel');
    panel.append(this.tabsEl, this.gridEl, this.dealEl);
    this.root.append(head, panel, this.purseEl, hint);
    document.body.append(this.root);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (!this.isOpen || e.timeStamp <= this.openedAt) return;
      if (e.code === 'Escape' || e.code === 'KeyF') this.setOpen(false, e.code === 'KeyF');
    });
  }

  /** merchant との取引の画面を開く（「売る」のタブから。売る物が無い住人なら「買う」から）。say を渡すと、いつものひとことの代わりに出す（頼みごとのヒントなど） */
  open(merchant: MerchantId, say?: string): void {
    this.merchant = merchant;
    this.titleEl.textContent = MERCHANTS[merchant].name;
    this.sayEl.innerHTML = keyGuide(say ?? MERCHANTS[merchant].say);
    this.tab = TRADES[merchant].some((t) => tabOf(t) === 'sell') ? 'sell' : 'buy';
    this.selected = 0;
    this.setOpen(true);
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) this.openedAt = performance.now();
    if (open) this.render(); // 開くたびに、持っている数を見て作り直す
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.selected = 0;
    this.render();
  }

  /** 今のタブに並べる取引 */
  private trades(): Trade[] {
    return TRADES[this.merchant].filter((t) => tabOf(t) === this.tab);
  }

  /** 今の持ち物で、あと何回取引できるか（受け取る物が持ちきれない分は数えない） */
  private times(trade: Trade): number {
    const byGive = Math.min(...give(trade).map(({ item, count }) => Math.floor(this.inventory.count(item) / count)));
    return Math.min(byGive, Math.floor(this.inventory.room(trade.get.item) / trade.get.count));
  }

  /** times 回まとめて取引する */
  private trade(trade: Trade, times: number): void {
    if (times <= 0) return;
    for (const { item, count } of give(trade)) this.inventory.remove(item, count * times);
    this.onGain(trade.get.item, trade.get.count * times);
    this.render();
  }

  private render(): void {
    // タブ：中身のないタブは押せなくする
    for (const button of this.tabsEl.children as HTMLCollectionOf<HTMLButtonElement>) {
      const tab = button.dataset.tab as Tab;
      button.classList.toggle('active', tab === this.tab);
      button.disabled = !TRADES[this.merchant].some((t) => tabOf(t) === tab);
    }

    // 品物のマス。足りなくて交換できない物は暗くする
    const trades = this.trades();
    this.selected = Math.min(this.selected, Math.max(trades.length - 1, 0));
    this.gridEl.replaceChildren(
      ...trades.map((trade, i) => {
        const g = goods(trade);
        const p = price(trade);
        const cell = el('div', 'shop-cell');
        const slot = el('div', 'shop-slot' + (i === this.selected ? ' selected' : '') + (this.times(trade) > 0 ? '' : ' lack'));
        slot.innerHTML = icon(g.item) + (g.count > 1 ? `<span class="shop-count">${g.count}</span>` : '');
        slot.title = ITEMS[g.item].name;
        slot.addEventListener('click', (e) => {
          this.selected = i;
          if (e.shiftKey) this.trade(trade, this.times(trade));
          else this.render();
        });
        const tag = el('div', 'shop-price');
        tag.innerHTML = `${icon(p.item)}${p.count}`;
        cell.append(slot, tag);
        return cell;
      }),
    );
    // 空いたマスも並べて、インベントリのような升目に見せる
    const blanks = Math.max(COLS - trades.length, (COLS - (trades.length % COLS)) % COLS);
    for (let i = 0; i < blanks; i++) {
      const cell = el('div', 'shop-cell');
      cell.append(el('div', 'shop-slot empty'), el('div', 'shop-price'));
      this.gridEl.append(cell);
    }

    // 選んだ取引の中身：渡す物 → もらう物
    const trade = trades[this.selected];
    if (!trade) {
      this.dealEl.innerHTML = '<div class="shop-none">今はない</div>';
    } else {
      const times = this.times(trade);
      const side = (amounts: Amount[], giving: boolean) =>
        amounts
          .map(({ item, count }) => {
            const have = this.inventory.count(item);
            return (
              `<div class="shop-item${giving && have < count ? ' short' : ''}">` +
              `<div class="shop-slot">${icon(item)}${count > 1 ? `<span class="shop-count">${count}</span>` : ''}</div>` +
              `<div class="shop-item-name">${ITEMS[item].name}<small>所持 ${have}</small></div></div>`
            );
          })
          .join('');
      this.dealEl.innerHTML =
        `<div class="shop-trade"><div class="shop-side">${side(give(trade), true)}</div>` +
        `<div class="shop-arrow">→</div><div class="shop-side">${side([trade.get], false)}</div></div>` +
        `<div class="shop-btns"><button class="shop-btn one"${times > 0 ? '' : ' disabled'}>${TAB_NAMES[this.tab]}</button>` +
        `<button class="shop-btn all"${times > 1 ? '' : ' disabled'}>まとめて${TAB_NAMES[this.tab]}（×${times}）</button></div>`;
      this.dealEl.querySelector('.one')!.addEventListener('click', () => this.trade(trade, Math.min(1, this.times(trade))));
      this.dealEl.querySelector('.all')!.addEventListener('click', () => this.trade(trade, this.times(trade)));
    }

    // 持っているお金
    this.purseEl.innerHTML = `<div class="shop-slot">${icon('coin')}</div><span>${this.inventory.count('coin')}</span>`;
  }
}

function icon(item: ItemId): string {
  return `<img src="${itemIcon(item)}" alt="" draggable="false">`;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function injectStyle(): void {
  const style = document.createElement('style');
  // マスの見た目はインベントリ（items/inventory.ts）に合わせる
  style.textContent = `
    .shop {
      display: none; position: fixed; left: 50%; top: 46%; transform: translate(-50%, -50%); z-index: 5;
      flex-direction: column; align-items: center; gap: calc(8 * var(--u));
      max-width: calc(100vw - 32px); color: #fff; user-select: none;
    }
    .shop.open { display: flex; }
    .shop-head { text-align: center; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
    .shop-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.1em; }
    .shop-say { font-size: calc(13 * var(--u)); opacity: 0.9; }
    .shop-panel {
      display: flex; flex-direction: column; align-items: stretch; gap: calc(8 * var(--u));
      padding: calc(6 * var(--u)) calc(6 * var(--u)) calc(10 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.55);
    }
    .shop-tabs { display: flex; gap: calc(4 * var(--u)); }
    .shop-tab {
      flex: 1; padding: calc(6 * var(--u)) 0; border: none; border-radius: calc(6 * var(--u));
      font: inherit; font-size: calc(14 * var(--u)); font-weight: 700; color: #fff; cursor: pointer;
      background: rgba(255, 255, 255, 0.1); box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.08);
    }
    .shop-tab:hover { background: rgba(255, 255, 255, 0.2); }
    .shop-tab.active { color: #2b2633; background: ${css(PALETTE.sand)}; box-shadow: none; cursor: default; }
    .shop-tab:disabled { opacity: 0.35; cursor: default; background: rgba(255, 255, 255, 0.1); }
    .shop-grid { display: grid; grid-template-columns: repeat(${COLS}, calc(52 * var(--u))); gap: calc(4 * var(--u)); justify-content: center; }
    .shop-cell { display: flex; flex-direction: column; align-items: center; gap: calc(2 * var(--u)); }
    .shop-slot {
      position: relative; flex: none; width: calc(52 * var(--u)); height: calc(52 * var(--u)); border-radius: calc(6 * var(--u));
      background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.12);
    }
    .shop-grid .shop-slot:not(.empty) { cursor: pointer; }
    .shop-grid .shop-slot:not(.empty):hover { background: rgba(255, 255, 255, 0.28); }
    .shop-slot.selected { box-shadow: inset 0 0 0 calc(3 * var(--u)) ${css(PALETTE.sand)}; background: rgba(255, 255, 255, 0.24); }
    .shop-slot.lack img { opacity: 0.4; filter: grayscale(0.8); }
    .shop-slot img {
      position: absolute; inset: calc(6 * var(--u)); width: calc(40 * var(--u)); height: calc(40 * var(--u));
      filter: drop-shadow(1px 0 0 #2b2633) drop-shadow(-1px 0 0 #2b2633) drop-shadow(0 1px 0 #2b2633)
        drop-shadow(0 -1px 0 #2b2633) drop-shadow(0 calc(2 * var(--u)) 1px rgba(43, 38, 51, 0.45));
    }
    .shop-count {
      position: absolute; right: calc(4 * var(--u)); bottom: calc(2 * var(--u)); font-size: calc(13 * var(--u)); font-weight: 700;
      text-shadow: 0 1px 0 #2b2633, 0 0 calc(3 * var(--u)) #2b2633;
    }
    .shop-price {
      display: flex; align-items: center; justify-content: center; gap: calc(1 * var(--u)); min-height: calc(18 * var(--u));
      font-size: calc(12 * var(--u)); font-weight: 700; color: ${css(PALETTE.sand)};
    }
    .shop-price img { width: calc(18 * var(--u)); height: calc(18 * var(--u)); }
    .shop-deal {
      display: flex; flex-direction: column; align-items: center; gap: calc(8 * var(--u));
      padding-top: calc(8 * var(--u)); border-top: 1px solid rgba(255, 255, 255, 0.15);
    }
    .shop-trade { display: flex; align-items: center; gap: calc(10 * var(--u)); }
    .shop-side { display: flex; gap: calc(8 * var(--u)); }
    .shop-item { display: flex; flex-direction: column; align-items: center; gap: calc(2 * var(--u)); min-width: calc(64 * var(--u)); }
    .shop-item-name { display: flex; flex-direction: column; align-items: center; font-size: calc(12 * var(--u)); font-weight: 700; }
    .shop-item-name small { font-size: calc(11 * var(--u)); font-weight: 400; opacity: 0.75; }
    .shop-item.short small { color: ${css(PALETTE.accent)}; opacity: 1; font-weight: 700; }
    .shop-arrow { font-size: calc(22 * var(--u)); font-weight: 700; color: ${css(PALETTE.sand)}; padding-bottom: calc(26 * var(--u)); }
    .shop-btns { display: flex; gap: calc(6 * var(--u)); }
    .shop-btn {
      padding: calc(7 * var(--u)) calc(14 * var(--u)); border: none; border-radius: calc(8 * var(--u));
      font: inherit; font-size: calc(14 * var(--u)); font-weight: 700; cursor: pointer;
      color: #2b2633; background: ${css(PALETTE.sand)};
    }
    .shop-btn.all { color: #fff; background: rgba(255, 255, 255, 0.18); }
    .shop-btn:hover { filter: brightness(1.08); }
    .shop-btn:disabled { cursor: default; color: #fff; background: rgba(255, 255, 255, 0.1); opacity: 0.6; filter: none; }
    .shop-none { font-size: calc(13 * var(--u)); opacity: 0.7; padding: calc(10 * var(--u)) 0; }
    .shop-purse {
      display: flex; align-items: center; gap: calc(8 * var(--u)); padding: calc(6 * var(--u)) calc(14 * var(--u)) calc(6 * var(--u)) calc(6 * var(--u));
      border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.55);
      font-size: calc(18 * var(--u)); font-weight: 700;
    }
    .shop-purse .shop-slot { box-shadow: inset 0 0 0 calc(2 * var(--u)) ${css(PALETTE.sand)}; }
    .shop-hint { font-size: calc(12 * var(--u)); opacity: 0.85; text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
  `;
  document.head.append(style);
}
