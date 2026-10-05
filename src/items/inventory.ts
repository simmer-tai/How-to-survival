import { PALETTE } from '../core/palette.js';
import { itemIcon } from './itemIcons.js';

const HOTBAR_SIZE = 9;
const BAG_ROWS = 3;
const SLOT_COUNT = HOTBAR_SIZE * (BAG_ROWS + 1);
const MAX_STACK = 99; // 素材・作業台の最大スタック数（ベリーと道具は別）
// 道具の耐久力：何回使うと壊れるか（木や部材を叩く・茂みを刈る・建てる／壊すたびに 1 減る）
const AXE_DURABILITY = 100; // 木1本を切り倒してばらすのに 7 回叩く
const KNIFE_DURABILITY = 40;
const HAMMER_DURABILITY = 80;
const PICKAXE_DURABILITY = 100;
const SWORD_DURABILITY = 100;
const HOE_DURABILITY = 80;
const ROD_DURABILITY = 60;
const DUR_HIGH = 0.5; // 耐久値のバー：残りがこの割合より多ければ緑
const DUR_LOW = 0.2; // これ以下なら赤（間は黄）

// ゴミ箱のマスに出す絵（マスクとして使うので色は CSS 側で付ける）
const TRASH_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9 2h6l1 2h5v3H3V4h5zM5 8h14l-1.2 14H6.2z"/></svg>',
  );

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

export interface ItemDef {
  id: string;
  name: string;
  maxStack: number; // アイコンは itemIcons.ts の 3D モデルから作る
  /** 道具の耐久力（使える回数）。耐久力のある物は maxStack を 1 にする */
  durability?: number;
}

export const ITEMS = {
  wood: { id: 'wood', name: '木材', maxStack: MAX_STACK },
  plank: { id: 'plank', name: '板', maxStack: MAX_STACK },
  stick: { id: 'stick', name: '枝', maxStack: MAX_STACK },
  leaf: { id: 'leaf', name: '葉っぱ', maxStack: MAX_STACK },
  stone: { id: 'stone', name: '石', maxStack: MAX_STACK },
  vine: { id: 'vine', name: 'ツル', maxStack: MAX_STACK }, // 石のナイフで茂みを刈ると採れる
  seed: { id: 'seed', name: 'たね', maxStack: MAX_STACK },
  berry: { id: 'berry', name: 'ベリー', maxStack: 32 },
  fish: { id: 'fish', name: '魚', maxStack: 32 }, // 釣り竿で釣れる。持って右クリックで食べる
  hoe: { id: 'hoe', name: 'くわ', maxStack: 1, durability: HOE_DURABILITY },
  axe: { id: 'axe', name: '石の斧', maxStack: 1, durability: AXE_DURABILITY },
  sword: { id: 'sword', name: '剣', maxStack: 1, durability: SWORD_DURABILITY },
  stoneKnife: { id: 'stoneKnife', name: '石のナイフ', maxStack: 1, durability: KNIFE_DURABILITY }, // 持って左クリックで茂みを刈り、ツルを採る
  pickaxe: { id: 'pickaxe', name: '石のツルハシ', maxStack: 1, durability: PICKAXE_DURABILITY },
  fishingRod: { id: 'fishingRod', name: '釣り竿', maxStack: 1, durability: ROD_DURABILITY }, // 右クリック長押しで投げ、左クリックで巻く。魚を釣り上げるたびに耐久値が減る
  hammer: { id: 'hammer', name: 'ハンマー', maxStack: 1, durability: HAMMER_DURABILITY }, // 持って右クリックで部材を選び、左クリックで建てる
  // 手に持って左クリックで設置する部材（id は actions/pieces.ts の部材と同じ）。ほかの部材はハンマーで建てる
  workbench: { id: 'workbench', name: '作業台', maxStack: MAX_STACK },
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

/** dmg は道具が使われて減った耐久値（無ければ新品） */
export interface Stack { item: ItemId; count: number; dmg?: number }

/** 減った耐久値として正しい値なら、その値（新品や耐久力の無い物なら undefined） */
export function validDmg(item: ItemId, dmg: unknown): number | undefined {
  const max = (ITEMS[item] as ItemDef).durability;
  return max && Number.isInteger(dmg) && (dmg as number) > 0 && (dmg as number) < max ? (dmg as number) : undefined;
}

/** count 個だけ取り分けたスタック（減った耐久値も引き継ぐ） */
function part(s: Stack, count: number): Stack {
  const dmg = validDmg(s.item, s.dmg);
  return dmg ? { item: s.item, count, dmg } : { item: s.item, count };
}

/** trash はゴミ箱のマス（無いセーブデータは空とみなす） */
export interface InventorySave { slots: (Stack | null)[]; selected: number; trash?: Stack | null }

/** 画面上のマス1つ。list の i 番目を表示する */
interface SlotRef { list: (Stack | null)[]; i: number; el: HTMLElement }

/**
 * マウスを押してから離すまでの操作。
 * pick：つまんだまま別のマスで離すとそこに置く（ドラッグ＆ドロップ。from が null ならクラフトの台など画面の外から）
 * spread：左ボタンでなぞったマスに均等に分けて置く　drip：右ボタンでなぞったマスに1個ずつ置く
 */
type Gesture =
  | { kind: 'pick'; from: SlotRef | null }
  | { kind: 'spread'; refs: SlotRef[] }
  | { kind: 'drip'; visited: SlotRef[] };

export class Inventory {
  readonly slots: (Stack | null)[] = new Array(SLOT_COUNT).fill(null);
  selected = 0; // ホットバーで選択中のスロット
  isOpen = false;
  /** ゴミ箱のマス。入れた物は次に別の物を入れるまで取り戻せる（テラリアと同じ） */
  private readonly trash: (Stack | null)[] = [null];
  private held: Stack | null = null; // 開いた画面でつまんでいるスタック
  private gesture: Gesture | null = null;
  private hovered: SlotRef | null = null; // 開いた画面でマウスが乗っているマス

  private readonly root: HTMLElement;
  private readonly hotbarEl: HTMLElement;
  private readonly bagEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly heldEl: HTMLElement;
  private readonly refs: SlotRef[] = [];
  private nameTimer = 0;

  /** 画面の開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** インベントリの外に預けている物（クラフトの台に置いた素材など）。セーブのときに一緒に保存する */
  pending: () => Stack[] = () => [];

  constructor() {
    injectStyle();
    this.root = el('div', 'inv');
    this.bagEl = el('div', 'inv-bag');
    this.nameEl = el('div', 'inv-name');
    this.hotbarEl = el('div', 'inv-hotbar');
    this.heldEl = el('div', 'inv-held');
    // ゴミ箱はカバンの右隣に置く（カバンと同じく開いたときだけ見える）
    const bagRow = el('div', 'inv-bagrow');
    const trashEl = el('div', 'inv-slot inv-trash');
    bagRow.append(this.bagEl, trashEl);
    this.root.append(bagRow, this.nameEl, this.hotbarEl);
    document.body.append(this.root, this.heldEl);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = el('div', 'inv-slot');
      (i < HOTBAR_SIZE ? this.hotbarEl : this.bagEl).append(slot);
      this.bindSlot({ list: this.slots, i, el: slot });
    }
    this.bindSlot({ list: this.trash, i: 0, el: trashEl });
    // マスの外で離したとき：なぞって分ける操作はそこまでで確定し、つまんだ物はそのまま持っておく
    addEventListener('mouseup', () => {
      if (!this.gesture) return;
      if (this.gesture.kind === 'spread') this.finishSpread(this.gesture.refs);
      this.gesture = null;
      this.render();
    });

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

  /** 開いた画面でつまんでいるスタック */
  get holding(): Stack | null {
    return this.held;
  }

  /** 画面の外（クラフトの台など）から物をつまませる。drag なら、そのままマスの上で離すと置ける */
  hold(s: Stack | null, drag = false): void {
    this.held = s;
    this.gesture = s && drag ? { kind: 'pick', from: null } : null;
    this.render();
  }

  /** インベントリにあと何個入るか */
  room(item: ItemId): number {
    const max = ITEMS[item].maxStack;
    return this.slots.reduce((n, s) => n + (!s ? max : s.item === item ? max - s.count : 0), 0);
  }

  /** アイテムを追加し、入りきらなかった個数を返す。dmg は使いかけの道具の減った耐久値 */
  add(item: ItemId, count = 1, dmg?: number): number {
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
      this.slots[i] = dmg ? { item, count: n, dmg } : { item, count: n };
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

  /**
   * 地面に落とすために取り出す。all なら1スタックまるごと、そうでなければ1個。
   * 画面を開いているときは、つまんでいる物かマウスが乗っているマスから、閉じているときは手に持っている物から取る
   */
  take(all: boolean): Stack | null {
    let s: Stack | null;
    let clear: () => void;
    if (!this.isOpen) {
      s = this.selectedStack;
      clear = () => (this.slots[this.selected] = null);
    } else if (this.held) {
      s = this.held;
      clear = () => (this.held = null);
      this.gesture = null;
    } else {
      const ref = this.hovered;
      s = ref ? ref.list[ref.i] : null;
      clear = () => ref && (ref.list[ref.i] = null);
    }
    if (!s) return null;
    const count = all ? s.count : 1;
    s.count -= count;
    if (s.count === 0) clear();
    this.render();
    return part(s, count);
  }

  /** 手に持っている（ホットバーで選んでいる）スタックから count 個減らす */
  removeSelected(count = 1): void {
    const s = this.selectedStack;
    if (!s) return;
    s.count -= count;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.render();
  }

  /**
   * 手に持っている道具を amount 回使った分だけ傷める。耐久値が尽きたら壊れて消え、そのとき true を返す。
   * 振っている間に持ち替えていたら傷めない（item が手に持っている物と違えば何もしない）
   */
  wear(item: ItemId, amount = 1): boolean {
    const s = this.selectedStack;
    const max = (ITEMS[item] as ItemDef).durability;
    if (s?.item !== item || !max) return false;
    s.dmg = (s.dmg ?? 0) + amount;
    const broke = s.dmg >= max;
    if (broke) this.slots[this.selected] = null;
    this.render();
    return broke;
  }

  serialize(): InventorySave {
    const slots = this.slots.map((s) => (s ? { ...s } : null));
    // 画面でつまんでいる途中のスタックや、クラフトの台に置いた素材も失わないように、空きスロットへ入れておく
    for (const s of [this.held, ...this.pending()]) {
      if (!s) continue;
      const i = slots.indexOf(null);
      if (i >= 0) slots[i] = { ...s };
    }
    return { slots, selected: this.selected, trash: this.trash[0] ? { ...this.trash[0] } : null };
  }

  restore(save: InventorySave): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = save.slots[i];
      this.slots[i] = s && s.item in ITEMS && s.count > 0 ? part(s, s.count) : null;
    }
    const t = save.trash;
    this.trash[0] = t && t.item in ITEMS && t.count > 0 ? part(t, t.count) : null;
    this.held = null;
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
    this.gesture = null;
    // つまんだまま閉じたらインベントリに戻す
    if (!open && this.held) this.held = this.putBack(this.held);
    this.root.classList.toggle('open', open);
    this.render();
    this.onToggle(open, resume);
  }

  /** インベントリに戻し、入りきらなかった分を返す */
  putBack(s: Stack): Stack | null {
    const rest = this.add(s.item, s.count, s.dmg);
    return rest > 0 ? part(s, rest) : null;
  }

  // ---- マスの操作：つまむ・ドラッグして置く・なぞって分ける ----

  private bindSlot(ref: SlotRef): void {
    this.refs.push(ref);
    ref.el.addEventListener('mousedown', (e) => this.onSlotDown(ref, e));
    ref.el.addEventListener('mouseenter', () => {
      this.hovered = ref;
      this.onSlotEnter(ref);
    });
    ref.el.addEventListener('mouseleave', () => {
      if (this.hovered === ref) this.hovered = null;
    });
    ref.el.addEventListener('mouseup', () => this.onSlotUp(ref));
    ref.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 左ボタン：つまむ／置く／入れ替え　右ボタン：半分つまむ／1個置く
  private onSlotDown(ref: SlotRef, e: MouseEvent): void {
    if (!this.isOpen) return;
    e.preventDefault();
    const slot = ref.list[ref.i];
    const right = e.button === 2;

    if (ref.list === this.trash && this.held) {
      this.discard(); // ゴミ箱に入れる（前に入っていた物は消える）
    } else if (e.ctrlKey && !this.held && slot && ref.list !== this.trash) {
      // Ctrl+クリック：マスの物をまるごとゴミ箱へ
      this.trash[0] = slot;
      ref.list[ref.i] = null;
    } else if (!this.held) {
      if (!slot) return;
      if (right && slot.count > 1) {
        const n = Math.ceil(slot.count / 2);
        this.held = part(slot, n);
        slot.count -= n;
      } else {
        this.held = slot;
        ref.list[ref.i] = null;
      }
      this.gesture = { kind: 'pick', from: ref };
    } else if (slot && slot.item !== this.held.item) {
      this.dropAll(ref); // 違うアイテムなら入れ替える
    } else if (right) {
      this.dropOne(ref);
      this.gesture = { kind: 'drip', visited: [ref] };
    } else {
      this.gesture = { kind: 'spread', refs: [ref] };
    }
    this.render();
  }

  private onSlotEnter(ref: SlotRef): void {
    const g = this.gesture;
    const held = this.held;
    if (!g || !held) return;
    if (g.kind === 'drip' && !g.visited.includes(ref)) {
      g.visited.push(ref);
      this.dropOne(ref);
    } else if (g.kind === 'spread' && !g.refs.includes(ref) && g.refs.length < held.count && this.accepts(ref, held.item)) {
      g.refs.push(ref);
    } else {
      return;
    }
    this.render();
  }

  private onSlotUp(ref: SlotRef): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.kind === 'pick' && g.from !== ref && this.held) {
      if (ref.list === this.trash) this.discard();
      else this.dropAll(ref);
    }
    else if (g.kind === 'spread') this.finishSpread(g.refs);
    this.render();
  }

  /** つまんでいる物をゴミ箱に入れる。前に入っていた物は消える */
  private discard(): void {
    this.trash[0] = this.held;
    this.held = null;
  }

  /** そのマスに item を置けるか（空いているか、同じアイテムでまだ積めるか）。ゴミ箱には分けて置けない */
  private accepts(ref: SlotRef, item: ItemId): boolean {
    if (ref.list === this.trash) return false;
    const s = ref.list[ref.i];
    return !s || (s.item === item && s.count < ITEMS[item].maxStack);
  }

  /** つまんでいる物をすべて置く。同じアイテムなら積めるだけ積み、違うアイテムなら入れ替える */
  private dropAll(ref: SlotRef): void {
    const held = this.held!;
    const slot = ref.list[ref.i];
    if (!slot) {
      ref.list[ref.i] = held;
      this.held = null;
    } else if (slot.item === held.item && slot.count < ITEMS[slot.item].maxStack) {
      const n = Math.min(ITEMS[slot.item].maxStack - slot.count, held.count);
      slot.count += n;
      held.count -= n;
      if (held.count === 0) this.held = null;
    } else {
      ref.list[ref.i] = held;
      this.held = slot;
    }
  }

  /** つまんでいる物を1個置く */
  private dropOne(ref: SlotRef): void {
    const held = this.held;
    if (!held || !this.accepts(ref, held.item)) return;
    const slot = ref.list[ref.i];
    if (slot) slot.count += 1;
    else ref.list[ref.i] = part(held, 1);
    held.count -= 1;
    if (held.count === 0) this.held = null;
  }

  /** なぞったマスに均等に分けて置く（割り切れない分は持ったまま） */
  private finishSpread(refs: SlotRef[]): void {
    const held = this.held;
    if (!held || refs.length === 0) return;
    if (refs.length === 1) {
      this.dropAll(refs[0]);
      return;
    }
    const each = Math.floor(held.count / refs.length);
    for (const ref of refs) {
      const slot = ref.list[ref.i];
      const n = Math.min(each, ITEMS[held.item].maxStack - (slot?.count ?? 0));
      if (n <= 0) continue;
      if (slot) slot.count += n;
      else ref.list[ref.i] = part(held, n);
      held.count -= n;
    }
    if (held.count === 0) this.held = null;
  }

  private flashName(): void {
    const s = this.selectedStack;
    this.nameEl.textContent = s ? itemLabel(s) : '';
    this.nameEl.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = window.setTimeout(() => this.nameEl.classList.remove('show'), 1500);
  }

  private render(): void {
    const spread = this.gesture?.kind === 'spread' ? this.gesture.refs : [];
    for (const ref of this.refs) {
      const s = ref.list[ref.i];
      ref.el.classList.toggle('selected', ref.list === this.slots && ref.i === this.selected);
      ref.el.classList.toggle('spread', spread.includes(ref));
      ref.el.innerHTML = stackHtml(s);
      ref.el.title = s ? itemLabel(s) : ref.list === this.trash ? 'ゴミ箱' : '';
    }
    this.heldEl.innerHTML = stackHtml(this.held);
  }

}

/** 残りの耐久値と最大値（耐久力の無い物なら null） */
export function durabilityOf(s: Stack): { left: number; max: number } | null {
  const max = (ITEMS[s.item] as ItemDef).durability;
  return max ? { left: max - (s.dmg ?? 0), max } : null;
}

/** マスに出す名前（道具なら残りの耐久値も） */
function itemLabel(s: Stack): string {
  const d = durabilityOf(s);
  return ITEMS[s.item].name + (d ? `（耐久 ${d.left}/${d.max}）` : '');
}

function stackHtml(s: Stack | null): string {
  if (!s) return '';
  const count = s.count > 1 ? `<span class="inv-count">${s.count}</span>` : '';
  // 使いかけの道具には、残りの耐久値のバーを出す（減るほど緑→黄→赤）
  const d = s.dmg ? durabilityOf(s) : null;
  let bar = '';
  if (d) {
    const k = d.left / d.max;
    const color = css(k > DUR_HIGH ? PALETTE.grass : k > DUR_LOW ? PALETTE.sand : PALETTE.accent);
    bar = `<span class="inv-dur"><span style="width:${(k * 100).toFixed(1)}%;background:${color}"></span></span>`;
  }
  return `<img src="${itemIcon(s.item)}" alt="" draggable="false">${count}${bar}`;
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
      position: fixed; left: 50%; bottom: calc(16 * var(--u)); transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: calc(8 * var(--u));
      user-select: none; z-index: 5; pointer-events: none;
    }
    .inv-hotbar, .inv-bag {
      display: grid; grid-template-columns: repeat(${HOTBAR_SIZE}, calc(52 * var(--u))); gap: calc(4 * var(--u));
      padding: calc(6 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.55);
    }
    .inv-bagrow { position: relative; display: none; }
    .inv.open { pointer-events: auto; }
    .inv.open .inv-bagrow { display: block; }
    .inv-trash {
      position: absolute; left: calc(100% + 8 * var(--u)); bottom: 0;
      outline: calc(6 * var(--u)) solid rgba(43, 38, 51, 0.55); margin: calc(6 * var(--u));
    }
    /* 空のゴミ箱にはゴミ箱の絵を薄く出す */
    .inv-trash:empty::before {
      content: ''; position: absolute; inset: calc(12 * var(--u)); background: rgba(255, 255, 255, 0.3);
      -webkit-mask: url("${TRASH_ICON}") center / contain no-repeat; mask: url("${TRASH_ICON}") center / contain no-repeat;
    }
    .inv-slot {
      position: relative; width: calc(52 * var(--u)); height: calc(52 * var(--u)); border-radius: calc(6 * var(--u));
      background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.12);
    }
    .inv.open .inv-slot { cursor: pointer; }
    .inv.open .inv-slot:hover { background: rgba(255, 255, 255, 0.28); }
    .inv-slot.selected { box-shadow: inset 0 0 0 calc(3 * var(--u)) ${css(PALETTE.sand)}; background: rgba(255, 255, 255, 0.24); }
    .inv-slot.spread { box-shadow: inset 0 0 0 calc(3 * var(--u)) ${css(PALETTE.grass)}; background: rgba(255, 255, 255, 0.28); }
    .inv-slot img, .inv-held img {
      position: absolute; inset: calc(6 * var(--u)); width: calc(40 * var(--u)); height: calc(40 * var(--u));
      /* 1px の縁取り＋落ち影で背景から浮かせる */
      filter: drop-shadow(1px 0 0 #2b2633) drop-shadow(-1px 0 0 #2b2633) drop-shadow(0 1px 0 #2b2633)
        drop-shadow(0 -1px 0 #2b2633) drop-shadow(0 calc(2 * var(--u)) 1px rgba(43, 38, 51, 0.45));
    }
    .inv-count {
      position: absolute; right: calc(4 * var(--u)); bottom: calc(2 * var(--u)); color: #fff; font-size: calc(13 * var(--u)); font-weight: 700;
      text-shadow: 0 1px 0 #2b2633, 0 0 calc(3 * var(--u)) #2b2633;
    }
    .inv-dur {
      position: absolute; left: calc(7 * var(--u)); right: calc(7 * var(--u)); bottom: calc(5 * var(--u)); height: calc(4 * var(--u));
      border-radius: calc(2 * var(--u)); background: #2b2633; overflow: hidden;
    }
    .inv-dur > span { display: block; height: 100%; }
    .inv-name {
      color: #fff; font-size: calc(15 * var(--u)); font-weight: 700; text-shadow: 0 1px calc(3 * var(--u)) #2b2633;
      min-height: calc(20 * var(--u)); opacity: 0; transition: opacity 0.3s;
    }
    .inv-name.show { opacity: 1; }
    .inv-held {
      position: fixed; left: calc(-26 * var(--u)); top: calc(-26 * var(--u)); width: calc(52 * var(--u)); height: calc(52 * var(--u));
      pointer-events: none; z-index: 6;
    }

  `;
  document.head.append(style);
}
