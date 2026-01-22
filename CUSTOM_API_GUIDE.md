# 自定义 API 使用指南 / Custom API Guide

[中文](#中文) | [English](#english)

---

## 中文

### 功能概述

NotOnlyTranslator 现在支持自定义 API 端点，您可以：

1. **使用自定义 LLM 服务**：连接到任何兼容 OpenAI 格式的 API
2. **覆盖默认端点**：为 OpenAI/Anthropic 使用自定义 URL（如 API 代理）
3. **指定模型名称**：使用特定的模型版本

### 使用场景

- 🏠 **本地部署模型**：如 LM Studio、Ollama、vLLM
- 🌐 **第三方API服务**：如国内的 API 服务商
- 🚀 **API 代理**：通过代理访问 OpenAI/Anthropic
- 🔧 **自建服务**：自己搭建的 LLM 服务

### 配置步骤

#### 1. 打开设置页面
点击插件图标 → 设置图标 → API 设置

#### 2. 选择 API 类型

**选项 A - 自定义 API**：
1. 选择"自定义 API"
2. 输入 API 端点 URL
3. 输入模型名称（可选）
4. 输入 API 密钥
5. 点击"测试密钥"验证连接
6. 点击"保存设置"

**选项 B - 覆盖默认 API**：
1. 选择 OpenAI 或 Anthropic
2. 点击"+ 自定义 API 端点"
3. 输入自定义 URL
4. （可选）修改模型名称
5. 输入 API 密钥
6. 测试并保存

### API 格式要求

自定义 API 必须兼容 OpenAI 的请求/响应格式：

#### 请求格式
```json
{
  "model": "your-model-name",
  "messages": [
    {
      "role": "system",
      "content": "You are an English learning assistant..."
    },
    {
      "role": "user",
      "content": "请求内容..."
    }
  ],
  "temperature": 0.3,
  "response_format": { "type": "json_object" }
}
```

#### 响应格式
```json
{
  "choices": [
    {
      "message": {
        "content": "响应内容..."
      }
    }
  ]
}
```

或者 Anthropic 格式：
```json
{
  "content": [
    {
      "text": "响应内容..."
    }
  ]
}
```

### 常见配置示例

#### LM Studio（本地）
```
API URL: http://localhost:1234/v1/chat/completions
模型名称: local-model
API Key: 任意字符串（LM Studio 不验证）
```

#### Ollama（本地）
需要使用 Ollama 的 OpenAI 兼容层：
```
API URL: http://localhost:11434/v1/chat/completions
模型名称: llama2
API Key: ollama
```

#### OpenAI 代理
```
API URL: https://your-proxy.com/v1/chat/completions
模型名称: gpt-4o-mini（或其他）
API Key: 您的 OpenAI API 密钥
```

### 权限说明

使用自定义 API 时，浏览器可能会提示授予额外的网络访问权限。这是正常的，因为扩展需要访问您指定的自定义域名。

您可以：
- 点击允许以使用该域名
- 或在 `chrome://extensions/` 中手动管理权限

### 故障排查

#### 连接失败
1. 检查 API URL 是否正确
2. 确认服务是否正在运行（对于本地服务）
3. 检查防火墙设置
4. 查看浏览器控制台（F12）的错误信息

#### 响应格式错误
1. 确认 API 返回的格式兼容 OpenAI
2. 检查模型是否支持 JSON 输出
3. 尝试在 API 服务器端添加格式转换

#### 翻译质量问题
1. 尝试不同的模型
2. 检查模型是否支持中文
3. 调整温度参数（如果 API 支持）

### 安全建议

- ✅ 本地模型：最安全，数据不离开本地
- ✅ 自建服务：需要确保服务器安全
- ⚠️ 第三方服务：注意数据隐私政策
- ⚠️ 公共代理：避免使用不可信的代理

---

## English

### Feature Overview

NotOnlyTranslator now supports custom API endpoints, allowing you to:

1. **Use custom LLM services**: Connect to any OpenAI-compatible API
2. **Override default endpoints**: Use custom URLs for OpenAI/Anthropic (e.g., API proxies)
3. **Specify model names**: Use specific model versions

### Use Cases

- 🏠 **Local models**: LM Studio, Ollama, vLLM
- 🌐 **Third-party services**: Alternative API providers
- 🚀 **API proxies**: Access OpenAI/Anthropic through proxies
- 🔧 **Self-hosted**: Your own LLM deployment

### Configuration Steps

#### 1. Open Settings
Click extension icon → Settings icon → API Settings

#### 2. Choose API Type

**Option A - Custom API**:
1. Select "Custom API"
2. Enter API endpoint URL
3. Enter model name (optional)
4. Enter API key
5. Click "Test Key" to verify
6. Click "Save Settings"

**Option B - Override Default**:
1. Select OpenAI or Anthropic
2. Click "+ Custom API Endpoint"
3. Enter custom URL
4. (Optional) Change model name
5. Enter API key
6. Test and save

### API Format Requirements

Custom APIs must be compatible with OpenAI's request/response format:

#### Request Format
```json
{
  "model": "your-model-name",
  "messages": [
    {
      "role": "system",
      "content": "You are an English learning assistant..."
    },
    {
      "role": "user",
      "content": "Request content..."
    }
  ],
  "temperature": 0.3,
  "response_format": { "type": "json_object" }
}
```

#### Response Format
```json
{
  "choices": [
    {
      "message": {
        "content": "Response content..."
      }
    }
  ]
}
```

Or Anthropic format:
```json
{
  "content": [
    {
      "text": "Response content..."
    }
  ]
}
```

### Configuration Examples

#### LM Studio (Local)
```
API URL: http://localhost:1234/v1/chat/completions
Model Name: local-model
API Key: any-string (LM Studio doesn't validate)
```

#### Ollama (Local)
Requires Ollama's OpenAI compatibility layer:
```
API URL: http://localhost:11434/v1/chat/completions
Model Name: llama2
API Key: ollama
```

#### OpenAI Proxy
```
API URL: https://your-proxy.com/v1/chat/completions
Model Name: gpt-4o-mini (or others)
API Key: Your OpenAI API key
```

### Permissions

When using custom APIs, the browser may prompt for additional network access permissions. This is normal as the extension needs to access your custom domain.

You can:
- Click allow to use that domain
- Or manually manage permissions in `chrome://extensions/`

### Troubleshooting

#### Connection Failed
1. Verify API URL is correct
2. Ensure service is running (for local services)
3. Check firewall settings
4. Check browser console (F12) for errors

#### Format Error
1. Confirm API returns OpenAI-compatible format
2. Check if model supports JSON output
3. Try adding format conversion on API server

#### Translation Quality Issues
1. Try different models
2. Check if model supports Chinese
3. Adjust temperature parameter (if supported)

### Security Tips

- ✅ Local models: Most secure, data stays local
- ✅ Self-hosted: Ensure server security
- ⚠️ Third-party: Check privacy policy
- ⚠️ Public proxies: Avoid untrusted proxies

---

## Support

如有问题，请访问：
For support, visit:

- GitHub Issues: https://github.com/yourusername/notOnlyTranslator/issues
- Documentation: https://github.com/yourusername/notOnlyTranslator
