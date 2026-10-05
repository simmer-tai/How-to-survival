import { PALETTE } from '../core/palette.js';
import type { Inventory } from '../items/inventory.js';
import { itemIcon, modelIcon } from '../items/itemIcons.js';
import { BUILD_PLANS, ingredients, type BuildPlan } from '../items/recipes.js';
import { pieceIconModel } from './pieces.js';
import { keyGuide } from '../ui/keyGuide.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/**
 * ハンマーを持って右クリックで開く、建てる部材を選ぶメニュー。
 * どれを選んでいるかは自分だけの状態なので、ワールドコマンドにもセーブにも入れない
 */
export class BuildMenu {
  isOpen = false;
  /** 選んでいる部材（BUILD_PLANS の番号） */
  private selected = 0;
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;

  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};

  constructor(private readonly inventory: Inventory) {
    injectStyle();
    this.root = el('div', 'bmenu');
    const title = el('div', 'bmenu-title');
    title.textContent = '建てる部材を選ぶ';
    this.listEl = el('div', 'bmenu-list');
    const hint = el('div', 'bmenu-hint');
    hint.innerHTML = keyGuide('[左]：選ぶ ／ [Esc]：閉じる');
    this.root.append(title, this.listEl, hint);
    document.body.append(this.root);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.setOpen(false, false);
    });
  }

  get plan(): BuildPlan {
    return BUILD_PLANS[this.selected];
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    if (open) this.render(); // 開くたびに、持っている素材の数を見て作り直す
    this.root.classList.toggle('open', open);
    this.onToggle(open, resume);
  }

  private render(): void {
    this.listEl.replaceChildren(
      ...BUILD_PLANS.map((plan, i) => {
        const card = el('div', 'bmenu-card');
        card.classList.toggle('selected', i === this.selected);
        const cost = ingredients(plan)
          .map(([item, n]) => {
            const short = this.inventory.count(item) < n ? ' short' : '';
            return `<span class="bmenu-cost${short}"><img src="${itemIcon(item)}" alt="">${n}</span>`;
          })
          .join('');
        card.innerHTML =
          `<img class="bmenu-icon" src="${pieceIcon(plan.piece)}" alt="" draggable="false">` +
          `<div class="bmenu-name">${plan.name}</div><div>${cost}</div>`;
        card.addEventListener('click', () => {
          this.selected = i;
          this.setOpen(false);
        });
        return card;
      }),
    );
  }
}

/** 部材のアイコン（初回だけ描画してキャッシュする） */
function pieceIcon(id: BuildPlan['piece']): string {
  return modelIcon(`piece:${id}`, () => pieceIconModel(id));
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .bmenu {
      display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5;
      padding: calc(14 * var(--u)) calc(18 * var(--u)); border-radius: calc(12 * var(--u)); background: rgba(43, 38, 51, 0.7);
      color: #fff; text-align: center; user-select: none;
    }
    .bmenu.open { display: block; }
    .bmenu-title { font-size: calc(18 * var(--u)); font-weight: 700; letter-spacing: 0.1em; margin-bottom: calc(10 * var(--u)); }
    .bmenu-list { display: grid; grid-template-columns: repeat(3, calc(120 * var(--u))); gap: calc(8 * var(--u)); }
    .bmenu-card {
      padding: calc(8 * var(--u)) calc(6 * var(--u)); border-radius: calc(8 * var(--u)); cursor: pointer;
      background: rgba(255, 255, 255, 0.12); box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.1);
    }
    .bmenu-card:hover { background: rgba(255, 255, 255, 0.24); }
    .bmenu-card.selected { box-shadow: inset 0 0 0 calc(3 * var(--u)) ${css(PALETTE.sand)}; background: rgba(255, 255, 255, 0.22); }
    .bmenu-icon {
      width: calc(64 * var(--u)); height: calc(64 * var(--u)); transition: transform 0.12s;
      filter: drop-shadow(0 calc(2 * var(--u)) calc(2 * var(--u)) rgba(43, 38, 51, 0.6));
    }
    .bmenu-card:hover .bmenu-icon { transform: scale(1.1) rotate(-4deg); }
    .bmenu-name { font-size: calc(14 * var(--u)); font-weight: 700; margin: calc(2 * var(--u)) 0; }
    .bmenu-cost {
      display: inline-flex; align-items: center; gap: calc(2 * var(--u)); margin: 0 calc(3 * var(--u));
      font-size: calc(12 * var(--u)); font-weight: 700;
    }
    .bmenu-cost img { width: calc(18 * var(--u)); height: calc(18 * var(--u)); }
    .bmenu-cost.short { color: ${css(PALETTE.accent)}; }
    .bmenu-hint { font-size: calc(12 * var(--u)); opacity: 0.8; margin-top: calc(10 * var(--u)); }
  `;
  document.head.append(style);
}
