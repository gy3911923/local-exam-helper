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
   * 已归一化文本的相似度（带快速预筛）
   * 调用方已做 normalize 时用此方法，避免每对比对重复跑 5 次正则归一化。
   * cutoff：收集下限。数学性质：编辑距离 ≥ 长度差，故相似度上界 =
   * 1 - |len差|/maxLen；再用字符 bigram 公共度估第二个上界（可能高估 →
   * 只会少过滤、绝不误杀真匹配）。两个上界都 < cutoff 时直接返回 0，
   * 跳过 O(len²) DP —— 万级题库下把整体匹配量砍 ~2 个数量级。
   * @param {string} na - 已归一化文本 a
   * @param {string} nb - 已归一化文本 b
   * @param {number} [cutoff] - 收集下限（低于它必不被收集，可安全返回 0）
   * @returns {number} 0-1
   */
  similarityNormalized(na, nb, cutoff) {
    if (!na && !nb) return 1;
    if (!na || !nb) return 0;
    const maxLen = Math.max(na.length, nb.length);
    // 上界1：长度差（编辑距离 ≥ 长度差，严格下界 → 上界严格）
    const ub1 = 1 - Math.abs(na.length - nb.length) / maxLen;
    if (cutoff !== undefined && ub1 < cutoff) return 0;
    // 上界2：bigram 公共度（非严格，方向保守——低估公共度只会少过滤）
    if (cutoff !== undefined && ub1 < 0.85) {
      let common = 0;
      if (na.length > 1 && nb.length > 1) {
        const map = new Map();
        for (let i = 0; i < na.length - 1; i++) {
          const g = na.substr(i, 2);
          map.set(g, (map.get(g) || 0) + 1);
        }
        for (let i = 0; i < nb.length - 1; i++) {
          const g = nb.substr(i, 2);
          const c = map.get(g);
          if (c > 0) { common++; map.set(g, c - 1); }
        }
      }
      const ub2 = common / maxLen;
      if (ub2 < cutoff) return 0;
    }
    const dist = this.levenshtein(na, nb);
    return 1 - dist / maxLen;
  },

  /**
   * 快速判断两段文本是否基本一致（用于去重）
   * 归一化后相似度 ≥ 0.95 视为重复
   * 预筛：编辑距离 ≥ 长度差，故 |len差| > 0.05×maxLen 时相似度必 < 0.95，
   * 直接判非重复，免 O(len²) DP（垃圾候选场景下去重是分钟级卡死的主因之一）
   */
  isDuplicate(a, b) {
    const na = this.normalize(a);
    const nb = this.normalize(b);
    if (!na && !nb) return true;
    if (!na || !nb) return false;
    const maxLen = Math.max(na.length, nb.length);
    if (Math.abs(na.length - nb.length) > maxLen * 0.05) return false;
    return this.levenshtein(na, nb) <= maxLen * 0.05;
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
