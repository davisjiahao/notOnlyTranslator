# 公众号排版素材库规范

## 文档信息

| 项目 | 内容 |
|------|------|
| 创建时间 | 2026-03-15 |
| 维护者 | Private Domain Operator |
| 版本 | v1.0 |

---

## 1. 封面图模板

### 尺寸规格

| 类型 | 尺寸 | 用途 |
|------|------|------|
| 首图文封面 | 900×500px (1:1) | 公众号会话列表显示 |
| 普通封面 | 900×383px (2.35:1) | 文章详情页顶部显示 |
| 缩略图 | 200×200px | 分享时显示 |

### 封面图模板系列

#### 模板 A：学习干货类
- **风格**：简洁专业，书本/笔元素
- **配色**：Indigo (#4F46E5) 主色 + 白色文字
- **字体**：标题思源黑体 Bold，副标题 Regular
- **结构**：
  ```
  [顶部装饰条：品牌色]
  [主标题：大字居中]
  [副标题：小字底部]
  [右下角：品牌 Logo]
  ```

#### 模板 B：工具测评类
- **风格**：对比感，左右分栏
- **配色**：对比色设计 (Indigo vs Emerald)
- **元素**：产品截图框 + 评分星级
- **结构**：
  ```
  [左侧：产品A名称 + 评分]
  [中间：VS 标识]
  [右侧：产品B名称 + 评分]
  [底部：测评结论一句话]
  ```

#### 模板 C：用户故事类
- **风格**：温暖亲切，人物剪影
- **配色**：Amber (#F59E0B) 暖色调
- **元素**：成绩提升曲线图 + 用户头像占位
- **结构**：
  ```
  [顶部：成绩对比 Before/After]
  [中间：用户身份标签]
  [底部：金句引用]
  ```

#### 模板 D：产品动态类
- **风格**：科技现代，渐变背景
- **配色**：品牌渐变 (Indigo → Purple)
- **元素**：功能图标 + 版本号
- **结构**：
  ```
  [大标题：v1.x 正式发布]
  [功能亮点图标矩阵]
  [底部：立即体验 CTA]
  ```

---

## 2. 配图素材库

### 2.1 图标素材

#### 功能图标 (SVG/PNG 48×48px)
| 图标名 | 用途 |
|--------|------|
| icon-translate.svg | 翻译功能标识 |
| icon-vocabulary.svg | 词汇本功能 |
| icon-statistics.svg | 数据统计功能 |
| icon-settings.svg | 设置功能 |
| icon-bookmark.svg | 收藏/标记功能 |
| icon-share.svg | 分享功能 |
| icon-download.svg | 下载引导 |
| icon-star.svg | 推荐/评分 |
| icon-check.svg | 完成/勾选 |
| icon-tip.svg | 提示/技巧 |

#### 场景插图 (PNG 800×600px)
| 插图名 | 场景描述 |
|--------|----------|
| illus-reading.png | 学生阅读英文网页 |
| illus-studying.png | 备考学习场景 |
| illus-office.png | 职场办公场景 |
| illus-mobile.png | 移动端学习 |
| illus-success.png | 考试通过/成绩提升 |

### 2.2 截图规范

#### 插件界面截图
- **尺寸**：1440×900px (16:10)
- **格式**：PNG (保留清晰度)
- **标注**：使用 Skitch/Annotate 添加红色标注框
- **命名**：`screenshot-{feature}-{context}.png`
- **示例**：
  - `screenshot-highlight-article.png` (文章高亮效果)
  - `screenshot-tooltip-translate.png` (翻译弹窗)
  - `screenshot-popup-dashboard.png` (Popup 仪表盘)
  - `screenshot-options-settings.png` (设置页面)

#### 数据图表
- **工具**：使用 NotOnlyTranslator 内置统计功能导出
- **尺寸**：800×400px
- **配色**：使用品牌色系列
  - 主色：#4F46E5 (Indigo)
  - 辅助色：#10B981 (Emerald)
  - 强调色：#F59E0B (Amber)

---

## 3. 排版样式规范

### 3.1 字体规范

| 层级 | 字号 | 字重 | 颜色 |
|------|------|------|------|
| 文章标题 | 22px | Bold | #111827 |
| 一级标题 | 18px | Bold | #1F2937 |
| 二级标题 | 16px | SemiBold | #374151 |
| 正文 | 15px | Regular | #4B5563 |
| 引用 | 14px | Regular | #6B7280 (斜体) |
| 注释 | 13px | Regular | #9CA3AF |
| 代码 | 14px | Mono | #1F2937 (背景 #F3F4F6) |

### 3.2 配色方案

#### 品牌色板
```css
--primary: #4F46E5;        /* Indigo 600 */
--primary-light: #818CF8;  /* Indigo 400 */
--secondary: #10B981;      /* Emerald 500 */
--accent: #F59E0B;         /* Amber 500 */
--dark: #111827;           /* Gray 900 */
--text: #4B5563;           /* Gray 600 */
--light: #F9FAFB;          /* Gray 50 */
--border: #E5E7EB;         /* Gray 200 */
```

#### 语义颜色
| 用途 | 颜色 | 示例 |
|------|------|------|
| 主要按钮/链接 | #4F46E5 | [立即下载] |
| 成功/正向 | #10B981 | ✓ 完成 |
| 警告/提示 | #F59E0B | ⚠ 注意 |
| 错误/负面 | #EF4444 | ✗ 失败 |
| 信息/中性 | #3B82F6 | ℹ 说明 |

### 3.3 间距规范

```css
/* 段落间距 */
段落间距：margin-bottom: 1.5em
标题上间距：margin-top: 2em
标题下间距：margin-bottom: 0.8em

/* 组件间距 */
卡片内边距：padding: 16px 20px
按钮内边距：padding: 10px 24px
图片下边距：margin-bottom: 1.5em
```

---

## 4. 组件模板

### 4.1 引导卡片

#### 下载引导卡片
```html
<div style="background: #F9FAFB; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #4F46E5;">
  <h4 style="margin: 0 0 12px; color: #111827;">🚀 立即体验</h4>
  <p style="margin: 0 0 16px; color: #4B5563;">Chrome Web Store 搜索 "NotOnlyTranslator"</p>
  <a href="{下载链接}" style="display: inline-block; background: #4F46E5; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">免费下载</a>
</div>
```

#### 资料领取卡片
```html
<div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); border-radius: 12px; padding: 20px; margin: 24px 0; color: white;">
  <h4 style="margin: 0 0 12px;">🎁 免费资料包</h4>
  <ul style="margin: 0 0 16px; padding-left: 20px;">
    <li>考研英语真题合集</li>
    <li>四六级高频词汇</li>
    <li>雅思听力训练材料</li>
  </ul>
  <p style="margin: 0; font-size: 14px;">后台回复「资料」立即获取</p>
</div>
```

### 4.2 引用样式

#### 用户证言引用
```html
<blockquote style="border-left: 4px solid #10B981; padding: 12px 20px; margin: 20px 0; background: #ECFDF5; border-radius: 0 8px 8px 0;">
  <p style="margin: 0 0 8px; color: #065F46; font-style: italic;">"终于不用一个个查单词了！阅读效率提升了一倍。"</p>
  <cite style="color: #059669; font-size: 13px;">— 考研党小李</cite>
</blockquote>
```

#### 提示框样式
```html
<div style="background: #FFFBEB; border: 1px solid #FCD34D; border-radius: 8px; padding: 16px; margin: 20px 0;">
  <p style="margin: 0; color: #92400E;">💡 <strong>小贴士：</strong>建议将生词率控制在10-15%，既不会太难也不会太简单。</p>
</div>
```

### 4.3 数据展示

#### 对比数据展示
```html
<div style="display: flex; gap: 16px; margin: 24px 0;">
  <div style="flex: 1; background: #F3F4F6; padding: 16px; border-radius: 8px; text-align: center;">
    <p style="margin: 0; color: #6B7280; font-size: 13px;">使用前</p>
    <p style="margin: 8px 0 0; font-size: 24px; font-weight: bold; color: #9CA3AF;">60%</p>
    <p style="margin: 4px 0 0; color: #9CA3AF; font-size: 13px;">正确率</p>
  </div>
  <div style="flex: 1; background: #ECFDF5; padding: 16px; border-radius: 8px; text-align: center;">
    <p style="margin: 0; color: #059669; font-size: 13px;">使用后</p>
    <p style="margin: 8px 0 0; font-size: 24px; font-weight: bold; color: #10B981;">85%</p>
    <p style="margin: 4px 0 0; color: #059669; font-size: 13px;">正确率</p>
  </div>
</div>
```

---

## 5. 文章排版模板

### 5.1 学习干货类模板

```markdown
# 标题 (22px Bold)

## 痛点引入 (二级标题)
[痛点描述段落，使用 emoji 列表]
- 😫 痛点1描述
- 😫 痛点2描述

## 我的经历
[个人故事段落，建立共鸣]

## 干货分享 (一级标题)

### 技巧1：xxx (二级标题)
[详细步骤说明]
[配图/截图]

### 技巧2：xxx
[详细步骤说明]

### 技巧3：xxx
[详细步骤说明]

## 效果对比
[数据对比展示组件]

## 行动指引
[下载引导卡片]

## 互动
[提问引导评论]
```

### 5.2 工具测评类模板

```markdown
# 标题

## 测评说明
[测评背景和个人立场]

## 测评维度
- ⭐ 维度1
- ⭐ 维度2
- ⭐ 维度3

## 产品对比

### 产品A
[优缺点列表]
适合人群：xxx

### 产品B
[优缺点列表]
适合人群：xxx

## 使用场景对比
[场景化对比表格]

## 总结建议
[选择建议，不同需求对应不同产品]

## 福利
[下载引导]
```

---

## 6. 文件命名规范

### 素材文件命名
```
{type}-{name}-{variant}.{ext}

类型前缀：
- cover- 封面图
- icon- 图标
- illus- 插图
- screenshot- 截图
- template- 模板文件

示例：
- cover-article-gaokao-v1.png
- icon-translate-48.svg
- screenshot-highlight-tooltip.png
- template-learning-guide.html
```

### 文章文件命名
```
{date}-{category}-{title}.md

示例：
- 2026-03-30-product-launch.md
- 2026-04-02-gaokao-english-tips.md
```

---

## 7. 素材存储结构

```
.paperclip/
└── content/
    └── wechat/
        ├── article-templates.md      # 文章模板库 (已创建)
        ├── auto-reply-templates.md   # 自动回复模板 (已创建)
        ├── account-setup-spec.md     # 账号设置规范 (已创建)
        ├── editorial-assets-spec.md  # 本文件
        └── assets/                   # 素材文件夹
            ├── covers/               # 封面图模板 (PSD/Sketch)
            │   ├── template-learning.psd
            │   ├── template-review.psd
            │   ├── template-story.psd
            │   └── template-product.psd
            ├── icons/                # 图标素材
            │   ├── icon-translate.svg
            │   ├── icon-vocabulary.svg
            │   └── ...
            ├── illustrations/        # 场景插图
            │   ├── illus-reading.png
            │   ├── illus-studying.png
            │   └── ...
            └── screenshots/          # 产品截图
                ├── screenshot-highlight-article.png
                ├── screenshot-tooltip-translate.png
                └── ...
```

---

## 8. 制作检查清单

### 封面图制作检查
- [ ] 尺寸符合规范 (首图 900×500，普通 900×383)
- [ ] 使用品牌色配色方案
- [ ] 文字清晰可读 (标题字号 ≥ 48px)
- [ ] Logo 位置统一 (右下角)
- [ ] 导出压缩 < 2MB

### 文章排版检查
- [ ] 字体大小符合规范
- [ ] 颜色使用品牌色板
- [ ] 间距统一
- [ ] 移动端预览正常
- [ ] 图片有 alt 文字
- [ ] 链接可点击

### 发布前检查
- [ ] 封面图已上传
- [ ] 摘要已填写 (≤120字)
- [ ] 原文链接已添加 (UTM 追踪)
- [ ] 关键词已设置
- [ ] 定时发布已设置 (如需要)

---

**文档版本**: v1.0
**创建日期**: 2026-03-15
**更新人**: Private Domain Operator
