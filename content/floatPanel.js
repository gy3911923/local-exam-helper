/**
 * floatPanel.js - 悬浮窗组件
 * 依赖：utils/common.js
 * 
 * 功能：可拖拽、可缩放、位置记忆、鼠标穿透内容区、显示匹配结果
 */
const FloatPanel = {

  _panel: null,
  _dragging: false,
  _resizing: false,
  _offsetX: 0,
  _offsetY: 0,
  _minW: 200,
  _minH: 100,

  /** 创建悬浮窗DOM */
  create() {
    if (this._panel) return;

    const panel = document.createElement('div');
    panel.id = '__leh_panel__';
    panel.innerHTML = `
      <div class="__leh_header__" id="__leh_header__">
        <span class="__leh_title__">📌 答题助手</span>
        <span class="__leh_status__" id="__leh_status__">⏸ 未激活</span>
      </div>
      <div class="__leh_body__" id="__leh_body__">
        <div class="__leh_placeholder__">
          <span style="font-size:28px">🔍</span>
          <p>悬停题目查看匹配结果</p>
        </div>
      </div>
      <div class="__leh_resize__" id="__leh_resize__"></div>
    `;
    document.body.appendChild(panel);
    this._panel = panel;

    // 绑定事件
    this._bindEvents();
    // 恢复位置
    this._restorePosition();
  },

  /** 销毁悬浮窗 */
  destroy() {
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
    }
  },

  /** 绑定拖拽/缩放事件 */
  _bindEvents() {
    const header = document.getElementById('__leh_header__');
    const resizeHandle = document.getElementById('__leh_resize__');

    // 拖拽
    header.addEventListener('mousedown', (e) => {
      if (e.target === resizeHandle) return;
      this._dragging = true;
      const rect = this._panel.getBoundingClientRect();
      this._offsetX = e.clientX - rect.left;
      this._offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    // 缩放
    resizeHandle.addEventListener('mousedown', (e) => {
      this._resizing = true;
      this._offsetX = e.clientX;
      this._offsetY = e.clientY;
      this._startW = this._panel.offsetWidth;
      this._startH = this._panel.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        let x = e.clientX - this._offsetX;
        let y = e.clientY - this._offsetY;
        // 屏幕边界限制
        x = Math.max(0, Math.min(x, window.innerWidth - this._panel.offsetWidth));
        y = Math.max(0, Math.min(y, window.innerHeight - this._panel.offsetHeight));
        this._panel.style.left = x + 'px';
        this._panel.style.top = y + 'px';
        this._panel.style.right = 'auto';
        this._panel.style.bottom = 'auto';
      }
      if (this._resizing) {
        const w = Math.max(this._minW, this._startW + e.clientX - this._offsetX);
        const h = Math.max(this._minH, this._startH + e.clientY - this._offsetY);
        this._panel.style.width = w + 'px';
        this._panel.style.height = h + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (this._dragging || this._resizing) {
        this._savePosition();
      }
      this._dragging = false;
      this._resizing = false;
    });
  },

  /** 保存位置到chrome.storage */
  _savePosition() {
    const rect = this._panel.getBoundingClientRect();
    chrome.storage.local.set({
      floatPanelPos: { x: rect.left, y: rect.top },
      floatPanelSize: { w: rect.width, h: rect.height }
    }).catch(() => {});
  },

  /** 恢复位置 */
  async _restorePosition() {
    try {
      const data = await chrome.storage.local.get(['floatPanelPos', 'floatPanelSize']);
      const pos = data.floatPanelPos || {};
      const size = data.floatPanelSize || { w: 320, h: 160 };

      if (pos.x != null) {
        this._panel.style.left = Math.min(pos.x, window.innerWidth - 100) + 'px';
        this._panel.style.top = Math.min(pos.y, window.innerHeight - 50) + 'px';
      }
      this._panel.style.width = size.w + 'px';
      this._panel.style.height = size.h + 'px';
    } catch(e) {
      // 使用默认位置
    }
  },

  /** 显示匹配结果 */
  showResult(question, matchResult) {
    const body = document.getElementById('__leh_body__');
    if (!body) return;

    const { results, canAutoAnswer, status } = matchResult;

    if (results.length === 0) {
      body.innerHTML = `
        <div class="__leh_placeholder__">
          <span style="font-size:24px">❓</span>
          <p>未找到匹配题目</p>
          <small>${this._truncate(question.stemText, 60)}</small>
        </div>`;
      return;
    }

    const best = results[0];
    const scorePct = Math.round(best.score * 100);
    const scoreColor = scorePct >= 80 ? '#10b981' : (scorePct >= 60 ? '#f59e0b' : '#ef4444');

    let html = '';

    // 冲突/低置信度提示
    if (status === 'conflict') {
      html += `<div class="__leh_warn__">⚠️ 答案存疑，未自动勾选</div>`;
    } else if (status === 'low_confidence') {
      html += `<div class="__leh_warn__">⚠️ 匹配置信度不足，请人工确认</div>`;
    } else {
      html += `<div class="__leh_ok__">✅ 已匹配 · 来源：${best.bankName}</div>`;
    }

    // 展示前两条结果
    const showResults = results.slice(0, 2);
    showResults.forEach((r, i) => {
      html += `
        <div class="__leh_result__">
          <div class="__leh_stem__">${this._truncate(r.stemText, 80)}</div>
          <div class="__leh_answer_row__">
            <span class="__leh_answer__" style="color:${i===0 ? scoreColor : '#8890a0'}">
              ${i===0 ? '⭐' : '··'} 答案: ${r.answer}
            </span>
            <span class="__leh_score__" style="background:${scoreColor}22;color:${scoreColor}">
              ${Math.round(r.score * 100)}%
            </span>
          </div>
          ${r.options ? `<div class="__leh_options__">${this._formatOptions(r.options, r.answer)}</div>` : ''}
          ${r.analysis ? `<div class="__leh_analysis__">${r.analysis}</div>` : ''}
        </div>`;
    });

    body.innerHTML = html;
  },

  /** 显示待机状态 */
  showIdle() {
    const body = document.getElementById('__leh_body__');
    if (!body) return;
    body.innerHTML = `
      <div class="__leh_placeholder__">
        <span style="font-size:28px">🔍</span>
        <p>悬停题目查看匹配结果</p>
      </div>`;
  },

  /** 更新状态标识 */
  updateStatus(enabled, activeBanksCount = 0) {
    const statusEl = document.getElementById('__leh_status__');
    if (!statusEl) return;
    if (enabled) {
      statusEl.textContent = `🟢 运行中 · ${activeBanksCount}个题库`;
      statusEl.className = '__leh_status__ __leh_status_active__';
    } else {
      statusEl.textContent = '⏸ 未激活';
      statusEl.className = '__leh_status__';
    }
  },

  _truncate(text, maxLen) {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  },

  _formatOptions(options, answer) {
    const answerSet = new Set((answer || '').toUpperCase().split(''));
    return Object.entries(options || {})
      .map(([k, v]) => {
        const isAnswer = answerSet.has(k);
        return `<span class="${isAnswer ? '__leh_opt_answer__' : '__leh_opt__'}">${k}. ${v}</span>`;
      })
      .join(' ');
  }
};
