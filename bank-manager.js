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

document.getElementById('btnImport').addEventListener('click', () => $fileInput.click());
document.getElementById('btnRefresh').addEventListener('click', loadBanks);
document.getElementById('btnSave').addEventListener('click', saveAndClose);
document.getElementById('btnTemplate').addEventListener('click', downloadTemplate);
document.getElementById('btnExport').addEventListener('click', exportAllBanks);
document.getElementById('btnRestore').addEventListener('click', () => document.getElementById('restoreInput').click());
document.getElementById('restoreInput').addEventListener('change', restoreAllBanks);
$fileInput.addEventListener('change', handleImport);

async function loadBanks() {
  if (!isAlive()) { showDead(); return; }
  try {
    banks = await chrome.runtime.sendMessage({ action: 'getAllBanks' }) || [];
    const config = await chrome.storage.local.get(['activeBanks']);
    activeIds = new Set(config.activeBanks || []);
    renderList();
  } catch(e) {
    $stats.textContent = '加载失败: ' + e.message;
  }
}

function renderList() {
  const total = banks.reduce((s, b) => s + (b.questionCount || 0), 0);
  $stats.textContent = `${banks.length} 题库 · ${total} 题`;

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
    cb.addEventListener('change', () => {
      if (cb.checked) activeIds.add(cb.dataset.id);
      else activeIds.delete(cb.dataset.id);
      chrome.storage.local.set({ activeBanks: [...activeIds] });
    });
  });

  $list.querySelectorAll('.bank-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除该题库？')) return;
      await chrome.runtime.sendMessage({ action: 'deleteBank', bankId: btn.dataset.id });
      await loadBanks();
      toast('已删除');
    });
  });
}

async function saveAndClose() {
  const checked = [...$list.querySelectorAll('.bank-check:checked')].map(cb => cb.dataset.id);
  await chrome.storage.local.set({ activeBanks: checked });
  window.close();
}

async function handleImport(e) {
  if (!isAlive()) { showDead(); return; }
  const files = e.target.files;
  if (!files.length) return;

  let success = 0, failed = 0, totalQ = 0;
  const errors = [];

  for (const file of files) {
    try {
      const data = await parseFile(file);
      if (!data || data.length === 0) { failed++; errors.push(file.name + ': 解析结果为空'); continue; }

      data.forEach(q => { q.normalizedQ = TextNormalizer.normalize(q.question || ''); });
      const unique = deduplicate(data);

      const bank = {
        id: Helpers.uid(),
        name: file.name.replace(/\.(xlsx|xls|json)$/i, ''),
        questions: unique,
        questionCount: unique.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await chrome.runtime.sendMessage({ action: 'saveBank', bank });
      if (result) { success++; totalQ += unique.length; }
      else { failed++; errors.push(file.name + ': 保存失败'); }
    } catch(err) {
      failed++;
      errors.push(file.name + ': ' + (err.message || '未知错误'));
      console.error(err);
    }
  }

  $fileInput.value = '';
  await loadBanks();

  const msgs = [];
  if (success > 0) msgs.push(`✅ 成功入库 ${success} 个题库（${totalQ} 题）`);
  if (failed > 0) msgs.push(`❌ ${failed} 个失败`);
  if (errors.length > 0) msgs.push(...errors.map(e => '  ' + e));
  toast(msgs.join('\n'), failed > 0 ? 'error' : 'success');
}

async function parseFile(file) {
  if (file.name.endsWith('.json')) {
    const text = await file.text();
    const json = JSON.parse(text);
    return Array.isArray(json) ? json : (json.questions || json.data || []);
  }
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    return parseExcel(file);
  }
  throw new Error('不支持的文件格式，请使用 .xlsx / .xls / .json');
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
  const isCompact = cols.join(',').includes('题目名称') && cols.join(',').includes('选项') && !cols.join(',').includes('选项A');

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

function parseCompact(rows, cols) {
  const iName = cols.findIndex(c => c.includes('题目名称') || c.includes('题干'));
  const iType = cols.findIndex(c => c.includes('题目类型') || c.includes('题型'));
  const iAns = cols.findIndex(c => c.includes('答案'));
  const iOpt = cols.findIndex(c => c === '选项' || c.startsWith('选项'));

  return rows.map(row => {
    const typeStr = String(row[iType] || '');
    let type = 'single';
    if (/多选/.test(typeStr)) type = 'multiple';
    else if (/判断/.test(typeStr)) type = 'judge';
    else if (/填空/.test(typeStr)) type = 'fill';

    const optStr = String(row[iOpt] || '');
    const options = {};
    optStr.split(/[|｜]/).forEach(p => {
      const m = p.trim().match(/^([A-H])\s*[-、.—\s]\s*(.+)/);
      if (m) options[m[1]] = m[2].trim();
    });

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

function esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ===== 导出/恢复全部题库 =====
async function exportAllBanks() {
  if (!isAlive()) { showDead(); return; }
  const banks = await chrome.runtime.sendMessage({ action: 'getAllBanks' }) || [];
  if (banks.length === 0) { toast('当前无题库可导出', 'error'); return; }

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    banks: banks.map(b => ({ name: b.name, questions: b.questions, questionCount: b.questionCount }))
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `题库备份_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`✅ 已导出 ${banks.length} 个题库（${exportData.banks.reduce((s,b) => s+b.questionCount, 0)} 题）`);
}

async function restoreAllBanks(e) {
  if (!isAlive()) { showDead(); return; }
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.banks || !Array.isArray(data.banks)) throw new Error('无效的备份文件');

    let success = 0, totalQ = 0;
    for (const b of data.banks) {
      // 归一化题干
      b.questions.forEach(q => { q.normalizedQ = TextNormalizer.normalize(q.question || ''); });
      const bank = {
        id: Helpers.uid(),
        name: b.name,
        questions: b.questions,
        questionCount: b.questionCount || b.questions.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const result = await chrome.runtime.sendMessage({ action: 'saveBank', bank });
      if (result) { success++; totalQ += bank.questionCount; }
    }

    e.target.value = '';
    await loadBanks();
    toast(`✅ 恢复成功：${success} 个题库（${totalQ} 题）`);
  } catch(err) {
    e.target.value = '';
    toast('恢复失败: ' + (err.message || '未知错误'), 'error');
  }
}

loadBanks();
