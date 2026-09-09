# Local Exam Helper · 本地题库答题助手

[![Version](https://img.shields.io/badge/version-1.14.0-brightgreen)](manifest.json)
[![Manifest](https://img.shields.io/badge/Manifest%20V3-Chrome%2088+-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

一个 **纯本地运行** 的 Chrome 浏览器扩展。自动识别在线考试页面的题目，与本地题库匹配后在浮窗中显示正确答案，支持后台模式自动勾选。

> ✅ 零网络请求，全部运算在浏览器本地完成  
> ✅ 适配安全准入考试 + 苏电 e 学堂两套系统，双策略自动切换  
> ✅ 自动抗混淆：清除 HTML 隐藏标签、iconfont 图标字符、动态随机元素等干扰  
> ✅ 兼容 Chrome 88+ 全版本，一个文件夹通吃高低版本  
> ✅ 支持便携浏览器（如 Supermium），拷贝 U 盘到任何电脑即用  

---

## 支持的考试系统

| 考试系统 | 前端框架 | 特征 |
|---|---|---|
| **安全准入考试** | Vue 2.0 · Element UI | 无 `name` 属性 · `el-radio-group` 分组 |
| **苏电 e 学堂** | jQuery · 模板引擎 | 有 `name` 属性 · 动态 DOM 混淆 |

插件会自动判断页面技术栈，使用对应策略提取题干、选项和匹配答案。

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
→ 考试页面打开后 → Ctrl+Shift+E 启动标准模式
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
默认未启动（off）——按快捷键激活，与网址无关
Ctrl+Shift+E → 标准模式：浮窗显示，hover 题目看答案
Ctrl+Shift+H → 后台模式：零界面，逐题自动勾选（间隙可配置）
Ctrl+Shift+E → 再按一次隐藏浮窗（回到未启动）
```

> **模式设计**：标准模式 = 纯显示答案（手动答题）；后台模式 = 自动答题。两者互不干扰，随时切换。

---

## 快捷键

| 快捷键 | 功能 | 说明 |
|---|---|---|
| `Ctrl+Shift+E` | 标准模式开关 | 浮窗显示答案 · hover 逐题查看 · 再按隐藏 |
| `Ctrl+Shift+H` | 后台模式开关 | 零界面 · 纯后台逐题自动勾选 |
| `Ctrl+Shift+S` | 后台保存 | 静默存双文件到桌面 |

---

## 自动答题逻辑

**核心原则：基于选项文本内容，不受字母序号或打乱顺序影响。**

```
题库答案 = "B" → bankOptions["B"] = "正确选项文本"
页面 A=丙 B=甲 C=乙 D=丁（打乱了）
→ 遍历本题选项 → 找到文本匹配的那一个 → 点击它
```

**模式划分（v1.12.1 起）**：

| 模式 | 行为 | 适用 |
|---|---|---|
| 标准模式 | 浮窗 + hover 显示答案，**零点击行为** | 手动答题，求稳 |
| 后台模式 | 逐题自动勾选，间隙 1-60 秒可配（默认 5 秒） | 全自动答题 |

**匹配置信度**：

- 完美匹配（100% 题干一致）→ 直接信任，不参与冲突判定
- 前两名得分接近且答案不同 → 标"答案存疑"，不自动勾选，浮窗供人工判断

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
| v1.14.0 | 里程碑聚合：跨入 1.14（1.13.x 连发 20 个 patch，patch 位已越过 minor 语义）。本版本聚合 09-02 以来的三大主线——①模式持久化（整页跳转自动恢复，实战"开始考试后插件失联"修复）②导入链防御（30s 超时 + 超时回查 + 极端慢写刷内存，同事 Chrome 103/105 卡导入排查闭环）③匹配引擎量级优化（万级题库 24 分钟卡死 → 15 秒，98×，语义严格等价）。1.14 发布审计：chrome.* 四种写法（裸 await/链式/裸调用/callback）全口径清零，无 Chrome 88 以下不兼容的现代 JS API，全量 JS 语法过，四套回归全绿 |
| v1.13.20 | 匹配引擎量级优化：万级题库从"页面无响应 3 分钟"降到约 15 秒（基准 98×）。三层 O(N²) 叠加——题干×题库全量 O(len²) 编辑距离无预筛、已归一化文本被重复 normalize、选项文本每对比对重算 + 去重 O(K²) 全量 DP。修复：相似度双上界预筛（长度差严格上界 + bigram 公共度保守上界，上界低于收集线跳过 DP）· 3-gram 倒排索引取 top800 候选 · 选项归一化缓存 · 去重双预筛 · DOM 排序弃全文档节点索引。语义严格等价（无 cutoff 数学等价 201 对全等 / cutoff 0 误杀），四套回归全绿 |
| v1.13.19 | saveBank 报失败前刷新内存列表（Marvis 复核 PASS 6/6 后采纳的非必须建议）：封堵">45s 极端慢写 + 不刷新页面立即重导同一文件 → 同名两份题库"的衍生场景 |
| v1.13.18 | saveBank 超时后自动 getAllBanks 回查（15s）：IndexedDB put 一旦开始不因前端超时中断，实际入库即按成功判定，杜绝"误报失败→漏导入" |
| v1.13.17 | 导入链 sendMsg 加 30s 超时：后台 service worker 异常时不再永久卡住，超时报错并给恢复指引（重开页面/刷新扩展）。排查实证：导入代码自 v1.13.8 后零改动，同事 Chrome 103/105"卡导入"非导入链回归 |
| v1.13.16 | file:// 空 host 误启防护（模式恢复与 onChanged 同步均加 location.host 非空校验）+ 清理 setMode 死代码（零调用且会误写 autoMode 配置）。Marvis 复核 v1.13.15 提出的 4 漏判点闭环 |
| v1.13.15 | 考试整页跳转失联修复（实战反馈"开始考试后按快捷键无反应"）：根因=整页跳转后 content 重载 _mode 回 off 而从不读 storage 恢复。修复：init 从 storage 读 mode+modeHost 自动恢复（host 校验防跨站误启）· background 写 mode 补 modeHost · onChanged 同步 mode 到所有 frame（含 iframe）· 快捷键改 window capture + off 态引导提示 · toggle 先 getState 校准。新增 regress_mode_restore.js 13 项 PASS |
| v1.13.14 | 多选双击取消修复（实战反馈"多选只选最后一个"）：_toggleOption 对 Element UI checkbox 双击（input+inner）经 label 隐式激活二次 toggle → 选中即取消；改为幂等 _ensureSelected（已选中跳过，只点一次 input.click()）。真实 Chrome headless 实锤：旧逻辑 [false,false,false] → 修复后 [true,true,true]。另新增 Ctrl+↑/↓ 调速快捷键（考试中免开 popup，运行中即时生效） |
| v1.13.13 | 修复残余并发窗口（Marvis 最终复核 REJECT 项）：v1.13.12 的并发锁在"指纹变化强制释放锁 + 启动新循环"时序下仍有漏洞——旧作答循环 sleep 醒来只检查 `_mode` 不检查锁，仍会继续 `_selectAnswers`，与清空 `_answeredQuestions` 后的新循环对同一批 checkbox 重复 `_toggleOption` 取消已选项→漏答。引入会话代次 `_stealthEpoch`：指纹变化时 `++`，`_autoAnswerStealth` 进入时捕获当前代次，每次 `await` 醒来后检测代次不匹配即 return 自杀让位于新循环，从根上堵死残余并发窗口。新增 `regress_concurrency_epoch.js` 实测旧循环 sleep 期间指纹变化场景：旧代次点击=0、代次 1→2 递增、锁最终释放，5 项全 PASS；科目切换回归 4 项 + 三系统识别 20/90/100 题全绿 |
| v1.13.12 | 隐形作答并发锁：给 `_autoAnswerStealth` 加运行中标志（`_stealthRunning`），多循环并发时仅第一个执行，防止弹窗渐进渲染触发多次扫描时对同一题重复点击（checkbox 多选重复 `_toggleOption` 会取消已选项）；切科目清空作答记录时同步释放锁，保证新一轮作答能启动。修复经 jsdom 并发验证（并发两次仅一次执行，锁正常释放）。解决 Marvis 审查指出的"无作答并发锁"风险 |
| v1.13.11 | 修复科目切换（SPA el-dialog 弹窗）失效：①普通模式题目集指纹变化时重置 `_hoverBound` 并重新绑定新题 hover 悬浮窗（此前 `_hoverBound` 置 true 后永不重置，切科目后新题悬浮窗不展示）②隐形模式补 `_startObserver()` 监听页面变化，切科目自动重扫并作答（此前仅一次性扫描，切科目完全不感知）③题目集变化时清空 `_answeredQuestions`，避免同题干跨科目误判已答。回归：新增 `regress_subject_switch.js` 双科目 el-dialog 切换测试，4 项全 PASS |
| v1.13.10 | Marvis 审查补漏：`.then()/.catch()` 链式 chrome API 调用（此前审计只扫了 await 形式漏了链式）。修复 5 处：content/bankManager 导入即激活（真实回归）· background saveConfig/getConfig · floatPanel 位置保存（.catch 链）· popup stealthDelay。至此 await + .then + .catch + 裸调用全口径清零 |
| v1.13.9 | 兼容审计补漏：background 剩余 6 处裸 await chrome.*（commands 96+ / pageCapture 99+ / downloads 102+ / tabs.query）改通用 chromeApi callback 包装。至此全项目裸 await chrome.* 清零，Chrome 88+ 全覆盖 |
| v1.13.8 | chrome.storage Promise 兼容（chrome.storage Promise 95+ 才支持，此前 88-94 全中招——loadBanks/导入/激活态全坏，由同事实测 Chrome 91 暴露）。29 处 await chrome.storage 改 callback 包装 |
| v1.13.7 | 题库导入健壮性：JSON 兼容 BOM/GBK 编码（Windows 记事本另存常见）· file.arrayBuffer 旧版回退 · 错误提示增强（编码/字段定位）· 列表刷新失败不再静默吞错 |
| v1.13.6 | 悬浮窗白底黑字（贴合考试页白色底色，文字清晰；移除磨砂灰毛玻璃） |
| v1.13.5 | 适配国网学堂（gwxt 标准表单：干扰勾选框过滤 · 双label选项提取 · 签名行剔除 · 计算器控件排除）· 悬浮窗半透明毛玻璃（backdrop-filter，含低版本降级） |
| v1.13.x | 低版本 Chrome 兼容：`randomUUID` 回退 · `pageCapture` 存在性检查 · 支持 Chrome 88+ |
| v1.12.x | 模式重构：标准=纯显示 / 后台=自动答题 · 答题间隙可配 · 题库管理全选/清空/覆盖/进度 · 性能优化（题库缓存+题目指纹）· 答案存疑判定修正 |
| v1.11.x | 题库管理重构：导入覆盖 · 同名去重 · 进度提示 · IndexedDB 错误透传 · _loadBanks 缓存 |
| v1.10.x | 双系统兼容：Element UI + jQuery · 抗混淆 · 自动激活 · 性能优化 |
| v1.9.x | 适配 Element UI 考试系统：no-name 分组 · hover 逐题作答 · 浮窗重构 |
| v1.8.x | 浮窗 UI · 隐形模式 · 题库管理 · 反检测基础 |
