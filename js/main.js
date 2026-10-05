import * as THREE from 'three';
import { PALETTE } from './core/palette.js';
import { createTerrain } from './world/terrain.js';
import { buildProps } from './world/props.js';
import { Player } from './player/player.js';
import { Inventory, ITEMS } from './items/inventory.js';
import { Vitals } from './player/vitals.js';
import { TreeChopper } from './actions/chopping.js';
import { ToolHand, EmptyHand, ItemHand, VIEW_LAYER, buildAxe, buildFishingRodRig, buildHammer, buildPickaxe, buildStoneKnife } from './player/hand.js';
import { ItemDrops } from './items/drops.js';
import { BushForager } from './actions/foraging.js';
import { RockMiner } from './actions/mining.js';
import { Fisher } from './actions/fishing.js';
import { Physics, WATER_LEVEL } from './core/physics.js';
import { Sea } from './world/water.js';
import { Grass } from './world/grass.js';
import { setWaveTime, waveOffset } from './core/waves.js';
import { Builder } from './actions/build.js';
import { Crafting } from './actions/crafting.js';
import { saveWorld, SAVE_VERSION } from './core/save.js';
import { showTitle, showToast } from './ui/title.js';
import { setKeyGuide } from './ui/keyGuide.js';
import { Eater, Drinker, EAT_TIME, FOODS } from './actions/food.js';
import { DeathScreen } from './ui/death.js';
import { installUiScale } from './ui/uiScale.js';
import { WorldClock } from './world/clock.js';
import { Sky } from './world/sky.js';
import { ClockHud } from './ui/clock.js';
import { BeachPebbles } from './world/pebbles.js';
import { PickupFeed } from './ui/pickupFeed.js';
installUiScale(); // UI の大きさを画面サイズに合わせる
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // くっきりめの影
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const seaColor = new THREE.Color(PALETTE.water);
const deepColor = new THREE.Color();
scene.background = new THREE.Color(PALETTE.sky);
const fog = new THREE.Fog(PALETTE.sky, 50, 230); // 遠景を空色に溶かす
scene.fog = fog;
const CAMERA_FAR = 600; // 描画する最大の距離（空の太陽・月・星より奥）
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, CAMERA_FAR);
// ---- ライティング：半球光＋太陽1つ（夜は同じ光を月明かりにする。向き・色・強さは Sky が時刻から決める） ----
const hemi = new THREE.HemisphereLight(PALETTE.sky, PALETTE.grass, 1.1);
hemi.layers.enable(VIEW_LAYER); // 手や持ち物も照らす
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.layers.enable(VIEW_LAYER);
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
// 影は島全体を毎回描き直すと重いので、何フレームかに1回だけ描き直す（太陽はゆっくりしか動かない）
const SHADOW_INTERVAL = 2;
renderer.shadowMap.autoUpdate = false;
let shadowFrame = 0;
// ---- 時間（1日目の朝から始まり、昼12分・夜6分で1日が過ぎる） ----
const clock = new WorldClock();
const sky = new Sky(scene, hemi, sun);
const clockHud = new ClockHud();
// ---- ワールド ----
const physics = await Physics.create();
const terrain = createTerrain();
scene.add(terrain);
physics.addTerrain(terrain);
const sea = new Sea();
scene.add(sea.mesh);
const props = buildProps();
scene.add(props.group);
for (const mesh of props.solids)
    if (!props.rocks.includes(mesh))
        physics.addStatic(mesh); // 岩の当たり判定は RockMiner が付ける
const grass = new Grass(props.rocks, props.platforms);
scene.add(grass.mesh);
// ---- プレイヤー ----
const player = new Player(camera, renderer.domElement, physics, props.platforms, props.spawn);
// ---- インベントリ ----
const inventory = new Inventory();
// 手に入れた素材を右下に出す
const pickupFeed = new PickupFeed();
/** 拾ったり採ったりした物をインベントリに入れ、獲得ログに出す。持ちきれない分はなくなる（dmg は使いかけの道具の減った耐久値） */
const gain = (item, count, dmg) => {
    const lost = inventory.add(item, count, dmg);
    pickupFeed.show(item, count - lost, inventory.count(item), lost);
};
/** 手に持っている道具を1回使った分だけ傷める。耐久値が尽きて壊れたら知らせる */
const wearTool = (item) => {
    if (inventory.wear(item))
        showToast(`${ITEMS[item].name}が壊れた`);
};
// ---- HP・空腹・水分 ----
const vitals = new Vitals();
// ---- 斧で木を切る ----
scene.add(camera); // 手に持つ斧や木材をカメラの子として描画するため
const hand = new ToolHand(camera, buildAxe());
// ハンマーは建てたり壊したりしたときに振る
const hammerHand = new ToolHand(camera, buildHammer());
// 石のナイフは左クリックで振り、茂みを刈る
const knifeHand = new ToolHand(camera, buildStoneKnife());
// 石のツルハシは左クリックで振り、岩を叩いて壊す
const pickaxeHand = new ToolHand(camera, buildPickaxe());
// 釣り竿は長いので前へ倒して構える（右クリック長押しで投げ、左クリックで巻く）
const ROD_LEAN = 0.45;
const rodRig = buildFishingRodRig();
const rodHand = new ToolHand(camera, rodRig.root, ROD_LEAN);
// 木材・板・枝・葉っぱ・魚・ベリーは選んでいる間、手に持って見せる
const materialHands = ['wood', 'plank', 'stick', 'leaf', 'fish', 'berry'].map((kind) => ({ kind, hand: new ItemHand(camera, kind) }));
// 何も持っていない（空のスロットを選んでいる）ときは素手を見せる
const emptyHand = new EmptyHand(camera);
const chopper = new TreeChopper(props.group, props.trees, physics);
// 丸太をばらすと木材が散らばり、視線を合わせて F を押すと1つずつ回収できる（木材は水に浮く）。
// G で落とした物も同じように地面に転がり、F で拾える
const drops = new ItemDrops(props.group, physics);
chopper.onSplit = (trunk, wood) => drops.spawn(trunk, wood);
drops.onCollect = gain;
// 砂浜には小石（石）が落ちていて、拾われて減ると時間がたつと増える。岩・木・桟橋のそばには置かない
const PEBBLE_CLEARANCE = 1.2; // 岩や木の縁からこれだけ離す
const pebbleObstacles = [...props.rocks, ...props.trees.map((t) => t.trunk)].map((o) => {
    const sphere = new THREE.Box3().setFromObject(o).getBoundingSphere(new THREE.Sphere());
    return { x: sphere.center.x, z: sphere.center.z, r: Math.min(sphere.radius, 2.5) + PEBBLE_CLEARANCE };
});
const pebbles = new BeachPebbles(drops, (x, z) => pebbleObstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r) ||
    props.platforms.some((p) => x > p.minX - 1 && x < p.maxX + 1 && z > p.minZ - 1 && z < p.maxZ + 1));
// 茂みはこぶし（10回）・石のナイフ・斧（5回）で叩いて壊す。叩くたびに葉っぱ・枝・実が少しずつ採れ、ナイフならツルも採れる。
// 実は F で1つずつ摘むこともできる（壊れた茂みはしばらくすると生え直す）
const forager = new BushForager(props.group, props.bushes);
forager.onHarvest = gain;
// ---- 食べる・飲む（ベリーを持って右クリックで食べる。水面を見て F で飲む） ----
const eater = new Eater(inventory, vitals);
// 視線をさえぎる物（地形・岩・桟橋など）。建てた部材もここに足されていく
const aimTargets = [terrain, ...props.solids];
const drinker = new Drinker(props.group, aimTargets, vitals);
// 岩は石のツルハシで叩くと石が少しずつ採れ、耐久値が 0 になると石がまとめて採れて、岩は塊にばらけて消える（大きい岩ほど叩く回数も石も多い）
const miner = new RockMiner(props.group, props.rocks, physics, aimTargets, [...props.trees.map((t) => t.object), ...props.bushes]);
miner.onHarvest = gain;
// 釣り：右クリック長押しでゲージを溜めて投げ、左クリック長押しで巻く。かかった魚を岸まで寄せると釣れる
const fisher = new Fisher(scene, rodHand, rodRig, aimTargets);
fisher.onCatch = (item, count) => {
    gain(item, count);
    wearTool('fishingRod');
};
// 斧や素手で建てた部材を叩くと耐久値が減り、0 になると壊れる（部材より手前に木や茂みがあれば、そちらを叩く）。
// 道具は何かに当てるたびに自分の耐久値も 1 減る（空振りでは減らない）
const AXE_REACH = 3.2; // 斧で部材を叩ける距離
hand.onImpact = () => {
    if (builder.strike('axe', AXE_REACH) || forager.harvest(camera, 'axe', AXE_REACH) || chopper.chop(camera))
        wearTool('axe');
};
// 素手で殴ると、木なら木くずが少し飛ぶ（木は倒れず、何も採れない）。茂みは耐久値が減る
const PUNCH_REACH = 2.2;
// 石のナイフで茂みを刈る（刈り取るとツルも採れる）
const KNIFE_REACH = 2.6;
const PICK_REACH = 3.2;
pickaxeHand.onImpact = () => {
    if (miner.mine(camera, 'pickaxe', PICK_REACH))
        wearTool('pickaxe');
};
knifeHand.onImpact = () => {
    if (forager.harvest(camera, 'knife', KNIFE_REACH))
        wearTool('stoneKnife');
};
emptyHand.onImpact = () => {
    if (!builder.strike('fist', PUNCH_REACH) && !forager.harvest(camera, 'fist', PUNCH_REACH))
        chopper.punch(camera, PUNCH_REACH);
};
// ---- 建築（ハンマーを持って右クリックで部材を選び、左クリックで視線の先に建てる。X で壊す。作業台はアイテムを持って置く） ----
const blockers = [...props.trees.map((t) => t.object), ...props.bushes]; // 木や茂みの奥には置けない
const builder = new Builder(props.group, camera, terrain, aimTargets, blockers, physics, props.platforms, inventory);
// 建てた床などの下から草が生えないようにする
builder.onChange = () => grass.setCovered((x, y, z) => builder.covers(x, y, z));
builder.onWork = () => {
    hammerHand.swing();
    wearTool('hammer'); // 作業台はハンマーなしで置けるので、ハンマーを持っていなければ減らない
};
// ---- ワールドコマンド（共有ワールドの変更はすべてここを通す） ----
/** コマンドを適用する。マルチでは、ホストから届いたコマンドもここで適用する */
const applyWorld = (cmd) => {
    switch (cmd.type) {
        case 'placePiece':
        case 'removePiece':
        case 'hitPiece':
            builder.apply(cmd);
            break;
        case 'dropItem':
        case 'pickDrop':
            drops.apply(cmd);
            break;
        case 'harvestBush':
        case 'pickBerry':
            forager.apply(cmd);
            break;
        case 'mineRock':
            miner.apply(cmd);
            break;
    }
};
/** 頼みを出す。ひとりで遊ぶときは自分がホストなので、その場で確かめて適用する。適用できたら true */
const requestWorld = (req) => {
    const cmd = req.type === 'dropItem' || req.type === 'pickDrop'
        ? drops.authorize(req)
        : req.type === 'harvestBush' || req.type === 'pickBerry'
            ? forager.authorize(req)
            : req.type === 'mineRock'
                ? miner.authorize(req)
                : builder.authorize(req);
    if (!cmd)
        return false;
    applyWorld(cmd);
    return true;
};
builder.request = requestWorld;
drops.request = requestWorld;
pebbles.request = requestWorld;
forager.request = requestWorld;
miner.request = requestWorld;
// ---- クラフト（インベントリを開くと手元の台、作業台で F を押すと天板に素材を置いて作る） ----
const crafting = new Crafting(props.group, camera, renderer.domElement, inventory);
crafting.benchExists = (pid) => builder.has(pid);
// ---- F：拾う・茂みの実を摘む・作業台を使う・水を飲む ----
const USE_REACH = 3.5; // 作業台を使える距離
/** 視線の先にある、使える作業台 */
const aimedWorkbench = () => {
    const piece = builder.aimedPiece(USE_REACH);
    return piece?.id === 'workbench' ? piece : null;
};
addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && player.controls.isLocked && !inventory.isOpen) {
        if (drops.collect(camera, (item) => inventory.room(item)) || forager.pick(camera))
            return;
        const bench = aimedWorkbench();
        if (bench)
            crafting.useBench(bench);
        else
            drinker.drink(camera);
    }
});
// ---- G：持っている物を1個落とす（Ctrl+G でまるごと）。インベントリを開いているときは、つまんでいる物かマウスが乗っているマス ----
addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG' || !world || death.isOpen || builder.menu.isOpen)
        return;
    if (!player.controls.isLocked && !inventory.isOpen)
        return;
    e.preventDefault(); // Ctrl+G（ブラウザの「次を検索」）を止める
    const stack = inventory.take(e.ctrlKey);
    if (!stack)
        return;
    if (!drops.throw(stack.item, stack.count, stack.dmg, camera.position, camera.getWorldDirection(new THREE.Vector3())))
        inventory.putBack(stack);
});
renderer.domElement.addEventListener('mousedown', (e) => {
    if (!player.controls.isLocked)
        return;
    if (builder.active) {
        if (e.button === 0)
            builder.place();
        else if (e.button === 2 && builder.hammer)
            builder.menu.setOpen(true);
        return;
    }
    const held = inventory.selectedStack;
    if (e.button === 0) {
        hand.swing();
        knifeHand.swing();
        pickaxeHand.swing();
        emptyHand.punch();
        if (rodHand.visible)
            fisher.setReeling(true);
    }
    else if (e.button === 2) {
        if (rodHand.visible)
            fisher.startCharge();
        else if (held && eater.start(held.item))
            materialHands.find((m) => m.kind === held.item)?.hand.eat(EAT_TIME);
    }
});
addEventListener('mouseup', (e) => {
    if (e.button === 0)
        fisher.setReeling(false);
    else if (e.button === 2)
        fisher.release(camera);
});
// 一時停止したら、溜めていたゲージと巻き取りをやめる
player.controls.addEventListener('unlock', () => {
    fisher.stopCharge();
    fisher.setReeling(false);
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
    pebbles: pebbles.serialize(),
    rocks: miner.serialize(),
    built: builder.serialize(),
    clock: clock.serialize(),
});
const restore = (data) => {
    builder.restore(data.built); // 床などの足場を先に置いてからプレイヤーを戻す
    chopper.restore(data.trees);
    forager.restore(data.bushes);
    miner.restore(data.rocks);
    drops.restore(data.drops);
    pebbles.restore(data.pebbles); // 落とし物を戻してから（まだ小石を置いていないワールドなら置く）
    inventory.restore(data.inventory);
    vitals.restore(data.vitals);
    player.restore(data.player);
    clock.restore(data.clock);
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
// ---- HP が尽きたら「力尽きた」画面（リスポーンするとスタート地点へ。持ち物はそのまま） ----
const death = new DeathScreen();
death.onRespawn = () => {
    vitals.reset();
    player.restore(startPlayer);
    death.setOpen(false);
    save();
    player.controls.lock();
};
death.onQuit = () => {
    save();
    location.reload();
};
const menuOpen = () => inventory.isOpen || death.isOpen || builder.menu.isOpen;
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
overlay.addEventListener('click', () => player.controls.lock());
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
// Ctrl+W（タブを閉じる）はブラウザが止めさせてくれないので、せめてプレイ中は閉じる前に確認を出す
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
        builder.menu.setOpen(false, false); // 部材を選ぶメニューの上からインベントリを開いたら、メニューは閉じる
    crafting.setOpen(open);
    onMenuToggle(open, resume);
};
builder.menu.onToggle = onMenuToggle;
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});
/** 時刻に合わせた空と光にする。水中では光を弱めて青く染め、深いほど暗い霧で視界を狭める（夜はさらに暗く） */
function applySky(underwater) {
    sky.update(clock.hour, camera);
    sky.visible = !underwater;
    sea.setDaylight(THREE.MathUtils.lerp(0.25, 1, sky.daylight));
    if (!underwater) {
        fog.color.copy(sky.color);
        fog.near = 50;
        fog.far = 230;
    }
    else {
        const depth = THREE.MathUtils.clamp(WATER_LEVEL - camera.position.y, 0, 8);
        deepColor.copy(seaColor).multiplyScalar((0.85 - depth * 0.05) * THREE.MathUtils.lerp(0.25, 1, sky.daylight));
        fog.color.copy(deepColor);
        fog.near = 0;
        fog.far = 34 - depth * 2;
        hemi.color.copy(sky.color).lerp(seaColor, 0.5);
        hemi.groundColor.copy(deepColor);
        hemi.intensity *= 0.9;
        sun.color.copy(sky.color);
        sun.intensity *= (1.3 - depth * 0.08) / 2.4;
    }
    scene.background.copy(fog.color);
    // 霧で見えなくなる先は描かない（水中では視界が狭いので、遠くの物を画面外として省ける）
    const far = underwater ? fog.far + 1 : CAMERA_FAR;
    if (camera.far !== far) {
        camera.far = far;
        camera.updateProjectionMatrix();
    }
}
/** タイトル画面の背景：島の周りをゆっくり回る */
function orbitCamera(t) {
    const a = t * 0.05;
    camera.position.set(Math.cos(a) * 78, 24, Math.sin(a) * 78);
    camera.lookAt(0, 2, 0);
}
const timer = new THREE.Clock();
renderer.setAnimationLoop(() => {
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.elapsedTime;
    setWaveTime(t);
    sea.update(t);
    grass.update(t, camera.position, fog.far);
    if (world)
        player.update(dt);
    else
        orbitCamera(t);
    crafting.update(dt); // 作業台を使っているときは、カメラを天板に寄せる
    if (player.controls.isLocked) {
        vitals.update(dt); // 一時停止中・インベントリ表示中は減らさない
        clock.update(dt); // 時間も止める（マルチではホストが止めずに進め、参加者には時刻を配る）
        pebbles.update(dt); // マルチではホストだけが進める
        autosaveTimer += dt;
        if (autosaveTimer >= AUTOSAVE_INTERVAL)
            save(true);
    }
    if (world && vitals.dead && !death.isOpen) {
        death.setOpen(true);
        inventory.setOpen(false, false);
        player.controls.unlock();
        refreshOverlay();
    }
    eater.update(dt);
    drinker.update(dt);
    // タイトル画面とクラフト中は何も持たない（手元の台や天板に手が重ならないように）
    const held = world && !crafting.isOpen ? inventory.selectedStack : null;
    hand.visible = held?.item === 'axe';
    hand.update(dt);
    hammerHand.visible = held?.item === 'hammer';
    hammerHand.update(dt);
    knifeHand.visible = held?.item === 'stoneKnife';
    knifeHand.update(dt);
    pickaxeHand.visible = held?.item === 'pickaxe';
    pickaxeHand.update(dt);
    rodHand.visible = held?.item === 'fishingRod';
    rodHand.update(dt);
    fisher.update(dt, camera, rodHand.visible);
    for (const { kind, hand: h } of materialHands) {
        h.setCount(held?.item === kind ? held.count : 0);
        h.update(dt, player.walking);
    }
    emptyHand.visible = !!world && !held && !builder.active && !crafting.isOpen;
    emptyHand.update(dt, player.walking);
    chopper.update(dt);
    physics.step(dt);
    drops.update(dt, camera.position);
    forager.update(dt);
    miner.update(dt);
    builder.update(dt);
    applySky(camera.position.y < WATER_LEVEL + waveOffset(camera.position.x, camera.position.z));
    clockHud.visible = !!world && !death.isOpen;
    clockHud.update(clock.day, clock.hour, clock.isNight);
    const pickup = drops.isAiming(camera)
        ? '[F]：拾う'
        : forager.canPick(camera)
            ? '[F]：実を摘む'
            : aimedWorkbench()
                ? '[F]：作業台を使う'
                : vitals.canDrink && drinker.aimed(camera)
                    ? '[F]：水を飲む'
                    : held && FOODS[held.item] && vitals.canEat && !builder.active
                        ? '[右]：食べる'
                        : '';
    // 傷ついた部材を見ているときは、のこりの耐久値も出す
    const durability = builder.durability(AXE_REACH) ?? (held?.item === 'pickaxe' ? miner.durability(camera, PICK_REACH) : null);
    const hint = [rodHand.visible && (fisher.busy || !pickup) ? fisher.hint : pickup, durability ? `耐久 ${durability.hp}/${durability.max}` : ''].filter(Boolean).join(' ／ ');
    if (hint)
        setKeyGuide(pickupHint, hint);
    pickupHint.classList.toggle('hidden', !player.controls.isLocked || menuOpen() || !hint);
    render();
});
/** 世界を描いてから、深度を消して手や持ち物を上に重ねる（近くの木や岩に手がめり込まないように） */
function render() {
    camera.layers.set(0);
    renderer.shadowMap.needsUpdate = shadowFrame++ % SHADOW_INTERVAL === 0;
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.shadowMap.needsUpdate = false; // 手を重ねる2回目は、1回目の影を使う
    renderer.clearDepth();
    camera.layers.set(VIEW_LAYER);
    // 背景が色だと render() のたびに画面全体が塗りつぶされるので、2回目は背景を外す
    const background = scene.background;
    scene.background = null;
    renderer.render(scene, camera);
    scene.background = background;
    camera.layers.set(0);
    renderer.autoClear = true;
}
// ---- タイトル画面でワールドを選んでから遊び始める（選んでいる間も島は背景として描画しておく） ----
const chosen = await showTitle();
if (chosen.data)
    restore(chosen.data);
else {
    player.restore(startPlayer);
    pebbles.fill();
}
world = chosen.meta;
document.getElementById('world-name').textContent = world.name;
save(); // 新しいワールドもすぐ一覧に残るように
refreshOverlay();
