import * as THREE from 'three';
import { PALETTE } from './core/palette.js';
import { createTerrain, islandField, setActiveField, terrainHeight } from './world/terrain.js';
import { buildProps } from './world/props.js';
import { buildTown, townField } from './world/town.js';
import { LOCATIONS, toLocation } from './world/location.js';
import { Player } from './player/player.js';
import { Inventory, ITEMS } from './items/inventory.js';
import { RecipeBook } from './items/recipeBook.js';
import { Vitals } from './player/vitals.js';
import { TreeChopper } from './actions/chopping.js';
import { ToolHand, EmptyHand, ItemHand, VIEW_LAYER, buildAxe, buildFishingRodRig, buildHammer, buildPickaxe, buildShovel, buildSpear, buildStoneKnife, THRUST_MOTION } from './player/hand.js';
import { ItemDrops } from './items/drops.js';
import { BushForager } from './actions/foraging.js';
import { RockMiner } from './actions/mining.js';
import { GroundDigger } from './actions/digging.js';
import { Fisher } from './actions/fishing.js';
import { FISH_IDS } from './items/fishKinds.js';
import { COLLIDE, Physics, RAPIER, WATER_LEVEL } from './core/physics.js';
import { Sea, bakeSeabed } from './world/water.js';
import { Grass } from './world/grass.js';
import { setWaveScale, setWaveTime, waveOffset } from './core/waves.js';
import { Builder } from './actions/build.js';
import { Boats } from './actions/boats.js';
import { Spears } from './actions/spears.js';
import { Crafting } from './actions/crafting.js';
import { Campfires } from './actions/campfire.js';
import { CampfireMenu } from './actions/campfireMenu.js';
import { loadGuest, saveGuest, saveWorld, SAVE_VERSION } from './core/save.js';
import { ROOM_PARAM, showTitle, showToast } from './ui/title.js';
import { setKeyGuide } from './ui/keyGuide.js';
import { Eater, Drinker, EAT_TIME, FOODS } from './actions/food.js';
import { DeathScreen } from './ui/death.js';
import { installUiScale } from './ui/uiScale.js';
import { WorldClock } from './world/clock.js';
import { Sky } from './world/sky.js';
import { Weather } from './world/weather.js';
import { Rain } from './world/rain.js';
import { Wind } from './world/wind.js';
import { ClockHud } from './ui/clock.js';
import { BeachPebbles } from './world/pebbles.js';
import { PickupFeed } from './ui/pickupFeed.js';
import { ChargeRing } from './ui/chargeRing.js';
import { FARMER_LOOK, Npc, pierSpot } from './world/npc.js';
import { Guide } from './story/guide.js';
import { Shop } from './story/shop.js';
import { FINISH_TOAST } from './story/quests.js';
import { SeaMap, travelFade } from './ui/seaMap.js';
import { Avatar, AVATAR_LAYER, loadLook } from './player/avatar.js';
import { AvatarMenu } from './ui/avatarEditor.js';
import { CommandMenu } from './ui/commandMenu.js';
import { OtherPlayers } from './player/others.js';
import { Multiplayer } from './net/multiplayer.js';
import { RoomInfo } from './ui/roomInfo.js';
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
sun.shadow.camera.layers.enable(AVATAR_LAYER); // 自分の体は一人称でも影を落とす
scene.add(sun);
// 影は島全体を毎回描き直すと重いので、何フレームかに1回だけ描き直す（太陽はゆっくりしか動かない）
const SHADOW_INTERVAL = 2;
renderer.shadowMap.autoUpdate = false;
let shadowFrame = 0;
// ---- 時間（1日目の朝から始まり、昼12分・夜6分で1日が過ぎる） ----
const clock = new WorldClock();
const sky = new Sky(scene, hemi, sun);
const clockHud = new ClockHud();
// ---- 天気（時刻から決まるので、時刻と一緒にそろう。セーブする物もない） ----
const weather = new Weather();
const rain = new Rain();
scene.add(rain.object);
const wind = new Wind(); // 草・木の葉・茂みを、天気の風の強さに合わせて揺らす
const RAIN_FOG_NEAR = 18; // いちばん強い雨のときの霧の始まり（晴れは 50）
const RAIN_FOG_FAR = 120; // いちばん強い雨のときに見える距離（晴れは 230）
const SHELTER_HEIGHT = 12; // 頭の上のこの高さまでに屋根などがあれば、雨に打たれない
const shelterRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
const RAIN_BRIGHT = 1.5; // 雨の色を空の色よりどれだけ明るくするか（暗い空でも見えるように）
const rainColor = new THREE.Color();
const RAIN_RAY_ABOVE = 20; // しぶきを出す所を、カメラのどれだけ上から真下へ調べるか
const rainRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
/** 雨が当たる面の高さ（屋根・地面・岩・水面のいちばん上。しぶきを出す所） */
const rainSurface = (x, z) => {
    const top = camera.position.y + RAIN_RAY_ABOVE;
    rainRay.origin = { x, y: top, z };
    const hit = physics.world.castRay(rainRay, RAIN_RAY_ABOVE * 3, true, undefined, COLLIDE.shelterQuery);
    const ground = hit ? top - hit.timeOfImpact : terrainHeight(x, z);
    return Math.max(ground, WATER_LEVEL + waveOffset(x, z));
};
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
// 桟橋の前に立っている住人（近づくとこちらを向く）
const pierNpc = pierSpot(props.pierFoot);
const npc = new Npc(pierNpc.position, pierNpc.yaw);
props.group.add(npc.object);
physics.addStatic(npc.collider);
const grass = new Grass(props.rocks, props.platforms);
scene.add(grass.mesh);
// ---- 街（船で世界の端まで行くと海図が開き、そこから渡る別の場所。今は石造りの港だけ） ----
// 街の当たり判定は1つの剛体にまとめ、街にいる間だけ動かす
const town = buildTown();
scene.add(town.group);
const townBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setEnabled(false));
const townTerrainCollider = physics.addTerrain(town.terrain, townBody);
for (const mesh of town.solids)
    physics.addStatic(mesh, townBody);
// 広場の屋台に立っている農家（いつでも取引できる）
const farmer = new Npc(town.farmerSpot.position, town.farmerSpot.yaw, FARMER_LOOK);
town.group.add(farmer.object);
physics.addStatic(farmer.collider, townBody);
const islandTerrainCollider = physics.terrainCollider;
// 浅瀬の色と波打ち際の泡に使う海底は、場所ごとに作っておいて差し替える
const islandSeabed = bakeSeabed((x, z) => islandField.height(x, z));
const townSeabed = bakeSeabed((x, z) => townField.height(x, z));
// ---- プレイヤー ----
const player = new Player(camera, renderer.domElement, physics, props.platforms, props.spawn);
// ---- 自分の体（アバター）。一人称では影だけ落とし、V で三人称にすると姿が見える。見た目はタイトル画面か一時停止の画面で選ぶ ----
const THIRD_DIST = 3.4; // 三人称のカメラを、目からどれだけ後ろへ離すか
const THIRD_SIDE = 0.7; // 右へずらす量（照準の先が自分の頭に隠れないように）
const THIRD_UP = 0.3; // 上へずらす量
const CAMERA_MARGIN = 0.25; // 三人称のカメラを、間にある壁や地面からこれだけ手前に置く
const AIM_RANGE = 40; // 三人称で照準を出す、視線の先の最大の距離
const VIEW_KEY = 'warfarming:view'; // 視点の好み（このブラウザに覚えておく）
const avatar = new Avatar(loadLook());
avatar.object.visible = false; // ワールドを選ぶまでは出さない
scene.add(avatar.object);
const avatarPose = { p: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, state: 'ground', crouch: 0 };
let thirdPerson = false;
try {
    thirdPerson = localStorage.getItem(VIEW_KEY) === 'third';
}
catch {
    // 読めなければ一人称で始める
}
/** 自分の体で道具を振る（マルチでは、ほかの人の画面の自分の体も振る） */
const swingBody = (kind) => {
    avatar.swing(kind);
    net.swing(kind);
};
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
// 木のスコップは左クリックで振り、地面を掘る
const shovelHand = new ToolHand(camera, buildShovel());
// 釣り竿は長いので前へ倒して構える（右クリック長押しで投げ、左クリックで巻く）
const ROD_LEAN = 0.45;
const rodRig = buildFishingRodRig();
const rodHand = new ToolHand(camera, rodRig.root, ROD_LEAN);
// 石の槍も長いので、釣り竿と同じだけ前へ倒して構える（左クリックで前へ突き、茂みを刈る。右クリック長押しで力を溜めて投げる）
const spearHand = new ToolHand(camera, buildSpear(), ROD_LEAN, THRUST_MOTION);
// 木材・板・枝・葉っぱ・魚・ベリー・木の種・土・設計図・船・焚火は選んでいる間、手に持って見せる
const materialHands = ['wood', 'plank', 'stick', 'leaf', ...FISH_IDS, 'berry', 'seed', 'dirt', 'boatBlueprint', 'boat', 'campfire'].map((kind) => ({ kind, hand: new ItemHand(camera, kind) }));
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
const pebbleObstacles = [...props.rocks, ...props.trees.map((t) => t.trunk), npc.collider].map((o) => {
    const sphere = new THREE.Box3().setFromObject(o).getBoundingSphere(new THREE.Sphere());
    return { x: sphere.center.x, z: sphere.center.z, r: Math.min(sphere.radius, 2.5) + PEBBLE_CLEARANCE };
});
const pebbles = new BeachPebbles(drops, (x, z) => pebbleObstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r) ||
    props.platforms.some((p) => x > p.minX - 1 && x < p.maxX + 1 && z > p.minZ - 1 && z < p.maxZ + 1));
// 茂みはこぶし（10回）・石のナイフ・斧（5回）で叩いて壊す。叩くたびに葉っぱ・枝・実が少しずつ採れ、ナイフならツルも採れる。
// 実は F で1つずつ摘むこともできる（壊れた茂みはしばらくすると生え直す）
const forager = new BushForager(props.group, props.bushes);
for (const bush of props.bushes)
    wind.addSwaying(bush); // 茂みは実ごと風で傾ける
forager.onHarvest = gain;
// ---- 食べる・飲む（ベリーを持って右クリックで食べる。水面を見て F で飲む） ----
const eater = new Eater(inventory, vitals);
// 視線をさえぎる物（地形・岩・桟橋など）。建てた部材もここに足されていく
const aimTargets = [terrain, ...props.solids, npc.collider, town.terrain, ...town.solids, farmer.collider]; // 今いない場所の物は隠すので、視線も当たらない
const drinker = new Drinker(props.group, aimTargets, vitals);
// 岩は石のツルハシで叩くと石が少しずつ採れ、耐久値が 0 になると石がまとめて採れて、岩は塊にばらけて消える（大きい岩ほど叩く回数も石も多い）
const miner = new RockMiner(props.group, props.rocks, physics, aimTargets, [...props.trees.map((t) => t.object), ...props.bushes]);
miner.onHarvest = gain;
// 釣り：右クリック長押しでゲージを溜めて投げ、左クリック長押しで巻く。かかった魚を岸まで寄せると釣れる（水深と昼夜で釣れる魚が変わる）
const fisher = new Fisher(scene, rodHand, rodRig, aimTargets, () => clock.isNight);
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
const SHOVEL_REACH = 3; // スコップで掘れる距離・土で穴を埋められる距離
/** 土を持って右クリック：狙っている穴を、土を1つ使って埋める。埋めたら true */
const fillHole = () => {
    if (inventory.count('dirt') < 1 || !digger.fill(camera, SHOVEL_REACH))
        return false;
    inventory.remove('dirt', 1);
    swingBody('chop');
    return true;
};
shovelHand.onImpact = () => {
    if (digger.dig(camera, 'shovel', SHOVEL_REACH))
        wearTool('shovel');
};
knifeHand.onImpact = () => {
    if (forager.harvest(camera, 'knife', KNIFE_REACH))
        wearTool('stoneKnife');
};
// 石の槍は先に石のナイフが付いているので、ナイフと同じく茂みを刈れる（ツルも採れる）。柄が長い分だけ遠くまで届く
const SPEAR_REACH = 3.4;
spearHand.onImpact = () => {
    if (forager.harvest(camera, 'knife', SPEAR_REACH))
        wearTool('spear');
};
emptyHand.onImpact = () => {
    if (!builder.strike('fist', PUNCH_REACH) && !forager.harvest(camera, 'fist', PUNCH_REACH))
        chopper.punch(camera, PUNCH_REACH);
};
// ---- 建築（ハンマーを持って右クリックで部材を選び、左クリックで視線の先に建てる。X で壊す。作業台はアイテムを持って置く） ----
const blockers = [...props.trees.map((t) => t.object), ...props.bushes]; // 木や茂みの奥には置けない
const builder = new Builder(props.group, camera, terrain, aimTargets, blockers, physics, props.platforms, inventory);
// 地面はスコップで掘ると小さな穴があき、土が採れる（穴は自分の島の地面にだけ掘れる。建てた部材や桟橋の下は掘れない）
const digger = new GroundDigger(props.group, terrain, aimTargets, blockers);
digger.onHarvest = gain;
digger.canDigAt = (x, z) => !builder.covers(x, islandField.height(x, z), z) &&
    !(here === 'island' ? props.platforms : islandPlatforms).some((p) => x > p.minX - 0.3 && x < p.maxX + 0.3 && z > p.minZ - 0.3 && z < p.maxZ + 0.3);
// 建てた床などの下や、掘った穴の中から草が生えないようにする
const coverGrass = () => grass.setCovered((x, y, z) => builder.covers(x, y, z) || digger.covers(x, z));
// ---- 焚火（石と枝で作り、手に持って置く。F で燃料の欄を開き、燃料を入れると燃える。燃料の欄と火は共有ワールド） ----
const campfires = new Campfires(props.group);
builder.contents = (pid) => campfires.contents(pid); // ハンマーで解体すると、燃料の欄の物も戻る
builder.onChange = () => {
    coverGrass();
    campfires.sync(builder.listOf('campfire'));
};
digger.onChange = coverGrass;
builder.onWork = () => {
    hammerHand.swing();
    swingBody('chop');
    wearTool('hammer'); // 作業台はハンマーなしで置けるので、ハンマーを持っていなければ減らない
};
// ---- 船（船を持って左クリックで、視線の先の水面に浮かべる。F で乗り降りし、W/S で漕いで A/D で向きを変える。Q でしまう） ----
// 船はどの場所にも浮かぶので、島の物（props.group）とは別のグループに入れる（見せるかどうかは船ごとに Boats が決める）
const boatGroup = new THREE.Group();
scene.add(boatGroup);
const boats = new Boats(boatGroup, camera, physics, aimTargets, inventory);
// ---- 場所（自分の島・街）。プレイヤーはどれか1つの場所にいて、その場所の物だけを描き、その物とだけぶつかる ----
// 見えなくするのはレイヤーを変えて行う（カメラにも視線のレイキャストにも映らなくなる）
const HIDDEN_LAYER = 31;
/** root 以下を見せる・隠す */
const setShown = (root, shown) => {
    root.traverse((o) => {
        if (shown) {
            o.layers.mask = o.userData.shownLayers ?? 1;
            delete o.userData.shownLayers;
        }
        else if (o.userData.shownLayers === undefined) {
            o.userData.shownLayers = o.layers.mask;
            o.layers.set(HIDDEN_LAYER);
        }
    });
};
setShown(town.group, false);
/** プレイヤーが今いる場所（自分だけの状態。セーブに入れる） */
let here = 'island';
/** 街にいる間に止めている、島の剛体 */
let parkedIsland = [];
/** 街にいる間に預かっている、島の上に乗れる所（桟橋・床など） */
const islandPlatforms = [];
/** プレイヤーを別の場所へ移す（自分の画面の切り替え。船で渡るときは先に sailBoat を適用しておく） */
const goTo = (loc) => {
    if (loc === here)
        return;
    const island = loc === 'island';
    for (const o of [terrain, props.group, grass.mesh])
        setShown(o, island);
    setShown(town.group, !island);
    if (island) {
        physics.unpark(parkedIsland);
        parkedIsland = [];
        townBody.setEnabled(false);
        props.platforms.splice(0, props.platforms.length, ...islandPlatforms);
    }
    else {
        // 島の物（地形・岩・木・部材・落とし物など）の剛体を止める。プレイヤーと船は残す（船は場所ごとに Boats が切り替える）
        parkedIsland = physics.park((b) => b === player.rigidBody || b === townBody || boats.owns(b));
        townBody.setEnabled(true);
        islandPlatforms.splice(0, islandPlatforms.length, ...props.platforms);
        props.platforms.splice(0, props.platforms.length, ...town.platforms);
    }
    physics.terrainCollider = island ? islandTerrainCollider : townTerrainCollider;
    setActiveField(island ? islandField : townField);
    sea.setSeabed(island ? islandSeabed : townSeabed);
    boats.setLocation(loc);
    builder.disabled = !island; // 建てた部材は自分の島にだけ置ける
    here = loc;
};
// 船で世界の端まで漕いでいくと海図を開き、ほかの場所を選ぶと暗転して船ごと渡る
const seaMap = new SeaMap();
boats.onEdge = () => seaMap.open(here);
seaMap.onTravel = (to) => {
    if (to === here)
        return;
    travelFade(LOCATIONS[to].name, () => boats.sail(to));
};
// 渡り終えたら（マルチではホストが渡る先を決めて配ってから）、プレイヤーもその場所へ移る
boats.onSail = (to) => {
    goTo(to);
    const heading = boats.heading;
    if (heading !== null)
        player.face(heading); // 着いた場所の島のほうを向く
};
/** 自分の島でしかできないこと（落とし物や刺さった槍などは、まだ場所を持たない）をしようとしたら知らせる。島にいれば true */
const onIsland = () => {
    if (here === 'island')
        return true;
    showToast('ここではまだできない');
    return false;
};
// ---- 槍を投げる（槍を持って右クリック長押しで力を溜め、離すと視線の向きへ投げる。刺さった槍は F で拾う） ----
const SPEAR_CHARGE_TIME = 0.9; // いっぱいまで溜まる時間（秒）
const SPEAR_MIN_CHARGE = 0.15; // これより溜まる前に離したら投げない（右クリックを押しただけで投げてしまわないように）
// 溜めている間の構え：槍を肩の上へ持ち上げて後ろへ引き、穂先を前へ水平近くまで倒す
const SPEAR_AIM_POS = [0.04, 0.16, 0.24];
const SPEAR_AIM_ROT = [-0.95, 0, 0.06];
const spears = new Spears(props.group, physics);
spears.onCollect = gain;
spears.onBreak = () => showToast(`${ITEMS.spear.name}が壊れた`);
const chargeRing = new ChargeRing();
/** 溜めている力（0〜1）。溜めていなければ null */
let spearCharge = null;
const stopSpearCharge = () => {
    spearCharge = null;
    spearHand.pose([0, 0, 0], [0, 0, 0]);
};
/** 溜めた力で、持っている槍を投げる（少ししか溜めていなければやめる） */
const releaseSpear = () => {
    const charge = spearCharge;
    stopSpearCharge();
    if (charge === null || charge < SPEAR_MIN_CHARGE || !spearHand.visible)
        return;
    const stack = inventory.take(false);
    if (!stack)
        return;
    if (stack.item !== 'spear' || !spears.throw(stack.dmg, camera.position, camera.getWorldDirection(new THREE.Vector3()), charge))
        inventory.putBack(stack);
};
// ---- ワールドコマンド（共有ワールドの変更はすべてここを通す） ----
/** 頼みを確かめ、ホストが決める値を入れたコマンドにする（by は頼んだ人）。できない頼みなら null */
const authorizeWorld = (req, by) => {
    switch (req.type) {
        case 'dropItem':
        case 'pickDrop':
            return drops.authorize(req);
        case 'chopTree':
            return chopper.authorize(req);
        case 'harvestBush':
        case 'pickBerry':
            return forager.authorize(req);
        case 'mineRock':
            return miner.authorize(req);
        case 'digHole':
        case 'fillHole':
            return digger.authorize(req);
        case 'placeBoat':
        case 'pickBoat':
        case 'boardBoat':
        case 'leaveBoat':
        case 'sailBoat':
            return boats.authorize(req, by);
        case 'throwSpear':
        case 'pickSpear':
            return spears.authorize(req);
        case 'setWeather':
            return weather.authorize(req, clock.minutes);
        case 'addFuel':
        case 'takeFuel':
        case 'burnFuel':
            return campfires.authorize(req);
        default:
            return builder.authorize(req);
    }
};
/** コマンドを適用する（by は頼んだ人。自分の頼みなら、採れた物などを自分のインベントリに入れる）。マルチではホストから届いたコマンドもここで適用する */
const applyWorld = (cmd, by) => {
    const mine = by !== null && by === net.myId;
    switch (cmd.type) {
        case 'placePiece':
        case 'removePiece':
        case 'hitPiece':
            builder.apply(cmd, mine);
            break;
        case 'dropItem':
        case 'pickDrop':
            drops.apply(cmd, mine);
            break;
        case 'chopTree':
            chopper.apply(cmd);
            break;
        case 'harvestBush':
        case 'pickBerry':
            forager.apply(cmd, mine);
            break;
        case 'mineRock':
            miner.apply(cmd, mine);
            break;
        case 'digHole':
        case 'fillHole':
            digger.apply(cmd, mine);
            break;
        case 'placeBoat':
        case 'pickBoat':
        case 'boardBoat':
        case 'leaveBoat':
        case 'sailBoat':
            boats.apply(cmd, by, mine);
            break;
        case 'throwSpear':
        case 'pickSpear':
            spears.apply(cmd, mine);
            break;
        case 'setWeather':
            weather.apply(cmd);
            break;
        case 'addFuel':
        case 'takeFuel':
        case 'burnFuel':
            campfires.apply(cmd, mine);
            break;
    }
};
/**
 * マルチの参加者：自分の頼みをホストに断られた（ほかの人が先に拾った・乗った、など）。
 * 頼んだときに先に減らした持ち物などを元に戻す
 */
const undoRequest = (req) => {
    switch (req.type) {
        case 'placePiece':
            builder.refund(req.id);
            break;
        case 'dropItem':
            if (req.item in ITEMS)
                gain(req.item, req.count, req.dmg);
            break;
        case 'throwSpear':
            gain('spear', 1, req.dmg);
            break;
        case 'placeBoat':
            gain('boat', 1);
            break;
        case 'fillHole':
            gain('dirt', 1);
            break;
        case 'addFuel':
            if (req.item in ITEMS)
                gain(req.item, req.count);
            break;
        case 'boardBoat':
            boats.cancelRide(req.bid);
            player.stand();
            break;
        default:
            return; // 叩く・拾うなどは、断られても戻す物がない
    }
    showToast('ほかの人と重なって、できなかった');
};
// ---- マルチプレイ（部屋コードで、PeerJS の WebRTC でブラウザ同士を直接つなぐ） ----
const others = new OtherPlayers(scene); // 同じ部屋にいる、ほかの人の体
const net = new Multiplayer({
    authorize: authorizeWorld,
    apply: applyWorld,
    undo: undoRequest,
    shared: () => sharedSnapshot(),
    motion: () => ({ drops: drops.motion(), trees: chopper.motion() }),
    setMotion: (m) => {
        drops.setMotion(m.drops ?? []);
        chopper.setMotion(m.trees ?? []);
    },
    minutes: () => clock.minutes,
    setMinutes: (minutes) => (clock.minutes = minutes),
    followBoat: (bid, x, z, yaw) => boats.follow(bid, x, z, yaw),
    // 抜けた人が乗っていた船は、その場に残す
    left: (id) => {
        for (const b of boats.riddenBy(id))
            requestWorld({ type: 'leaveBoat', bid: b.bid, p: b.p, yaw: b.yaw }, id);
    },
}, others);
/**
 * 頼みを出す。ひとりで遊ぶとき・ホストは、その場で確かめて適用する（ホストは全員にも配る）。
 * マルチの参加者は手元で確かめてからホストへ送る。適用できたら（送れたら）true
 */
const requestWorld = (req, by) => net.request(req, by);
chopper.request = requestWorld;
builder.request = requestWorld;
drops.request = requestWorld;
pebbles.request = requestWorld;
forager.request = requestWorld;
miner.request = requestWorld;
digger.request = requestWorld;
boats.request = requestWorld;
spears.request = requestWorld;
campfires.request = requestWorld;
const campfireMenu = new CampfireMenu(inventory, campfires);
// ---- クラフト（インベントリを開くと手元の台、作業台で F を押すと天板に素材を置いて作る） ----
const crafting = new Crafting(props.group, camera, renderer.domElement, inventory);
crafting.benchExists = (pid) => builder.has(pid);
// 設計図で覚えるレシピは、覚えるまで候補に出さない（覚えたレシピは自分だけの状態）
const recipeBook = new RecipeBook();
crafting.knows = (recipe) => !recipe.locked || recipeBook.knows(recipe.result);
/** 設計図なら、右クリックで作り方を覚える（設計図は減らない）。設計図だったら true */
const learnFrom = (item) => {
    const result = ITEMS[item].teaches;
    if (!result)
        return false;
    const name = ITEMS[result].name;
    showToast(recipeBook.learn(result) ? `「${name}」の作り方を覚えた` : `「${name}」の作り方はもう覚えている`);
    return true;
};
// ---- 桟橋の住人の頼みごと（最初の手順の案内。進み具合は自分だけの状態） ----
const TALK_REACH = 3.5; // 住人に話しかけられる距離
const guide = new Guide({
    count: (item) => inventory.count(item),
    built: (id) => builder.hasKind(id),
    knows: (item) => recipeBook.knows(item),
    riding: () => boats.riding,
    location: () => here,
}, npc.object.position);
guide.onFinish = () => showToast(FINISH_TOAST);
// 作業台の頼みごとを終えたら、話しかけると取引の画面が開く（ベリーをコインに換え、船の設計図を買う。コインはインベントリのお金のマスに入る）。
// 街へ渡るまでの頼みごとの途中なら、取引の画面に今のヒントを出す。
// 街の農家とは最初から取引できる（取引の中身は items/trades.ts）
const shop = new Shop(inventory);
shop.onGain = gain;
// ---- F：話しかける・拾う・茂みの実を摘む・船に乗り降りする・作業台や焚火を使う・水を飲む ----
const USE_REACH = 3.5; // 作業台や焚火を使える距離
/** 視線の先にある、使える作業台 */
const aimedWorkbench = () => {
    const piece = builder.aimedPiece(USE_REACH);
    return piece?.id === 'workbench' ? piece : null;
};
/** 視線の先にある焚火の番号（低いので、炎のあたりを見ても狙える） */
const aimedCampfire = () => campfires.aimed(camera, USE_REACH, aimTargets);
addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && player.controls.isLocked && !inventory.isOpen) {
        // 船に乗っている間は F で降りる（陸や桟橋に立てればそこへ、なければ船の横の水へ）
        if (boats.riding) {
            const feet = boats.leave((x, z) => player.groundAt(x, z), (p) => player.canStandAt(p));
            if (feet)
                player.standAt(feet);
            else
                showToast('ここでは降りられない');
            return;
        }
        if (!guide.talking && guide.trades && npc.aimed(camera, aimTargets, TALK_REACH))
            return shop.open('pier', guide.tip);
        if (!guide.talking && farmer.aimed(camera, aimTargets, TALK_REACH))
            return shop.open('farmer');
        if (guide.talking || npc.aimed(camera, aimTargets, TALK_REACH))
            return guide.speak();
        if (spears.collect(camera, (item) => inventory.room(item)) || drops.collect(camera, (item) => inventory.room(item)) || forager.pick(camera) || boats.board())
            return;
        const bench = aimedWorkbench();
        const fire = bench ? null : aimedCampfire();
        if (bench)
            crafting.useBench(bench);
        else if (fire !== null)
            campfireMenu.open(fire);
        else
            drinker.drink(camera);
    }
});
// ---- V：一人称と三人称（自分の姿が見える）を切り替える ----
addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || !world || !player.controls.isLocked)
        return;
    thirdPerson = !thirdPerson;
    try {
        localStorage.setItem(VIEW_KEY, thirdPerson ? 'third' : 'first');
    }
    catch {
        // 覚えておけなくても、今の視点はそのまま切り替える
    }
    showToast(thirdPerson ? '三人称視点' : '一人称視点');
});
// ---- Q：狙っている船をしまう（アイテムに戻す） ----
addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ' && player.controls.isLocked && !inventory.isOpen)
        boats.pick();
});
// ---- G：持っている物を1個落とす（Ctrl+G でまるごと）。インベントリを開いているときは、つまんでいる物かマウスが乗っているマス ----
addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG' || !world || death.isOpen || builder.menu.isOpen || shop.isOpen)
        return;
    if (!player.controls.isLocked && !inventory.isOpen)
        return;
    e.preventDefault(); // Ctrl+G（ブラウザの「次を検索」）を止める
    if (!onIsland())
        return;
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
    if (e.button === 0 && held?.item === 'boat') {
        boats.place();
        return;
    }
    if (e.button === 0) {
        hand.swing();
        knifeHand.swing();
        if (spearCharge === null)
            spearHand.swing(); // 投げる力を溜めている間は突かない
        pickaxeHand.swing();
        shovelHand.swing();
        emptyHand.punch();
        // 三人称の体も、手に持っている物に合わせて振る（槍とこぶしは突き出す）
        if (spearHand.visible ? spearCharge === null : hand.visible || knifeHand.visible || pickaxeHand.visible || shovelHand.visible || emptyHand.visible) {
            swingBody(spearHand.visible || emptyHand.visible ? 'thrust' : 'chop');
        }
        if (rodHand.visible)
            fisher.setReeling(true);
    }
    else if (e.button === 2) {
        if (rodHand.visible)
            fisher.startCharge();
        else if (spearHand.visible) {
            if (onIsland())
                spearCharge = 0;
        }
        else if (held?.item === 'dirt' && fillHole())
            return;
        else if (held && learnFrom(held.item))
            return;
        else if (held && eater.start(held.item))
            materialHands.find((m) => m.kind === held.item)?.hand.eat(EAT_TIME);
    }
});
addEventListener('mouseup', (e) => {
    if (e.button === 0)
        fisher.setReeling(false);
    else if (e.button === 2) {
        fisher.release(camera);
        releaseSpear();
    }
});
// 一時停止したら、溜めていたゲージと巻き取りをやめる
player.controls.addEventListener('unlock', () => {
    fisher.stopCharge();
    fisher.setReeling(false);
    stopSpearCharge();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// ---- セーブ（一時停止したとき・30秒ごと・ページを閉じるときに自動で保存する） ----
const AUTOSAVE_INTERVAL = 30;
let world = null; // タイトル画面でワールドを選ぶまでは null
let autosaveTimer = 0;
const startPlayer = player.serialize(); // 新しいワールドの出発地点（タイトル画面ではカメラが島を回るので覚えておく）
/** マルチの参加者として遊んでいるか（共有ワールドはホストがセーブするので、自分だけの状態だけをセーブする） */
let joined = false;
/** 自分だけの状態 */
const personalSnapshot = () => ({
    // 乗っている船と、いる場所も覚えておく
    player: { ...player.serialize(), ...(boats.ridingBid !== null ? { boat: boats.ridingBid } : {}), ...(here !== 'island' ? { loc: here } : {}) },
    inventory: inventory.serialize(),
    vitals: vitals.serialize(),
    guide: guide.serialize(),
    recipes: recipeBook.serialize(),
});
/** 共有ワールドの状態（マルチでは、途中参加した人にまるごと送る） */
const sharedSnapshot = () => ({
    trees: chopper.serialize(),
    bushes: forager.serialize(),
    drops: drops.serialize(),
    pebbles: pebbles.serialize(),
    rocks: miner.serialize(),
    holes: digger.serialize(),
    built: builder.serialize(),
    fires: campfires.serialize(),
    boats: boats.serialize(),
    spears: spears.serialize(),
    clock: clock.serialize(),
    weather: weather.serialize(),
});
const snapshot = () => ({ version: SAVE_VERSION, ...personalSnapshot(), ...sharedSnapshot() });
/** 共有ワールドを戻す（床などの足場を先に置いてから、restorePersonal でプレイヤーを戻す） */
const restoreShared = (data) => {
    builder.restore(data.built);
    campfires.restore(data.fires); // 焚火の部材を置いてから、燃料と火を戻す
    boats.restore(data.boats);
    spears.restore(data.spears);
    chopper.restore(data.trees);
    forager.restore(data.bushes);
    miner.restore(data.rocks);
    digger.restore(data.holes);
    drops.restore(data.drops);
    pebbles.restore(data.pebbles); // 落とし物を戻してから（まだ小石を置いていないワールドなら置く）
    clock.restore(data.clock);
    weather.restore(data.weather);
};
/** 自分だけの状態を戻す（共有ワールドを戻したあとに呼ぶ） */
const restorePersonal = (data) => {
    inventory.restore(data.inventory);
    vitals.restore(data.vitals);
    player.restore(data.player);
    goTo(toLocation(data.player.loc)); // 街にいたら街へ（剛体を全部作り終えてから切り替える）
    if (data.player.boat !== undefined)
        boats.boardById(data.player.boat); // 船に乗ったままセーブしていたら乗り直す
    guide.restore(data.guide);
    recipeBook.restore(data.recipes);
};
const save = (toast = false) => {
    if (!world)
        return;
    autosaveTimer = 0;
    // 参加者は、ホストのワールドの id ごとに自分だけの状態を残す（共有ワールドはホストがセーブする）
    const ok = joined ? saveGuest(world.id, personalSnapshot()) : saveWorld(world.id, snapshot());
    if (!ok)
        showToast('セーブに失敗しました');
    else if (toast)
        showToast('セーブしました');
};
addEventListener('pagehide', () => {
    save();
    net.leave(); // 部屋を開いていたら閉じる（参加者は抜ける）
});
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
    boats.release(); // 船に乗ったまま力尽きたら、船はその場に残す
    vitals.reset();
    goTo('island'); // 街で力尽きても、自分の島のスタート地点に戻る
    player.restore(startPlayer);
    death.setOpen(false);
    save();
    player.controls.lock();
};
death.onQuit = () => {
    save();
    location.reload();
};
// 一時停止の画面から、アバターの見た目を変える画面を開ける
const avatarMenu = new AvatarMenu();
avatarMenu.onChange = (look) => {
    avatar.setLook(look);
    net.setLook(look);
};
document.getElementById('to-avatar').addEventListener('click', (e) => {
    e.stopPropagation(); // オーバーレイのクリック（ゲーム再開）にしない
    avatarMenu.setOpen(true);
});
// ---- コマンドメニュー（Enter で開く。天気を変えるなど） ----
const commandMenu = new CommandMenu();
/** コマンドで打てる天気の名前 */
const WEATHER_WORDS = {
    clear: 'clear', sun: 'clear', 晴れ: 'clear', はれ: 'clear',
    cloudy: 'cloudy', cloud: 'cloudy', くもり: 'cloudy', 曇り: 'cloudy',
    rain: 'rain', 雨: 'rain', あめ: 'rain',
    storm: 'storm', thunder: 'storm', 嵐: 'storm', あらし: 'storm',
    auto: null, 自動: null, じどう: null,
};
const WEATHER_LABELS = { clear: '晴れ', cloudy: 'くもり', rain: '雨', storm: '嵐' };
commandMenu.register({
    name: 'weather',
    aliases: ['天気', '天候', 'てんき'],
    usage: '/weather <晴れ|くもり|雨|嵐|自動>',
    run: ([word]) => {
        const key = word?.toLowerCase() ?? '';
        if (!(key in WEATHER_WORDS))
            return { message: '天気は 晴れ・くもり・雨・嵐・自動 から選んでください', error: true };
        const kind = WEATHER_WORDS[key];
        if (kind === weather.forcedKind)
            return { message: kind ? `もう${WEATHER_LABELS[kind]}にしています` : 'もう自動になっています', error: true };
        requestWorld({ type: 'setWeather', kind }); // 共有ワールドの変更なので、ワールドコマンドの頼みにする
        return { message: kind ? `天気を${WEATHER_LABELS[kind]}にしました` : '天気を自動に戻しました' };
    },
});
commandMenu.addButtons({
    title: '天気',
    buttons: [
        ...Object.keys(WEATHER_LABELS).map((k) => ({ label: WEATHER_LABELS[k], command: `/weather ${k}` })),
        { label: '自動', command: '/weather auto' },
    ],
    current: () => `/weather ${weather.forcedKind ?? 'auto'}`,
});
commandMenu.onResult = (message) => showToast(message);
addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter')
        return;
    if (!world || !player.controls.isLocked || menuOpen())
        return;
    commandMenu.setOpen(true);
});
const menuOpen = () => inventory.isOpen || death.isOpen || builder.menu.isOpen || shop.isOpen || seaMap.isOpen || avatarMenu.isOpen || commandMenu.isOpen;
document.getElementById('to-title').addEventListener('click', (e) => {
    e.stopPropagation(); // オーバーレイのクリック（ゲーム再開）にしない
    save();
    net.leave(); // 部屋を開いていたら閉じる（参加者は抜ける）
    location.reload(); // 読み込み直してタイトル画面に戻る
});
// 一時停止の画面に、部屋にいる人と、友達が参加するときに開くアドレスを出す
const roomInfo = new RoomInfo(document.getElementById('world-name'));
/** 開くとそのまま部屋コードが入る招待リンク */
const inviteLink = () => {
    if (!net.code)
        return null;
    const url = new URL(location.href);
    url.search = `?${ROOM_PARAM}=${net.code}`;
    url.hash = '';
    return url.href;
};
const refreshRoom = () => roomInfo.render({ role: net.role, names: net.names, code: net.code, invite: inviteLink() });
net.onJoin = (name) => {
    showToast(`${name}が参加しました`);
    refreshRoom();
};
net.onLeave = (name) => {
    showToast(`${name}が抜けました`);
    refreshRoom();
};
net.onClosed = () => {
    refreshRoom();
    if (!joined) {
        showToast('部屋が閉じました。ひとりで続けます');
        return;
    }
    save(); // 自分だけの状態を残してからタイトルへ
    world = null;
    alert('ホストとのつながりが切れました。タイトル画面に戻ります。');
    location.reload();
};
const refreshOverlay = () => {
    refreshRoom();
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
    if (open) {
        // 部材を選ぶメニューや取引の画面の上からインベントリを開いたら、そちらは閉じる
        builder.menu.setOpen(false, false);
        shop.setOpen(false, false);
        seaMap.setOpen(false, false);
        avatarMenu.setOpen(false, false);
        commandMenu.setOpen(false, false);
    }
    // 焚火の燃料の欄を開いているときは、手元のクラフトの台は出さない
    crafting.setOpen(open && !campfireMenu.isOpen);
    if (!open)
        campfireMenu.close();
    onMenuToggle(open, resume);
};
builder.menu.onToggle = onMenuToggle;
shop.onToggle = onMenuToggle;
seaMap.onToggle = onMenuToggle;
avatarMenu.onToggle = onMenuToggle;
commandMenu.onToggle = onMenuToggle;
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});
/** 時刻と天気に合わせた空と光にする。雨では霧で遠くをかすませる。水中では光を弱めて青く染め、深いほど暗い霧で視界を狭める（夜はさらに暗く） */
function applySky(underwater, dt) {
    sky.update(clock.minutes, weather, camera, dt);
    sky.visible = !underwater;
    sea.setDaylight(THREE.MathUtils.lerp(0.25, 1, sky.daylight));
    if (!underwater) {
        fog.color.copy(sky.color);
        fog.near = THREE.MathUtils.lerp(50, RAIN_FOG_NEAR, weather.rain);
        fog.far = THREE.MathUtils.lerp(230, RAIN_FOG_FAR, weather.rain);
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
/** 頭の上に屋根や桟橋などがあるか（雨に打たれないか）。木の葉は雨よけにならない */
function sheltered() {
    const p = camera.position;
    shelterRay.origin = { x: p.x, y: p.y, z: p.z };
    return physics.world.castRay(shelterRay, SHELTER_HEIGHT, true, undefined, COLLIDE.shelterQuery) !== null;
}
/** タイトル画面の背景：島の周りをゆっくり回る */
function orbitCamera(t) {
    const a = t * 0.05;
    camera.position.set(Math.cos(a) * 78, 24, Math.sin(a) * 78);
    camera.lookAt(0, 2, 0);
}
const timer = new THREE.Clock();
const seatEye = new THREE.Vector3();
renderer.setAnimationLoop(() => {
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.elapsedTime;
    setWaveTime(t);
    weather.update(clock.minutes);
    setWaveScale(weather.waves); // 嵐では波が高くなる（船の揺れや泳ぎも同じ波の式を使う）
    sea.update(t);
    wind.update(dt, weather.wind);
    grass.update(camera.position, fog.far);
    if (world)
        player.update(dt);
    else
        orbitCamera(t);
    crafting.update(dt); // 作業台を使っているときは、カメラを天板に寄せる
    const underwater = camera.position.y < WATER_LEVEL + waveOffset(camera.position.x, camera.position.z);
    const roofed = weather.rain > 0 && !!world && sheltered();
    if (player.controls.isLocked) {
        vitals.update(dt, roofed || underwater ? 0 : weather.rain); // 一時停止中・インベントリ表示中は減らさない
    }
    // ワールドの時間は、ひとりで遊ぶときは一時停止中に止める。マルチでは一時停止中も進める（参加者にはホストが時刻を配る）
    if (world && (player.controls.isLocked || net.online)) {
        clock.update(dt);
        if (net.authority) {
            if (here === 'island')
                pebbles.update(dt); // 街にいる間は、島の砂浜に小石を足さない
            digger.tick(dt); // 掘った穴は時間がたつと埋まる
        }
        campfires.tick(dt); // 焚火の燃料が燃えていく（次の燃料を燃やすのはホストだけが決める）
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
    spearHand.visible = held?.item === 'spear';
    if (spearCharge !== null) {
        if (!spearHand.visible)
            stopSpearCharge(); // 溜めている途中で持ち替えたらやめる
        else {
            spearCharge = Math.min(spearCharge + dt / SPEAR_CHARGE_TIME, 1);
            const k = THREE.MathUtils.smootherstep(spearCharge, 0, 1);
            spearHand.pose(SPEAR_AIM_POS.map((v) => v * k), SPEAR_AIM_ROT.map((v) => v * k));
        }
    }
    chargeRing.set(spearCharge !== null && player.controls.isLocked ? spearCharge : null);
    spearHand.update(dt);
    pickaxeHand.visible = held?.item === 'pickaxe';
    pickaxeHand.update(dt);
    shovelHand.visible = held?.item === 'shovel';
    shovelHand.update(dt);
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
    boats.update(dt); // 漕いだり波に揺れたりする船の当たり判定は、物理を進める前に動かしておく
    if (boats.riding)
        player.sitAt(boats.seatEye(seatEye)); // 船に乗っている間は、座り板に座った目の位置にする
    physics.step(dt);
    drops.update(dt, camera.position);
    spears.update(dt);
    forager.update(dt);
    miner.update(dt);
    digger.update(dt);
    builder.update(dt);
    campfires.update(dt, t, weather.wind);
    campfireMenu.update();
    if (here === 'island')
        npc.update(dt, camera.position);
    else
        farmer.update(dt, camera.position);
    // 自分の体を、プレイヤーの動きと手に持っている物に合わせて動かす
    avatar.object.visible = !!world;
    if (world) {
        player.pose(avatarPose);
        if (boats.riding)
            avatarPose.bodyYaw = boats.heading ?? undefined; // 船では舳先を向いて座る
        avatar.setHeld(held?.item ?? null);
        avatar.setCharge(spearCharge);
        avatar.update(dt, avatarPose);
    }
    // マルチ：自分の様子を送り、ほかの人の体を動かす
    net.update(dt, world ? poseMsg(held?.item ?? null) : null);
    others.update(dt, here);
    if (world)
        guide.update(camera.position);
    guide.visible = !!world && !death.isOpen;
    // カメラは船の座席などへ動いたあとなので、水中かどうかを調べ直す
    const seeingUnderwater = camera.position.y < WATER_LEVEL + waveOffset(camera.position.x, camera.position.z);
    applySky(seeingUnderwater, dt);
    rainColor.copy(sky.color).multiplyScalar(RAIN_BRIGHT);
    rain.update(t, dt, camera.position, seeingUnderwater ? 0 : weather.rain, rainColor, rainSurface);
    rain.renderOcclusion(renderer, scene, [sky.object, grass.mesh]); // 屋根などの下に雨が降りこまないように
    clockHud.visible = !!world && !death.isOpen;
    clockHud.update(clock.day, clock.hour, clock.isNight, weather.kind);
    // 一時停止中やメニューを開いている間は案内を出さないので、視線の判定もしない
    const hint = player.controls.isLocked && !menuOpen() ? keyHint(held) : '';
    if (hint)
        setKeyGuide(pickupHint, hint);
    pickupHint.classList.toggle('hidden', !hint);
    render();
});
/** ほかの人に見せる自分の様子（avatarPose を作ったあとに呼ぶ。小数は丸めて送る量を減らす） */
function poseMsg(held) {
    const r = (v) => Math.round(v * 1000) / 1000;
    const p = avatarPose;
    const boat = boats.ridePose;
    return {
        p: [r(p.p.x), r(p.p.y), r(p.p.z)],
        yaw: r(p.yaw),
        pitch: r(p.pitch),
        speed: r(p.speed),
        state: p.state,
        crouch: r(p.crouch),
        ...(p.bodyYaw !== undefined ? { body: r(p.bodyYaw) } : {}),
        held,
        charge: spearCharge === null ? null : r(spearCharge),
        loc: here,
        ...(boat ? { boat: [boat[0], r(boat[1]), r(boat[2]), r(boat[3])] } : {}),
    };
}
/** 画面中央に出す操作の案内（視線の判定をいくつも行うので、案内を出している間だけ呼ぶ） */
function keyHint(held) {
    // 住人（桟橋の人・街の農家）を見ているときの案内
    const talkHint = npc.aimed(camera, aimTargets, TALK_REACH)
        ? guide.trades
            ? '[F]：取引する'
            : '[F]：話しかける'
        : farmer.aimed(camera, aimTargets, TALK_REACH)
            ? '[F]：取引する'
            : '';
    const pickup = guide.talking
        ? ''
        : boats.riding
            ? boats.rideHint
            : talkHint
                ? talkHint
                : spears.isAiming(camera) || drops.isAiming(camera)
                    ? '[F]：拾う'
                    : forager.canPick(camera)
                        ? '[F]：実を摘む'
                        : boats.isAiming()
                            ? '[F]：船に乗る ／ [Q]：船をしまう'
                            : aimedWorkbench()
                                ? '[F]：作業台を使う'
                                : aimedCampfire() !== null
                                    ? '[F]：焚火に燃料を入れる'
                                    : boats.holding // 船を持っているときは、水を狙っても飲む案内より浮かべる案内を出す
                                        ? boats.hint
                                        : vitals.canDrink && drinker.aimed(camera)
                                            ? '[F]：水を飲む'
                                            : held && FOODS[held.item] && vitals.canEat && !builder.active
                                                ? '[右]：食べる'
                                                : held && ITEMS[held.item].teaches && !recipeBook.knows(ITEMS[held.item].teaches)
                                                    ? '[右]：作り方を覚える'
                                                    : held?.item === 'shovel' && digger.canDig(camera, SHOVEL_REACH)
                                                        ? '[左]：掘る'
                                                        : held?.item === 'dirt' && digger.canFill(camera, SHOVEL_REACH)
                                                            ? '[右]：穴を埋める'
                                                            : '';
    // 傷ついた部材を見ているときは、のこりの耐久値も出す
    const durability = builder.durability(AXE_REACH) ?? (held?.item === 'pickaxe' ? miner.durability(camera, PICK_REACH) : null);
    return [rodHand.visible && (fisher.busy || !pickup) ? fisher.hint : pickup, durability ? `耐久 ${durability.hp}/${durability.max}` : ''].filter(Boolean).join(' ／ ');
}
const eyePos = new THREE.Vector3();
const cameraRay = new THREE.Raycaster();
const thirdOffset = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const SCREEN_CENTER = new THREE.Vector2(0, 0);
/**
 * 三人称のカメラを、目の右後ろへ下げる（間に壁や地面があれば、その手前まで）。描き終えたら restoreEye() で目の位置へ戻す。
 * 狙いの判定はどれも目から視線の向きへ調べるので、照準は視線の先が画面に映る所へ動かす
 */
function placeThirdPerson() {
    eyePos.copy(camera.position);
    cameraRay.setFromCamera(SCREEN_CENTER, camera);
    cameraRay.far = AIM_RANGE;
    const aimed = cameraRay.intersectObjects(aimTargets, true)[0];
    if (aimed)
        aimPoint.copy(aimed.point);
    else
        aimPoint.copy(cameraRay.ray.direction).multiplyScalar(AIM_RANGE).add(eyePos);
    thirdOffset.set(THIRD_SIDE, THIRD_UP, THIRD_DIST).applyQuaternion(camera.quaternion); // カメラの +X が右、+Z が後ろ
    const dist = thirdOffset.length();
    cameraRay.set(eyePos, thirdOffset.clone().divideScalar(dist));
    cameraRay.far = dist;
    const hit = cameraRay.intersectObjects(aimTargets, true)[0];
    camera.position.addScaledVector(thirdOffset, (hit ? Math.max(hit.distance - CAMERA_MARGIN, 0.2) : dist) / dist);
    // 水面より上にいるときは、カメラを水に潜らせない
    const surface = WATER_LEVEL + waveOffset(eyePos.x, eyePos.z);
    if (eyePos.y > surface)
        camera.position.y = Math.max(camera.position.y, surface + 0.3);
    camera.updateMatrixWorld();
    const ndc = aimPoint.project(camera);
    const left = `${((ndc.x + 1) / 2) * 100}%`;
    const top = `${((1 - ndc.y) / 2) * 100}%`;
    for (const el of [crosshair, pickupHint]) {
        el.style.left = left;
        el.style.top = top;
    }
}
function restoreEye() {
    camera.position.copy(eyePos);
    camera.updateMatrixWorld(); // 次のフレームまでのクリックなども、目の位置から狙う
}
/** 世界を描いてから、深度を消して手や持ち物を上に重ねる（近くの木や岩に手がめり込まないように） */
function render() {
    // 三人称は、ワールドで遊んでいる間だけ（クラフト中は手元の台を見せるので一人称のまま）
    const third = thirdPerson && !!world && !crafting.isOpen && !death.isOpen;
    camera.layers.set(0);
    renderer.shadowMap.needsUpdate = shadowFrame++ % SHADOW_INTERVAL === 0;
    if (third) {
        placeThirdPerson();
        camera.layers.enable(AVATAR_LAYER);
        renderer.render(scene, camera); // 手や持ち物は体の手に持たせているので、重ねて描かない
        restoreEye();
        camera.layers.set(0);
        return;
    }
    for (const el of [crosshair, pickupHint]) {
        el.style.left = '';
        el.style.top = '';
    }
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
avatar.setLook(loadLook()); // タイトル画面で選び直した見た目にする
if (chosen.mode === 'join') {
    // 開いている部屋に参加する：共有ワールドはホストから受け取り、自分だけの状態はこのブラウザに残したものを使う
    try {
        const joinedRoom = await net.join(chosen.code, { name: chosen.name, look: avatar.currentLook });
        restoreShared(joinedRoom.data);
        const personal = loadGuest(joinedRoom.world.id);
        if (personal)
            restorePersonal(personal);
        else
            player.restore(startPlayer);
        joined = true;
        world = { id: joinedRoom.world.id, name: joinedRoom.world.name, createdAt: 0, savedAt: 0 };
        net.ready();
    }
    catch (e) {
        net.leave();
        alert(`参加できませんでした：${e.message}`);
        location.reload();
        throw e; // 読み込み直すまで、ここから先へ進まない
    }
}
else {
    if (chosen.data) {
        restoreShared(chosen.data);
        restorePersonal(chosen.data);
    }
    else {
        player.restore(startPlayer);
        pebbles.fill();
    }
    world = chosen.meta;
    if (chosen.mode === 'host') {
        try {
            await net.host({ id: chosen.meta.id, name: chosen.meta.name }, { name: chosen.name, look: avatar.currentLook });
            showToast(`部屋を開きました。部屋コード：${net.code}（一時停止の画面にも出ます）`);
        }
        catch (e) {
            alert(`部屋を開けませんでした：${e.message}\nひとりで遊びます。`);
        }
    }
}
document.getElementById('world-name').textContent = joined ? `${world.name}（参加中）` : world.name;
save(); // 新しいワールドもすぐ一覧に残るように
refreshOverlay();
