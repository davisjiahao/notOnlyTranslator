# NotOnlyTranslator

[English](#english) | [中文](#中文)

---

## English

### Overview

**NotOnlyTranslator** is an intelligent browser extension that adapts English translations to your proficiency level. Unlike traditional translation tools that translate everything, NotOnlyTranslator only translates words and phrases that are beyond your current English level, helping you learn naturally while reading.

### ✨ Features

- **🎯 Adaptive Translation**: Translates only content above your proficiency level
- **📊 Level Assessment**: Initial assessment via exam scores (CET-4/6, TOEFL, IELTS, GRE) or quick vocabulary test
- **🔄 Dynamic Learning**: Automatically adjusts your estimated vocabulary as you mark known/unknown words
- **✏️ Word Marking**: Mark words as "known" or "unknown" to refine your profile
- **📚 Vocabulary Book**: Save and review unknown words with context
- **💡 Smart Highlighting**: Automatically highlights difficult words on web pages
- **🎨 Customizable**: Adjust highlight colors, font size, and translation modes
- **🤖 LLM-Powered**: Uses OpenAI GPT-4o-mini or Anthropic Claude for intelligent translation
- **🔧 Custom API Support**: Connect to local models (LM Studio, Ollama) or any OpenAI-compatible API

### 🚀 Installation

#### From Chrome Web Store (Coming Soon)
1. Visit the Chrome Web Store
2. Click "Add to Chrome"
3. Follow the installation prompts

#### From Source
1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/notOnlyTranslator.git
   cd notOnlyTranslator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### 🎓 Setup

1. **Configure API**:
   - Click the extension icon
   - Go to Settings → API Settings
   - Choose API provider:
     - **OpenAI**: Official API (requires key from platform.openai.com)
     - **Anthropic**: Official API (requires key from console.anthropic.com)
     - **Custom API**: Use local models or custom endpoints (see [Custom API Guide](CUSTOM_API_GUIDE.md))
   - Enter your API key
   - (Optional) Customize API URL and model name

2. **Set Your English Level**:
   - Go to Settings → English Level
   - Select your exam type and score, or
   - Take the quick 20-question vocabulary test

3. **Start Reading**:
   - Visit any English website
   - The extension will automatically highlight words above your level
   - Click highlighted words to see translations
   - Mark words as "known" or "add to vocabulary"

📚 **Need Help?** Check out our [Quick Start Guide](docs/help/QUICK_START.md) or [FAQ](docs/help/FAQ.md)

### 📖 Usage

#### Translation Modes

- **Selective Mode** (Default): Only translates words/phrases above your level
- **Full Mode**: Translates all content

#### Word Marking

- **Known**: Removes the word from future highlights
- **Unknown**: Adds to vocabulary book for review
- **Add to Vocabulary**: Saves with translation and context

#### Context Menu

Right-click on any selected text:
- Translate Selection
- Mark as Known
- Mark as Unknown
- Add to Vocabulary

### 🛠️ Development

#### Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite + @crxjs/vite-plugin
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Storage**: Chrome Storage API
- **LLM APIs**: OpenAI / Anthropic

#### Project Structure

```
notOnlyTranslator/
├── src/
│   ├── background/          # Service Worker
│   │   ├── index.ts
│   │   ├── translation.ts   # Translation service
│   │   ├── userLevel.ts     # User level management
│   │   └── storage.ts       # Storage management
│   │
│   ├── content/             # Content Script
│   │   ├── index.ts
│   │   ├── highlighter.ts   # Text highlighting
│   │   ├── tooltip.ts       # Translation tooltip
│   │   └── marker.ts        # Word marking
│   │
│   ├── popup/               # Extension popup
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── options/             # Settings page
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── shared/              # Shared code
│   │   ├── types/           # TypeScript types
│   │   ├── constants/       # Constants
│   │   ├── utils/           # Utility functions
│   │   └── hooks/           # React hooks
│   │
│   └── data/                # Static data
│       └── vocabulary/      # Vocabulary lists
│
├── public/
│   └── manifest.json        # Extension manifest
│
└── vite.config.ts
```

#### Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview build
npm run preview

# Lint code
npm run lint
```

### 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### 📄 License

MIT License - see [LICENSE](LICENSE) for details.

### 🙏 Acknowledgments

- Powered by OpenAI GPT-4o-mini and Anthropic Claude
- Built with React, Vite, and Tailwind CSS
- Icon design inspired by language learning concepts

---

## 中文

### 项目简介

**NotOnlyTranslator** 是一款根据用户英语水平智能翻译的浏览器插件。与传统翻译工具不同,它只翻译超出您当前水平的单词和短语,帮助您在阅读中自然学习。

### ✨ 核心功能

- **🎯 自适应翻译**: 只翻译超出您水平的内容
- **📊 水平评估**: 通过考试成绩(四六级、托福、雅思、GRE)或快速测评确定水平
- **🔄 动态学习**: 根据标记行为自动调整词汇量估计
- **✏️ 词汇标记**: 标记"认识"或"不认识"来优化个人档案
- **📚 生词本**: 保存并复习不认识的词汇及其上下文
- **💡 智能高亮**: 自动高亮网页中的难词
- **🎨 个性化定制**: 调整高亮颜色、字体大小和翻译模式
- **🤖 LLM驱动**: 使用 OpenAI GPT-4o-mini 或 Anthropic Claude 智能翻译
- **🔧 自定义API支持**: 支持本地模型（LM Studio、Ollama）或任何 OpenAI 兼容 API

### 🚀 安装方法

#### 从 Chrome 应用商店安装(即将推出)
1. 访问 Chrome 应用商店
2. 点击"添加至 Chrome"
3. 按照提示完成安装

#### 从源码安装
1. 克隆仓库:
   ```bash
   git clone https://github.com/yourusername/notOnlyTranslator.git
   cd notOnlyTranslator
   ```

2. 安装依赖:
   ```bash
   npm install
   ```

3. 构建插件:
   ```bash
   npm run build
   ```

4. 在 Chrome 中加载插件:
   - 打开 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择 `dist` 文件夹

### 🎓 设置步骤

1. **配置 API**:
   - 点击插件图标
   - 进入设置 → API 设置
   - 选择 API 提供商:
     - **OpenAI**: 官方 API（需要从 platform.openai.com 获取密钥）
     - **Anthropic**: 官方 API（需要从 console.anthropic.com 获取密钥）
     - **自定义 API**: 使用本地模型或自定义端点（参见[自定义 API 指南](CUSTOM_API_GUIDE.md)）
   - 输入您的 API 密钥
   - （可选）自定义 API URL 和模型名称

2. **设置英语水平**:
   - 进入设置 → 英语水平
   - 选择考试类型和分数,或
   - 参加快速20题词汇测评

3. **开始阅读**:
   - 访问任何英文网站
   - 插件会自动高亮超出您水平的词汇
   - 点击高亮词汇查看翻译
   - 标记词汇为"认识"或"加入生词本"

### 📖 使用说明

#### 翻译模式

- **选择性模式**(默认): 只翻译超出您水平的词汇/短语
- **全文模式**: 翻译所有内容

#### 词汇标记

- **认识**: 从未来的高亮中移除该词
- **不认识**: 添加到生词本供复习
- **加入生词本**: 保存词汇、翻译和上下文

#### 右键菜单

在任何选中的文本上右键:
- 翻译选中内容
- 标记为认识
- 标记为不认识
- 加入生词本

### 🛠️ 开发指南

#### 技术栈

- **框架**: React 18 + TypeScript
- **构建工具**: Vite + @crxjs/vite-plugin
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **存储**: Chrome Storage API
- **LLM API**: OpenAI / Anthropic

#### 项目结构

```
notOnlyTranslator/
├── src/
│   ├── background/          # Service Worker
│   │   ├── index.ts
│   │   ├── translation.ts   # 翻译服务
│   │   ├── userLevel.ts     # 用户水平管理
│   │   └── storage.ts       # 存储管理
│   │
│   ├── content/             # Content Script
│   │   ├── index.ts
│   │   ├── highlighter.ts   # 文本高亮
│   │   ├── tooltip.ts       # 翻译悬浮框
│   │   └── marker.ts        # 词汇标记
│   │
│   ├── popup/               # 弹出页面
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── options/             # 设置页面
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── shared/              # 共享代码
│   │   ├── types/           # TypeScript 类型
│   │   ├── constants/       # 常量
│   │   ├── utils/           # 工具函数
│   │   └── hooks/           # React Hooks
│   │
│   └── data/                # 静态数据
│       └── vocabulary/      # 词汇表
│
├── public/
│   └── manifest.json        # 插件清单
│
└── vite.config.ts
```

#### 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产构建
npm run build

# 预览构建
npm run preview

# 代码检查
npm run lint
```

### 🤝 贡献

欢迎贡献! 请随时提交 Pull Request。

### 📄 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE)。

### 🙏 致谢

- 基于 OpenAI GPT-4o-mini 和 Anthropic Claude
- 使用 React、Vite 和 Tailwind CSS 构建
- 图标设计灵感来自语言学习概念
