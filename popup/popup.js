/**
 * popup.js - 插件弹窗逻辑
 */

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await refreshUI();
});

/** 刷新界面 */
async function refreshUI() {
  try {
    const config = await chrome.storage.local.get([
      'enabled', 'activeBanks', 'autoMode', 'matchThreshold'
    ]);

    // 开关状态
    const enabled = config.enabled || false;
    document.getElementById('toggleSwitch').checked = enabled;
    document.getElementById('statusDot').className = enabled ? 'status-dot active' : 'status-dot';
    document.getElementById('statusText').textContent = enabled ? '运行中' : '未开启';

    // 模式
    const mode = config.autoMode || 'normal';
    document.getElementById('modeSelect').value = mode;

    // 题库数量
    const activeBanks = config.activeBanks || [];
    document.getElementById('banksCount').textContent = activeBanks.length + '个';
  } catch(e) {
    console.error('Failed to refresh UI:', e);
  }
}

/** 开关切换 */
async function toggleHelper() {
  const checked = document.getElementById('toggleSwitch').checked;
  await chrome.storage.local.set({ enabled: checked });

  // 通知background
  chrome.runtime.sendMessage({ action: 'setState', enabled: checked });

  refreshUI();
}

/** 模式切换 */
async function changeMode() {
  const mode = document.getElementById('modeSelect').value;
  await chrome.storage.local.set({ autoMode: mode });
}

/** 打开题库管理 */
function openBankManager() {
  // 通知当前tab打开题库管理
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'showBankManager' });
    }
  });
}
