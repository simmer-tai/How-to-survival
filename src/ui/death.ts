import { PALETTE } from '../core/palette.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** HP が尽きたときの画面。リスポーンするかタイトルへ戻るかを選ぶ */
export class DeathScreen {
  isOpen = false;
  private readonly root: HTMLElement;

  onRespawn: () => void = () => {};
  onQuit: () => void = () => {};

  constructor() {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'death';
    this.root.innerHTML = `
      <div class="death-title">力尽きた…</div>
      <div class="death-text">おなかと水分に気をつけよう。ベリーを食べ、水辺で F を押すと水が飲める</div>
      <div class="death-buttons">
        <button class="death-btn primary" data-act="respawn">リスポーン</button>
        <button class="death-btn" data-act="quit">セーブしてタイトルへ</button>
      </div>`;
    this.root.querySelector('[data-act="respawn"]')!.addEventListener('click', () => this.onRespawn());
    this.root.querySelector('[data-act="quit"]')!.addEventListener('click', () => this.onQuit());
    document.body.append(this.root);

    // 表示中はゲームの操作キー（E でインベントリなど）を効かせない
    addEventListener(
      'keydown',
      (e) => {
        if (this.isOpen) e.stopImmediatePropagation();
      },
      { capture: true },
    );
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.classList.toggle('open', open);
  }
}

function injectStyle(): void {
  const ink = '#2b2633';
  const style = document.createElement('style');
  style.textContent = `
    .death {
      position: fixed; inset: 0; z-index: 15; display: none; flex-direction: column; align-items: center;
      justify-content: center; gap: calc(14 * var(--u)); padding: calc(16 * var(--u)); box-sizing: border-box; text-align: center;
      color: #fff; user-select: none; background: rgba(120, 30, 20, 0.45);
    }
    .death.open { display: flex; animation: death-in 0.8s ease-out; }
    @keyframes death-in { from { opacity: 0; } }
    .death-title {
      font-size: clamp(calc(36 * var(--u)), 8vw, calc(64 * var(--u))); font-weight: 900; letter-spacing: 0.1em; color: ${css(PALETTE.accent)};
      text-shadow: calc(2 * var(--u)) 0 0 ${ink}, calc(-2 * var(--u)) 0 0 ${ink}, 0 calc(2 * var(--u)) 0 ${ink}, 0 calc(-2 * var(--u)) 0 ${ink}, 0 calc(6 * var(--u)) 0 ${ink};
    }
    .death-text { font-size: calc(14 * var(--u)); opacity: 0.9; text-shadow: 0 1px calc(2 * var(--u)) ${ink}; }
    .death-buttons { display: flex; flex-direction: column; gap: calc(10 * var(--u)); width: calc(280 * var(--u)); max-width: 100%; margin-top: calc(8 * var(--u)); }
    .death-btn {
      padding: calc(12 * var(--u)) calc(18 * var(--u)); border: none; border-radius: calc(10 * var(--u)); cursor: pointer; font: inherit; font-size: calc(16 * var(--u));
      font-weight: 700; color: #fff; background: rgba(43, 38, 51, 0.7); box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.12);
    }
    .death-btn:hover { background: rgba(43, 38, 51, 0.9); box-shadow: inset 0 0 0 calc(2 * var(--u)) ${css(PALETTE.sand)}; }
    .death-btn.primary { background: ${css(PALETTE.grass)}; color: ${ink}; box-shadow: inset 0 calc(-3 * var(--u)) 0 rgba(43, 38, 51, 0.25); }
    .death-btn.primary:hover { filter: brightness(1.1); }
  `;
  document.head.append(style);
}
