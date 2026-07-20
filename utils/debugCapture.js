/**
 * debugCapture.js — document_start 注入
 * 在所有页面脚本之前运行，劫持 addEventListener 记录事件监听
 * 
 * 暴露到 window.___LEH_DEBUG___ 供后续 content script 收集
 */
(function() {
  'use strict';

  const records = {
    document: [],
    window: [],
    body: [],
    others: []  // 其他元素的监听，只记录类型和标签名
  };

  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  /** 记录事件 */
  function _record(target, type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
    // 跳过我们自己的监听
    if (type === undefined || listener === undefined) return;

    const entry = { type, capture, once: !!(options && options.once), passive: !!(options && options.passive) };

    if (target === document) {
      records.document.push(entry);
    } else if (target === window) {
      records.window.push(entry);
    } else if (target === document.body) {
      records.body.push(entry);
    } else {
      const tag = (target && target.tagName) ? target.tagName.toLowerCase() : 'unknown';
      // 避免重复——只记录不同的事件类型+标签
      const key = tag + '|' + type + '|' + (capture ? 'c' : 'b');
      if (!records.others.find(r => r.key === key)) {
        records.others.push({ key, tag, type, capture });
      }
    }
  }

  // 劫持 addEventListener
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    try { _record(this, type, listener, options); } catch(e) { /* ignore */ }
    return origAdd.call(this, type, listener, options);
  };

  // 劫持 removeEventListener（记录移除）
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    return origRemove.call(this, type, listener, options);
  };

  // 暴露收集接口
  window.___LEH_DEBUG___ = {
    getListeners: function() {
      // 去重
      return {
        document: [...new Map(records.document.map(r => [r.type + '|' + r.capture, r])).values()],
        window: [...new Map(records.window.map(r => [r.type + '|' + r.capture, r])).values()],
        body: [...new Map(records.body.map(r => [r.type + '|' + r.capture, r])).values()],
        others: records.others
      };
    },
    // 额外：记录 on-event 属性（onblur/onfocus 等经典检测点）
    getDOM0Events: function() {
      const events = {};
      const check = ['onblur', 'onfocus', 'onvisibilitychange', 'onbeforeunload', 'onunload',
                     'onkeydown', 'onkeyup', 'onmousemove', 'onclick', 'oncopy', 'onpaste',
                     'oncontextmenu', 'onselectstart'];
      for (const ev of check) {
        if (typeof window[ev] === 'function' || window[ev] !== null && window[ev] !== undefined) {
          events['window.' + ev] = typeof window[ev] === 'function' ? 'function' : String(window[ev]);
        }
        if (typeof document[ev] === 'function' || document[ev] !== null && document[ev] !== undefined) {
          events['document.' + ev] = typeof document[ev] === 'function' ? 'function' : String(document[ev]);
        }
      }
      return events;
    }
  };
})();
