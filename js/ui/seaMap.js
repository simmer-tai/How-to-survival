import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { chartRandom } from '../items/islandChart.js';
import { TOWN_PLAN } from '../world/town.js';
import { allLocations } from '../world/location.js';
import { keyGuide } from './keyGuide.js';
// 海図：船で世界の端まで漕いでいくと開き、ほかの場所（自分の島・街・島の地図から書き写した島）を選んで船ごと渡る。
// 開くと、視点が船からどんどん上空へ昇り、雲を抜けると、すべての場所を小さな模型にした立体の海図になる。
// 模型の島は、その場所の地形（HeightField）から作る。木の位置は場所の id から決める（いつ開いても同じ絵）。
// 開くのも選ぶのも自分だけの UI。渡るのは main が船のワールドコマンド（sailBoat）にする
// ---- 昇っていく演出 ----
const RISE_TIME = 2.4; // 船から上空まで昇る時間（秒）
const RISE_HEIGHT = 170; // 昇りきる高さ（m）
const RISE_INWARD = 0.6; // 昇りながら、島の中心のほうへ寄る割合
const CLOUD_FROM = 0.55; // 昇る途中のこの割合から雲が濃くなる
const ZOOM_TIME = 2; // 雲を抜けてから、海図全体が見えるまで引いていく時間（秒）
const CLOUD_CLEAR = 0.7; // 雲が晴れる時間（秒）
const DESCEND_TIME = 1.3; // Esc で閉じたとき、船へ降りる時間（秒）
const RISE_FOG_FAR = 1000; // 上空での霧の遠さ（下の島まで見えるように）
const RISE_CAMERA_FAR = 1400;
// ---- 模型 ----
const MAP_W = 120; // 模型の海図の幅（海図の位置 0〜1 をこの広さに広げる）
const MAP_H = 78; // 奥行き
const MINI_GRID = 60; // 模型の地形の1辺のマスの数
const MINI_LIFT = 1.7; // 模型の高さの誇張
const SAND_TOP = 1.5; // これより低い所は砂浜（m。地形と同じ）
const ROCK_SLOPE = 0.78; // 面の傾きがこれより急なら岩肌
const TREE_SPACING = 7; // 模型の木を置く間隔の目安（m）
const OVERVIEW_PITCH = THREE.MathUtils.degToRad(58); // 全体を見るときの見下ろす角度
const OVERVIEW_FOV = 42;
const OVERVIEW_SWAY = 0.025; // 全体を見ている間、視点をゆっくり揺らす大きさ（ラジアン）
const HOVER_LIFT = 1.08; // 行き先に指を合わせたとき、島をふくらませる大きさ
const PIN_HEIGHT = 5; // 今いる所の印を、島の上にどれだけ浮かせるか
const CLOUD_COUNT = 14; // 模型の上を流れる雲の数
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const ease = (t) => t * t * (3 - 2 * t);
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
/** 場所の id から決める種（島の模型を毎回同じにする） */
function idSeed(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++)
        h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    return h >>> 0;
}
export class SeaMap {
    isOpen = false;
    /** 開いた時刻（開いたのと同じキーで閉じないように） */
    openedAt = 0;
    root;
    labels;
    cloud;
    here = 'island';
    phase = 'off';
    time = 0;
    /** 行き先を選んで、暗転を待っている */
    leaving = false;
    /** 昇り始めた目の位置と向き、昇りきった所 */
    eyePos = new THREE.Vector3();
    eyeQuat = new THREE.Quaternion();
    topPos = new THREE.Vector3();
    topQuat = new THREE.Quaternion();
    eyeFov = 70;
    /** 模型のシェーダーを、昇っている間に裏で用意し始めたか（開くたびに確かめる） */
    warmed = false;
    mini = new THREE.Scene();
    miniCam = new THREE.PerspectiveCamera(OVERVIEW_FOV, 1, 0.5, 2000);
    miniFog = new THREE.Fog(PALETTE.sky, 150, 400);
    hemi = new THREE.HemisphereLight(PALETTE.sky, PALETTE.sand, 1.6);
    sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
    minis = new Map();
    pin;
    clouds;
    /** 模型の視点の、雲を抜けた所と全体を見る所 */
    startPos = new THREE.Vector3();
    startQuat = new THREE.Quaternion();
    viewPos = new THREE.Vector3();
    viewQuat = new THREE.Quaternion();
    viewTarget = new THREE.Vector3(0, 0, MAP_H * 0.04);
    hovered = null;
    ray = new THREE.Raycaster();
    pointer = new THREE.Vector2(2, 2);
    /** 開閉時に呼ばれる（ポインタロックの切り替えは main 側で行う）。resume=false は Esc で閉じたとき */
    onToggle = () => { };
    /** 行き先を選んだときに呼ばれる。main は船旅（Voyage）の暗転のあいだに finish() を呼び、船ごと渡る */
    onTravel = () => { };
    /** 場所の地形（模型を作るのに使う） */
    fieldOf = () => {
        throw new Error('fieldOf が未設定');
    };
    constructor() {
        injectStyle();
        this.root = document.createElement('div');
        this.root.className = 'seamap';
        this.root.innerHTML = `
      <div class="seamap-labels"></div>
      <div class="seamap-head">
        <div class="seamap-title">海図</div>
        <div class="seamap-say">どこへ行こう？</div>
      </div>
      <div class="seamap-hint">${keyGuide('[左]：行き先を選ぶ ／ [Esc]：閉じて漕ぎ続ける')}</div>`;
        this.labels = this.root.querySelector('.seamap-labels');
        this.cloud = document.createElement('div');
        this.cloud.className = 'seamap-cloud';
        document.body.append(this.root, this.cloud);
        this.root.addEventListener('contextmenu', (e) => e.preventDefault());
        this.root.addEventListener('mousemove', (e) => {
            this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        });
        this.root.addEventListener('mouseleave', () => this.pointer.set(2, 2));
        this.root.addEventListener('mousedown', (e) => {
            if (e.button === 0 && this.hovered)
                this.choose(this.hovered);
        });
        addEventListener('keydown', (e) => {
            if (!this.isOpen || e.timeStamp <= this.openedAt)
                return;
            if (e.code === 'Escape')
                this.setOpen(false, false);
        });
        this.mini.background = new THREE.Color(PALETTE.sky);
        this.mini.fog = this.miniFog;
        this.sunLight.position.set(-40, 80, 30);
        this.mini.add(this.hemi, this.sunLight, buildMiniSea());
        this.pin = buildPin();
        this.clouds = buildClouds();
        this.mini.add(this.pin, this.clouds);
    }
    /** 視点が上空の演出か海図を見ている間は true（main は描画を render() に任せる） */
    get active() {
        return this.phase !== 'off';
    }
    /** here は今いる場所、eye は今の目（カメラ） */
    open(here, eye) {
        if (this.phase !== 'off')
            return;
        this.here = here;
        this.eyePos.copy(eye.position);
        this.eyeQuat.copy(eye.quaternion);
        this.eyeFov = eye.fov;
        this.setOpen(true);
    }
    setOpen(open, resume = true) {
        if (open) {
            if (this.phase !== 'off')
                return;
            this.isOpen = true;
            this.openedAt = performance.now();
            this.leaving = false;
            this.buildMinis();
            this.planRise();
            this.warmed = false;
            this.phase = 'rise';
            this.time = 0;
            this.onToggle(true, resume);
            return;
        }
        if (!this.isOpen || this.phase === 'descend')
            return;
        // 閉じる：雲を通って船へ降りてから、遊びに戻る（昇っている途中なら、その高さから降りる）
        this.descendFrom = this.phase === 'rise' ? clamp01(this.time / RISE_TIME) : 1;
        this.descendResume = resume;
        this.phase = 'descend';
        this.time = 0;
        this.root.classList.remove('open');
    }
    /** 降り始めた高さ（昇りきった所が 1）と、降りたあとで遊びに戻るか */
    descendFrom = 1;
    descendResume = false;
    /** 行き先を選んだあと、船旅の暗転のあいだに main が呼ぶ（海図の描画をやめる） */
    finish() {
        this.phase = 'off';
        this.leaving = false;
        this.root.classList.remove('open');
        this.cloud.style.opacity = '0';
    }
    /** 毎フレーム呼ぶ（演出の時間を進める） */
    update(dt) {
        if (this.phase === 'off')
            return;
        this.time += dt;
        if (this.phase === 'rise' && this.time >= RISE_TIME) {
            this.phase = 'chart';
            this.time = 0;
            this.root.classList.add('open');
        }
        else if (this.phase === 'descend' && this.time >= DESCEND_TIME) {
            this.finish();
            this.isOpen = false;
            this.onToggle(false, this.descendResume);
            return;
        }
        // 雲：昇る終わりに濃くなり、模型に切り替わると晴れる。降りるときは、降り始めの高さの雲から晴れていく
        const riseCloud = (k) => ease(clamp01((k - CLOUD_FROM) / (1 - CLOUD_FROM)));
        let cloud = 0;
        if (this.phase === 'rise')
            cloud = riseCloud(this.time / RISE_TIME);
        else if (this.phase === 'chart')
            cloud = 1 - ease(clamp01(this.time / CLOUD_CLEAR));
        else
            cloud = riseCloud(this.descendFrom) * (1 - ease(clamp01(this.time / (DESCEND_TIME * 0.6))));
        this.cloud.style.opacity = String(cloud);
        this.cloud.style.transform = `scale(${1 + cloud * 0.25})`;
    }
    /**
     * 描く。上空へ昇る・降りる間は本当の世界を上から、海図では模型を描く。
     * camera は目のカメラ（描く間だけ動かして、元に戻す）。fog は世界の霧、sky と daylight は今の空の色と明るさ、skyDome は空の球（描く間だけカメラに付いてこさせる）
     */
    render(renderer, scene, camera, fog, sky, daylight, skyDome) {
        if (this.phase === 'chart') {
            this.renderChart(renderer, sky, daylight);
            return;
        }
        // 模型のシェーダーは、雲を抜けて初めて描くときに作るとそこで止まるので、昇り始めに裏で作っておく
        if (!this.warmed) {
            this.warmed = true;
            renderer.compileAsync(this.mini, this.miniCam).catch(() => { });
        }
        // 上空への道すじ：高さはだんだん速く、向きは早めに真下のほうへ
        const k = this.phase === 'rise' ? clamp01(this.time / RISE_TIME) : this.descendFrom * (1 - ease(clamp01(this.time / DESCEND_TIME)));
        const pos = camera.position.clone();
        const quat = camera.quaternion.clone();
        const { near, far } = fog;
        const camFar = camera.far;
        const fov = camera.fov;
        camera.position.lerpVectors(this.eyePos, this.topPos, ease(k));
        camera.position.y = THREE.MathUtils.lerp(this.eyePos.y, this.topPos.y, easeIn(k) * 0.7 + ease(k) * 0.3);
        camera.quaternion.slerpQuaternions(this.eyeQuat, this.topQuat, ease(clamp01(k * 1.6)));
        camera.fov = this.eyeFov;
        camera.far = RISE_CAMERA_FAR;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        fog.near = THREE.MathUtils.lerp(near, RISE_FOG_FAR * 0.4, ease(k));
        fog.far = THREE.MathUtils.lerp(far, RISE_FOG_FAR, ease(k));
        const domePos = skyDome.position.clone();
        skyDome.position.copy(camera.position);
        skyDome.updateMatrixWorld(true);
        renderer.shadowMap.needsUpdate = false;
        renderer.render(scene, camera);
        skyDome.position.copy(domePos);
        skyDome.updateMatrixWorld(true);
        camera.position.copy(pos);
        camera.quaternion.copy(quat);
        camera.fov = fov;
        camera.far = camFar;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        fog.near = near;
        fog.far = far;
    }
    /** 昇りきる所と、模型の中でそれにあたる所（雲を抜けた所）と、全体を見る所を決める */
    planRise() {
        const here = this.minis.get(this.here);
        const land = new THREE.Vector3(here.center.x, 0, here.center.y);
        this.topPos.set(THREE.MathUtils.lerp(this.eyePos.x, land.x, RISE_INWARD), RISE_HEIGHT, THREE.MathUtils.lerp(this.eyePos.z, land.z, RISE_INWARD));
        this.topQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.topPos, land, new THREE.Vector3(0, 1, 0)));
        // 模型の中の同じ所
        const s = here.scale;
        const origin = here.group.position;
        this.startPos.set(origin.x + (this.topPos.x - land.x) * s, this.topPos.y * s, origin.z + (this.topPos.z - land.z) * s);
        this.startQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.startPos, origin, new THREE.Vector3(0, 1, 0)));
        // 今いる所の印
        this.pin.position.set(origin.x + (this.eyePos.x - land.x) * s, PIN_HEIGHT, origin.z + (this.eyePos.z - land.z) * s);
    }
    /** 全体を見る視点（画面の縦横の比に合わせて、海図がおさまる距離まで引く） */
    planOverview(aspect) {
        const half = THREE.MathUtils.degToRad(OVERVIEW_FOV / 2);
        const dist = Math.max((MAP_W * 0.56) / (Math.tan(half) * aspect), (MAP_H * 0.68) / Math.tan(half));
        const sway = Math.sin(performance.now() / 4000) * OVERVIEW_SWAY;
        this.viewPos.set(Math.sin(sway) * dist * Math.cos(OVERVIEW_PITCH), Math.sin(OVERVIEW_PITCH) * dist, Math.cos(sway) * dist * Math.cos(OVERVIEW_PITCH)).add(this.viewTarget);
        this.viewQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.viewPos, this.viewTarget, new THREE.Vector3(0, 1, 0)));
        this.miniFog.near = dist * 1.4;
        this.miniFog.far = dist * 3;
    }
    renderChart(renderer, sky, daylight) {
        const size = renderer.getSize(new THREE.Vector2());
        const aspect = size.x / size.y;
        this.planOverview(aspect);
        // 雲を抜けた所から、海図全体が見える所まで引いていく
        const k = easeOut(clamp01(this.time / ZOOM_TIME));
        const cam = this.miniCam;
        cam.position.lerpVectors(this.startPos, this.viewPos, k);
        cam.quaternion.slerpQuaternions(this.startQuat, this.viewQuat, k);
        cam.fov = THREE.MathUtils.lerp(this.eyeFov, OVERVIEW_FOV, k);
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        // 空の色と明るさは今の時刻に合わせる（夜の海図は暗い）
        this.mini.background.copy(sky);
        this.miniFog.color.copy(sky);
        this.hemi.intensity = THREE.MathUtils.lerp(0.5, 1.6, daylight);
        this.sunLight.intensity = THREE.MathUtils.lerp(0.4, 2.2, daylight);
        // 指している島（模型の島か、名前の札）
        const now = performance.now() / 1000;
        let hovered = null;
        if (!this.leaving && k > 0.6) {
            this.ray.setFromCamera(this.pointer, cam);
            const hit = this.ray.intersectObjects([...this.minis.values()].map((m) => m.terrain), false)[0];
            hovered = hit ? (this.minis.get(hit.object.userData.loc) ?? null) : null;
            const labelHover = this.labels.querySelector('.seamap-spot:hover');
            if (labelHover)
                hovered = this.minis.get(labelHover.dataset.loc) ?? hovered;
            if (hovered?.def.id === this.here)
                hovered = null;
        }
        this.hovered = hovered;
        this.root.style.cursor = hovered ? 'pointer' : '';
        const p = new THREE.Vector3();
        for (const m of this.minis.values()) {
            m.hover = THREE.MathUtils.damp(m.hover, m === hovered ? 1 : 0, 12, 1 / 60);
            const s = 1 + (HOVER_LIFT - 1) * m.hover;
            m.group.scale.set(s, s, s);
            // 名前の札を模型の島の上に出す
            p.copy(m.anchor).project(cam);
            const show = k > 0.5 && p.z < 1;
            m.label.style.display = show ? '' : 'none';
            m.label.style.left = `${((p.x + 1) / 2) * 100}%`;
            m.label.style.top = `${((1 - p.y) / 2) * 100}%`;
            m.label.classList.toggle('hot', m === hovered);
        }
        this.pin.position.y = PIN_HEIGHT + Math.sin(now * 2.4) * 0.5;
        this.pin.rotation.y = now * 1.2;
        for (const c of this.clouds.children) {
            c.position.x += c.userData.speed / 60;
            if (c.position.x > MAP_W)
                c.position.x = -MAP_W;
        }
        renderer.shadowMap.needsUpdate = false;
        renderer.render(this.mini, cam);
    }
    choose(m) {
        if (this.leaving || m.def.id === this.here)
            return;
        this.leaving = true;
        this.root.classList.remove('open');
        // ポインタロックはクリックしたその場で戻す（暗転のあとでは戻せないことがある）。描画は finish() まで海図のまま
        this.isOpen = false;
        this.onToggle(false, true);
        this.onTravel(m.def.id);
    }
    /** 海図にある場所の模型を作る（まだの場所だけ）。名前の札も作り直す */
    buildMinis() {
        for (const def of allLocations()) {
            if (this.minis.has(def.id))
                continue;
            const m = buildMini(def, this.fieldOf(def.id));
            this.mini.add(m.group);
            this.minis.set(def.id, m);
        }
        this.labels.replaceChildren(...[...this.minis.values()].map((m) => {
            const here = m.def.id === this.here;
            m.label.className = 'seamap-spot' + (here ? ' here' : '');
            m.label.querySelector('.seamap-tag').textContent = here ? 'いまここ' : 'ここへ行く';
            return m.label;
        }));
    }
}
/** 場所の地形から、模型の島を作る。海図での大きさに合わせて縮め、海図の位置に置く */
function buildMini(def, field) {
    // 陸のある範囲を測り、その真ん中を島の中心にする
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const probe = 48;
    for (let j = 0; j <= probe; j++) {
        for (let i = 0; i <= probe; i++) {
            const x = -field.half + (i / probe) * field.size;
            const z = -field.half + (j / probe) * field.size;
            if (field.height(x, z) <= 0.2)
                continue;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            z0 = Math.min(z0, z);
            z1 = Math.max(z1, z);
        }
    }
    if (x0 > x1)
        [x0, x1, z0, z1] = [-field.half / 2, field.half / 2, -field.half / 2, field.half / 2];
    const center = new THREE.Vector2((x0 + x1) / 2, (z0 + z1) / 2);
    const scale = (def.chartSize * MAP_W) / Math.max(x1 - x0, z1 - z0);
    const lift = scale * MINI_LIFT;
    const group = new THREE.Group();
    group.position.set((def.chart[0] - 0.5) * MAP_W, 0, (def.chart[1] - 0.5) * MAP_H);
    const local = (x, z, y) => new THREE.Vector3((x - center.x) * scale, y * lift, (z - center.y) * scale);
    // 地形：低い多角形で、砂浜・草地・岩肌・浅瀬に塗り分ける
    const positions = [];
    const colors = [];
    const sand = new THREE.Color(PALETTE.sand);
    const grass = new THREE.Color(PALETTE.grass);
    const rock = new THREE.Color(PALETTE.rock);
    const water = new THREE.Color(PALETTE.water);
    const col = new THREE.Color();
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const step = field.size / MINI_GRID;
    const raw = (i, j) => {
        const x = -field.half + i * step;
        const z = -field.half + j * step;
        return { x, z, y: field.height(x, z) };
    };
    const tri = (a, b, c) => {
        const top = Math.max(a.y, b.y, c.y);
        if (top < -4.5)
            return; // 平らな沖の海底は描かない（海の色にまぎれる）
        const pa = local(a.x, a.z, a.y);
        const pb = local(b.x, b.z, b.y);
        const pc = local(c.x, c.z, c.y);
        // 傾きは誇張する前の高さで測る
        n.crossVectors(e1.set(b.x - a.x, b.y - a.y, b.z - a.z), e2.set(c.x - a.x, c.y - a.y, c.z - a.z)).normalize();
        const mid = (a.y + b.y + c.y) / 3;
        if (mid < 0)
            col.copy(sand).lerp(water, clamp01(-mid / 4) * 0.9);
        else if (mid < SAND_TOP)
            col.copy(sand);
        else if (Math.abs(n.y) < ROCK_SLOPE)
            col.copy(rock);
        else
            col.copy(grass);
        for (const v of [pa, pb, pc]) {
            positions.push(v.x, v.y, v.z);
            colors.push(col.r, col.g, col.b);
        }
    };
    for (let j = 0; j < MINI_GRID; j++) {
        for (let i = 0; i < MINI_GRID; i++) {
            const p00 = raw(i, j);
            const p10 = raw(i + 1, j);
            const p01 = raw(i, j + 1);
            const p11 = raw(i + 1, j + 1);
            tri(p00, p01, p10);
            tri(p10, p01, p11);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    terrain.userData.loc = def.id;
    group.add(terrain);
    // 木：草地に、場所の id から決めた所に置く
    const rand = chartRandom(idSeed(def.id));
    const spots = [];
    const tries = Math.round(((x1 - x0) * (z1 - z0)) / (TREE_SPACING * TREE_SPACING));
    for (let i = 0; i < tries; i++) {
        const x = x0 + rand() * (x1 - x0);
        const z = z0 + rand() * (z1 - z0);
        const y = field.height(x, z);
        if (y < SAND_TOP + 0.6)
            continue;
        const slope = Math.hypot(field.height(x + 1, z) - field.height(x - 1, z), field.height(x, z + 1) - field.height(x, z - 1)) / 2;
        if (slope > 0.6 || onTownPlan(def.id, x, z))
            continue;
        if (rand() < 0.35)
            continue; // 草地にも、ところどころ木のない所を残す
        spots.push(local(x, z, y));
    }
    if (spots.length) {
        const treeH = Math.max(0.9, 7 * scale);
        const cone = new THREE.ConeGeometry(treeH * 0.38, treeH, 6);
        cone.translate(0, treeH / 2, 0);
        const trees = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: PALETTE.leaf, flatShading: true }), spots.length);
        const m = new THREE.Matrix4();
        spots.forEach((p, i) => {
            const s = 0.75 + rand() * 0.5;
            trees.setMatrixAt(i, m.makeScale(s, s, s).setPosition(p));
        });
        group.add(trees);
    }
    if (def.id === 'town')
        group.add(buildMiniTown(local, scale));
    // 名前を出す点は、島のいちばん高い所の少し上
    let top = 0;
    for (let i = 1; i < positions.length; i += 3)
        top = Math.max(top, positions[i]);
    const anchor = group.position.clone().add(new THREE.Vector3(0, top + 2, 0));
    const label = document.createElement('button');
    label.dataset.loc = def.id;
    label.innerHTML = `<span class="seamap-name">${def.name}</span><span class="seamap-tag"></span>`;
    return { def, group, terrain, scale, center, anchor, label, hover: 0 };
}
/** 街の広場・突堤・建物の上か（模型の木を置かない） */
function onTownPlan(loc, x, z) {
    if (loc !== 'town')
        return false;
    const { plaza } = TOWN_PLAN;
    return x > plaza.x0 - 3 && x < plaza.x1 + 4 && Math.abs(z) < plaza.halfZ + 3;
}
/** 街の模型：石畳の広場、石の突堤、家と地図屋と屋台 */
function buildMiniTown(local, scale) {
    const g = new THREE.Group();
    const box = (x0, x1, z0, z1, y0, y1, color) => {
        const a = local(x0, z0, y0);
        const b = local(x1, z1, y1);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, Math.max(b.y - a.y, 0.05), b.z - a.z), new THREE.MeshLambertMaterial({ color, flatShading: true }));
        mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        g.add(mesh);
        return mesh;
    };
    const { plaza, jetty, buildings, stall } = TOWN_PLAN;
    box(plaza.x0, plaza.x1, -plaza.halfZ, plaza.halfZ, -0.5, plaza.top, PALETTE.rock);
    box(jetty.x0, jetty.x1, jetty.z - jetty.half, jetty.z + jetty.half, -1, plaza.top, PALETTE.rock);
    for (const b of buildings) {
        box(b.x - 3.5, b.x + 3.5, b.z - 3.5, b.z + 3.5, plaza.top, plaza.top + 5, PALETTE.sand);
        // 屋根（四角すい）
        const roof = new THREE.Mesh(new THREE.ConeGeometry(7 * scale * 0.78, 3 * scale * MINI_LIFT, 4), new THREE.MeshLambertMaterial({ color: PALETTE.bark, flatShading: true }));
        roof.rotation.y = Math.PI / 4;
        roof.position.copy(local(b.x, b.z, plaza.top + 5)).add(new THREE.Vector3(0, 1.5 * scale * MINI_LIFT, 0));
        g.add(roof);
    }
    box(stall.x, stall.x + 2.4, stall.z - 1.6, stall.z + 1.6, plaza.top, plaza.top + 2.4, PALETTE.accent);
    return g;
}
/** 模型の海（遠くは霧で空に溶かす） */
function buildMiniSea() {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W * 8, MAP_W * 8), new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.8 }));
    sea.rotation.x = -Math.PI / 2;
    sea.renderOrder = 1; // 島の水の中の部分を透かして見せる
    return sea;
}
/** 今いる所の印（赤い玉と、下を指す三角） */
function buildPin() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: PALETTE.accent, flatShading: true });
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), mat);
    ball.position.y = 1.6;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 4), mat);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.3;
    g.add(ball, tip);
    return g;
}
/** 模型の上を流れる、低い多角形の雲（固定シード） */
function buildClouds() {
    const g = new THREE.Group();
    const rand = chartRandom(9157);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.85 });
    for (let i = 0; i < CLOUD_COUNT; i++) {
        const cloud = new THREE.Group();
        const puffs = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < puffs; k++) {
            const r = 2 + rand() * 2.5;
            const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
            puff.position.set((k - puffs / 2) * 2.6, rand() * 1.2, (rand() - 0.5) * 3);
            puff.scale.y = 0.6;
            cloud.add(puff);
        }
        cloud.position.set((rand() - 0.5) * MAP_W * 2, 22 + rand() * 10, (rand() - 0.5) * MAP_H * 1.6);
        cloud.userData.speed = 0.6 + rand() * 0.8;
        g.add(cloud);
    }
    return g;
}
function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .seamap {
      display: none; position: fixed; inset: 0; z-index: 5; color: #fff; user-select: none;
    }
    .seamap.open { display: block; animation: seamap-in 0.6s ease-out; }
    @keyframes seamap-in { from { opacity: 0; } to { opacity: 1; } }
    .seamap-head {
      position: absolute; left: 50%; top: calc(18 * var(--u)); transform: translateX(-50%); text-align: center; pointer-events: none;
    }
    .seamap-title {
      font-size: calc(22 * var(--u)); font-weight: 700; letter-spacing: 0.3em; padding-left: 0.3em;
      text-shadow: 0 calc(2 * var(--u)) 0 #2b2633, 0 0 calc(8 * var(--u)) rgba(43, 38, 51, 0.5);
    }
    .seamap-say { font-size: calc(13 * var(--u)); margin-top: calc(2 * var(--u)); text-shadow: 0 1px calc(3 * var(--u)) #2b2633; }
    .seamap-hint {
      position: absolute; left: 50%; bottom: calc(18 * var(--u)); transform: translateX(-50%); white-space: nowrap;
      font-size: calc(12 * var(--u)); padding: calc(6 * var(--u)) calc(14 * var(--u)); border-radius: 999px;
      background: rgba(43, 38, 51, 0.55); pointer-events: none;
    }
    .seamap-labels { position: absolute; inset: 0; }
    .seamap-spot {
      position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;
      gap: calc(3 * var(--u)); padding: 0; border: none; background: none; font: inherit; color: #fff; cursor: pointer; white-space: nowrap;
      transition: transform 0.15s;
    }
    .seamap-spot.here { cursor: default; }
    .seamap-spot.hot { transform: translate(-50%, -100%) translateY(calc(-4 * var(--u))); }
    .seamap-name {
      font-size: calc(15 * var(--u)); font-weight: 700; letter-spacing: 0.05em;
      padding: calc(3 * var(--u)) calc(10 * var(--u)); border-radius: calc(6 * var(--u));
      color: #2b2633; background: ${css(PALETTE.sand)}; box-shadow: 0 calc(2 * var(--u)) 0 ${css(PALETTE.trunk)};
    }
    .seamap-tag {
      font-size: calc(11 * var(--u)); font-weight: 700; padding: calc(2 * var(--u)) calc(8 * var(--u)); border-radius: 999px;
      color: ${css(PALETTE.sand)}; background: ${css(PALETTE.bark)}; opacity: 0; transition: opacity 0.15s;
    }
    .seamap-spot.hot .seamap-tag { opacity: 1; }
    .seamap-spot.here .seamap-tag { opacity: 1; color: #fff; background: ${css(PALETTE.accent)}; }
    .seamap-spot.hot .seamap-name { background: #fff; }

    /* 上空へ昇るときに抜ける雲 */
    .seamap-cloud {
      position: fixed; inset: -10%; z-index: 4; pointer-events: none; opacity: 0;
      will-change: opacity, transform; /* 毎フレーム変えるので、描き直さず拡大と透明度だけ変える */
      background:
        radial-gradient(ellipse 40% 30% at 20% 30%, #fff 0 40%, transparent 70%),
        radial-gradient(ellipse 45% 35% at 75% 25%, #fff 0 35%, transparent 70%),
        radial-gradient(ellipse 50% 40% at 50% 70%, #fff 0 45%, transparent 75%),
        radial-gradient(ellipse 35% 30% at 15% 80%, #fff 0 35%, transparent 70%),
        radial-gradient(ellipse 35% 30% at 85% 75%, #fff 0 35%, transparent 70%),
        ${css(PALETTE.sky)};
    }
  `;
    document.head.append(style);
}
