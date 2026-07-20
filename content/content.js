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
        if (msg.success) {
          if (this._mode === 'normal') FloatPanel.showToast('💾 已保存到桌面: ' + msg.filename);
        } else {
          if (this._mode === 'normal') FloatPanel.showToast('❌ 保存失败: ' + (msg.error || '未知错误'));
        }
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

      const alreadySelected = this._getSelectedInput(q);

      if (mr.canAutoAnswer) {
        if (alreadySelected && this._isSameAnswer(alreadySelected, mr.bestAnswer, q)) {
          this._answeredQuestions.add(key);
          continue;
        }

        // 每题等待2-4秒再答
        await Helpers.sleep(Helpers.randomDelay(minDelay, maxDelay));

        try {
          if (alreadySelected) {
            // 先取消原错误选择
            this._fireClick(alreadySelected);
            await Helpers.sleep(Helpers.randomDelay(50, 150));
          }
          this._selectAnswers(q, mr.bestAnswer);
          this._answeredQuestions.add(key);
          if (alreadySelected) this._correctedQuestions.add(key);
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

  /** 根据答案文本选中所有对应选项（单选点一个，多选点全部） */
  async _selectAnswers(q, answer) {
    if (!answer || !q.inputElements) return 0;
    const answerLetters = answer.toUpperCase().split('').filter(ch => /[A-H]/.test(ch));

    // 文本答案（"正确"/"错误"等）
    if (answerLetters.length === 0 && answer) {
      const target = TextNormalizer.normalize(answer);
      for (const input of q.inputElements) {
        if (TextNormalizer.normalize(this._getInputLabel(input)).includes(target)) {
          this._toggleOption(input);
          return 1;
        }
      }
      return 0;
    }

    // 单选答案 → 只点第一个匹配
    if (answerLetters.length === 1) {
      const input = this._findInputByAnswer(q, answer);
      if (input) { this._toggleOption(input); return 1; }
      return 0;
    }

    // 多选答案（如 "ABD"）→ 逐个点击所有字母对应的选项
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

  /** 根据单个答案字母找到对应input（仅用于单选/判断检查） */
  _findInputByAnswer(q, answer) {
    if (!answer || !q.inputElements) return q.inputElements[0];
    const letter = answer.toUpperCase()[0];
    for (const input of q.inputElements) {
      const labelText = this._getInputLabel(input);
      if (labelText.startsWith(letter + '.') || labelText.startsWith(letter + '、') || labelText.startsWith(letter + ')') || labelText.startsWith(letter + ' ')) {
        return input;
      }
    }
    // 回退：按选项文本匹配
    const options = q.options || {};
    const targetLabel = Object.entries(options).find(([k]) => k.toUpperCase() === answer.toUpperCase());
    if (targetLabel) {
      const targetText = TextNormalizer.normalize(targetLabel[1]);
      for (const input of q.inputElements) {
        if (TextNormalizer.normalize(this._getInputLabel(input)).includes(targetText)) return input;
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

  /** 判断已选答案是否与正确答案一致 */
  _isSameAnswer(selectedInput, correctAnswer, q) {
    const type = q.type || 'single';
    if (type === 'judge' || (q.inputElements.length <= 2 && type === 'single')) {
      const label = this._getInputLabel(selectedInput);
      const isCorrect = /^(对|正确|√|✓|是|yes|true)$/i.test(correctAnswer);
      const isSelectedCorrect = /^(对|正确|√|✓|是|yes|true)$/i.test(label);
      return isCorrect === isSelectedCorrect;
    }

    // 单选/多选：比较选项字母
    const selectedValue = selectedInput.value;
    const correctLetter = correctAnswer?.toUpperCase();

    // 检查input是否对应正确答案的字母
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

        // 已答且当前选中仍是正确答案 → 跳过；被手动改错 → 往下走纠错
        if (mr.canAutoAnswer) {
          const alreadySelected = this._getSelectedInput(q);
          if (alreadySelected && this._isSameAnswer(alreadySelected, mr.bestAnswer, q)) {
            this._answeredQuestions.add(key);
            return;
          }

          try {
            if (alreadySelected) {
              await Helpers.sleep(Helpers.randomDelay(80, 200));
              // 直接取消选中，兼容 Element UI 和纯 HTML 页面
              alreadySelected.checked = false;
              alreadySelected.dispatchEvent(new Event('change', { bubbles: true }));
              const w = alreadySelected.closest('.el-radio, .el-checkbox');
              if (w) { w.classList.remove('is-checked'); w.classList.remove('el-radio'); /* wrong qclaw selector */ }
              await Helpers.sleep(Helpers.randomDelay(50, 150));
            } else {
              await Helpers.sleep(Helpers.randomDelay(100, 300));
            }
            await this._selectAnswers(q, mr.bestAnswer);
            this._answeredQuestions.add(key);
            if (alreadySelected) this._correctedQuestions.add(key);
            FloatPanel.updateStatus(true, this._banks.length, this._answeredQuestions.size, this._correctedQuestions.size);
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
  }
};

// ===== 自启动 =====
ExamHelper.init();

// 不暴露全局变量（反检测）
