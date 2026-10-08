import { PALETTE } from '../core/palette.js';
import { keyGuide } from './keyGuide.js';
// 左上のチャット。Enter で入力欄を開き、Enter で送る（Esc でやめる）。
// 「/」で始めるとコマンド（コマンドメニューと同じ）を実行する。送り先（マルチの相手）は main が onSend でつなぐ
const css = (c) => '#' + c.toString(16).padStart(6, '0');
export const CHAT_MAX = 100; // 1回に送れる文字数の上限
const SHOW_TIME = 10; // 入力欄を閉じているとき、書き込みを出しておく時間（秒）
const FADE_TIME = 1; // 消えるまでの時間（秒）
const KEEP_LINES = 50; // 覚えておく書き込みの数
const GAP = 8; // チャットの下に並ぶ「やること」との間（--u の倍数）
export class Chat {
    isOpen = false;
    /** 開いた時刻（開いたのと同じキー入力をチャットで扱わないように） */
    openedAt = 0;
    root;
    log;
    input;
    /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
    onToggle = () => { };
    /** 書き込みを送る（「/」で始まらないもの） */
    onSend = () => { };
    /** 「/」で始まる書き込みをコマンドとして実行する */
    onCommand = () => ({ message: '' });
    constructor() {
        injectStyle();
        this.root = document.createElement('div');
        this.root.className = 'chat hidden';
        this.root.innerHTML = `
      <div class="chat-log"></div>
      <input class="chat-input" type="text" spellcheck="false" autocomplete="off" maxlength="${CHAT_MAX}" />
      <div class="chat-hint">${keyGuide('[Enter]：送る ／ [Esc]：閉じる ／ 「/」で始めるとコマンド')}</div>`;
        this.log = this.root.querySelector('.chat-log');
        this.input = this.root.querySelector('.chat-input');
        document.body.append(this.root);
        this.root.addEventListener('contextmenu', (e) => e.preventDefault());
        // 打っている文字で、ほかの操作（E でインベントリ、数字でホットバーなど）が動かないようにする
        this.root.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.code === 'Escape')
                this.setOpen(false, false);
            else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') {
                // 何も打っていなければ、変換中の扱いや開いた直後かどうかにかかわらず閉じる
                if (!this.input.value.trim()) {
                    e.preventDefault();
                    if (e.repeat)
                        return; // 開いたときの Enter を押しっぱなしにしている間は閉じない
                    this.setOpen(false);
                    return;
                }
                if (e.timeStamp <= this.openedAt)
                    return;
                if (e.isComposing || e.keyCode === 229)
                    return; // 日本語の変換を確定する Enter では送らない
                this.submit(this.input.value.trim());
            }
        });
        // 下に並ぶ「やること」が、チャットの高さのぶんだけ下がるようにする
        new ResizeObserver(() => {
            const h = this.root.offsetHeight;
            const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) * GAP || GAP;
            document.documentElement.style.setProperty('--chat-h', h > 0 ? `${h + gap}px` : '0px');
        }).observe(this.root);
    }
    set visible(v) {
        this.root.classList.toggle('hidden', !v);
    }
    setOpen(open, resume = true) {
        if (this.isOpen === open)
            return;
        this.isOpen = open;
        this.root.classList.toggle('open', open);
        if (open) {
            this.openedAt = performance.now();
            this.input.value = '';
            this.input.focus();
            this.log.scrollTop = this.log.scrollHeight;
        }
        else
            this.input.blur();
        this.onToggle(open, resume);
    }
    /** 書き込みを1行足す。name が null なら知らせ（参加した・抜けたなど） */
    add(name, text, kind = 'normal') {
        const line = document.createElement('div');
        line.className = `chat-line ${kind === 'normal' && name === null ? 'info' : kind}`;
        if (name !== null) {
            const who = document.createElement('span');
            who.className = 'chat-name';
            who.textContent = `${name}：`;
            line.append(who);
        }
        line.append(text);
        this.log.append(line);
        while (this.log.childElementCount > KEEP_LINES)
            this.log.firstElementChild.remove();
        this.log.scrollTop = this.log.scrollHeight;
        setTimeout(() => {
            line.classList.add('fading');
            setTimeout(() => line.classList.add('old'), FADE_TIME * 1000);
        }, SHOW_TIME * 1000);
    }
    submit(text) {
        if (!text) {
            this.setOpen(false);
            return;
        }
        if (/^[/／]/.test(text)) {
            const result = this.onCommand(text);
            if (result.error) {
                // 打ち直せるように、開いたままにする
                this.add(null, result.message, 'error');
                return;
            }
            if (result.message)
                this.add(null, result.message, 'info');
        }
        else
            this.onSend(text.slice(0, CHAT_MAX));
        this.setOpen(false);
    }
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .chat {
      position: fixed; left: calc(16 * var(--u)); top: calc(16 * var(--u)); z-index: 5;
      width: calc(380 * var(--u)); max-width: calc(100vw - 32px); user-select: none; pointer-events: none;
      color: #fff; font-size: calc(14 * var(--u)); font-weight: 700; line-height: 1.45;
    }
    .chat.hidden { display: none; }
    .chat-log { display: flex; flex-direction: column; align-items: flex-start; gap: calc(2 * var(--u)); max-height: calc(220 * var(--u)); overflow: hidden; }
    .chat.open .chat-log { overflow-y: auto; pointer-events: auto; }
    .chat-line {
      max-width: 100%; box-sizing: border-box; padding: calc(2 * var(--u)) calc(8 * var(--u)); border-radius: calc(6 * var(--u));
      background: rgba(43, 38, 51, 0.55); overflow-wrap: anywhere; transition: opacity ${FADE_TIME}s;
    }
    .chat-line.fading { opacity: 0; }
    .chat-line.old { display: none; }
    .chat.open .chat-line { opacity: 1; display: block; }
    .chat-name { color: ${css(PALETTE.sand)}; }
    .chat-line.info { color: ${css(PALETTE.sky)}; }
    .chat-line.error { color: ${css(PALETTE.accent)}; }
    .chat-input, .chat-hint { display: none; }
    .chat.open .chat-input {
      display: block; width: 100%; box-sizing: border-box; margin-top: calc(4 * var(--u)); padding: calc(6 * var(--u)) calc(10 * var(--u));
      border: none; border-radius: calc(8 * var(--u)); outline: none; pointer-events: auto; user-select: text;
      background: rgba(43, 38, 51, 0.75); box-shadow: inset 0 0 0 2px ${css(PALETTE.sky)};
      color: #fff; font: inherit; font-size: calc(14 * var(--u));
    }
    .chat.open .chat-hint { display: block; margin-top: calc(4 * var(--u)); font-size: calc(11 * var(--u)); opacity: 0.75; }
  `;
    document.head.append(style);
}
