import { PALETTE } from './palette.js';
import { createWorld, deleteWorld, listWorlds, loadWorld, type WorldData, type WorldMeta } from './save.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const DEFAULT_NAME = '新しいワールド';
const VERSION = 'v0.1.0';

const CONTROLS: [string, string][] = [
  ['WASD', '移動'],
  ['マウス', '視点'],
  ['Shift', '走る'],
  ['Ctrl', 'しゃがむ'],
  ['Space', 'ジャンプ／水中で浮上（水面で岸や桟橋に向かって押すと上がる）'],
  ['C', '水中で潜る'],
  ['左クリック', '斧を振る（倒した木をさらに叩くとばらせる）'],
  ['F', '木材を拾う・茂みから葉っぱと枝を採る'],
  ['E・Tab', 'インベントリ'],
  ['1〜9・ホイール', 'アイテムを選ぶ'],
  ['Q', '建築メニュー（左クリック：設置 ／ R：回転 ／ 右クリック：やめる）'],
  ['Esc', '一時停止（自動でセーブされます）'],
];

export interface ChosenWorld { meta: WorldMeta; data: WorldData | null }

type Page = 'home' | 'worlds' | 'help';

/**
 * タイトル画面を出し、選ばれた（または新しく作った）ワールドを返す。
 * 表示中は body に on-title クラスが付き、ゲームの HUD が隠れる
 */
export function showTitle(): Promise<ChosenWorld> {
  injectStyle();
  const root = document.createElement('div');
  root.className = 'title';
  root.innerHTML = `
    <section class="title-page" data-page="home">
      <h1 class="title-logo">Island</h1>
      <div class="title-menu">
        <button class="title-btn big primary" data-go="worlds">ひとりで遊ぶ</button>
        <button class="title-btn big" disabled title="準備中">みんなで遊ぶ<span class="title-soon">準備中</span></button>
        <button class="title-btn big" data-go="help">遊び方</button>
      </div>
      <div class="title-foot"><span>${VERSION}</span><span>ワールドはこのブラウザに保存されます</span></div>
    </section>
    <section class="title-page" data-page="worlds">
      <div class="title-panel">
        <div class="title-heading">ワールドを選ぶ</div>
        <div class="title-list"></div>
        <form class="title-new">
          <input class="title-input" maxlength="24" placeholder="${DEFAULT_NAME}">
          <button class="title-btn primary" type="submit">新しく作る</button>
        </form>
        <button class="title-btn" data-go="home">もどる</button>
      </div>
    </section>
    <section class="title-page" data-page="help">
      <div class="title-panel">
        <div class="title-heading">遊び方</div>
        <p class="title-text">小さな島で木を切り、材料を集めて建物を建てよう。おなかと水分が尽きないように気をつけて。</p>
        <dl class="title-controls">
          ${CONTROLS.map(([key, action]) => `<dt><kbd>${key}</kbd></dt><dd>${action}</dd>`).join('')}
        </dl>
        <button class="title-btn" data-go="home">もどる</button>
      </div>
    </section>`;
  const list = root.querySelector<HTMLElement>('.title-list')!;
  const form = root.querySelector<HTMLFormElement>('.title-new')!;
  const input = root.querySelector<HTMLInputElement>('.title-input')!;
  document.body.append(root);
  document.body.classList.add('on-title');

  let page: Page = 'home';
  const go = (next: Page) => {
    page = next;
    for (const el of root.querySelectorAll<HTMLElement>('.title-page')) {
      el.classList.toggle('show', el.dataset.page === next);
    }
    if (next === 'worlds') renderWorlds();
  };
  for (const btn of root.querySelectorAll<HTMLElement>('[data-go]')) {
    btn.addEventListener('click', () => go(btn.dataset.go as Page));
  }

  // 表示中はゲームの操作キー（E でインベントリなど）を効かせない。Esc はホームへ戻る
  const block = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && page !== 'home') go('home');
    if (!root.contains(e.target as Node)) e.stopImmediatePropagation();
  };
  addEventListener('keydown', block, { capture: true });
  root.addEventListener('keydown', (e) => e.stopPropagation());

  let finish: (meta: WorldMeta, data: WorldData | null) => void = () => {};

  const renderWorlds = () => {
    const worlds = listWorlds();
    list.innerHTML = '';
    if (worlds.length === 0) list.innerHTML = '<div class="title-empty">まだワールドがありません。名前を付けて作ろう</div>';
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'title-world';
      row.innerHTML = `
        <div class="title-world-info">
          <div class="title-world-name"></div>
          <div class="title-world-date">最後に遊んだ日：${formatDate(w.savedAt)}</div>
        </div>
        <button class="title-btn primary" data-act="play">遊ぶ</button>
        <button class="title-btn danger" data-act="delete">削除</button>`;
      row.querySelector('.title-world-name')!.textContent = w.name;
      row.querySelector('[data-act="play"]')!.addEventListener('click', () => {
        let data: WorldData | null;
        try {
          data = loadWorld(w.id);
        } catch (e) {
          console.error(e);
          alert(`「${w.name}」のセーブデータを読み込めませんでした。`);
          return;
        }
        finish(w, data);
      });
      row.querySelector('[data-act="delete"]')!.addEventListener('click', () => {
        if (!confirm(`「${w.name}」を削除しますか？元に戻せません。`)) return;
        deleteWorld(w.id);
        renderWorlds();
      });
      list.append(row);
    }
  };

  return new Promise((resolve) => {
    finish = (meta, data) => {
      removeEventListener('keydown', block, { capture: true });
      root.remove();
      document.body.classList.remove('on-title');
      resolve({ meta, data });
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(createWorld(input.value.trim() || DEFAULT_NAME), null);
    });
    go('home');
  });
}

let toastTimer = 0;

/** 画面右上に短いお知らせを出す */
export function showToast(text: string): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1500);
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function injectStyle(): void {
  if (document.getElementById('title-style')) return;
  const ink = '#2b2633';
  const style = document.createElement('style');
  style.id = 'title-style';
  style.textContent = `
    body.on-title .inv, body.on-title .vitals, body.on-title #crosshair, body.on-title #pickup-hint { display: none !important; }
    .title {
      position: fixed; inset: 0; z-index: 20; color: #fff; user-select: none;
      background: linear-gradient(to bottom, rgba(43, 38, 51, 0.05) 30%, rgba(43, 38, 51, 0.55));
    }
    .title-page {
      position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center;
      padding: 16px; box-sizing: border-box; animation: title-in 0.35s ease-out;
    }
    .title-page.show { display: flex; }
    .title-page:not([data-page="home"]) { background: rgba(43, 38, 51, 0.35); }
    @keyframes title-in { from { opacity: 0; transform: translateY(8px); } }

    .title-logo {
      margin: 0 0 48px; font-size: clamp(56px, 13vw, 120px); font-weight: 900; letter-spacing: 0.12em;
      color: ${css(PALETTE.sand)};
      text-shadow: 3px 0 0 ${ink}, -3px 0 0 ${ink}, 0 3px 0 ${ink}, 0 -3px 0 ${ink},
        2px 2px 0 ${ink}, -2px -2px 0 ${ink}, 2px -2px 0 ${ink}, -2px 2px 0 ${ink},
        0 9px 0 ${ink}, 0 14px 24px rgba(43, 38, 51, 0.45);
      animation: title-float 4s ease-in-out infinite;
    }
    @keyframes title-float { 50% { transform: translateY(-8px); } }
    .title-menu { display: flex; flex-direction: column; gap: 10px; width: 300px; max-width: 100%; }
    .title-foot {
      position: absolute; left: 16px; right: 16px; bottom: 12px; display: flex; justify-content: space-between;
      gap: 12px; font-size: 12px; opacity: 0.75; text-shadow: 0 1px 2px ${ink};
    }

    .title-btn {
      padding: 8px 14px; border: none; border-radius: 8px; cursor: pointer; font: inherit; font-size: 14px;
      font-weight: 700; color: #fff; background: rgba(43, 38, 51, 0.6); white-space: nowrap;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.12);
    }
    .title-btn:hover:not(:disabled) { background: rgba(43, 38, 51, 0.8); box-shadow: inset 0 0 0 2px ${css(PALETTE.sand)}; }
    .title-btn:disabled { cursor: not-allowed; opacity: 0.55; }
    .title-btn.big { padding: 13px 18px; font-size: 17px; border-radius: 10px; }
    .title-btn.primary { background: ${css(PALETTE.grass)}; color: ${ink}; box-shadow: inset 0 -3px 0 rgba(43, 38, 51, 0.25); }
    .title-btn.primary:hover { background: ${css(PALETTE.grass)}; filter: brightness(1.1); box-shadow: inset 0 -3px 0 rgba(43, 38, 51, 0.25); }
    .title-btn.danger:hover { background: ${css(PALETTE.accent)}; box-shadow: none; }
    .title-soon {
      margin-left: 8px; padding: 1px 6px; border-radius: 4px; font-size: 11px; vertical-align: 2px;
      background: rgba(255, 255, 255, 0.2);
    }

    .title-panel {
      width: 480px; max-width: 100%; max-height: 100%; box-sizing: border-box;
      display: flex; flex-direction: column; gap: 12px;
      padding: 20px; border-radius: 14px; background: rgba(43, 38, 51, 0.85);
    }
    .title-heading { font-size: 20px; font-weight: 700; letter-spacing: 0.08em; color: ${css(PALETTE.sand)}; }
    .title-text { margin: 0; font-size: 14px; line-height: 1.6; opacity: 0.9; }
    .title-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; min-height: 0; }
    .title-empty { padding: 14px; text-align: center; opacity: 0.6; font-size: 14px; }
    .title-world {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
    }
    .title-world-info { flex: 1; min-width: 0; }
    .title-world-name { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title-world-date { font-size: 12px; opacity: 0.7; margin-top: 2px; }
    .title-world .title-btn:not(.primary) { background: rgba(255, 255, 255, 0.14); }
    .title-new { display: flex; gap: 8px; }
    .title-input {
      flex: 1; min-width: 0; padding: 8px 10px; border: none; border-radius: 8px; font: inherit; font-size: 15px;
      background: rgba(255, 255, 255, 0.14); color: #fff; outline: none;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.12);
    }
    .title-input:focus { box-shadow: inset 0 0 0 2px ${css(PALETTE.sand)}; }
    .title-input::placeholder { color: rgba(255, 255, 255, 0.45); }
    .title-controls {
      margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; align-items: center;
      overflow-y: auto; min-height: 0; font-size: 14px;
    }
    .title-controls dt { text-align: right; }
    .title-controls dd { margin: 0; opacity: 0.9; }
    .title-controls kbd {
      display: inline-block; padding: 2px 7px; border-radius: 5px; font: inherit; font-size: 12px; font-weight: 700;
      background: rgba(255, 255, 255, 0.16); box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.25); white-space: nowrap;
    }

    .toast {
      position: fixed; right: 16px; top: 16px; z-index: 8; pointer-events: none;
      padding: 6px 14px; border-radius: 8px; background: rgba(43, 38, 51, 0.55);
      color: #fff; font-size: 13px; font-weight: 700; opacity: 0; transition: opacity 0.3s;
    }
    .toast.show { opacity: 1; }
  `;
  document.head.append(style);
}
