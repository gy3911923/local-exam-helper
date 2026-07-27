# Local Exam Helper · 本地题库答题助手

[![Version](https://img.shields.io/badge/version-1.11.5-brightgreen)](manifest.json)
[![Manifest](https://img.shields.io/badge/Manifest%20V3-Chrome-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

一个 **纯本地运行** 的 Chrome 浏览器扩展。自动识别在线考试页面的题目，与本地题库匹配后在浮窗中显示正确答案，并可选自动勾选。

> ✅ 零网络请求，全部运算在浏览器本地完成  
> ✅ 适配安全准入考试 + 苏电 e 学堂两套系统，双策略自动切换  
> ✅ 自动抗混淆：清除 HTML 隐藏标签、iconfont 图标字符、动态随机元素等干扰  
> ✅ 支持便携浏览器（如 Supermium），拷贝 U 盘到任何电脑即用  

---

## 支持的考试系统

| 考试系统 | 前端框架 | 特征 |
|---|---|---|
| **安全准入考试** | Vue 2.0 · Element UI | 无 `name` 属性 · `el-radio-group` 分组 |
| **苏电 e 学堂** | jQuery · 模板引擎 | 有 `name` 属性 · 动态 DOM 混淆 |

插件会在页面加载后自动判断页面技术栈，使用对应策略提取题干、选项和匹配答案。

---

## 安装

### 方式一：开发模式加载

```
1. chrome://extensions/ — 开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」
3. 选择 local-exam-helper 文件夹
4. 浏览器右上角出现插件图标
```

### 方式二：便携浏览器

将扩展目录与便携浏览器放在同一文件夹，使用以下命令启动：

```batch
:: 启动脚本示例 — 自动加载扩展 + 便携配置
start "" ".\browser\chrome.exe"
  --user-data-dir=".\browser\portable_data"
  --load-extension=".\local-exam-helper"
  --unsafely-treat-insecure-origin-as-secure="http://需启用的内网地址"
  --disable-machine-id --no-sandbox
```

整个文件夹拷贝到 U 盘，到任何电脑执行启动脚本即可。扩展 ID 已通过 `key` 字段固定，配置跟随 `portable_data` 永久保留。

### 方式三：从源码构建

```bash
git clone <本仓库地址>
# 在 chrome://extensions 加载 local-exam-helper 文件夹
```

---

## 快速开始

### 1. 考前准备（必须）

```
点击插件图标 →「题库管理」→ 导入 xlsx/json 题库
→ 全选激活 → 💾 保存并关闭
→ 再打开考试页面 → Ctrl+Shift+E 启动
```

⚠️ **所有题库操作在考前完成**。考试中点击插件图标会触发页面失焦，被切屏检测判定为不合格。考试期间仅使用快捷键。

### 2. 题库格式

**Excel 模板**：

| 题型 | 题干 | 选项A | 选项B | 选项C | 选项D | 答案 | 解析 |
|---|---|---|---|---|---|---|---|
| 单选 | 某某规定，操作应___ | 选项甲 | 选项乙 | 选项丙 | 选项丁 | A | |
| 多选 | 以下说法正确的是 | 选项甲 | 选项乙 | 选项丙 | 选项丁 | ABD | 解析文字 |
| 判断 | 某陈述是否正确 | 正确 | 错误 | | | 正确 | |

**JSON 格式**：

```json
[
  {
    "type": "single",
    "question": "某某规定，操作应（ ）。",
    "options": {
      "A": "选项甲",
      "B": "选项乙",
      "C": "选项丙",
      "D": "选项丁"
    },
    "answer": "A",
    "analysis": ""
  }
]
```

题型填：`single` / `multiple` / `judge`。多选答案连写字母。

### 3. 考试中使用

```
页面加载 → Ctrl+Shift+E → 浮窗弹出
鼠标悬停题目 → 显示答案 → 自动勾选
Ctrl+Shift+H → 隐形模式（零界面，纯后台）
Ctrl+Shift+E → 恢复
```

---

## 快捷键

| 快捷键 | 功能 | 说明 |
|---|---|---|
| `Ctrl+Shift+E` | 普通模式 | 浮窗可见 · hover 显示答案 · 自动勾选 |
| `Ctrl+Shift+H` | 隐形模式 | 零界面 · 纯后台自动答题 |
| `Ctrl+Shift+S` | 后台保存 | 静默存双文件到桌面 |

---

## 自动答题逻辑

**核心原则：基于选项文本内容，不受字母序号或打乱顺序影响。**

```
题库答案 = "B" → bankOptions["B"] = "正确选项文本"
页面 A=丙 B=甲 C=乙 D=丁（打乱了）
→ 遍历页面选项 → 找到文本匹配的那一个 → 点击它
```

四级状态判定：

1. 已正确 → 跳过
2. 完全空白 → 自动选  
3. 自答错 → 纠错一次
4. 手动选错 → 不碰，仅显示浮窗提示

---

## 反检测

| 维度 | 说明 |
|---|---|
| 扩展名称 | 通用低调命名 |
| 网络请求 | 零外连，全部本地 IndexedDB |
| 全局变量 | Manifest V3 隔离上下文 |
| DOM 签名 | 注入时生成随机前缀 |
| 快捷键 | 非标准组合键 |

---

## 消噪 / 抗混淆

在线考试系统可能存在以下干扰，插件内置对应清除策略：

| 干扰类型 | 清除方式 |
|---|---|
| `display:none` 隐藏元素 | DOM clone 后批量删除 |
| `opacity:0` 透明元素 | 同上 |
| `font-size:0` 不可见元素 | 同上 |
| `visibility:hidden` 隐藏元素 | 同上 |
| iconfont 图标字符 | 提取文本前删除 `.iconfont` 元素 |
| 选项文字误入题干 | 提取题干前全删 `label` / `.radio-label` |
| 题号 / 分数尾注 | 正则去除 |

---

## 架构

```
content/                  # 内容脚本（注入考试页面）
├── questionFinder.js     # 题目检测 — 多框架双策略
├── matcher.js            # 题库匹配 — 编辑距离 + 选项重叠加权
├── floatPanel.js         # 浮窗 UI
├── bankManager.js        # 题库管理
├── content.js            # 主控：hover 答题、答题引擎、Observer
└── content.css

utils/
├── textNormalize.js      # 文本归一化引擎
├── debugCapture.js       # 诊断采集
├── db.js                 # 本地存储适配层
└── common.js

popup/                    # 插件弹出窗口
background.js             # Service Worker
manifest.json             # Manifest V3
```

---

## 常见问题

**Q: 切屏会被检测吗？**  
A: 不会。所有操作在页面内完成，不离开当前标签页。

**Q: 选项顺序打乱影响吗？**  
A: 不影响。匹配基于文本内容而非字母序号。

**Q: 多个题库答案冲突怎么办？**  
A: 该题不会自动勾选，浮窗显示多组结果供人工判断。

**Q: 识别不出题目？**  
A: 确认页面使用标准表单控件（`<input type="radio">` / `<input type="checkbox">`）。

**Q: 题库管理在哪？考试中能打开吗？**  
A: 点击插件图标 →「题库管理」，打开独立标签页。考试期间切勿点击插件图标，会触发切屏检测。所有导入、激活操作在考前完成。

**Q: 保存的文件在哪？**  
A: 考前将浏览器默认下载目录改为桌面。考试中按 `Ctrl+Shift+S` 静默保存，不触发任何弹窗。

---

## 版本历史

| 版本 | 主要内容 |
|---|---|
| v1.11.x | 题库管理重构：导入覆盖 · 同名去重 · 进度提示 · IndexedDB 错误透传 · 独立页面安全性 |
| v1.10.x | 双系统兼容：Element UI + jQuery · 抗混淆 · 自动激活 · 性能优化 |
| v1.9.x | 适配 Element UI 考试系统：no-name 分组 · hover 逐题作答 · 浮窗重构 |
| v1.8.x | 浮窗 UI · 隐形模式 · 题库管理 · 反检测基础 |
