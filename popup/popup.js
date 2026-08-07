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

  // 隐形模式答题间隙（秒）输入框
  const delayInput = document.getElementById('stealthDelay');
  if (delayInput) {
    delayInput.addEventListener('change', () => {
      const val = Math.max(1, Math.min(60, Number(delayInput.value) || 5));
      delayInput.value = val;
      chrome.storage.local.set({ stealthDelay: val });
    });
  }
});

async function refreshUI() {
  try {
    // 用 getState 获取当前 tab 真实状态（与快捷键/background 一致）
    // 不要直接读 storage.mode —— 那是持久历史值，可能和当前 tab 状态不同步
    const state = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response);
      });
    });

    // 兜底：getState 失败时退回 storage 读取
    const config = state ? state : await chrome.storage.local.get([
      'mode', 'activeBanks', 'autoMode', 'matchThreshold', 'stealthDelay'
    ]);

    const mode = (state ? state.mode : config.mode) || 'off';
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
      mode === 'stealth' ? '后台模式' : (mode === 'normal' ? '标准模式' : '未启动');

    document.getElementById('infoBanks').textContent =
      (state ? (state.activeBanks || []) : (config.activeBanks || [])).length + ' 个';

    document.getElementById('infoThreshold').textContent =
      Math.round(((state ? state.threshold : config.matchThreshold) || 0.6) * 100) + '%';

    // 恢复已保存的答题间隙（仅 storage 有）
    const delayInput = document.getElementById('stealthDelay');
    if (delayInput && !delayInput.dataset.userEdited) {
      const savedDelay = config.stealthDelay !== undefined
        ? config.stealthDelay
        : (state && state.stealthDelay);
      delayInput.value = savedDelay || 5;
    }
  } catch(e) {
    console.error(e);
  }
}

function openBankManager() {
  // 打开独立题库管理页面——必须与考试页面隔离
  // 导入/导出/全选/清空等操作不应依赖考试页面的 content script
  chrome.tabs.create({ url: chrome.runtime.getURL('bank-manager.html') });
}

function openSettings() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
