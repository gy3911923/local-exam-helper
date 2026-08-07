/**
 * common.js - 通用工具函数
 * 依赖：无
 */

const Helpers = {

  /** 生成唯一ID */
  uid() {
    return 'l'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  },

  /**
   * 兼容低版本 Chrome 的 sendMessage 包装
   * Chrome 99 之前 chrome.runtime.sendMessage 不返回 Promise
   * → await 形式在 Chrome 93 得到 undefined → 导入/删除全部失败
   * 用 callback 形式 + Promise 包装，所有版本通用
   */
  sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        });
      } catch(e) {
        resolve({ error: e.message || '消息发送失败' });
      }
    });
  },

  /**
   * 生成随机十六进制串（反检测前缀用）
   * 兼容低版本 Chrome：crypto.randomUUID 需 Chrome 92+，低版本回退 Math.random
   */
  randomHex(len = 10) {
    try {
      if (crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '').slice(0, len);
      }
    } catch(e) { /* 回退 */ }
    let s = '';
    const chars = '0123456789abcdef';
    for (let i = 0; i < len; i++) {
      s += chars[Math.floor(Math.random() * 16)];
    }
    return s;
  },

  /** 防抖 */
  debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /** 休眠 */
  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  /** 安全JSON解析 */
  safeJSON(str, fallback = null) {
    try { return JSON.parse(str); }
    catch(e) { return fallback; }
  },

  /** 获取考试页面的实际origin（用于IndexedDB） */
  getPageOrigin() {
    return window.location.origin;
  },

  /** 模拟人类点击延迟 */
  randomDelay(min = 50, max = 200) {
    return min + Math.random() * (max - min);
  },

  /** 检测当前页面是否在iframe中 */
  isInIframe() {
    try { return window.self !== window.top; }
    catch(e) { return true; }
  },

  /** 安全的DOM查询，不抛异常 */
  safeQuery(selector, root = document) {
    try { return root.querySelector(selector); }
    catch(e) { return null; }
  },

  safeQueryAll(selector, root = document) {
    try { return Array.from(root.querySelectorAll(selector)); }
    catch(e) { return []; }
  }
};
