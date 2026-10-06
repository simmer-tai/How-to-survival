import { RECIPES } from './recipes.js';
export class RecipeBook {
    known = new Set();
    /** その物の作り方を覚えているか */
    knows(result) {
        return this.known.has(result);
    }
    /** 作り方を覚える。新しく覚えたら true（もう覚えていたら false） */
    learn(result) {
        if (this.known.has(result))
            return false;
        this.known.add(result);
        return true;
    }
    serialize() {
        return [...this.known];
    }
    restore(save) {
        this.known.clear();
        // 今あるレシピの物だけを読む（レシピがなくなった物は忘れる）
        for (const id of save ?? [])
            if (RECIPES.some((r) => r.result === id))
                this.known.add(id);
    }
}
