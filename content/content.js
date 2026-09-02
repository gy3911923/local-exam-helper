// 兼容低版本 Chrome（<95）的 chrome.storage 包装（chrome.storage Promise 在 95+）
function storageGet(keys) {
  return new Promise((resolve) => {
    try { chrome.storage.local.get(keys, (r) => { if (chrome.runtime.lastError) resolve({}); else resolve(r); }); }
    catch(e) { resolve({}); }
  });
}
function storageSet(obj) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set(obj, () => { if (chrome.runtime.lastError) resolve(false); else resolve(true); }); }
    catch(e) { resolve(false); }
  });
}

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
  _hoverBound: false, // 防止 MutationObserver 重绑事件
  _stealthRunning: false, // 隐形作答并发锁：防止多循环对同一题重复点击
  _stealthEpoch: 0, // 隐形作答会话代次：指纹变化时 ++，使旧循环在 await 醒来后自愈退出，杜绝残余并发窗口
  _stealthDelaySec: 5, // 隐形作答题间延时（秒），Ctrl+↑/↓ 实时调整，运行中的循环每次 sleep 前动态读取
  _lastSpeedKeyAt: 0, // 快捷键 repeat 节流时间戳
  _banksVersion: null, // 题库版本标记，避免每次重扫都走 IndexedDB
  _questionsFingerprint: null, // 题目集指纹，题目没变时跳过 matchAll

  /** 初始化 */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // 默认状态：未启动（off）
    // 进考试页后按 Ctrl+Shift+E 进普通模式 / Ctrl+Shift+H 进后台模式
    // 快捷键是浏览器级能力，与网址无关——任何页面按都生效，无需域名白名单
    try {
      const config = await storageGet(['matchThreshold', 'autoMode']);
      this._answerMode = config.autoMode || 'auto';
    } catch(e) { /* ignore */ }

    // 注册答题速度快捷键 Ctrl+↑（加快）/ Ctrl+↓（减慢），考试中免开 popup
    this._bindSpeedKeys();

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

    // 读取用户配置的答题间隙（秒），默认 5 秒
    let delaySec = 5;
    try {
      const config = await storageGet(['stealthDelay']);
      const parsed = Number(config.stealthDelay);
      if (parsed > 0 && parsed <= 60) delaySec = parsed;
    } catch(e) { /* ignore */ }
    this._stealthDelaySec = delaySec;

    // 逐题作答（延时在循环内每次 sleep 前动态读取 _stealthDelaySec，
    // Ctrl+↑/↓ 调整后对正在运行的循环即时生效）
    await this._autoAnswerStealth();

    // 隐形模式同样监听页面变化（切科目/重开弹窗时重新扫描并作答）
    this._startObserver();
  },

  /**
   * 隐形模式作答：逐题回答，每题间隔随机延迟
   * 延时动态取 _stealthDelaySec（Ctrl+↑/↓ 实时调整，运行中即时生效）
   */
  async _autoAnswerStealth() {
    // 并发锁：已有作答循环在运行则跳过，避免多循环对同一题重复点击
    // （checkbox 多选重复点击会取消已选项；单选虽安全但没必要叠加）
    if (this._stealthRunning) return;
    this._stealthRunning = true;
    // 会话代次：捕获当前代次。指纹变化会 ++，本循环在任意 await 醒来后若发现
    // 代次已变（题目集已切换、新一轮作答已接管），立即退出，杜绝残余并发窗口
    // （旧循环 sleep 期间强制释放锁 + 启动新循环后，旧循环仍会继续点击的隐患）
    const epoch = this._stealthEpoch;
    try {
      for (const mr of this._matchResults) {
        // 模式已切换（normal/off）→ 立即停止隐形模式作答
        if (this._mode !== 'stealth') return;
        // 会话代次已变（切科目/重扫启动了新一轮作答）→ 让位于新循环，立即退出
        if (this._stealthEpoch !== epoch) return;

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

          // 空白 → 自动选择（延时每次现算，Ctrl+↑/↓ 调整即时生效）
          const sec = Math.max(1, Math.min(60, Number(this._stealthDelaySec) || 5));
          const minMs = Math.max(1000, Math.round(sec * 900));
          const maxMs = Math.max(minMs + 1, Math.round(sec * 1100));
          await Helpers.sleep(Helpers.randomDelay(minMs, maxMs));
          // sleep 期间用户可能切换了模式 → 放弃本次点击
          if (this._mode !== 'stealth') return;
          // sleep 期间题目集可能已切换（指纹变化 ++）→ 让位于新循环
          if (this._stealthEpoch !== epoch) return;
          try {
            const bankOptions = (mr.results && mr.results[0]) ? (mr.results[0].options || null) : null;
            await this._selectAnswers(q, mr.bestAnswer, bankOptions);
            this._answeredQuestions.add(key);
          } catch(e) { /* ignore */ }
        } else {
          this._answeredQuestions.add(key);
        }
      }
    } finally {
      this._stealthRunning = false;
    }

    // 隐形模式无浮窗，不更新 UI
  },

  /**
   * 答题速度快捷键：Ctrl+↑ 加快（题间延时 -1s）/ Ctrl+↓ 减慢（+1s）
   * 范围 1-60 秒；normal/stealth 模式生效；运行中的 stealth 循环即时生效（下次 sleep 前现算）
   */
  _bindSpeedKeys() {
    document.addEventListener('keydown', (e) => {
      if (this._mode === 'off') return;
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      // 按住连发节流：keydown repeat ~30Hz，限 ~5.5 次/秒
      if (e.repeat) {
        const now = Date.now();
        if (now - this._lastSpeedKeyAt < 180) return;
      }
      this._lastSpeedKeyAt = Date.now();
      this._adjustSpeed(e.key === 'ArrowUp' ? -1 : 1);
    });
  },

  /** 调整题间延时（秒）并持久化，附带轻提示 */
  _adjustSpeed(delta) {
    const cur = Number(this._stealthDelaySec) || 5;
    const next = Math.max(1, Math.min(60, cur + delta));
    if (next === cur) return;
    this._stealthDelaySec = next;
    // fire-and-forget：storageSet 已做 callback 包装，低版本 Chrome 安全
    storageSet({ stealthDelay: next });
    this._showSpeedTip(next);
  },

  /** 极简速度提示：右下角小字，700ms 自动消失（隐形模式用半透明深色，避免显眼） */
  _showSpeedTip(sec) {
    const px = '__leh_speed_tip__';
    const old = document.getElementById(px);
    if (old) old.remove();
    const tip = document.createElement('div');
    tip.id = px;
    tip.textContent = '速度 ' + sec + ' 秒/题';
    const stealth = this._mode === 'stealth';
    Object.assign(tip.style, {
      position: 'fixed',
      right: '14px',
      bottom: '14px',
      background: stealth ? 'rgba(0,0,0,0.4)' : 'rgba(26,26,46,0.9)',
      color: stealth ? '#cfd4dc' : '#fff',
      padding: '3px 9px',
      borderRadius: '5px',
      fontSize: stealth ? '11px' : '12px',
      lineHeight: '1.5',
      zIndex: '2147483646',
      fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      pointerEvents: 'none',
      opacity: '1',
      transition: 'opacity 0.3s ease'
    });
    document.body.appendChild(tip);
    setTimeout(() => {
      tip.style.opacity = '0';
      setTimeout(() => tip.remove(), 320);
    }, 700);
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
    this._questionsFingerprint = null;
  },

  /** 加载激活题库 */
  async _loadBanks() {
    try {
      const config = await storageGet(['activeBanks', 'bankPriorities']);
      const activeIds = config.activeBanks || [];
      const version = activeIds.sort().join(',');

      // 缓存命中：题库配置没变，跳过 IndexedDB → 消息通道序列化
      if (version === this._banksVersion && this._banks.length > 0) {
        return;
      }

      this._banksVersion = version;
      const priorities = config.bankPriorities || {};
      // 兼容低版本 Chrome：sendMessage 在 Chrome 99 前不返回 Promise
      const response = await Helpers.sendMessage({
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
      this._questionsFingerprint = null;
      if (this._mode === 'normal') FloatPanel.showIdle();
      return;
    }

    // 题目集指纹：题目没变（如用户点击选项、倒计时刷新）→ 跳过全量匹配
    // 只有翻页/加载新题（题目集变化）才真正重新匹配
    const fingerprint = this._questions.map(q => q.normalizedStem || q.stemText || '').join('\u0001');

    // 加载最新题库（缓存命中时零成本；题库激活变化时自动失效重载）
    await this._loadBanks();

    if (fingerprint === this._questionsFingerprint) {
      return;
    }
    this._questionsFingerprint = fingerprint;

    // 题目集已变化（切科目/翻页/重开弹窗）→ 解除 hover 绑定锁，
    // 让 _bindHoverEvents 重新绑定到新题目的 DOM 上；同时清空作答记录，
    // 避免同题干跨科目残留导致新题被误判为已答；并释放隐形作答并发锁，
    // 保证切科目后新一轮作答循环能正常启动（旧循环可能仍卡在 sleep 中）
    this._hoverBound = false;
    this._answeredQuestions.clear();
    // 会话代次 ++：使所有正在运行（含 sleep 挂起中）的旧作答循环在 await 醒来后
    // 检测到代次不匹配而立即退出，杜绝"强制释放锁 + 启动新循环后旧循环仍点击"的
    // 残余并发窗口（checkbox 多选会被二次 _toggleOption 取消 → 漏答）
    this._stealthEpoch++;
    this._stealthRunning = false;

    // 匹配
    const threshold = await this._getThreshold();
    this._matchResults = Matcher.matchAll(this._questions, this._banks, threshold);

    // 仅普通模式显示悬浮窗（题目集变化时重新绑定，否则仅更新状态）
    if (this._mode === 'normal') {
      FloatPanel.updateStatus(true, this._banks.length);
      if (!this._hoverBound) {
        this._bindHoverEvents();
        this._hoverBound = true;
      }
    }

    // 隐形模式：题目集变化（切科目/重开弹窗）→ 对新增未答题目自动作答
    if (this._mode === 'stealth') {
      this._autoAnswerStealth().catch(() => {});
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

  /**
   * 确保选项被选中（幂等）
   *
   * 背景：旧实现 _toggleOption = input.click() + inner.click()。真实浏览器中
   * .el-checkbox__inner 的 click 冒泡到 <label> 会触发隐式激活，再次转发 click 到
   * input → checkbox 被 toggle 两次 = 选中即取消（多选题只漏选/全不选）。
   * jsdom 不实现 label 隐式激活转发，故回归全绿而实战多选翻车（2026-09-02 实锤）。
   * radio 重复点击安全故单选/判断题未暴露。
   *
   * 修复：仅当选项未选中时点一次 input.click()（原生 click 自带 change，足以驱动
   * Vue/Element UI）；已选中则跳过——既防重复扫描把已选项取消，也保证多选逐个勾选稳定。
   */
  _ensureSelected(input) {
    // 已选中（原生 checked 或 Element UI .is-checked）→ 幂等跳过，防止取消已选项
    if (this._isInputCheckedInUI(input)) return;
    input.click();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // 不再点 .el-radio__inner/.el-checkbox__inner——label 隐式激活会二次 toggle checkbox
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
      // 精确匹配优先（先去字母前缀，再归一化）
      for (const input of q.inputElements) {
        const raw = this._getInputLabel(input).replace(/^[A-H][.、) ）、]/, '').trim();
        const pure = TextNormalizer.normalize(raw);
        if (pure === target) { this._ensureSelected(input); return 1; }
      }
      // 包含匹配回退
      for (const input of q.inputElements) {
        if (TextNormalizer.normalize(this._getInputLabel(input)).includes(target)) {
          this._ensureSelected(input);
          return 1;
        }
      }
      return 0;
    }

    // 有题库选项文本 → 用文本匹配（不受字母序号影响）
    if (bankOptions && Object.keys(bankOptions).length > 0) {
      let clicked = 0;
      const usedInputs = new Set(); // 防止一个 input 匹配多个字母

      // 第一轮：精确匹配（先去掉字母前缀，再归一化比对）
      for (const letter of answerLetters) {
        const bankText = TextNormalizer.normalize(bankOptions[letter] || '');
        if (!bankText) continue;
        for (const input of q.inputElements) {
          if (usedInputs.has(input)) continue;
          // 先去字母前缀（用原始文本，normalize 前做）
          const rawLabel = this._getInputLabel(input).replace(/^[A-H][.、) ）、]/, '').trim();
          const pureLabel = TextNormalizer.normalize(rawLabel);
          if (pureLabel === bankText) {
            this._ensureSelected(input);
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
        if (bankText.length < 1) continue;
        for (const input of q.inputElements) {
          if (usedInputs.has(input)) continue;
          // 先去字母前缀，再归一化
          const rawLabel = this._getInputLabel(input).replace(/^[A-H][.、) ）、]/, '').trim();
          const pureLabel = TextNormalizer.normalize(rawLabel);
          if (pureLabel.includes(bankText)) { // >1 防止 "是"/"否" 误匹配
            this._ensureSelected(input);
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
      if (input) { this._ensureSelected(input); return 1; }
      return 0;
    }

    // 多选 → 字母匹配回退
    let clicked = 0;
    for (const input of q.inputElements) {
      const labelText = this._getInputLabel(input);
      for (const letter of answerLetters) {
        if (labelText.startsWith(letter + '.') || labelText.startsWith(letter + '、') || labelText.startsWith(letter + ')') || labelText.startsWith(letter + ' ')) {
          this._ensureSelected(input);
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
    // 方式1：label[for]（去除 iconfont + 混淆隐藏标签）
    if (input.id) {
      const label = Helpers.safeQuery(`label[for="${input.id}"]`);
      if (label) {
        const lb = label.cloneNode(true);
        lb.querySelectorAll('.iconfont, [class*="iconfont"], [style*="display:none"], [style*="display: none"], [style*="opacity:0"], [style*="opacity: 0"], [style*="font-size:0"], [style*="font-size: 0"], [style*="visibility:hidden"], [style*="visibility: hidden"]').forEach(el => el.remove());
        return (lb.textContent || '').trim();
      }
    }
    // 方式2：往上找外层容器
    const wrapper = input.closest('.el-radio, .el-checkbox, label');
    if (wrapper) {
      const clone = wrapper.cloneNode(true);
      const inp = clone.querySelector('input');
      if (inp) inp.remove();
      clone.querySelectorAll('.iconfont, [class*="iconfont"], [style*="display:none"], [style*="display: none"], [style*="opacity:0"], [style*="opacity: 0"], [style*="font-size:0"], [style*="font-size: 0"], [style*="visibility:hidden"], [style*="visibility: hidden"]').forEach(el => el.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    // 方式3：父元素文本
    const parent = input.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true);
      const inp = clone.querySelector('input');
      if (inp) inp.remove();
      clone.querySelectorAll('.iconfont, [class*="iconfont"], [style*="display:none"], [style*="display: none"], [style*="opacity:0"], [style*="opacity: 0"], [style*="font-size:0"], [style*="font-size: 0"], [style*="visibility:hidden"], [style*="visibility: hidden"]').forEach(el => el.remove());
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
      if (!mr.question.container && !mr.question.inputElements) continue;
      const q = mr.question;

      // Element UI: 用 .selectAnswer 的父容器（即 .test.bm-exam-test 整题卡片）
      // → 鼠标进入题干 OR 选项都能触发
      const selectAnswer = q.inputElements.length > 0 && q.inputElements[0].closest('.selectAnswer');
      const hoverTarget = (selectAnswer && selectAnswer.parentElement)  // 整题卡片
        || (q.inputElements.length > 0 && q.inputElements[0].closest('.el-radio-group')?.parentElement)
        || q.container;
      if (!hoverTarget) continue;

      hoverTarget.addEventListener('mouseenter', async () => {
        if (this._mode !== 'normal') return;

        // 关键: 重扫后 question 对象是新的,=== 失效。用第一个 input 元素引用定位
        // DOM 元素不会变,无论扫描多少次都是同一个 <input>
        const cur = (q.inputElements.length && this._matchResults.find(m =>
          m.question.inputElements.length && m.question.inputElements[0] === q.inputElements[0]
        )) || mr;
        // 标准模式：仅显示答案，不自动答题（自动答题在隐形模式）
        FloatPanel.showResult(q, cur);
      });
    }
  },

  /** 开启MutationObserver监听页面变化 */
  _startObserver() {
    if (this._observer) this._observer.disconnect();

    this._observer = new MutationObserver(
      Helpers.debounce(() => {
        // 可选扫描的时机不重扫描相同的题库集
        if (this._mode !== 'off') this._scanAndAnswer();
      }, 2000)
    );

    this._observer.observe(document.body, {
      childList: true,
      subtree: true
      // 不用 characterData: 倒计时每秒更新 → 不必要的主力引导重扫描
    });
  },

  /** 获取配置的阈值 */
  async _getThreshold() {
    try {
      const config = await storageGet(['matchThreshold']);
      return config.matchThreshold || 0.6;
    } catch(e) {
      return 0.7;
    }
  },

  /** 设置模式 */
  setMode(mode) {
    this._mode = mode;
    storageSet({ autoMode: mode });
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
