import { PALETTE } from '../core/palette.js';

/**
 * 操作ガイドの文言に、キーやマウスのアイコンを入れる。
 * 文言の中の [左] [右] [ホイール] [マウス] はマウスの絵、[左長] [右長] は長押し、
 * それ以外の [F] [Shift] [Esc] などはキーの形（キーキャップ）にする。
 * 例：keyGuide('[右長]：ためて投げる ／ [F]：拾う')
 */

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const PRESSED = css(PALETTE.sand); // 押すボタン・ホイールの色

type MousePart = 'left' | 'right' | 'wheel' | null;

/** マウスの絵。part の部分を塗る */
function mouseSvg(part: MousePart): string {
  const fill = (p: MousePart) => (p === part ? PRESSED : 'none');
  return (
    `<svg class="kg-mouse" viewBox="0 0 16 22" aria-hidden="true">` +
    `<path d="M8 1.5 H7.5 A6 6 0 0 0 1.5 7.5 V9 H8 Z" fill="${fill('left')}"/>` +
    `<path d="M8 1.5 H8.5 A6 6 0 0 1 14.5 7.5 V9 H8 Z" fill="${fill('right')}"/>` +
    `<rect x="1.5" y="1.5" width="13" height="19" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
    `<path d="M1.5 9 H14.5 M8 1.5 V9" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
    `<rect x="6.6" y="3.6" width="2.8" height="4.2" rx="1.4" fill="${part === 'wheel' ? PRESSED : 'currentColor'}" stroke="currentColor" stroke-width="0.8"/>` +
    `</svg>`
  );
}

/** トークン → アイコンの HTML */
const MOUSE: Record<string, string> = {
  左: mouseSvg('left'),
  右: mouseSvg('right'),
  ホイール: mouseSvg('wheel'),
  マウス: mouseSvg(null),
  左長: `<span class="kg-hold">${mouseSvg('left')}<span class="kg-hold-mark">長押し</span></span>`,
  右長: `<span class="kg-hold">${mouseSvg('right')}<span class="kg-hold-mark">長押し</span></span>`,
};

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** [..] をアイコンに置き換えた HTML を返す。[..] 以外の部分はそのまま（HTML として書いてよい） */
export function keyGuide(text: string): string {
  injectStyle();
  return text.replace(/\[([^\]]+)\]/g, (_, token: string) => MOUSE[token] ?? `<kbd class="kg-key">${escape(token)}</kbd>`);
}

/** el の中身を keyGuide した HTML にする。同じ文言なら書き換えない（毎フレーム呼んでもよい） */
export function setKeyGuide(el: HTMLElement, text: string): void {
  if (el.dataset.kg === text) return;
  el.dataset.kg = text;
  el.innerHTML = keyGuide(text);
}

let injected = false;

function injectStyle(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    .kg-mouse { display: inline-block; width: 0.8em; height: 1.1em; vertical-align: -0.2em; margin: 0 0.1em; }
    .kg-hold { display: inline-flex; align-items: center; gap: 0.15em; white-space: nowrap; }
    .kg-hold-mark {
      font-size: 0.68em; font-weight: 700; padding: 0 0.3em; border-radius: 0.4em; line-height: 1.4;
      background: rgba(255, 255, 255, 0.2);
    }
    .kg-key {
      display: inline-block; min-width: 1.1em; padding: 0 0.35em; margin: 0 0.1em; border-radius: 0.3em; box-sizing: border-box;
      font: inherit; font-size: 0.85em; font-weight: 700; line-height: 1.45; text-align: center; white-space: nowrap; vertical-align: 0.05em;
      color: #2b2633; background: #fff; box-shadow: inset 0 -0.15em 0 rgba(43, 38, 51, 0.3);
    }
  `;
  document.head.append(style);
}
