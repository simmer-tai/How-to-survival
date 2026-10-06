// 部屋のつながり。PeerJS（WebRTC）でブラウザ同士を直接つなぐ。
// 部屋を開いた人（ホスト）のブラウザは「部屋コード」から決まる ID で PeerJS の無料サーバーに名乗り、
// 参加者はその ID へつなぐ。PeerJS のサーバーが受け持つのはつなぐ瞬間だけで、ゲームのデータはブラウザ同士で直接送る。
// 参加者どうしはつながず、いつもホストを通す（ホストが世界の正しい状態を持つ）

import { Peer, type DataConnection } from 'peerjs';
import type { FromGuest, GuestMsg, HostMsg, ServerMsg, ToGuests } from './protocol.js';

const ID_PREFIX = 'warfarming-island-'; // PeerJS のサーバーでほかのアプリの ID とぶつからないように付ける
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 部屋コードに使う文字（0 と O、1 と I は見分けにくいので使わない）
const CODE_LENGTH = 5; // 部屋コードの長さ
const CODE_TRIES = 5; // 部屋コードがほかの部屋と重なったときに、作り直す回数
const MAX_GUESTS = 7; // 参加できる人数（ホストのほかに）
const CONNECT_TIMEOUT = 20000; // つながるまで待つ時間（ms）
const PIECE = 5000; // 1回に送る文字数。長いメッセージ（世界のまるごとの状態など）は分けて送る（WebRTC は約16KBを超えると届かないことがある。日本語は1文字3バイト）

/** 部屋コードを、打ちまちがえにくい形（大文字・余計な文字なし）にする */
export function cleanCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

/**
 * 1本のつながりの上で、JSON を文字列にして送り合う。長いものは分けて送り、受け取る側でつなぎ直す。
 * 分けたものは「~番号,何番目,全部の数|中身」の形で送る
 */
class Wire {
  private nextPack = 0;
  private readonly packs = new Map<number, string[]>();

  constructor(
    readonly conn: DataConnection,
    onMessage: (msg: unknown) => void,
  ) {
    conn.on('data', (raw) => {
      if (typeof raw !== 'string') return;
      const text = this.join(raw);
      if (text === null) return;
      try {
        onMessage(JSON.parse(text));
      } catch (err) {
        console.error('受け取ったメッセージを読めませんでした', err);
      }
    });
  }

  send(data: object): void {
    if (!this.conn.open) return;
    const text = JSON.stringify(data);
    if (text.length <= PIECE) {
      this.conn.send(text);
      return;
    }
    const id = this.nextPack++;
    const n = Math.ceil(text.length / PIECE);
    for (let i = 0; i < n; i++) this.conn.send(`~${id},${i},${n}|${text.slice(i * PIECE, (i + 1) * PIECE)}`);
  }

  /** 届いた1つを、メッセージにする。分けて送られた途中なら null */
  private join(raw: string): string | null {
    if (!raw.startsWith('~')) return raw;
    const bar = raw.indexOf('|');
    const [id, i, n] = raw.slice(1, bar).split(',').map(Number);
    let parts = this.packs.get(id);
    if (!parts) this.packs.set(id, (parts = new Array<string>(n)));
    parts[i] = raw.slice(bar + 1);
    if (parts.filter((p) => p !== undefined).length < n) return null;
    this.packs.delete(id);
    return parts.join('');
  }
}

/** PeerJS のエラーを、画面に出す文にする */
function describe(err: { type?: string }): string {
  switch (err.type) {
    case 'peer-unavailable':
      return '部屋が見つかりません（部屋コードを確かめてください。ホストが部屋を閉じたかもしれません）';
    case 'browser-incompatible':
      return 'このブラウザはマルチプレイに対応していません';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'つなぎ役のサーバー（PeerJS）につなげませんでした。インターネットにつながっているか確かめてください';
    default:
      return 'つなげませんでした';
  }
}

/** PeerJS の初期化が終わるのを待つ（名乗った ID を返す） */
function whenOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('つなぎ役のサーバー（PeerJS）から返事がありません')), CONNECT_TIMEOUT);
    peer.once('open', (id) => {
      clearTimeout(timer);
      resolve(id);
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** ホストの部屋。参加者が来るのを待ち、参加者ごとに番号（1 から）を付ける。ホスト自身は 0 */
export class HostLink {
  /** 参加者から届いたもの（入った・抜けたも、ここで知らせる） */
  onMessage: (msg: FromGuest) => void = () => {};
  /** 部屋が使えなくなった（今は起きない。つなぎ役のサーバーから切れても、つないだ人とはそのまま遊べる） */
  onClose: () => void = () => {};
  private readonly guests = new Map<number, Wire>();
  private nextId = 1;

  private constructor(
    private readonly peer: Peer,
    /** 部屋コード */
    readonly code: string,
  ) {
    peer.on('connection', (conn) => this.accept(conn));
    // つなぎ役のサーバーから切れても、つないでいる人とはそのまま遊べる。新しく参加できるように、つなぎ直す
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => console.warn('PeerJS', err.type, err));
  }

  /** 部屋を開き、部屋コードを決める。開けなければ Error で失敗する */
  static async open(): Promise<HostLink> {
    for (let tries = 0; tries < CODE_TRIES; tries++) {
      const code = randomCode();
      const peer = new Peer(ID_PREFIX + code);
      try {
        await whenOpen(peer);
        return new HostLink(peer, code);
      } catch (err) {
        peer.destroy();
        if ((err as { type?: string }).type === 'unavailable-id') continue; // ほかの部屋と同じコードだったので作り直す
        throw new Error(err instanceof Error && !(err as { type?: string }).type ? err.message : describe(err as { type?: string }));
      }
    }
    throw new Error('部屋コードを決められませんでした');
  }

  private accept(conn: DataConnection): void {
    conn.on('open', () => {
      if (this.guests.size >= MAX_GUESTS) {
        conn.send(JSON.stringify({ t: 'error', reason: 'full' } satisfies ServerMsg));
        setTimeout(() => conn.close(), 500);
        return;
      }
      const id = this.nextId++;
      const wire = new Wire(conn, (data) => this.onMessage({ from: id, data: data as GuestMsg }));
      this.guests.set(id, wire);
      wire.send({ t: 'welcome', id } satisfies ServerMsg);
      this.onMessage({ from: id, data: { t: 'join' } });
      const gone = () => {
        if (this.guests.get(id) !== wire) return;
        this.guests.delete(id);
        this.onMessage({ from: id, data: { t: 'leave' } });
      };
      conn.on('close', gone);
      conn.on('error', gone);
      // ブラウザごと落ちたときなど、close が来ないことがあるので、つながりの状態も見る
      conn.on('iceStateChanged', (state) => {
        if (state === 'failed' || state === 'closed') gone();
      });
    });
  }

  /** to の人へ送る（'all' なら except 以外の全員） */
  send({ to, except, data }: ToGuests): void {
    if (to === 'all') {
      for (const [id, wire] of this.guests) if (id !== except) wire.send(data);
    } else {
      this.guests.get(to)?.send(data);
    }
  }

  /** 部屋を閉じる（参加者には閉じたことを知らせる） */
  close(): void {
    for (const wire of this.guests.values()) wire.send({ t: 'hostLeft' } satisfies ServerMsg);
    this.guests.clear();
    setTimeout(() => this.peer.destroy(), 200); // 知らせが届くのを少し待つ
  }
}

/** 参加者のつながり（ホストとだけつながる） */
export class GuestLink {
  /** ホストから届いたもの */
  onMessage: (msg: HostMsg | ServerMsg) => void = () => {};
  /** ホストとのつながりが切れた */
  onClose: () => void = () => {};
  private closed = false;

  private constructor(
    private readonly peer: Peer,
    private readonly wire: Wire,
  ) {
    const lost = () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose();
    };
    wire.conn.on('close', lost);
    wire.conn.on('iceStateChanged', (state) => {
      if (state === 'failed' || state === 'closed') lost(); // disconnected はすぐ戻ることがあるので待つ
    });
  }

  /** 部屋コードの部屋に参加し、自分の番号を受け取る。参加できなければ Error で失敗する */
  static async join(code: string): Promise<{ link: GuestLink; id: number }> {
    const peer = new Peer();
    try {
      await whenOpen(peer);
    } catch (err) {
      peer.destroy();
      throw new Error(err instanceof Error && !(err as { type?: string }).type ? err.message : describe(err as { type?: string }));
    }
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (message: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('ホストから返事がありません（部屋コードを確かめてください）'), CONNECT_TIMEOUT);
      peer.on('error', (err) => fail(describe(err)));
      const conn = peer.connect(ID_PREFIX + cleanCode(code), { reliable: true, serialization: 'raw' });
      let link: GuestLink | null = null;
      const wire = new Wire(conn, (raw) => {
        const msg = raw as HostMsg | ServerMsg;
        if (link) return link.onMessage(msg);
        if (msg.t === 'welcome') {
          done = true;
          clearTimeout(timer);
          link = new GuestLink(peer, wire);
          resolve({ link, id: msg.id });
        } else if (msg.t === 'error') {
          fail(msg.reason === 'full' ? '部屋がいっぱいです' : 'つなげませんでした');
        }
      });
      conn.on('close', () => fail('部屋に入れませんでした'));
    });
  }

  send(data: GuestMsg): void {
    this.wire.send(data);
  }

  close(): void {
    this.closed = true;
    this.wire.conn.close();
    setTimeout(() => this.peer.destroy(), 200);
  }
}
