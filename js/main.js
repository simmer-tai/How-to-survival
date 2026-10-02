import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { gradientMap } from './materials.js';
import { createTerrain } from './terrain.js';
import { buildProps } from './props.js';
import { Player } from './player.js';
import { Inventory } from './inventory.js';
import { Vitals } from './vitals.js';
import { TreeChopper } from './chopping.js';
import { AxeHand, ItemHand } from './hand.js';
import { WoodDrops } from './drops.js';
import { BushForager } from './foraging.js';
import { Physics, WATER_LEVEL } from './physics.js';
import { Sea } from './water.js';
import { Grass } from './grass.js';
import { setWaveTime, waveOffset } from './waves.js';
import { Builder } from './build.js';
import { saveWorld, SAVE_VERSION } from './save.js';
import { showTitle, showToast } from './title.js';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // くっきりめの影
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const skyColor = new THREE.Color(PALETTE.sky);
const seaColor = new THREE.Color(PALETTE.water);
const deepColor = new THREE.Color();
scene.background = skyColor.clone();
const fog = new THREE.Fog(PALETTE.sky, 50, 230); // 遠景を空色に溶かす
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 600);
// ---- ライティング：半球光＋太陽1つ ----
const hemi = new THREE.HemisphereLight(PALETTE.sky, PALETTE.grass, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 300;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun);
// ---- ワールド ----
const physics = await Physics.create();
const terrain = createTerrain();
scene.add(terrain);
physics.addTerrain(terrain);
const sea = new Sea(gradientMap);
scene.add(sea.mesh);
const props = buildProps();
scene.add(props.group);
for (const mesh of props.solids)
    physics.addStatic(mesh);
const grass = new Grass(gradientMap, props.rocks, props.platforms);
scene.add(grass.mesh);
// ---- プレイヤー ----
const player = new Player(camera, renderer.domElement, physics, props.platforms, props.spawn);
// ---- インベントリ ----
const inventory = new Inventory();
inventory.add('axe');
// ---- HP・空腹・水分 ----
const vitals = new Vitals();
// ---- 斧で木を切る ----
scene.add(camera); // 手に持つ斧や木材をカメラの子として描画するため
const hand = new AxeHand(camera);
// 木材・枝・葉っぱは選んでいる間、手に持って見せる
const materialHands = ['wood', 'stick', 'leaf'].map((kind) => ({ kind, hand: new ItemHand(camera, kind) }));
const chopper = new TreeChopper(props.group, props.trees, physics);
// 丸太をばらすと木材が散らばり、視線を合わせて F を押すと1つずつ回収できる（木材は水に浮く）
const drops = new WoodDrops(props.group, physics);
chopper.onSplit = (trunk, wood) => drops.spawn(trunk, wood);
drops.onCollect = () => inventory.add('wood');
// 茂みに視線を合わせて F を押すと葉っぱと枝が採れる（採り尽くすと消えて、しばらくすると生え直す）
const forager = new BushForager(props.group, props.bushes);
forager.onHarvest = (item, count) => inventory.add(item, count);
addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && player.controls.isLocked && !inventory.isOpen) {
        if (!drops.collect(camera))
            forager.harvest(camera);
    }
});
hand.onImpact = () => chopper.chop(camera);
// ---- 建築（Q でメニュー → 選んだ部材を視線の先に置く） ----
const builder = new Builder(props.group, [terrain, ...props.solids], physics, props.platforms, inventory);
renderer.domElement.addEventListener('mousedown', (e) => {
    if (!player.controls.isLocked)
        return;
    if (builder.active) {
        if (e.button === 0)
            builder.place();
        else if (e.button === 2)
            builder.cancel();
        return;
    }
    if (e.button === 0)
        hand.swing();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// ---- セーブ（一時停止したとき・30秒ごと・ページを閉じるときに自動で保存する） ----
const AUTOSAVE_INTERVAL = 30;
let world = null; // タイトル画面でワールドを選ぶまでは null
let autosaveTimer = 0;
const startPlayer = player.serialize(); // 新しいワールドの出発地点（タイトル画面ではカメラが島を回るので覚えておく）
const snapshot = () => ({
    version: SAVE_VERSION,
    player: player.serialize(),
    inventory: inventory.serialize(),
    vitals: vitals.serialize(),
    trees: chopper.serialize(),
    bushes: forager.serialize(),
    drops: drops.serialize(),
    built: builder.serialize(),
});
const restore = (data) => {
    builder.restore(data.built); // 床などの足場を先に置いてからプレイヤーを戻す
    chopper.restore(data.trees);
    forager.restore(data.bushes);
    drops.restore(data.drops);
    inventory.restore(data.inventory);
    vitals.restore(data.vitals);
    player.restore(data.player);
};
const save = (toast = false) => {
    if (!world)
        return;
    autosaveTimer = 0;
    const ok = saveWorld(world.id, snapshot());
    if (!ok)
        showToast('セーブに失敗しました');
    else if (toast)
        showToast('セーブしました');
};
addEventListener('pagehide', () => save());
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
        save();
});
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const pickupHint = document.getElementById('pickup-hint');
const menuOpen = () => inventory.isOpen || builder.menuOpen;
document.getElementById('to-title').addEventListener('click', (e) => {
    e.stopPropagation(); // オーバーレイのクリック（ゲーム再開）にしない
    save();
    location.reload(); // 読み込み直してタイトル画面に戻る
});
const refreshOverlay = () => {
    // controls.isLocked は lock/unlock イベントの「後」に更新されるので、実際のロック状態を直接見る
    const locked = document.pointerLockElement === renderer.domElement;
    overlay.classList.toggle('hidden', !world || locked || menuOpen());
    crosshair.classList.toggle('hidden', menuOpen());
};
// Ctrl+W（タブを閉じる）などブラウザが優先するショートカットは、全画面中に Keyboard Lock API で
// キーを確保しないとページ側で止められない。Esc は一時停止に使うので確保しない
const LOCK_KEYS = [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
    ...'0123456789'.split('').map((d) => `Digit${d}`),
    'Tab', 'Space', 'Enter', 'Backspace', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
    'Semicolon', 'Quote', 'Backquote', 'Comma', 'Period', 'Slash',
    'F1', 'F3', 'F5', 'F6', 'F7', 'F12', 'PageUp', 'PageDown', 'Home', 'End',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
];
const startPlaying = async () => {
    player.controls.lock();
    const keyboard = navigator.keyboard;
    if (!keyboard)
        return; // Firefox・Safari は非対応（下の beforeunload の確認だけが頼り）
    try {
        if (!document.fullscreenElement)
            await document.documentElement.requestFullscreen();
        await keyboard.lock(LOCK_KEYS);
    }
    catch {
        // 全画面を拒否された場合などはそのまま続ける
    }
};
overlay.addEventListener('click', startPlaying);
player.controls.addEventListener('lock', refreshOverlay);
player.controls.addEventListener('unlock', refreshOverlay);
player.controls.addEventListener('unlock', () => save());
// Esc で抜けた直後（約1秒）はブラウザがポインタロックを拒否するので、少し待って1回だけ再試行する
let lockRetried = false;
player.controls.addEventListener('lock', () => (lockRetried = false));
document.addEventListener('pointerlockerror', () => {
    if (lockRetried)
        return;
    lockRetried = true;
    setTimeout(() => {
        if (!player.controls.isLocked && !menuOpen())
            player.controls.lock();
    }, 1100);
});
// Ctrl でしゃがみながら W を押すと Ctrl+W（タブを閉じる）になり、これはブラウザが止めさせてくれない。
// せめてプレイ中は閉じる前に確認を出す
addEventListener('beforeunload', (e) => {
    if (player.controls.isLocked)
        e.preventDefault();
});
const onMenuToggle = (open, resume) => {
    if (open)
        player.controls.unlock();
    else if (resume && !menuOpen())
        player.controls.lock();
    refreshOverlay();
};
inventory.onToggle = (open, resume) => {
    if (open)
        builder.setMenuOpen(false, false); // 建築メニューとは同時に開かない
    onMenuToggle(open, resume);
};
builder.onToggle = onMenuToggle;
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});
/** 水中では光を弱めて青く染め、深いほど暗い霧で視界を狭める */
function applyUnderwater(underwater) {
    if (!underwater) {
        fog.color.copy(skyColor);
        fog.near = 50;
        fog.far = 230;
        hemi.color.set(PALETTE.sky);
        hemi.groundColor.set(PALETTE.grass);
        hemi.intensity = 1.1;
        sun.color.set(0xffffff);
        sun.intensity = 2.4;
    }
    else {
        const depth = THREE.MathUtils.clamp(WATER_LEVEL - camera.position.y, 0, 8);
        deepColor.copy(seaColor).multiplyScalar(0.85 - depth * 0.05);
        fog.color.copy(deepColor);
        fog.near = 0;
        fog.far = 34 - depth * 2;
        hemi.color.copy(skyColor).lerp(seaColor, 0.5);
        hemi.groundColor.copy(deepColor);
        hemi.intensity = 1.0;
        sun.color.copy(skyColor);
        sun.intensity = 1.3 - depth * 0.08;
    }
    scene.background.copy(fog.color);
}
/** タイトル画面の背景：島の周りをゆっくり回る */
function orbitCamera(t) {
    const a = t * 0.05;
    camera.position.set(Math.cos(a) * 78, 24, Math.sin(a) * 78);
    camera.lookAt(0, 2, 0);
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    setWaveTime(t);
    sea.update(t);
    grass.update(t);
    if (world)
        player.update(dt);
    else
        orbitCamera(t);
    if (player.controls.isLocked) {
        vitals.update(dt); // 一時停止中・インベントリ表示中は減らさない
        autosaveTimer += dt;
        if (autosaveTimer >= AUTOSAVE_INTERVAL)
            save(true);
    }
    const held = world ? inventory.selectedStack : null; // タイトル画面では何も持たない
    hand.visible = held?.item === 'axe' && !builder.active;
    hand.update(dt);
    for (const { kind, hand: h } of materialHands) {
        h.setCount(held?.item === kind ? held.count : 0);
        h.update(dt, player.walking);
    }
    chopper.update(dt);
    physics.step(dt);
    drops.update(dt, camera.position);
    forager.update(dt);
    builder.update(dt, camera, camera.position);
    applyUnderwater(camera.position.y < WATER_LEVEL + waveOffset(camera.position.x, camera.position.z));
    const pickup = drops.isAiming(camera) ? 'F：拾う' : forager.isAiming(camera) ? 'F：採取' : '';
    if (pickup)
        pickupHint.textContent = pickup;
    pickupHint.classList.toggle('hidden', !player.controls.isLocked || menuOpen() || !pickup);
    renderer.render(scene, camera);
});
// ---- タイトル画面でワールドを選んでから遊び始める（選んでいる間も島は背景として描画しておく） ----
const chosen = await showTitle();
if (chosen.data)
    restore(chosen.data);
else
    player.restore(startPlayer);
world = chosen.meta;
document.getElementById('world-name').textContent = world.name;
save(); // 新しいワールドもすぐ一覧に残るように
refreshOverlay();
