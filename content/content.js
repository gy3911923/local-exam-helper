/**
 * content.js - 主控入口
 * 依赖：所有content/模块
 *
 * 三态模式：'off' | 'normal' | 'stealth'
 * - off: 完全关闭，无任何DOM注入
 * - normal: 普通模式，显示悬浮窗，自动答题
 * - stealth: 隐形模式，仅自动答题，无任何界面
 */

const ExamHelper = {

  _mode: 'off',       // 'off' | 'normal' | 'stealth'
  _questions: [],
  _matchResults: [],
  _banks: [],
  _answerMode: 'auto', // 'auto' | 'manual'
  _observer: null,
  _initialized: false,
  _answeredQuestions: new Set(), // 已作答的题目stem文本哈希，避免重复作答
  _correctedQuestions: new Set(), // 已纠错的题目，避免重复计数

  /** 初始化 */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      const config = await chrome.storage.local.get(['matchThreshold', 'autoMode']);
      this._answerMode = config.autoMode || 'auto';
    } catch(e) { /* ignore */ }

    // 监听来自 background 的消息
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'setMode') {
        this._setMode(msg.mode);
        sendResponse({ success: true });
      }
      if (msg.action === 'getState') {
        sendResponse({ mode: this._mode, answerMode: this._answerMode });
      }
      if (msg.action === 'showBankManager') {
        BankManager.show();
      }
      if (msg.action === 'savePageDone') {
        if (this._mode === 'normal') {
          const lines = (msg.filename || '').replace(/✅ /g, '💾 ').replace(/⚠️ /g, '⚠  ');
          const duration = msg.success ? 8000 : 5000;
          FloatPanel.showToast(lines + '\n\n⚠ 考前务必把 chrome://settings/downloads\n     位置改为「桌面」，否则找不到文件！', duration);
        }
      }
      if (msg.action === 'captureDebug') {
        sendResponse(this._captureDebug());
      }
      if (msg.action === 'captureHtml') {
        sendResponse({ html: document.documentElement.outerHTML });
      }
      return true;
    });
  },

  /** 模式切换核心 */
  async _setMode(newMode) {
    const prevMode = this._mode;
    if (prevMode === newMode) return;
    this._mode = newMode;

    if (newMode === 'off') {
      this._disable();
    } else if (newMode === 'normal') {
      this._enableNormal();
    } else if (newMode === 'stealth') {
      this._enableStealth();
    }
  },

  /** 普通模式：悬浮窗 + 自动答题 */
  async _enableNormal() {
    FloatPanel.create();
    await this._loadBanks();
    FloatPanel.updateStatus(true, this._banks.length);
    await this._scanAndAnswer();
    this._startObserver();
  },

  /** 隐形模式：后台答题，逐题间隔作答 */
  async _enableStealth() {
    FloatPanel.destroy();
    BankManager.destroy();
    await this._loadBanks();
    await this._scanAndAnswer();
    // 隐形模式下逐题作答，每题间隔2-4秒模拟人类
    await this._autoAnswerStealth(2000, 4000);
  },

  /**
   * 隐形模式作答：逐题回答，每题间隔随机延迟
   */
  async _autoAnswerStealth(minDelay = 2000, maxDelay = 5000) {
    for (const mr of this._matchResults) {
      const q = mr.question;
      if (!q.inputElements || q.inputElements.length === 0) continue;

      const key = q.normalizedStem || q.stemText;
      if (this._answeredQuestions.has(key)) continue;

      const allSelected = this._getAllSelectedInputs(q);

      if (mr.canAutoAnswer) {
        // 已正确 → 跳过
        if (allSelected.length > 0) {
          const firstSel = allSelected[0];
          if (this._isSameAnswer(firstSel, mr.bestAnswer, q)) {
            this._answeredQuestions.add(key);
            continue;
          }
        }
        // 已有错误选择 → 跳过（不自动纠正，不锁住选项）
        if (allSelected.length > 0 && !this._isSameAnswer(allSelected[0], mr.bestAnswer, q)) {
          this._answeredQuestions.add(key);
          continue;
        }

        // 空白 → 自动选择
        await Helpers.sleep(Helpers.randomDelay(minDelay, maxDelay));
        try {
          const bankOptions = (mr.results && mr.results[0]) ? (mr.results[0].options || null) : null;
          await this._selectAnswers(q, mr.bestAnswer, bankOptions);
          this._answeredQuestions.add(key);
        } catch(e) { /* ignore */ }
      } else {
        this._answeredQuestions.add(key);
      }
    }

    // 隐形模式无浮窗，不更新 UI
  },

  /** 完全关闭 */
  _disable() {
    FloatPanel.destroy();
    BankManager.destroy();
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._questions = [];
    this._matchResults = [];
    this._answeredQuestions.clear();
    this._correctedQuestions.clear();
  },

  /** 加载激活题库 */
  async _loadBanks() {
    try {
      const config = await chrome.storage.local.get(['activeBanks', 'bankPriorities']);
      const activeIds = config.activeBanks || [];
      const priorities = config.bankPriorities || {};

      // 请求background获取完整题库数据
      const response = await chrome.runtime.sendMessage({
        action: 'getActiveBankData',
        bankIds: activeIds,
        priorities
      });
      this._banks = response || [];
    } catch(e) {
      this._banks = [];
    }
  },

  /** 扫描并作答 */
  async _scanAndAnswer() {
    if (this._mode === 'off') return;

    // 识别题目
    this._questions = QuestionFinder.findAll();

    if (this._questions.length === 0) {
      if (this._mode === 'normal') FloatPanel.showIdle();
      return;
    }

    // 加载最新题库
    await this._loadBanks();

    // 匹配
    const threshold = await this._getThreshold();
    this._matchResults = Matcher.matchAll(this._questions, this._banks, threshold);

    // 不为全部题目作答——等待悬停触发逐题作答

    // 仅普通模式显示悬浮窗
    if (this._mode === 'normal') {
      FloatPanel.updateStatus(true, this._banks.length, this._answeredQuestions.size, this._correctedQuestions.size);
      if (this._matchResults.length > 0) {
        FloatPanel.showResult(this._questions[0], this._matchResults[0]);
      }
      this._bindHoverEvents();
    }
  },

  /**
   * Vue/Element UI 兼容的选项点击
   * 同时触发 click + change + input 事件，确保 Vue 的 v-model 更新
   */
  _fireClick(input) {
    input.click();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Element UI 额外：点击 .el-radio__inner 触发视觉切换
    const inner = input.parentElement?.querySelector('.el-radio__inner, .el-checkbox__inner');
    if (inner) inner.click();
  },

  /** 获取题目当前已选中的input（兼容 Element UI 的 .is-checked 类） */
  _getSelectedInput(q) {
    // 优先用原生 checked 属性
    const checked = q.inputElements.find(el => el.checked);
    if (checked) return checked;

    // Element UI 回退：检查 .el-radio.is-checked 或 .el-checkbox.is-checked
    return q.inputElements.find(el => {
      const wrapper = el.closest('.el-radio') || el.closest('.el-checkbox');
      return wrapper && wrapper.classList.contains('is-checked');
    }) || null;
  },

  /** 选中/取消选中一个选项（单次点击，兼容 Element UI 和纯 HTML） */
  _toggleOption(input) {
    input.click();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Element UI 需要点 inner 来触发 Vue 的响应
    const inner = input.parentElement?.querySelector('.el-radio__inner, .el-checkbox__inner');
    if (inner) inner.click();
  },

  /** 根据答案文本选中所有对应选项
   *  @param {object} bankOptions - 题库中的选项文本 {A:"xx",B:"xx"}，用于文本匹配
   */
  async _selectAnswers(q, answer, bankOptions = null) {
    if (!answer || !q.inputElements) return 0;
    const answerLetters = answer.toUpperCase().split('').filter(ch => /[A-H]/.test(ch));

    // 文本答案（"正确"/"错误"等）
    if (answerLetters.length === 0 && answer) {
      const target = TextNormalizer.normalize(answer);
      // 精确匹配优先
      for (const input of q.inputElements) {
        const pure = TextNormalizer.normalize(this._getInputLabel(input)).replace(/^[a-hA-H][.、) ]/, '').trim();
        if (pure === target) { this._toggleOption(input); return 1; }
      }
      // 包含匹配回退
      for (const input of q.inputElements) {
        if (TextNormalizer.normalize(this._getInputLabel(input)).includes(target)) {
          this._toggleOption(input);
          return 1;
        }
      }
      return 0;
    }

    // 有题库选项文本 → 用文本匹配（不受字母序号影响）
    if (bankOptions && Object.keys(bankOptions).length > 0) {
      let clicked = 0;
      const usedInputs = new Set(); // 防止一个 input 匹配多个字母

      // 第一轮：精确匹配（去字母前缀后完全相等）
      for (const letter of answerLetters) {
        const bankText = TextNormalizer.normalize(bankOptions[letter] || '');
        if (!bankText) continue;
        for (const input of q.inputElements) {
          if (usedInputs.has(input)) continue;
          const pureLabel = TextNormalizer.normalize(this._getInputLabel(input)).replace(/^[a-hA-H][.、) ]/, '').trim();
          if (pureLabel === bankText) {
            this._toggleOption(input);
            usedInputs.add(input);
            clicked++;
            break;
          }
        }
      }
      if (clicked === answerLetters.length) return clicked;

      // 第二轮：包含匹配（补救不完全相等的文本）
      for (const letter of answerLetters) {
        if (!bankOptions[letter]) continue;
        const bankText = TextNormalizer.normalize(bankOptions[letter]);
        for (const input of q.inputElements) {
          if (usedInputs.has(input)) continue;
          const pureLabel = TextNormalizer.normalize(this._getInputLabel(input)).replace(/^[a-hA-H][.、) ]/, '').trim();
          if (pureLabel.includes(bankText) && bankText.length > 1) { // >1 防止 "是"/"否" 误匹配
            this._toggleOption(input);
            usedInputs.add(input);
            clicked++;
            break;
          }
        }
      }
      if (clicked > 0) return clicked;
      // 文本匹配失败 → 继续走字母回退
    }

    // 单选 → 字母匹配回退
    if (answerLetters.length === 1) {
      const input = this._findInputByAnswer(q, answer);
      if (input) { this._toggleOption(input); return 1; }
      return 0;
    }

    // 多选 → 字母匹配回退
    let clicked = 0;
    for (const input of q.inputElements) {
      const labelText = this._getInputLabel(input);
      for (const letter of answerLetters) {
        if (labelText.startsWith(letter + '.') || labelText.startsWith(letter + '、') || labelText.startsWith(letter + ')') || labelText.startsWith(letter + ' ')) {
          this._toggleOption(input);
          clicked++;
          break;
        }
      }
    }
    return clicked;
  },

  /** 根据单个答案字母找到对应 input（纯字母匹配，_selectAnswers 的兜底） */
  _findInputByAnswer(q, answer) {
    if (!answer || !q.inputElements) return q.inputElements[0];
    const letter = answer.toUpperCase()[0];
    for (const input of q.inputElements) {
      const labelText = this._getInputLabel(input);
      if (labelText.startsWith(letter + '.') || labelText.startsWith(letter + '、') || labelText.startsWith(letter + ')') || labelText.startsWith(letter + ' ')) {
        return input;
      }
    }
    return q.inputElements[0];
  },
  _getInputLabel(input) {
    // 方式1：label[for]
    if (input.id) {
      const label = Helpers.safeQuery(`label[for="${input.id}"]`);
      if (label) return (label.textContent || '').trim();
    }
    // 方式2：往上找外层容器（.el-radio / .el-checkbox / 最近的 <label>）
    const wrapper = input.closest('.el-radio, .el-checkbox, label');
    if (wrapper) {
      const clone = wrapper.cloneNode(true);
      const inp = clone.querySelector('input');
      if (inp) inp.remove();
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    // 方式3：父元素文本
    const parent = input.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true);
      const inp = clone.querySelector('input');
      if (inp) inp.remove();
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return '';
  },

  /** 判断 input 是否在 UI 中显示为选中状态（兼容 Element UI） */
  _isInputCheckedInUI(input) {
    if (input.checked) return true;
    const wrapper = input.closest('.el-radio, .el-checkbox');
    return !!(wrapper && wrapper.classList.contains('is-checked'));
  },

  /** 获取题目所有已选中的 input（单选返回单个，多选返回数组） */
  _getAllSelectedInputs(q) {
    const selected = [];
    for (const input of q.inputElements) {
      if (this._isInputCheckedInUI(input)) {
        selected.push(input);
      }
    }
    return selected;
  },

  /** 判断已选答案是否与正确答案一致 */
  _isSameAnswer(selectedInput, correctAnswer, q) {
    const type = q.type || 'single';
    if (type === 'judge') {
      const label = this._getInputLabel(selectedInput);
      const isCorrect = /(对|正确|√|✓|是|yes|true)/i.test(correctAnswer);
      const isSelectedCorrect = /(对|正确|√|✓|是|yes|true)/i.test(label);
      return isCorrect === isSelectedCorrect;
    }

    // 多选题：比较选中集合而非单个字母
    if (type === 'multiple') {
      const correctLetters = (correctAnswer || '').toUpperCase().split('').filter(ch => /[A-H]/.test(ch));
      if (correctLetters.length === 0) return false;
      const selectedLetters = [];
      for (const input of q.inputElements) {
        if (this._isInputCheckedInUI(input)) {
          const m = this._getInputLabel(input).match(/^([A-H])[.、) ]/);
          if (m) selectedLetters.push(m[1].toUpperCase());
        }
      }
      if (selectedLetters.length === 0) return false;
      const correctSet = new Set(correctLetters);
      const selectedSet = new Set(selectedLetters);
      return correctSet.size === selectedSet.size && [...correctSet].every(l => selectedSet.has(l));
    }

    // 单选：比较选项字母
    const correctLetter = correctAnswer?.toUpperCase();
    const label = this._getInputLabel(selectedInput);
    return label.toUpperCase().startsWith(correctLetter + '.') ||
           label.toUpperCase().startsWith(correctLetter + '、') ||
           label.toUpperCase().startsWith(correctLetter + ')');
  },

  /** 绑定题目hover事件：鼠标移到哪题就答哪题（300ms延迟防误触） */
  _bindHoverEvents() {
    for (const mr of this._matchResults) {
      if (!mr.question.container) continue;
      const container = mr.question.container;

      container.addEventListener('mouseenter', async () => {
        if (this._mode !== 'normal') return;

        // 立即显示匹配结果
        FloatPanel.showResult(mr.question, mr);

        // 悬停触发逐题作答（已答过/低置信度/冲突 → 跳过）
        const q = mr.question;
        if (!q.inputElements || q.inputElements.length === 0) return;

        // 延迟300ms防快速滚屏误触
        await Helpers.sleep(300);

        const key = q.normalizedStem || q.stemText;

        // 已答且当前选中仍是正确答案 → 跳过
        if (mr.canAutoAnswer) {
          const alreadySelected = this._getSelectedInput(q);
          if (alreadySelected && this._isSameAnswer(alreadySelected, mr.bestAnswer, q)) {
            this._answeredQuestions.add(key);
            return;
          }

          // 已有选择但不正确 → 只显示结果，不自动清空（让用户自主决定）
          const allSelected = this._getAllSelectedInputs(q);
          if (allSelected.length > 0) return;

          // 完全空白 → 自动选择（无论题库能不能匹配到，不锁住选项）
          try {
            await Helpers.sleep(Helpers.randomDelay(100, 300));
            // 传递题库选项文本用于文本匹配（不受选项序号影响）
            const bankOptions = (mr.results && mr.results[0]) ? (mr.results[0].options || null) : null;
            const clicked = await this._selectAnswers(q, mr.bestAnswer, bankOptions);
            if (clicked > 0) {
              this._answeredQuestions.add(key);
              FloatPanel.updateStatus(true, this._banks.length, this._answeredQuestions.size, this._correctedQuestions.size);
            }
            // 选不中也绝不锁住——用户依然可以手动点击
          } catch(e) { /* ignore */ }
        }
      });
    }
  },

  /** 开启MutationObserver监听页面变化 */
  _startObserver() {
    if (this._observer) this._observer.disconnect();

    this._observer = new MutationObserver(
      Helpers.debounce(() => {
        if (this._mode !== 'off') this._scanAndAnswer();
      }, 1000)
    );

    this._observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  },

  /** 获取配置的阈值 */
  async _getThreshold() {
    try {
      const config = await chrome.storage.local.get(['matchThreshold']);
      return config.matchThreshold || 0.7;
    } catch(e) {
      return 0.7;
    }
  },

  /** 设置模式 */
  setMode(mode) {
    this._mode = mode;
    chrome.storage.local.set({ autoMode: mode });
  },

  /** 收集诊断数据（同步方法，分模块独立容错） */
  _captureDebug() {
    // 基础数据：即使后续全部失败也返回
    const data = {
      url: location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      scripts: { inline: [], external: {} },
      eventListeners: null,
      dom0Events: null,
      storage: { localStorage: {}, sessionStorage: {} },
      globalNames: [],
      meta: {}
    };

    try { data.scripts = this._captureAllScripts(); } catch(e) { data._scriptError = e.message; }
    try { data.eventListeners = this._captureEventListeners(); } catch(e) { data._eventError = e.message; }
    try { data.storage = this._captureStorage(); } catch(e) { data._storageError = e.message; }
    try { data.globalNames = this._captureGlobalNames(); } catch(e) { data._globalError = e.message; }
    try { data.meta = this._captureMeta(data.scripts); } catch(e) { data._metaError = e.message; }

    return data;
  },

  /** 同步收集 script 源码（不含 fetch 外部脚本——避免阻塞/超时） */
  _captureAllScripts() {
    const result = { inline: [], externalUrls: [] };
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.src) {
        result.externalUrls.push(s.src);
      } else if (s.textContent) {
        result.inline.push(s.textContent);
      }
    }
    return result;
  },

  _captureEventListeners() {
    if (window.___LEH_DEBUG___) {
      return {
        listeners: window.___LEH_DEBUG___.getListeners(),
        dom0Events: window.___LEH_DEBUG___.getDOM0Events()
      };
    }
    return null;
  },

  _captureStorage() {
    const storage = { localStorage: {}, sessionStorage: {} };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) storage.localStorage[k] = localStorage.getItem(k);
      }
    } catch(_) {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k) storage.sessionStorage[k] = sessionStorage.getItem(k);
      }
    } catch(_) {}
    return storage;
  },

  _captureGlobalNames() {
    const names = [];
    const skip = new Set(['___LEH_DEBUG___', 'FloatPanel', 'ExamHelper',
      'Matcher', 'QuestionFinder', 'BankManager', 'TextNormalizer', 'Helpers', 'DB']);
    try {
      for (const k of Object.getOwnPropertyNames(window)) {
        if (skip.has(k) || k.startsWith('webkit') || k.startsWith('on')) continue;
        try {
          const t = typeof window[k];
          if (t === 'function' || (t === 'object' && window[k] !== null)) {
            names.push(k + ' (' + t + ')');
          }
        } catch(_) {}
      }
    } catch(_) {}
    return names.slice(0, 50);
  },

  _captureMeta(scripts) {
    return {
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver || false,
      platform: navigator.platform,
      screenSize: `${screen.width}x${screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      documentReadyState: document.readyState,
      cookieCount: document.cookie.split(';').filter(c => c.trim()).length,
      iframeCount: document.querySelectorAll('iframe').length,
      scriptCount: (scripts.inline.length + scripts.externalUrls.length),
      externalScriptCount: scripts.externalUrls.length
    };
  }
};

// ===== 自启动 =====
ExamHelper.init();

// 不暴露全局变量（反检测）
