import type { ApiProvider, ModelInfo } from '../types';
import { getProviderConfig, requiresSecondaryKey } from '../constants/providers';

/**
 * 模型服务
 * 负责获取模型列表和测试 API 连接
 */

/**
 * 获取模型列表
 * 对于支持 /models API 的供应商，会实时查询；否则返回预定义列表
 */
export async function getModels(
  provider: ApiProvider,
  apiKey: string,
  customEndpoint?: string,
  secondaryKey?: string
): Promise<ModelInfo[]> {
  const config = getProviderConfig(provider);

  // 如果不支持模型查询，返回预定义列表
  if (!config.modelsSupported) {
    return config.defaultModels;
  }

  // 自定义供应商没有配置端点时，返回预定义列表
  if (provider === 'custom' && !customEndpoint) {
    return config.defaultModels;
  }

  try {
    const models = await fetchModels(provider, apiKey, customEndpoint, secondaryKey);
    return models.length > 0 ? models : config.defaultModels;
  } catch (error) {
    console.warn(`获取 ${config.name} 模型列表失败，使用预定义列表:`, error);
    return config.defaultModels;
  }
}

/**
 * 从 API 获取模型列表
 */
async function fetchModels(
  provider: ApiProvider,
  apiKey: string,
  customEndpoint?: string,
  _secondaryKey?: string
): Promise<ModelInfo[]> {
  const config = getProviderConfig(provider);

  // 构建模型查询端点
  let modelsUrl: string;
  if (provider === 'custom' && customEndpoint) {
    // 自定义 API：尝试从 chat 端点推断 models 端点
    const baseUrl = customEndpoint.replace(/\/chat\/completions$/, '').replace(/\/v1$/, '');
    modelsUrl = `${baseUrl}/v1/models`;
  } else {
    modelsUrl = config.modelsEndpoint || '';
  }

  if (!modelsUrl) {
    return [];
  }

  // 构建请求头
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // 根据供应商设置认证头
  switch (provider) {
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    case 'gemini':
      // Gemini 使用 URL 参数传递 API Key
      modelsUrl = `${modelsUrl}?key=${apiKey}`;
      break;
    default:
      // OpenAI 格式的供应商使用 Bearer token
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
  }

  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`获取模型列表失败: ${response.status}`);
  }

  const data = await response.json();
  return parseModelsResponse(provider, data);
}

/**
 * 解析模型列表响应
 */
function parseModelsResponse(provider: ApiProvider, data: unknown): ModelInfo[] {
  const config = getProviderConfig(provider);

  // Gemini 格式
  if (provider === 'gemini') {
    const geminiData = data as { models?: Array<{ name: string; displayName?: string; description?: string }> };
    if (!geminiData.models) return [];

    return geminiData.models
      .filter(m => m.name.includes('gemini'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', ''),
        description: m.description,
        isRecommended: m.name.includes(config.recommendedModel),
      }));
  }

  // OpenAI 兼容格式（包括 OpenAI、Groq、DeepSeek、智谱、阿里通义等）
  const openaiData = data as { data?: Array<{ id: string; name?: string }> };
  if (!openaiData.data) return [];

  return openaiData.data
    .filter(m => {
      // 过滤掉非 chat 模型
      const id = m.id.toLowerCase();
      return !id.includes('embedding') &&
             !id.includes('whisper') &&
             !id.includes('tts') &&
             !id.includes('dall-e') &&
             !id.includes('moderation');
    })
    .map(m => ({
      id: m.id,
      name: m.name || m.id,
      isRecommended: m.id === config.recommendedModel,
    }))
    .slice(0, 20); // 限制返回数量
}

/**
 * 测试 API 连接
 */
export async function testConnection(
  provider: ApiProvider,
  apiKey: string,
  model?: string,
  customEndpoint?: string,
  secondaryKey?: string
): Promise<{ success: boolean; error?: string }> {
  const config = getProviderConfig(provider);

  // 检查必要参数
  if (!apiKey) {
    return { success: false, error: '请输入 API Key' };
  }

  if (requiresSecondaryKey(provider) && !secondaryKey) {
    return { success: false, error: '百度文心需要同时提供 API Key 和 Secret Key' };
  }

  if (provider === 'custom' && !customEndpoint) {
    return { success: false, error: '自定义供应商需要提供 API 端点' };
  }

  try {
    // 对于百度，需要先获取 access token
    if (provider === 'baidu') {
      return await testBaiduConnection(apiKey, secondaryKey!, model || config.recommendedModel);
    }

    // 其他供应商直接调用 chat API 测试
    return await testChatAPI(provider, apiKey, model || config.recommendedModel, customEndpoint);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '连接测试失败',
    };
  }
}

/**
 * 测试 Chat API 连接
 */
async function testChatAPI(
  provider: ApiProvider,
  apiKey: string,
  model: string,
  customEndpoint?: string
): Promise<{ success: boolean; error?: string }> {
  const config = getProviderConfig(provider);

  // 构建请求 URL
  let chatUrl: string;
  if (customEndpoint) {
    chatUrl = customEndpoint;
  } else if (provider === 'gemini') {
    chatUrl = config.chatEndpoint.replace('{model}', model);
  } else {
    chatUrl = config.chatEndpoint;
  }

  // 构建请求头
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // 构建请求体
  let body: string;

  switch (provider) {
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      break;

    case 'gemini':
      // Gemini 使用 URL 参数传递 API Key
      chatUrl = `${chatUrl}?key=${apiKey}`;
      body = JSON.stringify({
        contents: [{ parts: [{ text: 'test' }] }],
        generationConfig: { maxOutputTokens: 10 },
      });
      break;

    case 'alibaba':
      // 阿里通义使用 DashScope 格式，但兼容 OpenAI 格式
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      });
      break;

    default:
      // OpenAI 兼容格式
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      });
      break;
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = (errorData as { error?: { message?: string } }).error?.message ||
                        `API 请求失败 (${response.status})`;
    return { success: false, error: errorMessage };
  }

  return { success: true };
}

/**
 * 测试百度文心连接
 * 百度需要先用 API Key + Secret Key 获取 access token
 */
async function testBaiduConnection(
  apiKey: string,
  secretKey: string,
  model: string
): Promise<{ success: boolean; error?: string }> {
  // 获取 access token
  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;

  const tokenResponse = await fetch(tokenUrl, { method: 'POST' });
  if (!tokenResponse.ok) {
    return { success: false, error: '获取百度 access token 失败，请检查 API Key 和 Secret Key' };
  }

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return { success: false, error: tokenData.error || '获取 access token 失败' };
  }

  // 使用 access token 测试 chat API
  const chatUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${tokenData.access_token}`;

  const chatResponse = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'test' }],
    }),
  });

  if (!chatResponse.ok) {
    const errorData = await chatResponse.json().catch(() => ({}));
    return {
      success: false,
      error: (errorData as { error_msg?: string }).error_msg || `百度 API 请求失败 (${chatResponse.status})`,
    };
  }

  return { success: true };
}
