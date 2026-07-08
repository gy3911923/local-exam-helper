/**
 * textNormalize.js - 文本归一化引擎
 * 依赖：无
 * 
 * 流水线：去HTML标签 → 全角转半角 → 去空白字符 → 去标点 → 统一小写
 */

const TextNormalizer = {

  /**
   * 完整归一化流水线
   * @param {string} text - 原始文本
   * @returns {string} - 归一化后文本
   */
  normalize(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    result = this.stripHTML(result);
    result = this.fullwidthToHalfwidth(result);
    result = this.stripWhitespace(result);
    result = this.stripPunctuation(result);
    result = this.toLower(result);
    return result;
  },

  /** 去除HTML标签 */
  stripHTML(text) {
    return text.replace(/<[^>]*>/g, '');
  },

  /** 全角字符转半角 */
  fullwidthToHalfwidth(text) {
    return text.replace(/[\uff01-\uff5e\u3000]/g, ch => {
      if (ch === '\u3000') return ' ';
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
  },

  /** 去除所有空白字符（空格、换行、制表符、不可见字符） */
  stripWhitespace(text) {
    return text.replace(/[\s\u00a0\u2000-\u200f\u2028-\u202f\u205f\u3000\ufeff]+/g, '');
  },

  /** 去除标点符号 */
  stripPunctuation(text) {
    // 保留字母数字和中文，去除其余符号
    return text.replace(/[，,、。\.；;：:！!？?（）()【】\[\]《》""''""\/\\\-—–·…～~@#$%^&*+=|{}<>"']/g, '');
  },

  /** 统一转为小写 */
  toLower(text) {
    return text.toLowerCase();
  },

  /**
   * 计算编辑距离（Levenshtein Distance）
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  levenshtein(a, b) {
    if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
    const m = a.length, n = b.length;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;

    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const temp = dp[j];
        dp[j] = a[i-1] === b[j-1]
          ? prev
          : Math.min(prev, dp[j], dp[j-1]) + 1;
        prev = temp;
      }
    }
    return dp[n];
  },

  /**
   * 基于编辑距离计算相似度 (0-1)
   * @param {string} a
   * @param {string} b
   * @returns {number} 0-1之间，1表示完全相同
   */
  similarity(a, b) {
    const na = this.normalize(a);
    const nb = this.normalize(b);
    if (!na && !nb) return 1;
    if (!na || !nb) return 0;
    const dist = this.levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    return 1 - dist / maxLen;
  },

  /**
   * 快速判断两段文本是否基本一致（用于去重）
   * 归一化后相似度 ≥ 0.95 视为重复
   */
  isDuplicate(a, b) {
    return this.similarity(a, b) >= 0.95;
  },

  /**
   * 判断答案文本标准化（处理 对/错/正确/错误/√/× 等变体）
   * @param {string} answer - 原始答案文本
   * @returns {string} '正确' | '错误' | 原文本
   */
  normalizeJudgeAnswer(answer) {
    if (!answer) return '';
    const trimmed = answer.trim();
    if (/^(对|正确|√|✓|是|yes|true|t)$/i.test(trimmed)) return '正确';
    if (/^(错|错误|×|✗|否|no|false|f)$/i.test(trimmed)) return '错误';
    return trimmed;
  }
};
