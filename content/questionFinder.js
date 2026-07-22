/**
 * questionFinder.js - 题目识别引擎
 * 依赖：utils/common.js, utils/textNormalize.js
 *
 * 策略层级（按优先级）：
 * 1. 原生表单回溯法 - 找radio/checkbox → 向上找共同祖先 → 提取题干
 * 2. 同name单选组聚类 - 按name属性分组定位题目边界
 * 3. 序号正则匹配 - 匹配"1." "1、" 等模式分割题目块
 * 4. 自定义选择器兜底 - 用户通过元素拾取配置
 */

const QuestionFinder = {

  /** 题型枚举 */
  TYPE: { SINGLE: 'single', MULTIPLE: 'multiple', JUDGE: 'judge', FILL: 'fill' },

  /**
   * 主入口：识别页面中所有题目
   * @returns {Array} [{id, stemText, options: {A, B, ...}, type, container, inputElements}]
   */
  findAll() {
    // 策略1: 原生表单回溯
    let questions = this._strategyFormBacktrace();
    if (questions.length > 0) return questions;

    // 策略2: 同name分组
    questions = this._strategyNameGrouping();
    if (questions.length > 0) return questions;

    // 策略3: 序号正则
    questions = this._strategyRegexMatch();
    return questions;
  },

  // ========== 策略1: 表单回溯 ==========

  _strategyFormBacktrace() {
    const radioInputs = Helpers.safeQueryAll('input[type="radio"]');
    const checkboxInputs = Helpers.safeQueryAll('input[type="checkbox"]');

    if (radioInputs.length === 0 && checkboxInputs.length === 0) return [];

    // 检测：有 name 属性 → 按 name 分组；否则按 el-radio-group / el-checkbox-group 分组
    const hasNames = radioInputs.some(inp => inp.getAttribute('name'));
    const radioGroups = hasNames
      ? this._groupByName(radioInputs)
      : this._groupByElWrapper(radioInputs, '.el-radio-group');
    const checkboxGroups = hasNames
      ? this._groupByName(checkboxInputs)
      : this._groupByElWrapper(checkboxInputs, '.el-checkbox-group');

    const questions = [];

    // 处理单选组
    for (const [key, inputs] of Object.entries(radioGroups)) {
      const q = this._extractQuestion(inputs, 'single');
      if (q) questions.push(q);
    }

    // 处理多选组
    for (const [key, inputs] of Object.entries(checkboxGroups)) {
      const q = this._extractQuestion(inputs, 'multiple');
      if (q) questions.push(q);
    }

    // 按DOM顺序排序
    return this._sortByDOMOrder(questions);
  },

  /** 按name属性分组 */
  _groupByName(inputs) {
    const groups = {};
    for (const input of inputs) {
      const name = input.getAttribute('name') || input.id || '';
      if (!groups[name]) groups[name] = [];
      groups[name].push(input);
    }
    return groups;
  },

  /** 按 Element UI 容器分组（el-radio-group / el-checkbox-group） */
  _groupByElWrapper(inputs, selector) {
    const groups = {};
    let idx = 0;
    for (const input of inputs) {
      const wrapper = input.closest(selector);
      const key = wrapper ? '_el_wrap_' + (idx++) : '_orphan_' + Math.random();
      if (!groups[key]) groups[key] = [];
      groups[key].push(input);
    }
    return groups;
  },

  /** 从一组input中提取题目信息 */
  _extractQuestion(inputs, type) {
    if (inputs.length === 0) return null;

    const container = this._findQuestionContainer(inputs);
    if (!container) return null;

    // 提取题干文本
    const stemText = this._extractStemText(container, inputs);

    // 提取选项
    const options = this._extractOptions(inputs, container);

    return {
      id: Helpers.uid(),
      stemText,
      normalizedStem: TextNormalizer.normalize(stemText),
      options,
      type: this.detectType(inputs),  // 自动检测 single/judge/multiple
      container,
      inputElements: inputs
    };
  },

  /**
   * 向上查找题目容器
   * 策略：找最小的祖先，要求：
   *   1. 包含所有 input
   *   2. 包含选项label之外的文本（即题干）
   *   3. 不是 body/html/form
   */
  _findQuestionContainer(inputs) {
    const maxDepth = 10;
    let cursor = inputs[0].parentElement;
    let fallback = null;

    for (let depth = 0; depth < maxDepth && cursor; depth++) {
      if (cursor.nodeType !== 1) { cursor = cursor.parentElement; continue; }
      const tag = cursor.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html' || tag === 'form') break;

      // 必须包含所有input
      if (!inputs.every(inp => cursor.contains(inp))) {
        cursor = cursor.parentElement;
        continue;
      }

      // 第一个合格祖先先记下来（包含所有input但可能不含题干）
      if (!fallback) fallback = cursor;

      // 检查是否有"题干"：去除所有option-label后的剩余文本
      const stemText = this._getStemTextFromNode(cursor);
      if (stemText && stemText.length >= 4) {
        return cursor;  // ✅ 找到了含题干的最小容器
      }

      cursor = cursor.parentElement;
    }

    // 兜底：找不到含题干的容器时，返回最浅的合格祖先
    return fallback || inputs[0].parentElement;
  },

  /** 从节点提取题干文本（去除所有选项label后剩余的文本） */
  _getStemTextFromNode(node) {
    const clone = node.cloneNode(true);
    const labels = clone.querySelectorAll('label');
    labels.forEach(label => {
      const inp = label.querySelector('input[type="radio"], input[type="checkbox"]');
      if (inp) label.remove();
    });
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  },

  /** 提取题干文本（去除所有选项label后剩余的文本） */
  _extractStemText(container, inputs) {
    // Element UI 特殊处理：inputs 在 .selectAnswer 内，题干在上方
    const selectAnswer = inputs[0].closest('.selectAnswer');
    if (selectAnswer) {
      let prev = selectAnswer.previousElementSibling;
      const texts = [];
      while (prev) {
        // 优先从 .headerContent 提取实际题干 span（过滤类型/分数标签）
        const headerContent = prev.querySelector('.headerContent');
        if (headerContent) {
          const spans = headerContent.querySelectorAll('span');
          for (const span of spans) {
            const t = (span.textContent || '').trim();
            if (!t) continue;
            if (/^\(\s*(单|多|判|选|简|填).*\)$/i.test(t)) continue;
            if (/^\(\d+(\.\d+)?分\)$/.test(t)) continue;
            if (/^\d+(\.\d+)?分$/.test(t)) continue;
            texts.unshift(t);
          }
        } else {
          const t = (prev.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length >= 2) texts.unshift(t);
        }
        prev = prev.previousElementSibling;
      }
      if (texts.length > 0) return texts.join(' ');
    }
    }
    return this._getStemTextFromNode(container);
  },

  /** 提取选项文本（兼容 Element UI / 标准表单 / 自定义结构） */
  _extractOptions(inputs, container) {
    const options = {};
    const labels = 'ABCDEFGH'.split('');

    for (let i = 0; i < inputs.length && i < labels.length; i++) {
      const input = inputs[i];
      let optionText = '';

      // 策略1: Element UI — 找 .el-radio__label 或 .el-checkbox__label
      const elWrapper = input.closest('.el-radio') || input.closest('.el-checkbox');
      if (elWrapper) {
        const elLabel = elWrapper.querySelector('.el-radio__label, .el-checkbox__label');
        if (elLabel) {
          optionText = (elLabel.textContent || '').trim();
        }
      }

      // 策略2: 标准 label[for] 关联
      if (!optionText && input.id) {
        const label = Helpers.safeQuery(`label[for="${input.id}"]`, container);
        if (label) optionText = (label.textContent || '').trim();
      }

      // 策略3: 父元素文本回退
      if (!optionText) {
        const parent = input.parentElement;
        if (parent) {
          const clone = parent.cloneNode(true);
          const inpClone = clone.querySelector('input');
          if (inpClone) inpClone.remove();
          optionText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        }
      }

      // 去掉选项字母前缀（如 "A." "A、"）
      optionText = optionText.replace(/^[A-H][\.\、\)）]?\s*/, '').trim();

      if (optionText) {
        options[labels[i]] = optionText;
      }
    }

    return options;
  },

  // ========== 策略2: 同name分组 ==========

  _strategyNameGrouping() {
    // 与策略1逻辑相同，但用于无标准radio但有关联input的场景
    return [];
  },

  // ========== 策略3: 序号正则匹配 ==========

  _strategyRegexMatch() {
    const body = document.body;
    if (!body) return [];

    const text = body.innerText || '';
    // 匹配 "1." "1、" "1）" "第1题" 等序号
    const patterns = [
      /\n\s*(\d+)[\.\、\)）]\s*/g,       // 1. 1、 1)
      /\n\s*第\s*(\d+)\s*题\s*/g,        // 第1题
    ];

    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length >= 2) {
        // 简单分割，返回文本块
        return matches.map((m, i) => ({
          id: Helpers.uid(),
          stemText: '',
          normalizedStem: '',
          options: {},
          type: 'single',
          container: body,
          inputElements: [],
          _regexMatch: m[0]
        }));
      }
    }

    return [];
  },

  // ========== 辅助方法 ==========

  /** 按DOM顺序排序 */
  _sortByDOMOrder(questions) {
    const elements = document.querySelectorAll('*');
    const positions = new Map();
    for (let i = 0; i < elements.length; i++) {
      positions.set(elements[i], i);
    }

    return questions.sort((a, b) => {
      const posA = positions.get(a.container) ?? Infinity;
      const posB = positions.get(b.container) ?? Infinity;
      return posA - posB;
    });
  },

  /** 判断题目类型（用选项标签文本判定判断题，不靠选项数量） */
  detectType(inputElements) {
    if (!inputElements || inputElements.length === 0) return this.TYPE.SINGLE;
    const first = inputElements[0];
    if (first.type === 'checkbox') return this.TYPE.MULTIPLE;
    if (first.type === 'radio') {
      // 提取所有选项文本
      const labelTexts = inputElements.map(inp => {
        const elRadio = inp.closest('.el-radio');
        if (elRadio) {
          const lbl = elRadio.querySelector('.el-radio__label');
          if (lbl) return (lbl.textContent || '').trim();
        }
        const parent = inp.parentElement;
        if (parent) {
          const clone = parent.cloneNode(true);
          const ic = clone.querySelector('input');
          if (ic) ic.remove();
          return (clone.textContent || '').replace(/\s+/g, ' ').trim();
        }
        return '';
      });
      // 含"正确/错误/对/错/是/否"且选项≤3 → 判断题
      const hasJudgeWords = labelTexts.some(t => /(正确|错误|对|错|是|否|[√✓]|[×✗]|true|false|yes|no)/i.test(t));
      if (hasJudgeWords && inputElements.length <= 3) return this.TYPE.JUDGE;
      return this.TYPE.SINGLE;
    }
    return this.TYPE.SINGLE;
  },

  /** 提取填空题的输入框 */
  findFillInputs() {
    return Helpers.safeQueryAll('input[type="text"]:not([name*="search"]), textarea:not([name*="search"])')
      .filter(el => {
        // 过滤太小的输入框（不太可能是填空题）
        const w = el.offsetWidth || parseInt(el.style.width) || 200;
        return w > 50;
      });
  }
};
