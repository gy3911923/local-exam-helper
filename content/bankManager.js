/**
 * bankManager.js - 题库管理面板（页面内模态框）
 * 依赖：utils/db.js, utils/textNormalize.js
 */

const BankManager = {

  _panel: null,
  _banks: [],

  /** 创建管理面板DOM */
  create() {
    if (this._panel) return;
    const panel = document.createElement('div');
    panel.id = '__leh_bank_mgr__';
    panel.innerHTML = `
      <div class="__leh_bm_overlay__" id="__leh_bm_overlay__"></div>
      <div class="__leh_bm_dialog__">
        <div class="__leh_bm_header__">
          <h3>📚 题库管理</h3>
          <div class="__leh_bm_stats__">
            <span id="__leh_bm_total__">0 题库 · 0 题</span>
          </div>
          <button class="__leh_bm_close__" id="__leh_bm_close__">✕</button>
        </div>

        <div class="__leh_bm_toolbar__">
          <button class="__leh_btn_primary__" id="__leh_bm_import__">📥 导入题库</button>
          <button class="__leh_btn_secondary__" id="__leh_bm_template__">📋 下载模板</button>
          <input type="file" id="__leh_bm_file_input__" accept=".xlsx,.xls,.json" multiple style="display:none">
        </div>

        <div class="__leh_bm_list__" id="__leh_bm_list__">
          <div class="__leh_bm_empty__">暂无题库，点击「导入题库」添加</div>
        </div>

        <div class="__leh_bm_footer__">
          <button class="__leh_btn_secondary__" id="__leh_bm_save__">💾 保存激活状态</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this._panel = panel;
    this._bindEvents();
  },

  /** 显示面板 */
  async show() {
    this.create();
    this._panel.style.display = 'block';
    await this._refreshList();
  },

  /** 隐藏面板 */
  hide() {
    if (this._panel) {
      this._panel.style.display = 'none';
    }
  },

  /** 销毁面板 */
  destroy() {
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
    }
  },

  /** 绑定事件 */
  _bindEvents() {
    const close = document.getElementById('__leh_bm_close__');
    const overlay = document.getElementById('__leh_bm_overlay__');
    const importBtn = document.getElementById('__leh_bm_import__');
    const fileInput = document.getElementById('__leh_bm_file_input__');
    const templateBtn = document.getElementById('__leh_bm_template__');
    const saveBtn = document.getElementById('__leh_bm_save__');

    close?.addEventListener('click', () => this.hide());
    overlay?.addEventListener('click', () => this.hide());

    importBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => this._handleImport(e));

    templateBtn?.addEventListener('click', () => this._downloadTemplate());
    saveBtn?.addEventListener('click', () => this._saveActiveBanks());
  },

  /** 刷新题库列表 */
  async _refreshList() {
    try {
      const saved = await chrome.storage.local.get(['activeBanks']);
      const activeIds = new Set(saved.activeBanks || []);

      // 从background获取题库
      const banks = await this._getBanks();
      this._banks = banks;

      const total = banks.reduce((s, b) => s + (b.questionCount || 0), 0);
      const stats = document.getElementById('__leh_bm_total__');
      if (stats) stats.textContent = `${banks.length} 题库 · ${total} 题`;

      const list = document.getElementById('__leh_bm_list__');
      if (!list) return;

      if (banks.length === 0) {
        list.innerHTML = '<div class="__leh_bm_empty__">暂无题库，点击「导入题库」添加</div>';
        return;
      }

      list.innerHTML = banks.map((bank, idx) => `
        <div class="__leh_bm_item__" data-id="${bank.id}" draggable="true">
          <label class="__leh_bm_check__">
            <input type="checkbox" ${activeIds.has(bank.id) ? 'checked' : ''} 
                   onchange="BankManager._toggleActive('${bank.id}', this.checked)">
          </label>
          <div class="__leh_bm_info__">
            <div class="__leh_bm_name__">${this._esc(bank.name)}</div>
            <div class="__leh_bm_meta__">${bank.questionCount || 0} 题 · ${bank.updatedAt ? bank.updatedAt.slice(0,10) : '—'}</div>
          </div>
          <span class="__leh_bm_priority__">P${idx+1}</span>
          <button class="__leh_bm_delete__" onclick="BankManager._deleteBank('${bank.id}')">🗑</button>
        </div>
      `).join('');

    } catch(e) {
      console.error('Refresh bank list failed:', e);
    }
  },

  /** 切换激活状态(即时生效) */
  async _toggleActive(bankId, checked) {
    const saved = await chrome.storage.local.get(['activeBanks']);
    let activeIds = saved.activeBanks || [];
    if (checked) {
      if (!activeIds.includes(bankId)) activeIds.push(bankId);
    } else {
      activeIds = activeIds.filter(id => id !== bankId);
    }
    await chrome.storage.local.set({ activeBanks: activeIds });
  },

  /** 保存激活状态 */
  async _saveActiveBanks() {
    const checkboxes = document.querySelectorAll('#__leh_bm_list__ input[type="checkbox"]');
    const activeIds = [];
    checkboxes.forEach(cb => {
      if (cb.checked) {
        const item = cb.closest('[data-id]');
        if (item) activeIds.push(item.dataset.id);
      }
    });
    await chrome.storage.local.set({ activeBanks: activeIds });
    this.hide();
  },

  /** 导入题库 */
  async _handleImport(event) {
    const files = event.target.files;
    if (!files.length) return;

    let success = 0, failed = 0, duplicates = 0;

    for (const file of files) {
      try {
        const data = await this._parseFile(file);
        if (!data || data.length === 0) { failed++; continue; }

        const bankName = file.name.replace(/\.(xlsx|xls|json)$/i, '');

        // 归一化题干
        data.forEach(q => {
          q.normalizedQ = TextNormalizer.normalize(q.question || '');
        });

        // 去重
        const unique = this._deduplicateQuestions(data);

        const bank = {
          id: Helpers.uid(),
          name: bankName,
          questions: unique,
          questionCount: unique.length,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await this._saveBank(bank);
        duplicates += (data.length - unique.length);
        success++;
      } catch(e) {
        failed++;
      }
    }

    event.target.value = '';
    await this._refreshList();

    // 可选：通过chrome.runtime通知background更新
  },

  /** 解析文件 */
  async _parseFile(file) {
    if (file.name.endsWith('.json')) {
      const text = await file.text();
      const json = JSON.parse(text);
      return Array.isArray(json) ? json : (json.questions || json.data || []);
    }

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      return await this._parseExcel(file);
    }

    throw new Error('Unsupported format');
  },

  /** 解析Excel */
  async _parseExcel(file) {
    // 使用 SheetJS (xlsx.mini.js)
    if (typeof XLSX === 'undefined') {
      throw new Error('XLSX library not loaded');
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return rows.map(row => ({
      type: String(row['题型'] || 'single').replace('单选题','single').replace('多选题','multiple')
             .replace('判断题','judge').replace('填空题','fill'),
      question: String(row['题干'] || ''),
      options: {
        A: String(row['选项A'] || ''),
        B: String(row['选项B'] || ''),
        C: String(row['选项C'] || ''),
        D: String(row['选项D'] || ''),
        E: String(row['选项E'] || ''),
        F: String(row['选项F'] || ''),
      },
      answer: String(row['答案'] || ''),
      analysis: String(row['解析'] || '')
    }));
  },

  /** 题目去重 */
  _deduplicateQuestions(questions) {
    const unique = [];
    for (const q of questions) {
      const isDup = unique.some(u =>
        TextNormalizer.isDuplicate(u.question || '', q.question || '')
      );
      if (!isDup) unique.push(q);
    }
    return unique;
  },

  /** 通过background保存题库 */
  async _saveBank(bank) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'saveBank', bank }, (response) => {
        resolve(response);
      });
    });
  },

  /** 删除题库 */
  async _deleteBank(id) {
    await chrome.runtime.sendMessage({ action: 'deleteBank', bankId: id });
    await this._refreshList();
  },

  /** 下载题库模板 */
  _downloadTemplate() {
    if (typeof XLSX === 'undefined') return;

    const template = [
      ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'],
      ['单选', '1+1等于几', '1', '2', '3', '4', 'B', ''],
      ['多选', '哪些是颜色', '红色', '蓝色', '桌子', '绿色', 'ABD', ''],
      ['判断', '地球是圆的', '', '', '', '', '正确', ''],
      ['填空', '中国的首都是', '', '', '', '', '北京', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '题库模板');
    XLSX.writeFile(wb, '题库模板.xlsx');
  },

  /** 从background获取题库 */
  async _getBanks() {
    // content script中通过chrome.runtime获取background IndexedDB数据
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getAllBanks' }, (response) => {
        resolve(response || []);
      });
    });
  },

  _esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
};
