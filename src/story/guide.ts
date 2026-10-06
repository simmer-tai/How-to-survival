import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { ITEMS, type ItemId } from '../items/inventory.js';
import { itemIcon } from '../items/itemIcons.js';
import { keyGuide } from '../ui/keyGuide.js';
import type { LocationId } from '../world/location.js';
import { FAREWELL, NPC_NAME, QUESTS, type Goal } from './quests.js';

/**
 * 桟橋の住人が出す頼みごと（最初の手順の案内）。画面の左上に今やることを出し、住人に話しかけるとセリフを出す。
 * どこまで進んだかはプレイヤーごとの「自分だけ」の状態。マルチでも同期せず、各自のセーブに入る。
 * 住人は共有ワールドにいるが、会話は自分の画面にだけ出る
 */

const TALK_LEAVE = 6; // 話している途中で住人からこれ以上離れたら、会話を閉じる（m）
const DONE_FLASH = 900; // 目標を達成したときに、チェックを光らせる時間（ミリ秒）

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** セーブデータ上の進み具合。step は QUESTS の何番目まで進んだか（QUESTS.length なら全部終わった） */
export interface GuideSave { step: number }

/** 目標の判定に使う、今の状態 */
export interface GuideWorld {
  /** インベントリに持っている個数 */
  count(item: ItemId): number;
  /** その部材が島のどこかに置かれているか */
  built(id: string): boolean;
  /** 設計図でその物の作り方を覚えているか */
  knows(item: ItemId): boolean;
  /** 船に乗っているか */
  riding(): boolean;
  /** 今いる場所 */
  location(): LocationId;
}

export class Guide {
  private step = 0;
  /** 話している途中のセリフと、何行目を出しているか */
  private talk: { lines: string[]; i: number; finishes: boolean } | null = null;
  private shown = '';
  private flashTimer = 0;

  private readonly panel: HTMLElement;
  private readonly box: HTMLElement;

  constructor(
    private readonly world: GuideWorld,
    /** 住人の立っている位置（離れたら会話を閉じる） */
    private readonly npcPosition: THREE.Vector3,
  ) {
    injectStyle();
    this.panel = document.createElement('div');
    this.panel.className = 'guide hidden';
    this.box = document.createElement('div');
    this.box.className = 'talk hidden';
    document.body.append(this.panel, this.box);
  }

  /** 全部の頼みごとを終えたか */
  get finished(): boolean {
    return this.step >= QUESTS.length;
  }

  /** 全部の頼みごとを終えたときに呼ばれる（ロードで終わった状態になったときは呼ばない） */
  onFinish: () => void = () => {};

  /** 桟橋の人に話しかけたら、セリフでなく取引の画面を開くか（取引を教わったあとの、住人に話す必要のないステップ） */
  get trades(): boolean {
    if (this.finished) return true;
    const current = QUESTS[this.step];
    return !('talk' in current.goal) && QUESTS.slice(0, this.step).some((s) => s.opensShop);
  }

  /** 取引の画面に住人のひとことして出す、今のステップのヒント（無ければ undefined） */
  get tip(): string | undefined {
    return this.finished ? undefined : QUESTS[this.step].hint?.join('');
  }

  /** 会話中か（[F] を会話を送るのに使う） */
  get talking(): boolean {
    return this.talk !== null;
  }

  set visible(v: boolean) {
    this.panel.classList.toggle('hidden', !v || this.finished);
    if (!v) this.close();
  }

  /** 住人に話しかけた・[F] でセリフを送った */
  speak(): void {
    if (this.talk) {
      this.talk.i++;
      if (this.talk.i < this.talk.lines.length) return this.renderTalk();
      const finishes = this.talk.finishes;
      this.close();
      if (finishes) this.advance();
      return;
    }
    const current = QUESTS[this.step];
    if (current && 'talk' in current.goal) this.open(current.say ?? [], true);
    else if (this.finished) this.open(FAREWELL, false);
    else this.open(current.hint ?? this.lastSaid(), false); // 途中で話しかけたら、そのステップのヒントを言う（無ければ直前に頼んだこと）
  }

  /** 毎フレーム呼ぶ。達成した目標を進め、表示を更新する */
  update(viewer: THREE.Vector3): void {
    if (this.talk && viewer.distanceTo(this.npcPosition) > TALK_LEAVE) this.close();
    for (;;) {
      const current = QUESTS[this.step];
      if (!current) break;
      // optional のステップは、次の目標を先に達成していたら飛ばす（住人に見せに行くステップは、話している途中なら最後まで聞かせる）
      const next = QUESTS[this.step + 1];
      const skip = !!current.optional && !!next && !('talk' in next.goal) && this.met(next.goal);
      if ('talk' in current.goal) {
        if (this.talk || !skip) break;
      } else if (!this.met(current.goal) && !skip) {
        break;
      }
      this.advance();
    }
    this.renderPanel();
  }

  serialize(): GuideSave {
    return { step: this.step };
  }

  restore(save: GuideSave | undefined): void {
    const step = save?.step;
    this.step = Number.isInteger(step) ? THREE.MathUtils.clamp(step!, 0, QUESTS.length) : 0;
    this.close();
    this.shown = '';
  }

  private advance(): void {
    this.step++;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.panel.classList.remove('flash'), DONE_FLASH);
    this.panel.classList.add('flash');
    if (this.finished) {
      this.panel.classList.add('hidden');
      this.onFinish();
    }
  }

  private met(goal: Goal): boolean {
    if ('have' in goal) return (Object.entries(goal.have) as [ItemId, number][]).every(([item, n]) => this.world.count(item) >= n);
    if ('built' in goal) return this.world.built(goal.built);
    if ('learned' in goal) return this.world.knows(goal.learned);
    if ('riding' in goal) return this.world.riding();
    if ('at' in goal) return this.world.location() === goal.at;
    return false;
  }

  /** いまのステップより前で、最後に住人が話したセリフ */
  private lastSaid(): string[] {
    for (let i = this.step - 1; i >= 0; i--) if (QUESTS[i].say) return QUESTS[i].say!;
    return FAREWELL;
  }

  private open(lines: string[], finishes: boolean): void {
    if (lines.length === 0) {
      if (finishes) this.advance();
      return;
    }
    this.talk = { lines, i: 0, finishes };
    this.box.classList.remove('hidden');
    this.renderTalk();
  }

  private close(): void {
    this.talk = null;
    this.box.classList.add('hidden');
  }

  private renderTalk(): void {
    if (!this.talk) return;
    const { lines, i } = this.talk;
    const last = i === lines.length - 1;
    this.box.innerHTML =
      `<div class="talk-name">${NPC_NAME}</div>` +
      `<div class="talk-line">${keyGuide(lines[i])}</div>` +
      `<div class="talk-next">${keyGuide(last ? '[F] 閉じる' : '[F] 次へ')}</div>`;
  }

  private renderPanel(): void {
    const current = QUESTS[this.step];
    if (!current) return;
    let list = '';
    if ('have' in current.goal) {
      list = (Object.entries(current.goal.have) as [ItemId, number][])
        .map(([item, n]) => {
          const have = Math.min(this.world.count(item), n);
          return (
            `<li class="${have >= n ? 'ok' : ''}"><img src="${itemIcon(item)}" alt="" draggable="false">` +
            `${ITEMS[item].name} <span class="guide-count">${have}/${n}</span></li>`
          );
        })
        .join('');
    }
    const help = 'talk' in current.goal ? '' : `<div class="guide-help">困ったら${NPC_NAME}に聞く</div>`;
    const html = `<div class="guide-head">やること</div><div class="guide-text">${keyGuide(current.text)}</div>` + (list ? `<ul>${list}</ul>` : '') + help;
    if (html === this.shown) return;
    this.shown = html;
    this.panel.innerHTML = html;
  }
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .guide {
      position: fixed; left: calc(16 * var(--u)); top: calc(64 * var(--u)); z-index: 5; max-width: calc(300 * var(--u));
      padding: calc(8 * var(--u)) calc(12 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(43, 38, 51, 0.55);
      color: #fff; font-size: calc(14 * var(--u)); font-weight: 700; line-height: 1.5; pointer-events: none; user-select: none;
      transition: box-shadow 0.3s;
    }
    .guide.hidden, .talk.hidden { display: none; }
    .guide.flash { box-shadow: 0 0 0 calc(2 * var(--u)) ${css(PALETTE.grass)}; }
    .guide-head { font-size: calc(11 * var(--u)); letter-spacing: 0.15em; color: ${css(PALETTE.sand)}; }
    .guide ul { margin: calc(4 * var(--u)) 0 0; padding: 0; list-style: none; }
    .guide li { display: flex; align-items: center; gap: calc(6 * var(--u)); font-size: calc(13 * var(--u)); }
    .guide li img {
      width: calc(22 * var(--u)); height: calc(22 * var(--u));
      filter: drop-shadow(1px 0 0 #2b2633) drop-shadow(-1px 0 0 #2b2633) drop-shadow(0 1px 0 #2b2633) drop-shadow(0 -1px 0 #2b2633);
    }
    .guide-help { margin-top: calc(4 * var(--u)); font-size: calc(11 * var(--u)); opacity: 0.6; }
    .guide-count { opacity: 0.75; font-variant-numeric: tabular-nums; }
    .guide li.ok .guide-count { color: ${css(PALETTE.grass)}; opacity: 1; }
    .talk {
      position: fixed; left: 50%; bottom: calc(150 * var(--u)); transform: translateX(-50%); z-index: 6;
      width: min(calc(560 * var(--u)), calc(100vw - 32px)); box-sizing: border-box;
      padding: calc(12 * var(--u)) calc(18 * var(--u)); border-radius: calc(12 * var(--u)); background: rgba(43, 38, 51, 0.8);
      color: #fff; font-size: calc(16 * var(--u)); line-height: 1.6; pointer-events: none; user-select: none;
      animation: talk-in 0.2s ease-out;
    }
    .talk-name { font-size: calc(12 * var(--u)); font-weight: 700; color: ${css(PALETTE.sand)}; margin-bottom: calc(2 * var(--u)); }
    .talk-next { margin-top: calc(6 * var(--u)); text-align: right; font-size: calc(12 * var(--u)); opacity: 0.75; }
    @keyframes talk-in { from { opacity: 0; transform: translate(-50%, calc(8 * var(--u))); } to { opacity: 1; transform: translateX(-50%); } }
  `;
  document.head.append(style);
}
