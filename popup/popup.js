/**
 * popup.js - 纯状态展示（无交互控件，防失焦误触）
 */

document.addEventListener('DOMContentLoaded', () => {
  refreshUI();

  // 按钮事件绑定（替代内联onclick，因Manifest V3 CSP禁止内联脚本）
  const btnBank = document.getElementById('btnBankManager');
  const btnSettings = document.getElementById('btnSettings');
  if (btnBank) btnBank.addEventListener('click', openBankManager);
  if (btnSettings) btnSettings.addEventListener('click', openSettings);
});

async function refreshUI() {
  try {
    const config = await chrome.storage.local.get([
      'mode', 'activeBanks', 'autoMode', 'matchThreshold'
    ]);

    const mode = config.mode || 'off';
    const dot = document.getElementById('statusDot');

    if (mode === 'stealth') {
      dot.className = 'status-dot active';
      dot.style.background = '#f59e0b';  // 黄色 = 隐形
      document.getElementById('statusTitle').textContent = '后台模式';
      document.getElementById('statusSub').textContent = '无界面 · Ctrl+Shift+H 关闭';
    } else if (mode === 'normal') {
      dot.className = 'status-dot active';
      dot.style.background = '#10b981';
      document.getElementById('statusTitle').textContent = '已开启';
      document.getElementById('statusSub').textContent = 'Ctrl+Shift+H 切换后台';
    } else {
      dot.className = 'status-dot';
      dot.style.background = '#ef4444';
      document.getElementById('statusTitle').textContent = '就绪';
      document.getElementById('statusSub').textContent = 'Ctrl+Shift+E 开启 · Ctrl+Shift+H 后台';
    }

    document.getElementById('infoMode').textContent =
      (config.autoMode === 'manual') ? '手动' : '逐题自动';

    document.getElementById('infoBanks').textContent =
      (config.activeBanks || []).length + ' 个';

    document.getElementById('infoThreshold').textContent =
      Math.round((config.matchThreshold || 0.6) * 100) + '%';
  } catch(e) {
    console.error(e);
  }
}

function openBankManager() {
  // 打开独立题库管理页面（不依赖当前页面的 content script）
  chrome.tabs.create({ url: chrome.runtime.getURL('bank-manager.html') });
}

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('bank-manager.html') });
}
