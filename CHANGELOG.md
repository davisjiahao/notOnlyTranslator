# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project setup
- User proficiency level assessment system
- Adaptive translation based on user level
- Smart word highlighting on web pages
- Translation tooltip with marking functionality
- Vocabulary book for unknown words
- Quick vocabulary test (20 questions)
- Support for multiple exam types (CET-4/6, TOEFL, IELTS, GRE)
- Customizable highlight colors and font sizes
- Selective and full translation modes
- LLM integration (OpenAI GPT-4o-mini and Anthropic Claude)
- Context menu integration
- Data export functionality
- Responsive UI with Tailwind CSS

### Tech Stack
- React 18 + TypeScript
- Vite + @crxjs/vite-plugin
- Tailwind CSS
- Zustand for state management
- Chrome Extension Manifest V3

## [0.4.0] - 2026-10-16

### Added
- 新增默认关闭的 Jev 语境词汇识别，可配置供应商、完整 HTTPS 地址、模型和阈值；自定义服务需兼容 `systemone/noul` 协议。
- Jev 密钥独立保存在本机 IndexedDB，并绑定供应商及完整服务地址；不进入同步设置或备份，清除全部数据时删除。
- 新增冻结合成样本的校准工具，以及配置、凭据隔离、取消和精确高亮的浏览器验收。

### Fixed
- 按每次出现的位置识别和释义，支持重复词不同义项及跨行内节点的 UTF-16 精确高亮。
- 配置、词表、密钥变化或取消后丢弃旧请求结果；完善限流冷却、请求截止与错误脱敏。
- 语言检测排除扩展自身的中文界面，修复短英文页面被误判为中文的问题。

### Notes
- Jev 首版限 B1、纯行内阅读、关闭短语与语法增强，并使用受支持的 LLM 释义服务；其他组合沿用原流程。
- 默认阈值仅经合成样本校准，自定义服务和模型需重新评估；识别与释义分别向相应服务发送必要上下文。

## [0.3.2] - 2026-10-09

### Fixed
- 设置页“关于”改为显示实际安装的扩展版本，修复升级后仍显示 `0.1.0` 的问题。
- 增加不同版本的界面回归检查，避免后续发布再次出现版本文案不同步。

## [0.3.0] - 2026-03-30

### Added
- **首次使用引导** - WelcomeModal 欢迎弹窗引导新用户
- **API 连接测试** - 设置页面支持测试 API 连接状态
- **翻译效果演示** - 添加截图脚本和演示图片
- **营销策略规划** - 明确产品定位和目标用户群体

### Changed
- **CMP-128 流程优化** - Options 页面代码拆分优化
- **无刷新模式切换** - 网站切换时无需刷新页面
- **Tooltip UI 增强** - 优化加载和错误状态显示

### Fixed
- 修复 Tooltip 重复函数定义问题
- 修复 ESLint 警告

## [0.2.0] - 2026-03-21

### Added
- **复习提醒系统** - 支持艾宾浩斯遗忘曲线的词汇复习提醒
- **翻译样式设置** - 可自定义译文显示样式
- **CEFR 等级标签系统** - 词汇等级可视化显示
- **词汇高亮悬停支持** - 鼠标悬停显示词汇详情
- **浮动按钮引擎切换** - 快速切换翻译引擎
- **双击查词功能** - 双击单词快速查询翻译
- **键盘快捷键支持** - Alt+T 快速翻译段落，Alt+Shift+T 切换翻译显示
- **快捷键设置 UI** - 可自定义快捷键配置界面
- **有道翻译支持** - 新增国内可访问的翻译提供商
- **DeepL 集成** - 专业翻译服务支持
- **混合翻译系统** - 智能路由选择最优翻译引擎
- **文本复杂度分析器** - 根据文本复杂度自动选择翻译策略
- **O(1) LRU 缓存** - 高性能翻译缓存系统
- **翻译历史记录** - IndexedDB 存储翻译历史
- **用户反馈系统** - 收集用户反馈意见
- **性能监控系统** - 实时监控插件性能指标
- **提示词版本管理** - 支持动态切换提示词版本

### Changed
- 优化译文行淡入动画效果
- 重构快捷键设置组件

### Security
- 修复译文显示 XSS 漏洞

### Fixed
- 修复段落翻译类型错误
- 修复测试超时问题
- 修复 ShortcutSettings ESLint 依赖警告

## [0.1.1] - 2024-01-22

### Fixed
- Minor bug fixes and improvements

## [0.1.0] - 2024-01-21

### Added
- Initial release
- Core translation functionality
- User level management
- Vocabulary tracking
