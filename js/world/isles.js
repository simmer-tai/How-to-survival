import * as THREE from 'three';
import { RAPIER } from '../core/physics.js';
import { readChart, validChart } from '../items/islandChart.js';
import { ItemDrops } from '../items/drops.js';
import { TreeChopper } from '../actions/chopping.js';
import { BushForager } from '../actions/foraging.js';
import { RockMiner } from '../actions/mining.js';
import { isleShape } from './isle.js';
import { buildIsleProps } from './props.js';
import { withField } from './terrain.js';
import { bakeSeabed } from './water.js';
import { Grass } from './grass.js';
import { addIsle, isleId, isleIndex, setIsles } from './location.js';
// 島の地図から海図に載せた島（共有ワールド）。島の地図を海図に書き写す（chartIsle）と、誰の海図にも載り、船で渡れるようになる。
// 島の地面と木・茂み・岩の置き方は島の地図の中身から決めるので、誰の画面でも同じになる（world/isle.ts・world/props.ts）。
// 木を切る・茂みを刈る・岩を掘る・物を落とす仕組みは、自分の島と同じクラスを島ごとに1組ずつ持つ（番号も島ごとに別々）。
// それぞれのコマンドには loc（どの島か）が入り、main がその島へ振り分ける。
// 今いない島の剛体は core/physics.ts が止めておき、その島へ移ったときに動かし直す
const MAX_ISLES = 24; // 海図に載せられる島の数
// 島にある地形ごとの、置く物の数（ない地形は少なめ）
const PALMS = { with: 18, without: 4 }; // 白い渚：浜辺のヤシ
const TREES = { with: 70, without: 10 }; // 木々の海：森の木
const BUSHES = { with: 45, without: 8 }; // 風の原：茂み
const ROCKS = { with: 40, without: 10 }; // 灰の牙：岩
const BIG_ROCKS = 1.4; // 灰の牙：岩の大きさの倍率
const REEF = 16; // 船喰い：沖の浅瀬に突き出た岩
export class Isles {
    hooks;
    list = [];
    constructor(hooks) {
        this.hooks = hooks;
    }
    /** 海図に載せた島（ほかの場所なら undefined） */
    get(loc) {
        const n = loc === undefined ? null : isleIndex(loc);
        return n === null ? undefined : this.list[n];
    }
    get all() {
        return this.list;
    }
    /** この中身の島の地図は、もう海図に書き写したか */
    charted(chart) {
        return this.list.some((i) => i.code === chart);
    }
    // ---- ホスト側：頼みを確かめてコマンドにする ----
    /** 島の地図の中身が正しく、まだ海図にない島なら、島の番号を付けたコマンドにする */
    authorize(req) {
        if (validChart(req.chart) === undefined || this.charted(req.chart) || this.list.length >= MAX_ISLES)
            return null;
        return { type: 'chartIsle', iid: this.list.length, chart: req.chart };
    }
    // ---- 全員：コマンドを適用する ----
    /** 海図に島を足す（島の番号は順に発行されるので、次の番号でなければ受けない） */
    apply(cmd) {
        if (cmd.iid !== this.list.length || validChart(cmd.chart) === undefined)
            return;
        addIsle(cmd.chart);
        this.hooks.built(this.build(cmd.chart));
    }
    /** 島の物の動き（倒れていく木・丸太・転がる物）を進める。eye はカメラの位置 */
    update(dt, eye) {
        for (const isle of this.list) {
            isle.chopper.update(dt);
            isle.drops.update(dt, eye);
            isle.forager.update(dt);
            isle.miner.update(dt);
        }
    }
    /** 島に草を生やす（まだなら。初めてその島へ行ったときに呼ぶ） */
    grow(isle) {
        if (!isle.grass) {
            isle.grass = withField(isle.shape.field, () => new Grass(isle.props.rocks, isle.props.platforms));
            isle.group.add(isle.grass.mesh);
        }
        return isle.grass;
    }
    // ---- マルチ：転がる動きはホストの物理で決めて配る ----
    /** 島ごとの [島の番号, 落とし物の動き, 木の動き]（ホストがときどき配る） */
    motion() {
        return this.list.map((isle, i) => [i, isle.drops.motion(), isle.chopper.motion()]);
    }
    setMotion(list) {
        for (const [i, drops, trees] of list) {
            const isle = this.list[i];
            if (!isle || !Array.isArray(drops) || !Array.isArray(trees))
                continue;
            isle.drops.setMotion(drops);
            isle.chopper.setMotion(trees);
        }
    }
    // ---- セーブ ----
    serialize() {
        return {
            list: this.list.map((isle) => ({
                chart: isle.code,
                trees: isle.chopper.serialize(),
                bushes: isle.forager.serialize(),
                rocks: isle.miner.serialize(),
                drops: isle.drops.serialize(),
            })),
        };
    }
    /** まだ島が1つもない状態で呼ぶ（ロードしたとき・マルチで途中参加したとき） */
    restore(save) {
        const list = (save?.list ?? []).filter((s) => validChart(s.chart) !== undefined).slice(0, MAX_ISLES);
        setIsles(list.map((s) => s.chart));
        for (const s of list) {
            const isle = this.build(s.chart);
            this.hooks.physics.within(isle.id, () => {
                isle.chopper.restore(s.trees ?? []);
                isle.forager.restore(s.bushes ?? []);
                isle.miner.restore(s.rocks ?? []);
                isle.drops.restore(s.drops ?? { next: 0, list: [] });
            });
            this.hooks.built(isle);
        }
    }
    /** 島を1つ作る（番号は今の数）。作り終えたら、呼んだ側が hooks.built を呼ぶ */
    build(code) {
        const { scene, physics, aimTargets, request, gain, sway } = this.hooks;
        const id = isleId(this.list.length);
        const chart = readChart(code);
        const shape = isleShape(chart);
        const has = (k) => chart.lands.includes(k);
        const pick = (n, k) => (has(k) ? n.with : n.without);
        const counts = {
            palms: pick(PALMS, 'beach'),
            trees: pick(TREES, 'forest'),
            bushes: pick(BUSHES, 'meadow'),
            rocks: pick(ROCKS, 'crag'),
            big: has('crag') ? BIG_ROCKS : 1,
            reef: has('reef') ? REEF : 0,
        };
        const terrain = shape.field.createMesh();
        const props = withField(shape.field, () => buildIsleProps(chart.seed, counts));
        const group = new THREE.Group();
        group.add(terrain, props.group);
        scene.add(group);
        const isle = physics.within(id, () => {
            const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
            const terrainCollider = physics.addTerrain(terrain, body);
            for (const mesh of props.solids)
                if (!props.rocks.includes(mesh))
                    physics.addStatic(mesh, body); // 岩の当たり判定は RockMiner が付ける
            const blockers = [...props.trees.map((t) => t.object), ...props.bushes];
            aimTargets.push(terrain, ...props.solids);
            const chopper = new TreeChopper(props.group, props.trees, physics);
            const forager = new BushForager(props.group, props.bushes);
            const miner = new RockMiner(props.group, props.rocks, physics, aimTargets, blockers, body);
            const drops = new ItemDrops(props.group, physics);
            for (const s of [chopper, forager, miner, drops]) {
                s.at = { loc: id };
                s.request = request;
            }
            chopper.onSplit = (trunk, wood) => drops.spawn(trunk, wood);
            drops.onCollect = gain;
            forager.onHarvest = gain;
            miner.onHarvest = gain;
            for (const bush of props.bushes)
                sway(bush);
            return { id, code, chart, shape, group, terrain, props, body, terrainCollider, seabed: bakeSeabed((x, z) => shape.field.height(x, z)), grass: null, chopper, forager, miner, drops };
        });
        this.list.push(isle);
        return isle;
    }
}
