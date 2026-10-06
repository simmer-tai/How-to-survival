import { PALETTE } from '../core/palette.js';
import type { Role } from '../net/multiplayer.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** 一時停止の画面に出す部屋のようす（だれがいるか、友達はどこから参加できるか） */
export interface RoomView {
  role: Role;
  /** 部屋にいる人の名前（自分が先頭） */
  names: string[];
  /** 部屋コード */
  code: string | null;
  /** 開くとそのまま部屋コードが入る招待リンク（ホストのとき） */
  invite: string | null;
}

/** 一時停止の画面の、部屋のようす（だれがいるか、部屋コード）。ひとりで遊んでいるときは出さない */
export class RoomInfo {
  private readonly el: HTMLElement;

  /** after の要素のすぐ下に出す */
  constructor(after: HTMLElement) {
    injectStyle();
    this.el = document.createElement('div');
    this.el.className = 'room-info';
    after.after(this.el);
    this.el.addEventListener('click', (e) => e.stopPropagation()); // 部屋コードを選んでコピーできるように、クリックしてもゲームを再開しない
  }

  render(view: RoomView): void {
    this.el.classList.toggle('show', view.role !== 'solo');
    if (view.role === 'solo') return;
    const head = document.createElement('div');
    head.className = 'room-info-head';
    head.textContent = `${view.role === 'host' ? '部屋を開いています' : '参加しています'}（${view.names.length}人）`;
    const names = document.createElement('div');
    names.textContent = view.names.join('、');
    const parts: HTMLElement[] = [head, names];
    if (view.code) {
      const code = document.createElement('div');
      code.className = 'room-info-code';
      code.textContent = `部屋コード：${view.code}`;
      parts.push(code);
    }
    if (view.role === 'host' && view.invite) {
      const how = document.createElement('div');
      how.className = 'room-info-how';
      how.append('友達はこのゲームのページを開いて「みんなで遊ぶ」に部屋コードを入れる。招待リンク：');
      const link = document.createElement('code');
      link.textContent = view.invite;
      how.append(link);
      parts.push(how);
    }
    this.el.replaceChildren(...parts);
  }
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .room-info {
      display: none; margin: 0 auto calc(12 * var(--u)); padding: calc(8 * var(--u)) calc(14 * var(--u)); max-width: calc(460 * var(--u));
      border-radius: calc(8 * var(--u)); background: rgba(43, 38, 51, 0.5); font-size: calc(13 * var(--u)); line-height: 1.6;
      cursor: auto; user-select: text;
    }
    .room-info.show { display: block; }
    .room-info-head { font-weight: 700; color: ${css(PALETTE.sand)}; }
    .room-info-how { margin-top: calc(4 * var(--u)); opacity: 0.9; }
    .room-info-code { margin-top: calc(4 * var(--u)); font-size: calc(20 * var(--u)); font-weight: 700; letter-spacing: 0.15em; }
    .room-info code { font-weight: 700; overflow-wrap: anywhere; }
  `;
  document.head.append(style);
}
