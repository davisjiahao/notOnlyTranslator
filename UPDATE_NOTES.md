# 更新说明 / Update Notes

## 新增功能：自定义 API 支持 / New Feature: Custom API Support

### 概述 / Overview

现在支持使用自定义 API 端点进行翻译，包括：
- 本地部署的模型（LM Studio、Ollama 等）
- 第三方 API 服务商
- API 代理服务
- 自建 LLM 服务

Now supports custom API endpoints for translation, including:
- Locally deployed models (LM Studio, Ollama, etc.)
- Third-party API providers
- API proxy services
- Self-hosted LLM services

### 主要变更 / Key Changes

#### 1. 类型定义更新 / Type Definition Updates
- `UserSettings` 新增 `customApiUrl` 和 `customModelName` 字段
- `apiProvider` 类型扩展，新增 `'custom'` 选项

#### 2. API 服务增强 / API Service Enhancements
- `TranslationService` 支持自定义 API 端点
- 自动检测响应格式（OpenAI 或 Anthropic 格式）
- 支持为 OpenAI/Anthropic 覆盖默认 URL（用于代理）

#### 3. UI 更新 / UI Updates
- API 设置页面新增自定义 API 选项
- 支持输入自定义 URL 和模型名称
- 改进的 API 密钥测试功能

#### 4. 权限更新 / Permission Updates
- manifest.json 添加 `optional_host_permissions`
- 支持访问自定义域名

### 使用方法 / Usage

详细使用说明请参考：
For detailed instructions, see:

**[自定义 API 使用指南 / Custom API Guide](CUSTOM_API_GUIDE.md)**

### 兼容性 / Compatibility

- ✅ 向后兼容：现有配置无需更改
- ✅ OpenAI 和 Anthropic API 保持不变
- ✅ 所有现有功能正常工作

- ✅ Backward compatible: Existing configurations work without changes
- ✅ OpenAI and Anthropic APIs remain unchanged
- ✅ All existing features work normally

### 快速示例 / Quick Examples

#### LM Studio（本地）
```
API URL: http://localhost:1234/v1/chat/completions
Model: local-model
API Key: not-required
```

#### Ollama（本地）
```
API URL: http://localhost:11434/v1/chat/completions
Model: llama2
API Key: ollama
```

#### OpenAI 代理 / OpenAI Proxy
```
API URL: https://your-proxy.com/v1/chat/completions
Model: gpt-4o-mini
API Key: your-openai-key
```

### 注意事项 / Notes

1. **格式要求**: 自定义 API 必须兼容 OpenAI 的请求/响应格式
2. **权限**: 使用自定义域名时可能需要授予额外权限
3. **安全**: 本地模型最安全，使用第三方服务时注意隐私政策

1. **Format**: Custom APIs must be OpenAI-compatible
2. **Permissions**: May need to grant additional permissions for custom domains
3. **Security**: Local models are most secure; check privacy policies for third-party services

### 反馈 / Feedback

如有问题或建议，请通过 GitHub Issues 反馈。
For issues or suggestions, please use GitHub Issues.

---

**版本 / Version**: 0.1.0+
**更新日期 / Update Date**: 2024-01-21
