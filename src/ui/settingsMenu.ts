import { PALETTE } from '../core/palette.js';
import { GRAPHICS, QUALITY_ORDER, type Quality, type Recommendation } from '../core/graphics.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/**
 * 設定の画面（一時停止の画面の「設定」から開く）。今は画質（高・中・低）を選ぶ。
 * 端末から決めた「おすすめ」の段階に印を付けるが、選ぶのは自分。選んだ段階はすぐかかる（main 側で保存する）
 */
export class SettingsMenu {
  isOpen = false;
  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** 画質を選んだときに呼ばれる */
  onQuality: (q: Quality) => void = () => {};
  private readonly root: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly note: HTMLElement;
  private readonly reload: HTMLElement;

  /** quality は今の段階、antialias は今の描画で縁をなめらかにしているか（変えるには読み込み直す） */
  constructor(private quality: Quality, recommend: Recommendation, private readonly antialias: boolean) {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'set-menu';
    const rec = GRAPHICS[recommend.quality];
    this.root.innerHTML = `
      <div class="set-panel">
        <div class="set-title">設定</div>
        <div class="set-label">画質</div>
        <div class="set-choices"></div>
        <div class="set-note"></div>
        <div class="set-rec">おすすめは「${rec.label}」です。${recommend.reason}</div>
        <div class="set-reload">縁のなめらかさは、ページを読み込み直したときに変わります</div>
        <button class="set-btn primary">ゲームにもどる</button>
      </div>`;
    this.choices = this.root.querySelector('.set-choices')!;
    this.note = this.root.querySelector('.set-note')!;
    this.reload = this.root.querySelector('.set-reload')!;
    for (const q of QUALITY_ORDER) {
      const b = document.createElement('button');
      b.className = 'set-chip';
      b.dataset.q = q;
      b.innerHTML = `<span>${GRAPHICS[q].label}</span>${q === recommend.quality ? '<span class="set-badge">おすすめ</span>' : ''}`;
      b.addEventListener('click', () => this.pick(q));
      this.choices.append(b);
    }
    this.root.querySelector('.set-btn')!.addEventListener('click', () => this.setOpen(false));
    document.body.append(this.root);
    this.refresh();
    addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') this.setOpen(false, false);
    });
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  private pick(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.refresh();
    this.onQuality(q);
  }

  private refresh(): void {
    for (const b of this.choices.children) (b as HTMLElement).classList.toggle('picked', (b as HTMLElement).dataset.q === this.quality);
    this.note.textContent = GRAPHICS[this.quality].note;
    this.reload.classList.toggle('show', GRAPHICS[this.quality].antialias !== this.antialias);
  }
}

let injected = false;

function injectStyle(): void {
  if (injected) return;
  injected = true;
  const ink = '#2b2633';
  const style = document.createElement('style');
  style.textContent = `
    .set-menu {
      position: fixed; inset: 0; z-index: 12; display: none; align-items: center; justify-content: center;
      padding: calc(16 * var(--u)); box-sizing: border-box; background: rgba(43, 38, 51, 0.45); color: #fff; user-select: none;
    }
    .set-menu.open { display: flex; }
    .set-panel {
      width: calc(420 * var(--u)); max-width: 100%; max-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: calc(10 * var(--u));
      padding: calc(20 * var(--u)); border-radius: calc(14 * var(--u)); background: rgba(43, 38, 51, 0.88);
    }
    .set-title { font-size: calc(20 * var(--u)); font-weight: 700; letter-spacing: 0.08em; color: ${css(PALETTE.sand)}; }
    .set-label { font-size: calc(13 * var(--u)); font-weight: 700; opacity: 0.75; }
    .set-choices { display: flex; gap: calc(8 * var(--u)); }
    .set-chip {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: calc(3 * var(--u));
      padding: calc(10 * var(--u)) calc(6 * var(--u)); border: none; border-radius: calc(8 * var(--u)); cursor: pointer; font: inherit;
      font-size: calc(17 * var(--u)); font-weight: 700; color: #fff; background: rgba(255, 255, 255, 0.14);
    }
    .set-chip:hover { background: rgba(255, 255, 255, 0.24); }
    .set-chip.picked { background: ${css(PALETTE.sand)}; color: ${ink}; }
    .set-badge {
      font-size: calc(11 * var(--u)); padding: calc(1 * var(--u)) calc(7 * var(--u)); border-radius: calc(10 * var(--u));
      background: ${css(PALETTE.grass)}; color: ${ink};
    }
    .set-note { font-size: calc(13 * var(--u)); line-height: 1.6; min-height: 1.6em; }
    .set-rec { font-size: calc(12 * var(--u)); line-height: 1.6; opacity: 0.7; }
    .set-reload { display: none; font-size: calc(12 * var(--u)); line-height: 1.6; color: ${css(PALETTE.sand)}; }
    .set-reload.show { display: block; }
    .set-btn {
      margin-top: calc(4 * var(--u)); padding: calc(7 * var(--u)) calc(14 * var(--u)); border: none; border-radius: calc(6 * var(--u)); cursor: pointer;
      font: inherit; font-size: calc(14 * var(--u)); font-weight: 700;
    }
    .set-btn.primary { background: ${css(PALETTE.grass)}; color: ${ink}; box-shadow: inset 0 calc(-3 * var(--u)) 0 rgba(43, 38, 51, 0.25); }
    .set-btn.primary:hover { filter: brightness(1.1); }
  `;
  document.head.append(style);
}
