import { PALETTE } from '../core/palette.js';
import { itemIcon } from './itemIcons.js';
import { landInfoName } from './landInfo.js';
import { readChart, validChart } from './islandChart.js';

const HOTBAR_SIZE = 4; // ホットバーのマスの数（数字キー 1〜4 で選ぶ）
const HOTBAR_SLOT = 64; // ホットバーと左手のマスの一辺（カバンのマスは 52）
const OFFHAND_GAP = 8; // 左手のマスの枠とホットバーのすき間
const PURSE_GAP = 8; // お金のマスの枠とカバンのすき間
const BAG_COLS = 9; // カバンの横のマスの数
const BAG_ROWS = 3;
// 開いている間、インベントリがマウスカーソルのほうへ少し向きを変える
const TILT_GAIN = 4; // カーソルがカバンの欄の縁にあるときに傾く角度（度）。欄の外ではさらに傾く
const TILT_MAX = 6; // 傾く角度の上限（度）。縦・横それぞれこれより傾かない
const TILT_PERSPECTIVE = 1000; // 遠近の強さ（小さいほど強い）
const TILT_EASE = 0.08; // 向きが追いつく速さ（秒。目標までの残りが約 1/3 になる時間）
// カーソルを合わせたマスが手前に出る
const HOVER_LIFT = 30; // 手前に出る距離（カバンの欄では遠近で大きく見える）
const HOVER_SCALE = 1.06; // 合わせたマスの大きさ（ホットバーは傾かないので、これだけで手前に見せる）
const HOVER_EASE = 0.1; // 出入りにかかる時間（秒）
const HOVER_HIT = 12; // 手前に出ている間、当たり判定をまわりに広げる幅（ずれた分を覆う）
// 枠のすりガラスの見た目
const GLASS_FILL_TOP = 0.1; // 左上の白さ（不透明度）
const GLASS_FILL_BOTTOM = 0.03; // 右下の白さ
const GLASS_EDGE = 0.25; // 縁の光の強さ
const GLASS_TINT = 0.3; // ガラスの下に敷く暗い色の濃さ（白っぽくなりすぎず、アイコンが見えるように）
const GLASS_BLUR = 12; // ホットバーの後ろの景色をぼかす強さ
const SLOT_COUNT = HOTBAR_SIZE + BAG_COLS * BAG_ROWS;
const MAX_STACK = 99; // 素材・作業台の最大スタック数（ベリーと道具は別）
const INFO_STACK = 16; // 地形のメモの最大スタック数
const TORCH_STACK = 32; // 松明の最大スタック数
const MAX_COINS = 9999; // お金のマスに入るコインの最大枚数
// 道具の耐久力：何回使うと壊れるか（木や部材を叩く・茂みを刈る・建てる／壊すたびに 1 減る）
const AXE_DURABILITY = 100; // 木1本を切り倒してばらすのに 7 回叩く
const KNIFE_DURABILITY = 40;
const HAMMER_DURABILITY = 80;
const PICKAXE_DURABILITY = 100;
const SHOVEL_DURABILITY = 80;
const SWORD_DURABILITY = 100;
const HOE_DURABILITY = 80;
const ROD_DURABILITY = 60;
const SPEAR_DURABILITY = 80;
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
  /** お金。お金のマスにだけ入り、ホットバーやカバンには入らない（なので手に持つことはない） */
  currency?: boolean;
  /** 設計図。持って右クリックすると、この id の物の作り方を覚え、設計図は1枚なくなる（もう覚えていたら減らない） */
  teaches?: string;
}

export const ITEMS = {
  wood: { id: 'wood', name: '木材', maxStack: MAX_STACK },
  plank: { id: 'plank', name: '板', maxStack: MAX_STACK },
  stick: { id: 'stick', name: '枝', maxStack: MAX_STACK },
  leaf: { id: 'leaf', name: '葉っぱ', maxStack: MAX_STACK },
  stone: { id: 'stone', name: '石', maxStack: MAX_STACK },
  vine: { id: 'vine', name: 'ツル', maxStack: MAX_STACK }, // 石のナイフで茂みを刈ると採れる
  dirt: { id: 'dirt', name: '土', maxStack: MAX_STACK }, // 木のスコップで地面を掘ると採れる
  ironOre: { id: 'ironOre', name: '鉄鉱石', maxStack: MAX_STACK }, // 「鉄鉱脈」の島の洞窟にある鉱脈を、石のツルハシで叩くと採れる
  seed: { id: 'seed', name: '木の種', maxStack: MAX_STACK },
  berry: { id: 'berry', name: 'ベリー', maxStack: 32 },
  crab: { id: 'crab', name: 'カニ', maxStack: 16 }, // 砂浜のカニを倒すと落ちる（脚を閉じた姿）
  // 魚：釣り竿で釣れる。持って右クリックで食べる（種類ごとの見た目・釣れる場所は items/fishKinds.ts）
  fish: { id: 'fish', name: 'アジ', maxStack: 32 },
  clownfish: { id: 'clownfish', name: 'クマノミ', maxStack: 32 },
  snapper: { id: 'snapper', name: 'マダイ', maxStack: 32 },
  puffer: { id: 'puffer', name: 'フグ', maxStack: 32 },
  flounder: { id: 'flounder', name: 'ヒラメ', maxStack: 32 },
  bonito: { id: 'bonito', name: 'カツオ', maxStack: 32 },
  hoe: { id: 'hoe', name: '木のくわ', maxStack: 1, durability: HOE_DURABILITY }, // 木材を削った刃を枝の柄にツルで縛りつけたくわ
  axe: { id: 'axe', name: '石の斧', maxStack: 1, durability: AXE_DURABILITY },
  sword: { id: 'sword', name: '剣', maxStack: 1, durability: SWORD_DURABILITY },
  stoneKnife: { id: 'stoneKnife', name: '石のナイフ', maxStack: 1, durability: KNIFE_DURABILITY }, // 持って左クリックで茂みを刈り、ツルを採る
  spear: { id: 'spear', name: '石の槍', maxStack: 1, durability: SPEAR_DURABILITY }, // 持って左クリックで突く。ナイフより遠くの茂みを刈れて、ツルも採れる
  pickaxe: { id: 'pickaxe', name: '石のツルハシ', maxStack: 1, durability: PICKAXE_DURABILITY },
  shovel: { id: 'shovel', name: '木のスコップ', maxStack: 1, durability: SHOVEL_DURABILITY }, // 板の刃を枝の柄にツルで縛りつけたスコップ
  fishingRod: { id: 'fishingRod', name: '釣り竿', maxStack: 1, durability: ROD_DURABILITY }, // 右クリック長押しで投げ、左クリックで巻く。魚を釣り上げるたびに耐久値が減る
  hammer: { id: 'hammer', name: 'ハンマー', maxStack: 1, durability: HAMMER_DURABILITY }, // 持って右クリックで部材を選び、左クリックで建てる
  // 手に持って左クリックで設置する部材（id は actions/pieces.ts の部材と同じ）。ほかの部材はハンマーで建てる
  workbench: { id: 'workbench', name: '作業台', maxStack: MAX_STACK },
  campfire: { id: 'campfire', name: '焚火', maxStack: MAX_STACK },
  torch: { id: 'torch', name: '松明', maxStack: TORCH_STACK }, // 枝の先に葉っぱを巻いてツルで縛った物。手に持つと火がともり、まわりを照らす
  draftingTable: { id: 'draftingTable', name: '製図台', maxStack: MAX_STACK }, // 置いて F で使う。白紙の地図とメモから島の地図を作る // 石を輪に並べて枝を組んだ焚火。置いて F で燃料を入れる（actions/campfire.ts）
  coin: { id: 'coin', name: 'コイン', maxStack: MAX_COINS, currency: true }, // 島のお金。桟橋の人との取引で手に入る
  // 設計図は桟橋の人からコインで買う
  boatBlueprint: { id: 'boatBlueprint', name: '木製の船の設計図', maxStack: 1, teaches: 'boat' },
  pickaxeBlueprint: { id: 'pickaxeBlueprint', name: '石のツルハシの設計図', maxStack: 1, teaches: 'pickaxe' },
  spearBlueprint: { id: 'spearBlueprint', name: '石の槍の設計図', maxStack: 1, teaches: 'spear' },
  hammerBlueprint: { id: 'hammerBlueprint', name: 'ハンマーの設計図', maxStack: 1, teaches: 'hammer' },
  fishingRodBlueprint: { id: 'fishingRodBlueprint', name: '釣り竿の設計図', maxStack: 1, teaches: 'fishingRod' },
  draftingTableBlueprint: { id: 'draftingTableBlueprint', name: '製図台の設計図', maxStack: 1, teaches: 'draftingTable' }, // 街の地図屋から買う
  hoeBlueprint: { id: 'hoeBlueprint', name: 'くわの設計図', maxStack: 1, teaches: 'hoe' }, // 街の農家から買う
  // 白紙の地図：街の地図屋からコインで買う。製図台でメモと組み合わせて島の地図にする（id は前の「地図」のまま。古いセーブを読めるように）
  map: { id: 'map', name: '白紙の地図', maxStack: 1 },
  // 島の地図：製図台で作る。中身（どのメモを組み合わせたか・本当の島の姿）はスタックの chart に持つ（items/islandChart.ts）。持って右クリックで広げる
  islandMap: { id: 'islandMap', name: '島の地図', maxStack: 1 },
  // 地形のメモ：街の地図屋からコインで買う（items/landInfo.ts）。あとで組み合わせて島の地図を作る
  forestInfo: { id: 'forestInfo', name: landInfoName('forest'), maxStack: INFO_STACK },
  meadowInfo: { id: 'meadowInfo', name: landInfoName('meadow'), maxStack: INFO_STACK },
  beachInfo: { id: 'beachInfo', name: landInfoName('beach'), maxStack: INFO_STACK },
  cragInfo: { id: 'cragInfo', name: landInfoName('crag'), maxStack: INFO_STACK },
  lakeInfo: { id: 'lakeInfo', name: landInfoName('lake'), maxStack: INFO_STACK },
  cliffInfo: { id: 'cliffInfo', name: landInfoName('cliff'), maxStack: INFO_STACK },
  torrentInfo: { id: 'torrentInfo', name: landInfoName('torrent'), maxStack: INFO_STACK },
  bambooInfo: { id: 'bambooInfo', name: landInfoName('bamboo'), maxStack: INFO_STACK },
  reefInfo: { id: 'reefInfo', name: landInfoName('reef'), maxStack: INFO_STACK },
  streamInfo: { id: 'streamInfo', name: landInfoName('stream'), maxStack: INFO_STACK },
  hollowInfo: { id: 'hollowInfo', name: landInfoName('hollow'), maxStack: INFO_STACK },
  ironInfo: { id: 'ironInfo', name: landInfoName('iron'), maxStack: INFO_STACK },
  boat: { id: 'boat', name: '木製の船', maxStack: 1 }, // 設計図で作り方を覚えると、作業台で作れる。持って左クリックで水に浮かべる（actions/boats.ts。乗るのはこれから）
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

/** dmg は道具が使われて減った耐久値（無ければ新品）。chart は島の地図の中身（items/islandChart.ts） */
export interface Stack { item: ItemId; count: number; dmg?: number; chart?: number }

/** 減った耐久値として正しい値なら、その値（新品や耐久力の無い物なら undefined） */
export function validDmg(item: ItemId, dmg: unknown): number | undefined {
  const max = (ITEMS[item] as ItemDef).durability;
  return max && Number.isInteger(dmg) && (dmg as number) > 0 && (dmg as number) < max ? (dmg as number) : undefined;
}

/** お金（お金のマスにだけ入る物）か */
export function isCurrency(item: ItemId): boolean {
  return !!(ITEMS[item] as ItemDef).currency;
}

/** スタック1つを作る（減った耐久値・島の地図の中身は、正しい値のときだけ持たせる） */
export function makeStack(item: ItemId, count: number, dmg?: number, chart?: number): Stack {
  const d = validDmg(item, dmg);
  const c = item === 'islandMap' ? validChart(chart) : undefined;
  return { item, count, ...(d ? { dmg: d } : {}), ...(c !== undefined ? { chart: c } : {}) };
}

/** count 個だけ取り分けたスタック（減った耐久値・島の地図の中身も引き継ぐ） */
function part(s: Stack, count: number): Stack {
  return makeStack(s.item, count, s.dmg, s.chart);
}

/** trash はゴミ箱のマス、purse はお金のマス、offhand は左手のマス（無いセーブデータは空とみなす） */
export interface InventorySave { slots: (Stack | null)[]; selected: number; trash?: Stack | null; purse?: Stack | null; offhand?: Stack | null }

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
  private frosted = false;
  /** ゴミ箱のマス。入れた物は次に別の物を入れるまで取り戻せる（テラリアと同じ） */
  private readonly trash: (Stack | null)[] = [null];
  /** お金のマス。お金はここにしか入らず、ここにはお金しか入らない */
  private readonly purse: (Stack | null)[] = [null];
  /** 左手のマス。ホットバーの左に離して置き、ここに入れた物はいつも左手に持つ */
  private readonly offhand: (Stack | null)[] = [null];
  private held: Stack | null = null; // 開いた画面でつまんでいるスタック
  private gesture: Gesture | null = null;
  private hovered: SlotRef | null = null; // 開いた画面でマウスが乗っているマス

  private readonly root: HTMLElement;
  // カバンの欄の向き（度）。tiltGoal へ tilt を毎フレーム近づける
  private readonly tilt = { x: 0, y: 0 };
  private readonly tiltGoal = { x: 0, y: 0 };
  private tiltFrame = 0;
  private tiltLast = 0;
  private readonly hotbarEl: HTMLElement;
  private readonly bagEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly heldEl: HTMLElement;
  private readonly tipEl: HTMLElement; // マウスが乗っているマスの物の名前
  private readonly refs: SlotRef[] = [];
  private nameTimer = 0;

  /** 画面の開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** インベントリの外に預けている物（クラフトの台に置いた素材など）。セーブのときに一緒に保存する */
  pending: () => Stack[] = () => [];
  /**
   * Shift+クリックしたマスの物を、開いている画面の別の欄（焚火の燃料の欄など）へ送る。送った個数を返す。
   * null なら Shift+クリックは何もしない
   */
  quickMove: ((s: Stack) => number) | null = null;

  constructor() {
    injectStyle();
    this.root = el('div', 'inv');
    this.bagEl = el('div', 'inv-bag');
    this.nameEl = el('div', 'inv-name');
    this.hotbarEl = el('div', 'inv-hotbar');
    this.heldEl = el('div', 'inv-held');
    this.tipEl = el('div', 'inv-tip');
    // ゴミ箱はカバンの右隣に置く。お金のマスは自分の枠に入れて、カバンの3段目の左に少し離して置く
    // （カバンと同じく開いたときだけ見える）
    const bagRow = el('div', 'inv-bagrow');
    const trashEl = el('div', 'inv-slot inv-trash');
    const pursebar = el('div', 'inv-pursebar');
    const purseEl = el('div', 'inv-slot inv-purse');
    pursebar.append(purseEl);
    bagRow.append(pursebar, this.bagEl, trashEl);
    // 左手のマスは、ホットバーと同じ枠に入れてホットバーの左に少し離して置く（いつも見える。ホットバーは真ん中のまま）
    const hotRow = el('div', 'inv-hotrow');
    const offbar = el('div', 'inv-offbar');
    const offhandEl = el('div', 'inv-slot inv-offhand');
    offbar.append(offhandEl);
    hotRow.append(offbar, this.hotbarEl);
    this.root.append(bagRow, this.nameEl, hotRow);
    document.body.append(this.root, this.heldEl, this.tipEl);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = el('div', 'inv-slot');
      (i < HOTBAR_SIZE ? this.hotbarEl : this.bagEl).append(slot);
      this.bindSlot({ list: this.slots, i, el: slot });
    }
    this.bindSlot({ list: this.trash, i: 0, el: trashEl });
    this.bindSlot({ list: this.purse, i: 0, el: purseEl });
    this.bindSlot({ list: this.offhand, i: 0, el: offhandEl });
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
        const i = Number(e.code.slice(5)) - 1;
        if (i < HOTBAR_SIZE) this.select(i);
      }
    });
    addEventListener('wheel', (e) => {
      if (this.isOpen || document.pointerLockElement === null) return;
      this.select((this.selected + Math.sign(e.deltaY) + HOTBAR_SIZE) % HOTBAR_SIZE);
    });
    addEventListener('mousemove', (e) => {
      this.heldEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.tipEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      if (this.isOpen) this.tiltToward(e.clientX, e.clientY);
    });

    this.render();
  }

  get selectedStack(): Stack | null {
    return this.slots[this.selected];
  }

  /** 左手のマスの物（左手に持つ） */
  get offhandStack(): Stack | null {
    return this.offhand[0];
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
    const free = this.home(item).reduce((n, s) => n + (!s ? max : s.item === item ? max - s.count : 0), 0);
    return free + this.stacking(item).reduce((n, s) => n + max - s!.count, 0);
  }

  /** アイテムを追加し、入りきらなかった個数を返す。dmg は使いかけの道具の減った耐久値、chart は島の地図の中身 */
  add(item: ItemId, count = 1, dmg?: number, chart?: number): number {
    const max = ITEMS[item].maxStack;
    const list = this.home(item);
    // 既存スタックに詰める（左手に持っている物にも）→ 空きスロットへ（ホットバー優先。左手のマスには入れない）
    for (const s of [...list, ...this.stacking(item)]) {
      if (count === 0) break;
      if (s && s.item === item && s.count < max) {
        const n = Math.min(max - s.count, count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < list.length && count > 0; i++) {
      if (list[i]) continue;
      const n = Math.min(max, count);
      list[i] = makeStack(item, n, dmg, chart);
      count -= n;
    }
    this.render();
    return count;
  }

  /** 持っている個数の合計 */
  count(item: ItemId): number {
    return [...this.home(item), ...this.offhandOf(item)].reduce((n, s) => (s?.item === item ? n + s.count : n), 0);
  }

  /** count 個取り除く。足りなければ何もせず false */
  remove(item: ItemId, count = 1): boolean {
    if (this.count(item) < count) return false;
    // 後ろ（カバン側）のスタックから使い、左手に持っている物は最後に使う
    for (const list of [this.home(item), this.offhandOf(item)]) {
      for (let i = list.length - 1; i >= 0 && count > 0; i--) {
        const s = list[i];
        if (s?.item !== item) continue;
        const n = Math.min(s.count, count);
        s.count -= n;
        count -= n;
        if (s.count === 0) list[i] = null;
      }
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
    let purse = this.purse[0] ? { ...this.purse[0] } : null;
    // 画面でつまんでいる途中のスタックや、クラフトの台に置いた素材も失わないように、空きスロット（お金ならお金のマス）へ入れておく
    for (const s of [this.held, ...this.pending()]) {
      if (!s) continue;
      if (isCurrency(s.item)) {
        purse = { item: s.item, count: Math.min((purse?.count ?? 0) + s.count, ITEMS[s.item].maxStack) };
        continue;
      }
      const i = slots.indexOf(null);
      if (i >= 0) slots[i] = { ...s };
    }
    const offhand = this.offhand[0] ? { ...this.offhand[0] } : null;
    return { slots, selected: this.selected, trash: this.trash[0] ? { ...this.trash[0] } : null, purse, offhand };
  }

  restore(save: InventorySave): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = save.slots[i];
      this.slots[i] = s && s.item in ITEMS && s.count > 0 ? part(s, s.count) : null;
    }
    const t = save.trash;
    this.trash[0] = t && t.item in ITEMS && t.count > 0 ? part(t, t.count) : null;
    const p = save.purse;
    this.purse[0] = p && p.item in ITEMS && isCurrency(p.item) && p.count > 0 ? part(p, p.count) : null;
    const o = save.offhand;
    this.offhand[0] = o && o.item in ITEMS && !isCurrency(o.item) && o.count > 0 ? part(o, o.count) : null;
    // ふつうのマスに入っているお金は、お金のマスへ移す
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = this.slots[i];
      if (!s || !isCurrency(s.item)) continue;
      this.slots[i] = null;
      this.add(s.item, s.count);
    }
    // マスの数が今より多かった頃のセーブデータは、はみ出した分を空いているマスへ入れる
    for (const s of save.slots.slice(SLOT_COUNT)) {
      if (s && s.item in ITEMS && s.count > 0) this.add(s.item, s.count, s.dmg, s.chart);
    }
    this.held = null;
    this.selected = save.selected >= 0 && save.selected < HOTBAR_SIZE ? save.selected : 0;
    this.render();
  }

  select(index: number): void {
    this.selected = index;
    this.render();
    this.flashName();
  }

  /** カバンの欄の真ん中から見たカーソルの向きに合わせて、カーソルのほうへ少し向ける（角度は TILT_MAX まで） */
  private tiltToward(x: number, y: number): void {
    // 傾いたあとの見た目の位置で測ると、傾くたびに真ん中がずれて揺れ戻すので、傾く前の配置（offset〜）で測る
    const w = this.bagEl.offsetWidth;
    const h = this.bagEl.offsetHeight;
    if (w === 0) return;
    const root = this.root.getBoundingClientRect(); // 外側の枠は平面のまま（translateX だけ）
    const row = this.bagEl.parentElement as HTMLElement;
    const cx = root.left + row.offsetLeft + this.bagEl.offsetLeft + w / 2;
    const cy = root.top + row.offsetTop + this.bagEl.offsetTop + h / 2;
    // 欄の縁で TILT_GAIN 度になる割合で傾け、TILT_MAX で止める
    const clamp = (a: number) => Math.max(-TILT_MAX, Math.min(TILT_MAX, a));
    this.tiltGoal.y = clamp(((x - cx) / (w / 2)) * TILT_GAIN);
    this.tiltGoal.x = clamp((-(y - cy) / (h / 2)) * TILT_GAIN);
    if (this.tiltFrame === 0) {
      this.tiltLast = performance.now();
      this.tiltFrame = requestAnimationFrame(this.stepTilt);
    }
  }

  /** 向きを目標へ毎フレーム少しずつ近づける（マウスが動くたびにアニメーションをやり直すとカクつくため） */
  private readonly stepTilt = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.tiltLast) / 1000));
    this.tiltLast = now;
    const goal = this.isOpen ? this.tiltGoal : { x: 0, y: 0 };
    const k = 1 - Math.exp(-dt / TILT_EASE);
    this.tilt.x += (goal.x - this.tilt.x) * k;
    this.tilt.y += (goal.y - this.tilt.y) * k;
    this.root.style.setProperty('--tilt-x', `${this.tilt.x.toFixed(3)}deg`);
    this.root.style.setProperty('--tilt-y', `${this.tilt.y.toFixed(3)}deg`);
    const settled = Math.abs(goal.x - this.tilt.x) < 0.01 && Math.abs(goal.y - this.tilt.y) < 0.01;
    this.tiltFrame = settled ? 0 : requestAnimationFrame(this.stepTilt);
  };

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

  /** 背景の世界がぼけきっているか（main.ts が毎フレーム知らせる）。ぼけている間はホットバーの後ろをぼかさない */
  setFrosted(on: boolean): void {
    if (this.frosted === on) return;
    this.frosted = on;
    this.root.classList.toggle('frosted', on);
  }

  /** インベントリに戻し、入りきらなかった分を返す */
  putBack(s: Stack): Stack | null {
    const rest = this.add(s.item, s.count, s.dmg, s.chart);
    return rest > 0 ? part(s, rest) : null;
  }

  // ---- マスの操作：つまむ・ドラッグして置く・なぞって分ける ----

  private bindSlot(ref: SlotRef): void {
    this.refs.push(ref);
    ref.el.addEventListener('mousedown', (e) => this.onSlotDown(ref, e));
    ref.el.addEventListener('mouseenter', () => {
      this.hovered = ref;
      this.onSlotEnter(ref);
      this.renderTip();
    });
    ref.el.addEventListener('mouseleave', () => {
      if (this.hovered === ref) this.hovered = null;
      this.renderTip();
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
    } else if (e.shiftKey && !right && !this.held && slot && (ref.list === this.slots || ref.list === this.offhand) && this.quickMove) {
      // Shift+クリック：開いている画面の欄へ送る
      slot.count -= Math.min(this.quickMove(slot), slot.count);
      if (slot.count <= 0) ref.list[ref.i] = null;
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
    } else if (!this.fits(ref, this.held.item)) {
      return; // お金はお金のマスにだけ、お金のマスにはお金だけ置ける
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
      else if (this.fits(ref, this.held.item)) this.dropAll(ref);
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
    if (ref.list === this.trash || !this.fits(ref, item)) return false;
    const s = ref.list[ref.i];
    return !s || (s.item === item && s.count < ITEMS[item].maxStack);
  }

  /** そのアイテムが入るマスの並び（お金ならお金のマス、それ以外はホットバーとカバン） */
  private home(item: ItemId): (Stack | null)[] {
    return isCurrency(item) ? this.purse : this.slots;
  }

  /** 左手のマスの並び（お金なら空。count・remove で左手の物も数に入れる） */
  private offhandOf(item: ItemId): (Stack | null)[] {
    return isCurrency(item) ? [] : this.offhand;
  }

  /** 左手に持っている、item のまだ積めるスタック（拾った物はここにも詰める） */
  private stacking(item: ItemId): (Stack | null)[] {
    return this.offhandOf(item).filter((s) => s?.item === item && s.count < ITEMS[item].maxStack);
  }

  /** そのマスに item を置いてよいか（お金はお金のマスにだけ、お金のマスにはお金だけ。ゴミ箱には何でも入る） */
  private fits(ref: SlotRef, item: ItemId): boolean {
    if (ref.list === this.trash) return true;
    return (ref.list === this.purse) === isCurrency(item);
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
      // 空のお金のマスには、コインの絵を薄く出す
      ref.el.innerHTML = !s && ref.list === this.purse ? `<img class="inv-ghost" src="${itemIcon('coin')}" alt="" draggable="false">` : stackHtml(s);
    }
    this.heldEl.innerHTML = stackHtml(this.held);
    this.renderTip();
  }

  /** 開いた画面でマウスが乗っているマスの物の名前を、カーソルの横に出す（物をつまんでいる間は出さない） */
  private renderTip(): void {
    const ref = this.isOpen && !this.held ? this.hovered : null;
    const s = ref ? ref.list[ref.i] : null;
    const text = s ? itemLabel(s) : ref?.list === this.trash ? 'ゴミ箱' : ref?.list === this.purse ? 'お金' : ref?.list === this.offhand ? '左手' : '';
    this.tipEl.textContent = text;
    this.tipEl.classList.toggle('show', text !== '');
  }

}

/** 残りの耐久値と最大値（耐久力の無い物なら null） */
export function durabilityOf(s: Stack): { left: number; max: number } | null {
  const max = (ITEMS[s.item] as ItemDef).durability;
  return max ? { left: max - (s.dmg ?? 0), max } : null;
}

/** マスに出す名前（道具なら残りの耐久値も、島の地図なら島の名前も） */
export function itemLabel(s: Stack): string {
  const d = durabilityOf(s);
  if (s.chart !== undefined) return `${ITEMS[s.item].name}（${readChart(s.chart).name}）`;
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
    .inv-hotbar, .inv-bag, .inv-offbar, .inv-pursebar {
      display: grid; gap: calc(4 * var(--u));
      padding: calc(6 * var(--u)); border-radius: calc(12 * var(--u));
      /* すりガラス：半透明の白に、光の縁と柔らかい影 */
      background: linear-gradient(135deg, rgba(255, 255, 255, ${GLASS_FILL_TOP}), rgba(255, 255, 255, ${GLASS_FILL_BOTTOM})),
        rgba(43, 38, 51, ${GLASS_TINT});
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, ${GLASS_EDGE}), 0 calc(8 * var(--u)) calc(24 * var(--u)) rgba(43, 38, 51, 0.25);
    }
    /* ホットバーと左手の枠は傾かないので、後ろの景色もぼかす（カバンの欄は奥行きを保つためにぼかさない。
       開いている間は背景の世界そのものをぼかしている） */
    .inv-hotbar, .inv-offbar {
      -webkit-backdrop-filter: blur(calc(${GLASS_BLUR} * var(--u))) saturate(140%);
      backdrop-filter: blur(calc(${GLASS_BLUR} * var(--u))) saturate(140%);
    }
    /* 背景の世界がぼけきっている間は、枠の後ろをさらにぼかしても見た目が変わらないので省く（毎フレームの合成が軽くなる） */
    .inv.frosted .inv-hotbar, .inv.frosted .inv-offbar { -webkit-backdrop-filter: none; backdrop-filter: none; }
    .inv-hotbar { grid-template-columns: repeat(${HOTBAR_SIZE}, calc(${HOTBAR_SLOT} * var(--u))); }
    .inv-bag { grid-template-columns: repeat(${BAG_COLS}, calc(52 * var(--u))); }
    .inv-hotrow { position: relative; }
    .inv-offbar { position: absolute; right: calc(100% + ${OFFHAND_GAP} * var(--u)); top: 0; bottom: 0; }
    /* お金のマスの枠はカバンの3段目（いちばん下の段）と同じ高さにそろえる（枠の余白がカバンと同じなので bottom: 0 でそろう） */
    .inv-pursebar { position: absolute; right: calc(100% + ${PURSE_GAP} * var(--u)); bottom: 0; transform-style: preserve-3d; }
    .inv-bagrow { position: relative; display: none; }
    .inv.open { pointer-events: auto; }
    .inv.open .inv-bagrow { display: block; }
    /* カバンの欄だけがカーソルのほうを向く（--tilt-x・--tilt-y は mousemove で入れる。ホットバーは動かさない） */
    .inv-bagrow {
      transform: perspective(calc(${TILT_PERSPECTIVE} * var(--u)))
        rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
    }
    /* マスが手前に出られるように、カバンの欄の中も奥行きを保つ */
    .inv-bagrow, .inv-bag { transform-style: preserve-3d; }
    .inv-slot { transition: transform ${HOVER_EASE}s ease-out; }
    /* カーソルを合わせたマスは少し手前に出す（傾かないホットバーでは少し大きくなる） */
    .inv.open .inv-slot:hover {
      transform: translateZ(calc(${HOVER_LIFT} * var(--u))) scale(${HOVER_SCALE}); z-index: 1;
    }
    /* 手前に出たマスは見た目の位置が少しずれるので、当たり判定を広げて元の位置も覆う
       （でないと縁でカーソルが外れて戻り、出たり引っこんだりを繰り返す） */
    .inv.open .inv-slot:hover::after { content: ''; position: absolute; inset: calc(${-HOVER_HIT} * var(--u)); }
    .inv-trash {
      position: absolute; left: calc(100% + 8 * var(--u)); bottom: 0;
      outline: calc(6 * var(--u)) solid rgba(43, 38, 51, ${GLASS_TINT}); margin: calc(6 * var(--u));
    }
    /* 空の左手のマスには「左」と薄く出す */
    .inv-offhand:empty::before {
      content: '左'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      color: rgba(255, 255, 255, 0.3); font-size: calc(18 * var(--u)); font-weight: 700;
    }
    .inv-purse { box-shadow: inset 0 0 0 calc(2 * var(--u)) ${css(PALETTE.sand)}; }
    .inv-slot img.inv-ghost { opacity: 0.3; filter: grayscale(1); }
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
    /* ホットバーと左手のマスは、いつも見えるのでカバンより大きくする（アイコンは同じ余白で広げる） */
    .inv-hotrow .inv-slot { width: calc(${HOTBAR_SLOT} * var(--u)); height: calc(${HOTBAR_SLOT} * var(--u)); }
    .inv-hotrow .inv-slot img {
      inset: calc(${HOTBAR_SLOT * 6 / 52} * var(--u));
      width: calc(${HOTBAR_SLOT * 40 / 52} * var(--u)); height: calc(${HOTBAR_SLOT * 40 / 52} * var(--u));
    }
    .inv-hotrow .inv-offhand:empty::before { font-size: calc(${HOTBAR_SLOT * 18 / 52} * var(--u)); }
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
    .inv-tip {
      position: fixed; left: calc(14 * var(--u)); top: calc(14 * var(--u)); display: none; white-space: nowrap;
      padding: calc(4 * var(--u)) calc(8 * var(--u)); border-radius: calc(6 * var(--u)); background: rgba(43, 38, 51, 0.88);
      color: #fff; font-size: calc(14 * var(--u)); font-weight: 700; pointer-events: none; z-index: 7;
    }
    .inv-tip.show { display: block; }

  `;
  document.head.append(style);
}
