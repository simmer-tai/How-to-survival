// マルチプレイの進め方。部屋を作った人（ホスト）のブラウザが世界の正しい状態を持ち、参加者はホストとだけやりとりする
// （つなぎ方は link.ts。部屋コードで PeerJS の WebRTC につなぐ）。
// - 共有ワールドの変更：参加者は頼み（WorldRequest）をホストへ送り、ホストが確かめてコマンドにして、全員が同じように適用する
// - 物理で動く物（落とし物・倒れた木）の位置と、ワールドの時刻は、ホストがときどき配る
// - 自分の様子（位置・持ち物など）は各自が送り、ホストがほかの人へ配る
import { toLook } from '../player/avatar.js';
import { GuestLink, HostLink } from './link.js';
const POSE_INTERVAL = 1 / 15; // 自分の様子を送る間隔（秒）
const MOTION_INTERVAL = 0.1; // ホストが落とし物・倒れた木の動きを配る間隔（秒）
const CLOCK_INTERVAL = 2; // ホストがワールドの時刻を配る間隔（秒）
const NAME_MAX = 16; // 名前の長さの上限
const DEFAULT_NAME = 'だれか';
/** 名前を、送ってよい長さの文字列にする */
export function cleanName(name) {
    return (typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '') || DEFAULT_NAME;
}
/** 送る数を小数点以下 digits 桁に丸める（メッセージを小さくする） */
function round(v, digits) {
    const k = 10 ** digits;
    return Math.round(v * k) / k;
}
export class Multiplayer {
    hooks;
    others;
    role = 'solo';
    /** 自分の番号（ひとりで遊ぶとき・ホストは 0） */
    myId = 0;
    /** 部屋を開いているワールド（ひとりのときは null） */
    world = null;
    /** 部屋コード（友達はこれを入れて参加する。ひとりのときは null） */
    code = null;
    me = { name: DEFAULT_NAME, look: toLook(null) };
    /** ホストのときの部屋 */
    hostLink = null;
    /** 参加者のときの、ホストとのつながり */
    guestLink = null;
    /** 部屋にいる、自分以外の人 */
    peers = new Map();
    /** 参加者：ホストへ送って、まだ返事のない頼み（断られたら元に戻すのに使う） */
    pending = new Map();
    nextReq = 0;
    /** 参加者：世界をまるごと受け取ってから、ゲームが組み上がるまで、届いたメッセージをためておく */
    queue = null;
    poseTimer = 0;
    motionTimer = 0;
    clockTimer = 0;
    /** 人が入った */
    onJoin = () => { };
    /** 人が抜けた */
    onLeave = () => { };
    /** 部屋とのつながりが切れた（参加者のとき。ホストが部屋を閉じた・ホストとの通信が切れた） */
    onClosed = () => { };
    constructor(hooks, others) {
        this.hooks = hooks;
        this.others = others;
    }
    /** マルチで遊んでいるか */
    get online() {
        return this.role !== 'solo';
    }
    /** 世界の時間を進める・時間で変わる物を決めるのは自分か（ひとりで遊ぶときとホスト） */
    get authority() {
        return this.role !== 'guest';
    }
    /** 部屋にいる人の名前（自分が先頭） */
    get names() {
        return [this.me.name, ...[...this.peers.values()].sort((a, b) => a.id - b.id).map((p) => p.name)];
    }
    get mePeer() {
        return { id: this.myId, name: this.me.name, look: this.me.look };
    }
    // ---- 部屋を開く・参加する ----
    /** 遊んでいるワールドで部屋を開き、部屋コードを決める。開けなければ Error で失敗する */
    async host(world, me) {
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
    async join(code, me) {
        const { link, id } = await GuestLink.join(code);
        this.guestLink = link;
        this.role = 'guest';
        this.myId = id;
        this.code = code;
        this.me = { name: cleanName(me.name), look: me.look };
        return new Promise((resolve, reject) => {
            // 世界をまるごと受け取る前に届いたコマンドは、受け取る状態にもう入っているので捨てる
            link.onMessage = (raw) => {
                const msg = raw;
                if (msg.t === 'hostLeft')
                    return reject(new Error('部屋が閉じられました'));
                if (msg.t !== 'world')
                    return;
                this.world = msg.world;
                for (const p of msg.peers)
                    if (p.id !== this.myId)
                        this.addPeer(p);
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
    ready() {
        const queue = this.queue ?? [];
        this.queue = null;
        for (const msg of queue)
            this.handleHost(msg);
    }
    /** 部屋から抜ける（ホストなら部屋を閉じる） */
    leave() {
        const links = [this.hostLink, this.guestLink];
        this.reset();
        for (const link of links)
            link?.close();
    }
    // ---- 共有ワールドへの頼み ----
    /**
     * 頼みを出す（main の requestWorld）。by は頼んだ人（省くと自分。null は世界が出す頼み）。
     * ひとりのとき・ホストは、その場で確かめて適用する（ホストは全員にも配る）。
     * 参加者は手元で確かめてからホストへ送り、送れたら true（世界が出す頼みは、ホストのものだけを使うので出さない）
     */
    request(req, by = this.myId) {
        if (this.role === 'guest') {
            if (by !== this.myId || !this.guestLink || !this.hooks.authorize(req, by))
                return false;
            const n = this.nextReq++;
            this.pending.set(n, req);
            this.guestLink.send({ t: 'req', n, req });
            return true;
        }
        const cmd = this.hooks.authorize(req, by);
        if (!cmd)
            return false;
        this.publish(cmd, by);
        return true;
    }
    /** ホスト（ひとりのときも）：コマンドを全員に配ってから、自分でも適用する（適用の途中で出た頼みは、このあとに配られる） */
    publish(cmd, by, n) {
        if (this.role === 'host')
            this.toAll({ t: 'cmd', cmd, by, ...(n !== undefined ? { n } : {}) });
        this.hooks.apply(cmd, by);
    }
    // ---- 自分の様子 ----
    /** 毎フレーム呼ぶ。pose は自分の様子（ワールドにいなければ null）。決まった間隔で送る */
    update(dt, pose) {
        if (!this.online)
            return;
        this.poseTimer += dt;
        if (pose && this.poseTimer >= POSE_INTERVAL) {
            this.poseTimer = 0;
            if (this.role === 'host')
                this.toAll({ t: 'pose', id: this.myId, pose });
            else
                this.guestLink?.send({ t: 'pose', pose });
        }
        if (this.role !== 'host' || this.peers.size === 0)
            return;
        this.motionTimer += dt;
        if (this.motionTimer >= MOTION_INTERVAL) {
            this.motionTimer = 0;
            const { drops, trees, isles = [] } = this.hooks.motion();
            const pack = (list) => list.map((row) => row.map((v, i) => (i === 0 ? v : round(v, 3))));
            const moving = isles.filter(([, d, t]) => d.length > 0 || t.length > 0).map(([i, d, t]) => [i, pack(d), pack(t)]);
            if (drops.length > 0 || trees.length > 0 || moving.length > 0)
                this.toAll({ t: 'motion', drops: pack(drops), trees: pack(trees), isles: moving });
        }
        this.clockTimer += dt;
        if (this.clockTimer >= CLOCK_INTERVAL) {
            this.clockTimer = 0;
            this.toAll({ t: 'clock', minutes: this.hooks.minutes() });
        }
    }
    /** 道具を振った（ほかの人の画面でも体が振る） */
    swing(kind) {
        if (this.role === 'host')
            this.toAll({ t: 'swing', id: this.myId, kind });
        else if (this.role === 'guest')
            this.guestLink?.send({ t: 'swing', kind });
    }
    /** 見た目を変えた */
    setLook(look) {
        this.me = { ...this.me, look };
        if (this.role === 'host')
            this.toAll({ t: 'peer', peer: this.mePeer });
        else if (this.role === 'guest')
            this.guestLink?.send({ t: 'look', look });
    }
    // ---- 届いたメッセージ ----
    /** ホスト：参加者から届いたもの */
    fromGuest({ from, data }) {
        switch (data.t) {
            case 'hello': {
                const peer = { id: from, name: cleanName(data.name), look: toLook(data.look) };
                const fresh = !this.peers.has(from);
                this.addPeer(peer);
                if (!fresh)
                    return;
                // 入ってきた人に世界をまるごと送り、ほかの人には入ってきたことを知らせる
                const peers = [this.mePeer, ...[...this.peers.values()].filter((p) => p.id !== from)];
                this.toOne(from, { t: 'world', you: from, world: this.world, data: this.hooks.shared(), peers });
                this.toAll({ t: 'peer', peer }, from);
                this.onJoin(peer.name);
                return;
            }
            case 'leave': {
                const peer = this.peers.get(from);
                if (!peer)
                    return;
                this.removePeer(from);
                this.hooks.left(from);
                this.toAll({ t: 'gone', id: from });
                this.onLeave(peer.name);
                return;
            }
            case 'req': {
                if (!this.peers.has(from))
                    return;
                const cmd = this.hooks.authorize(data.req, from);
                if (cmd)
                    this.publish(cmd, from, data.n);
                else
                    this.toOne(from, { t: 'reject', n: data.n });
                return;
            }
            case 'pose':
                if (!this.peers.has(from))
                    return;
                this.takePose(from, data.pose);
                this.toAll({ t: 'pose', id: from, pose: data.pose }, from);
                return;
            case 'look': {
                const peer = this.peers.get(from);
                if (!peer)
                    return;
                peer.look = toLook(data.look);
                this.others.set(from, peer.name, peer.look);
                this.toAll({ t: 'peer', peer }, from);
                return;
            }
            case 'swing':
                if (!this.peers.has(from))
                    return;
                this.others.swing(from, data.kind);
                this.toAll({ t: 'swing', id: from, kind: data.kind }, from);
                return;
        }
    }
    /** 参加者：ホスト（とサーバー）から届いたもの。ゲームが組み上がるまではためておく */
    fromHost(msg) {
        if (msg.t === 'hostLeft')
            return this.closed();
        if (msg.t === 'welcome' || msg.t === 'error')
            return;
        if (this.queue)
            this.queue.push(msg);
        else
            this.handleHost(msg);
    }
    handleHost(msg) {
        switch (msg.t) {
            case 'cmd':
                if (msg.by === this.myId && msg.n !== undefined)
                    this.pending.delete(msg.n);
                this.hooks.apply(msg.cmd, msg.by);
                return;
            case 'reject': {
                const req = this.pending.get(msg.n);
                this.pending.delete(msg.n);
                if (req)
                    this.hooks.undo(req);
                return;
            }
            case 'clock':
                if (Number.isFinite(msg.minutes))
                    this.hooks.setMinutes(msg.minutes);
                return;
            case 'motion':
                this.hooks.setMotion(msg);
                return;
            case 'pose':
                if (msg.id !== this.myId)
                    this.takePose(msg.id, msg.pose);
                return;
            case 'peer': {
                if (msg.peer.id === this.myId)
                    return;
                const fresh = !this.peers.has(msg.peer.id);
                this.addPeer(msg.peer);
                if (fresh)
                    this.onJoin(msg.peer.name);
                return;
            }
            case 'gone': {
                const peer = this.peers.get(msg.id);
                this.removePeer(msg.id);
                if (peer)
                    this.onLeave(peer.name);
                return;
            }
            case 'swing':
                this.others.swing(msg.id, msg.kind);
                return;
        }
    }
    takePose(id, pose) {
        this.others.setPose(id, pose);
        if (pose.boat)
            this.hooks.followBoat(...pose.boat);
    }
    addPeer(peer) {
        const p = { id: peer.id, name: cleanName(peer.name), look: toLook(peer.look) };
        this.peers.set(p.id, p);
        this.others.set(p.id, p.name, p.look);
    }
    removePeer(id) {
        this.peers.delete(id);
        this.others.remove(id);
    }
    /** つながりが切れた */
    closed() {
        if (!this.online)
            return;
        this.reset();
        this.onClosed();
    }
    reset() {
        this.hostLink = null;
        this.guestLink = null;
        this.role = 'solo';
        this.peers.clear();
        this.pending.clear();
        this.others.clear();
        this.queue = null;
    }
    toAll(data, except) {
        this.hostLink?.send({ to: 'all', ...(except !== undefined ? { except } : {}), data });
    }
    toOne(id, data) {
        this.hostLink?.send({ to: id, data });
    }
}
