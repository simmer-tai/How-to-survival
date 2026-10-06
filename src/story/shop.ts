import { PALETTE } from '../core/palette.js';
import { ITEMS, isCurrency, type Inventory, type ItemId } from '../items/inventory.js';
import { itemIcon } from '../items/itemIcons.js';
import { TRADES, type MerchantId, type Trade } from '../items/trades.js';
import { keyGuide } from '../ui/keyGuide.js';
import { FARMER_NAME, MAPMAKER_NAME, NPC_NAME } from './quests.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

const COLS = 4; // 品物のカードを横に並べる数
const VISIBLE_ROWS = 4; // 一度に見せるカードの段の数（これより多いとスクロールする）
const CARD_H = 100; // カード1段分の高さの目安（スクロールする範囲の高さに使う）

/** 取引の画面に出す、住人の名前とひとこと */
const MERCHANTS: Record<MerchantId, { name: string; say: string }> = {
  pier: { name: NPC_NAME, say: '何か持ってきたかい？' },
  farmer: { name: FARMER_NAME, say: '島でとれたベリーなら買うよ。木の種も分けてあげよう' },
  mapmaker: { name: MAPMAKER_NAME, say: 'いらっしゃい。白紙の地図に島のメモを書き合わせれば、島の地図ができる。製図台がいるから、設計図も売ってるよ。どこまで本当かは、行ってみないとわからないけどね' },
};

/** sell：持ち物を渡してお金をもらう取引。buy：お金などを渡して品物をもらう取引 */
type Tab = 'sell' | 'buy';
const TAB_NAMES: Record<Tab, string> = { sell: '売る', buy: '買う' };

interface Amount { item: ItemId; count: number }

const tabOf = (trade: Trade): Tab => (isCurrency(trade.get.item) ? 'sell' : 'buy');
const give = (trade: Trade): Amount[] => Object.entries(trade.give).map(([item, count]) => ({ item: item as ItemId, count: count! }));
/** 行の左に出す品物（売るなら渡す物、買うならもらう物） */
const goods = (trade: Trade): Amount => (tabOf(trade) === 'sell' ? give(trade)[0] : trade.get);
/** 行の右に出す値段（売るならもらうお金、買うなら渡すお金） */
const price = (trade: Trade): Amount => (tabOf(trade) === 'sell' ? trade.get : give(trade)[0]);

/**
 * 住人と取引する画面（桟橋の人は作業台の頼みごとを終えたあと、街の農家と地図売りはいつでも、話しかけると開く）。
 * 「売る」「買う」のタブで切り替え、取引を1枚ずつのカード（品物のアイコンと値段の入ったボタン）にしてグリッドに並べる。
 * 品物の名前と持っている数は、カードにカーソルを合わせるとカーソルの横に出す。
 * 変わるのは自分のインベントリだけなので、自分だけの行動としてその場で処理する
 */
export class Shop {
  isOpen = false;
  /** 開いた時刻（開いたのと同じ [F] で閉じないように） */
  private openedAt = 0;
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly sayEl: HTMLElement;
  private readonly purseEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  /** カーソルを合わせたカードの品物の名前と持っている数 */
  private readonly tipEl: HTMLElement;
  /** カーソルが乗っているカードの取引（作り直しても同じ取引の名前を出し続ける） */
  private hovered: Trade | null = null;
  /** 今取引している住人 */
  private merchant: MerchantId = 'pier';
  private tab: Tab = 'sell';

  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** 受け取った物をインベントリに入れる（main が獲得ログにも出す） */
  onGain: (item: ItemId, count: number) => void = () => {};

  constructor(private readonly inventory: Inventory) {
    injectStyle();
    this.root = el('div', 'shop');
    // 上：住人の名前と持っているお金、その下にひとこと
    const head = el('div', 'shop-head');
    this.titleEl = el('div', 'shop-title');
    this.purseEl = el('div', 'shop-purse');
    head.append(this.titleEl, this.purseEl);
    this.sayEl = el('div', 'shop-say');
    this.tabsEl = el('div', 'shop-tabs');
    for (const tab of ['sell', 'buy'] as Tab[]) {
      const button = el('button', 'shop-tab');
      button.dataset.tab = tab;
      button.textContent = TAB_NAMES[tab];
      button.addEventListener('click', () => this.setTab(tab));
      this.tabsEl.append(button);
    }
    this.listEl = el('div', 'shop-grid');
    const hint = el('div', 'shop-hint');
    hint.innerHTML = keyGuide('[F] [Esc]：閉じる');
    this.root.append(head, this.sayEl, this.tabsEl, this.listEl, hint);
    this.tipEl = el('div', 'shop-tip');
    document.body.append(this.root, this.tipEl);
    addEventListener('mousemove', (e) => {
      this.tipEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });
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
    this.listEl.scrollTop = 0;
    this.setOpen(true);
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) this.openedAt = performance.now();
    this.hovered = null;
    if (open) this.render(); // 開くたびに、持っている数を見て作り直す
    else this.renderTip();
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.hovered = null;
    this.listEl.scrollTop = 0;
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

    // 取引をカードにして並べる。足りなくて交換できないカードは暗くし、足りない数を赤くする
    const trades = this.trades();
    const scroll = this.listEl.scrollTop; // 取引のたびに作り直しても、見ていた位置がずれないように
    if (trades.length === 0) {
      this.listEl.innerHTML = '<div class="shop-none">今はない</div>';
    } else {
      this.listEl.replaceChildren(...trades.map((trade) => this.card(trade)));
    }
    this.listEl.scrollTop = scroll;

    // 持っているお金
    this.purseEl.innerHTML = `${icon('coin')}<span>${this.inventory.count('coin')}</span>`;
    this.renderTip();
  }

  /** カーソルが乗っているカードの品物の名前（まとめてなら個数も）と、持っている数を出す */
  private renderTip(): void {
    const trade = this.isOpen ? this.hovered : null;
    if (trade) {
      const g = goods(trade);
      const pay = give(trade)[0];
      // 売る取引で品物が足りないときは、持っている数を赤くする
      const short = this.tab === 'sell' && this.inventory.count(pay.item) < pay.count;
      this.tipEl.innerHTML =
        `<div>${ITEMS[g.item].name}${g.count > 1 ? ` ×${g.count}` : ''}</div>` +
        `<div class="shop-tip-have${short ? ' short' : ''}">所持 ${this.inventory.count(g.item)}</div>`;
    }
    this.tipEl.classList.toggle('show', trade !== null);
  }

  /** 取引1つ分のカード：品物のアイコン、下に値段の入ったボタン（名前と持っている数はカーソルを合わせて出す）。まとめて取引できるときは右上に「×回数」 */
  private card(trade: Trade): HTMLElement {
    const g = goods(trade);
    const p = price(trade);
    const times = this.times(trade);
    // 足りるかを見るのは渡す側（売るなら品物、買うならお金）
    const pay = give(trade)[0];
    const short = this.inventory.count(pay.item) < pay.count;

    const card = el('div', 'shop-card' + (times > 0 ? '' : ' lack'));
    card.innerHTML = `<div class="shop-icon">${icon(g.item)}${g.count > 1 ? `<span class="shop-count">${g.count}</span>` : ''}</div>`;
    card.addEventListener('mouseenter', () => {
      this.hovered = trade;
      this.renderTip();
    });
    card.addEventListener('mouseleave', () => {
      if (this.hovered === trade) this.hovered = null;
      this.renderTip();
    });
    const one = el('button', 'shop-btn') as HTMLButtonElement;
    one.innerHTML = `${TAB_NAMES[this.tab]}<span class="shop-price${this.tab === 'buy' && short ? ' short' : ''}">${icon(p.item)}${p.count}</span>`;
    one.disabled = times <= 0;
    one.title = 'Shift を押しながらで、できるだけまとめて';
    one.addEventListener('click', (e) => this.trade(trade, e.shiftKey ? this.times(trade) : Math.min(1, this.times(trade))));
    card.append(one);
    if (times > 1) {
      const all = el('button', 'shop-all') as HTMLButtonElement;
      all.textContent = `×${times}`;
      all.title = `まとめて${TAB_NAMES[this.tab]}`;
      all.addEventListener('click', () => this.trade(trade, this.times(trade)));
      card.append(all);
    }
    return card;
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
  const outline =
    'drop-shadow(1px 0 0 #2b2633) drop-shadow(-1px 0 0 #2b2633) drop-shadow(0 1px 0 #2b2633) drop-shadow(0 -1px 0 #2b2633)';
  style.textContent = `
    .shop {
      display: none; position: fixed; left: 50%; top: 46%; transform: translate(-50%, -50%); z-index: 5;
      flex-direction: column; gap: calc(8 * var(--u));
      width: calc(440 * var(--u)); max-width: calc(100vw - 32px); padding: calc(14 * var(--u));
      border-radius: calc(12 * var(--u)); background: rgba(43, 38, 51, 0.88); color: #fff; user-select: none;
    }
    .shop.open { display: flex; }
    .shop-head { display: flex; align-items: center; justify-content: space-between; }
    .shop-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.08em; }
    .shop-purse {
      display: flex; align-items: center; gap: calc(4 * var(--u)); padding: calc(2 * var(--u)) calc(10 * var(--u)) calc(2 * var(--u)) calc(4 * var(--u));
      border-radius: 999px; background: rgba(255, 255, 255, 0.1);
      font-size: calc(16 * var(--u)); font-weight: 700; color: ${css(PALETTE.sand)};
    }
    .shop-purse img { width: calc(24 * var(--u)); height: calc(24 * var(--u)); filter: ${outline}; }
    .shop-say { font-size: calc(13 * var(--u)); line-height: 1.5; opacity: 0.85; }
    .shop-tabs { display: flex; gap: calc(4 * var(--u)); margin-top: calc(2 * var(--u)); }
    .shop-tab {
      flex: 1; padding: calc(6 * var(--u)) 0; border: none; border-radius: calc(6 * var(--u));
      font: inherit; font-size: calc(14 * var(--u)); font-weight: 700; color: #fff; cursor: pointer;
      background: rgba(255, 255, 255, 0.1);
    }
    .shop-tab:hover { background: rgba(255, 255, 255, 0.2); }
    .shop-tab.active { color: #2b2633; background: ${css(PALETTE.sand)}; cursor: default; }
    .shop-tab:disabled { opacity: 0.35; cursor: default; background: rgba(255, 255, 255, 0.1); }
    .shop-grid {
      display: grid; grid-template-columns: repeat(${COLS}, minmax(0, 1fr)); gap: calc(6 * var(--u));
      max-height: calc(${VISIBLE_ROWS} * ${CARD_H} * var(--u)); overflow-y: auto;
    }
    .shop-card {
      position: relative; display: flex; flex-direction: column; align-items: center; gap: calc(2 * var(--u));
      padding: calc(8 * var(--u)) calc(6 * var(--u)) calc(6 * var(--u));
      border-radius: calc(8 * var(--u)); background: rgba(255, 255, 255, 0.08);
    }
    .shop-icon { position: relative; width: calc(48 * var(--u)); height: calc(48 * var(--u)); }
    .shop-icon img { width: 100%; height: 100%; filter: ${outline}; }
    .shop-card.lack .shop-icon img { opacity: 0.45; filter: grayscale(0.8) ${outline}; }
    .shop-count {
      position: absolute; right: calc(-4 * var(--u)); bottom: calc(-2 * var(--u)); font-size: calc(13 * var(--u)); font-weight: 700;
      text-shadow: 0 1px 0 #2b2633, 0 0 calc(3 * var(--u)) #2b2633;
    }
    .shop .short { color: ${css(PALETTE.accent)}; opacity: 1; font-weight: 700; }
    .shop-tip {
      position: fixed; left: calc(14 * var(--u)); top: calc(14 * var(--u)); display: none; white-space: nowrap;
      padding: calc(4 * var(--u)) calc(8 * var(--u)); border-radius: calc(6 * var(--u)); background: rgba(43, 38, 51, 0.95);
      color: #fff; font-size: calc(14 * var(--u)); font-weight: 700; pointer-events: none; z-index: 7;
    }
    .shop-tip.show { display: block; }
    .shop-tip-have { font-size: calc(12 * var(--u)); opacity: 0.7; }
    .shop-tip-have.short { color: ${css(PALETTE.accent)}; opacity: 1; }
    .shop-btn {
      display: flex; align-items: center; justify-content: center; gap: calc(6 * var(--u));
      width: 100%; margin-top: calc(4 * var(--u)); padding: calc(5 * var(--u)) 0; border: none; border-radius: calc(6 * var(--u));
      font: inherit; font-size: calc(13 * var(--u)); font-weight: 700; cursor: pointer;
      color: #2b2633; background: ${css(PALETTE.sand)};
    }
    .shop-btn:hover { filter: brightness(1.08); }
    .shop-btn:disabled { cursor: default; color: #fff; background: rgba(255, 255, 255, 0.08); opacity: 0.5; filter: none; }
    .shop-price { display: flex; align-items: center; gap: calc(1 * var(--u)); }
    .shop-price img { width: calc(18 * var(--u)); height: calc(18 * var(--u)); filter: ${outline}; }
    .shop-btn .shop-price.short { color: ${css(PALETTE.accent)}; }
    .shop-all {
      position: absolute; top: calc(4 * var(--u)); right: calc(4 * var(--u));
      padding: calc(2 * var(--u)) calc(6 * var(--u)); border: none; border-radius: 999px;
      font: inherit; font-size: calc(11 * var(--u)); font-weight: 700; cursor: pointer;
      color: #fff; background: rgba(255, 255, 255, 0.18);
    }
    .shop-all:hover { background: rgba(255, 255, 255, 0.3); }
    .shop-none { font-size: calc(13 * var(--u)); opacity: 0.7; padding: calc(16 * var(--u)) 0; text-align: center; }
    .shop-hint { font-size: calc(12 * var(--u)); opacity: 0.6; text-align: right; }
  `;
  document.head.append(style);
}
