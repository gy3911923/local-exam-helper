/**
 * floatPanel.js - 悬浮窗组件
 * 依赖：utils/common.js
 *
 * 功能：可拖拽、可缩放、位置记忆、鼠标穿透内容区、显示匹配结果
 */
const FloatPanel = {

  // 随机前缀——每次注入不同，页面无法靠固定签名检测
  _px: 'x' + crypto.randomUUID().replace(/-/g, '').slice(0, 10),
  _cssInjected: false,

  /** 注入随机化CSS（仅一次） */
  _injectCSS() {
    if (this._cssInjected) return;
    const px = this._px;
    const style = document.createElement('style');
    style.textContent = `
      #${px}_panel{position:fixed;right:16px;bottom:16px;width:320px;height:160px;background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);z-index:2147483646;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#e8e8f0;font-size:13px;user-select:none;transition:opacity .2s}
      .${px}_header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,.04);cursor:move;border-bottom:1px solid #2a2a3e}
      .${px}_title{font-weight:600;font-size:13px}
      .${px}_status{font-size:11px;color:#64748b;background:rgba(100,116,139,.15);padding:2px 8px;border-radius:10px}
      .${px}_status_active{color:#10b981!important;background:rgba(16,185,129,.15)!important}
      .${px}_body{padding:8px 12px;overflow-y:auto;height:calc(100% - 35px);pointer-events:none}
      .${px}_placeholder{text-align:center;padding:20px 0;color:#64748b}
      .${px}_placeholder p{margin:4px 0 0}
      .${px}_placeholder small{font-size:11px;opacity:.7;word-break:break-all}
      .${px}_warn{color:#f59e0b;font-size:12px;font-weight:600;padding:4px 8px;background:rgba(245,158,11,.1);border-radius:6px;margin-bottom:8px}
      .${px}_ok{color:#10b981;font-size:12px;padding:4px 8px;background:rgba(16,185,129,.1);border-radius:6px;margin-bottom:8px}
      .${px}_result{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)}
      .${px}_result:last-child{border-bottom:none}
      .${px}_stem{font-size:11px;color:#8890a0;line-height:1.4;margin-bottom:4px;word-break:break-all}
      .${px}_answer_row{display:flex;align-items:center;justify-content:space-between}
      .${px}_answer{font-size:14px;font-weight:700}
      .${px}_score{font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px}
      .${px}_options{font-size:11px;color:#64748b;margin-top:2px;word-break:break-all}
      .${px}_opt_answer{color:#10b981;font-weight:600}
      .${px}_opt{color:#64748b}
      .${px}_analysis{font-size:11px;color:#94a3b8;margin-top:2px;border-left:2px solid #334155;padding-left:6px;word-break:break-all}
      .${px}_resize{position:absolute;bottom:2px;right:2px;width:16px;height:16px;cursor:nwse-resize;pointer-events:auto;background:linear-gradient(135deg,transparent 50%,#334155 50%);border-radius:0 0 8px 0}
    `;
    document.head.appendChild(style);
    this._cssInjected = true;
  },

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
    this._injectCSS();
    const px = this._px;

    const panel = document.createElement('div');
    panel.id = `${px}_panel`;
    panel.innerHTML = `
      <div class="${px}_header" id="${px}_header">
        <span class="${px}_title">📌 页面工具</span>
        <span class="${px}_status" id="${px}_status">⏸ 未激活</span>
      </div>
      <div class="${px}_body" id="${px}_body">
        <div class="${px}_placeholder">
          <span style="font-size:28px">🔍</span>
          <p>悬停题目查看匹配结果</p>
        </div>
      </div>
      <div class="${px}_resize" id="${px}_resize"></div>
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
    const px = this._px;
    const header = document.getElementById(`${px}_header`);
    const resizeHandle = document.getElementById(`${px}_resize`);
    if (!header) return;

    // 移除旧监听器
    if (this._onHeaderDown) header.removeEventListener('mousedown', this._onHeaderDown);
    if (this._onResizeDown && resizeHandle) resizeHandle.removeEventListener('mousedown', this._onResizeDown);

    // 拖拽 — 命名函数 + pointer capture 防丢失
    const self = this;
    this._onHeaderDown = function(e) {
      if (e.target === resizeHandle || e.target.closest(`#${px}_resize`)) return;
      self._dragging = true;
      const rect = self._panel.getBoundingClientRect();
      self._offsetX = e.clientX - rect.left;
      self._offsetY = e.clientY - rect.top;
      self._panel.setPointerCapture(e.pointerId);
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
        self._panel.setPointerCapture(e.pointerId);
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

    // mouseup — 命名函数 + 释放 pointer capture
    if (this._onMouseUp) document.removeEventListener('mouseup', this._onMouseUp);
    this._onMouseUp = function(e) {
      if (self._dragging || self._resizing) {
        self._savePosition();
      }
      self._dragging = false;
      self._resizing = false;
      if (self._panel && e.pointerId !== undefined) self._panel.releasePointerCapture(e.pointerId);
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
    const px = this._px;
    const body = document.getElementById(`${px}_body`);
    if (!body) return;

    const { results, canAutoAnswer, status } = matchResult;

    if (results.length === 0) {
      body.innerHTML = `
        <div class="${px}_placeholder">
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
      html += `<div class="${px}_warn">⚠️ 答案存疑，未自动勾选</div>`;
    } else if (status === 'low_confidence') {
      html += `<div class="${px}_warn">⚠️ 匹配置信度不足，请人工确认</div>`;
    } else {
      const optCount = best.options ? Object.keys(best.options).length : 0;
      const optWarn = optCount > 0 && optCount < 3 && best.type !== 'judge' ? ` ⚠️${optCount}选项` : '';
      html += `<div class="${px}_ok">✅ 已匹配 · 来源：${this._esc(best.bankName)}${optWarn}</div>`;
    }

    const showResults = results.slice(0, 2);
    showResults.forEach((r, i) => {
      html += `
        <div class="${px}_result">
          <div class="${px}_stem">${this._esc(r.stemText)}</div>
          <div class="${px}_answer_row">
            <span class="${px}_answer" style="color:${i===0 ? scoreColor : '#8890a0'}">
              ${i===0 ? '⭐' : '··'} 答案: ${this._formatAnswer(r.answer, r.options)}
            </span>
            <span class="${px}_score" style="background:${scoreColor}22;color:${scoreColor}">
              ${Math.round(r.score * 100)}%
            </span>
          </div>
          ${r.options && Object.keys(r.options).length > 0
            ? `<div class="${px}_options">${this._formatOptions(r.options, r.answer)}</div>`
            : `<div class="${px}_options" style="color:#94a3b8;font-style:italic">（题库选项数据不完整）</div>`}
          ${r.analysis ? `<div class="${px}_analysis">${this._esc(r.analysis)}</div>` : ''}
        </div>`;
    });

    body.innerHTML = html;
  },

  /** 显示待机状态 */
  showIdle() {
    const px = this._px;
    const body = document.getElementById(`${px}_body`);
    if (!body) return;
    body.innerHTML = `
      <div class="${px}_placeholder">
        <span style="font-size:28px">🔍</span>
        <p>悬停题目查看匹配结果</p>
      </div>`;
  },

  /** 更新状态标识 */
  updateStatus(enabled, activeBanksCount, answeredCount, correctedCount) {
    const px = this._px;
    const statusEl = document.getElementById(`${px}_status`);
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
      statusEl.className = `${px}_status ${px}_status_active`;
    } else {
      statusEl.textContent = '⏸ 就绪';
      statusEl.className = `${px}_status`;
    }
  },

  _truncate(text, maxLen) {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  },

  _formatAnswer(answer, options) {
    if (!answer) return '无';
    if (!options || Object.keys(options).length === 0) return this._esc(answer);

    // 判断答案：正确/错误 → 返回原文
    if (/^(正确|错误|对|错)$/.test(answer)) return this._esc(answer);

    // 字母答案：展开为 "D. 防火安全措施"
    const letters = answer.toUpperCase().split('').filter(ch => /[A-H]/.test(ch));
    if (letters.length > 0) {
      return letters.map(k => {
        const text = options[k] || '';
        return text ? `${k}. ${text}` : k;
      }).join(' · ');
    }

    return this._esc(answer);
  },

  _formatOptions(options, answer) {
    const px = this._px;
    const answerSet = new Set((answer || '').toUpperCase().split(''));
    return Object.entries(options || {})
      .filter(([k, v]) => v && String(v).trim())
      .map(([k, v]) => {
        const isAnswer = answerSet.has(k);
        return `<span class="${isAnswer ? `${px}_opt_answer` : `${px}_opt`}">${k}. ${this._esc(v)}</span>`;
      })
      .join(' ');
  },

  _esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },

  /**
   * 短暂 Toast 通知
   * @param {string} message - 支持 \n 换行
   * @param {number} duration - 显示毫秒，默认 3000
   */
  showToast(message, duration = 3000) {
    const px = this._px;
    const old = document.getElementById(px + '_toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = px + '_toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(26,26,46,0.95)',
      color: '#e8e8f0',
      padding: '16px 28px',
      borderRadius: '10px',
      fontSize: '14px',
      lineHeight: '1.6',
      whiteSpace: 'pre-line',
      maxWidth: '480px',
      textAlign: 'left',
      zIndex: '2147483647',
      fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.08)',
      opacity: '1',
      transition: 'opacity 0.4s ease',
      pointerEvents: 'none'
    });
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }
};
