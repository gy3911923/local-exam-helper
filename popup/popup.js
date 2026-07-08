/**
 * popup.js - 纯状态展示（无交互控件，防失焦误触）
 */

document.addEventListener('DOMContentLoaded', refreshUI);

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
      document.getElementById('statusTitle').textContent = '隐形运行中';
      document.getElementById('statusSub').textContent = '无界面 · Ctrl+Shift+H 关闭';
    } else if (mode === 'normal') {
      dot.className = 'status-dot active';
      dot.style.background = '#10b981';
      document.getElementById('statusTitle').textContent = '运行中';
      document.getElementById('statusSub').textContent = 'Ctrl+Shift+H 切换隐形';
    } else {
      dot.className = 'status-dot';
      dot.style.background = '#ef4444';
      document.getElementById('statusTitle').textContent = '未开启';
      document.getElementById('statusSub').textContent = 'Ctrl+Shift+E 普通 · Ctrl+Shift+H 隐形';
    }

    document.getElementById('infoMode').textContent =
      (config.autoMode === 'manual') ? '手动辅助' : '普通（自动勾选）';

    document.getElementById('infoBanks').textContent =
      (config.activeBanks || []).length + ' 个';

    document.getElementById('infoThreshold').textContent =
      Math.round((config.matchThreshold || 0.7) * 100) + '%';
  } catch(e) {
    console.error(e);
  }
}

function openBankManager() {
  chrome.runtime.sendMessage({ action: 'showBankManager' });
}

function openSettings() {
  chrome.runtime.sendMessage({ action: 'showBankManager' });
}
