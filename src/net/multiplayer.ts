// マルチプレイの進め方。部屋を作った人（ホスト）のブラウザが世界の正しい状態を持ち、参加者はホストとだけやりとりする
// （つなぎ方は link.ts。部屋コードで PeerJS の WebRTC につなぐ）。
// - 共有ワールドの変更：参加者は頼み（WorldRequest）をホストへ送り、ホストが確かめてコマンドにして、全員が同じように適用する
// - 物理で動く物（落とし物・倒れた木）の位置と、ワールドの時刻は、ホストがときどき配る
// - 自分の様子（位置・持ち物など）は各自が送り、ホストがほかの人へ配る

import type { WorldCommand, WorldRequest } from '../core/commands.js';
import type { SharedWorld } from '../core/save.js';
import { toLook, type AvatarLook, type AvatarSwing } from '../player/avatar.js';
import type { OtherPlayers } from '../player/others.js';
import { GuestLink, HostLink } from './link.js';
import type { FromGuest, HostMsg, Motion, PeerInfo, PoseMsg, RoomWorld, ServerMsg } from './protocol.js';

const POSE_INTERVAL = 1 / 15; // 自分の様子を送る間隔（秒）
const MOTION_INTERVAL = 0.1; // ホストが落とし物・倒れた木の動きを配る間隔（秒）
const CLOCK_INTERVAL = 2; // ホストがワールドの時刻を配る間隔（秒）
const NAME_MAX = 16; // 名前の長さの上限
const DEFAULT_NAME = 'だれか';

/** solo：ひとりで遊んでいる、host：部屋を開いている、guest：ほかの人の部屋に参加している */
export type Role = 'solo' | 'host' | 'guest';

/** 自分の名前と見た目 */
export interface Me { name: string; look: AvatarLook }

/** ゲームの世界とのつなぎ（main が渡す） */
export interface WorldHooks {
  /** 頼みを確かめてコマンドにする（by は頼んだ人。できなければ null） */
  authorize(req: WorldRequest, by: number | null): WorldCommand | null;
  /** コマンドを適用する（by は頼んだ人。自分なら、採れた物などを自分のインベントリに入れる） */
  apply(cmd: WorldCommand, by: number | null): void;
  /** 参加者：自分の頼みをホストに断られたので、先に減らした持ち物などを戻す */
  undo(req: WorldRequest): void;
  /** ホスト：共有ワールドのまるごとの状態（途中参加した人に送る） */
  shared(): SharedWorld;
  /** ホスト：物理で動いている物の位置 */
  motion(): Motion;
  /** 参加者：ホストから届いた、物理で動いている物の位置に合わせる */
  setMotion(motion: Motion): void;
  /** ホスト：ワールドの時刻 */
  minutes(): number;
  /** 参加者：ホストから届いたワールドの時刻に合わせる */
  setMinutes(minutes: number): void;
  /** ほかの人が漕いでいる船の位置 */
  followBoat(bid: number, x: number, z: number, yaw: number): void;
  /** ホスト：人が抜けた（乗っていた船を降ろすなど） */
  left(id: number): void;
}

/** 名前を、送ってよい長さの文字列にする */
export function cleanName(name: unknown): string {
  return (typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '') || DEFAULT_NAME;
}

/** 送る数を小数点以下 digits 桁に丸める（メッセージを小さくする） */
function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

export class Multiplayer {
  role: Role = 'solo';
  /** 自分の番号（ひとりで遊ぶとき・ホストは 0） */
  myId = 0;
  /** 部屋を開いているワールド（ひとりのときは null） */
  world: RoomWorld | null = null;
  /** 部屋コード（友達はこれを入れて参加する。ひとりのときは null） */
  code: string | null = null;
  private me: Me = { name: DEFAULT_NAME, look: toLook(null) };
  /** ホストのときの部屋 */
  private hostLink: HostLink | null = null;
  /** 参加者のときの、ホストとのつながり */
  private guestLink: GuestLink | null = null;
  /** 部屋にいる、自分以外の人 */
  private readonly peers = new Map<number, PeerInfo>();
  /** 参加者：ホストへ送って、まだ返事のない頼み（断られたら元に戻すのに使う） */
  private readonly pending = new Map<number, WorldRequest>();
  private nextReq = 0;
  /** 参加者：世界をまるごと受け取ってから、ゲームが組み上がるまで、届いたメッセージをためておく */
  private queue: HostMsg[] | null = null;
  private poseTimer = 0;
  private motionTimer = 0;
  private clockTimer = 0;

  /** 人が入った */
  onJoin: (name: string) => void = () => {};
  /** 人が抜けた */
  onLeave: (name: string) => void = () => {};
  /** 部屋とのつながりが切れた（参加者のとき。ホストが部屋を閉じた・ホストとの通信が切れた） */
  onClosed: () => void = () => {};

  constructor(
    private readonly hooks: WorldHooks,
    private readonly others: OtherPlayers,
  ) {}

  /** マルチで遊んでいるか */
  get online(): boolean {
    return this.role !== 'solo';
  }

  /** 世界の時間を進める・時間で変わる物を決めるのは自分か（ひとりで遊ぶときとホスト） */
  get authority(): boolean {
    return this.role !== 'guest';
  }

  /** 部屋にいる人の名前（自分が先頭） */
  get names(): string[] {
    return [this.me.name, ...[...this.peers.values()].sort((a, b) => a.id - b.id).map((p) => p.name)];
  }

  private get mePeer(): PeerInfo {
    return { id: this.myId, name: this.me.name, look: this.me.look };
  }

  // ---- 部屋を開く・参加する ----

  /** 遊んでいるワールドで部屋を開き、部屋コードを決める。開けなければ Error で失敗する */
  async host(world: RoomWorld, me: Me): Promise<void> {
    const link = await HostLink.open();
    this.hostLink = link;
    this.role = 'host';
    this.myId = 0;
    this.world = world;
    this.code = link.code;
    this.me = { name: cleanName(me.name), look: me.look };
    link.onMessage = (msg) => this.fromGuest(msg);
    link.onClose = () => this.closed();
  }

  /**
   * 部屋コードの部屋に参加し、共有ワールドのまるごとの状態を受け取る。参加できなければ Error で失敗する。
   * 受け取った状態でゲームを組み上げたら ready() を呼ぶ（それまでに届いたコマンドなどはためておく）
   */
  async join(code: string, me: Me): Promise<{ world: RoomWorld; data: SharedWorld }> {
    const { link, id } = await GuestLink.join(code);
    this.guestLink = link;
    this.role = 'guest';
    this.myId = id;
    this.code = code;
    this.me = { name: cleanName(me.name), look: me.look };
    return new Promise((resolve, reject) => {
      // 世界をまるごと受け取る前に届いたコマンドは、受け取る状態にもう入っているので捨てる
      link.onMessage = (raw) => {
        const msg = raw as HostMsg | ServerMsg;
        if (msg.t === 'hostLeft') return reject(new Error('部屋が閉じられました'));
        if (msg.t !== 'world') return;
        this.world = msg.world;
        for (const p of msg.peers) if (p.id !== this.myId) this.addPeer(p);
        this.queue = [];
        link.onMessage = (next) => this.fromHost(next);
        link.onClose = () => this.closed();
        resolve({ world: msg.world, data: msg.data });
      };
      link.onClose = () => reject(new Error('サーバーとのつながりが切れました'));
      link.send({ t: 'hello', name: this.me.name, look: this.me.look });
    });
  }

  /** 参加者：ゲームを組み上げ終えた。ためておいたメッセージを処理し、あとは届いたらすぐ処理する */
  ready(): void {
    const queue = this.queue ?? [];
    this.queue = null;
    for (const msg of queue) this.handleHost(msg);
  }

  /** 部屋から抜ける（ホストなら部屋を閉じる） */
  leave(): void {
    const links = [this.hostLink, this.guestLink];
    this.reset();
    for (const link of links) link?.close();
  }

  // ---- 共有ワールドへの頼み ----

  /**
   * 頼みを出す（main の requestWorld）。by は頼んだ人（省くと自分。null は世界が出す頼み）。
   * ひとりのとき・ホストは、その場で確かめて適用する（ホストは全員にも配る）。
   * 参加者は手元で確かめてからホストへ送り、送れたら true（世界が出す頼みは、ホストのものだけを使うので出さない）
   */
  request(req: WorldRequest, by: number | null = this.myId): boolean {
    if (this.role === 'guest') {
      if (by !== this.myId || !this.guestLink || !this.hooks.authorize(req, by)) return false;
      const n = this.nextReq++;
      this.pending.set(n, req);
      this.guestLink.send({ t: 'req', n, req });
      return true;
    }
    const cmd = this.hooks.authorize(req, by);
    if (!cmd) return false;
    this.publish(cmd, by);
    return true;
  }

  /** ホスト（ひとりのときも）：コマンドを全員に配ってから、自分でも適用する（適用の途中で出た頼みは、このあとに配られる） */
  private publish(cmd: WorldCommand, by: number | null, n?: number): void {
    if (this.role === 'host') this.toAll({ t: 'cmd', cmd, by, ...(n !== undefined ? { n } : {}) });
    this.hooks.apply(cmd, by);
  }

  // ---- 自分の様子 ----

  /** 毎フレーム呼ぶ。pose は自分の様子（ワールドにいなければ null）。決まった間隔で送る */
  update(dt: number, pose: PoseMsg | null): void {
    if (!this.online) return;
    this.poseTimer += dt;
    if (pose && this.poseTimer >= POSE_INTERVAL) {
      this.poseTimer = 0;
      if (this.role === 'host') this.toAll({ t: 'pose', id: this.myId, pose });
      else this.guestLink?.send({ t: 'pose', pose });
    }
    if (this.role !== 'host' || this.peers.size === 0) return;
    this.motionTimer += dt;
    if (this.motionTimer >= MOTION_INTERVAL) {
      this.motionTimer = 0;
      const { drops, trees } = this.hooks.motion();
      const pack = (list: number[][]) => list.map((row) => row.map((v, i) => (i === 0 ? v : round(v, 3))));
      if (drops.length > 0 || trees.length > 0) this.toAll({ t: 'motion', drops: pack(drops), trees: pack(trees) });
    }
    this.clockTimer += dt;
    if (this.clockTimer >= CLOCK_INTERVAL) {
      this.clockTimer = 0;
      this.toAll({ t: 'clock', minutes: this.hooks.minutes() });
    }
  }

  /** 道具を振った（ほかの人の画面でも体が振る） */
  swing(kind: AvatarSwing): void {
    if (this.role === 'host') this.toAll({ t: 'swing', id: this.myId, kind });
    else if (this.role === 'guest') this.guestLink?.send({ t: 'swing', kind });
  }

  /** 見た目を変えた */
  setLook(look: AvatarLook): void {
    this.me = { ...this.me, look };
    if (this.role === 'host') this.toAll({ t: 'peer', peer: this.mePeer });
    else if (this.role === 'guest') this.guestLink?.send({ t: 'look', look });
  }

  // ---- 届いたメッセージ ----

  /** ホスト：参加者から届いたもの */
  private fromGuest({ from, data }: FromGuest): void {
    switch (data.t) {
      case 'hello': {
        const peer: PeerInfo = { id: from, name: cleanName(data.name), look: toLook(data.look) };
        const fresh = !this.peers.has(from);
        this.addPeer(peer);
        if (!fresh) return;
        // 入ってきた人に世界をまるごと送り、ほかの人には入ってきたことを知らせる
        const peers = [this.mePeer, ...[...this.peers.values()].filter((p) => p.id !== from)];
        this.toOne(from, { t: 'world', you: from, world: this.world!, data: this.hooks.shared(), peers });
        this.toAll({ t: 'peer', peer }, from);
        this.onJoin(peer.name);
        return;
      }
      case 'leave': {
        const peer = this.peers.get(from);
        if (!peer) return;
        this.removePeer(from);
        this.hooks.left(from);
        this.toAll({ t: 'gone', id: from });
        this.onLeave(peer.name);
        return;
      }
      case 'req': {
        if (!this.peers.has(from)) return;
        const cmd = this.hooks.authorize(data.req, from);
        if (cmd) this.publish(cmd, from, data.n);
        else this.toOne(from, { t: 'reject', n: data.n });
        return;
      }
      case 'pose':
        if (!this.peers.has(from)) return;
        this.takePose(from, data.pose);
        this.toAll({ t: 'pose', id: from, pose: data.pose }, from);
        return;
      case 'look': {
        const peer = this.peers.get(from);
        if (!peer) return;
        peer.look = toLook(data.look);
        this.others.set(from, peer.name, peer.look);
        this.toAll({ t: 'peer', peer }, from);
        return;
      }
      case 'swing':
        if (!this.peers.has(from)) return;
        this.others.swing(from, data.kind);
        this.toAll({ t: 'swing', id: from, kind: data.kind }, from);
        return;
    }
  }

  /** 参加者：ホスト（とサーバー）から届いたもの。ゲームが組み上がるまではためておく */
  private fromHost(msg: HostMsg | ServerMsg): void {
    if (msg.t === 'hostLeft') return this.closed();
    if (msg.t === 'welcome' || msg.t === 'error') return;
    if (this.queue) this.queue.push(msg);
    else this.handleHost(msg);
  }

  private handleHost(msg: HostMsg): void {
    switch (msg.t) {
      case 'cmd':
        if (msg.by === this.myId && msg.n !== undefined) this.pending.delete(msg.n);
        this.hooks.apply(msg.cmd, msg.by);
        return;
      case 'reject': {
        const req = this.pending.get(msg.n);
        this.pending.delete(msg.n);
        if (req) this.hooks.undo(req);
        return;
      }
      case 'clock':
        if (Number.isFinite(msg.minutes)) this.hooks.setMinutes(msg.minutes);
        return;
      case 'motion':
        this.hooks.setMotion(msg);
        return;
      case 'pose':
        if (msg.id !== this.myId) this.takePose(msg.id, msg.pose);
        return;
      case 'peer': {
        if (msg.peer.id === this.myId) return;
        const fresh = !this.peers.has(msg.peer.id);
        this.addPeer(msg.peer);
        if (fresh) this.onJoin(msg.peer.name);
        return;
      }
      case 'gone': {
        const peer = this.peers.get(msg.id);
        this.removePeer(msg.id);
        if (peer) this.onLeave(peer.name);
        return;
      }
      case 'swing':
        this.others.swing(msg.id, msg.kind);
        return;
    }
  }

  private takePose(id: number, pose: PoseMsg): void {
    this.others.setPose(id, pose);
    if (pose.boat) this.hooks.followBoat(...pose.boat);
  }

  private addPeer(peer: PeerInfo): void {
    const p = { id: peer.id, name: cleanName(peer.name), look: toLook(peer.look) };
    this.peers.set(p.id, p);
    this.others.set(p.id, p.name, p.look);
  }

  private removePeer(id: number): void {
    this.peers.delete(id);
    this.others.remove(id);
  }

  /** つながりが切れた */
  private closed(): void {
    if (!this.online) return;
    this.reset();
    this.onClosed();
  }

  private reset(): void {
    this.hostLink = null;
    this.guestLink = null;
    this.role = 'solo';
    this.peers.clear();
    this.pending.clear();
    this.others.clear();
    this.queue = null;
  }

  private toAll(data: HostMsg, except?: number): void {
    this.hostLink?.send({ to: 'all', ...(except !== undefined ? { except } : {}), data });
  }

  private toOne(id: number, data: HostMsg): void {
    this.hostLink?.send({ to: id, data });
  }
}
