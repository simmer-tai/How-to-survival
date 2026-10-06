import { PALETTE } from '../core/palette.js';
import { keyGuide } from './keyGuide.js';
// コマンドメニュー（Enter で開く）。上の入力欄に「/weather rain」のようなコマンドを打つか、下に並んだボタンを押して実行する。
// コマンドの中身（何をするか）は main が register() で登録する。共有ワールドを変えるコマンドは、登録した側がワールドコマンドの頼みにする
const css = (c) => '#' + c.toString(16).padStart(6, '0');
export class CommandMenu {
    isOpen = false;
    /** 開いた時刻（開いたのと同じ Enter で実行しないように） */
    openedAt = 0;
    root;
    input;
    messageEl;
    groupsEl;
    commands = [];
    groups = [];
    /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
    onToggle = () => { };
    /** 実行できたときの結果（閉じたあとに main が知らせる） */
    onResult = () => { };
    constructor() {
        injectStyle();
        this.root = document.createElement('div');
        this.root.className = 'cmd';
        this.root.innerHTML = `
      <div class="cmd-title">コマンド</div>
      <input class="cmd-input" type="text" spellcheck="false" autocomplete="off" placeholder="/weather rain" />
      <div class="cmd-message"></div>
      <div class="cmd-groups"></div>
      <div class="cmd-hint">${keyGuide('[Enter]：実行 ／ [Esc]：閉じる')}</div>`;
        this.input = this.root.querySelector('.cmd-input');
        this.messageEl = this.root.querySelector('.cmd-message');
        this.groupsEl = this.root.querySelector('.cmd-groups');
        document.body.append(this.root);
        this.root.addEventListener('contextmenu', (e) => e.preventDefault());
        // 打っている文字で、ほかの操作（E でインベントリ、数字でホットバーなど）が動かないようにする
        this.root.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.timeStamp <= this.openedAt)
                return;
            if (e.code === 'Escape')
                this.setOpen(false, false);
            else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
                if (e.isComposing)
                    return; // 日本語の変換を確定する Enter では実行しない
                const text = this.input.value.trim();
                if (text)
                    this.execute(text);
                else
                    this.setOpen(false);
            }
        });
    }
    register(def) {
        this.commands.push(def);
    }
    addButtons(group) {
        this.groups.push(group);
    }
    setOpen(open, resume = true) {
        if (this.isOpen === open)
            return;
        this.isOpen = open;
        this.root.classList.toggle('open', open);
        if (open) {
            this.openedAt = performance.now();
            this.input.value = '';
            this.showMessage(this.commands.map((c) => c.usage).join('\n'), false, true);
            this.render();
            this.input.focus();
        }
        else
            this.input.blur();
        this.onToggle(open, resume);
    }
    /** コマンドの文字列を実行する。できたら閉じてゲームに戻る（天気などが変わっていくのを見られるように） */
    execute(text) {
        const [head, ...args] = text.replace(/^[/／]/, '').split(/\s+/);
        const name = head.toLowerCase();
        const def = this.commands.find((c) => c.name === name || c.aliases?.includes(name));
        if (!def) {
            this.showMessage(`「${head}」というコマンドはありません`, true);
            return;
        }
        const result = def.run(args);
        if (result.error) {
            this.showMessage(result.message, true);
            return;
        }
        this.setOpen(false);
        this.onResult(result.message);
    }
    showMessage(text, error, help = false) {
        this.messageEl.textContent = text;
        this.messageEl.classList.toggle('error', error);
        this.messageEl.classList.toggle('help', help);
    }
    render() {
        this.groupsEl.replaceChildren(...this.groups.map((group) => {
            const current = group.current?.() ?? null;
            const box = document.createElement('div');
            box.className = 'cmd-group';
            const title = document.createElement('div');
            title.className = 'cmd-group-title';
            title.textContent = group.title;
            const row = document.createElement('div');
            row.className = 'cmd-buttons';
            for (const { label, command } of group.buttons) {
                const button = document.createElement('button');
                button.className = 'cmd-button' + (command === current ? ' active' : '');
                button.textContent = label;
                button.title = command;
                button.addEventListener('click', () => this.execute(command));
                row.append(button);
            }
            box.append(title, row);
            return box;
        }));
    }
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .cmd {
      display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6;
      width: calc(420 * var(--u)); max-width: calc(100vw - 32px); box-sizing: border-box;
      padding: calc(14 * var(--u)) calc(18 * var(--u)); border-radius: calc(12 * var(--u)); background: rgba(43, 38, 51, 0.8);
      color: #fff; user-select: none;
    }
    .cmd.open { display: block; }
    .cmd-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.1em; text-align: center; margin-bottom: calc(10 * var(--u)); }
    .cmd-input {
      width: 100%; box-sizing: border-box; padding: calc(8 * var(--u)) calc(10 * var(--u));
      border: none; border-radius: calc(8 * var(--u)); outline: none;
      background: rgba(255, 255, 255, 0.12); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
      color: #fff; font: inherit; font-size: calc(15 * var(--u)); font-family: ui-monospace, monospace;
    }
    .cmd-input:focus { box-shadow: inset 0 0 0 2px ${css(PALETTE.sky)}; }
    .cmd-input::placeholder { color: rgba(255, 255, 255, 0.35); }
    .cmd-message {
      min-height: calc(18 * var(--u)); margin: calc(6 * var(--u)) 0 calc(4 * var(--u));
      font-size: calc(13 * var(--u)); white-space: pre-line; opacity: 0.85;
    }
    .cmd-message.help { font-family: ui-monospace, monospace; opacity: 0.6; }
    .cmd-message.error { color: ${css(PALETTE.accent)}; opacity: 1; font-weight: 700; }
    .cmd-group { margin-top: calc(10 * var(--u)); }
    .cmd-group-title { font-size: calc(13 * var(--u)); font-weight: 700; opacity: 0.8; margin-bottom: calc(6 * var(--u)); }
    .cmd-buttons { display: flex; flex-wrap: wrap; gap: calc(6 * var(--u)); }
    .cmd-button {
      padding: calc(6 * var(--u)) calc(14 * var(--u)); border: none; border-radius: calc(8 * var(--u)); cursor: pointer;
      font: inherit; font-size: calc(14 * var(--u)); font-weight: 700; color: #fff; background: rgba(255, 255, 255, 0.16);
    }
    .cmd-button:hover { background: rgba(255, 255, 255, 0.3); }
    .cmd-button.active { color: #2b2633; background: ${css(PALETTE.sand)}; }
    .cmd-hint { margin-top: calc(12 * var(--u)); font-size: calc(12 * var(--u)); opacity: 0.7; text-align: center; }
  `;
    document.head.append(style);
}
