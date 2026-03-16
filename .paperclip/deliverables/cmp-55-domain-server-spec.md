# CMP-55: 域名注册与香港服务器部署规范

## 任务信息

| 项目 | 内容 |
|------|------|
| 任务编号 | CMP-55 |
| 任务名称 | 【Baidu SEO Phase 1】域名注册与香港服务器部署 |
| 负责人 | Dev (技术团队) |
| 协作方 | SEO Specialist (策略指导) |
| 优先级 | High |
| 状态 | 待执行 |
| 预计工期 | 3-5 工作日 |

---

## 一、域名注册规范

### 1.1 域名选择策略

**首选域名**: `notonlytranslator.cn`

**备选方案**:
| 优先级 | 域名 | 说明 |
|--------|------|------|
| P0 | notonlytranslator.cn | 优先选择，符合百度偏好 |
| P1 | notonlytranslator.com.cn | 次选，中国商业域名 |
| P2 | notonlytranslator.net | 备选，如 cn 不可用 |
| P3 | notonlytranslator.org | 备选，非商业定位 |

### 1.2 域名注册要求

**注册商选择**:
- 阿里云 (万网): https://wanwang.aliyun.com
- 腾讯云 (DNSPod): https://dnspod.tencent.com
- 推荐：阿里云（备案支持更完善）

**注册信息**:
```
域名类型: .cn / .com.cn
注册年限: 建议 3 年（SEO 信任度）
实名认证: 必须完成
DNS 服务: 阿里云 DNS / 腾讯云 DNS
```

**DNS 配置**:
```
主 DNS: dns1.iidns.com
辅 DNS: dns2.iidns.com
TTL: 600（10分钟，便于快速切换）
```

### 1.3 域名解析预配置

**A 记录配置**:
```
主机记录    记录类型    记录值              TTL
@           A           [香港服务器IP]      600
www         A           [香港服务器IP]      600
blog        A           [香港服务器IP]      600
download    A           [香港服务器IP]      600
```

**CDN 配置（可选 Phase 2）**:
```
主机记录    记录类型    记录值
@           CNAME       [CDN域名]
www         CNAME       [CDN域名]
```

---

## 二、香港服务器部署规范

### 2.1 服务器选型

**推荐方案**:
| 服务商 | 配置 | 价格/月 | 备注 |
|--------|------|---------|------|
| 阿里云香港 | 2核4G 1M | ¥150-200 | 国内访问快，备案豁免 |
| 腾讯云香港 | 2核4G 2M | ¥120-180 | 性价比高 |
| AWS 香港 | t3.medium | $50-80 | 国际访问好 |
| Vultr 香港 | 2核4G | $20-30 | 经济实惠 |

**推荐**: 阿里云香港轻量应用服务器（性价比 + 国内访问速度）

### 2.2 服务器环境配置

**操作系统**: Ubuntu 22.04 LTS

**基础软件栈**:
```bash
# Web 服务器
nginx >= 1.18

# 运行时
Node.js >= 18.x

# 进程管理
pm2

# SSL
 certbot (Let's Encrypt)
```

**部署目录结构**:
```
/var/www/notonlytranslator/
├── html/                  # 静态网站文件
│   ├── index.html        # 首页
│   ├── download/         # 下载页
│   ├── blog/             # 博客
│   ├── features/         # 功能介绍
│   ├── compare/          # 竞品对比
│   ├── help/             # 帮助文档
│   ├── about/            # 关于我们
│   ├── privacy/          # 隐私政策
│   ├── robots.txt        # 爬虫规则
│   └── sitemap.xml       # 站点地图
├── logs/                 # 日志目录
└── config/               # 配置文件
    └── nginx.conf        # Nginx 配置
```

### 2.3 Nginx 配置模板

```nginx
# /etc/nginx/sites-available/notonlytranslator

server {
    listen 80;
    listen [::]:80;
    server_name notonlytranslator.cn www.notonlytranslator.cn;

    # 301 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name notonlytranslator.cn www.notonlytranslator.cn;

    root /var/www/notonlytranslator/html;
    index index.html;

    # SSL 配置
    ssl_certificate /etc/letsencrypt/live/notonlytranslator.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notonlytranslator.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # 缓存控制
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 安全响应头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 百度自动推送
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态文件
    location /static {
        alias /var/www/notonlytranslator/html/static;
        expires 1y;
    }

    # robots.txt 和 sitemap
    location = /robots.txt {
        access_log off;
        log_not_found off;
    }

    location = /sitemap.xml {
        access_log off;
        log_not_found off;
    }

    # 404 页面
    error_page 404 /404.html;
}

# 301 重定向：www → 非 www（SEO 统一）
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.notonlytranslator.cn;

    ssl_certificate /etc/letsencrypt/live/notonlytranslator.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notonlytranslator.cn/privkey.pem;

    return 301 https://notonlytranslator.cn$request_uri;
}
```

### 2.4 SSL 证书配置

**自动续期**:
```bash
# 安装 certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d notonlytranslator.cn -d www.notonlytranslator.cn

# 测试自动续期
sudo certbot renew --dry-run
```

**自动续期 Cron**:
```bash
# /etc/cron.d/certbot
0 0 * * * root certbot renew --quiet --nginx
```

---

## 三、网站基础页面

### 3.1 必须页面清单

| 页面 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| 首页 | /index.html | 产品落地页 | P0 |
| 下载页 | /download/ | Chrome 商店跳转 | P0 |
| 功能介绍 | /features/ | 产品功能说明 | P1 |
| 关于我们 | /about/ | 品牌介绍 | P1 |
| 隐私政策 | /privacy/ | 法律合规 | P0 |
| 404页 | /404.html | 错误处理 | P1 |

### 3.2 首页 SEO 要素

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <!-- SEO Meta -->
    <title>NotOnlyTranslator - 智能分级翻译插件，只翻译你不会的词</title>
    <meta name="description" content="NotOnlyTranslator 是一款智能Chrome翻译插件，根据你的英语水平只翻译超出当前级别的单词，帮助你在阅读中自然积累词汇。支持考研、四六级、程序员英语阅读。">
    <meta name="keywords" content="翻译插件,Chrome翻译插件,英语学习,智能翻译,背单词,考研英语">

    <!-- Open Graph -->
    <meta property="og:title" content="NotOnlyTranslator - 智能分级翻译插件">
    <meta property="og:description" content="只翻译你不会的词，在阅读中自然积累词汇">
    <meta property="og:image" content="https://notonlytranslator.cn/images/og-image.jpg">
    <meta property="og:url" content="https://notonlytranslator.cn">

    <!-- Baidu 验证（后续添加）-->
    <meta name="baidu-site-verification" content="[验证代码]">

    <!-- Canonical -->
    <link rel="canonical" href="https://notonlytranslator.cn/">

    <!-- Favicon -->
    <link rel="icon" href="/favicon.ico">
</head>
<body>
    <!-- 百度自动推送脚本 -->
    <script>
    (function(){
        var bp = document.createElement('script');
        bp.src = 'https://zz.bdstatic.com/linksubmit/push.js';
        var s = document.getElementsByTagName("script")[0];
        s.parentNode.insertBefore(bp, s);
    })();
    </script>
</body>
</html>
```

---

## 四、部署检查清单

### 4.1 域名检查
- [ ] 域名注册完成
- [ ] 实名认证通过
- [ ] DNS 解析生效
- [ ] whois 信息正确

### 4.2 服务器检查
- [ ] 服务器购买完成
- [ ] SSH 密钥配置
- [ ] 防火墙配置（仅开放 22, 80, 443）
- [ ] Nginx 安装完成
- [ ] SSL 证书配置完成

### 4.3 网站检查
- [ ] 首页可访问（HTTP + HTTPS）
- [ ] 301 重定向生效（www → 非 www）
- [ ] robots.txt 可访问
- [ ] sitemap.xml 可访问
- [ ] 404 页面正常
- [ ] 页面加载速度 < 3s

### 4.4 SEO 检查
- [ ] Title 标签正确
- [ ] Meta Description 正确
- [ ] Canonical URL 正确
- [ ] H1 标签唯一
- [ ] 图片有 alt 属性
- [ ] 内部链接正常

---

## 五、验收标准

| 检查项 | 标准 | 验证方法 |
|--------|------|----------|
| 域名解析 | 全球可解析 | dnschecker.org |
| HTTPS | 证书有效，A+ 评级 | ssllabs.com |
| 访问速度 | 国内 < 2s, 海外 < 3s | ping.chinaz.com |
| 移动友好 | 通过测试 | search.google.com/test/mobile-friendly |
| 百度抓取 | 无 403/404 错误 | 日志检查 |
| 重定向 | www 正确 301 到主域 | curl -I 测试 |

---

## 六、后续工作

部署完成后，需交接给 SEO Specialist 进行：

1. **百度站长平台验证**
   - 添加站点
   - HTML 标签验证
   - 提交 sitemap

2. **百度统计安装**
   - 创建统计站点
   - 部署追踪代码

3. **内容填充**
   - 首页内容优化
   - 博客文章发布

---

## 附录

### A. 常用命令

```bash
# 检查 DNS 解析
dig notonlytranslator.cn

# 检查证书
curl -vI https://notonlytranslator.cn

# 检查重定向
curl -I -L http://www.notonlytranslator.cn

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### B. 参考文档
- [Baidu SEO 策略](./baidu-seo-strategy.md)
- [robots.txt 配置规范](./cmp-56-robots-sitemap-spec.md)

---

*文档版本: v1.0 | 创建日期: 2026-03-16 | 维护者: SEO Specialist*
