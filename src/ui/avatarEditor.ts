import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { solid } from '../core/materials.js';
import {
  AVATAR_LAYER, Avatar, CLOTH_COLORS, HAIR_COLORS, HAIR_STYLES, HATS, SKIN_TONES, loadLook, randomLook, saveLook,
  type AvatarLook, type AvatarPose, type ColorChoice,
} from '../player/avatar.js';
import { keyGuide } from './keyGuide.js';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

const SPIN_SPEED = 0.45; // 見本がひとりでに回る速さ（ラジアン／秒）
const DRAG_TURN = 0.012; // 見本をドラッグしたときの、1px あたりの回る量（ラジアン）
const SPIN_PAUSE = 2.5; // ドラッグをやめてから、また回り出すまでの時間（秒）

/** 選ぶ項目：色を選ぶか、名前を選ぶか */
const ROWS: [keyof AvatarLook, string, readonly ColorChoice[] | readonly string[]][] = [
  ['skin', '肌', SKIN_TONES],
  ['hair', '髪の色', HAIR_COLORS],
  ['hairStyle', '髪型', HAIR_STYLES],
  ['hat', '帽子', HATS],
  ['shirt', 'シャツ', CLOTH_COLORS],
  ['pants', 'ズボン', CLOTH_COLORS],
];

/**
 * アバターの見た目を選ぶ部品（回る見本と、項目ごとのボタン）。タイトル画面とゲーム中のメニューで使う。
 * 選んだ見た目はすぐブラウザに保存する（ワールドではなく、このブラウザの自分の見た目）
 */
export class AvatarEditor {
  readonly el: HTMLElement;
  /** 見た目を変えたときに呼ばれる */
  onChange: (look: AvatarLook) => void = () => {};

  private look = loadLook();
  private readonly stage: HTMLElement;
  private readonly options: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 3 / 4, 0.1, 20);
  private readonly turntable = new THREE.Group();
  private readonly avatar = new Avatar(this.look);
  private readonly pose: AvatarPose = { p: new THREE.Vector3(), yaw: Math.PI, pitch: -0.05, speed: 0, state: 'ground', crouch: 0, bodyYaw: Math.PI };
  private frame = 0;
  private last = 0;
  private idle = SPIN_PAUSE; // ドラッグをやめてからの時間

  constructor() {
    injectStyle();
    this.el = document.createElement('div');
    this.el.className = 'av-editor';
    this.el.innerHTML = `
      <div class="av-stage"></div>
      <div class="av-side">
        <div class="av-options"></div>
        <button class="av-btn" data-act="random">おまかせ</button>
        <div class="av-note">${keyGuide('ゲーム中は [V] で自分の姿が見える視点に切り替わります')}</div>
      </div>`;
    this.stage = this.el.querySelector('.av-stage')!;
    this.options = this.el.querySelector('.av-options')!;
    this.el.querySelector('[data-act="random"]')!.addEventListener('click', () => this.set(randomLook()));
    this.renderOptions();

    // 見本の舞台：砂の台の上に立たせる
    this.camera.position.set(0, 1.05, 3.9);
    this.camera.lookAt(0, 0.95, 0);
    this.camera.layers.enable(AVATAR_LAYER);
    this.scene.add(new THREE.HemisphereLight(PALETTE.sky, PALETTE.grass, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const base = solid(new THREE.CylinderGeometry(0.6, 0.66, 0.08, 16), PALETTE.sand);
    base.position.y = -0.04;
    this.scene.add(base);
    this.turntable.add(this.avatar.object);
    this.turntable.rotation.y = -0.5;
    this.scene.add(this.turntable);

    // ドラッグで見本を回す
    let dragX: number | null = null;
    this.stage.addEventListener('pointerdown', (e) => {
      dragX = e.clientX;
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      this.turntable.rotation.y += (e.clientX - dragX) * DRAG_TURN;
      dragX = e.clientX;
      this.idle = 0;
    });
    const endDrag = () => (dragX = null);
    this.stage.addEventListener('pointerup', endDrag);
    this.stage.addEventListener('pointercancel', endDrag);
  }

  /** 見本を描き始める（画面に出したときに呼ぶ）。保存されている見た目を読み直す */
  start(): void {
    this.set(loadLook(), false);
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.stage.append(this.renderer.domElement);
    }
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop);
      this.draw(Math.min((now - this.last) / 1000, 0.05));
      this.last = now;
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** 見本を描くのをやめる（画面から消したときに呼ぶ） */
  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  private set(look: AvatarLook, changed = true): void {
    this.look = { ...look };
    this.avatar.setLook(this.look);
    this.renderOptions();
    if (!changed) return;
    saveLook(this.look);
    this.onChange({ ...this.look });
  }

  private draw(dt: number): void {
    const renderer = this.renderer!;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (w === 0 || h === 0) return;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.idle += dt;
    if (this.idle > SPIN_PAUSE) this.turntable.rotation.y += SPIN_SPEED * dt;
    this.avatar.update(dt, this.pose);
    renderer.render(this.scene, this.camera);
  }

  private renderOptions(): void {
    this.options.replaceChildren(
      ...ROWS.map(([key, label, choices]) => {
        const row = document.createElement('div');
        row.className = 'av-row';
        const name = document.createElement('div');
        name.className = 'av-label';
        name.textContent = label;
        const list = document.createElement('div');
        list.className = 'av-choices';
        choices.forEach((choice, i) => {
          const btn = document.createElement('button');
          const picked = this.look[key] === i;
          if (typeof choice === 'string') {
            btn.className = 'av-chip' + (picked ? ' picked' : '');
            btn.textContent = choice;
          } else {
            btn.className = 'av-swatch' + (picked ? ' picked' : '');
            btn.style.background = css(choice.color);
            btn.title = choice.name;
          }
          btn.addEventListener('click', () => this.set({ ...this.look, [key]: i }));
          list.append(btn);
        });
        row.append(name, list);
        return row;
      }),
    );
  }
}

/** ゲーム中に見た目を変える画面（一時停止の画面から開く） */
export class AvatarMenu {
  isOpen = false;
  /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
  onToggle: (open: boolean, resume: boolean) => void = () => {};
  /** 見た目を変えたときに呼ばれる */
  onChange: (look: AvatarLook) => void = () => {};
  private readonly root: HTMLElement;
  private readonly editor = new AvatarEditor();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'av-menu';
    const panel = document.createElement('div');
    panel.className = 'av-panel';
    const title = document.createElement('div');
    title.className = 'av-title';
    title.textContent = 'アバター';
    const close = document.createElement('button');
    close.className = 'av-btn primary';
    close.textContent = 'ゲームにもどる';
    close.addEventListener('click', () => this.setOpen(false));
    panel.append(title, this.editor.el, close);
    this.root.append(panel);
    document.body.append(this.root);
    this.editor.onChange = (look) => this.onChange(look);
    addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') this.setOpen(false, false);
    });
  }

  setOpen(open: boolean, resume = true): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.root.classList.toggle('open', open);
    if (open) this.editor.start();
    else this.editor.stop();
    this.onToggle(open, resume);
  }
}

let injected = false;

function injectStyle(): void {
  if (injected) return;
  injected = true;
  const ink = '#2b2633';
  const style = document.createElement('style');
  style.textContent = `
    .av-editor { display: flex; gap: calc(16 * var(--u)); align-items: stretch; min-height: 0; }
    .av-stage {
      flex: none; width: calc(210 * var(--u)); height: calc(300 * var(--u)); border-radius: calc(10 * var(--u)); cursor: grab; touch-action: none;
      background: radial-gradient(ellipse at 50% 85%, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04) 70%);
    }
    .av-stage:active { cursor: grabbing; }
    .av-stage canvas { display: block; width: 100%; height: 100%; }
    .av-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: calc(10 * var(--u)); }
    .av-options { display: flex; flex-direction: column; gap: calc(8 * var(--u)); overflow-y: auto; min-height: 0; }
    .av-label { font-size: calc(12 * var(--u)); font-weight: 700; opacity: 0.75; margin-bottom: calc(4 * var(--u)); }
    .av-choices { display: flex; flex-wrap: wrap; gap: calc(5 * var(--u)); }
    .av-swatch {
      width: calc(24 * var(--u)); height: calc(24 * var(--u)); padding: 0; border: none; border-radius: 50%; cursor: pointer;
      box-shadow: inset 0 0 0 calc(2 * var(--u)) rgba(43, 38, 51, 0.35);
    }
    .av-swatch:hover { transform: scale(1.12); }
    .av-swatch.picked { box-shadow: 0 0 0 calc(2 * var(--u)) ${ink}, 0 0 0 calc(4 * var(--u)) ${css(PALETTE.sand)}; }
    .av-chip, .av-btn {
      padding: calc(4 * var(--u)) calc(10 * var(--u)); border: none; border-radius: calc(6 * var(--u)); cursor: pointer; font: inherit;
      font-size: calc(13 * var(--u)); font-weight: 700; color: #fff; background: rgba(255, 255, 255, 0.14);
    }
    .av-chip:hover, .av-btn:hover { background: rgba(255, 255, 255, 0.24); }
    .av-chip.picked { background: ${css(PALETTE.sand)}; color: ${ink}; }
    .av-btn { align-self: flex-start; padding: calc(7 * var(--u)) calc(14 * var(--u)); font-size: calc(14 * var(--u)); }
    .av-btn.primary { align-self: stretch; background: ${css(PALETTE.grass)}; color: ${ink}; box-shadow: inset 0 calc(-3 * var(--u)) 0 rgba(43, 38, 51, 0.25); }
    .av-btn.primary:hover { filter: brightness(1.1); }
    .av-note { font-size: calc(12 * var(--u)); opacity: 0.7; line-height: 1.6; }

    .av-menu {
      position: fixed; inset: 0; z-index: 12; display: none; align-items: center; justify-content: center;
      padding: calc(16 * var(--u)); box-sizing: border-box; background: rgba(43, 38, 51, 0.45); color: #fff; user-select: none;
    }
    .av-menu.open { display: flex; }
    .av-panel {
      width: calc(560 * var(--u)); max-width: 100%; max-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: calc(12 * var(--u));
      padding: calc(20 * var(--u)); border-radius: calc(14 * var(--u)); background: rgba(43, 38, 51, 0.88);
    }
    .av-title { font-size: calc(20 * var(--u)); font-weight: 700; letter-spacing: 0.08em; color: ${css(PALETTE.sand)}; }
    @media (max-width: 520px) {
      .av-editor { flex-direction: column; }
      .av-stage { align-self: center; height: calc(220 * var(--u)); }
    }
  `;
  document.head.append(style);
}
