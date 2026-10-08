import * as THREE from 'three';
import { PALETTE } from './core/palette.js';
import { createTerrain, islandField, setActiveField, terrainHeight, type HeightField } from './world/terrain.js';
import { buildProps, type Platform } from './world/props.js';
import { buildTown, townField, TOWN_PLAN } from './world/town.js';
import { allLocations, locationDef, toLocation, type LocationId } from './world/location.js';
import { nearCave } from './world/cave.js';
import { Isles } from './world/isles.js';
import { readChart } from './items/islandChart.js';
import { Player } from './player/player.js';
import { Inventory, ITEMS, type ItemDef, type ItemId } from './items/inventory.js';
import { RecipeBook } from './items/recipeBook.js';
import { Vitals } from './player/vitals.js';
import { TreeChopper } from './actions/chopping.js';
import { HandSway } from './player/handSway.js';
import { ToolHand, EmptyHand, ItemHand, VIEW_LAYER, buildAxe, buildFishingRod, buildFishingRodRig, buildHammer, buildHoe, buildPickaxe, buildShovel, buildSpear, buildStoneKnife, THRUST_MOTION } from './player/hand.js';
import { ItemDrops } from './items/drops.js';
import { BushForager } from './actions/foraging.js';
import { RockMiner } from './actions/mining.js';
import { GroundDigger } from './actions/digging.js';
import { Saplings } from './actions/planting.js';
import { Fisher } from './actions/fishing.js';
import { FISH_IDS } from './items/fishKinds.js';
import { LAND_INFO_IDS } from './items/landInfo.js';
import { COLLIDE, Physics, RAPIER, WATER_LEVEL, seaSurface, setDryZone } from './core/physics.js';
import { Sea, bakeSeabed } from './world/water.js';
import { Grass } from './world/grass.js';
import { Lod } from './world/lod.js';
import { setWaveScale, setWaveTime, waveOffset } from './core/waves.js';
import { Builder } from './actions/build.js';
import { Boats } from './actions/boats.js';
import { Spears } from './actions/spears.js';
import { Crafting } from './actions/crafting.js';
import { Campfires } from './actions/campfire.js';
import { CampfireMenu } from './actions/campfireMenu.js';
import type { Requester, WorldCommand, WorldRequest } from './core/commands.js';
import { loadGuest, saveGuest, saveWorld, SAVE_VERSION, type PersonalData, type SharedWorld, type WorldData, type WorldMeta } from './core/save.js';
import { ROOM_PARAM, showTitle, showToast } from './ui/title.js';
import { setKeyGuide } from './ui/keyGuide.js';
import { Eater, Drinker, EAT_TIME, FOODS } from './actions/food.js';
import { DeathScreen } from './ui/death.js';
import { installUiScale } from './ui/uiScale.js';
import { WorldClock } from './world/clock.js';
import { Sky, SUN_INTENSITY } from './world/sky.js';
import { Weather, type WeatherKind } from './world/weather.js';
import { Rain } from './world/rain.js';
import { Wind } from './world/wind.js';
import { BeachPebbles } from './world/pebbles.js';
import { PickupFeed } from './ui/pickupFeed.js';
import { ChargeRing } from './ui/chargeRing.js';
import { FARMER_LOOK, MAP_LOOK, Npc, pierSpot } from './world/npc.js';
import { Guide } from './story/guide.js';
import { Shop } from './story/shop.js';
import { FINISH_TOAST } from './story/quests.js';
import { SeaMap } from './ui/seaMap.js';
import { Voyage } from './ui/voyage.js';
import { AreaMap } from './ui/areaMap.js';
import { IslandChartView } from './ui/islandChartView.js';
import { Avatar, AVATAR_LAYER, loadLook, type AvatarPose, type AvatarSwing } from './player/avatar.js';
import { AvatarMenu } from './ui/avatarEditor.js';
import { CommandMenu } from './ui/commandMenu.js';
import { Chat } from './ui/chat.js';
import { OtherPlayers } from './player/others.js';
import { TorchLights } from './player/torchLight.js';
import { Multiplayer } from './net/multiplayer.js';
import type { PoseMsg } from './net/protocol.js';
import { RoomInfo } from './ui/roomInfo.js';
import { SettingsMenu } from './ui/settingsMenu.js';
import { GRAPHICS, loadQuality, recommendQuality, saveQuality } from './core/graphics.js';

installUiScale(); // UI の大きさを画面サイズに合わせる

// 画質（高・中・低）は自分で選ぶ、このブラウザだけの設定。縁のなめらかさは描画を作るときにしか決められない
let quality = loadQuality();
let gfx = GRAPHICS[quality];
const renderer = new THREE.WebGLRenderer({ antialias: gfx.antialias });
renderer.setPixelRatio(Math.min(devicePixelRatio, gfx.pixelRatio));
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
sun.shadow.mapSize.set(gfx.shadowSize, gfx.shadowSize);
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
// 影は島全体を毎回描き直すと重いので、何フレームかに1回だけ描き直す（太陽はゆっくりしか動かない。間隔は画質の gfx.shadowInterval）
const FROST_SHRINK = 3; // インベントリを開いている間、背景の世界を何分の1の大きさで描いてぼかすか（大きいほどぼける）
const FROST_FADE = 0.35; // 開いてからぼけきるまで（閉じて戻るまで）の時間（秒）
const FROST_TINT = 0.06; // すりガラスの霞み（背景を空の色に寄せる割合）
renderer.shadowMap.autoUpdate = false;
let shadowFrame = 0;

// ---- 時間（1日目の朝から始まり、昼12分・夜6分で1日が過ぎる） ----
const clock = new WorldClock();
const sky = new Sky(scene, hemi, sun);
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
// 洞窟の中には日の光（空の光・太陽・月）が届かない。地面より下にいるとき、空が見える向きの割合だけ光を残す
const CAVE_SKY_RAYS: [number, number, number][] = [[0, 1, 0], [0.6, 0.8, 0], [-0.6, 0.8, 0], [0, 0.8, 0.6], [0, 0.8, -0.6]]; // 空が見えるか調べる向き
const CAVE_SKY_REACH = 40; // この距離までに岩や地面があれば、その向きの空は見えない
const CAVE_ADAPT = 2.5; // 洞窟の暗さに変わっていく速さ（1/秒）
const CAVE_LIGHT_MIN = 0.015; // 洞窟の奥に残す日の光の割合（真っ黒にはしない）
// 洞窟の中では霧はかけないが、ふつうの霧（50m より先）の色は闇の色にする（空色のままだと、遠くの通路が明るく光って見えるので）
const CAVE_FOG_COLOR = new THREE.Color(PALETTE.bark).multiplyScalar(0.06);
const caveRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
let caveDark = 0; // 洞窟の暗さ（0 で外と同じ、1 で日の光が届かない）

/** 今いる所の、日の光の届かなさ（0〜1）。海図に載せた島の地面より下（洞窟の中）にいるときだけ、空が見えない向きの割合を返す */
function caveDarkness(): number {
  const field = isles.get(here)?.shape.field;
  const p = camera.position;
  if (!field || p.y > field.height(p.x, p.z)) return 0;
  caveRay.origin = { x: p.x, y: p.y, z: p.z };
  let blocked = 0;
  for (const [x, y, z] of CAVE_SKY_RAYS) {
    caveRay.dir = { x, y, z };
    if (physics.world.castRay(caveRay, CAVE_SKY_REACH, true, undefined, COLLIDE.shelterQuery)) blocked++;
  }
  return blocked / CAVE_SKY_RAYS.length;
}
/** 雨が当たる面の高さ（屋根・地面・岩・水面のいちばん上。しぶきを出す所） */
const rainSurface = (x: number, z: number): number => {
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
for (const mesh of props.solids) if (!props.rocks.includes(mesh)) physics.addStatic(mesh); // 岩の当たり判定は RockMiner が付ける

// 桟橋の前に立っている住人（近づくとこちらを向く）
const pierNpc = pierSpot(props.pierFoot);
const npc = new Npc(pierNpc.position, pierNpc.yaw);
props.group.add(npc.object);
physics.addStatic(npc.collider);

const grass = new Grass(props.rocks, props.platforms);
scene.add(grass.mesh);

// ---- 街（船で世界の端まで行くと海図が開き、そこから渡る別の場所。今は石造りの港だけ） ----
// 街の当たり判定は1つの剛体にまとめる（街の物として作るので、街にいる間だけ動く）
const town = buildTown();
scene.add(town.group);
const townBody = physics.within('town', () => physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
const townTerrainCollider = physics.addTerrain(town.terrain, townBody);
for (const mesh of town.solids) physics.addStatic(mesh, townBody);
// 広場の屋台に立っている農家（いつでも取引できる）
const farmer = new Npc(town.farmerSpot.position, town.farmerSpot.yaw, FARMER_LOOK);
town.group.add(farmer.object);
physics.addStatic(farmer.collider, townBody);
// 広場の地図屋の中、売り台の後ろに立っている地図売り（いつでも地図を買える）
const mapKeeper = new Npc(town.mapKeeperSpot.position, town.mapKeeperSpot.yaw, MAP_LOOK);
town.group.add(mapKeeper.object);
physics.addStatic(mapKeeper.collider, townBody);
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
const avatarPose: AvatarPose = { p: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, state: 'ground', crouch: 0 };
let thirdPerson = false;
try {
  thirdPerson = localStorage.getItem(VIEW_KEY) === 'third';
} catch {
  // 読めなければ一人称で始める
}

/** 自分の体で道具を振る（マルチでは、ほかの人の画面の自分の体も振る） */
const swingBody = (kind: AvatarSwing): void => {
  avatar.swing(kind);
  net.swing(kind);
};

// ---- インベントリ ----
const inventory = new Inventory();
// 手に入れた素材を右下に出す
const pickupFeed = new PickupFeed();
/** 拾ったり採ったりした物をインベントリに入れ、獲得ログに出す。持ちきれない分はなくなる（dmg は使いかけの道具の減った耐久値） */
const gain = (item: ItemId, count: number, dmg?: number, chart?: number): void => {
  const lost = inventory.add(item, count, dmg, chart);
  pickupFeed.show(item, count - lost, inventory.count(item), lost);
};
/** 手に持っている道具を1回使った分だけ傷める。耐久値が尽きて壊れたら知らせる */
const wearTool = (item: ItemId): void => {
  if (inventory.wear(item)) showToast(`${ITEMS[item].name}が壊れた`);
};

// ---- HP・空腹・水分 ----
const vitals = new Vitals();

// ---- 斧で木を切る ----
scene.add(camera); // 手に持つ斧や木材をカメラの子として描画するため
// 手元は、移動・ジャンプ・視点の動きに合わせてなめらかに揺れる台（カメラの子）の上に持つ
const handSway = new HandSway(camera);
const handRoot = handSway.root;
const hand = new ToolHand(handRoot, buildAxe());
hand.drawFlip = true; // 石の斧に持ち替えたら、放り上げて一回転させて受け止める
// ハンマーは建てたり壊したりしたときに振る
const hammerHand = new ToolHand(handRoot, buildHammer());
hammerHand.drawFlip = true; // 持ち替えたら、放り上げて一回転させて受け止める
// 石のナイフは左クリックで振り、茂みを刈る
const knifeHand = new ToolHand(handRoot, buildStoneKnife());
// 石のツルハシは左クリックで振り、岩を叩いて壊す
const pickaxeHand = new ToolHand(handRoot, buildPickaxe());
pickaxeHand.drawFlip = true; // 持ち替えたら、放り上げて一回転させて受け止める
// 木のスコップは左クリックで振り、地面を掘る
const shovelHand = new ToolHand(handRoot, buildShovel());
// 木のくわは左クリックで振る（畑を耕すのはこれから）
const hoeHand = new ToolHand(handRoot, buildHoe());
// 釣り竿は長いので前へ倒して構える（右クリック長押しで投げ、左クリックで巻く）
const ROD_LEAN = 0.45;
const rodRig = buildFishingRodRig();
const rodHand = new ToolHand(handRoot, rodRig.root, ROD_LEAN);
// 石の槍は穂先を前へ向け、水平近くまで倒してまっすぐ構える（左クリックで前へ突き、茂みを刈る。右クリック長押しで力を溜めて投げる）
const SPEAR_LEAN = 1.4;
const spearHand = new ToolHand(handRoot, buildSpear(), SPEAR_LEAN, THRUST_MOTION);
// 木材・板・枝・葉っぱ・魚・ベリー・木の種・土・設計図・白紙の地図・島の地図・地形のメモ・船・焚火は選んでいる間、手に持って見せる
const MATERIAL_KINDS = ['wood', 'plank', 'stick', 'leaf', ...FISH_IDS, 'berry', 'seed', 'dirt', 'boatBlueprint', 'pickaxeBlueprint', 'spearBlueprint', 'hammerBlueprint', 'fishingRodBlueprint', 'draftingTableBlueprint', 'hoeBlueprint', 'map', 'islandMap', ...LAND_INFO_IDS, 'boat', 'campfire', 'torch'] as const;
const materialHands = MATERIAL_KINDS.map((kind) => ({ kind, hand: new ItemHand(handRoot, kind) }));
// 左手のマス（ホットバーの左）の物は、右手と同じ持ち方を鏡に映して左手に持つ。左手では振ったり食べたりしない
const leftTools = [
  { kind: 'axe', hand: new ToolHand(handRoot, buildAxe()).toLeft() },
  { kind: 'hammer', hand: new ToolHand(handRoot, buildHammer()).toLeft() },
  { kind: 'stoneKnife', hand: new ToolHand(handRoot, buildStoneKnife()).toLeft() },
  { kind: 'pickaxe', hand: new ToolHand(handRoot, buildPickaxe()).toLeft() },
  { kind: 'shovel', hand: new ToolHand(handRoot, buildShovel()).toLeft() },
  { kind: 'hoe', hand: new ToolHand(handRoot, buildHoe()).toLeft() },
  { kind: 'fishingRod', hand: new ToolHand(handRoot, buildFishingRod(), ROD_LEAN).toLeft() },
  { kind: 'spear', hand: new ToolHand(handRoot, buildSpear(), SPEAR_LEAN).toLeft() },
];
const leftMaterials = MATERIAL_KINDS.map((kind) => ({ kind, hand: new ItemHand(handRoot, kind).toLeft() }));
// 何も持っていない（空のスロットを選んでいる）ときは素手を見せる
const emptyHand = new EmptyHand(handRoot);
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
const pebbles = new BeachPebbles(
  drops,
  (x, z) =>
    pebbleObstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r) ||
    props.platforms.some((p) => x > p.minX - 1 && x < p.maxX + 1 && z > p.minZ - 1 && z < p.maxZ + 1),
);
// 茂みはこぶし（10回）・石のナイフ・斧（5回）で叩いて壊す。叩くたびに葉っぱ・枝・実が少しずつ採れ、ナイフならツルも採れる。
// 実は F で1つずつ摘むこともできる（壊れた茂みはしばらくすると生え直す）
const forager = new BushForager(props.group, props.bushes);
for (const bush of props.bushes) wind.addSwaying(bush); // 茂みは実ごと風で傾ける
forager.onHarvest = gain;

// ---- 距離で描き方を変える（LOD。自分の画面だけ）。遠くの木・茂みは面の少ない形にし、霧に溶けた木は描かない ----
// 茂みは BushForager が元の形に実をつけ終えてから足す
const lod = new Lod();
lod.addProps('island', props);

// ---- 食べる・飲む（ベリーを持って右クリックで食べる。水面を見て F で飲む） ----
const eater = new Eater(inventory, vitals);
// 視線をさえぎる物（地形・岩・桟橋など）。建てた部材もここに足されていく
const aimTargets: THREE.Object3D[] = [terrain, ...props.solids, npc.collider, town.terrain, ...town.solids, farmer.collider, mapKeeper.collider]; // 今いない場所の物は隠すので、視線も当たらない
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
  const k = kit();
  if (builder.strike('axe', AXE_REACH) || (k && (k.forager.harvest(camera, 'axe', AXE_REACH) || k.chopper.chop(camera)))) wearTool('axe');
};
// 素手で殴ると、木なら木くずが少し飛ぶ（木は倒れず、何も採れない）。茂みは耐久値が減る
const PUNCH_REACH = 2.2;
// 石のナイフで茂みを刈る（刈り取るとツルも採れる）
const KNIFE_REACH = 2.6;
const PICK_REACH = 3.2;
pickaxeHand.onImpact = () => {
  if (kit()?.miner.mine(camera, 'pickaxe', PICK_REACH)) wearTool('pickaxe');
};
const SHOVEL_REACH = 3; // スコップで掘れる距離・土で穴を埋められる距離
/** 土を持って右クリック：狙っている穴を、土を1つ使って埋める。埋めたら true */
const fillHole = (): boolean => {
  if (inventory.count('dirt') < 1 || !digger.fill(camera, SHOVEL_REACH)) return false;
  inventory.remove('dirt', 1);
  swingBody('chop');
  return true;
};
/** 木の種を持って右クリック：狙っている穴に種を1つ置く（土で埋めると苗が生える）。置いたら true */
const plantSeed = (): boolean => {
  if (inventory.count('seed') < 1 || !digger.plant(camera, SHOVEL_REACH)) return false;
  inventory.remove('seed', 1);
  swingBody('chop');
  return true;
};
shovelHand.onImpact = () => {
  if (digger.dig(camera, 'shovel', SHOVEL_REACH)) wearTool('shovel');
};
knifeHand.onImpact = () => {
  if (kit()?.forager.harvest(camera, 'knife', KNIFE_REACH)) wearTool('stoneKnife');
};
// 石の槍は先に石のナイフが付いているので、ナイフと同じく茂みを刈れる（ツルも採れる）。柄が長い分だけ遠くまで届く
const SPEAR_REACH = 3.4;
spearHand.onImpact = () => {
  if (kit()?.forager.harvest(camera, 'knife', SPEAR_REACH)) wearTool('spear');
};
emptyHand.onImpact = () => {
  const k = kit();
  if (!builder.strike('fist', PUNCH_REACH) && k && !k.forager.harvest(camera, 'fist', PUNCH_REACH)) k.chopper.punch(camera, PUNCH_REACH);
};

// ---- 建築（ハンマーを持って右クリックで部材を選び、左クリックで視線の先に建てる。X で壊す。作業台はアイテムを持って置く） ----
const blockers = [...props.trees.map((t) => t.object), ...props.bushes]; // 木や茂みの奥には置けない
const builder = new Builder(props.group, camera, terrain, aimTargets, blockers, physics, props.platforms, inventory);
// 地面はスコップで掘ると小さな穴があき、土が採れる（穴は自分の島の地面にだけ掘れる。建てた部材や桟橋の下は掘れない）
const digger = new GroundDigger(props.group, terrain, aimTargets, blockers);
digger.onHarvest = gain;
digger.canDigAt = (x, z) =>
  !builder.covers(x, islandField.height(x, z), z) &&
  !saplings.occupied(x, z, SAPLING_CLEARANCE) &&
  !(here === 'island' ? props.platforms : platformStash.get('island') ?? []).some((p) => x > p.minX - 0.3 && x < p.maxX + 0.3 && z > p.minZ - 0.3 && z < p.maxZ + 0.3);
// 穴に木の種を置いて土で埋めると苗が生え、時間がたつと斧で切れる木に育つ（ほかの木のそばには植えられない）
const SAPLING_CLEARANCE = 0.8; // 植えた木の根元とこれより近い所は掘れない
const saplings = new Saplings(props.group, chopper, props.trees.map((t) => t.object));
digger.canPlantAt = (x, z) => saplings.canPlantAt(x, z);
digger.onSprout = (hid, x, z) => saplings.sprout(hid, x, z);
// ほかの人が島で植えた・育てた木は、ほかの場所にいる間は隠して止めておく（applyWorld が隠し、剛体は physics が止める）
saplings.onTree = (tree) => lod.addTree('island', tree);
saplings.onAdd = (obj, body) => {
  if (!body) blockers.push(obj); // 苗の奥にも建てたり掘ったりできない
};
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
const setShown = (root: THREE.Object3D, shown: boolean): void => {
  root.traverse((o) => {
    if (shown) {
      o.layers.mask = o.userData.shownLayers ?? 1;
      delete o.userData.shownLayers;
    } else if (o.userData.shownLayers === undefined) {
      o.userData.shownLayers = o.layers.mask;
      o.layers.set(HIDDEN_LAYER);
    }
  });
};
setShown(town.group, false);
/** プレイヤーが今いる場所（自分だけの状態。セーブに入れる） */
let here: LocationId = 'island';

// ---- 島の地図から海図に載せた島（共有ワールド）。木・茂み・岩・落とし物の仕組みを島ごとに1組ずつ持つ ----
const isles = new Isles({
  scene,
  physics,
  aimTargets,
  request: (req, by) => requestWorld(req, by),
  gain,
  sway: (o) => wind.addSwaying(o),
  // 今いない島は隠す（剛体は physics が止めている）
  built: (isle) => {
    lod.addProps(isle.id, isle.props);
    if (isle.id !== here) setShown(isle.group, false);
  },
});

/** 場所ごとの、見せる物・地形・地形の当たり判定・海底・上に乗れる所 */
interface Place { roots: THREE.Object3D[]; field: HeightField; collider: RAPIER.Collider | null; seabed: THREE.DataTexture; platforms: Platform[] }
const homePlace: Place = { roots: [terrain, props.group, grass.mesh], field: islandField, collider: islandTerrainCollider, seabed: islandSeabed, platforms: [] };
const townPlace: Place = { roots: [town.group], field: townField, collider: townTerrainCollider, seabed: townSeabed, platforms: town.platforms };
const placeOf = (loc: LocationId): Place => {
  if (loc === 'island') return homePlace;
  const isle = isles.get(loc);
  if (!isle) return townPlace;
  return { roots: [isle.group], field: isle.shape.field, collider: isle.terrainCollider, seabed: isle.seabed, platforms: isle.props.platforms };
};
/** ほかの場所にいる間に預かっている、その場所の上に乗れる所（自分の島の桟橋・床など） */
const platformStash = new Map<LocationId, Platform[]>();

/** プレイヤーを別の場所へ移す（自分の画面の切り替え。船で渡るときは先に sailBoat を適用しておく） */
const goTo = (loc: LocationId): void => {
  if (loc === here) return;
  const from = placeOf(here);
  const to = placeOf(loc);
  const isle = isles.get(loc);
  if (isle) isles.grow(isle); // 初めて行く島なら草を生やす
  for (const o of from.roots) setShown(o, false);
  for (const o of to.roots) setShown(o, true);
  // 今いた場所の剛体（地形・岩・木・部材・落とし物など）を止め、行き先の剛体を動かす。プレイヤーと船は残す（船は場所ごとに Boats が切り替える）
  physics.moveTo(loc, (b) => b === player.rigidBody || boats.owns(b));
  platformStash.set(here, [...props.platforms]);
  props.platforms.splice(0, props.platforms.length, ...(platformStash.get(loc) ?? to.platforms));
  physics.terrainCollider = to.collider;
  setActiveField(to.field);
  setDryZone((x, z) => to.field.isDry(x, z)); // 洞窟の中では泳がず、水中の見た目にもしない
  sea.setSeabed(to.seabed);
  boats.setLocation(loc);
  builder.disabled = loc !== 'island'; // 建てた部材は自分の島にだけ置ける
  here = loc;
};

/** 木・茂み・岩・落とし物の仕組み（自分の島と、海図に載せた島にある。街にはない） */
interface Kit { chopper: TreeChopper; forager: BushForager; miner: RockMiner; drops: ItemDrops }
const homeKit: Kit = { chopper, forager, miner, drops };
/** 場所 loc の木・茂み・岩・落とし物の仕組み（loc を省くと自分の島。街やない島なら null） */
const kitAt = (loc: LocationId | undefined): Kit | null => (loc === undefined || loc === 'island' ? homeKit : isles.get(loc) ?? null);
/** 今いる場所の木・茂み・岩・落とし物の仕組み */
const kit = (): Kit | null => kitAt(here);
// 船で世界の端まで漕いでいくと、視点が上空へ昇って立体の海図を開き、ほかの場所を選ぶと暗転して船旅の場面になり、船ごと渡る
const seaMap = new SeaMap();
seaMap.fieldOf = (loc) => placeOf(loc).field;
boats.onEdge = () => seaMap.open(here, camera);
boats.fieldOf = (loc) => (loc === 'town' ? townField : isles.get(loc)?.shape.field ?? islandField);
// 船旅：着いた場所へ切り替えて描く準備ができるまで（マルチではホストの返事を待つ間も）、船で海を渡る場面を見せる。
// ゲームのシーンを、海・空・光だけ残して描く
const voyage = new Voyage({ scene, camera, sea, sun, skyDome: sky.object, keep: [sea.mesh, sky.object, hemi, sun] });
seaMap.onTravel = (to) => {
  if (to === here || voyage.isOpen) return;
  voyage.start(to, avatar.currentLook);
  refreshOverlay();
};
voyage.onCovered = () => {
  seaMap.finish(); // 暗くなってから、海図の描画をやめる
  return boats.sail(voyage.destination);
};
voyage.onDone = (arrived) => {
  if (!arrived) showToast('渡れなかった');
  refreshOverlay();
};
// 渡り終えたら（マルチではホストが渡る先を決めて配ってから）、プレイヤーもその場所へ移る
boats.onSail = (to) => {
  goTo(to);
  const heading = boats.heading;
  if (heading !== null) player.face(heading); // 着いた場所の島のほうを向く
  // 着いた場所のシェーダーを船旅の間に用意しておき、できたら船旅を終える（明けた最初のフレームで止まらないように）
  renderer
    .compileAsync(scene, camera)
    .catch(() => {})
    .finally(() => voyage.arrive());
};
/** 自分の島でしかできないこと（刺さった槍などは、まだ場所を持たない）をしようとしたら知らせる。島にいれば true */
const onIsland = (): boolean => {
  if (here === 'island') return true;
  showToast('ここではまだできない');
  return false;
};

// ---- 槍を投げる（槍を持って右クリック長押しで力を溜め、離すと視線の向きへ投げる。刺さった槍は F で拾う） ----
const SPEAR_CHARGE_TIME = 0.9; // いっぱいまで溜まる時間（秒）
const SPEAR_MIN_CHARGE = 0.15; // これより溜まる前に離したら投げない（右クリックを押しただけで投げてしまわないように）
// 溜めている間の構え：槍を肩の上へ持ち上げて後ろへ引き、穂先を少し上へ向ける（構えのときから水平近くに倒してある）
const SPEAR_AIM_POS: [number, number, number] = [0.04, 0.16, 0.24];
const SPEAR_AIM_ROT: [number, number, number] = [0.1, 0, 0.06];
const spears = new Spears(props.group, physics);
spears.onCollect = gain;
spears.onBreak = () => showToast(`${ITEMS.spear.name}が壊れた`);
const chargeRing = new ChargeRing();
/** 溜めている力（0〜1）。溜めていなければ null */
let spearCharge: number | null = null;
const stopSpearCharge = (): void => {
  spearCharge = null;
  spearHand.pose([0, 0, 0], [0, 0, 0]);
};
/** 溜めた力で、持っている槍を投げる（少ししか溜めていなければやめる） */
const releaseSpear = (): void => {
  const charge = spearCharge;
  stopSpearCharge();
  if (charge === null || charge < SPEAR_MIN_CHARGE || !spearHand.visible) return;
  const stack = inventory.take(false);
  if (!stack) return;
  if (stack.item !== 'spear' || !spears.throw(stack.dmg, camera.position, camera.getWorldDirection(new THREE.Vector3()), charge)) inventory.putBack(stack);
};

// ---- ワールドコマンド（共有ワールドの変更はすべてここを通す） ----
/** 頼みを確かめ、ホストが決める値を入れたコマンドにする（by は頼んだ人）。できない頼みなら null */
const authorizeWorld = (req: WorldRequest, by: number | null): WorldCommand | null => {
  switch (req.type) {
    // 木・茂み・岩・落とし物は、その物がある島の仕組みが確かめる（ない島なら断る）
    case 'dropItem':
    case 'pickDrop':
      return kitAt(req.loc)?.drops.authorize(req) ?? null;
    case 'chopTree':
      return kitAt(req.loc)?.chopper.authorize(req) ?? null;
    case 'harvestBush':
    case 'pickBerry':
      return kitAt(req.loc)?.forager.authorize(req) ?? null;
    case 'mineRock':
      return kitAt(req.loc)?.miner.authorize(req) ?? null;
    case 'chartIsle':
      return isles.authorize(req);
    case 'digHole':
    case 'fillHole':
    case 'plantSeed':
      return digger.authorize(req);
    case 'growTree':
      return saplings.authorize(req);
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
/**
 * コマンドがどの場所の物を変えるか。船・天気・海図は場所をまたぐので null（自分で場所を扱う）。
 * 木・茂み・岩・落とし物は loc の島（省けば自分の島）、ほかは自分の島の物
 */
const scopeOf = (cmd: WorldCommand): LocationId | null => {
  switch (cmd.type) {
    case 'placeBoat':
    case 'pickBoat':
    case 'boardBoat':
    case 'leaveBoat':
    case 'sailBoat':
    case 'setWeather':
    case 'chartIsle':
      return null;
    case 'dropItem':
    case 'pickDrop':
    case 'chopTree':
    case 'harvestBush':
    case 'pickBerry':
    case 'mineRock':
      return cmd.loc ?? 'island';
    default:
      return 'island';
  }
};
/**
 * コマンドを適用する（by は頼んだ人。自分の頼みなら、採れた物などを自分のインベントリに入れる）。マルチではホストから届いたコマンドもここで適用する。
 * 今いない場所の物を変えたときは、その場所で作った剛体を止め（physics.within）、増えた見た目を隠す
 */
const applyWorld = (cmd: WorldCommand, by: number | null): void => {
  const scope = scopeOf(cmd);
  if (scope === null) return applyCommand(cmd, by);
  physics.within(scope, () => applyCommand(cmd, by));
  if (scope !== here) for (const o of placeOf(scope).roots) setShown(o, false);
};
const applyCommand = (cmd: WorldCommand, by: number | null): void => {
  const mine = by !== null && by === net.myId;
  const k = 'loc' in cmd && scopeOf(cmd) !== null ? kitAt(cmd.loc) : homeKit;
  switch (cmd.type) {
    case 'placePiece':
    case 'removePiece':
    case 'hitPiece':
      builder.apply(cmd, mine);
      break;
    case 'dropItem':
    case 'pickDrop':
      k?.drops.apply(cmd, mine);
      break;
    case 'chopTree':
      k?.chopper.apply(cmd);
      break;
    case 'harvestBush':
    case 'pickBerry':
      k?.forager.apply(cmd, mine);
      break;
    case 'mineRock':
      k?.miner.apply(cmd, mine);
      break;
    case 'chartIsle':
      isles.apply(cmd);
      break;
    case 'digHole':
    case 'fillHole':
    case 'plantSeed':
      digger.apply(cmd, mine);
      break;
    case 'growTree':
      saplings.apply(cmd);
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
const undoRequest = (req: WorldRequest): void => {
  switch (req.type) {
    case 'placePiece':
      builder.refund(req.id);
      break;
    case 'dropItem':
      if (req.item in ITEMS) gain(req.item as ItemId, req.count, req.dmg, req.chart);
      break;
    case 'chartIsle':
      gain('islandMap', 1, undefined, req.chart); // 書き写せなかった地図を返す
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
    case 'plantSeed':
      gain('seed', 1);
      break;
    case 'addFuel':
      if (req.item in ITEMS) gain(req.item as ItemId, req.count);
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
const torchLights = new TorchLights(scene); // 手に持った松明の明かり（自分とほかの人）
const torchFlames: THREE.Vector3[] = [];
const net = new Multiplayer(
  {
    authorize: authorizeWorld,
    apply: applyWorld,
    undo: undoRequest,
    shared: () => sharedSnapshot(),
    // 物理で動く物の位置は、場所ごとに [場所, 落とし物, 木] でやりとりする（計算するのは、その場所の物理の担当）
    motion: (places) => ({
      at: places.flatMap((loc): [string, number[][], number[][]][] => {
        const k = kitAt(toLocation(loc));
        return k && toLocation(loc) === loc ? [[loc, k.drops.motion(), k.chopper.motion()]] : [];
      }),
    }),
    setMotion: (m) => {
      for (const [loc, d, t] of m.at) {
        const k = toLocation(loc) === loc ? kitAt(toLocation(loc)) : null;
        if (!k || !Array.isArray(d) || !Array.isArray(t)) continue;
        k.drops.setMotion(d);
        k.chopper.setMotion(t);
      }
    },
    here: () => here,
    minutes: () => clock.minutes,
    setMinutes: (minutes) => (clock.minutes = minutes),
    followBoat: (bid, x, z, yaw) => boats.follow(bid, x, z, yaw),
    // 抜けた人が乗っていた船は、その場に残す
    left: (id) => {
      for (const b of boats.riddenBy(id)) requestWorld({ type: 'leaveBoat', bid: b.bid, p: b.p, yaw: b.yaw }, id);
    },
  },
  others,
);
/**
 * 頼みを出す。ひとりで遊ぶとき・ホストは、その場で確かめて適用する（ホストは全員にも配る）。
 * マルチの参加者は手元で確かめてからホストへ送る。適用できたら（送れたら）true
 */
const requestWorld: Requester = (req, by) => net.request(req, by);
chopper.request = requestWorld;
builder.request = requestWorld;
drops.request = requestWorld;
pebbles.request = requestWorld;
forager.request = requestWorld;
miner.request = requestWorld;
digger.request = requestWorld;
saplings.request = requestWorld;
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
/** 設計図なら、右クリックで作り方を覚え、手に持つ設計図を1枚使う（もう覚えていたら減らさない）。設計図だったら true */
const learnFrom = (item: ItemId): boolean => {
  const result = (ITEMS[item] as ItemDef).teaches as ItemId | undefined;
  if (!result) return false;
  const name = ITEMS[result].name;
  if (recipeBook.learn(result)) {
    inventory.removeSelected(1);
    showToast(`「${name}」の作り方を覚えた`);
  } else showToast(`「${name}」の作り方はもう覚えている`);
  return true;
};

// ---- 桟橋の住人の頼みごと（最初の手順の案内。進み具合は自分だけの状態） ----
const TALK_REACH = 3.5; // 住人に話しかけられる距離
const guide = new Guide(
  {
    count: (item) => inventory.count(item),
    built: (id) => builder.hasKind(id),
    knows: (item) => recipeBook.knows(item),
    riding: () => boats.riding,
    location: () => here,
  },
  npc.object.position,
);
guide.onFinish = () => showToast(FINISH_TOAST);
// 作業台の頼みごとを終えたら、話しかけると取引の画面が開く（ベリーをコインに換え、船の設計図を買う。コインはインベントリのお金のマスに入る）。
// 街へ渡るまでの頼みごとの途中なら、取引の画面に今のヒントを出す。
// 街の農家とは最初から取引できる（取引の中身は items/trades.ts）
const shop = new Shop(inventory);
shop.onGain = gain;

// ---- 地図（地図屋で買える。持って右クリックで、今いる場所の地図を広げる。自分だけの UI） ----
// 今いる場所を真上から見る地図は、ひとまずどのアイテムからも開かない（島の地図に渡れるようになったら使い道を決める）
const areaMap = new AreaMap();
areaMap.addSource('island', {
  field: islandField,
  platforms: props.platforms,
  platformColor: PALETTE.trunk,
  buildings: [],
  marks: [{ name: '桟橋', x: props.pierFoot.x, z: props.pierFoot.z + 5 }],
});
areaMap.addSource('town', { field: townField, platforms: town.platforms, platformColor: PALETTE.rock, buildings: town.buildings, marks: town.marks });
const mapDir = new THREE.Vector3();
/** 地図に描く、自分とほかの人の今の位置 */
const mapView = () => {
  camera.getWorldDirection(mapDir);
  mapDir.y = 0;
  if (mapDir.lengthSq() < 1e-6) mapDir.set(0, 0, -1);
  mapDir.normalize();
  return { x: camera.position.x, z: camera.position.z, dx: mapDir.x, dz: mapDir.z, others: others.spots(here) };
};

// ---- F：話しかける・拾う・茂みの実を摘む・船に乗り降りする・作業台や焚火を使う・水を飲む ----
const USE_REACH = 3.5; // 作業台や焚火を使える距離
// 島の地図を持って右クリックで広げる、メモから描いた予想図
const chartView = new IslandChartView();
/** 視線の先にある、使える作業台か製図台 */
const aimedWorkbench = () => {
  const piece = builder.aimedPiece(USE_REACH);
  return piece?.id === 'workbench' || piece?.id === 'draftingTable' ? { info: piece, station: piece.id as 'workbench' | 'draftingTable' } : null;
};
/** 視線の先にある焚火の番号（低いので、炎のあたりを見ても狙える） */
const aimedCampfire = () => campfires.aimed(camera, USE_REACH, aimTargets);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && player.controls.isLocked && !inventory.isOpen) {
    // 船に乗っている間は F で降りる（陸や桟橋に立てればそこへ、なければ船の横の水へ）
    if (boats.riding) {
      const feet = boats.leave((x, z) => player.groundAt(x, z), (p) => player.canStandAt(p));
      if (feet) player.standAt(feet);
      else showToast('ここでは降りられない');
      return;
    }
    if (!guide.talking && guide.trades && npc.aimed(camera, aimTargets, TALK_REACH)) return shop.open('pier', guide.tip);
    if (!guide.talking && farmer.aimed(camera, aimTargets, TALK_REACH)) return shop.open('farmer');
    if (!guide.talking && mapKeeper.aimed(camera, aimTargets, TALK_REACH)) return shop.open('mapmaker');
    if (guide.talking || npc.aimed(camera, aimTargets, TALK_REACH)) return guide.speak();
    const k = kit();
    if (spears.collect(camera, (item) => inventory.room(item)) || k?.drops.collect(camera, (item) => inventory.room(item)) || k?.forager.pick(camera) || boats.board()) return;
    const bench = aimedWorkbench();
    const fire = bench ? null : aimedCampfire();
    if (bench) crafting.useBench(bench.info, bench.station);
    else if (fire !== null) campfireMenu.open(fire);
    else drinker.drink(camera);
  }
});

// ---- V：一人称と三人称（自分の姿が見える）を切り替える ----
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat || !world || !player.controls.isLocked) return;
  thirdPerson = !thirdPerson;
  try {
    localStorage.setItem(VIEW_KEY, thirdPerson ? 'third' : 'first');
  } catch {
    // 覚えておけなくても、今の視点はそのまま切り替える
  }
  showToast(thirdPerson ? '三人称視点' : '一人称視点');
});

// ---- Q：狙っている船をしまう（アイテムに戻す） ----
addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ' && player.controls.isLocked && !inventory.isOpen) boats.pick();
});

// ---- G：持っている物を1個落とす（Ctrl+G でまるごと）。インベントリを開いているときは、つまんでいる物かマウスが乗っているマス ----
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || !world || death.isOpen || builder.menu.isOpen || shop.isOpen) return;
  if (!player.controls.isLocked && !inventory.isOpen) return;
  e.preventDefault(); // Ctrl+G（ブラウザの「次を検索」）を止める
  // 落とし物は、自分の島と海図に載せた島に落とせる（街にはまだ落とせない）
  const k = kit();
  if (!k) {
    showToast('ここではまだできない');
    return;
  }
  const stack = inventory.take(e.ctrlKey);
  if (!stack) return;
  if (!k.drops.throw(stack, camera.position, camera.getWorldDirection(new THREE.Vector3()))) inventory.putBack(stack);
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!player.controls.isLocked) return;
  if (builder.active) {
    if (e.button === 0) builder.place();
    else if (e.button === 2 && builder.hammer) builder.menu.setOpen(true);
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
    if (spearCharge === null) spearHand.swing(); // 投げる力を溜めている間は突かない
    pickaxeHand.swing();
    shovelHand.swing();
    hoeHand.swing();
    emptyHand.punch();
    // 三人称の体も、手に持っている物に合わせて振る（槍とこぶしは突き出す）
    if (spearHand.visible ? spearCharge === null : hand.visible || knifeHand.visible || pickaxeHand.visible || shovelHand.visible || hoeHand.visible || emptyHand.visible) {
      swingBody(spearHand.visible || emptyHand.visible ? 'thrust' : 'chop');
    }
    if (rodHand.visible) fisher.setReeling(true);
  }
  else if (e.button === 2) {
    if (rodHand.visible) fisher.startCharge();
    else if (spearHand.visible) {
      if (onIsland()) spearCharge = 0;
    }
    else if (held?.item === 'dirt' && fillHole()) return;
    else if (held?.item === 'seed' && plantSeed()) return;
    else if (held?.item === 'islandMap') {
      if (held.chart !== undefined) chartView.open(held.chart);
      else showToast('この地図は、にじんでいて読めない');
    }
    else if (held && learnFrom(held.item)) return;
    else if (held && eater.start(held.item)) materialHands.find((m) => m.kind === held.item)?.hand.eat(EAT_TIME);
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) fisher.setReeling(false);
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
let world: WorldMeta | null = null; // タイトル画面でワールドを選ぶまでは null
let autosaveTimer = 0;
const startPlayer = player.serialize(); // 新しいワールドの出発地点（タイトル画面ではカメラが島を回るので覚えておく）
/** マルチの参加者として遊んでいるか（共有ワールドはホストがセーブするので、自分だけの状態だけをセーブする） */
let joined = false;
/** 自分だけの状態 */
const personalSnapshot = (): PersonalData => ({
  // 乗っている船と、いる場所も覚えておく
  player: { ...player.serialize(), ...(boats.ridingBid !== null ? { boat: boats.ridingBid } : {}), ...(here !== 'island' ? { loc: here } : {}) },
  inventory: inventory.serialize(),
  vitals: vitals.serialize(),
  guide: guide.serialize(),
  recipes: recipeBook.serialize(),
});
/** 共有ワールドの状態（マルチでは、途中参加した人にまるごと送る） */
const sharedSnapshot = (): SharedWorld => ({
  trees: chopper.serialize(),
  bushes: forager.serialize(),
  drops: drops.serialize(),
  pebbles: pebbles.serialize(),
  rocks: miner.serialize(),
  holes: digger.serialize(),
  built: builder.serialize(),
  fires: campfires.serialize(),
  planted: saplings.serialize(),
  isles: isles.serialize(),
  boats: boats.serialize(),
  spears: spears.serialize(),
  clock: clock.serialize(),
  weather: weather.serialize(),
});
const snapshot = (): WorldData => ({ version: SAVE_VERSION, ...personalSnapshot(), ...sharedSnapshot() });
/** 共有ワールドを戻す（床などの足場を先に置いてから、restorePersonal でプレイヤーを戻す） */
const restoreShared = (data: SharedWorld) => {
  isles.restore(data.isles); // 船やプレイヤーがいる島を読めるように、先に海図に載せた島を作る
  physics.within('island', () => {
    builder.restore(data.built);
    campfires.restore(data.fires); // 焚火の部材を置いてから、燃料と火を戻す
    boats.restore(data.boats);
    spears.restore(data.spears);
    chopper.restore(data.trees);
    forager.restore(data.bushes);
    miner.restore(data.rocks);
    digger.restore(data.holes);
    saplings.restore(data.planted); // 最初からある木を戻してから、植えた木を戻す
    drops.restore(data.drops);
    pebbles.restore(data.pebbles); // 落とし物を戻してから（まだ小石を置いていないワールドなら置く）
  });
  clock.restore(data.clock);
  weather.restore(data.weather);
};
/** 自分だけの状態を戻す（共有ワールドを戻したあとに呼ぶ） */
const restorePersonal = (data: PersonalData) => {
  inventory.restore(data.inventory);
  vitals.restore(data.vitals);
  player.restore(data.player);
  goTo(toLocation(data.player.loc)); // 街にいたら街へ（剛体を全部作り終えてから切り替える）
  if (data.player.boat !== undefined) boats.boardById(data.player.boat); // 船に乗ったままセーブしていたら乗り直す
  guide.restore(data.guide);
  recipeBook.restore(data.recipes);
};
const save = (toast = false): void => {
  if (!world) return;
  autosaveTimer = 0;
  // 参加者は、ホストのワールドの id ごとに自分だけの状態を残す（共有ワールドはホストがセーブする）
  const ok = joined ? saveGuest(world.id, personalSnapshot()) : saveWorld(world.id, snapshot());
  if (!ok) showToast('セーブに失敗しました');
  else if (toast) showToast('セーブしました');
};
addEventListener('pagehide', () => {
  save();
  net.leave(); // 部屋を開いていたら閉じる（参加者は抜ける）
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});

const overlay = document.getElementById('overlay')!;
const crosshair = document.getElementById('crosshair')!;
const pickupHint = document.getElementById('pickup-hint')!;
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
document.getElementById('to-avatar')!.addEventListener('click', (e) => {
  e.stopPropagation(); // オーバーレイのクリック（ゲーム再開）にしない
  avatarMenu.setOpen(true);
});
// 一時停止の画面から、設定（画質）の画面を開ける。おすすめの段階は出すだけで、選ぶのは自分
const settingsMenu = new SettingsMenu(quality, recommendQuality(renderer.getContext()), gfx.antialias);
settingsMenu.onQuality = (q) => {
  quality = q;
  saveQuality(q);
  applyGraphics();
};
document.getElementById('to-settings')!.addEventListener('click', (e) => {
  e.stopPropagation(); // オーバーレイのクリック（ゲーム再開）にしない
  settingsMenu.setOpen(true);
});
/** 選んだ画質を、今の描画にかける（縁のなめらかさだけは読み込み直すまで変わらない） */
function applyGraphics(): void {
  gfx = GRAPHICS[quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, gfx.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  if (sun.shadow.mapSize.x !== gfx.shadowSize) {
    sun.shadow.mapSize.set(gfx.shadowSize, gfx.shadowSize);
    sun.shadow.map?.dispose(); // 次に影を描くときに、新しい大きさで作り直される
    sun.shadow.map = null;
  }
  renderer.shadowMap.needsUpdate = true;
}
// ---- コマンドメニュー（0 キーで開く。天気を変えるなど） ----
const commandMenu = new CommandMenu();
/** コマンドで打てる天気の名前 */
const WEATHER_WORDS: Record<string, WeatherKind | null> = {
  clear: 'clear', sun: 'clear', 晴れ: 'clear', はれ: 'clear',
  cloudy: 'cloudy', cloud: 'cloudy', くもり: 'cloudy', 曇り: 'cloudy',
  rain: 'rain', 雨: 'rain', あめ: 'rain',
  storm: 'storm', thunder: 'storm', 嵐: 'storm', あらし: 'storm',
  auto: null, 自動: null, じどう: null,
};
const WEATHER_LABELS: Record<WeatherKind, string> = { clear: '晴れ', cloudy: 'くもり', rain: '雨', storm: '嵐' };
commandMenu.register({
  name: 'weather',
  aliases: ['天気', '天候', 'てんき'],
  usage: '/weather <晴れ|くもり|雨|嵐|自動>',
  run: ([word]) => {
    const key = word?.toLowerCase() ?? '';
    if (!(key in WEATHER_WORDS)) return { message: '天気は 晴れ・くもり・雨・嵐・自動 から選んでください', error: true };
    const kind = WEATHER_WORDS[key];
    if (kind === weather.forcedKind) return { message: kind ? `もう${WEATHER_LABELS[kind]}にしています` : 'もう自動になっています', error: true };
    requestWorld({ type: 'setWeather', kind }); // 共有ワールドの変更なので、ワールドコマンドの頼みにする
    return { message: kind ? `天気を${WEATHER_LABELS[kind]}にしました` : '天気を自動に戻しました' };
  },
});
commandMenu.addButtons({
  title: '天気',
  buttons: [
    ...(Object.keys(WEATHER_LABELS) as WeatherKind[]).map((k) => ({ label: WEATHER_LABELS[k], command: `/weather ${k}` })),
    { label: '自動', command: '/weather auto' },
  ],
  current: () => `/weather ${weather.forcedKind ?? 'auto'}`,
});
// コインを増やす・減らす。インベントリは自分だけの状態なので、ワールドコマンドにせずその場で変える
commandMenu.register({
  name: 'coin',
  aliases: ['coins', 'コイン', 'こいん', 'お金', 'おかね'],
  usage: '/coin <枚数>（マイナスで減らす）',
  run: ([word]) => {
    const n = Number(word);
    if (!word || !Number.isInteger(n) || n === 0) return { message: '枚数を 0 以外の整数で入れてください（例：/coin 100）', error: true };
    if (n < 0) {
      const have = inventory.count('coin');
      if (have === 0) return { message: 'コインを持っていません', error: true };
      const take = Math.min(-n, have);
      inventory.remove('coin', take);
      return { message: `コインを${take}枚減らしました（${inventory.count('coin')}枚）` };
    }
    const added = n - inventory.add('coin', n);
    if (added === 0) return { message: 'お金のマスがいっぱいです', error: true };
    return { message: `コインを${added}枚増やしました（${inventory.count('coin')}枚）` };
  },
});
commandMenu.addButtons({
  title: 'コイン',
  buttons: [10, 100, 1000].map((n) => ({ label: `+${n}`, command: `/coin ${n}` })),
});
// ほかの場所へ移る。プレイヤーの位置といる場所は自分だけの状態なので、ワールドコマンドにせずその場で移る（乗っていた船はその場に残す）
/** 場所の名前として打てる語（場所の id と海図での名前のほかに） */
const PLACE_WORDS: Record<string, LocationId> = {
  home: 'island', 島: 'island', しま: 'island', 自分の島: 'island', じぶんのしま: 'island',
  街: 'town', 町: 'town', まち: 'town',
};
/** 打った語の場所（海図にない島や知らない語なら null） */
const placeByWord = (word: string): LocationId | null => {
  const key = word.toLowerCase();
  if (key in PLACE_WORDS) return PLACE_WORDS[key];
  return allLocations().find((d) => d.id === key || d.name === word)?.id ?? null;
};
const TP_GROUND_MIN = 0.8; // 海図に載せた島で降り立つ地面の高さの下限（波打ち際より上）
const TP_GROUND_MAX = 10; // 降り立つ地面の高さの上限（山の上を避ける）
const TP_SLOPE_MAX = 0.6; // 降り立つ所の、2m 離れた所との高さの差の上限
/** 場所 loc でコマンドで降り立つ所（足元の位置と向き） */
const landingAt = (loc: LocationId): { p: number[]; yaw: number } => {
  if (loc === 'island') return { p: startPlayer.p, yaw: startPlayer.yaw };
  if (loc === 'town') {
    // 岸壁の少し内側の石畳に、広場（東）を向いて立つ
    const { x0, top } = TOWN_PLAN.plaza;
    return { p: [x0 + 4, top, 0], yaw: -Math.PI / 2 };
  }
  const isle = isles.get(loc)!;
  const { field, lake, caves } = isle.shape;
  const ok = (x: number, z: number): boolean => {
    const h = field.height(x, z);
    if (h < TP_GROUND_MIN || h > TP_GROUND_MAX) return false;
    if (Math.abs(field.height(x + 1, z) - field.height(x - 1, z)) > TP_SLOPE_MAX) return false;
    if (Math.abs(field.height(x, z + 1) - field.height(x, z - 1)) > TP_SLOPE_MAX) return false;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r + 3) return false;
    return caves.every((c) => !nearCave(c, x, z));
  };
  // 島の真ん中から外へ、渦を巻くように探す
  for (let r = 0; r < field.half; r += 3) {
    const n = Math.max(1, Math.round((Math.PI * 2 * r) / 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (ok(x, z)) return { p: [x, field.height(x, z), z], yaw: Math.atan2(x, z) }; // 島の真ん中のほうを向く
    }
  }
  return { p: [0, Math.max(field.height(0, 0), 0), 0], yaw: 0 };
};
commandMenu.register({
  name: 'tp',
  aliases: ['goto', 'go', '移動', 'いどう', 'ワープ', 'わーぷ'],
  usage: '/tp <自分の島|街|海図に載せた島の名前>',
  run: (args) => {
    const word = args.join(' ');
    const names = allLocations().map((d) => d.name).join('・');
    if (!word) return { message: `行き先を入れてください（${names}）`, error: true };
    const to = placeByWord(word);
    if (!to) return { message: `「${word}」という場所はありません（${names}）`, error: true };
    if (to === here) return { message: `もう${locationDef(to).name}にいます`, error: true };
    boats.release(); // 船に乗っていたら、船はその場に残す
    stopSpearCharge();
    goTo(to);
    const { p, yaw } = landingAt(to);
    player.restore({ p, yaw, pitch: 0 });
    return { message: `${locationDef(to).name}へ移動しました` };
  },
});
commandMenu.addButtons({
  title: '移動',
  buttons: () => allLocations().map((d) => ({ label: d.name, command: `/tp ${d.id}` })),
  current: () => `/tp ${here}`,
});
commandMenu.onResult = (message) => showToast(message);
addEventListener('keydown', (e) => {
  if (e.code !== 'Digit0' && e.code !== 'Numpad0') return;
  if (!world || !player.controls.isLocked || menuOpen()) return;
  e.preventDefault(); // 開いた入力欄に「0」が入らないように
  commandMenu.setOpen(true);
});
// ---- チャット（Enter で開く。「/」で始めるとコマンド。マルチではほかの人へ送る） ----
const chat = new Chat();
chat.onCommand = (text) => commandMenu.run(text);
chat.onSend = (text) => {
  chat.add(net.names[0], text);
  net.say(text);
};
net.onChat = (name, text) => chat.add(name, text);
addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
  if (!world || !player.controls.isLocked || menuOpen()) return;
  e.preventDefault();
  chat.setOpen(true);
});
const menuOpen = () =>
  inventory.isOpen || death.isOpen || builder.menu.isOpen || shop.isOpen || seaMap.isOpen || voyage.isOpen || areaMap.isOpen || chartView.isOpen || avatarMenu.isOpen || settingsMenu.isOpen || commandMenu.isOpen || chat.isOpen;
document.getElementById('to-title')!.addEventListener('click', (e) => {
  e.stopPropagation(); // オーバーレイのクリック（ゲーム再開）にしない
  save();
  net.leave(); // 部屋を開いていたら閉じる（参加者は抜ける）
  location.reload(); // 読み込み直してタイトル画面に戻る
});
// 一時停止の画面に、部屋にいる人と、友達が参加するときに開くアドレスを出す
const roomInfo = new RoomInfo(document.getElementById('world-name')!);
/** 開くとそのまま部屋コードが入る招待リンク */
const inviteLink = () => {
  if (!net.code) return null;
  const url = new URL(location.href);
  url.search = `?${ROOM_PARAM}=${net.code}`;
  url.hash = '';
  return url.href;
};
const refreshRoom = () => roomInfo.render({ role: net.role, names: net.names, code: net.code, invite: inviteLink() });
net.onJoin = (name) => {
  showToast(`${name}が参加しました`);
  chat.add(null, `${name}が参加しました`);
  refreshRoom();
};
net.onLeave = (name) => {
  showToast(`${name}が抜けました`);
  chat.add(null, `${name}が抜けました`);
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
  if (lockRetried) return;
  lockRetried = true;
  setTimeout(() => {
    if (!player.controls.isLocked && !menuOpen()) player.controls.lock();
  }, 1100);
});
// Ctrl+W（タブを閉じる）はブラウザが止めさせてくれないので、せめてプレイ中は閉じる前に確認を出す
addEventListener('beforeunload', (e) => {
  if (player.controls.isLocked) e.preventDefault();
});
const onMenuToggle = (open: boolean, resume: boolean) => {
  if (open) player.controls.unlock();
  else if (resume && !menuOpen()) player.controls.lock();
  refreshOverlay();
};
inventory.onToggle = (open, resume) => {
  if (open) {
    // 部材を選ぶメニューや取引の画面の上からインベントリを開いたら、そちらは閉じる
    builder.menu.setOpen(false, false);
    shop.setOpen(false, false);
    seaMap.setOpen(false, false);
    areaMap.setOpen(false, false);
    chartView.setOpen(false, false);
    avatarMenu.setOpen(false, false);
    settingsMenu.setOpen(false, false);
    commandMenu.setOpen(false, false);
    chat.setOpen(false, false);
  }
  // 焚火の燃料の欄を開いているときは、手元のクラフトの台は出さない
  crafting.setOpen(open && !campfireMenu.isOpen);
  if (!open) campfireMenu.close();
  onMenuToggle(open, resume);
};
builder.menu.onToggle = onMenuToggle;
shop.onToggle = onMenuToggle;
seaMap.onToggle = onMenuToggle;
areaMap.onToggle = onMenuToggle;
chartView.onToggle = onMenuToggle;
// 島の地図を海図に書き写すと、誰の海図にもその島が載り、船で渡れるようになる（書き写した地図はなくなる）
chartView.onCopy = (chart) => {
  const held = inventory.selectedStack;
  if (held?.item !== 'islandMap' || held.chart !== chart) return;
  if (isles.charted(chart)) {
    showToast('この島は、もう海図に載っている');
    return;
  }
  inventory.removeSelected(1);
  if (requestWorld({ type: 'chartIsle', chart })) showToast(`海図に「${readChart(chart).name}」を書き写した。船で世界の端まで漕いでいけば渡れる`);
  else {
    gain('islandMap', 1, undefined, chart);
    showToast('これ以上は海図に書き写せない');
  }
};
avatarMenu.onToggle = onMenuToggle;
settingsMenu.onToggle = onMenuToggle;
commandMenu.onToggle = onMenuToggle;
chat.onToggle = onMenuToggle;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/** 時刻と天気に合わせた空と光にする。雨では霧で遠くをかすませる。水中では光を弱めて青く染め、深いほど暗い霧で視界を狭める（夜はさらに暗く） */
function applySky(underwater: boolean, dt: number): void {
  sky.update(clock.minutes, weather, camera, dt);
  sky.visible = !underwater;
  town.lamps.update(sky.daylight, performance.now() / 1000); // 街灯と地図屋の明かりは、暗くなると灯る
  sea.setDaylight(THREE.MathUtils.lerp(0.25, 1, sky.daylight));
  // 洞窟の中では、日の光を弱める（暗さはなめらかに変える）
  caveDark += ((underwater ? 0 : caveDarkness()) - caveDark) * (1 - Math.exp(-CAVE_ADAPT * dt));
  if (!underwater) {
    fog.color.copy(sky.color);
    // 画質が低いほど霧を近くにして、遠くの物を描かずにすませる
    fog.near = THREE.MathUtils.lerp(50, RAIN_FOG_NEAR, weather.rain) * gfx.viewScale;
    fog.far = THREE.MathUtils.lerp(230, RAIN_FOG_FAR, weather.rain) * gfx.viewScale;
    if (caveDark > 0.001) {
      const lit = THREE.MathUtils.lerp(1, CAVE_LIGHT_MIN, caveDark);
      hemi.intensity *= lit;
      sun.intensity *= lit;
      fog.color.lerp(CAVE_FOG_COLOR, caveDark);
    }
    sea.setSkyColor(fog.color); // 海の水面に、霧と同じ空の色を映す（遠くの海が空に溶ける）
  } else {
    const depth = THREE.MathUtils.clamp(WATER_LEVEL - camera.position.y, 0, 8);
    deepColor.copy(seaColor).multiplyScalar((0.85 - depth * 0.05) * THREE.MathUtils.lerp(0.25, 1, sky.daylight));
    fog.color.copy(deepColor);
    fog.near = 0;
    fog.far = 34 - depth * 2;
    hemi.color.copy(sky.color).lerp(seaColor, 0.5);
    hemi.groundColor.copy(deepColor);
    hemi.intensity *= 1.24; // 水中は空の光で全体を明るく保つ（陸より半球光を強めにする）
    sun.color.copy(sky.color);
    sun.intensity *= (1.3 - depth * 0.08) / SUN_INTENSITY;
  }
  (scene.background as THREE.Color).copy(fog.color);
  // 霧で見えなくなる先は描かない（水中では視界が狭いので、遠くの物を画面外として省ける）
  const far = underwater ? fog.far + 1 : CAMERA_FAR;
  if (camera.far !== far) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** 頭の上に屋根や桟橋などがあるか（雨に打たれないか）。木の葉は雨よけにならない */
function sheltered(): boolean {
  const p = camera.position;
  shelterRay.origin = { x: p.x, y: p.y, z: p.z };
  return physics.world.castRay(shelterRay, SHELTER_HEIGHT, true, undefined, COLLIDE.shelterQuery) !== null;
}

/** タイトル画面の背景：島の周りをゆっくり回る */
function orbitCamera(t: number): void {
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
  const grassFar = Math.min(fog.far, gfx.grassDistance);
  grass.update(camera.position, grassFar);
  isles.get(here)?.grass?.update(camera.position, grassFar);
  lod.update(camera.position, here, fog.far, gfx.lodScale);
  if (world) player.update(dt);
  else orbitCamera(t);
  crafting.update(dt); // 作業台を使っているときは、カメラを天板に寄せる
  const underwater = camera.position.y < seaSurface(camera.position.x, camera.position.z);
  const roofed = weather.rain > 0 && !!world && sheltered();
  if (player.controls.isLocked) {
    vitals.update(dt, roofed || underwater ? 0 : weather.rain); // 一時停止中・インベントリ表示中は減らさない
  }
  // ワールドの時間は、ひとりで遊ぶときは一時停止中に止める。マルチでは一時停止中も進める（参加者にはホストが時刻を配る）
  if (world && (player.controls.isLocked || net.online)) {
    clock.update(dt);
    if (net.authority) {
      if (here === 'island') pebbles.update(dt); // 街にいる間は、島の砂浜に小石を足さない
      digger.tick(dt); // 掘った穴は時間がたつと埋まる
    }
    campfires.tick(dt); // 焚火の燃料が燃えていく（次の燃料を燃やすのはホストだけが決める）
    saplings.tick(dt); // 植えた苗が育っていく（育ちきって木になるのはホストだけが決める）
    autosaveTimer += dt;
    if (autosaveTimer >= AUTOSAVE_INTERVAL) save(true);
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
  handSway.update(dt, player.sway());
  hand.visible = held?.item === 'axe';
  hand.update(dt);
  hammerHand.visible = held?.item === 'hammer';
  hammerHand.update(dt);
  knifeHand.visible = held?.item === 'stoneKnife';
  knifeHand.update(dt);
  spearHand.visible = held?.item === 'spear';
  if (spearCharge !== null) {
    if (!spearHand.visible) stopSpearCharge(); // 溜めている途中で持ち替えたらやめる
    else {
      spearCharge = Math.min(spearCharge + dt / SPEAR_CHARGE_TIME, 1);
      const k = THREE.MathUtils.smootherstep(spearCharge, 0, 1);
      spearHand.pose(SPEAR_AIM_POS.map((v) => v * k) as [number, number, number], SPEAR_AIM_ROT.map((v) => v * k) as [number, number, number]);
    }
  }
  // 槍と釣り竿の投げる力は、同じクロスヘアの周りのチャージメーターに出す
  chargeRing.set(player.controls.isLocked ? spearCharge ?? fisher.chargeLevel : null);
  spearHand.update(dt);
  pickaxeHand.visible = held?.item === 'pickaxe';
  pickaxeHand.update(dt);
  shovelHand.visible = held?.item === 'shovel';
  shovelHand.update(dt);
  hoeHand.visible = held?.item === 'hoe';
  hoeHand.update(dt);
  rodHand.visible = held?.item === 'fishingRod';
  rodHand.update(dt);
  fisher.update(dt, camera, rodHand.visible);
  for (const { kind, hand: h } of materialHands) {
    h.setCount(held?.item === kind ? held.count : 0);
    h.update(dt);
  }
  const left = world && !crafting.isOpen ? inventory.offhandStack : null;
  for (const { kind, hand: h } of leftTools) {
    h.visible = left?.item === kind;
    h.update(dt);
  }
  for (const { kind, hand: h } of leftMaterials) {
    h.setCount(left?.item === kind ? left.count : 0);
    h.update(dt);
  }
  emptyHand.leftHolding = !!left;
  emptyHand.visible = !!world && !held && !builder.active && !crafting.isOpen;
  emptyHand.update(dt);
  chopper.update(dt);
  isles.update(dt, camera.position);
  boats.update(dt); // 漕いだり波に揺れたりする船の当たり判定は、物理を進める前に動かしておく
  if (boats.riding) player.sitAt(boats.seatEye(seatEye)); // 船に乗っている間は、座り板に座った目の位置にする
  physics.step(dt);
  drops.update(dt, camera.position);
  spears.update(dt);
  forager.update(dt);
  miner.update(dt);
  digger.update(dt);
  builder.update(dt);
  campfires.update(dt, t, weather.wind);
  campfireMenu.update();
  if (here === 'island') npc.update(dt, camera.position);
  else {
    farmer.update(dt, camera.position);
    mapKeeper.update(dt, camera.position);
  }
  // 自分の体を、プレイヤーの動きと手に持っている物に合わせて動かす
  avatar.object.visible = !!world;
  if (world) {
    player.pose(avatarPose);
    if (boats.riding) avatarPose.bodyYaw = boats.heading ?? undefined; // 船では舳先を向いて座る
    avatar.setHeld(held?.item ?? null);
    avatar.setHeld(left?.item ?? null, 1);
    avatar.setCharge(spearCharge);
    avatar.update(dt, avatarPose);
  }
  // マルチ：自分の様子を送り、ほかの人の体を動かす
  net.update(dt, world ? poseMsg(held?.item ?? null, left?.item ?? null) : null);
  others.update(dt, here);
  // 松明の明かりは、自分の松明を先に、ほかの人の松明をあとに置く
  torchFlames.length = 0;
  avatar.torchFlames(torchFlames);
  others.torchFlames(torchFlames);
  torchLights.update(torchFlames, t);
  if (areaMap.isOpen) areaMap.update(mapView());
  if (world) guide.update(camera.position);
  guide.visible = !!world && !death.isOpen;
  // カメラは船の座席などへ動いたあとなので、水中かどうかを調べ直す
  const seeingUnderwater = camera.position.y < seaSurface(camera.position.x, camera.position.z);
  applySky(seeingUnderwater, dt);
  rainColor.copy(sky.color).multiplyScalar(RAIN_BRIGHT);
  rain.update(t, dt, camera.position, seeingUnderwater ? 0 : weather.rain, rainColor, rainSurface);
  rain.renderOcclusion(renderer, scene, [sky.object, grass.mesh, ...isles.all.flatMap((i) => (i.grass ? [i.grass.mesh] : []))]); // 屋根などの下に雨が降りこまないように
  chat.visible = !!world && !death.isOpen;
  // 一時停止中やメニューを開いている間は案内を出さないので、視線の判定もしない
  const hint = player.controls.isLocked && !menuOpen() ? keyHint(held) : '';
  if (hint) setKeyGuide(pickupHint, hint);
  pickupHint.classList.toggle('hidden', !hint);
  seaMap.update(dt);
  voyage.update(dt);
  render();
});

/** ほかの人に見せる自分の様子（avatarPose を作ったあとに呼ぶ。小数は丸めて送る量を減らす） */
function poseMsg(held: string | null, left: string | null): PoseMsg {
  const r = (v: number) => Math.round(v * 1000) / 1000;
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
    ...(left ? { left } : {}),
    charge: spearCharge === null ? null : r(spearCharge),
    loc: here,
    ...(boat ? { boat: [boat[0], r(boat[1]), r(boat[2]), r(boat[3])] } : {}),
  };
}

/** 画面中央に出す操作の案内（視線の判定をいくつも行うので、案内を出している間だけ呼ぶ） */
function keyHint(held: typeof inventory.selectedStack | null): string {
  // 住人（桟橋の人・街の農家・地図売り）を見ているときの案内
  const talkHint = npc.aimed(camera, aimTargets, TALK_REACH)
    ? guide.trades
      ? '[F]：取引する'
      : '[F]：話しかける'
    : farmer.aimed(camera, aimTargets, TALK_REACH) || mapKeeper.aimed(camera, aimTargets, TALK_REACH)
      ? '[F]：取引する'
      : '';
  const pickup = guide.talking
    ? ''
    : boats.riding
      ? boats.rideHint
      : talkHint
        ? talkHint
        : spears.isAiming(camera) || kit()?.drops.isAiming(camera)
          ? '[F]：拾う'
          : kit()?.forager.canPick(camera)
            ? '[F]：実を摘む'
            : boats.isAiming()
              ? '[F]：船に乗る ／ [Q]：船をしまう'
              : aimedWorkbench()
                ? `[F]：${aimedWorkbench()!.station === 'draftingTable' ? '製図台' : '作業台'}を使う`
                : aimedCampfire() !== null
                  ? '[F]：焚火に燃料を入れる'
                : boats.holding // 船を持っているときは、水を狙っても飲む案内より浮かべる案内を出す
                  ? boats.hint
                  : vitals.canDrink && drinker.aimed(camera)
                    ? '[F]：水を飲む'
                    : held && FOODS[held.item] && vitals.canEat && !builder.active
                      ? '[右]：食べる'
                      : held && (ITEMS[held.item] as ItemDef).teaches && !recipeBook.knows((ITEMS[held.item] as ItemDef).teaches!)
                        ? '[右]：作り方を覚える'
                        : held?.item === 'shovel' && digger.canDig(camera, SHOVEL_REACH)
                          ? '[左]：掘る'
                          : held?.item === 'dirt' && digger.canFill(camera, SHOVEL_REACH)
                            ? '[右]：穴を埋める'
                            : held?.item === 'seed' && digger.canPlant(camera, SHOVEL_REACH)
                              ? '[右]：種を植える'
                              : held?.item === 'islandMap'
                                ? '[右]：地図を広げる'
                                : '';
  // 傷ついた部材を見ているときは、のこりの耐久値も出す
  const durability = builder.durability(AXE_REACH) ?? (held?.item === 'pickaxe' ? kit()?.miner.durability(camera, PICK_REACH) ?? null : null);
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
function placeThirdPerson(): void {
  eyePos.copy(camera.position);
  cameraRay.setFromCamera(SCREEN_CENTER, camera);
  cameraRay.far = AIM_RANGE;
  const aimed = cameraRay.intersectObjects(aimTargets, true)[0];
  if (aimed) aimPoint.copy(aimed.point);
  else aimPoint.copy(cameraRay.ray.direction).multiplyScalar(AIM_RANGE).add(eyePos);

  thirdOffset.set(THIRD_SIDE, THIRD_UP, THIRD_DIST).applyQuaternion(camera.quaternion); // カメラの +X が右、+Z が後ろ
  const dist = thirdOffset.length();
  cameraRay.set(eyePos, thirdOffset.clone().divideScalar(dist));
  cameraRay.far = dist;
  const hit = cameraRay.intersectObjects(aimTargets, true)[0];
  camera.position.addScaledVector(thirdOffset, (hit ? Math.max(hit.distance - CAMERA_MARGIN, 0.2) : dist) / dist);
  // 水面より上にいるときは、カメラを水に潜らせない
  const surface = seaSurface(eyePos.x, eyePos.z);
  if (eyePos.y > surface) camera.position.y = Math.max(camera.position.y, surface + 0.3);
  camera.updateMatrixWorld();

  const ndc = aimPoint.project(camera);
  const left = `${((ndc.x + 1) / 2) * 100}%`;
  const top = `${((1 - ndc.y) / 2) * 100}%`;
  for (const el of [crosshair, pickupHint]) {
    el.style.left = left;
    el.style.top = top;
  }
}

function restoreEye(): void {
  camera.position.copy(eyePos);
  camera.updateMatrixWorld(); // 次のフレームまでのクリックなども、目の位置から狙う
}

// インベントリを開いている間は、背景の世界をすりガラス越しのようにぼかす（手元のクラフトの台や手は、その上にくっきり重ねる）。
// 世界を小さな画像に描いてから、周りの色とならしながら画面いっぱいに引き伸ばし、空の色で少し霞ませる。自分の画面だけの演出
const frostTarget = new THREE.WebGLRenderTarget(1, 1);
const frostScene = new THREE.Scene();
const frostCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const frostMaterial = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: frostTarget.texture },
    texel: { value: new THREE.Vector2(1, 1) }, // 小さな画像の1画素の大きさ（uv で）
    amount: { value: 0 },
    tint: { value: new THREE.Color(PALETTE.sky) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec2 texel;
    uniform float amount;
    uniform vec3 tint;
    varying vec2 vUv;
    void main() {
      // 円く並べた点の色を重みを付けて足す（引き伸ばしたときの四角い角を消す）
      vec3 c = texture2D(map, vUv).rgb * 0.2;
      float total = 0.2;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5235988;
        float r = mod(float(i), 2.0) < 0.5 ? 1.0 : 2.0;
        float w = r < 1.5 ? 0.1 : 0.05;
        c += texture2D(map, vUv + vec2(cos(a), sin(a)) * r * texel).rgb * w;
        total += w;
      }
      c /= total;
      // 空の色で少し霞ませる
      c = mix(c, tint, ${FROST_TINT.toFixed(3)} * amount);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }
  `,
  depthTest: false,
  depthWrite: false,
});
frostScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), frostMaterial));

let frostAmount = 0; // ぼかす度合い（0：そのまま 〜 1：いちばんぼけた所）
let frostLast = performance.now();
const drawSize = new THREE.Vector2();

/** 世界（レイヤー 0 など、カメラに今入っているレイヤー）を描く。インベントリを開いている間は徐々にぼかす（雨も含めて毎フレーム描き直す） */
function renderWorld(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - frostLast) / 1000);
  frostLast = now;
  // 作業台・製図台を使っている間は、台の上の素材が見えないと困るのでぼかさない
  const want = inventory.isOpen && !crafting.atBench ? 1 : 0;
  const step = dt / FROST_FADE;
  frostAmount = want > frostAmount ? Math.min(want, frostAmount + step) : Math.max(want, frostAmount - step);
  inventory.setFrosted(frostAmount === 1);
  if (frostAmount === 0) {
    renderer.render(scene, camera);
    return;
  }
  // 小さな画像の縮め方（画面の実際の画素で何画素を1画素にするか）。始めはすばやく、終わりはゆっくりぼける
  const ease = 1 - (1 - frostAmount) ** 2;
  const shrink = Math.max(1, (1 + (FROST_SHRINK - 1) * ease) * renderer.getPixelRatio());
  renderer.getDrawingBufferSize(drawSize);
  const w = Math.max(1, Math.round(drawSize.x / shrink));
  const h = Math.max(1, Math.round(drawSize.y / shrink));
  const resized = frostTarget.width !== w || frostTarget.height !== h;
  if (resized) frostTarget.setSize(w, h);
  frostMaterial.uniforms.texel.value.set(1 / w, 1 / h).multiplyScalar(ease);
  frostMaterial.uniforms.amount.value = ease;
  renderer.setRenderTarget(frostTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(frostScene, frostCamera);
}

/** 世界を描いてから、深度を消して手や持ち物を上に重ねる（近くの木や岩に手がめり込まないように） */
function render(): void {
  // 船旅：海図で行き先を選んでから着くまでは、船で海を渡る場面を描く
  if (voyage.active) {
    voyage.render(renderer);
    return;
  }
  // 海図：上空へ昇っていく間と、立体の海図を見ている間は、海図が描く（上から見ると自分の体も見える）
  if (seaMap.active) {
    camera.layers.set(0);
    camera.layers.enable(AVATAR_LAYER);
    seaMap.render(renderer, scene, camera, fog, sky.color, sky.daylight, sky.object);
    camera.layers.set(0);
    return;
  }
  // 三人称は、ワールドで遊んでいる間だけ（クラフト中は手元の台を見せるので一人称のまま）
  const third = thirdPerson && !!world && !crafting.isOpen && !death.isOpen;
  camera.layers.set(0);
  renderer.shadowMap.needsUpdate = shadowFrame++ % gfx.shadowInterval === 0;
  if (third) {
    placeThirdPerson();
    camera.layers.enable(AVATAR_LAYER);
    renderWorld(); // 手や持ち物は体の手に持たせているので、重ねて描かない
    restoreEye();
    camera.layers.set(0);
    return;
  }
  for (const el of [crosshair, pickupHint]) {
    el.style.left = '';
    el.style.top = '';
  }
  renderWorld();
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
    if (personal) restorePersonal(personal);
    else player.restore(startPlayer);
    joined = true;
    world = { id: joinedRoom.world.id, name: joinedRoom.world.name, createdAt: 0, savedAt: 0 };
    net.ready();
  } catch (e) {
    net.leave();
    alert(`参加できませんでした：${(e as Error).message}`);
    location.reload();
    throw e; // 読み込み直すまで、ここから先へ進まない
  }
} else {
  if (chosen.data) {
    restoreShared(chosen.data);
    restorePersonal(chosen.data);
  } else {
    player.restore(startPlayer);
    pebbles.fill();
  }
  world = chosen.meta;
  if (chosen.mode === 'host') {
    try {
      await net.host({ id: chosen.meta.id, name: chosen.meta.name }, { name: chosen.name, look: avatar.currentLook });
      showToast(`部屋を開きました。部屋コード：${net.code}（一時停止の画面にも出ます）`);
    } catch (e) {
      alert(`部屋を開けませんでした：${(e as Error).message}\nひとりで遊びます。`);
    }
  }
}
document.getElementById('world-name')!.textContent = joined ? `${world.name}（参加中）` : world.name;
save(); // 新しいワールドもすぐ一覧に残るように
refreshOverlay();
