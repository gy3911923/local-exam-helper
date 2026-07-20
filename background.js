/**
 * background.js - Service Worker
 * 职责：快捷键监听、三态管理(off/normal/stealth)、tab消息中转
 */

// 三态：'off' | 'normal' | 'stealth'
const tabStates = {};

// 初始化存储默认值
chrome.runtime.onInstalled.addListener(async (details) => {
  const defaults = {
    mode: 'off',  // off | normal | stealth
    matchThreshold: 0.7,
    activeBanks: [],
    bankPriorities: {},
    floatPanelPos: { x: null, y: null },
    floatPanelSize: { w: 320, h: 160 }
  };
  const current = await chrome.storage.local.get(null);
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in current)) {
      await chrome.storage.local.set({ [k]: v });
    }
  }

  // 检查快捷键是否已绑定（首次安装时）
  try {
    const commands = await chrome.commands.getAll();
    const unbound = commands.filter(c => !c.shortcut);
    if (unbound.length > 0) {
      console.warn('[答题助手] 以下快捷键未绑定，请到 chrome://extensions/shortcuts 设置：',
        unbound.map(c => c.description).join('、'));
      // 设置图标徽章提示
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      chrome.action.setTitle({ title: '快捷键未设置，请点击图标后右键→管理快捷键' });
      // 首次安装时自动打开快捷键设置页
      if (details.reason === 'install') {
        chrome.tabs.create({
          url: 'chrome://extensions/shortcuts',
          active: true
        });
      }
    }
  } catch(e) { /* 静默 */ }
});

// 快捷键监听
chrome.commands.onCommand.addListener(async (command) => {
  // 快捷键正常触发 → 清除安装提醒徽章
  chrome.action.setBadgeText({ text: '' });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const tabId = tab.id;
  const current = tabStates[tabId] || 'off';

  let newState;
  if (command === 'toggle-helper') {
    // 普通模式: off ↔ normal（从stealth按Ctrl+Shift+E也切到normal）
    newState = (current === 'normal') ? 'off' : 'normal';
  } else if (command === 'toggle-stealth') {
    // 隐形模式: off ↔ stealth
    newState = (current === 'stealth') ? 'off' : 'stealth';
  } else if (command === 'save-page') {
    // 后台双文件保存：MHTML（优先）→ 失败则 HTML 降级
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const baseFilename = `../Desktop/exam_page_${ts}`;
    let savedFiles = [];
    let errors = [];

    // ① 先尝试 MHTML（需要 pageCapture 权限 + http/https 协议）
    try {
      const mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId });
      const mhtmlUrl = await _blobToDataUrl(mhtmlBlob);
      await chrome.downloads.download({
        url: mhtmlUrl,
        filename: baseFilename + '.mhtml',
        saveAs: false
      });
      savedFiles.push('.mhtml');
    } catch (e) {
      // pageCapture 失败（如 file:// 协议）→ 降级到 HTML
      errors.push('MHTML: ' + e.message);
      try {
        const htmlResponse = await chrome.tabs.sendMessage(tabId, { action: 'captureHtml' });
        if (htmlResponse && htmlResponse.html) {
          const htmlBlob = new Blob(['\uFEFF' + htmlResponse.html], { type: 'text/html;charset=utf-8' });
          const htmlUrl = await _blobToDataUrl(htmlBlob);
          await chrome.downloads.download({
            url: htmlUrl,
            filename: baseFilename + '.html',
            saveAs: false
          });
          savedFiles.push('.html (降级)');
        }
      } catch (_) {
        errors.push('HTML降级也失败');
      }
    }

    // ② 诊断数据：从 content script 收集
    try {
      const debugResponse = await chrome.tabs.sendMessage(tabId, { action: 'captureDebug' });
      if (debugResponse) {
        const debugJson = JSON.stringify(debugResponse, null, 2);
        const debugBlob = new Blob([debugJson], { type: 'application/json;charset=utf-8' });
        const debugUrl = await _blobToDataUrl(debugBlob);
        await chrome.downloads.download({
          url: debugUrl,
          filename: baseFilename + '_debug.json',
          saveAs: false
        });
        savedFiles.push('_debug.json');
      }
    } catch (e) {
      errors.push('诊断: ' + e.message);
    }

    // 通知页面
    const saved = savedFiles.length > 0;
    const msg = saved
      ? `💾 已保存: ${savedFiles.join(', ')}`
      : `❌ 保存失败: ${errors.join('; ')}`;
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'savePageDone',
        success: saved,
        filename: msg
      });
    } catch (e) { /* ignore */ }
    return;
  } else {
    return;
  }

  tabStates[tabId] = newState;
  await chrome.storage.local.set({ mode: newState });

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'setMode',
      mode: newState
    });
  } catch (e) {
    // 页面无content script，忽略
  }
});

// 消息路由
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getState') {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      const mode = tabStates[tab.id] || 'off';
      const config = await chrome.storage.local.get(['matchThreshold', 'activeBanks', 'autoMode']);
      sendResponse({
        mode,
        enabled: mode !== 'off',
        threshold: config.matchThreshold || 0.7,
        activeBanks: config.activeBanks || [],
        autoMode: config.autoMode || 'normal'
      });
    });
    return true;
  }

  if (msg.action === 'setMode') {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      tabStates[tab.id] = msg.mode || 'off';
      await chrome.storage.local.set({ mode: msg.mode || 'off' });
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'setMode',
          mode: msg.mode || 'off'
        });
      } catch (e) { /* ignore */ }
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.action === 'saveConfig') {
    chrome.storage.local.set(msg.config).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.action === 'getConfig') {
    chrome.storage.local.get(null).then(config => {
      sendResponse(config);
    });
    return true;
  }

  if (msg.action === 'getAllBanks') {
    _getAllBanksFromDB().then(banks => sendResponse(banks));
    return true;
  }

  if (msg.action === 'getActiveBankData') {
    const bankIds = msg.bankIds || [];
    const priorities = msg.priorities || {};
    _getAllBanksFromDB().then(allBanks => {
      const active = allBanks
        .filter(b => bankIds.includes(b.id))
        .map(b => ({ ...b, priority: priorities[b.id] || 0 }));
      sendResponse(active);
    });
    return true;
  }

  if (msg.action === 'showBankManager') {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'showBankManager' });
      } catch(e) { /* ignore */ }
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.action === 'saveBank') {
    _saveBankToDB(msg.bank).then(result => sendResponse(result));
    return true;
  }

  if (msg.action === 'deleteBank') {
    _deleteBankFromDB(msg.bankId).then(() => sendResponse({ success: true }));
    return true;
  }
});

// tab关闭时清理状态
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
});

/** 保存题库到IndexedDB */
function _saveBankToDB(bank) {
  return new Promise((resolve) => {
    const req = indexedDB.open('ExamBanks', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('banks')) {
        db.createObjectStore('banks', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('banks', 'readwrite');
      const store = tx.objectStore('banks');
      store.put({ ...bank, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => { db.close(); resolve(bank); };
      tx.onerror = () => { db.close(); resolve(null); };
    };
    req.onerror = () => resolve(null);
  });
}

/** 从IndexedDB删除题库 */
function _deleteBankFromDB(bankId) {
  return new Promise((resolve) => {
    const req = indexedDB.open('ExamBanks', 1);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('banks', 'readwrite');
      const store = tx.objectStore('banks');
      store.delete(bankId);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
    req.onerror = () => resolve();
  });
}
/** 从IndexedDB获取所有题库 */
function _getAllBanksFromDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open('ExamBanks', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('banks')) {
        db.createObjectStore('banks', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('banks', 'readonly');
      const store = tx.objectStore('banks');
      const getAll = store.getAll();
      getAll.onsuccess = () => {
        resolve(getAll.result || []);
        db.close();
      };
      getAll.onerror = () => {
        resolve([]);
        db.close();
      };
    };
    req.onerror = () => resolve([]);
  });
}

/** Blob → Data URL（用于 chrome.downloads.download） */
function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Blob转DataURL失败'));
    reader.readAsDataURL(blob);
  });
}
