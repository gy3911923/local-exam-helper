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
      await this._autoAnswer();
      // 更新悬浮窗状态，显示纠错统计
      if (this._lastStats) {
        const { corrected, filled } = this._lastStats;
        const status = document.getElementById('__leh_status__');
        if (status) {
          let extra = [];
          if (corrected > 0) extra.push(`纠正${corrected}题`);
          if (filled > 0) extra.push(`作答${filled}题`);
          if (extra.length > 0) {
            status.textContent = `🟢 运行中 · ` + extra.join(' · ');
          }
        }
      }
    }

    // 显示第一条结果
    if (this._matchResults.length > 0) {
      FloatPanel.showResult(this._questions[0], this._matchResults[0]);
    }

    // 绑定hover事件
    this._bindHoverEvents();
  },

  /** 自动作答（含已选纠错） */
  async _autoAnswer() {
    let corrected = 0;
    let filled = 0;

    for (const mr of this._matchResults) {
      const q = mr.question;
      if (!q.inputElements || q.inputElements.length === 0) continue;

      // 检测当前已选状态
      const alreadySelected = this._getSelectedInput(q);

      if (mr.canAutoAnswer) {
        // 有高置信度匹配
        const correctInput = this._findInputByAnswer(q, mr.bestAnswer);

        if (alreadySelected) {
          // 已选 → 检查是否正确
          if (this._isSameAnswer(alreadySelected, mr.bestAnswer, q)) {
            continue; // 正确，跳过
          }
          // 选错了 → 纠正
          await Helpers.sleep(Helpers.randomDelay(80, 200));
          try {
            alreadySelected.click(); // 先取消原选择
            alreadySelected.dispatchEvent(new Event('change', { bubbles: true }));
            await Helpers.sleep(Helpers.randomDelay(50, 150));
            if (correctInput) {
              correctInput.click();
              correctInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            corrected++;
          } catch(e) { /* ignore */ }
        } else {
          // 未选 → 自动勾选
          if (correctInput) {
            await Helpers.sleep(Helpers.randomDelay(50, 200));
            try {
              correctInput.click();
              correctInput.dispatchEvent(new Event('change', { bubbles: true }));
              filled++;
            } catch(e) { /* ignore */ }
          }
        }
      } else {
        // 低置信度/冲突 → 不操作
        continue;
      }
    }

    // 记录本次答题统计
    this._lastStats = { corrected, filled };
  },

  /** 获取题目当前已选中的input */
  _getSelectedInput(q) {
    return q.inputElements.find(el => el.checked) || null;
  },

  /** 根据答案文本找到对应input */
  _findInputByAnswer(q, answer) {
    if (!answer) return q.inputElements[0];

    // 多选答案（如 "ABD"）
    if (/^[A-H]+$/i.test(answer) && answer.length > 1) {
      // 多选场景返回第一个匹配的input，后续处理需遍历
      const labels = answer.toUpperCase().split('');
      for (const input of q.inputElements) {
        const labelText = this._getInputLabel(input);
        for (const l of labels) {
          if (labelText.startsWith(l + '.') || labelText.startsWith(l + '、') || labelText.startsWith(l + ')')) {
            return input;
          }
        }
      }
    }

    // 单选：按选项文本匹配
    const options = q.options || {};
    const targetLabel = Object.entries(options).find(([k]) => k === answer.toUpperCase());
    if (targetLabel) {
      const targetText = TextNormalizer.normalize(targetLabel[1]);
      for (const input of q.inputElements) {
        const labelText = TextNormalizer.normalize(this._getInputLabel(input));
        if (labelText.includes(targetText) || targetText.includes(labelText)) {
          return input;
        }
      }
    }

    return q.inputElements[0];
  },

  /** 获取input关联的label文本 */
  _getInputLabel(input) {
    // 方式1：label[for]
    if (input.id) {
      const label = Helpers.safeQuery(`label[for="${input.id}"]`);
      if (label) return (label.textContent || '').trim();
    }
    // 方式2：父元素文本
    const parent = input.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true);
      const inp = clone.querySelector('input');
      if (inp) inp.remove();
      return (clone.textContent || '').trim();
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
