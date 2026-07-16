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
  _startW: 0,
  _startH: 0,
  _minW: 200,
  _minH: 100,

  // 命名函数引用（用于销毁时移除监听器）
  _onMouseMove: null,
  _onMouseUp: null,
  _onHeaderDown: null,
  _onResizeDown: null,

  /** 创建悬浮窗DOM */
  create() {
    if (this._panel) return;

    const panel = document.createElement('div');
    panel.id = '__leh_panel__';
    panel.innerHTML = `
      <div class="__leh_header__" id="__leh_header__">
        <span class="__leh_title__">📌 页面工具</span>
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

    this._bindEvents();
    this._restorePosition();
  },

  /** 销毁悬浮窗 + 清理事件监听 */
  destroy() {
    this._dragging = false;
    this._resizing = false;

    // 移除 document 级别监听器
    if (this._onMouseMove) {
      document.removeEventListener('mousemove', this._onMouseMove);
      this._onMouseMove = null;
    }
    if (this._onMouseUp) {
      document.removeEventListener('mouseup', this._onMouseUp);
      this._onMouseUp = null;
    }

    // 移除 DOM
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
    }
  },

  /** 绑定拖拽/缩放事件 */
  _bindEvents() {
    const header = document.getElementById('__leh_header__');
    const resizeHandle = document.getElementById('__leh_resize__');
    if (!header) return;

    // 移除旧监听器
    if (this._onHeaderDown) header.removeEventListener('mousedown', this._onHeaderDown);
    if (this._onResizeDown && resizeHandle) resizeHandle.removeEventListener('mousedown', this._onResizeDown);

    // 拖拽 — 命名函数
    const self = this;
    this._onHeaderDown = function(e) {
      if (e.target === resizeHandle || e.target.closest('#__leh_resize__')) return;
      self._dragging = true;
      const rect = self._panel.getBoundingClientRect();
      self._offsetX = e.clientX - rect.left;
      self._offsetY = e.clientY - rect.top;
      e.preventDefault();
    };
    header.addEventListener('mousedown', this._onHeaderDown);

    // 缩放 — 命名函数
    if (resizeHandle) {
      this._onResizeDown = function(e) {
        self._resizing = true;
        self._offsetX = e.clientX;
        self._offsetY = e.clientY;
        self._startW = self._panel.offsetWidth;
        self._startH = self._panel.offsetHeight;
        e.preventDefault();
        e.stopPropagation();
      };
      resizeHandle.addEventListener('mousedown', this._onResizeDown);
    }

    // mousemove — 命名函数
    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    this._onMouseMove = function(e) {
      if (self._dragging && self._panel) {
        let x = e.clientX - self._offsetX;
        let y = e.clientY - self._offsetY;
        x = Math.max(0, Math.min(x, window.innerWidth - self._panel.offsetWidth));
        y = Math.max(0, Math.min(y, window.innerHeight - self._panel.offsetHeight));
        self._panel.style.left = x + 'px';
        self._panel.style.top = y + 'px';
        self._panel.style.right = 'auto';
        self._panel.style.bottom = 'auto';
      }
      if (self._resizing && self._panel) {
        self._panel.style.width = Math.max(self._minW, self._startW + e.clientX - self._offsetX) + 'px';
        self._panel.style.height = Math.max(self._minH, self._startH + e.clientY - self._offsetY) + 'px';
      }
    };
    document.addEventListener('mousemove', this._onMouseMove);

    // mouseup — 命名函数 + 全局安全释放
    if (this._onMouseUp) document.removeEventListener('mouseup', this._onMouseUp);
    this._onMouseUp = function() {
      if (self._dragging || self._resizing) {
        self._savePosition();
      }
      self._dragging = false;
      self._resizing = false;
    };
    document.addEventListener('mouseup', this._onMouseUp);

    // 全局安全网：任何在面板外部的 mousedown 都强制释放拖拽状态
    document.addEventListener('mousedown', function forceRelease(e) {
      if (self._dragging || self._resizing) {
        if (self._panel && !self._panel.contains(e.target)) {
          self._dragging = false;
          self._resizing = false;
        }
      }
    }, true); // 捕获阶段
  },

  /** 保存位置到chrome.storage */
  _savePosition() {
    if (!this._panel) return;
    const rect = this._panel.getBoundingClientRect();
    chrome.storage.local.set({
      floatPanelPos: { x: rect.left, y: rect.top },
      floatPanelSize: { w: rect.width, h: rect.height }
    }).catch(() => {});
  },

  /** 恢复位置 */
  async _restorePosition() {
    if (!this._panel) return;
    try {
      const data = await chrome.storage.local.get(['floatPanelPos', 'floatPanelSize']);
      const pos = data.floatPanelPos || {};
      const size = data.floatPanelSize || { w: 320, h: 160 };

      if (pos.x != null && pos.y != null) {
        this._panel.style.left = Math.min(Math.max(0, pos.x), window.innerWidth - 100) + 'px';
        this._panel.style.top = Math.min(Math.max(0, pos.y), window.innerHeight - 50) + 'px';
        this._panel.style.right = 'auto';
        this._panel.style.bottom = 'auto';
      }
      this._panel.style.width = size.w + 'px';
      this._panel.style.height = size.h + 'px';
    } catch(e) { /* default */ }
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

    if (status === 'conflict') {
      html += `<div class="__leh_warn__">⚠️ 答案存疑，未自动勾选</div>`;
    } else if (status === 'low_confidence') {
      html += `<div class="__leh_warn__">⚠️ 匹配置信度不足，请人工确认</div>`;
    } else {
      html += `<div class="__leh_ok__">✅ 已匹配 · 来源：${this._esc(best.bankName)}</div>`;
    }

    const showResults = results.slice(0, 2);
    showResults.forEach((r, i) => {
      html += `
        <div class="__leh_result__">
          <div class="__leh_stem__">${this._truncate(r.stemText, 80)}</div>
          <div class="__leh_answer_row__">
            <span class="__leh_answer__" style="color:${i===0 ? scoreColor : '#8890a0'}">
              ${i===0 ? '⭐' : '··'} 答案: ${this._esc(r.answer)}
            </span>
            <span class="__leh_score__" style="background:${scoreColor}22;color:${scoreColor}">
              ${Math.round(r.score * 100)}%
            </span>
          </div>
          ${r.options ? `<div class="__leh_options__">${this._formatOptions(r.options, r.answer)}</div>` : ''}
          ${r.analysis ? `<div class="__leh_analysis__">${this._esc(r.analysis)}</div>` : ''}
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
  updateStatus(enabled, activeBanksCount, answeredCount, correctedCount) {
    const statusEl = document.getElementById('__leh_status__');
    if (!statusEl) return;
    if (enabled) {
      const parts = [];
      if (answeredCount !== undefined) {
        parts.push(`已答${answeredCount}题`);
      }
      if (correctedCount && correctedCount > 0) {
        parts.push(`纠错${correctedCount}题`);
      }
      if (activeBanksCount !== undefined && parts.length === 0) {
        parts.push(`${activeBanksCount}个题库`);
      }
      statusEl.textContent = '🟢 ' + (parts.length ? parts.join(' · ') : '运行中');
      statusEl.className = '__leh_status__ __leh_status_active__';
    } else {
      statusEl.textContent = '⏸ 就绪';
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
  },

  _esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
};
