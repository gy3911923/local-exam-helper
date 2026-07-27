#!/usr/bin/env python3
"""清洗4个题库Excel文件，按Local Exam Helper插件JSON格式输出"""

import pandas as pd
import numpy as np
import json
import re
from pathlib import Path

# ==================== CONFIG ====================
output_dir = Path(r'D:\workbuddy\程序\local-exam-helper\cleaned_banks')
output_dir.mkdir(parents=True, exist_ok=True)

files_config = [
    {
        'path': r'C:\Users\gy391\Desktop\04-一线人员通用题库汇总（15）.xlsx',
        'name': '04-一线人员通用题库',
        'format': 'standard',
    },
    {
        'path': r'C:\Users\gy391\Desktop\30-1-配电安规-通用部分.xls',
        'name': '30-1-配电安规-通用部分',
        'format': 'compact',
    },
    {
        'path': r'C:\Users\gy391\Desktop\30-7-配电安规-配电施工专业.xls',
        'name': '30-7-配电安规-配电施工专业',
        'format': 'compact',
    },
    {
        'path': r'C:\Users\gy391\Desktop\保命题.xls',
        'name': '保命题',
        'format': 'compact',
    },
]

# ==================== HELPERS ====================

def clean_text(val):
    if pd.isna(val) or val is None:
        return ''
    s = str(val).strip()
    s = re.sub(r'\s+', ' ', s)
    return s


def parse_option_compact(cell_val):
    """Parse 'A-option text' -> (letter, text)"""
    s = clean_text(cell_val)
    if not s:
        return None, None
    m = re.match(r'^([A-Z])\s*[-—–]\s*(.+)$', s)
    if m:
        return m.group(1), m.group(2).strip()
    m2 = re.match(r'^([A-Z])\s*(.*)$', s)
    if m2:
        return m2.group(1), m2.group(2).strip() or s
    return None, s


def parse_answer(answer_str):
    """Determine question type and normalize answer"""
    a = clean_text(answer_str)
    if not a:
        return None, None

    # Multi-letter -> 多选题
    if re.match(r'^[A-F]{2,}$', a):
        sorted_a = ''.join(sorted(set(a)))
        return 'multiple', sorted_a

    # Single letter -> 单选题
    if re.match(r'^[A-F]$', a):
        return 'single', a

    # Judge patterns
    if re.search(r'正确|对|\u221a|\u2713|是|yes|true', a, re.IGNORECASE):
        return 'judge', '正确'
    if re.search(r'错误|错|\u00d7|\u2717|否|no|false', a, re.IGNORECASE):
        return 'judge', '错误'

    return 'fill', a


def extract_options_standard(row):
    """Separate option columns (文件04)"""
    options = {}
    for letter in 'ABCDEF':
        col = f'选项{letter}'
        if col in row.index:
            val = clean_text(row[col])
            if val:
                options[letter] = val
    return options


def extract_options_compact(row):
    """Compact format: each cell may contain multiple 'X-value' entries

    Delimiters vary: space, pipe, or combination.
    Uses position-based extraction for robustness.
    """
    options = {}
    for col in row.index:
        cell_text = clean_text(row[col])
        if not cell_text:
            continue
        # Find each letter-dash anchor position
        for m in re.finditer(r'([A-Z])\s*[-—–]\s*', cell_text):
            letter = m.group(1)
            start = m.end()
            # Value extends until next letter-dash or end of string
            next_m = re.search(r'\s*\|?\s*[A-Z]\s*[-—–]', cell_text[start:])
            if next_m:
                value = cell_text[start:start + next_m.start()].strip()
            else:
                value = cell_text[start:].strip()
            if value:
                options[letter] = value
    return options


def build_question(row, format_type):
    question_text = clean_text(row.get('题干', row.get('题目', '')))
    if not question_text:
        return None

    answer_raw = clean_text(row.get('答案', ''))
    qtype, answer = parse_answer(answer_raw)
    if qtype is None:
        print(f'  SKIP: cannot parse answer "{answer_raw}" | {question_text[:60]}...')
        return None

    options = (
        extract_options_standard(row) if format_type == 'standard'
        else extract_options_compact(row)
    )

    q = {
        'type': qtype,
        'question': question_text,
        'answer': answer,
        'analysis': '',
    }

    if qtype in ('single', 'multiple'):
        q['options'] = options
        for ch in answer:
            if ch not in options:
                print(f'  WARN: answer "{answer}" has "{ch}" not in options {list(options.keys())} | {question_text[:50]}...')

    return q


# ==================== MAIN ====================

all_stats = []

for cfg in files_config:
    fp = cfg['path']
    name = cfg['name']
    fmt = cfg['format']

    print(f'\n{"="*60}')
    print(f'Processing: {name}')

    df = pd.read_excel(fp, engine='openpyxl' if fp.endswith('.xlsx') else 'xlrd')
    print(f'  Rows: {len(df)}')

    questions = []
    skipped = 0
    type_counts = {'single': 0, 'multiple': 0, 'judge': 0, 'fill': 0}

    for _, row in df.iterrows():
        q = build_question(row, fmt)
        if q is None:
            skipped += 1
            continue
        questions.append(q)
        type_counts[q['type']] += 1

    total = len(questions)
    print(f'  Parsed: {total}, Skipped: {skipped}')
    print(f'  Types: single={type_counts["single"]} multiple={type_counts["multiple"]} judge={type_counts["judge"]} fill={type_counts["fill"]}')

    all_stats.append({'name': name, 'total': total, 'skipped': skipped, 'types': type_counts})

    safe_name = re.sub(r'[\\/*?:"<>|]', '_', name)
    out_path = output_dir / f'{safe_name}.json'

    output = {'name': name, 'questionCount': total, 'questions': questions}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    kb = out_path.stat().st_size / 1024
    print(f'  Output: {out_path.name} ({kb:.1f} KB)')


# ==================== SUMMARY ====================

print(f'\n{"="*60}')
print('SUMMARY')
print(f'{"="*60}')

grand = 0
for s in all_stats:
    t = s['types']
    print(f'{s["name"]}: {s["total"]} (单{s["types"]["single"]} 多{s["types"]["multiple"]} 判{s["types"]["judge"]} 填{s["types"]["fill"]})')
    grand += s['total']

print(f'\nTotal: {grand} questions in {len(all_stats)} banks')

# ==================== VALIDATION ====================

print(f'\n{"="*60}')
print('VALIDATION')
print(f'{"="*60}')

all_ok = True
for cfg in files_config:
    safe_name = re.sub(r'[\\/*?:"<>|]', '_', cfg['name'])
    out_path = output_dir / f'{safe_name}.json'
    with open(out_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    questions = data['questions']
    errors = []
    for i, q in enumerate(questions):
        if not q.get('question'):
            errors.append(f'Q{i}: empty question')
        if not q.get('answer'):
            errors.append(f'Q{i}: empty answer')
        t = q.get('type', '')
        a = q.get('answer', '')
        if t == 'single' and len(a) != 1:
            errors.append(f'Q{i}: single but answer="{a}"')
        if t == 'multiple' and len(a) < 2:
            errors.append(f'Q{i}: multiple but answer="{a}"')
        if t in ('single', 'multiple') and 'options' not in q:
            errors.append(f'Q{i}: missing options')

    status = 'OK' if not errors else f'{len(errors)} ERRORS'
    if errors:
        all_ok = False
    print(f'  {cfg["name"]}: {status}')
    for e in errors[:3]:
        print(f'    - {e}')
    if questions:
        q = questions[0]
        opt_keys = list(q.get('options', {}).keys())
        print(f'    Sample: type={q["type"]} answer={q["answer"]} options={opt_keys}')

print(f'\nAll valid: {all_ok}')
print(f'Output dir: {output_dir}')
