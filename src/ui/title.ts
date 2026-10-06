import { PALETTE } from '../core/palette.js';
import { keyGuide } from './keyGuide.js';
import { AvatarEditor } from './avatarEditor.js';
import { createWorld, deleteWorld, listWorlds, loadWorld, type WorldData, type WorldMeta } from '../core/save.js';
import { cleanCode } from '../net/link.js';
import { cleanName } from '../net/multiplayer.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const DEFAULT_NAME = '新しいワールド';
const VERSION = 'v0.1.0';
const NAME_KEY = 'warfarming:name'; // マルチで出す自分の名前（このブラウザに覚えておく）
/** URL に ?room=部屋コード を付けて開くと、「みんなで遊ぶ」の画面に部屋コードを入れた状態で始まる（ホストが送る招待リンク） */
export const ROOM_PARAM = 'room';

const CONTROLS: [string, string][] = [
  ['[W][A][S][D]', '移動'],
  ['[マウス]', '視点'],
  ['[Shift]', '走る'],
  ['[C]', 'しゃがむ／水中で潜る'],
  ['[Space]', 'ジャンプ／水中で浮上（水面で岸や桟橋に向かって押すと上がる）'],
  ['[左]', '斧を振る（倒した木をさらに叩くとばらせる）'],
  ['[F]', '落ちている物を拾う・茂みからベリーや葉っぱと枝を採る・作業台を使う・水辺で水を飲む'],
  ['[G]', '持っている物を1個落とす（[Ctrl]+[G]：まるごと。インベントリではマウスを乗せたマス）'],
  ['[右]', 'ベリーや魚を食べる'],
  ['釣り竿を持って', '[右長]：ためて投げる（ためるほど遠くへ） ／ [左長]：巻き取る（魚がかかったら巻き上げて岸まで寄せる）'],
  ['[E] [Tab]', 'インベントリとクラフト（素材をドラッグして台に1つずつ置くと、作れる物の候補が出る。作業台は木材2・枝2）'],
  ['[1]〜[9] [ホイール]', 'アイテムを選ぶ'],
  ['部材を持って', '[左]：設置 ／ [R]：回転'],
  ['船を持って', '[左]：水に浮かべる ／ 浮かべた船を見て [F]：乗る ・ [Q]：しまう'],
  ['船に乗って', '[W]/[S]：漕ぐ ／ [A]/[D]：向きを変える ／ [Shift]：力いっぱい漕ぐ ／ [F]：降りる（世界の端まで漕ぐと海図が開き、街へ行ける）'],
  ['[X]', '狙った部材を壊す（部材に戻る）'],
  ['[V]', '視点を切り替える（自分の姿が見える三人称と、一人称）'],
  ['[Esc]', '一時停止（自動でセーブされます）'],
];

/**
 * タイトル画面で選んだこと。solo：ひとりで遊ぶ、host：そのワールドで部屋を開く（友達が部屋コードで参加できる）、
 * join：部屋コード code の部屋に参加する。name はマルチで出す自分の名前
 */
export type ChosenWorld =
  | { mode: 'solo' | 'host'; meta: WorldMeta; data: WorldData | null; name: string }
  | { mode: 'join'; name: string; code: string };

type Page = 'home' | 'worlds' | 'multi' | 'avatar' | 'help';

/** マルチで出す自分の名前（覚えていなければ空） */
function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 覚えておけなくても、今回はその名前で遊ぶ
  }
}

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
        <button class="title-btn big" data-go="multi">みんなで遊ぶ</button>
        <button class="title-btn big" data-go="avatar">アバター</button>
        <button class="title-btn big" data-go="help">遊び方</button>
      </div>
      <div class="title-foot"><span>${VERSION}</span><span>ワールドはこのブラウザに保存されます</span></div>
    </section>
    <section class="title-page" data-page="worlds">
      <div class="title-panel">
        <div class="title-heading" data-worlds-heading>ワールドを選ぶ</div>
        <div class="title-list"></div>
        <form class="title-new">
          <input class="title-input" maxlength="24" placeholder="${DEFAULT_NAME}">
          <button class="title-btn primary" type="submit">新しく作る</button>
        </form>
        <button class="title-btn" data-worlds-back>もどる</button>
      </div>
    </section>
    <section class="title-page" data-page="multi">
      <div class="title-panel">
        <div class="title-heading">みんなで遊ぶ</div>
        <p class="title-text">友達と同じ島で遊べます。部屋を開くと「部屋コード」が出るので、友達に教えてください。</p>
        <label class="title-field">
          <span>名前</span>
          <input class="title-input" data-player-name maxlength="16" placeholder="名前を入れてください">
        </label>
        <button class="title-btn primary" data-act="host">自分のワールドで部屋を開く</button>
        <form class="title-join">
          <input class="title-input title-code" data-room-code maxlength="12" placeholder="部屋コード" autocomplete="off" spellcheck="false">
          <button class="title-btn primary" type="submit" data-act="join" disabled>参加する</button>
        </form>
        <button class="title-btn" data-go="home">もどる</button>
      </div>
    </section>
    <section class="title-page" data-page="avatar">
      <div class="title-panel wide">
        <div class="title-heading">アバター</div>
        <div class="title-avatar"></div>
        <button class="title-btn" data-go="home">もどる</button>
      </div>
    </section>
    <section class="title-page" data-page="help">
      <div class="title-panel">
        <div class="title-heading">遊び方</div>
        <p class="title-text">小さな島で木を切り、材料を集めて建物を建てよう。おなかが減ったら茂みのベリーを食べ、のどが渇いたら水辺で水を飲もう。</p>
        <dl class="title-controls">
          ${CONTROLS.map(([key, action]) => `<dt>${keyGuide(key)}</dt><dd>${keyGuide(action)}</dd>`).join('')}
        </dl>
        <button class="title-btn" data-go="home">もどる</button>
      </div>
    </section>`;
  const list = root.querySelector<HTMLElement>('.title-list')!;
  const form = root.querySelector<HTMLFormElement>('.title-new')!;
  const input = root.querySelector<HTMLInputElement>('.title-new .title-input')!;
  const worldsHeading = root.querySelector<HTMLElement>('[data-worlds-heading]')!;
  const createBtn = form.querySelector<HTMLButtonElement>('button')!;
  const nameInput = root.querySelector<HTMLInputElement>('[data-player-name]')!;
  const joinForm = root.querySelector<HTMLFormElement>('.title-join')!;
  const codeInput = root.querySelector<HTMLInputElement>('[data-room-code]')!;
  const joinBtn = root.querySelector<HTMLButtonElement>('[data-act="join"]')!;
  const hostBtn = root.querySelector<HTMLButtonElement>('[data-act="host"]')!;
  nameInput.value = loadName();
  codeInput.addEventListener('input', () => (joinBtn.disabled = cleanCode(codeInput.value) === ''));
  // 招待リンク（?room=部屋コード）から開いたら、部屋コードを入れておく
  const invited = cleanCode(new URLSearchParams(location.search).get(ROOM_PARAM) ?? '');
  codeInput.value = invited;
  joinBtn.disabled = invited === '';
  /** ワールドを選ぶ画面を、部屋を開くワールドを選ぶために開いているか */
  let hosting = false;
  // 自分の見た目を選ぶ（選んだらすぐこのブラウザに保存され、ゲームを始めると体に反映される）
  const avatar = new AvatarEditor();
  root.querySelector('.title-avatar')!.append(avatar.el);
  document.body.append(root);
  document.body.classList.add('on-title');

  let page: Page = 'home';
  const go = (next: Page) => {
    page = next;
    for (const el of root.querySelectorAll<HTMLElement>('.title-page')) {
      el.classList.toggle('show', el.dataset.page === next);
    }
    if (next === 'worlds') renderWorlds();
    if (next === 'avatar') avatar.start();
    else avatar.stop();
  };
  for (const btn of root.querySelectorAll<HTMLElement>('[data-go]')) {
    btn.addEventListener('click', () => {
      if (btn.dataset.go === 'worlds') hosting = false;
      go(btn.dataset.go as Page);
    });
  }
  root.querySelector('[data-worlds-back]')!.addEventListener('click', () => go(hosting ? 'multi' : 'home'));

  const playerName = () => {
    const name = cleanName(nameInput.value);
    saveName(nameInput.value.trim() ? name : '');
    return name;
  };

  // 表示中はゲームの操作キー（E でインベントリなど）を効かせない。Esc はホームへ戻る
  const block = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && page !== 'home') go('home');
    if (!root.contains(e.target as Node)) e.stopImmediatePropagation();
  };
  addEventListener('keydown', block, { capture: true });
  root.addEventListener('keydown', (e) => e.stopPropagation());

  let finish: (chosen: ChosenWorld) => void = () => {};

  const renderWorlds = () => {
    const worlds = listWorlds();
    worldsHeading.textContent = hosting ? '部屋を開くワールドを選ぶ' : 'ワールドを選ぶ';
    createBtn.textContent = hosting ? '新しく作って部屋を開く' : '新しく作る';
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
        <button class="title-btn primary" data-act="play">${hosting ? '部屋を開く' : '遊ぶ'}</button>
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
        finish({ mode: hosting ? 'host' : 'solo', meta: w, data, name: playerName() });
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
    finish = (chosen) => {
      removeEventListener('keydown', block, { capture: true });
      avatar.stop();
      root.remove();
      document.body.classList.remove('on-title');
      resolve(chosen);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish({ mode: hosting ? 'host' : 'solo', meta: createWorld(input.value.trim() || DEFAULT_NAME), data: null, name: playerName() });
    });
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = cleanCode(codeInput.value);
      if (code) finish({ mode: 'join', name: playerName(), code });
    });
    hostBtn.addEventListener('click', () => {
      hosting = true;
      go('worlds');
    });
    go(invited ? 'multi' : 'home');
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
      padding: calc(16 * var(--u)); box-sizing: border-box; animation: title-in 0.35s ease-out;
    }
    .title-page.show { display: flex; }
    .title-page:not([data-page="home"]) { background: rgba(43, 38, 51, 0.35); }
    @keyframes title-in { from { opacity: 0; transform: translateY(calc(8 * var(--u))); } }

    .title-logo {
      margin: 0 0 calc(48 * var(--u)); font-size: clamp(calc(56 * var(--u)), 13vw, calc(120 * var(--u))); font-weight: 900; letter-spacing: 0.12em;
      color: ${css(PALETTE.sand)};
      text-shadow: calc(3 * var(--u)) 0 0 ${ink}, calc(-3 * var(--u)) 0 0 ${ink}, 0 calc(3 * var(--u)) 0 ${ink}, 0 calc(-3 * var(--u)) 0 ${ink},
        calc(2 * var(--u)) calc(2 * var(--u)) 0 ${ink}, calc(-2 * var(--u)) calc(-2 * var(--u)) 0 ${ink}, calc(2 * var(--u)) calc(-2 * var(--u)) 0 ${ink}, calc(-2 * var(--u)) calc(2 * var(--u)) 0 ${ink},
        0 calc(9 * var(--u)) 0 ${ink}, 0 calc(14 * var(--u)) calc(24 * var(--u)) rgba(43, 38, 51, 0.45);
      animation: title-float 4s ease-in-out infinite;
    }
    @keyframes title-float { 50% { transform: translateY(calc(-8 * var(--u))); } }
    .title-menu { display: flex; flex-direction: column; gap: calc(10 * var(--u)); width: calc(300 * var(--u)); max-width: 100%; }
    .title-foot {
      position: absolute; left: calc(16 * var(--u)); right: calc(16 * var(--u)); bottom: calc(12 * var(--u)); display: flex; justify-content: space-between;
      gap: calc(12 * var(--u)); font-size: calc(12 * var(--u)); opacity: 0.75; text-shadow: 0 1px calc(2 * var(--u)) ${ink};
    }

    .title-btn {
      padding: calc(8 * var(--u)) calc(14 * var(--u)); border: none; border-radius: calc(8 * var(--u)); cursor: pointer; font: inherit; font-size: calc(14 * var(--u));
      font-weight: 700; color: #fff; background: rgba(43, 38, 51, 0.6); white-space: nowrap;
      box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.12);
    }
    .title-btn:hover:not(:disabled) { background: rgba(43, 38, 51, 0.8); box-shadow: inset 0 0 0 calc(2 * var(--u)) ${css(PALETTE.sand)}; }
    .title-btn:disabled { cursor: not-allowed; opacity: 0.55; }
    .title-btn.big { padding: calc(13 * var(--u)) calc(18 * var(--u)); font-size: calc(17 * var(--u)); border-radius: calc(10 * var(--u)); }
    .title-btn.primary { background: ${css(PALETTE.grass)}; color: ${ink}; box-shadow: inset 0 calc(-3 * var(--u)) 0 rgba(43, 38, 51, 0.25); }
    .title-btn.primary:hover { background: ${css(PALETTE.grass)}; filter: brightness(1.1); box-shadow: inset 0 calc(-3 * var(--u)) 0 rgba(43, 38, 51, 0.25); }
    .title-btn.danger:hover { background: ${css(PALETTE.accent)}; box-shadow: none; }
    .title-field { display: flex; align-items: center; gap: calc(10 * var(--u)); font-size: calc(14 * var(--u)); font-weight: 700; }
    .title-join { display: flex; gap: calc(8 * var(--u)); }
    .title-code { text-transform: uppercase; letter-spacing: 0.15em; font-weight: 700; }

    .title-panel {
      width: calc(480 * var(--u)); max-width: 100%; max-height: 100%; box-sizing: border-box;
      display: flex; flex-direction: column; gap: calc(12 * var(--u));
      padding: calc(20 * var(--u)); border-radius: calc(14 * var(--u)); background: rgba(43, 38, 51, 0.85);
    }
    .title-panel.wide { width: calc(580 * var(--u)); }
    .title-avatar { display: flex; flex-direction: column; min-height: 0; }
    .title-heading { font-size: calc(20 * var(--u)); font-weight: 700; letter-spacing: 0.08em; color: ${css(PALETTE.sand)}; }
    .title-text { margin: 0; font-size: calc(14 * var(--u)); line-height: 1.6; opacity: 0.9; }
    .title-list { display: flex; flex-direction: column; gap: calc(6 * var(--u)); overflow-y: auto; min-height: 0; }
    .title-empty { padding: calc(14 * var(--u)); text-align: center; opacity: 0.6; font-size: calc(14 * var(--u)); }
    .title-world {
      display: flex; align-items: center; gap: calc(8 * var(--u)); padding: calc(10 * var(--u)) calc(12 * var(--u)); border-radius: calc(8 * var(--u));
      background: rgba(255, 255, 255, 0.1);
    }
    .title-world-info { flex: 1; min-width: 0; }
    .title-world-name { font-size: calc(16 * var(--u)); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title-world-date { font-size: calc(12 * var(--u)); opacity: 0.7; margin-top: calc(2 * var(--u)); }
    .title-world .title-btn:not(.primary) { background: rgba(255, 255, 255, 0.14); }
    .title-new { display: flex; gap: calc(8 * var(--u)); }
    .title-input {
      flex: 1; min-width: 0; padding: calc(8 * var(--u)) calc(10 * var(--u)); border: none; border-radius: calc(8 * var(--u)); font: inherit; font-size: calc(15 * var(--u));
      background: rgba(255, 255, 255, 0.14); color: #fff; outline: none;
      box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(255, 255, 255, 0.12);
    }
    .title-input:focus { box-shadow: inset 0 0 0 calc(2 * var(--u)) ${css(PALETTE.sand)}; }
    .title-input::placeholder { color: rgba(255, 255, 255, 0.45); }
    .title-controls {
      margin: 0; display: grid; grid-template-columns: auto 1fr; gap: calc(6 * var(--u)) calc(12 * var(--u)); align-items: center;
      overflow-y: auto; min-height: 0; font-size: calc(14 * var(--u));
    }
    .title-controls dt { text-align: right; white-space: nowrap; font-size: calc(16 * var(--u)); }
    .title-controls dd { margin: 0; opacity: 0.9; }

    .toast {
      position: fixed; right: calc(16 * var(--u)); top: calc(16 * var(--u)); z-index: 8; pointer-events: none;
      padding: calc(6 * var(--u)) calc(14 * var(--u)); border-radius: calc(8 * var(--u)); background: rgba(43, 38, 51, 0.55);
      color: #fff; font-size: calc(13 * var(--u)); font-weight: 700; opacity: 0; transition: opacity 0.3s;
    }
    .toast.show { opacity: 1; }
  `;
  document.head.append(style);
}
