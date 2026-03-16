# CMP-56: robots.txt 与 sitemap.xml 配置规范

## 任务信息

| 项目 | 内容 |
|------|------|
| 任务编号 | CMP-56 |
| 任务名称 | 【Baidu SEO Phase 1】robots.txt 与 sitemap.xml 配置 |
| 负责人 | Dev (技术团队) |
| 协作方 | SEO Specialist (策略指导) |
| 优先级 | High |
| 状态 | 待执行 |
| 预计工期 | 1-2 工作日 |
| 依赖任务 | CMP-55 (域名与服务器部署) |

---

## 一、robots.txt 配置

### 1.1 基础配置模板

```
# robots.txt for notonlytranslator.cn
# Last updated: 2026-03-16
# SEO Maintainer: SEO Specialist

# ============================================
# User-Agent: 通用规则
# ============================================
User-agent: *

# 允许访问
Allow: /
Allow: /blog/
Allow: /features/
Allow: /download/
Allow: /help/
Allow: /about/
Allow: /privacy/

# 禁止访问
Disallow: /admin/
Disallow: /api/
Disallow: /tmp/
Disallow: /private/
Disallow: /cgi-bin/
Disallow: /*.pdf$
Disallow: /*.doc$
Disallow: /*.docx$

# ============================================
# User-Agent: 百度爬虫 (Baiduspider)
# ============================================
User-agent: Baiduspider

# 允许访问
Allow: /
Allow: /blog/
Allow: /features/
Allow: /download/
Allow: /help/
Allow: /about/
Allow: /privacy/

# 禁止访问
Disallow: /admin/
Disallow: /api/
Disallow: /tmp/
Disallow: /private/

# 抓取延迟（避免服务器压力）
Crawl-delay: 1

# ============================================
# User-Agent: 百度图片爬虫
# ============================================
User-agent: Baiduspider-image

Allow: /images/
Allow: /static/images/
Disallow: /admin/

# ============================================
# User-Agent: 百度移动爬虫
# ============================================
User-agent: Baiduspider-mobile

Allow: /
Disallow: /admin/
Disallow: /api/

# ============================================
# User-Agent: 其他爬虫
# ============================================

# Googlebot
User-agent: Googlebot
Allow: /
Disallow: /admin/
Disallow: /api/

# Bingbot
User-agent: Bingbot
Allow: /
Disallow: /admin/
Disallow: /api/

# 搜狗
User-agent: Sogou web spider
Allow: /
Disallow: /admin/
Disallow: /api/

# 360搜索
User-agent: 360Spider
Allow: /
Disallow: /admin/
Disallow: /api/

# ============================================
# 其他爬虫控制
# ============================================

# 禁止特定爬虫（可选）
User-agent: MJ12bot
Disallow: /

User-agent: AhrefsBot
Crawl-delay: 10

User-agent: SemrushBot
Crawl-delay: 10

# ============================================
# Sitemap 声明
# ============================================
Sitemap: https://notonlytranslator.cn/sitemap.xml

# 可选：站点地图索引（如有多语言或多类型）
# Sitemap: https://notonlytranslator.cn/sitemap-posts.xml
# Sitemap: https://notonlytranslator.cn/sitemap-pages.xml
# Sitemap: https://notonlytranslator.cn/sitemap-images.xml
```

### 1.2 百度特有配置说明

百度蜘蛛识别名:
| 爬虫名称 | User-Agent | 用途 |
|----------|------------|------|
| 百度网页搜索 | Baiduspider | 网页内容抓取 |
| 百度图片搜索 | Baiduspider-image | 图片内容抓取 |
| 百度视频搜索 | Baiduspider-video | 视频内容抓取 |
| 百度新闻搜索 | Baiduspider-news | 新闻内容抓取 |
| 百度移动搜索 | Baiduspider-mobile | 移动端内容 |

**百度 robots.txt 注意事项**:
1. 百度支持 `Crawl-delay` 指令
2. 百度支持 `Allow` 指令（Google 不识别，建议同时使用）
3. 百度对 `robots.txt` 缓存时间较长（建议更新后主动到站长平台提交）
4. 百度对大小写敏感（统一使用小写路径）

### 1.3 配置文件位置

```
# 部署位置
/var/www/notonlytranslator/html/robots.txt

# 权限设置
chmod 644 robots.txt
chown www-data:www-data robots.txt

# Nginx 配置（确保可访问）
location = /robots.txt {
    access_log off;
    log_not_found off;
}
```

### 1.4 验证方法

```bash
# 本地验证
curl -I https://notonlytranslator.cn/robots.txt

# 应该返回:
# HTTP/1.1 200 OK
# Content-Type: text/plain; charset=utf-8

# 内容验证
curl https://notonlytranslator.cn/robots.txt

# 百度站长平台验证
# 访问: https://ziyuan.baidu.com/robots/index
# 输入: https://notonlytranslator.cn/robots.txt
```

---

## 二、sitemap.xml 配置

### 2.1 基础 Sitemap 模板

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">

  <!-- 首页 -->
  <url>
    <loc>https://notonlytranslator.cn/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>

  <!-- 下载页 -->
  <url>
    <loc>https://notonlytranslator.cn/download/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>

  <!-- 功能介绍 -->
  <url>
    <loc>https://notonlytranslator.cn/features/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/features/smart-translate/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/features/vocabulary/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/features/statistics/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- 博客首页 -->
  <url>
    <loc>https://notonlytranslator.cn/blog/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>

  <!-- 博客文章（示例，实际需动态生成） -->
  <url>
    <loc>https://notonlytranslator.cn/blog/translation-plugin-recommendation-2026/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
    <image:image>
      <image:loc>https://notonlytranslator.cn/images/blog/plugin-compare.jpg</image:loc>
      <image:title>2026年Chrome翻译插件推荐</image:title>
    </image:image>
  </url>

  <!-- 竞品对比 -->
  <url>
    <loc>https://notonlytranslator.cn/compare/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/compare/immersive-translate/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>

  <!-- 帮助文档 -->
  <url>
    <loc>https://notonlytranslator.cn/help/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/help/install/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/help/api-config/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>

  <url>
    <loc>https://notonlytranslator.cn/help/faq/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>

  <!-- 关于我们 -->
  <url>
    <loc>https://notonlytranslator.cn/about/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>

  <!-- 隐私政策 -->
  <url>
    <loc>https://notonlytranslator.cn/privacy/</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>

</urlset>
```

### 2.2 百度支持的 Sitemap 特性

百度支持标准 Sitemap 协议，同时支持以下扩展:

| 元素 | 百度支持 | 说明 |
|------|----------|------|
| `<loc>` | ✅ | URL 位置（必需） |
| `<lastmod>` | ✅ | 最后修改时间 |
| `<changefreq>` | ✅ | 更新频率 |
| `<priority>` | ✅ | 优先级 (0.0-1.0) |
| `<image:image>` | ✅ | 图片扩展 |
| `<video:video>` | ⚠️ | 有限支持 |
| `<xhtml:link>` | ⚠️ | 多语言/移动适配 |

**百度 Sitemap 限制**:
- 单文件 URL 数: 不超过 50,000 个
- 单文件大小: 不超过 10MB (未压缩)
- 支持压缩: `.xml.gz` 格式
- 编码: 必须是 UTF-8

### 2.3 Sitemap 索引文件（大规模网站）

当 URL 数量超过 50,000 时，使用索引文件:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <sitemap>
    <loc>https://notonlytranslator.cn/sitemap-pages.xml</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
  </sitemap>

  <sitemap>
    <loc>https://notonlytranslator.cn/sitemap-posts.xml</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
  </sitemap>

  <sitemap>
    <loc>https://notonlytranslator.cn/sitemap-images.xml</loc>
    <lastmod>2026-03-16T00:00:00+08:00</lastmod>
  </sitemap>

</sitemapindex>
```

### 2.4 动态 Sitemap 生成脚本

**Node.js 生成脚本**:
```javascript
// scripts/generate-sitemap.js
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://notonlytranslator.cn';
const OUTPUT_PATH = path.join(__dirname, '../html/sitemap.xml');

// 页面配置
const pages = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/download/', priority: '0.9', changefreq: 'monthly' },
  { path: '/features/', priority: '0.8', changefreq: 'monthly' },
  { path: '/features/smart-translate/', priority: '0.7', changefreq: 'monthly' },
  { path: '/features/vocabulary/', priority: '0.7', changefreq: 'monthly' },
  { path: '/features/statistics/', priority: '0.7', changefreq: 'monthly' },
  { path: '/blog/', priority: '0.8', changefreq: 'daily' },
  { path: '/compare/', priority: '0.7', changefreq: 'monthly' },
  { path: '/compare/immersive-translate/', priority: '0.6', changefreq: 'monthly' },
  { path: '/help/', priority: '0.6', changefreq: 'weekly' },
  { path: '/help/install/', priority: '0.6', changefreq: 'monthly' },
  { path: '/help/api-config/', priority: '0.6', changefreq: 'monthly' },
  { path: '/help/faq/', priority: '0.6', changefreq: 'weekly' },
  { path: '/about/', priority: '0.5', changefreq: 'monthly' },
  { path: '/privacy/', priority: '0.4', changefreq: 'monthly' },
];

// 博客文章（从文件系统或数据库读取）
function getBlogPosts() {
  // TODO: 从 content/blog 目录读取
  return [
    {
      path: '/blog/translation-plugin-recommendation-2026/',
      lastmod: '2026-03-16',
      priority: '0.7'
    },
    {
      path: '/blog/kaoyan-english-reading-guide/',
      lastmod: '2026-03-16',
      priority: '0.7'
    },
    {
      path: '/blog/notonlytranslator-vs-immersive-translate/',
      lastmod: '2026-03-16',
      priority: '0.7'
    },
  ];
}

// 生成 XML
function generateSitemap() {
  const now = new Date().toISOString();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  // 静态页面
  pages.forEach(page => {
    xml += `  <url>\n`;
    xml += `    <loc>${BASE_URL}${page.path}</loc>\n`;
    xml += `    <lastmod>${now}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += `  </url>\n`;
  });

  // 博客文章
  const posts = getBlogPosts();
  posts.forEach(post => {
    xml += `  <url>\n`;
    xml += `    <loc>${BASE_URL}${post.path}</loc>\n`;
    xml += `    <lastmod>${post.lastmod}T00:00:00+08:00</lastmod>\n`;
    xml += `    <changefreq>monthly</changefreq>\n`;
    xml += `    <priority>${post.priority}</priority>\n`;
    xml += `  </url>\n`;
  });

  xml += `</urlset>\n`;

  return xml;
}

// 写入文件
const sitemap = generateSitemap();
fs.writeFileSync(OUTPUT_PATH, sitemap, 'utf8');
console.log(`Sitemap generated: ${OUTPUT_PATH}`);
console.log(`Total URLs: ${pages.length + getBlogPosts().length}`);
```

**package.json 脚本**:
```json
{
  "scripts": {
    "generate:sitemap": "node scripts/generate-sitemap.js"
  }
}
```

### 2.5 配置文件位置

```
# 部署位置
/var/www/notonlytranslator/html/sitemap.xml

# 权限设置
chmod 644 sitemap.xml
chown www-data:www-data sitemap.xml

# Nginx 配置
location = /sitemap.xml {
    access_log off;
    log_not_found off;
}
```

---

## 三、百度站长平台提交

### 3.1 手动提交

1. **登录百度站长平台**
   - URL: https://ziyuan.baidu.com/
   - 完成站点验证（HTML标签验证）

2. **提交 sitemap**
   - 进入：资源提交 → Sitemap 提交
   - 输入：`https://notonlytranslator.cn/sitemap.xml`
   - 点击提交

3. **提交 robots.txt**
   - 进入：网站分析 → robots
   - 检测 robots.txt 状态

### 3.2 自动推送（API）

**主动推送（实时）**:
```javascript
// utils/baidu-push.js
const axios = require('axios');

const BAIDU_PUSH_API = 'http://data.zz.baidu.com/urls';
const SITE = 'notonlytranslator.cn';
const TOKEN = process.env.BAIDU_PUSH_TOKEN; // 从站长平台获取

async function pushToBaidu(urls) {
  const url = `${BAIDU_PUSH_API}?site=${SITE}&token=${TOKEN}`;

  const data = urls.join('\n');

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'text/plain'
      }
    });

    console.log('Push result:', response.data);
    return response.data;
  } catch (error) {
    console.error('Push failed:', error.response?.data || error.message);
    throw error;
  }
}

// 推送新发布文章
async function pushNewPost(postUrl) {
  return pushToBaidu([postUrl]);
}

// 推送站点地图中的所有 URL
async function pushAllUrls() {
  // TODO: 读取 sitemap.xml 并解析所有 URL
  const urls = [
    'https://notonlytranslator.cn/',
    'https://notonlytranslator.cn/blog/...',
    // ...
  ];
  return pushToBaidu(urls);
}

module.exports = { pushToBaidu, pushNewPost, pushAllUrls };
```

**自动推送（JS）**:
```javascript
// 添加到所有页面底部
(function(){
    var bp = document.createElement('script');
    var curProtocol = window.location.protocol.split(':')[0];
    if (curProtocol === 'https') {
        bp.src = 'https://zz.bdstatic.com/linksubmit/push.js';
    } else {
        bp.src = 'http://push.zhanzhang.baidu.com/push.js';
    }
    var s = document.getElementsByTagName("script")[0];
    s.parentNode.insertBefore(bp, s);
})();
```

---

## 四、检查清单

### 4.1 robots.txt 检查
- [ ] 文件位于网站根目录
- [ ] 可通过 `https://domain/robots.txt` 访问
- [ ] 返回 HTTP 200
- [ ] 内容类型为 text/plain
- [ ] 包含 Baiduspider 专属规则
- [ ] 包含 Sitemap 声明
- [ ] 禁止目录正确配置
- [ ] 无语法错误

### 4.2 sitemap.xml 检查
- [ ] 文件可访问 (`https://domain/sitemap.xml`)
- [ ] XML 格式有效
- [ ] 编码为 UTF-8
- [ ] 所有 URL 使用绝对路径 (https://)
- [ ] URL 数量不超过 50,000
- [ ] 文件大小不超过 10MB
- [ ] lastmod 格式正确 (ISO 8601)
- [ ] priority 值在 0.0-1.0 范围内

### 4.3 百度站长平台检查
- [ ] 站点已验证
- [ ] sitemap 已提交
- [ ] robots.txt 已检测
- [ ] 主动推送代码已部署
- [ ] 自动推送 JS 已添加

---

## 五、验证工具

### 5.1 在线验证

| 工具 | URL | 用途 |
|------|-----|------|
| 百度站长平台 | ziyuan.baidu.com | 官方验证 |
| Google Search Console | search.google.com/search-console | 对比验证 |
| XML Sitemap 验证 | xml-sitemaps.com/validate-xml-sitemap.html | 格式检查 |
| robots.txt 测试 | google.com/webmasters/tools/robots-testing-tool | 规则测试 |

### 5.2 命令行验证

```bash
# 检查 robots.txt
curl -s https://notonlytranslator.cn/robots.txt

# 检查 sitemap
curl -s https://notonlytranslator.cn/sitemap.xml | head -50

# XML 格式验证
xmllint --noout sitemap.xml

# 检查 URL 数量
grep -c "<loc>" sitemap.xml
```

---

## 六、维护计划

| 任务 | 频率 | 负责人 | 说明 |
|------|------|--------|------|
| 更新 sitemap | 发布新内容时 | Dev | 运行生成脚本 |
| 重新提交 sitemap | 每月 | SEO | 站长平台手动提交 |
| 检查收录状态 | 每周 | SEO | 站长平台查看 |
| 修复抓取错误 | 发现问题时 | Dev | 查看站长平台报告 |

---

## 附录

### A. 相关文档
- [Baidu SEO 策略](../plans/baidu-seo-strategy.md)
- [域名与服务器部署规范](./cmp-55-domain-server-spec.md)

### B. 参考资料
- [Sitemap 协议](https://www.sitemaps.org/protocol.html)
- [百度站长平台文档](https://ziyuan.baidu.com/college/courseinfo?id=267&page=1#h2_article_title19)
- [robots.txt 规范](http://www.robotstxt.org/robotstxt.html)

---

*文档版本: v1.0 | 创建日期: 2026-03-16 | 维护者: SEO Specialist*
