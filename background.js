/**
 * background.js - Service Worker
 * 职责：快捷键监听、全局状态管理、tab消息中转
 */

// 全局状态：每个tab的插件开关状态
const tabStates = {};

// 初始化存储默认值
chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    enabled: false,
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
});

// 快捷键监听
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-helper') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const tabId = tab.id;
    const currentState = tabStates[tabId] || false;
    const newState = !currentState;
    tabStates[tabId] = newState;

    await chrome.storage.local.set({ enabled: newState });

    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'toggle',
        enabled: newState
      });
    } catch (e) {
      // 非考试页面没有content script，忽略
    }
  }
});

// popup关闭时保存状态
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getState') {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      const state = tabStates[tab.id] || false;
      const config = await chrome.storage.local.get(['matchThreshold', 'activeBanks']);
      sendResponse({
        enabled: state,
        threshold: config.matchThreshold || 0.7,
        activeBanks: config.activeBanks || []
      });
    });
    return true;
  }

  if (msg.action === 'setState') {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      tabStates[tab.id] = msg.enabled;
      await chrome.storage.local.set({ enabled: msg.enabled });
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'toggle',
          enabled: msg.enabled
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
});

// tab关闭时清理状态
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
});
