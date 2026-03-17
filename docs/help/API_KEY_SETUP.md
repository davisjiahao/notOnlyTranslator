# API Key 设置教程

本教程将详细指导您如何获取和配置 NotOnlyTranslator 所需的 API 密钥。

## 📋 目录

1. [什么是 API 密钥](#什么是-api-密钥)
2. [OpenAI API 密钥获取](#openai-api-密钥获取)
3. [Anthropic API 密钥获取](#anthropic-api-密钥获取)
4. [自定义 API 端点](#自定义-api-端点)
5. [在扩展中配置](#在扩展中配置)
6. [常见问题](#常见问题)

---

## 什么是 API 密钥

API 密钥是一串用于身份验证的代码，用于：
- 验证您的身份
- 追踪 API 使用量
- 计费（按使用量付费）

**重要说明**：
- API 密钥仅存储在您的本地浏览器中
- 我们不会也无法访问您的密钥
- 请勿与他人分享您的 API 密钥

---

## OpenAI API 密钥获取

### 步骤 1：注册 OpenAI 账号

1. 访问 [OpenAI 平台](https://platform.openai.com/)
2. 点击 "Sign up" 注册新账号，或使用 Google/Microsoft 账号登录
3. 完成邮箱验证

### 步骤 2：绑定支付方式（可选）

**新用户福利**：
- 新注册用户通常可获得 **$5 免费额度**
- 免费额度有效期为 3 个月

**如需继续使用**：
1. 登录后点击右上角头像 → "Billing"
2. 点击 "Add payment method"
3. 添加信用卡或借记卡信息

### 步骤 3：创建 API 密钥

1. 点击左侧菜单 "API keys"
2. 点击 "Create new secret key" 按钮
   ![创建密钥按钮位置]
3. 输入密钥名称（如 "NotOnlyTranslator"）
4. 选择权限（建议选择 "All"）
5. 点击 "Create secret key"
6. **立即复制密钥**（关闭后将无法再次查看）
   ```
   sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### 步骤 4：验证密钥

1. 在命令行中测试（可选）：
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer 您的API密钥"
   ```
2. 如果返回模型列表，说明密钥有效

### OpenAI 定价参考

| 模型 | 输入费用 | 输出费用 |
|------|---------|---------|
| GPT-4o-mini | $0.15 / 1M tokens | $0.60 / 1M tokens |
| GPT-4o | $2.50 / 1M tokens | $10.00 / 1M tokens |

**估算**：翻译一个单词约 100-200 tokens，即 **¥0.001-0.002/次**

---

## Anthropic API 密钥获取

### 步骤 1：注册 Anthropic 账号

1. 访问 [Anthropic Console](https://console.anthropic.com/)
2. 点击 "Sign up" 注册账号
3. 验证邮箱地址

### 步骤 2：获取 API 密钥

1. 登录后点击右上角 "Get API keys"
2. 或直接访问 [API Keys 页面](https://console.anthropic.com/settings/keys)
3. 点击 "Create Key"
4. 输入密钥名称（如 "NotOnlyTranslator"）
5. 点击 "Create"
6. **立即复制密钥**（关闭后不可再次查看）
   ```
   sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### 步骤 3：充值（可选）

**新用户福利**：
- 新账号可获得 **$5 免费额度**

**充值步骤**：
1. 进入 [Billing 页面](https://console.anthropic.com/settings/billing)
2. 点击 "Add credits"
3. 选择金额并支付

### Anthropic 定价参考

| 模型 | 输入费用 | 输出费用 |
|------|---------|---------|
| Claude 3 Haiku | $0.25 / 1M tokens | $1.25 / 1M tokens |
| Claude 3 Sonnet | $3.00 / 1M tokens | $15.00 / 1M tokens |

**估算**：翻译一个单词约 **¥0.001-0.003/次**

---

## 自定义 API 端点

如果您有自己的 OpenAI 兼容 API 端点，可以按以下步骤配置：

### 支持的 API 格式

NotOnlyTranslator 支持任何 OpenAI API 兼容的服务，包括：
- Azure OpenAI
- 本地部署的模型（如 Ollama）
- 第三方 API 代理

### 配置步骤

1. 在扩展设置中选择 "自定义"
2. 填写以下信息：
   - **API 端点**: 完整的 API URL（如 `https://api.example.com/v1/chat/completions`）
   - **API 密钥**: 您的服务提供的密钥
   - **模型名称**: 使用的模型标识符

### 示例配置

**Azure OpenAI**：
```
API 端点: https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2024-02-01
API 密钥: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
模型名称: gpt-4o-mini
```

**本地 Ollama**：
```
API 端点: http://localhost:11434/v1/chat/completions
API 密钥: ollama（任意值）
模型名称: llama2
```

---

## 在扩展中配置

### 步骤 1：打开扩展设置

1. 点击 Chrome 工具栏上的 NotOnlyTranslator 图标
2. 点击 "选项" 进入设置页面

### 步骤 2：选择翻译提供商

1. 找到 "翻译提供商" 下拉菜单
2. 选择：
   - **OpenAI**（推荐）
   - **Anthropic**
   - **自定义**

### 步骤 3：输入 API 密钥

1. 在对应的输入框中粘贴您的 API 密钥
2. 确保密钥完整，没有多余空格

### 步骤 4：选择模型（可选）

1. OpenAI 默认使用 **GPT-4o-mini**
2. Anthropic 默认使用 **Claude 3 Haiku**
3. 如需切换模型，在高级设置中选择

### 步骤 5：保存并测试

1. 点击 "保存设置"
2. 访问一个英文网站测试翻译功能
3. 如果看到翻译结果，说明配置成功！

---

## 常见问题

### Q: 应该选择哪个服务商？

**A:** 推荐度对比：

| 服务商 | 推荐度 | 原因 |
|--------|--------|------|
| OpenAI | ⭐⭐⭐⭐⭐ | 速度快、价格低、模型稳定 |
| Anthropic | ⭐⭐⭐⭐ | 翻译质量好，但价格稍高 |
| 自定义 | ⭐⭐⭐ | 适合有特定需求的用户 |

**建议**：新手首选 OpenAI GPT-4o-mini，性价比最高。

### Q: API 密钥泄露了怎么办？

**A:**
1. **立即删除旧密钥**：
   - OpenAI: API Keys 页面 → 找到密钥 → 点击删除
   - Anthropic: API Keys 页面 → 点击 Revoke
2. **创建新密钥**
3. **在扩展中更新**

### Q: 如何查看 API 使用量和费用？

**A:**

**OpenAI**：
1. 访问 [Usage 页面](https://platform.openai.com/usage)
2. 查看每日使用量和费用

**Anthropic**：
1. 访问 Console → Billing
2. 查看使用统计

### Q: 免费额度用完了怎么办？

**A:**
1. 绑定支付方式充值
2. 或切换到另一个服务商（如从 OpenAI 切换到 Anthropic）
3. 或使用自定义端点

### Q: 提示 "API 调用失败"？

**A:** 检查以下问题：

| 错误信息 | 可能原因 | 解决方法 |
|---------|---------|---------|
| Invalid API key | 密钥错误或过期 | 重新复制完整密钥 |
| Insufficient quota | 余额不足 | 检查账户余额并充值 |
| Rate limit exceeded | 请求过于频繁 | 稍后再试 |
| Model not found | 模型不可用 | 切换为默认模型 |

### Q: 可以多人共用一个 API 密钥吗？

**A:** 技术上可以，但不建议：
- 共享密钥无法追踪各自使用量
- 一人泄露密钥影响所有人
- 建议每个人使用自己的密钥

### Q: API 调用会消耗多少流量？

**A:** 极少：
- 每次翻译请求约 1-3 KB
- 相当于加载一张小图片的千分之一
- 对网络流量几乎无影响

---

## 💡 成本优化建议

### 1. 利用缓存

扩展会自动缓存翻译结果，重复的单词不会重复调用 API。

### 2. 合理设置英语水平

较高的英语水平设置会减少需要翻译的单词数量，降低 API 调用次数。

### 3. 标记已掌握单词

及时标记已掌握的单词，避免重复翻译。

### 4. 预估费用

| 使用场景 | 每日翻译量 | 预估费用/月 |
|---------|-----------|------------|
| 轻度使用 | 50 词/天 | ¥3-5 |
| 中度使用 | 200 词/天 | ¥15-20 |
| 重度使用 | 500 词/天 | ¥40-50 |

---

## 📞 获取帮助

如果在配置过程中遇到问题：

1. 查看 [FAQ](./FAQ.md)
2. 提交 GitHub Issue: https://github.com/hungrywu/NotOnlyTranslator/issues
3. 检查服务商官方文档：
   - [OpenAI 文档](https://platform.openai.com/docs)
   - [Anthropic 文档](https://docs.anthropic.com/)

---

**现在就去配置您的 API 密钥，开始智能学习之旅吧！** 🚀
