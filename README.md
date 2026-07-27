# Local Exam Helper · 本地题库答题助手

[![Version](https://img.shields.io/badge/version-1.10.8-brightgreen)](manifest.json)
[![Manifest](https://img.shields.io/badge/Manifest%20V3-Chrome-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

一个 **纯本地运行** 的 Chrome 浏览器扩展，自动识别考试页面题目，与本地题库匹配后在浮窗中显示正确答案，并可选自动勾选。

> ✅ 零网络请求，零联网依赖，全部运算在浏览器本地完成  
> ✅ 适配两套国网考试系统：安全准入考试 `aqgk` + 苏电 e 学堂 `elearning`  
> ✅ 抗混淆：自动清除页面 HTML 混淆 & 隐藏标签 & iconfont 图标字符干扰  
> ✅ 便携浏览器支持：配合 Supermium 便携版，拷贝 U 盘到任何电脑即用  

---

## 适配的考试系统

| 考试系统 | 网站 | 技术栈 | 特征 |
|---|---|---|---|
| **安全准入考试** | `http://aqgk.js.sgcc.com.cn:30617` | Vue 2.0 · Element UI | 无 `name` 属性 · `el-radio-group` · `headerContent` |
| **苏电 e 学堂** | `http://elearning.js.sgcc.com.cn` | jQuery 1.7 · 模板引擎 | 有 `name` 属性 · `question-panel-middle` · 动态混淆 |

插件会在页面加载后自动判断考试系统的技术栈，并使用对应的策略提取题目、选项和答案。

---

## 安装

### 方式一：开发模式加载（推荐）

```
1. chrome://extensions/ — 开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」
3. 选择 local-exam-helper 文件夹
4. 浏览器右上角出现插件图标 ✅
```

### 方式二：便携浏览器 (Supermium U 盘)

```batch
:: 启动.cmd — 自动加载扩展 + 固定配置 + 跨电脑一致
start "" ".\Supermium\chrome.exe"
  --user-data-dir=".\Supermium\portable_data"
  --load-extension=".\local-exam-helper"
  --unsafely-treat-insecure-origin-as-secure="http://aqgk.js.sgcc.com.cn:30617,http://elearning.js.sgcc.com.cn"
  --disable-machine-id --no-sandbox
```

将整个 `supermium_144_32_nonsetup\` 文件夹拷贝到 U 盘，到任何电脑双击 `启动.cmd` 即可。扩展 ID 已通过 `key` 固定（`bldfdkckjicaobip`），配置跟随 `portable_data` 永久保留。

### 方式三：从 GitHub 克隆

```bash
git clone https://github.com/gy3911923/local-exam-helper.git
# 在 chrome://extensions 加载 local-exam-helper 文件夹
```

---

## 快速开始

### 1. 导入题库

- 点击插件图标 →「题库管理」
- 拖入 `.xlsx` 或 `.json` 题库文件，或点击「导入题库」选择
- 导入即自动激活 ✅

### 2. 题库格式

**Excel 模板**（推荐）：

| 题型 | 题干 | 选项A | 选项B | 选项C | 选项D | 答案 | 解析 |
|---|---|---|---|---|---|---|---|
| 单选 | 依据配电安规… | 绝缘设备 | 导电设备 | 承力设备 | 载流设备 | A | |
| 多选 | 以下正确的是 | 红色 | 蓝色 | 桌子 | 绿色 | ABD | 解析... |
| 判断 | 地球是圆的 | 正确 | 错误 | | | 正确 | |

**JSON 格式**：

```json
[
  {
    "type": "single",
    "question": "依据配电安规，架空绝缘导线不应视为（ ）。",
    "options": {
      "A": "绝缘设备",
      "B": "导电设备",
      "C": "承力设备",
      "D": "载流设备"
    },
    "answer": "A",
    "analysis": ""
  }
]
```

多选答案连写字母（如 `ABD`），判断填 `正确`/`错误`。

### 3. 考试中使用

```
页面加载 → Ctrl+Shift+E → 右下角浮窗弹出
鼠标悬停任意题目 → 浮窗显示答案 → 自动勾选
监考走近 → Ctrl+Shift+H 切隐形模式
监考离开 → Ctrl+Shift+E 恢复
```

---

## 快捷键

| 快捷键 | 功能 | 说明 |
|---|---|---|
| `Ctrl+Shift+E` | 普通模式 | 浮窗可见 · hover 显示答案 · 自动勾选 |
| `Ctrl+Shift+H` | 隐形模式 | 零界面 · 纯后台自动答题 · 每 2~4 秒答一题 |
| `Ctrl+Shift+S` | 后台保存 | 静默存 MHTML+JSON 到桌面 · 无误触检测 |

---

## 自动答题逻辑

**核心原则：基于答案文本，不受选项序号影响。**

```
题库 answer = "C" → 查 bankOptions["C"] = "5"
页面  A=6  B=3  C=5  D=4
      → 遍历页面输入 → 找到文本 = "5" 的那一项 → 点击它
```

考试系统打乱选项顺序完全不影响作答。自动答题采用四级判定：

1. 已正确 → 跳过
2. 完全空白 → 自动选  
3. 自答错 → 纠错一次
4. 手动选错 → 不碰，只显示浮窗答案

---

## 浮窗界面

```
┌─ 页面工具 ──────────────────────────┐
│  ✅ 已匹配 · 来源：30-7-配电安规     │
│  题干: 依据配电安规，架空绝缘导线      │
│  答案: A     92%                     │
│  A 绝缘设备  B 导电设备               │
│  C 承力设备  D 载流设备               │
└──────────────────────────────────────┘
```

- **绿色分数** = 90%+ 高置信度，已自动勾选
- **黄色分数** = 60~89%，需人工确认
- **红色** = 多个题库答案冲突 / 匹配置信度不足，未自动勾选

---

## 反检测能力

| 维度 | 说明 |
|---|---|
| 扩展名称 | "页面辅助工具"，通用低调 |
| 网络请求 | 零外连，全部 IndexedDB 本地存储 |
| 全局变量 | Manifest V3 隔离上下文，页面 JS 不可访问 |
| DOM 签名 | 注入时生成随机前缀，每次不同 |
| 快捷键 | `Ctrl+Shift+E/H/S`，非标准组合 |
| popup | 仅状态展示，弹出不操作页面 |

---

## 消噪 / 抗混淆

两个考试系统都在一定程度上有反爬或混淆措施，插件内置了对应清除策略：

| 干扰类型 | 来源 | 清除方式 |
|---|---|---|
| `display:none` 随机数字 | 苏电 e 学堂 | querySelectorAll 批量删除 |
| `opacity:0` 隐藏标签 | 苏电 e 学堂 | 同上 |
| `font-size:0` 隐藏标签 | 苏电 e 学堂 | 同上 |
| `visibility:hidden` 隐藏标签 | 苏电 e 学堂 | 同上 |
| iconfont 图标字符 | 苏电 e 学堂 | 提取前 clone 并删除 `.iconfont` |
| 选项文字漏入题干 | 苏电 e 学堂 · radio 与 label 平级 | 提取题干前全删 `label` + `.radio-label` + `.item-details` |
| 题号前缀 `1.` / 分数后缀 `(1.0分)` | 苏电 e 学堂 | 正则去除 |

---

## 架构

```
content/                  # 内容脚本（注入到考试页面）
├── questionFinder.js     # 题目检测 — 支持 Element UI / jQuery 双策略
├── matcher.js            # 题库匹配 — Levenshtein + 选项重叠加权
├── floatPanel.js         # 悬浮窗 UI
├── bankManager.js        # 题库导入/激活/删除
├── content.js            # 主控：hover 答题、隐形模式、MutationObserver
└── content.css           # 浮窗样式

utils/
├── textNormalize.js      # 文本归一化引擎（去 HTML/全角半角/标点/空白）
├── debugCapture.js       # 浏览器环境诊断
├── db.js                 # IndexedDB 适配层
└── common.js             # 公共工具

popup/                    # 插件弹出窗口 UI
background.js             # Service Worker
manifest.json             # Manifest V3 配置
```

---

## 常见问题

**Q: 切屏会被检测吗？**  
A: 不会。所有操作在页面内完成，不切换窗口、不失焦。仅 `visibilitychange` 可通过外部 JS 触发，但浮窗/hover/点击都在页面主线程内，不会离开当前 tab。

**Q: 选项顺序打乱影响吗？**  
A: 不影响。匹配基于答案文本内容，与 ABC 序号无关。

**Q: 多个题库答案冲突怎么办？**  
A: 该题不会自动勾选，浮窗显示多组结果及来源库名，人工判断。

**Q: 识别不出题目？**  
A: 检查页面是否有 radio / checkbox 输入框。如果页面是 Canvas 渲染或纯自定义组件，当前版本不支持。

**Q: 保存的文件在哪？**  
A: 考前通过 `chrome://settings/downloads` 把下载位置改为「桌面」。

**Q: 浏览器卡顿怎么办？**  
A: v1.10.8 已优化：MutationObserver 不再监听 `characterData`（倒计时数字变化），避免每秒全量重扫。

---

## 版本历史

详见 [Git History](https://github.com/gy3911923/local-exam-helper)

| 版本 | 主要内容 |
|---|---|
| v1.10.8 | **核心修复** — 选项文字泄漏到题干（QClaw 发现），已从 75% 匹配升至 95%+ |
| v1.10.7 | 导入自动激活，免去手动勾选 |
| v1.10.0~1.10.2 | 兼容苏电 e 学堂：jQuery 策略 + iconfont + 抗混淆 |
| v1.9.0~1.9.7 | 适配安全准入考试：Element UI · no-name 分组 · hover 逐题作答 |
| v1.8.x | 浮窗 UI · 隐形模式 · 题库管理 · 反检测 |
