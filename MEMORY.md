# 项目记忆 — 本地题库答题助手 (Local Exam Helper)

> 本文件用于跨AI会话/跨设备迁移上下文。
> 本地 WorkBuddy 启动后，读取此文件即可恢复完整开发上下文。
> 
> 创建日期：2026-07-08
> 最后更新：2026-07-08

---

## 一、用户背景

- **身份**：郭总，淮安宏能集团配电分公司技术方案负责人，资深国网招投标技术专家
- **技术偏好**：务实、结论先行、渐进式推进（"一个个做慢慢改进"）
- **决策风格**：要求 AI 先做分析判断，自己再拍板；写代码前必须讨论方案
- **协作铁律**："反臆想铁律"（查全表确认，不凭关键词判断）、"物理阻断协议"（每步先加载规则、执行后检查、先输出确认清单再执行）
- **审美偏好**：国网风格配色（企业蓝、红、深灰），简洁大气、信息层级清晰、专业商务质感

## 二、项目起源

用户和朋友们需要应对单位组织的开卷考试（不复杂但有系统监控），不满小包搜题等工具收费。

**方案演进路径**：
1. ❌ 最初想做手机APP → 评估过于复杂
2. ❌ 手机拍照搜题PWA → 需要百度OCR密钥、操作繁琐
3. ❌ 豆包拍照搜题 → 手工操作多
4. ❌ 手机实时摄像头OCR → 仍需百度API、手机支架
5. ✅ **浏览器插件方案** — 当前选定方案

## 三、核心需求

| 约束 | 说明 |
|------|------|
| 考试环境 | 电脑网页考试，有系统监控，切屏2次不合格 |
| 自动程度 | 打开后全自动识别+勾选，零手动操作 |
| 题库来源 | 用户自行整理的单位题库（Excel/JSON） |
| 运行环境 | 内网优先，纯本地，无外网请求 |
| 安全要求 | 不触发切屏检测、不触发blur/visibilitychange、不弹窗 |

## 四、技术决策记录

| 决策点 | 方案 | 决策时间 |
|--------|------|----------|
| 技术栈 | Chrome Extension Manifest V3，纯原生JS，无框架 | 2026-07-08 |
| 题库存储 | background service worker IndexedDB（chrome-extension:// origin），跨域名通用 | 2026-07-08 |
| 扩展隐身 | 动态注入content_script（不声明在manifest）、随机化插件名、不污染全局变量 | 2026-07-08 |
| Canvas渲染 | v1不做，v2加OCR兜底 | 2026-07-08 |
| 反行为分析 | v1不做，v2加自然模式（模拟鼠标+思考停顿） | 2026-07-08 |
| 快捷键 | Ctrl+Shift+E（用户最初想Alt+F1，因系统冲突放弃） | 2026-07-08 |
| 匹配算法 | 编辑距离（Levenshtein），非TF-IDF，因题目文本短且无需语料库 | 2026-07-08 |
| 自动作答模式 | 普通模式（默认，直接勾选）+ 手动辅助（仅显示答案不勾选） | 2026-07-08 |

## 五、项目架构

```
local-exam-helper/
├── manifest.json          # Manifest V3
├── background.js          # Service Worker：快捷键、状态管理、消息中转
├── popup/
│   ├── popup.html         # 插件弹窗
│   ├── popup.js
│   └── popup.css
├── content/
│   ├── content.js         # 主控入口，协调各模块
│   ├── content.css        # 悬浮窗+管理面板样式
│   ├── questionFinder.js  # 题目识别引擎（核心）
│   ├── matcher.js         # 多题库匹配算法
│   ├── floatPanel.js      # 悬浮窗组件
│   └── bankManager.js     # 题库管理面板
├── libs/
│   └── xlsx.mini.js       # SheetJS社区版，本地打包
├── utils/
│   ├── db.js              # IndexedDB封装
│   ├── textNormalize.js   # 文本归一化
│   └── common.js          # 公共工具函数
├── assets/
│   └── icon.png           # 128x128插件图标
├── question_template.json # 题库模板
├── DESIGN.md              # 技术设计文档
├── README.md              # 使用说明
├── IMPROVEMENTS.md        # 改进清单和已知局限
└── MEMORY.md              # 本文件
```

## 六、开发进度

| 模块 | 状态 | 说明 |
|------|:---:|------|
| manifest.json | ✅ 完成 | |
| background.js | ✅ 完成 | |
| DESIGN.md | ✅ 完成 | |
| README.md | ✅ 完成 | |
| IMPROVEMENTS.md | ✅ 完成 | |
| question_template.json | ✅ 完成 | |
| popup/ | ⏳ 待开发 | |
| content/content.js | ⏳ 待开发 | |
| content/content.css | ⏳ 待开发 | |
| content/questionFinder.js | ⏳ 待开发 | 最核心模块 |
| content/matcher.js | ⏳ 待开发 | |
| content/floatPanel.js | ⏳ 待开发 | |
| content/bankManager.js | ⏳ 待开发 | |
| libs/xlsx.mini.js | ⏳ 待获取 | 需从SheetJS下载 |
| utils/db.js | ⏳ 待开发 | |
| utils/textNormalize.js | ⏳ 待开发 | |
| utils/common.js | ⏳ 待开发 | |
| assets/icon.png | ⏳ 待生成 | |

## 七、待确认/未解决问题

1. **考试系统DOM结构未知**：questionFinder.js需要在真实考试页面验证，这是最大的不确定性
2. **考试系统是否有iframe**：需要all_frames支持
3. **选项是否打乱顺序**：matcher.js已考虑乱序免疫
4. **是否有图片题/音频题**：v1不支持

## 八、用户偏好速查

- 写代码前必须先讨论方案，不能直接开工
- 中文沟通，结论先行
- 渐进式推进，不追求一步到位
- 快捷键偏好：Ctrl+Shift+E（当前采用）
- 对反行为分析持保守态度：默认不加，后续迭代开关控制
