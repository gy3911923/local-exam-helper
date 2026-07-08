/**
 * content.js - 主控入口
 * 依赖：所有content/模块
 *
 * 职责：开关控制、模块协调、自动答题调度、消息通信
 */

const ExamHelper = {

  _enabled: false,
  _questions: [],
  _matchResults: [],
  _banks: [],
  _mode: 'normal',  // 'normal' | 'manual'
  _observer: null,
  _initialized: false,

  /** 初始化（页面加载时自动执行一次） */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // 从 storage 恢复状态
    try {
      const config = await chrome.storage.local.get([
        'enabled', 'matchThreshold', 'activeBanks', 'autoMode'
      ]);
      this._mode = config.autoMode || 'normal';
    } catch(e) { /* 忽略 */ }

    // 监听来自 background 的消息
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'toggle') {
        if (msg.enabled) {
          this.enable();
        } else {
          this.disable();
        }
        sendResponse({ success: true });
      }
      if (msg.action === 'getState') {
        sendResponse({ enabled: this._enabled, mode: this._mode });
      }
      if (msg.action === 'showBankManager') {
        BankManager.show();
      }
      return true;
    });
  },

  /** 开启插件 */
  async enable() {
    if (this._enabled) return;
    this._enabled = true;

    // 创建UI
    FloatPanel.create();
    FloatPanel.updateStatus(true, 0);

    // 加载激活题库
    await this._loadBanks();
    FloatPanel.updateStatus(true, this._banks.length);

    // 执行识别
    await this._scanAndAnswer();

    // 监听页面变化（翻页/滚动加载）
    this._startObserver();
  },

  /** 关闭插件 */
  disable() {
    this._enabled = false;
    FloatPanel.destroy();
    BankManager.destroy();
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._questions = [];
    this._matchResults = [];
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
    if (!this._enabled) return;

    // 识别题目
    this._questions = QuestionFinder.findAll();

    if (this._questions.length === 0) {
      FloatPanel.showIdle();
      return;
    }

    // 加载最新题库
    await this._loadBanks();

    // 匹配
    const threshold = await this._getThreshold();
    this._matchResults = Matcher.matchAll(this._questions, this._banks, threshold);

    if (this._mode === 'normal') {
      // 普通模式：自动勾选
      await this._autoAnswer();
    }

    // 显示第一条结果
    if (this._matchResults.length > 0) {
      FloatPanel.showResult(this._questions[0], this._matchResults[0]);
    }

    // 绑定hover事件
    this._bindHoverEvents();
  },

  /** 自动勾选高置信度题目 */
  async _autoAnswer() {
    for (const mr of this._matchResults) {
      if (mr.canAutoAnswer && mr.question.inputElements.length > 0) {
        const input = mr.question.inputElements.find(
          el => el.closest('label')?.textContent?.includes(mr.bestAnswer)
        ) || mr.question.inputElements[0];

        // 模拟点击
        const delay = Helpers.randomDelay(50, 200);
        await Helpers.sleep(delay);
        try {
          input.click();
          // 触发change事件（部分框架需要）
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch(e) { /* 忽略点击失败 */ }
      }
    }
  },

  /** 绑定题目hover事件 */
  _bindHoverEvents() {
    for (const mr of this._matchResults) {
      if (!mr.question.container) continue;
      const container = mr.question.container;

      container.addEventListener('mouseenter', () => {
        if (!this._enabled) return;
        FloatPanel.showResult(mr.question, mr);
      });

      container.addEventListener('mouseleave', () => {
        // 不立即清空，保持最后结果
      });
    }
  },

  /** 开启MutationObserver监听页面变化 */
  _startObserver() {
    if (this._observer) this._observer.disconnect();

    this._observer = new MutationObserver(
      Helpers.debounce(() => {
        if (this._enabled) this._scanAndAnswer();
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

// 暴露全局接口供popup和其他模块使用
window.__ExamHelper = ExamHelper;
