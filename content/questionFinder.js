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

    // 按name分组radio
    const radioGroups = this._groupByName(radioInputs);
    const checkboxGroups = this._groupByName(checkboxInputs);

    const questions = [];

    // 处理单选组
    for (const [name, inputs] of Object.entries(radioGroups)) {
      const q = this._extractQuestion(inputs, 'single');
      if (q) questions.push(q);
    }

    // 处理多选组
    for (const [name, inputs] of Object.entries(checkboxGroups)) {
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
      type,
      container,
      inputElements: inputs
    };
  },

  /** 向上查找题目容器 */
  _findQuestionContainer(inputs) {
    // 找所有input的最近公共祖先
    let ancestor = inputs[0].parentElement;
    const maxDepth = 8;

    for (let depth = 0; depth < maxDepth && ancestor; depth++) {
      // 检查是否包含所有input
      if (inputs.every(inp => ancestor.contains(inp))) {
        // 如果不是太泛的祖先（比如body/html），就返回
        const tag = ancestor.tagName.toLowerCase();
        if (tag !== 'body' && tag !== 'html' && tag !== 'form') {
          return ancestor;
        }
      }
      ancestor = ancestor.parentElement;
    }

    // 兜底：返回第一个input的父元素往上3级
    let el = inputs[0].parentElement;
    for (let i = 0; i < 3 && el; i++) el = el.parentElement;
    return el || inputs[0].parentElement;
  },

  /** 提取题干文本 */
  _extractStemText(container, inputs) {
    // 获取容器内所有文本，排除选项label中的文本
    const clone = container.cloneNode(true);

    // 移除选项相关的label
    const labels = clone.querySelectorAll('label');
    labels.forEach(label => {
      const inp = label.querySelector('input[type="radio"], input[type="checkbox"]');
      if (inp) label.remove();
    });

    // 移除纯选项文本（紧跟在input后面的文本节点）
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text;
  },

  /** 提取选项文本 */
  _extractOptions(inputs, container) {
    const options = {};
    const labels = 'ABCDEFGH'.split('');

    for (let i = 0; i < inputs.length && i < labels.length; i++) {
      const input = inputs[i];
      let optionText = '';

      // 尝试从关联label获取文本
      if (input.id) {
        const label = Helpers.safeQuery(`label[for="${input.id}"]`, container);
        if (label) optionText = (label.textContent || '').trim();
      }

      // 如果没有label，从父元素获取
      if (!optionText) {
        const parent = input.parentElement;
        if (parent) {
          // 去掉input本身的文本，取label内容
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

  /** 判断题目类型 */
  detectType(inputElements) {
    if (!inputElements || inputElements.length === 0) return this.TYPE.SINGLE;
    const first = inputElements[0];
    if (first.type === 'checkbox') return this.TYPE.MULTIPLE;
    if (first.type === 'radio') return inputElements.length <= 2 ? this.TYPE.JUDGE : this.TYPE.SINGLE;
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
