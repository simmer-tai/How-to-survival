import { PALETTE } from './palette.js';
import { itemIcon } from './itemIcons.js';

const HOTBAR_SIZE = 9;
const BAG_ROWS = 3;
const SLOT_COUNT = HOTBAR_SIZE * (BAG_ROWS + 1);

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

export interface ItemDef {
  id: string;
  name: string;
  maxStack: number; // アイコンは itemIcons.ts の 3D モデルから作る
}

export const ITEMS = {
  wood: { id: 'wood', name: '木材', maxStack: 64 },
  stick: { id: 'stick', name: '枝', maxStack: 64 },
  leaf: { id: 'leaf', name: '葉っぱ', maxStack: 64 },
  stone: { id: 'stone', name: '石', maxStack: 64 },
  seed: { id: 'seed', name: 'たね', maxStack: 64 },
  berry: { id: 'berry', name: 'ベリー', maxStack: 32 },
  hoe: { id: 'hoe', name: 'くわ', maxStack: 1 },
  axe: { id: 'axe', name: '斧', maxStack: 1 },
  sword: { id: 'sword', name: '剣', maxStack: 1 },
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export interface Stack { item: ItemId; count: number }

export interface InventorySave { slots: (Stack | null)[]; selected: number }

export class Inventory {
  readonly slots: (Stack | null)[] = new Array(SLOT_COUNT).fill(null);
  selected = 0; // ホットバーで選択中のスロット
  isOpen = false;
  private held: Stack | null = null; // 開いた画面でつまんでいるスタック

  private readonly root: HTMLElement;
  private readonly hotbarEl: HTMLElement;
  private readonly bagEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly heldEl: HTMLElement;
  private nameTimer = 0;

  /** 画面の開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};

  constructor() {
    injectStyle();
    this.root = el('div', 'inv');
    this.bagEl = el('div', 'inv-bag');
    this.nameEl = el('div', 'inv-name');
    this.hotbarEl = el('div', 'inv-hotbar');
    this.heldEl = el('div', 'inv-held');
    this.root.append(this.bagEl, this.nameEl, this.hotbarEl);
    document.body.append(this.root, this.heldEl);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = el('div', 'inv-slot');
      slot.dataset.index = String(i);
      slot.addEventListener('mousedown', (e) => this.onSlotClick(i, e));
      slot.addEventListener('contextmenu', (e) => e.preventDefault());
      (i < HOTBAR_SIZE ? this.hotbarEl : this.bagEl).append(slot);
    }

    addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' || e.code === 'Tab') {
        e.preventDefault();
        this.setOpen(!this.isOpen);
      } else if (e.code === 'Escape' && this.isOpen) {
        this.setOpen(false, false);
      } else if (/^Digit[1-9]$/.test(e.code)) {
        this.select(Number(e.code.slice(5)) - 1);
      }
    });
    addEventListener('wheel', (e) => {
      if (this.isOpen || document.pointerLockElement === null) return;
      this.select((this.selected + Math.sign(e.deltaY) + HOTBAR_SIZE) % HOTBAR_SIZE);
    });
    addEventListener('mousemove', (e) => {
      this.heldEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });

    this.render();
  }

  get selectedStack(): Stack | null {
    return this.slots[this.selected];
  }

  /** アイテムを追加し、入りきらなかった個数を返す */
  add(item: ItemId, count = 1): number {
    const max = ITEMS[item].maxStack;
    // 既存スタックに詰める → 空きスロットへ（ホットバー優先）
    for (const s of this.slots) {
      if (count === 0) break;
      if (s && s.item === item && s.count < max) {
        const n = Math.min(max - s.count, count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < SLOT_COUNT && count > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(max, count);
      this.slots[i] = { item, count: n };
      count -= n;
    }
    this.render();
    return count;
  }

  /** 持っている個数の合計 */
  count(item: ItemId): number {
    return this.slots.reduce((n, s) => (s?.item === item ? n + s.count : n), 0);
  }

  /** count 個取り除く。足りなければ何もせず false */
  remove(item: ItemId, count = 1): boolean {
    if (this.count(item) < count) return false;
    // 後ろ（カバン側）のスタックから使う
    for (let i = SLOT_COUNT - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s?.item !== item) continue;
      const n = Math.min(s.count, count);
      s.count -= n;
      count -= n;
      if (s.count === 0) this.slots[i] = null;
    }
    this.render();
    return true;
  }

  serialize(): InventorySave {
    const slots = this.slots.map((s) => (s ? { ...s } : null));
    // 画面でつまんでいる途中のスタックも失わないように、空きスロットへ入れておく
    if (this.held) {
      const i = slots.indexOf(null);
      if (i >= 0) slots[i] = { ...this.held };
    }
    return { slots, selected: this.selected };
  }

  restore(save: InventorySave): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = save.slots[i];
      this.slots[i] = s && s.item in ITEMS && s.count > 0 ? { item: s.item, count: s.count } : null;
    }
    this.selected = save.selected >= 0 && save.selected < HOTBAR_SIZE ? save.selected : 0;
    this.render();
  }

  select(index: number): void {
    this.selected = index;
    this.render();
    this.flashName();
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (!open && this.held) {
      // つまんだまま閉じたらインベントリに戻す
      const rest = this.add(this.held.item, this.held.count);
      this.held = rest > 0 ? { item: this.held.item, count: rest } : null;
    }
    this.root.classList.toggle('open', open);
    this.render();
    this.onToggle(open, resume);
  }

  // 左クリック：つまむ／置く／入れ替え　右クリック：半分つまむ／1個置く
  private onSlotClick(i: number, e: MouseEvent): void {
    if (!this.isOpen) return;
    e.preventDefault();
    const slot = this.slots[i];
    const held = this.held;
    const right = e.button === 2;

    if (!held) {
      if (!slot) return;
      if (right && slot.count > 1) {
        const n = Math.ceil(slot.count / 2);
        this.held = { item: slot.item, count: n };
        slot.count -= n;
      } else {
        this.held = slot;
        this.slots[i] = null;
      }
    } else if (!slot) {
      if (right && held.count > 1) {
        this.slots[i] = { item: held.item, count: 1 };
        held.count -= 1;
      } else {
        this.slots[i] = held;
        this.held = null;
      }
    } else if (slot.item === held.item) {
      const n = Math.min(ITEMS[slot.item].maxStack - slot.count, right ? 1 : held.count);
      slot.count += n;
      held.count -= n;
      if (held.count === 0) this.held = null;
    } else {
      this.slots[i] = held;
      this.held = slot;
    }
    this.render();
  }

  private flashName(): void {
    const s = this.selectedStack;
    this.nameEl.textContent = s ? ITEMS[s.item].name : '';
    this.nameEl.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = window.setTimeout(() => this.nameEl.classList.remove('show'), 1500);
  }

  private render(): void {
    const slotEls = [...this.hotbarEl.children, ...this.bagEl.children] as HTMLElement[];
    for (const slotEl of slotEls) {
      const i = Number(slotEl.dataset.index);
      const s = this.slots[i];
      slotEl.classList.toggle('selected', i === this.selected);
      slotEl.innerHTML = stackHtml(s);
      slotEl.title = s ? ITEMS[s.item].name : '';
    }
    this.heldEl.innerHTML = stackHtml(this.held);
  }
}

function stackHtml(s: Stack | null): string {
  if (!s) return '';
  const count = s.count > 1 ? `<span class="inv-count">${s.count}</span>` : '';
  return `<img src="${itemIcon(s.item)}" alt="" draggable="false">${count}`;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .inv {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      user-select: none; z-index: 5; pointer-events: none;
    }
    .inv-hotbar, .inv-bag {
      display: grid; grid-template-columns: repeat(${HOTBAR_SIZE}, 52px); gap: 4px;
      padding: 6px; border-radius: 10px; background: rgba(43, 38, 51, 0.55);
    }
    .inv-bag { display: none; }
    .inv.open { pointer-events: auto; }
    .inv.open .inv-bag { display: grid; }
    .inv-slot {
      position: relative; width: 52px; height: 52px; border-radius: 6px;
      background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.12);
    }
    .inv.open .inv-slot { cursor: pointer; }
    .inv.open .inv-slot:hover { background: rgba(255, 255, 255, 0.28); }
    .inv-slot.selected { box-shadow: inset 0 0 0 3px ${css(PALETTE.sand)}; background: rgba(255, 255, 255, 0.24); }
    .inv-slot img, .inv-held img {
      position: absolute; inset: 6px; width: 40px; height: 40px;
      /* 1px の縁取り＋落ち影で背景から浮かせる */
      filter: drop-shadow(1px 0 0 #2b2633) drop-shadow(-1px 0 0 #2b2633) drop-shadow(0 1px 0 #2b2633)
        drop-shadow(0 -1px 0 #2b2633) drop-shadow(0 2px 1px rgba(43, 38, 51, 0.45));
    }
    .inv-count {
      position: absolute; right: 4px; bottom: 2px; color: #fff; font-size: 13px; font-weight: 700;
      text-shadow: 0 1px 0 #2b2633, 0 0 3px #2b2633;
    }
    .inv-name {
      color: #fff; font-size: 15px; font-weight: 700; text-shadow: 0 1px 3px #2b2633;
      min-height: 20px; opacity: 0; transition: opacity 0.3s;
    }
    .inv-name.show { opacity: 1; }
    .inv-held {
      position: fixed; left: -26px; top: -26px; width: 52px; height: 52px;
      pointer-events: none; z-index: 6;
    }
  `;
  document.head.append(style);
}
