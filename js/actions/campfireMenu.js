import { PALETTE } from '../core/palette.js';
import { ITEMS } from '../items/inventory.js';
import { itemIcon } from '../items/itemIcons.js';
import { keyGuide } from '../ui/keyGuide.js';
import { formatTime, isFuel } from './campfire.js';
// 焚火の燃料の欄の画面。焚火を見て F を押すとインベントリと一緒に開く。
// 燃料の欄は共有ワールド（焚火）の状態なので、入れる・取り出すは Campfires へのワールドコマンドの頼みにする。
// 頼みが通ったら、自分のインベントリ（つまんでいる物）を増減する
const NOTICE_TIME = 1600; // 「燃やせない」などの知らせを出しておく時間（ms）
const css = (c) => '#' + c.toString(16).padStart(6, '0');
export class CampfireMenu {
    inventory;
    fires;
    /** 開いている焚火の部材の番号（閉じていれば null） */
    pid = null;
    root;
    slotEl;
    statusEl;
    barEl;
    noticeEl;
    slotHtml = '';
    statusHtml = '';
    noticeTimer = 0;
    /** 燃料の欄の上でマウスを押したか（欄の上で離したときに、もう一度入れないように） */
    pressed = false;
    constructor(inventory, fires) {
        this.inventory = inventory;
        this.fires = fires;
        injectStyle();
        this.root = el('div', 'fire-panel');
        const title = el('div', 'fire-title');
        title.textContent = '焚火';
        const row = el('div', 'fire-row');
        const slotWrap = el('div', 'fire-slot-wrap');
        this.slotEl = el('div', 'inv-slot fire-slot');
        const slotLabel = el('div', 'fire-slot-label');
        slotLabel.textContent = '燃料';
        slotWrap.append(this.slotEl, slotLabel);
        const state = el('div', 'fire-state');
        this.statusEl = el('div', 'fire-status');
        const bar = el('div', 'fire-bar');
        this.barEl = el('span', '');
        bar.append(this.barEl);
        state.append(this.statusEl, bar);
        row.append(slotWrap, state);
        const hint = el('div', 'fire-hint');
        hint.innerHTML = keyGuide('[左]：入れる・取り出す ／ [右]：1つずつ ／ [Shift]+[左]：まとめて送る');
        this.noticeEl = el('div', 'fire-notice');
        this.root.append(title, row, hint, this.noticeEl);
        document.body.append(this.root);
        this.slotEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.pressed = true;
            this.onSlotDown(e.button === 2, e.shiftKey);
        });
        // インベントリのマスからドラッグしてきて、燃料の欄の上で離したら入れる
        this.slotEl.addEventListener('mouseup', () => {
            if (!this.pressed && this.inventory.holding)
                this.insert(false);
            this.pressed = false;
        });
        this.slotEl.addEventListener('contextmenu', (e) => e.preventDefault());
        addEventListener('mouseup', () => (this.pressed = false));
    }
    get isOpen() {
        return this.pid !== null;
    }
    /** 焚火の燃料の欄を開く（インベントリも一緒に開く） */
    open(pid) {
        this.pid = pid;
        this.root.classList.add('open');
        this.inventory.quickMove = (s) => this.quickInsert(s);
        this.slotHtml = '';
        this.statusHtml = '';
        this.update();
        this.inventory.setOpen(true);
    }
    /** 閉じる（インベントリを閉じたときに呼ぶ） */
    close() {
        if (this.pid === null)
            return;
        this.pid = null;
        this.root.classList.remove('open');
        this.inventory.quickMove = null;
        this.noticeEl.classList.remove('show');
    }
    /** 燃料の欄と火のようすを描き直す。使っている焚火がなくなったら閉じる */
    update() {
        if (this.pid === null)
            return;
        const info = this.fires.info(this.pid);
        if (!info) {
            this.inventory.setOpen(false, false); // 焚火が壊された
            return;
        }
        const s = info.fuel;
        const slot = s ? `<img src="${itemIcon(s.item)}" alt="" draggable="false">${s.count > 1 ? `<span class="inv-count">${s.count}</span>` : ''}` : '';
        if (slot !== this.slotHtml) {
            this.slotHtml = slot;
            this.slotEl.innerHTML = slot;
            this.slotEl.title = s ? `${ITEMS[s.item].name} ×${s.count}` : '';
        }
        const status = info.item
            ? `<b class="fire-lit">燃えている</b>：${ITEMS[info.item].name}（のこり ${formatTime(info.left)}）<br>` +
                `<span class="fire-sub">燃料の欄の分も合わせて あと ${formatTime(info.remaining)}</span>`
            : `<b>消えている</b><br><span class="fire-sub">燃料を入れると燃え上がる</span>`;
        if (status !== this.statusHtml) {
            this.statusHtml = status;
            this.statusEl.innerHTML = status;
        }
        this.barEl.style.width = info.total > 0 ? `${((info.left / info.total) * 100).toFixed(1)}%` : '0%';
    }
    // ---- 入力：つまんでいる物を入れる・燃料の欄から取り出す ----
    /** 燃料の欄を押した。物をつまんでいれば入れ、つまんでいなければ取り出す */
    onSlotDown(right, shift) {
        if (this.inventory.holding)
            this.insert(right);
        else
            this.take(right, shift);
    }
    /** つまんでいる物を燃料の欄に入れる（one なら1つだけ） */
    insert(one) {
        const held = this.inventory.holding;
        if (!held)
            return;
        const n = this.fit(held, one ? 1 : held.count);
        if (n <= 0 || this.pid === null)
            return;
        if (!this.fires.request({ type: 'addFuel', pid: this.pid, item: held.item, count: n }))
            return;
        // 燃料の欄に入ったと決まってから、つまんでいる物を減らす
        held.count -= n;
        this.inventory.hold(held.count > 0 ? held : null);
        this.update();
    }
    /** Shift+クリックしたインベントリのマスの物を、燃料の欄へ送る。送った個数を返す */
    quickInsert(s) {
        const n = this.fit(s, s.count);
        if (n <= 0 || this.pid === null)
            return 0;
        if (!this.fires.request({ type: 'addFuel', pid: this.pid, item: s.item, count: n }))
            return 0;
        this.update();
        return n;
    }
    /** 燃料の欄に s を何個まで入れられるか（入れられなければ知らせて 0） */
    fit(s, want) {
        if (!isFuel(s.item)) {
            this.notice(`${ITEMS[s.item].name}は燃やせない`);
            return 0;
        }
        const fuel = this.pid === null ? null : this.fires.info(this.pid)?.fuel ?? null;
        if (fuel && fuel.item !== s.item) {
            this.notice('燃料の欄には1種類だけ入る（先に取り出す）');
            return 0;
        }
        const room = ITEMS[s.item].maxStack - (fuel?.count ?? 0);
        if (room <= 0)
            this.notice('燃料の欄がいっぱい');
        return Math.min(want, room);
    }
    /** 燃料の欄から取り出す。half なら半分、toBag なら（Shift+クリック）つままずにインベントリへ入れる */
    take(half, toBag) {
        if (this.pid === null)
            return;
        const fuel = this.fires.info(this.pid)?.fuel;
        if (!fuel)
            return;
        const item = fuel.item;
        let n = half ? Math.ceil(fuel.count / 2) : fuel.count;
        if (toBag)
            n = Math.min(n, this.inventory.room(item));
        if (n <= 0)
            return;
        if (!this.fires.request({ type: 'takeFuel', pid: this.pid, count: n }))
            return;
        if (toBag)
            this.inventory.add(item, n);
        else
            this.inventory.hold({ item, count: n }, true); // つまんだまま、インベントリのマスへドラッグして置ける
        this.update();
    }
    notice(text) {
        this.noticeEl.textContent = text;
        this.noticeEl.classList.add('show');
        clearTimeout(this.noticeTimer);
        this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.remove('show'), NOTICE_TIME);
    }
}
function el(tag, className) {
    const e = document.createElement(tag);
    e.className = className;
    return e;
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .fire-panel {
      display: none; position: fixed; left: 50%; top: calc(40 * var(--u)); transform: translateX(-50%); z-index: 5;
      flex-direction: column; align-items: center; gap: calc(8 * var(--u));
      padding: calc(12 * var(--u)) calc(18 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.72);
      color: #fff; user-select: none; text-shadow: 0 1px 0 #2b2633;
    }
    .fire-panel.open { display: flex; }
    .fire-title { font-size: calc(20 * var(--u)); font-weight: 700; letter-spacing: 0.15em; }
    .fire-row { display: flex; align-items: center; gap: calc(14 * var(--u)); }
    .fire-slot-wrap { display: flex; flex-direction: column; align-items: center; gap: calc(3 * var(--u)); }
    .fire-slot { cursor: pointer; box-shadow: inset 0 0 0 calc(2 * var(--u)) ${css(PALETTE.accent)}; }
    .fire-slot:hover { background: rgba(255, 255, 255, 0.28); }
    .fire-slot-label { font-size: calc(12 * var(--u)); opacity: 0.85; }
    .fire-state { display: flex; flex-direction: column; gap: calc(6 * var(--u)); width: calc(250 * var(--u)); }
    .fire-status { font-size: calc(14 * var(--u)); line-height: 1.45; }
    .fire-lit { color: ${css(PALETTE.sand)}; }
    .fire-sub { font-size: calc(12 * var(--u)); opacity: 0.85; }
    .fire-bar {
      height: calc(6 * var(--u)); border-radius: calc(3 * var(--u)); background: #2b2633; overflow: hidden;
    }
    .fire-bar > span { display: block; height: 100%; width: 0; background: ${css(PALETTE.accent)}; }
    .fire-hint { font-size: calc(12 * var(--u)); opacity: 0.9; }
    .fire-notice { font-size: calc(13 * var(--u)); font-weight: 700; color: ${css(PALETTE.accent)}; min-height: calc(17 * var(--u)); opacity: 0; transition: opacity 0.2s; }
    .fire-notice.show { opacity: 1; }
  `;
    document.head.append(style);
}
