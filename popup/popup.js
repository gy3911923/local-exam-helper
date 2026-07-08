/**
 * popup.js - 纯状态展示（无交互控件，防失焦误触）
 */

document.addEventListener('DOMContentLoaded', refreshUI);

async function refreshUI() {
  try {
    const config = await chrome.storage.local.get([
      'enabled', 'activeBanks', 'autoMode', 'matchThreshold'
    ]);

    const enabled = config.enabled || false;
    const dot = document.getElementById('statusDot');
    dot.className = enabled ? 'status-dot active' : 'status-dot';

    document.getElementById('statusTitle').textContent = enabled ? '运行中' : '未开启';
    document.getElementById('statusSub').textContent = enabled
      ? '按 Ctrl+Shift+E 关闭'
      : '按 Ctrl+Shift+E 开启';

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

/** 打开题库管理（通过background转发到当前tab的内容脚本） */
function openBankManager() {
  chrome.runtime.sendMessage({ action: 'showBankManager' });
}

/** 打开设置面板（目前为空，可后续扩展） */
function openSettings() {
  // 设置已在页面内通过快捷键入口覆盖，此处预留
  chrome.runtime.sendMessage({ action: 'showBankManager' });
}
