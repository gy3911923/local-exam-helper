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

    // 遍历所有激活题库
    for (const bank of banks) {
      if (!bank.questions || !Array.isArray(bank.questions)) continue;

      for (const bankQ of bank.questions) {
        // 使用预归一化文本或现场归一化
        const normalizedBankQ = bankQ.normalizedQ || TextNormalizer.normalize(bankQ.question || '');
        let score = TextNormalizer.similarity(question.normalizedStem || '', normalizedBankQ);

        // 选项重叠率加权：题干相同但选项不同时降低得分
        // 仅当两侧选项数量相近时才加权，防止题库数据残缺误伤匹配
        if (question.options && bankQ.options) {
          const qKeys = Object.keys(question.options).filter(k => question.options[k]);
          const bKeys = Object.keys(bankQ.options).filter(k => bankQ.options[k]);
          if (qKeys.length >= 2 && bKeys.length >= 2 && bKeys.length >= qKeys.length * 0.5) {
            const qOpts = qKeys.map(k => TextNormalizer.normalize(question.options[k]));
            const bOpts = bKeys.map(k => TextNormalizer.normalize(bankQ.options[k]));
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

  /** 去重：题干重合度 > 95% 视为重复 */
  _deduplicate(results) {
    const kept = [];
    for (const r of results) {
      const isDup = kept.some(k => TextNormalizer.isDuplicate(r.stemText, k.stemText));
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
