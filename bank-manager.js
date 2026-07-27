/**
 * bank-manager.js - 独立题库管理页面逻辑
 * 直接与 background service worker 通信，不依赖 content script
 */

// 检查扩展上下文是否有效
function isAlive() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch(e) { return false; }
}

function showDead(msg) {
  $stats.textContent = msg || '⚠ 扩展已更新，请关闭此页面后重新打开';
  $list.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>扩展上下文已失效</p><p style="font-size:12px;margin-top:4px">请关闭此页面，回到扩展图标按钮重新打开题库管理</p></div>';
}

const Helpers = {
  uid() { return 'l'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
};

let banks = [];
let activeIds = new Set();

const $list = document.getElementById('bankList');
const $stats = document.getElementById('stats');
const $fileInput = document.getElementById('fileInput');
let toastTimer = null;

function toast(msg, type='success') {
  clearTimeout(toastTimer);
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast toast-'+type;
  t.textContent = msg;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 4000);
}

function bind(id, event, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(event, handler);
  return element;
}

bind('btnImport', 'click', () => $fileInput?.click());
bind('btnSave', 'click', saveAndClose);
bind('btnTemplate', 'click', downloadTemplate);
bind('btnExport', 'click', exportAllBanks);
bind('btnSelectAll', 'click', selectAll);
bind('btnDeleteAll', 'click', deleteAll);
$fileInput?.addEventListener('change', handleImport);

function setLoading(message = '正在加载题库...') {
  $stats.textContent = message;
  $list.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>正在加载题库...</p><p style="font-size:12px;margin-top:4px">请稍候</p></div>';
}

function setLoadError(error) {
  const message = error?.message || String(error || '未知错误');
  $stats.textContent = '加载失败';
  $list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><p>题库加载失败</p><p style="font-size:12px;margin-top:4px;word-break:break-word">${esc(message)}</p><button class="btn btn-primary" id="btnRetry" style="margin-top:12px">重试</button></div>`;
  bind('btnRetry', 'click', loadBanks);
}

async function loadBanks() {
  if (!isAlive()) { showDead(); return; }
  setLoading();
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAllBanks' });
    if (!Array.isArray(response)) throw new Error('后台返回的题库数据格式无效');
    banks = response;
    const config = await chrome.storage.local.get(['activeBanks']);
    activeIds = new Set(Array.isArray(config.activeBanks) ? config.activeBanks : []);
    renderList();
  } catch(e) {
    console.error('加载题库失败:', e);
    setLoadError(e);
  }
}

function renderList() {
  const total = banks.reduce((s, b) => s + (b.questionCount || 0), 0);
  $stats.textContent = `${banks.length} 题库 · ${total} 题`;

  const selectAllBtn = document.getElementById('btnSelectAll');
  if (selectAllBtn) {
    const allActive = banks.length > 0 && banks.every(bank => activeIds.has(bank.id));
    selectAllBtn.textContent = allActive ? '取消全选' : '全选';
    selectAllBtn.disabled = banks.length === 0;
  }
  const deleteAllBtn = document.getElementById('btnDeleteAll');
  if (deleteAllBtn) deleteAllBtn.disabled = banks.length === 0;

  if (banks.length === 0) {
    $list.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>暂无题库</p><p style="font-size:12px;margin-top:4px">点击「导入题库」添加 Excel 或 JSON 文件</p></div>';
    return;
  }

  $list.innerHTML = banks.map((bank, idx) => `
    <div class="bank-item">
      <input type="checkbox" class="bank-check" data-id="${bank.id}" ${activeIds.has(bank.id) ? 'checked' : ''}>
      <div class="bank-info">
        <div class="bank-name">${esc(bank.name)}</div>
        <div class="bank-meta">${bank.questionCount || 0} 题 · 更新于 ${(bank.updatedAt || '').slice(0,10)}</div>
      </div>
      <span class="bank-priority">P${idx+1}</span>
      <button class="bank-delete" data-id="${bank.id}" title="删除">🗑</button>
    </div>
  `).join('');

  $list.querySelectorAll('.bank-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      if (cb.checked) activeIds.add(cb.dataset.id);
      else activeIds.delete(cb.dataset.id);
      try {
        await chrome.storage.local.set({ activeBanks: [...activeIds] });
        renderList();
      } catch (e) {
        toast('保存激活状态失败: ' + (e.message || '未知错误'), 'error');
      }
    });
  });

  $list.querySelectorAll('.bank-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除该题库？')) return;
      btn.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ action: 'deleteBank', bankId: btn.dataset.id });
        if (!result || result.success !== true) throw new Error('后台删除失败');
        activeIds.delete(btn.dataset.id);
        await chrome.storage.local.set({ activeBanks: [...activeIds] });
        await loadBanks();
        toast('已删除');
      } catch (e) {
        btn.disabled = false;
        toast('删除失败: ' + (e.message || '未知错误'), 'error');
      }
    });
  });
}

async function saveAndClose() {
  try {
    const checked = [...$list.querySelectorAll('.bank-check:checked')].map(cb => cb.dataset.id);
    await chrome.storage.local.set({ activeBanks: checked });
    window.close();
  } catch (e) {
    toast('保存激活状态失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function handleImport(e) {
  if (!isAlive()) { showDead(); return; }
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const importBtn = document.getElementById('btnImport');
  importBtn?.setAttribute('disabled', 'disabled');

  const totalFiles = files.length;
  let processedFiles = 0;

  const updateProgress = () => {
    const remaining = totalFiles - processedFiles;
    $stats.textContent = `正在导入... ${processedFiles}/${totalFiles} 完成`;
  };
  updateProgress();

  let success = 0;
  let failed = 0;
  let totalQ = 0;
  let duplicates = 0;
  let replaced = 0;
  const errors = [];

  try {
    for (const file of files) {
      try {
        const parsed = await parseFile(file);
        const candidates = parsed.kind === 'backup'
          ? parsed.banks.map((bank, index) => ({
              name: bank.name || `${file.name.replace(/\.json$/i, '')}-${index + 1}`,
              questions: bank.questions
            }))
          : [{
              name: file.name.replace(/\.(xlsx|xls|json)$/i, ''),
              questions: parsed.questions
            }];

        if (candidates.length === 0) {
          throw new Error('文件中没有可导入的题库');
        }

        for (const candidate of candidates) {
          const prepared = prepareQuestions(candidate.questions);
          if (prepared.length === 0) {
            throw new Error('解析结果为空，或题目缺少题干字段');
          }

          const unique = deduplicate(prepared);
          duplicates += prepared.length - unique.length;

          // 同名或同内容覆盖：兼容 xlsx/json 后缀、空格和全半角标点差异
          const existingBanks = findDuplicateBanks(candidate.name, unique);
          const bank = createBank(candidate.name, unique);
          const result = await chrome.runtime.sendMessage({ action: 'saveBank', bank });
          if (!result || !result.id) throw new Error('后台保存失败');

          // 先保存新版本，再删除旧版本，避免覆盖失败时旧题库丢失
          await Promise.all(existingBanks.map(async existing => {
            const delResp = await chrome.runtime.sendMessage({ action: 'deleteBank', bankId: existing.id });
            if (delResp && delResp.success === false) {
              throw new Error(`无法清理旧题库「${existing.name}」`);
            }
          }));

          replaceBankInMemory(existingBanks, bank);
          existingBanks.forEach(existing => activeIds.delete(existing.id));
          activeIds.add(bank.id);
          replaced += existingBanks.length;
          success++;
          totalQ += unique.length;
        }
      } catch (err) {
        failed++;
        errors.push(`${file.name}: ${err.message || '未知错误'}`);
        console.error('导入失败:', file.name, err);
      }
      processedFiles++;
      updateProgress();
    }

    // 导入成功的题库默认激活；失败文件不会污染激活列表
    if (success > 0) {
      await chrome.storage.local.set({ activeBanks: [...activeIds] });
    }
    await loadBanks();
  } catch (err) {
    failed += 1;
    errors.push(err.message || '导入流程失败');
    console.error('导入流程失败:', err);
  } finally {
    e.target.value = '';
    importBtn?.removeAttribute('disabled');
  }

  const messages = [];
  if (success > 0) messages.push(`成功入库 ${success} 个题库（${totalQ} 题）`);
  if (replaced > 0) messages.push(`覆盖旧题库 ${replaced} 个`);
  if (duplicates > 0) messages.push(`已去重 ${duplicates} 题`);
  if (failed > 0) messages.push(`${failed} 个文件导入失败`);
  if (errors.length > 0) messages.push(...errors);
  toast(messages.join('；') || '没有可导入的数据', failed > 0 ? 'error' : 'success');
}

function createBank(name, questions) {
  const now = new Date().toISOString();
  return {
    id: Helpers.uid(),
    name: String(name || '未命名题库').trim() || '未命名题库',
    nameKey: normalizeBankName(name),
    fingerprint: bankFingerprint(questions),
    questions,
    questionCount: questions.length,
    createdAt: now,
    updatedAt: now
  };
}

// 题库名称统一键：兼容 xlsx/json 后缀、全半角标点和空白差异
function normalizeBankName(name) {
  const base = String(name ?? '')
    .trim()
    .replace(/(?:\.(?:xlsx|xls|json))+$/i, '')
    .replace(/\s*[\(（]\d+[\)）]\s*$/u, '')
    .replace(/(?:[-_\s]?副本)$/u, '');
  return TextNormalizer.normalize(base);
}

function normalizeAnswerForFingerprint(answer) {
  const raw = String(answer ?? '').trim().toUpperCase();
  if (/^[A-H]+$/.test(raw)) return [...new Set(raw.split(''))].sort().join('');
  return TextNormalizer.normalize(raw);
}

// 题库内容指纹：名称改变或文件扩展名不同，内容相同仍视为同一题库
function bankFingerprint(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return '';
  return questions.map(q => {
    const options = Object.entries(normalizeOptions(q?.options))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${TextNormalizer.normalize(value)}`)
      .join('|');
    return [
      TextNormalizer.normalize(q?.question || ''),
      TextNormalizer.normalize(q?.type || ''),
      normalizeAnswerForFingerprint(q?.answer),
      options
    ].join('\\u001f');
  }).sort().join('\\u001e');
}

function findDuplicateBanks(name, questions) {
  const nameKey = normalizeBankName(name);
  const fingerprint = bankFingerprint(questions);
  return banks.filter(existing => {
    const existingNameKey = existing.nameKey || normalizeBankName(existing.name);
    if (nameKey && existingNameKey === nameKey) return true;
    const existingFingerprint = existing.fingerprint || bankFingerprint(existing.questions);
    return fingerprint && existingFingerprint && existingFingerprint === fingerprint;
  });
}

function replaceBankInMemory(existingBanks, bank) {
  const oldIds = new Set(existingBanks.map(item => item.id));
  const firstIndex = existingBanks.length > 0 ? banks.findIndex(item => item.id === existingBanks[0].id) : -1;
  banks = banks.filter(item => !oldIds.has(item.id));
  const insertAt = firstIndex >= 0 ? Math.min(firstIndex, banks.length) : banks.length;
  banks.splice(insertAt, 0, bank);
}

function prepareQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return [];
  return rawQuestions.map(item => {
    if (!item || typeof item !== 'object') return null;
    const question = String(item.question ?? item.stem ?? item.stemText ?? '').trim();
    if (!question) return null;
    const options = normalizeOptions(item.options);
    return {
      ...item,
      type: normalizeType(String(item.type || 'single')),
      question,
      options,
      answer: String(item.answer ?? '').trim(),
      analysis: String(item.analysis ?? ''),
      normalizedQ: TextNormalizer.normalize(question)
    };
  }).filter(Boolean);
}

function normalizeOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions.reduce((result, value, index) => {
      const letter = String.fromCharCode(65 + index);
      result[letter] = String(value ?? '').trim();
      return result;
    }, {});
  }
  if (!rawOptions || typeof rawOptions !== 'object') return {};
  return Object.fromEntries(Object.entries(rawOptions).map(([key, value]) => [
    String(key).trim().toUpperCase(), String(value ?? '').trim()
  ]));
}

async function parseFile(file) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.json')) {
    const text = await file.text();
    const json = JSON.parse(text);
    if (Array.isArray(json.banks)) {
      return { kind: 'backup', banks: json.banks };
    }
    if (Array.isArray(json)) return { kind: 'questions', questions: json };
    return { kind: 'questions', questions: json.questions || json.data || [] };
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return { kind: 'questions', questions: await parseExcel(file) };
  }
  throw new Error('不支持的文件格式，请使用 .xlsx、.xls 或 .json');
}

async function parseExcel(file) {
  if (typeof XLSX === 'undefined') throw new Error('XLSX 库未加载');

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawArr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rawArr || rawArr.length < 2) throw new Error('数据不足');

  let headerRow = rawArr[0], dataStart = 1;
  if (isTitleRow(rawArr[0]) && rawArr.length > 2) { headerRow = rawArr[1]; dataStart = 2; }

  const cols = headerRow.map(String);
  const isCompact = findCol(cols, 'name') >= 0 && findCol(cols, 'option') >= 0 && !cols.join(',').includes('选项A');

  if (isCompact) {
    return parseCompact(rawArr.slice(dataStart), cols);
  }

  const stdRows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: dataStart - 1 });
  return stdRows.map(r => ({
    type: normalizeType(String(r['题型'] || 'single')),
    question: String(r['题干'] || ''),
    options: { A:String(r['选项A']||''), B:String(r['选项B']||''), C:String(r['选项C']||''), D:String(r['选项D']||''), E:String(r['选项E']||''), F:String(r['选项F']||'') },
    answer: String(r['答案'] || ''),
    analysis: String(r['解析'] || '')
  }));
}

function isTitleRow(row) {
  if (!row || !Array.isArray(row)) return false;
  // 全空行
  if (row.every(c => String(c || '').trim() === '')) return true;
  const t = row.map(String).join('');
  // 明确含"模板"或"导入"
  if (t.includes('模板') || t.includes('导入')) return true;
  // 第一列空，但某列有"题目"/"题目导入模板"
  const nonEmpty = row.map(c => String(c || '').trim()).filter(Boolean);
  if (nonEmpty.length <= 2 && nonEmpty.some(s => s.includes('题目') || s.includes('题库'))) return true;
  // 只有1-2个非空单元格且第一个有长文本（>15字母），其余都空 → 合并标题行
  if (nonEmpty.length <= 2 && nonEmpty[0] && nonEmpty[0].length > 15) return true;
  return false;
}

// ===== 列名别名表 =====
const COL_ALIASES = {
  name: ['题目名称','题干','题目','试题','问题','question'],       // 题干列
  type: ['题目类型','题型','类型','试题类型','type','题目类别'],        // 题型列
  answer: ['答案','正确答案','参考答案','标准答案','answer'],           // 答案列
  option: ['选项','options']                                          // 选项列
};

function findCol(cols, key) {
  const aliases = COL_ALIASES[key] || [];
  return cols.findIndex(c => aliases.some(a => c.includes(a)));
}

function parseCompact(rows, cols) {
  const iName = findCol(cols, 'name');
  const iType = findCol(cols, 'type');
  const iAns = findCol(cols, 'answer');
  const iOpt = findCol(cols, 'option');

  return rows.map(row => {
    const typeStr = String(row[iType] || '');
    let type = 'single';
    if (/多选/.test(typeStr)) type = 'multiple';
    else if (/判断/.test(typeStr)) type = 'judge';
    else if (/填空/.test(typeStr)) type = 'fill';

    const optStr = String(row[iOpt] || '');
    const options = {};
    if (optStr && iOpt >= 0) {
      optStr.split(/[|｜]/).forEach(p => {
        // 多种选项格式: A、xxx  A.xxx  A、 xxx  A-xxx  A)xxx  A xxx
        let m = p.trim().match(/^([A-H])\s*[-、.—)\s:：]\s*(.+)/);
        if (!m) m = p.trim().match(/^([A-H])\s+(.+)/);  // A xxx
        if (!m) m = p.trim().match(/^([A-H])([^A-H].+)/);  // Axxx
        if (m) options[m[1]] = m[2].trim();
      });
    }

    let answer = String(row[iAns] || '').trim();
    if (type === 'judge') {
      if (/^(A|正确|对|√|✓|是|yes|true)$/i.test(answer)) answer = '正确';
      else if (/^(B|错误|错|×|✗|否|no|false)$/i.test(answer)) answer = '错误';
    }

    return { type, question: String(row[iName] || '').trim(), options, answer, analysis: '' };
  }).filter(r => r.question.length > 0);
}

function normalizeType(s) {
  return s.replace('单选题','single').replace('多选题','multiple')
    .replace('判断题','judge').replace('填空题','fill')
    .replace('判断','judge').replace('单选','single').replace('多选','multiple');
}

function deduplicate(questions) {
  const u = [];
  for (const q of questions) {
    if (!u.some(x => TextNormalizer.isDuplicate(x.question, q.question))) u.push(q);
  }
  return u;
}

function downloadTemplate() {
  if (typeof XLSX === 'undefined') return;
  const data = [
    ['题型','题干','选项A','选项B','选项C','选项D','答案','解析'],
    ['单选','1+1等于几','1','2','3','4','B',''],
    ['多选','哪些是颜色','红色','蓝色','桌子','绿色','ABD',''],
    ['判断','地球是圆的','','','','','正确',''],
    ['填空','中国的首都是','','','','','北京','']
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '题库模板');
  XLSX.writeFile(wb, '题库模板.xlsx');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== 导出全部题库 =====
async function exportAllBanks() {
  if (!isAlive()) { showDead(); return; }
  try {
    const allBanks = await chrome.runtime.sendMessage({ action: 'getAllBanks' });
    if (!Array.isArray(allBanks)) throw new Error('后台返回的题库数据格式无效');
    if (allBanks.length === 0) {
      toast('当前无题库可导出', 'error');
      return;
    }

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      banks: allBanks.map(b => ({
        name: b.name,
        questions: b.questions,
        questionCount: b.questionCount
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `题库备份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast(`已导出 ${allBanks.length} 个题库（${exportData.banks.reduce((s,b) => s + (b.questionCount || 0), 0)} 题）`);
  } catch (e) {
    toast('导出失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function selectAll() {
  if (banks.length === 0) return;
  const allActive = banks.every(b => activeIds.has(b.id));
  if (allActive) {
    banks.forEach(b => activeIds.delete(b.id));
  } else {
    banks.forEach(b => activeIds.add(b.id));
  }
  try {
    await chrome.storage.local.set({ activeBanks: [...activeIds] });
    renderList();
  } catch (e) {
    toast('保存激活状态失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function deleteAll() {
  if (banks.length === 0) return;
  if (!confirm(`确定要删除全部 ${banks.length} 个题库吗？此操作不可恢复。`)) return;
  const deleteBtn = document.getElementById('btnDeleteAll');
  deleteBtn?.setAttribute('disabled', 'disabled');

  try {
    await Promise.all(banks.map(bank =>
      chrome.runtime.sendMessage({ action: 'deleteBank', bankId: bank.id })
    ));
    await chrome.storage.local.set({ activeBanks: [] });
    activeIds.clear();
    await loadBanks();
    toast('已清空全部题库');
  } catch (e) {
    toast('清空失败: ' + (e.message || '未知错误'), 'error');
    await loadBanks();
  } finally {
    deleteBtn?.removeAttribute('disabled');
  }
}

loadBanks();
