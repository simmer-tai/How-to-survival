import * as THREE from 'three';
import { BOAT_SCALE, boatObject, floatPose } from '../actions/boats.js';
import { BOAT_SEAT } from '../items/itemModels.js';
import { Avatar, DEFAULT_LOOK } from '../player/avatar.js';
import { SEA_FLOOR, WORLD_SIZE } from '../world/terrain.js';
import { bakeSeabed } from '../world/water.js';
// 船旅：海図で行き先を選んでから着くまでの間に出す、船で海を渡っている場面（ロード画面）。
// 暗転している間に船のワールドコマンド（sailBoat）を出し、着いた場所へ切り替わって（マルチではホストの返事を待って）、
// 行き先のシェーダーを用意し終えるまで、自分の船が沖を進むところを描き続ける。
// 描くのはゲームの本当のシーンで、海・空・光はそのまま使い、島や桟橋などの物は描く間だけ隠す。
// 船は浮かべた船と同じ見た目、漕ぐ人は自分のアバターで、波も同じ式で揺れる。海底は深い海にして浅瀬の色を消す
// ---- 流れ ----
const FADE_TIME = 0.5; // 暗転・明けるのにかかる時間（秒）
const SAIL_TIME = 5.5; // 船旅のいちばん短い長さ（秒。準備が早く終わっても、ここまでは見せる）
const WAIT_CAP = 0.9; // 着く準備ができるまで、進み具合はここで止めて待つ
const FINISH_TIME = 1.2; // 準備ができてから、残りの進み具合を進めきるのにかかる時間（秒）
const GIVE_UP = 15; // これだけ待っても着かなければ（ホストに断られた）、船旅をやめて元の場所へ戻る（秒）
const ARRIVE_HOLD = 0.6; // 着いた場所を暗いまま描いてから明けるまでの時間（最初の数フレームの引っかかりを隠す）
// ---- 船の進み方 ----
const SAIL_SPEED = 5; // 船の速さ（m/s）
const PATH_RADIUS = 80; // 原点のまわりの、この半径の大きな円を回って進む（波が消える沖まで出ないように）
const SIT_DROP = 0.9; // 座り板から足元までの高さ（座り板から目まで 0.8m、目から足元まで 1.7m。boats.ts・player.ts と同じ）
// ---- 視点 ----
const CAM_DIST = 8; // 船からカメラまでの距離（m）
const CAM_INTRO = 13; // 明けたときの距離（ここから CAM_DIST まで寄っていく）
const CAM_INTRO_TIME = 3; // 寄りきるまでの時間（秒）
const CAM_HEIGHT = 2.6; // カメラの水面からの高さ
const CAM_ANGLE = 0.8; // カメラの向きの真ん中（ラジアン。0 で真後ろ、π/2 で真横）
const CAM_SWING = 0.45; // カメラがゆっくり回り込む大きさ
const CAM_SWING_SPEED = 0.11; // 回り込む速さ（ラジアン/秒）
const CAM_AHEAD = 2.5; // 船の中心より、これだけ前を見る
// ---- 進み具合の線 ----
const BAR_HEIGHT = 18; // 線を描く帯の高さ（--u の倍数）
const BAR_AMP = 0.28; // 波の振れ幅（帯の高さに対する割合）
const BAR_WAVELENGTH = 90; // 波の長さ（px）
const BAR_FLOW = 2.4; // 波が流れる速さ（ラジアン/秒）
const BAR_STEP = 6; // 線を折れ線にするときの間隔（px）
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
export class Voyage {
    world;
    phase = 'off';
    time = 0;
    /** 明けてから進んだ時間（船旅の場面の時計） */
    clock = 0;
    /** 進み具合（0〜1。1 で着く） */
    progress = 0;
    /** 準備ができたときの進み具合と時刻（そこから 1 まで進めきる） */
    readyFrom = 0;
    readyAt = -1;
    /** 着く場所へ切り替わり、シェーダーの用意も済んだか */
    ready = false;
    /** 渡れたか（断られたり、待ちきれなかったりしたら false） */
    arrived = false;
    to = 'island';
    /** 円の上の船の位置（ラジアン） */
    along = 0;
    /** このフレームの経過時間（update で受け取り、render で使う） */
    dt = 0;
    bar;
    line;
    cover;
    /** 船旅の間だけ見せる、船と漕ぐ人 */
    stage = new THREE.Group();
    boat = boatObject(true);
    avatar = new Avatar(DEFAULT_LOOK, 0);
    pose = { p: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, state: 'sit', crouch: 0, bodyYaw: 0 };
    /** 浅瀬のない深い海の海底 */
    deepSeabed = bakeSeabed(() => SEA_FLOOR - 10, WORLD_SIZE);
    /** 暗くなりきったときに呼ばれる。main は海図の描画をやめて渡る頼みを出し、出せたら true を返す */
    onCovered = () => false;
    /** 船旅が終わって明けたときに呼ばれる。arrived は渡れたか */
    onDone = () => { };
    constructor(world) {
        this.world = world;
        injectStyle();
        const svg = 'http://www.w3.org/2000/svg';
        this.bar = document.createElementNS(svg, 'svg');
        this.bar.classList.add('voyage-bar');
        this.line = document.createElementNS(svg, 'path');
        this.bar.append(this.line);
        this.cover = document.createElement('div');
        this.cover.className = 'voyage-cover';
        document.body.append(this.bar, this.cover);
        // 船旅の間は、キーとクリックをほかの処理へ渡さない（F で船を降りる・W で漕ぐなどをさせない。離したのは渡す）
        const swallow = (e) => {
            if (this.isOpen)
                e.stopImmediatePropagation();
        };
        for (const type of ['keydown', 'mousedown', 'wheel'])
            addEventListener(type, swallow, { capture: true });
        this.stage.add(this.boat, this.avatar.object);
        this.stage.visible = false;
        world.scene.add(this.stage);
    }
    /** 船旅の場面を描いている間は true（main は描画を render() に任せる） */
    get active() {
        return this.phase === 'sail' || this.phase === 'land';
    }
    /** 暗転し始めてから明けきるまでは true（その間は操作を受け付けない） */
    get isOpen() {
        return this.phase !== 'off';
    }
    /** 行き先 */
    get destination() {
        return this.to;
    }
    /** 船旅を始める。to は行き先、look は漕いでいる自分の見た目 */
    start(to, look) {
        if (this.phase !== 'off')
            return;
        this.to = to;
        this.phase = 'cover';
        this.time = 0;
        this.clock = 0;
        this.progress = 0;
        this.readyAt = -1;
        this.ready = false;
        this.arrived = false;
        this.along = Math.random() * Math.PI * 2;
        this.avatar.setLook(look);
        this.drawBar();
    }
    /** 着く場所へ切り替わり、描く準備も済んだら main が呼ぶ */
    arrive() {
        if (this.phase === 'off' || this.phase === 'reveal')
            return;
        this.arrived = true;
        this.ready = true;
    }
    /** 毎フレーム呼ぶ（演出の時間を進める） */
    update(dt) {
        if (this.phase === 'off')
            return;
        this.time += dt;
        this.dt = dt;
        let cover = 0;
        if (this.phase === 'cover') {
            cover = clamp01(this.time / FADE_TIME);
            if (this.time >= FADE_TIME) {
                this.phase = 'sail';
                this.time = 0;
                this.bar.classList.add('open');
                document.body.classList.add('voyaging'); // 進み具合の線のほかの UI を隠す（暗いうちに切り替える）
                if (!this.onCovered()) {
                    // 渡る頼みを出せなかった（もう船に乗っていないなど）：すぐに元の場所へ明ける
                    this.toReveal();
                    return;
                }
            }
        }
        else if (this.phase === 'sail') {
            cover = 1 - clamp01(this.time / FADE_TIME);
            this.clock += dt;
            this.along += (SAIL_SPEED / PATH_RADIUS) * dt;
            this.advance();
            if (this.progress >= 1) {
                this.phase = 'land';
                this.time = 0;
            }
        }
        else if (this.phase === 'land') {
            cover = clamp01(this.time / FADE_TIME);
            this.clock += dt;
            this.along += (SAIL_SPEED / PATH_RADIUS) * dt;
            this.drawBar(); // 暗くなる間も波は流し続ける
            if (this.time >= FADE_TIME)
                this.toReveal();
        }
        else {
            // 着いた場所を暗いまま描いてから明ける
            cover = 1 - clamp01((this.time - ARRIVE_HOLD) / FADE_TIME);
            if (this.time >= ARRIVE_HOLD + FADE_TIME) {
                this.phase = 'off';
                this.cover.style.opacity = '0';
                this.onDone(this.arrived);
                return;
            }
        }
        this.cover.style.opacity = String(cover);
    }
    /** 暗いまま、着いた場所（渡れなければ元の場所）の描画に戻す */
    toReveal() {
        this.phase = 'reveal';
        this.time = 0;
        this.bar.classList.remove('open');
        document.body.classList.remove('voyaging');
        this.cover.style.opacity = '1';
    }
    /** 進み具合を進める。準備ができるまでは WAIT_CAP で待ち、待ちきれなければやめる */
    advance() {
        const byTime = this.clock / SAIL_TIME;
        if (!this.ready) {
            this.progress = Math.min(byTime, WAIT_CAP);
            if (this.clock > GIVE_UP)
                this.ready = true; // 返事が来ない：元の場所へ戻る（arrived は false のまま）
        }
        else {
            if (this.readyAt < 0) {
                this.readyAt = this.clock;
                this.readyFrom = this.progress;
            }
            // 早く準備できても SAIL_TIME までは時間どおりに進め、待たされたときは残りを FINISH_TIME で進めきる
            const finish = this.readyFrom + (1 - this.readyFrom) * clamp01((this.clock - this.readyAt) / FINISH_TIME);
            this.progress = Math.max(this.progress, Math.min(byTime, finish, 1));
        }
        this.drawBar();
    }
    /** 進み具合の線を描く：画面の下の端から、進んだ分だけ波打つ線が伸び、波は流れ続ける */
    drawBar() {
        const w = innerWidth;
        const h = this.bar.getBoundingClientRect().height || 18;
        this.bar.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const end = w * this.progress;
        const k = (Math.PI * 2) / BAR_WAVELENGTH;
        const y = (x) => (h / 2 + Math.sin(x * k - this.clock * BAR_FLOW) * h * BAR_AMP).toFixed(1);
        let d = '';
        for (let x = 0; x < end; x += BAR_STEP)
            d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y(x)}`;
        if (end > 0)
            d += `L${end.toFixed(1)} ${y(end)}`;
        this.line.setAttribute('d', d);
    }
    /** 船旅の場面を描く（ゲームのシーンを、船と海と空だけにして描く。描いたあとは元に戻す） */
    render(renderer) {
        const { scene, camera, sea, sun, skyDome, keep } = this.world;
        const t = this.clock;
        // 船：大きな円を回って進み、浮かべた船と同じ式で波に揺れる
        const x = Math.cos(this.along) * PATH_RADIUS;
        const z = Math.sin(this.along) * PATH_RADIUS;
        const dir = new THREE.Vector3(-Math.sin(this.along), 0, Math.cos(this.along)); // 進む向き
        const yaw = Math.atan2(-dir.z, dir.x); // 舳先は yaw 0 で +X
        floatPose(x, z, yaw, this.boat.position, this.boat.quaternion);
        this.boat.updateMatrixWorld(true);
        // 漕ぐ人：座り板に座り、ときどきあたりを見回す（浮かべた船に乗っているときと同じ座り方）
        const heading = yaw - Math.PI / 2;
        this.pose.p.copy(BOAT_SEAT).multiplyScalar(BOAT_SCALE);
        this.pose.p.y -= SIT_DROP;
        this.pose.p.applyQuaternion(this.boat.quaternion).add(this.boat.position);
        this.pose.bodyYaw = heading;
        this.pose.yaw = heading + Math.sin(t * 0.35) * 0.6;
        this.pose.pitch = Math.sin(t * 0.21) * 0.1;
        this.avatar.update(this.dt, this.pose);
        // カメラ：斜め後ろから、ゆっくり回り込みながら寄っていく
        const pos = camera.position.clone();
        const quat = camera.quaternion.clone();
        const dist = THREE.MathUtils.lerp(CAM_INTRO, CAM_DIST, ease(clamp01(t / CAM_INTRO_TIME)));
        const a = CAM_ANGLE + Math.sin(t * CAM_SWING_SPEED) * CAM_SWING;
        const side = new THREE.Vector3(-dir.z, 0, dir.x); // 進む向きの右
        camera.position
            .set(x, CAM_HEIGHT + Math.sin(t * 0.5) * 0.15, z)
            .addScaledVector(dir, -Math.cos(a) * dist)
            .addScaledVector(side, Math.sin(a) * dist);
        camera.lookAt(x + dir.x * CAM_AHEAD, 1, z + dir.z * CAM_AHEAD);
        camera.updateMatrixWorld();
        camera.layers.set(0);
        // 空はカメラについてこさせ、影を作る光は船のまわりへ動かす
        const domePos = skyDome.position.clone();
        skyDome.position.copy(camera.position);
        skyDome.updateMatrixWorld(true);
        const sunPos = sun.position.clone();
        const targetPos = sun.target.position.clone();
        const shift = new THREE.Vector3(x, 0, z).sub(targetPos);
        sun.position.add(shift);
        sun.target.position.add(shift);
        sun.target.updateMatrixWorld();
        // 海・空・光と船旅の船だけを残して描く。海底は浅瀬のない深い海にする
        const hidden = [];
        this.stage.visible = true;
        for (const o of scene.children) {
            if (o === this.stage || !o.visible || keep.includes(o))
                continue;
            o.visible = false;
            hidden.push(o);
        }
        const seabed = sea.seabedTexture;
        sea.setSeabed(this.deepSeabed);
        renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
        // 元に戻す
        sea.setSeabed(seabed);
        for (const o of hidden)
            o.visible = true;
        this.stage.visible = false;
        sun.position.copy(sunPos);
        sun.target.position.copy(targetPos);
        sun.target.updateMatrixWorld();
        skyDome.position.copy(domePos);
        skyDome.updateMatrixWorld(true);
        camera.position.copy(pos);
        camera.quaternion.copy(quat);
        camera.updateMatrixWorld();
    }
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    /* 進み具合：画面の下の端から端まで、白い波打つ線が左から伸びていく */
    .voyage-bar {
      display: none; position: fixed; left: 0; right: 0; bottom: calc(6 * var(--u)); z-index: 21; pointer-events: none;
      width: 100%; height: calc(${BAR_HEIGHT} * var(--u)); overflow: visible;
    }
    .voyage-bar.open { display: block; }
    .voyage-bar path { fill: none; stroke: #fff; stroke-width: calc(3 * var(--u)); stroke-linecap: round; stroke-linejoin: round; }
    /* 船旅の間は、進み具合の線と暗転の幕のほかの UI を隠す */
    body.voyaging > :not(canvas):not(.voyage-bar):not(.voyage-cover):not(script) { visibility: hidden !important; }
    .voyage-cover { position: fixed; inset: 0; z-index: 20; pointer-events: none; background: #2b2633; opacity: 0; }
  `;
    document.head.append(style);
}
