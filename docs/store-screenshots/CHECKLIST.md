# Chrome Web Store 上架清单

## 基本信息

| 项目 | 状态 | 备注 |
|------|------|------|
| 应用名称 | ✅ | NotOnlyTranslator - 智能分级翻译助手 |
| 简短描述 | ✅ | 智能识别超出你词汇量的单词，只翻译该翻译的内容 |
| 详细描述 | ✅ | 已完成（docs/store-listing.md） |
| 隐私政策 | ✅ | 已完成（PRIVACY.md） |
| 版本号 | ✅ | 0.1.0 |

## 图标资源

| 尺寸 | 文件 | 状态 |
|------|------|------|
| 16x16 | icons/icon16.png | ✅ |
| 48x48 | icons/icon48.png | ✅ |
| 128x128 | icons/icon128.png | ✅ |

## 截图准备（✅ 已完成）

### 必需截图
- [x] **截图 1**: 主界面 - 翻译高亮效果 (1280x800) → `01-main-interface.png`
- [x] **截图 2**: 设置页面 (1280x800) → `02-settings-page.png`

### 推荐截图
- [x] **截图 3**: 学习统计仪表盘 (1280x800) → `03-statistics-dashboard.png`
- [x] **截图 4**: 闪卡复习界面 (1280x800) → `04-flashcard-review.png`
- [x] **截图 5**: 词汇管理界面 (1280x800) → `05-vocabulary-management.png`

### 推广图片
- [x] **推广图**: SVG 源文件已创建 (`promo-image.svg`, `promo-920x680.svg`, `promo-1400x560.svg`)

## 截图准备步骤

### 1. 环境准备
```bash
# 1. 构建生产版本
npm run build

# 2. 加载扩展到 Chrome
# - 打开 chrome://extensions/
# - 开启"开发者模式"
# - 点击"加载已解压的扩展程序"
# - 选择 dist 文件夹
```

### 2. 截图场景执行

#### 截图 1: 主界面翻译效果
1. 访问 https://en.wikipedia.org/wiki/Artificial_intelligence
2. 等待页面翻译完成（显示高亮单词）
3. 调整浏览器窗口为 1280x800
4. 截图保存为 `screenshot-1-main.png`

#### 截图 2: Tooltip 详情
1. 在已翻译的页面上
2. 鼠标悬停在任意高亮单词上
3. 等待 Tooltip 完全显示
4. 截图保存为 `screenshot-2-tooltip.png`

#### 截图 3: 闪卡复习
1. 点击扩展图标 → 选项
2. 进入"闪卡复习"标签
3. 确保显示单词卡片
4. 截图保存为 `screenshot-3-flashcard.png`

#### 截图 4: 学习统计
1. 在选项页面进入"学习统计"标签
2. 确保有学习数据（先浏览几篇英文文章）
3. 截图保存为 `screenshot-4-stats.png`

#### 截图 5: API 设置
1. 在选项页面进入"API 设置"标签
2. 显示多提供商支持
3. 截图保存为 `screenshot-5-settings.png`

### 3. 图片导出

```bash
# 转换推广图片 SVG 为 PNG
# 使用 Inkscape 或在线工具
# 尺寸: 440x280 像素
```

## 文件命名规范

```
docs/store-screenshots/
├── screenshot-1-main.png      # 主界面翻译效果
├── screenshot-2-tooltip.png   # Tooltip 详情
├── screenshot-3-flashcard.png # 闪卡复习（可选）
├── screenshot-4-stats.png     # 学习统计（可选）
├── screenshot-5-settings.png  # API 设置（可选）
├── promo-image.png            # 440x280 推广图
└── icon-128x128.png           # 商店图标副本
```

## Chrome Web Store 提交检查清单

### 元数据
- [ ] 应用名称（中英文）
- [ ] 详细描述（中英文）
- [ ] 隐私政策链接
- [ ] 支持邮箱
- [ ] 官方网站链接

### 图片资源
- [ ] 图标（128x128 PNG）
- [ ] 截图（1-5 张，1280x800 或 640x400）
- [ ] 推广图片（440x280，可选但推荐）

### 扩展包
- [ ] 代码已压缩优化
- [ ] 无测试文件
- [ ] 无开发依赖
- [ ] manifest.json 格式正确

### 权限说明
- [ ] storage - 存储用户设置和学习数据
- [ ] activeTab - 访问当前页面进行翻译
- [ ] contextMenus - 右键菜单功能
- [ ] alarms - 定时任务（保持 service worker 活跃）

## 提交流程

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. 点击"新建项目"
3. 上传扩展包（zip 文件）
4. 填写商店信息
5. 上传截图和推广图片
6. 提交审核

## 审核时间

- 通常 1-3 个工作日
- 首次提交可能更长
- 确保所有信息完整准确

---

**最后更新**: 2026-03-21
**负责人**: CEO
**协助**: CTO
