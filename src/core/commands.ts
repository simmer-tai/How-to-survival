// ワールドコマンド：共有ワールドを変える操作を小さなデータにしたもの。
// 入力側は「頼み（リクエスト）」を作るだけにし、ホストがそれを確かめて ID などを決めた「コマンド」にして、
// 全員がそのコマンドを同じように適用する。ひとりで遊ぶときは自分がホストなので、その場で確かめて適用する

import type { IsleId, LocationId } from '../world/location.js';
import type { WeatherKind, WeatherValues } from '../world/weather.js';

/**
 * 木・茂み・岩・落とし物のコマンドが、どの島の物か。海図に載せた島の物なら loc にその島を入れる（自分の島の物なら省く）。
 * 番号（木の番号など）は島ごとに別々
 */
export interface OnIsle { loc?: IsleId }

/** 部材を置く。pid はホストが発行する部材の通し番号、p は底面中央の位置、r は 90° 単位の向き */
export interface PlacePiece { type: 'placePiece'; pid: number; id: string; p: [number, number, number]; r: number }

/** 部材を取り除く */
export interface RemovePiece { type: 'removePiece'; pid: number }

/** 部材を叩くのに使った物 */
export type StrikeTool = 'axe' | 'fist';

/** 部材を叩いて耐久値を damage だけ減らす（0 になったら壊れる）。damage はホストが道具から決める */
export interface HitPiece { type: 'hitPiece'; pid: number; damage: number }

/**
 * アイテムを地面に落とす。did はホストが発行する落とし物の通し番号、p は出てくる位置、v は投げ出す速さ。
 * dmg は使いかけの道具の減った耐久値（拾い直しても耐久値が戻らないように、落とし物にも持たせる）。chart は島の地図の中身。
 * q は出てくるときの向き（丸太をばらした木材など。省くと落とし物の番号から決める）
 */
export interface DropItem extends OnIsle { type: 'dropItem'; did: number; item: string; count: number; dmg?: number; chart?: number; p: [number, number, number]; v: [number, number, number]; q?: [number, number, number, number] }

/** 落ちている物を count 個拾う（全部拾うと消える） */
export interface PickDrop extends OnIsle { type: 'pickDrop'; did: number; count: number }

/**
 * 斧で木を1回叩く。tree は木の番号（props の生成順）。立っている木は耐久値が 0 になると away の向きへ倒れ、
 * 倒れた丸太は 0 になるとばらけて木材の落とし物になる（木材はホストが dropItem で出す）。
 * p は叩いた所（木くずを出す）、away は叩いた水平の向き [x, z]
 */
export interface ChopTree extends OnIsle { type: 'chopTree'; tree: number; p: [number, number, number]; away: [number, number] }

/** 茂みを叩くのに使った物。knife（石のナイフ）で叩くとツルも採れる */
export type HarvestTool = 'fist' | 'knife' | 'axe';

/**
 * 茂みを1回叩いて耐久値を damage だけ減らす。bush は茂みの番号。
 * items はその1回で採れる物と個数（減った耐久値の割合で少しずつ出る）。damage と items は道具からホストが決める
 */
export interface HarvestBush extends OnIsle { type: 'harvestBush'; bush: number; damage: number; items: [string, number][] }

/** 茂みになっている実を1つ摘む */
export interface PickBerry extends OnIsle { type: 'pickBerry'; bush: number }

/** 岩を叩くのに使った物 */
export type MineTool = 'pickaxe';

/**
 * 岩を1回叩いて耐久値を damage だけ減らす（0 になったら崩れてなくなる）。rock は岩の番号。
 * items はその1回で採れる物と個数（叩くたびに少しずつ、壊したときにまとめて出る）。damage と items は道具からホストが決める
 */
export interface MineRock extends OnIsle { type: 'mineRock'; rock: number; damage: number; items: [string, number][] }

/** 地面を掘るのに使った物 */
export type DigTool = 'shovel';

/**
 * 地面を掘って小さな穴をあける。hid はホストが発行する穴の通し番号、p は穴の中心の水平位置 [x, z]（自分の島の地面）。
 * items は掘って採れる物と個数で、道具からホストが決める
 */
export interface DigHole { type: 'digHole'; hid: number; p: [number, number]; items: [string, number][] }

/** 穴を埋めて、もとの地面に戻す（土を1つ使って埋めたとき、時間がたってひとりでに埋まるとき。使う土は埋めた人のインベントリから減らす）。木の種を置いた穴なら、そこから苗が生える */
export interface FillHole { type: 'fillHole'; hid: number }

/** 穴に木の種を1つ置く（置いた種は置いた人のインベントリから減らす）。種を置いた穴を埋めると、そこから木の苗が生える */
export interface PlantSeed { type: 'plantSeed'; hid: number }

export type HoleCommand = DigHole | FillHole | PlantSeed;

/**
 * 苗が育ちきって、斧で切れる木になる。gid は植えた木の番号（種を置いた穴の番号をそのまま使う）。
 * 苗が育つ時間は全員が進めて見せるが、育ちきったと決めるのは時間を進めるホスト（世界の頼み）
 */
export interface GrowTree { type: 'growTree'; gid: number }

/** 船を水に浮かべる。bid はホストが発行する船の通し番号、loc は浮かべる場所（島・街）、p は船の中心の水平位置 [x, z]、yaw は舳先の向き（rad） */
export interface PlaceBoat { type: 'placeBoat'; bid: number; loc: LocationId; p: [number, number]; yaw: number }

/** 浮かんでいる船をしまう（アイテムに戻す）。誰かが乗っている船はしまえない */
export interface PickBoat { type: 'pickBoat'; bid: number }

/** 船に乗る。1つの船には1人しか乗れない（取り合いはホストが判定する） */
export interface BoardBoat { type: 'boardBoat'; bid: number }

/**
 * 船から降りる。p・yaw は降りたときの船の位置と向き。
 * 漕いでいる間の船の位置は、プレイヤーの位置と同じく乗っている人が決めて配り、降りたときにこのコマンドで共有ワールドに書き込む
 */
export interface LeaveBoat { type: 'leaveBoat'; bid: number; p: [number, number]; yaw: number }

/**
 * 石の槍を投げる。sid はホストが発行する槍の通し番号、p は穂先が出てくる位置、v は投げた速さ。dmg は減った耐久値。
 * t は何かに刺さるまでの時間、hit は刺さるかどうか（false なら t 秒飛んだあと見失ってなくなる）。t と hit はホストが物理の当たり判定から決める。
 * 飛ぶ道すじは p・v と重力の放物線だけで決まるので、刺さる位置もここから計算できる
 */
export interface ThrowSpear { type: 'throwSpear'; sid: number; dmg?: number; p: [number, number, number]; v: [number, number, number]; t: number; hit: boolean }

/** 刺さっている槍を抜いて取り除く（拾ったとき、刺さった先が無くなって落とし物に変わるとき） */
export interface PickSpear { type: 'pickSpear'; sid: number }

export type PieceCommand = PlacePiece | RemovePiece | HitPiece;
export type DropCommand = DropItem | PickDrop;
/**
 * 乗っている船で別の場所（島・街）へ渡る。p・yaw は着いた所の船の位置と向きで、ホストが決める
 * （着く場所の沖の、出てきた場所の側。ほかの船と重ならないようにずらす）
 */
export interface SailBoat { type: 'sailBoat'; bid: number; loc: LocationId; p: [number, number]; yaw: number }

export type BoatCommand = PlaceBoat | PickBoat | BoardBoat | LeaveBoat | SailBoat;
export type SpearCommand = ThrowSpear | PickSpear;
/**
 * 天気を決める（コマンドメニューから）。kind が null なら、ふだんの（時刻から決まる）天気へ戻す。
 * at は変え始めたワールドの時刻、from はそのときの見た目の強さ [雲, 雨, 波, 雷]。どちらもホストが決める
 */
export interface SetWeather { type: 'setWeather'; kind: WeatherKind | null; at: number; from: WeatherValues }

/**
 * 焚火（部材の番号 pid）の燃料の欄に、燃料を count 個入れる。消えていれば、入れた燃料を1つ使ってすぐ燃え上がる。
 * 入れた燃料は入れた人のインベントリから減らす
 */
export interface AddFuel { type: 'addFuel'; pid: number; item: string; count: number }

/** 焚火の燃料の欄から count 個取り出す（取り出した物は取り出した人のインベントリに入る） */
export interface TakeFuel { type: 'takeFuel'; pid: number; count: number }

/** 燃えている燃料が燃え尽きたので、燃料の欄から次の1つを燃やす（燃料がなければ火が消える）。時間を進めるホストが出す */
export interface BurnFuel { type: 'burnFuel'; pid: number }

export type FireCommand = AddFuel | TakeFuel | BurnFuel;

/**
 * 島の地図を海図に書き写して、島を海図に載せる（誰の海図にも載り、船で渡れるようになる）。
 * iid はホストが発行する島の番号（isle0, isle1 …）、chart は島の地図の中身。書き写した地図は、書き写した人のインベントリから減らす
 */
export interface ChartIsle { type: 'chartIsle'; iid: number; chart: number }

/** カニを叩ける道具 */
export type CrabTool = 'fist' | 'axe' | 'pickaxe' | 'spear';

/** 場所 place（自分の島・街・海図に載せた島）のカニ（すみかを決めた順の番号 crab）を叩いて、体力を damage 減らす。減らす量はホストが道具から決める */
export interface HitCrab { type: 'hitCrab'; place: string; crab: number; damage: number }

/** やられたカニが、時間がたってすみかに戻ってくる。時間を進めるホストが出す */
export interface ReviveCrab { type: 'reviveCrab'; place: string; crab: number }

export type CrabCommand = HitCrab | ReviveCrab;

export type WorldCommand = PieceCommand | DropCommand | ChopTree | HarvestBush | PickBerry | MineRock | HoleCommand | GrowTree | BoatCommand | SpearCommand | SetWeather | FireCommand | ChartIsle | CrabCommand;

/** 参加者からホストへの頼み。新しく増える物の ID はホストが付けるので、まだ持たない */
export type PieceRequest = Omit<PlacePiece, 'pid'> | RemovePiece | { type: 'hitPiece'; pid: number; tool: StrikeTool };
export type DropRequest = Omit<DropItem, 'did'> | PickDrop;
export type BushRequest = ({ type: 'harvestBush'; bush: number; tool: HarvestTool } & OnIsle) | PickBerry;
export type RockRequest = { type: 'mineRock'; rock: number; tool: MineTool } & OnIsle;
export type HoleRequest = { type: 'digHole'; p: [number, number]; tool: DigTool } | FillHole | PlantSeed;
export type BoatRequest = Omit<PlaceBoat, 'bid'> | PickBoat | BoardBoat | LeaveBoat | Omit<SailBoat, 'p' | 'yaw'>;
export type SpearRequest = Omit<ThrowSpear, 'sid' | 't' | 'hit'> | PickSpear;
export type WeatherRequest = Pick<SetWeather, 'type' | 'kind'>;
export type CrabRequest = (Omit<HitCrab, 'damage'> & { tool: CrabTool }) | ReviveCrab;
export type WorldRequest = PieceRequest | DropRequest | ChopTree | BushRequest | RockRequest | HoleRequest | GrowTree | BoatRequest | SpearRequest | WeatherRequest | FireCommand | Omit<ChartIsle, 'iid'> | CrabRequest;

/**
 * 頼みを出す関数（main の requestWorld）。by は頼んだ人の番号で、省くと自分。
 * null は人ではなく世界そのものが出す頼み（時間で埋まる穴・燃え尽きる焚火・湧く小石・ばらけた丸太の木材など。ホストだけが出せる）。
 * 頼んだ人が自分のときだけ、採れた物などを自分のインベントリに入れる。
 * 適用できたら true（マルチの参加者は、自分の手元で確かめてホストへ送れたら true。ホストに断られたら main が元に戻す）
 */
export type Requester = (req: WorldRequest, by?: number | null) => boolean;
