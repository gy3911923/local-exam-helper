# 本地题库答题助手 — 技术设计文档

## 1. 项目概述

面向内网网页考试场景的 Chrome 扩展（Manifest V3），基于自有本地题库实现题目自动识别、匹配与作答。全程在当前考试页面 DOM 内运行，零切屏风险。

**平台**：Chrome / Edge / 所有 Chromium 内核浏览器  
**开发语言**：原生 JavaScript（ES2020+），无第三方框架  
**存储**：IndexedDB（题库） + chrome.storage.local（配置）  
**依赖**：SheetJS (xlsx) 迷你版（440KB，本地打包，无外网请求）

---

## 2. 系统架构

```
┌────────────────────────────────────────┐
│              popup/                      │
│   ┌──────────────────────────┐          │
│   │  popup.html/js/css        │          │
│   │  开关按钮 · 模式选择 · 快捷入口  │          │
│   └──────────────────────────┘          │
└──────────────┬─────────────────────────┘
               │ chrome.runtime.sendMessage
┌──────────────▼─────────────────────────┐
│           background.js                  │
│   ┌──────────────────────────┐          │
│   │  Service Worker           │          │
│   │  · 快捷键 Ctrl+Shift+E   │          │
│   │  · 全局状态管理          │          │
│   │  · 消息中转              │          │
│   │  · 题库存储(IndexedDB)    │          │
│   └──────────────────────────┘          │
└──────────────┬─────────────────────────┘
               │ chrome.tabs.sendMessage
┌──────────────▼─────────────────────────┐
│         content/ (注入考试页面)          │
│   ┌──────┐ ┌──────────┐ ┌───────────┐ │
│   │content│ │question  │ │ matcher   │ │
│   │ .js   │ │Finder.js │ │ .js       │ │
│   │ 主控  │→│ 题目识别 │→│ 多题库匹配│ │
│   └──┬───┘ └──────────┘ └─────┬─────┘ │
│      │                        │        │
│      ▼                        ▼        │
│   ┌──────────┐  ┌────────────────────┐ │
│   │floatPanel│  │ bankManager.js     │ │
│   │.js       │  │ 题库管理面板        │ │
│   │ 悬浮窗   │  │ (模态框注入)       │ │
│   └──────────┘  └────────────────────┘ │
└────────────────────────────────────────┘
```

### 数据流

```
考试页面DOM
  │
  ▼
questionFinder.js  ─── 遍历DOM，提取 {题目文本, 选项文本, 题型}
  │
  ▼
matcher.js  ─── 从 background IndexedDB 获取激活题库 → 归一化匹配 → 加权排序
  │
  ├── 答案唯一 + 置信度 ≥ 阈值 ──→ 自动勾选选项
  │
  └── 冲突 / 低置信度 ──→ floatPanel.js 显示，人工复核
```

---

## 3. 核心模块设计

### 3.1 questionFinder.js — 题目识别引擎

**策略层级**（按优先级尝试）：

```
1. 原生表单回溯法
   找 input[type=radio] → 向上遍历找共同祖先 → 提取题干文本

2. 单选组聚类法
   找所有同name的radio → 分析DOM间距 → 定位题目边界

3. 序号正则匹配法
   匹配 "1."  "1、"  "第1题" 等模式 → 分割题目块

4. 自定义选择器兜底
   用户通过元素拾取配置选择器 → 精准定位
```

**伪代码**：

```
function findQuestions() {
  const questions = []
  const radioGroups = groupRadiosByName()  // 按name属性分组

  for (const group of radioGroups) {
    const container = findCommonAncestor(group)
    const stemText = extractStemText(container, group)
    const options = extractOptions(group)
    const type = detectType(group)  // radio→单选, checkbox→多选

    questions.push({ id, stemText, options, type, container, inputElements: group })
  }

  // 兜底：无radio但有文本序号
  if (questions.length === 0) {
    return fallbackRegexMatch()
  }

  return questions
}
```

### 3.2 matcher.js — 多题库匹配引擎

**文本归一化流水线**：

```
原始文本 → 去HTML标签 → 全角转半角 → 去空格/换行/制表符
→ 去标点 → 统一小写 → 归一化文本
```

**相似度计算**：

采用 **编辑距离（Levenshtein Distance）** 配合归一化：

```
similarity = 1 - (editDistance / max(len1, len2))
```

> 选择编辑距离而非TF-IDF的原因：题库题目通常也较短（几十字），编辑距离计算量小、直观、不需要语料库。对于"题目文本匹配"这个场景，编辑距离足够了。

**多题库加权逻辑**：

```
for each 激活题库 (按优先级排序):
  for each 题目 in 题库:
    score = similarity(OCR文本, 题库题目.题干)
    if score > 阈值:
      results.push({ 答案, score, 来源题库, 优先级 })

// 加权：高优先级题库 score *= 1.05
// 去重：题干重合度>95%视为重复
// 冲突检测：不同题库给出不同答案 → 标记为冲突
```

### 3.3 floatPanel.js — 悬浮窗组件

**核心能力**：

```
┌─────────────────────────────┐  ← 标题栏(可拖拽)
│  📌 答题助手    [_][□][×]   │
├─────────────────────────────┤
│                              │
│  题目: xxx...          85%  │  ← 内容区(鼠标穿透)
│  ✅ 答案: B                  │
│  A.xxx  B.xxx  C.xxx  D.xxx │
│  来源: 安全题库              │
│                              │
│                       ╲     │  ← 缩放手柄
│                        ╲    │
└─────────────────────────────┘
```

- 拖拽：标题栏 `mousedown/mousemove/mouseup`，限制边界
- 缩放：右下角手柄 `mousedown` 改变宽高，最小200×100
- 位置记忆：`chrome.storage.local` 存储，下次恢复
- 鼠标穿透：内容区 `pointer-events: none`，标题栏和手柄保留交互
- 状态标识：显示开关状态、激活题库数

### 3.4 bankManager.js — 题库管理

**存储方案**：

```
考试页面(content)              后台(background)
      │                              │
      │  chrome.runtime.sendMessage   │
      ├─────────────────────────────→│
      │  {action:'importBank',data}  │  写入 IndexedDB
      │                              │  (chrome-extension:// origin)
      │ ←─────────────────────────── │
      │  {result}                    │
```

**IndexedDB 数据结构**：

```javascript
// 数据库名: ExamBanks
// 表: banks
{
  id: 'bank_uuid',       // 唯一ID
  name: '安全题库2026',   // 题库名称
  questions: [            // 题目数组
    {
      type: 'single',     // single | multiple | judge | fill
      question: '题目文本',
      normalizedQ: '归一化后文本',  // 预计算，加速匹配
      options: { A: '...', B: '...', C: '...', D: '...' },
      answer: 'B',
      analysis: ''
    }
  ],
  questionCount: 100,     // 题目数量
  createdAt: '2026-07-08',
  updatedAt: '2026-07-08'
}
```

---

## 4. 接口规范

### 4.1 消息协议

| 方向 | action | payload | response |
|------|--------|---------|----------|
| popup → bg | `getState` | — | `{enabled, threshold, activeBanks}` |
| popup → bg | `setState` | `{enabled}` | `{success}` |
| content → bg | `getActiveBanks` | — | `[{id, name, questions, priority}]` |
| content → bg | `matchResult` | `{results}` | — |
| bg → content | `toggle` | `{enabled}` | — |

### 4.2 题库JSON格式

```json
[
  {
    "type": "single",
    "question": "题目文本",
    "options": {"A":"选项A", "B":"选项B"},
    "answer": "B",
    "analysis": "解析"
  }
]
```

### 4.3 Excel格式

| 题型 | 题干 | 选项A | 选项B | 选项C | 选项D | 答案 | 解析 |
|------|------|-------|-------|-------|-------|------|------|
| 单选 | xxx | xxx | xxx | xxx | xxx | B | xxx |

---

## 5. 关键实现要点

### 5.1 切屏规避原理

```
传统作弊检测链：
  切换窗口 → window.onblur → document.visibilitychange → 上报服务器

安全操作（不触发）：
  - 快捷键 Ctrl+Shift+E → ✅ 不触发blur/visibilitychange
  - 悬浮窗拖拽/缩放 → ✅ 页面内操作
  - 题库管理面板（页面内模态框） → ✅ 不夺走焦点
  - 自动勾选 → ✅ 纯DOM事件

危险操作（触发blur）：
  - 点击插件图标打开popup → ❌ 页面失焦
  - 点击popup内任何按钮 → ❌ 同上（popup打开就已失焦）

结论：考试期间只用快捷键，popup仅用于考前配置。
```

### 5.2 Popup 安全设计

- popup已改为纯状态展示页，移除所有交互控件（开关、下拉菜单）
- 唯一按钮「打开题库管理」会通过消息触发页面内模态框，不产生新焦点转移
- popup顶部醒目红色警告："考试中请勿点开此面板"
- 所有实际功能（开关、题库管理）均通过页面内注入的UI完成

### 5.2 扩展隐身

```javascript
// 🔇 不声明 content_script（manifest.json 中为空数组）
// 改用动态注入：
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['content/content.js']
  });
});

// 🔇 随机化插件名称
// manifest.json "name" 字段用无意义UUID
// popup标题用中性表述（"页面工具"而非"答题助手"）
```

### 5.3 自动作答防特征

```javascript
// 普通模式（v1默认）
async function autoAnswer(question) {
  const delay = 50 + Math.random() * 150;  // 50-200ms随机
  await sleep(delay);
  question.inputElement.click();
}

// 手动辅助模式
// 仅在悬浮窗显示答案，不执行任何点击
```

---

## 6. 目录结构

```
local-exam-helper/
├── manifest.json
├── background.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/
│   ├── content.js          # 主控入口
│   ├── content.css         # 悬浮窗+管理面板样式
│   ├── questionFinder.js   # 题目识别引擎
│   ├── matcher.js          # 匹配算法
│   ├── floatPanel.js       # 悬浮窗组件
│   └── bankManager.js      # 题库管理面板
├── libs/
│   └── xlsx.mini.js        # SheetJS社区版(本地打包)
├── utils/
│   ├── db.js               # IndexedDB封装
│   ├── textNormalize.js    # 文本归一化
│   └── common.js           # 公共工具
└── assets/
    └── icon.png            # 插件图标(128x128)
```

---

## 7. 开发计划

| 阶段 | 内容 | 预计 |
|------|------|------|
| P0 | manifest + background + common + textNormalize | 30min |
| P0 | db.js + bankManager.js（题库CRUD+导入导出） | 1h |
| P0 | questionFinder.js（题目识别） | 1.5h |
| P0 | matcher.js（匹配引擎） | 1h |
| P0 | floatPanel.js（悬浮窗） | 1h |
| P0 | content.js（主控+自动答题） | 30min |
| P0 | popup（开关+模式+快捷入口） | 30min |
| P1 | 扩展隐身改造 | 30min |
| P1 | 反检测行为模式 | 1h |
| 测试 | 在真实考试页面验证 | 30min |
| **合计** | | **约8小时** |

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|:---:|------|------|
| 考试系统用Canvas渲染 | 5% | 插件完全无效 | v1不做，遇到后v2加OCR |
| Shadow DOM封闭 | 10% | 无法读取题目 | 元素拾取兜底 |
| 非标准DOM结构 | 30% | 识别率下降 | 正则降级匹配 |
| 扩展被检测 | 3% | 功能暴露 | 隐身改造 |
| matched结果误判 | 15% | 答错题 | 阈值可调+悬浮窗复核 |
| 误点popup触发blur | 中 | 切屏检测告警 | popup纯展示+醒目警告；考试中只用快捷键 |
