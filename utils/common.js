/**
 * common.js - 通用工具函数
 * 依赖：无
 */

const Helpers = {

  /** 生成唯一ID */
  uid() {
    return 'l'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
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
