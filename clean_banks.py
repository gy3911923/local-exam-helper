# coding: utf-8
"""
题库洗稿脚本 - 将任意格式Excel转换为标准JSON
用法: python clean_banks.py <源文件夹> <输出文件>
输出: 标准JSON数组，每题为 {question, options: {A,B,C,D}, answer, type, source}
"""
import os, sys, re, json
import xlrd
import openpyxl

# ===== 列名别名表 =====
COL_ALIASES = {
    'name':  ['题目名称', '题干', '题目', '试题', '问题'],
    'type':  ['题目类型', '题型', '类型', '试题类型', '题目类别'],
    'answer': ['答案', '正确答案', '参考答案', '标准答案'],
    'option':['选项'],
}

def find_col(headers, col_type):
    for h in headers:
        for alias in COL_ALIASES[col_type]:
            if alias in h:
                return headers.index(h)
    return -1

def is_title_row(row):
    if all(not str(c).strip() for c in row):
        return True
    non_empty = [str(c).strip() for c in row if str(c).strip()]
    txt = ''.join(non_empty)
    if any(kw in txt for kw in ['模板', '导入', '题库', '准入']):
        return True
    if len(non_empty) <= 2 and len(txt) > 15:
        return True
    return False

def normalize_answer(ans, options):
    """统一答案格式: A/B/C/D 或 ABD"""
    ans = str(ans).strip().upper()
    # 判断答案: 正确/错误 → 对应的选项
    judge_map = {'正确': 'A', '对': 'A', '√': 'A', '✓': 'A', 'TRUE': 'A',
                 '错误': 'B', '错': 'B', '×': 'B', '✗': 'B', 'FALSE': 'B'}
    if ans in judge_map:
        return judge_map[ans]
    # 数字 → 字母 (1→A, 2→B, ...)
    if ans.isdigit():
        n = int(ans)
        if 1 <= n <= 8:
            return chr(64 + n)
    # 只保留A-H字母
    letters = [c for c in ans if 'A' <= c <= 'H']
    if letters:
        return ''.join(letters)
    # 尝试匹配选项文本
    if options:
        for k, v in options.items():
            if ans in v or v in ans:
                return k
    return ans

def detect_type(type_str, options, opt_count):
    """检测题目类型"""
    ts = str(type_str or '').strip()
    if '多选' in ts or '多选' in ts:
        return 'multiple'
    if '判断' in ts or '判断题' in ts:
        return 'judge'
    # 选项≤2 且含判断关键词 → 判断题
    if opt_count <= 2:
        label_texts = list(options.values())
        if any(re.match(r'^(正确|错误|对|错|是|否|√|×|✓|✗|true|false|yes|no)$', t, re.I) for t in label_texts):
            return 'judge'
    return 'single'

def parse_options(opt_str):
    """解析选项字符串: "A、xxx|B、xxx|C、xxx|D、xxx" → {A: xxx, B: xxx, ...}"""
    options = {}
    for part in re.split(r'[|｜]', str(opt_str or '')):
        part = part.strip()
        m = re.match(r'^([A-H])\s*[-、.—\.\s:：]\s*(.+)', part)
        if m:
            key = m.group(1)
            val = m.group(2).strip()
            if val and not val.startswith(key + '.'):  # 防止 "A. A. xxx"
                options[key] = val
    return options

def read_excel(filepath):
    """读取Excel，返回 [{question, options, answer, type, source}]"""
    try:
        if filepath.endswith('.xlsx'):
            wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
            ws = wb.active
            rows = [[str(c.value) if c.value is not None else '' for c in row] for row in ws.iter_rows()]
            wb.close()
        else:
            wb = xlrd.open_workbook(filepath)
            ws = wb.sheet_by_index(0)
            rows = [[str(ws.cell_value(r, c)).strip() for c in range(ws.ncols)] for r in range(ws.nrows)]
    except Exception as e:
        print(f'  ❌ 无法读取: {e}')
        return []

    if len(rows) < 2:
        return []

    # 跳过标题行
    data_start = 0
    while data_start < len(rows) and is_title_row(rows[data_start]):
        data_start += 1

    if data_start >= len(rows):
        return []

    headers = rows[data_start]
    data_rows = rows[data_start + 1:]

    # 标准格式: 题型|题干|选项A|B|C|D|答案
    has_std_opts = any(c for c in headers if re.match(r'选项[A-H]', c))
    if has_std_opts:
        return parse_standard(data_rows, headers, os.path.basename(filepath))

    # 紧凑格式: 序号|题目名称|...|选项|答案
    return parse_compact(data_rows, headers, os.path.basename(filepath))

def parse_standard(rows, headers, source):
    questions = []
    idx_type = find_col(headers, 'type')
    idx_name = find_col(headers, 'name')
    idx_ans = find_col(headers, 'answer')

    opt_cols = {}
    for h in headers:
        m = re.match(r'选项([A-H])', h)
        if m: opt_cols[m.group(1)] = headers.index(h)

    for row in rows:
        if len(row) < max(headers.index(h) for h in headers) + 1:
            continue
        stem = str(row[idx_name]).strip() if idx_name >= 0 else ''
        if len(stem) < 3:
            continue

        options = {}
        for k, idx in opt_cols.items():
            if idx < len(row) and str(row[idx]).strip():
                options[k] = str(row[idx]).strip()

        ans = str(row[idx_ans]).strip() if idx_ans >= 0 and idx_ans < len(row) else ''
        ans = normalize_answer(ans, options)

        qtype = detect_type(str(row[idx_type]) if idx_type >= 0 and idx_type < len(row) else '', options, len(options))

        questions.append({
            'question': stem,
            'options': options,
            'answer': ans,
            'type': qtype,
            'source': source
        })
    return questions

def parse_compact(rows, headers, source):
    questions = []
    idx_name = find_col(headers, 'name')
    idx_type = find_col(headers, 'type')
    idx_ans = find_col(headers, 'answer')
    idx_opt = find_col(headers, 'option')

    if idx_name < 0 or idx_ans < 0:
        return []

    for row in rows:
        stem = str(row[idx_name]).strip() if idx_name < len(row) else ''
        if len(stem) < 3:
            continue

        options = {}
        if idx_opt >= 0 and idx_opt < len(row):
            options = parse_options(row[idx_opt])

        ans = str(row[idx_ans]).strip() if idx_ans < len(row) else ''
        ans = normalize_answer(ans, options)

        type_str = str(row[idx_type]).strip() if idx_type >= 0 and idx_type < len(row) else ''
        qtype = detect_type(type_str, options, len(options))

        questions.append({
            'question': stem,
            'options': options,
            'answer': ans,
            'type': qtype,
            'source': source
        })
    return questions

def walk_files(root_dir):
    """遍历目录下所有xls/xlsx文件"""
    all_files = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        for f in filenames:
            if f.endswith(('.xls', '.xlsx')) and not f.startswith('~') and not f.startswith('.'):
                all_files.append(os.path.join(dirpath, f))
    return all_files

# ===== 主程序 =====
if __name__ == '__main__':
    src_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    out_file = sys.argv[2] if len(sys.argv) > 2 else 'banks_cleaned.json'

    files = walk_files(src_dir)
    print(f'找到 {len(files)} 个Excel文件\n')

    all_questions = []
    stats = []

    for fp in sorted(files):
        fname = os.path.basename(fp)
        print(f'{fname} ...', end=' ')
        qs = read_excel(fp)
        all_questions.extend(qs)

        # 统计
        singles = sum(1 for q in qs if q['type'] == 'single')
        multis = sum(1 for q in qs if q['type'] == 'multiple')
        judges = sum(1 for q in qs if q['type'] == 'judge')
        opt_incomplete = sum(1 for q in qs if len(q['options']) < 3 and q['type'] != 'judge')
        ans_empty = sum(1 for q in qs if not q['answer'])

        print(f'{len(qs)}题 (单选{singles} 多选{multis} 判断{judges})', end='')
        warnings = []
        if opt_incomplete > 0: warnings.append(f'{opt_incomplete}题选项<3')
        if ans_empty > 0: warnings.append(f'{ans_empty}题无答案')
        if warnings: print(f' ⚠️ ' + ', '.join(warnings))
        else: print(' ✅')

        stats.append({
            'file': fname,
            'count': len(qs),
            'singles': singles,
            'multi': multis,
            'judge': judges,
            'opt_incomplete': opt_incomplete,
            'ans_empty': ans_empty
        })

    # 写入输出
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)

    # 报告
    print(f'\n===== 洗稿完成 =====')
    print(f'总题数: {len(all_questions)}')
    print(f'文件数: {len(files)}')
    print(f'输出: {os.path.abspath(out_file)}')

    problem_files = [s for s in stats if s['opt_incomplete'] > 0 or s['ans_empty'] > 0]
    if problem_files:
        print(f'\n⚠️ 有问题文件 ({len(problem_files)}):')
        for s in problem_files:
            issues = []
            if s['opt_incomplete'] > 0: issues.append(f'{s["opt_incomplete"]}题选项缺')
            if s['ans_empty'] > 0: issues.append(f'{s["ans_empty"]}题无答案')
            print(f'  {s["file"]}: {s["count"]}题, ' + ', '.join(issues))
    else:
        print('\n✅ 全部正常！')
