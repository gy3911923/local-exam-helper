/**
 * matcher.js - 多题库联合匹配引擎
 * 依赖：utils/textNormalize.js
 * 
 * 流程：归一化题干 → 遍历激活题库 → 编辑距离计算相似度 → 
 *       按优先级加权 → 去重冲突检测 → 返回排序结果
 */

const Matcher = {

  /** 默认置信度阈值（低于此值不自动作答） */
  DEFAULT_THRESHOLD: 0.6,

  /** 3-gram 倒排索引缓存：{banksRef, flat, gramIndex} —— 万级题库防 O(M×N×len²) 卡死 */
  _idx: null,

  /**
   * 为激活题库建 3-gram 倒排索引（惰性，banks 引用变化时重建）
   * gram 命中数是编辑距离的粗下界信号：真匹配（≥0.49 收集线）必有可观的
   * 3-gram 重叠，几乎无重叠者可安全跳过精确 DP（方向保守：宁多勿杀）
   */
  _buildIndex(banks) {
    const flat = [];
    const gramIndex = new Map();
    for (const bank of banks) {
      if (!bank.questions || !Array.isArray(bank.questions)) continue;
      for (const bankQ of bank.questions) {
        if (!bankQ.normalizedQ) bankQ.normalizedQ = TextNormalizer.normalize(bankQ.question || '');
        const idx = flat.length;
        flat.push({ bank, bankQ });
        const q = bankQ.normalizedQ;
        const seen = new Set();
        for (let i = 0; i + 3 <= q.length; i++) {
          const g = q.substr(i, 3);
          if (seen.has(g)) continue;
          seen.add(g);
          let arr = gramIndex.get(g);
          if (!arr) { arr = []; gramIndex.set(g, arr); }
          arr.push(idx);
        }
      }
    }
    this._idx = { banksRef: banks, flat, gramIndex };
  },

  /** 取页面题的候选 bankQ（gram 命中数 top MAX_CAND，上限 800） */
  _candidates(na, maxCand) {
    const { flat, gramIndex } = this._idx;
    const counts = new Map();
    const seen = new Set();
    for (let i = 0; i + 3 <= na.length; i++) {
      const g = na.substr(i, 3);
      if (seen.has(g)) continue;
      seen.add(g);
      const arr = gramIndex.get(g);
      if (!arr) continue;
      for (let j = 0; j < arr.length; j++) {
        counts.set(arr[j], (counts.get(arr[j]) || 0) + 1);
      }
    }
    // 全部候选若在上限内直接返回；超出则按命中数取 top（简单部分选择）
    if (counts.size <= maxCand) return Array.from(counts.keys());
    const arr = Array.from(counts.entries());
    arr.sort((a, b) => b[1] - a[1]);
    return arr.slice(0, maxCand).map(e => e[0]);
  },

  /**
   * 匹配单个题目
   * @param {Object} question - {stemText, normalizedStem, options, type}
   * @param {Array} banks - 激活的题库 [{id, name, questions, priority}]
   * @param {number} threshold - 置信度阈值
   * @returns {Object} {results, canAutoAnswer, bestAnswer, status}
   */
  match(question, banks, threshold = null) {
    const thr = threshold || this.DEFAULT_THRESHOLD;
    const allResults = [];

    // 索引失效（题库对象被重新加载）则重建
    if (!this._idx || this._idx.banksRef !== banks) this._buildIndex(banks);

    // 页面题选项归一化：仅依赖 question，提到题库循环外（原先每对比对重复算一次）
    const qKeys = question.options ? Object.keys(question.options).filter(k => question.options[k]) : [];
    const qOpts = qKeys.map(k => TextNormalizer.normalize(question.options[k]));

    // 候选生成：3-gram 命中 top 800（而非全量 N 条逐一 DP）
    const candIdxs = this._candidates(question.normalizedStem || '', 800);

    for (const ci of candIdxs) {
      const { bank, bankQ } = this._idx.flat[ci];
      const normalizedBankQ = bankQ.normalizedQ;
      // 已归一化文本直接比（免重复 normalize）+ 带收集线预筛
      let score = TextNormalizer.similarityNormalized(question.normalizedStem || '', normalizedBankQ, thr * 0.7);

      // 选项重叠率加权：题干相同但选项不同时降低得分
      // 仅当两侧选项数量相近时才加权，防止题库数据残缺误伤匹配
      if (qOpts.length && bankQ.options) {
        const bKeys = Object.keys(bankQ.options).filter(k => bankQ.options[k]);
        if (qOpts.length >= 2 && bKeys.length >= 2 && bKeys.length >= qOpts.length * 0.5) {
          // 题库侧选项归一化缓存到 bankQ（跨页面题复用，原先每对比对重复算）
          if (!bankQ._normOpts) bankQ._normOpts = bKeys.map(k => TextNormalizer.normalize(bankQ.options[k]));
          const bOpts = bankQ._normOpts;
          let overlap = 0;
          for (const qo of qOpts) {
            if (bOpts.some(bo => bo.includes(qo) || qo.includes(bo))) overlap++;
          }
          const overlapRate = overlap / Math.max(qOpts.length, bOpts.length);
          score = score * 0.6 + overlapRate * 0.4;  // 题干60% + 选项40%
        }
      }

      if (score >= thr * 0.7) {  // 0.7倍阈值收集，过滤完全不相关
        allResults.push({
          bankId: bank.id,
          bankName: bank.name,
          priority: bank.priority || 0,
          questionId: bankQ.id,
          stemText: bankQ.question,
          answer: bankQ.answer,
          options: bankQ.options,
          analysis: bankQ.analysis || '',
          type: bankQ.type,
          score
        });
      }
    }

    // 按得分排序（优先级加权）
    allResults.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) < 0.05) {
        // 得分相近时，高优先级题库优先
        return (b.priority || 0) - (a.priority || 0);
      }
      return scoreDiff;
    });

    // 去重：相似题干只保留最高分
    const deduped = this._deduplicate(allResults);

    // 判断是否可自动作答
    return this._analyzeStatus(question, deduped, thr);
  },

  /** 3-gram 集合（去重判定预筛用） */
  _grams(s) {
    const set = new Set();
    for (let i = 0; i + 3 <= s.length; i++) set.add(s.substr(i, 3));
    return set;
  },

  /** 去重：题干重合度 > 95% 视为重复
   *  预筛两级：①长度差 >5% 必非重复 ②3-gram 重叠 <70% 必非重复
   *  （0.95 相似度 ⇔ 编辑距离 ≤5%，两串几乎逐字相同 ⇒ gram 重叠必然 >80%）
   *  垃圾候选场景收集量大，O(K²) 全量 DP 是分钟级卡死主因之一 */
  _deduplicate(results) {
    const kept = [];
    for (const r of results) {
      const na = TextNormalizer.normalize(r.stemText);
      const ga = this._grams(na);
      let isDup = false;
      for (const k of kept) {
        if (!k._norm) k._norm = TextNormalizer.normalize(k.stemText);
        const nb = k._norm;
        const maxLen = Math.max(na.length, nb.length);
        if (Math.abs(na.length - nb.length) > maxLen * 0.05) continue;
        if (!k._grams) k._grams = this._grams(nb);
        let common = 0;
        for (const g of ga) if (k._grams.has(g)) common++;
        if (common < ga.size * 0.7 && common < k._grams.size * 0.7) continue;
        if (TextNormalizer.levenshtein(na, nb) <= maxLen * 0.05) { isDup = true; break; }
      }
      if (!isDup) kept.push(r);
    }
    return kept;
  },

  /** 分析匹配状态 */
  _analyzeStatus(question, results, threshold) {
    if (results.length === 0) {
      return { results: [], canAutoAnswer: false, bestAnswer: null, status: 'no_match' };
    }

    const best = results[0];

    // 置信度不足
    if (best.score < threshold) {
      return { results, canAutoAnswer: false, bestAnswer: null, status: 'low_confidence' };
    }

    // 检测答案冲突（前两名得分相近但答案不同）
    // 100% 完美匹配（题干一字不差）→ 直接信任，不参与冲突判定
    // 否则第二名得分接近且答案不同 → 可能近似题误配 → 标存疑
    if (best.score >= 0.99) {
      return {
        results,
        canAutoAnswer: true,
        bestAnswer: best.answer,
        status: 'matched'
      };
    }
    if (results.length >= 2) {
      const second = results[1];
      if (second.score >= threshold &&
          second.answer !== best.answer &&
          Math.abs(best.score - second.score) < 0.08) {
        return { results, canAutoAnswer: false, bestAnswer: null, status: 'conflict' };
      }
    }

    // 可自动作答
    return {
      results,
      canAutoAnswer: true,
      bestAnswer: best.answer,
      status: 'matched'
    };
  },

  /**
   * 批量匹配（带缓存，避免重复计算）
   * @param {Array} questions
   * @param {Array} banks
   * @param {number} threshold
   * @returns {Array} 匹配结果数组
   */
  matchAll(questions, banks, threshold = null) {
    return questions.map(q => ({
      question: q,
      ...this.match(q, banks, threshold)
    }));
  }
};
