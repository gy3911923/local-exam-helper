/**
 * db.js - IndexedDB 封装
 * 依赖：无
 * 
 * 题库存储于 background service worker 的 IndexedDB
 * content script 通过 chrome.runtime.sendMessage 间接读写
 * 
 * 数据库名: ExamBanks
 * 表: banks (主键: id)
 */

const BankDB = {

  DB_NAME: 'ExamBanks',
  DB_VERSION: 1,
  STORE_NAME: 'banks',

  /** 打开数据库 */
  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: true });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /** 获取所有题库 */
  async getAllBanks() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  },

  /** 获取单个题库 */
  async getBank(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  },

  /** 保存/更新题库 */
  async saveBank(bank) {
    const db = await this._open();
    const record = {
      ...bank,
      updatedAt: new Date().toISOString(),
      questionCount: bank.questions?.length || 0
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  },

  /** 删除题库 */
  async deleteBank(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  },

  /** 清空所有题库 */
  async clearAll() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  },

  /** 获取总题目数 */
  async getTotalCount() {
    const banks = await this.getAllBanks();
    return banks.reduce((sum, b) => sum + (b.questionCount || 0), 0);
  }
};
