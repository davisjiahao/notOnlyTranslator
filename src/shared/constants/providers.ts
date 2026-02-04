import type { ApiProvider, ProviderConfig, ModelInfo } from '../types';

/**
 * 供应商配置
 * 包含所有支持的 LLM API 供应商的配置信息
 */
export const PROVIDER_CONFIGS: Record<ApiProvider, ProviderConfig> = {
  // ========== 国外供应商 ==========
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: '使用 GPT 系列模型，速度快，效果好',
    region: 'international',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.openai.com',
    chatEndpoint: 'https://api.openai.com/v1/chat/completions',
    modelsEndpoint: 'https://api.openai.com/v1/models',
    modelsSupported: true,
    defaultModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: '快速、经济，适合日常翻译', isRecommended: true },
      { id: 'gpt-4o', name: 'GPT-4o', description: '最强大的多模态模型' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: '高性能，128K 上下文' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: '经济实惠的选择' },
    ],
    recommendedModel: 'gpt-4o-mini',
    docUrl: 'https://platform.openai.com/api-keys',
    apiKeyPlaceholder: 'sk-...',
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: '使用 Claude 系列模型，翻译质量高',
    region: 'international',
    apiFormat: 'anthropic',
    defaultEndpoint: 'https://api.anthropic.com',
    chatEndpoint: 'https://api.anthropic.com/v1/messages',
    modelsSupported: false, // Anthropic 不提供 models API
    defaultModels: [
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: '快速、经济，适合日常翻译', isRecommended: true },
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: '平衡性能和成本' },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', description: '最强大的 Claude 模型' },
    ],
    recommendedModel: 'claude-3-5-haiku-latest',
    authHeaderName: 'x-api-key',
    docUrl: 'https://console.anthropic.com/',
    apiKeyPlaceholder: 'sk-ant-...',
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    description: '使用 Google Gemini 模型，支持多模态',
    region: 'international',
    apiFormat: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    modelsSupported: true,
    defaultModels: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: '最新一代，快速高效', isRecommended: true },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: '快速、经济' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '高性能，100 万 token 上下文' },
    ],
    recommendedModel: 'gemini-2.0-flash',
    docUrl: 'https://aistudio.google.com/app/apikey',
    apiKeyPlaceholder: 'AIza...',
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    description: '超快推理速度，使用开源模型',
    region: 'international',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.groq.com/openai',
    chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    modelsSupported: true,
    defaultModels: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: '强大的开源模型', isRecommended: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: '快速、轻量' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'MoE 架构，高效' },
    ],
    recommendedModel: 'llama-3.3-70b-versatile',
    docUrl: 'https://console.groq.com/keys',
    apiKeyPlaceholder: 'gsk_...',
  },

  // ========== 国内供应商 ==========
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '国产大模型，性价比高，支持中文',
    region: 'domestic',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.deepseek.com',
    chatEndpoint: 'https://api.deepseek.com/chat/completions',
    modelsEndpoint: 'https://api.deepseek.com/models',
    modelsSupported: true,
    defaultModels: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话模型，适合翻译', isRecommended: true },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: '推理增强模型' },
    ],
    recommendedModel: 'deepseek-chat',
    docUrl: 'https://platform.deepseek.com/api_keys',
    apiKeyPlaceholder: 'sk-...',
  },

  zhipu: {
    id: 'zhipu',
    name: '智谱 AI',
    description: '清华系 AI，GLM 系列模型',
    region: 'domestic',
    apiFormat: 'openai',
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas',
    chatEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    modelsEndpoint: 'https://open.bigmodel.cn/api/paas/v4/models',
    modelsSupported: true,
    defaultModels: [
      { id: 'glm-4-flash', name: 'GLM-4 Flash', description: '快速、经济', isRecommended: true },
      { id: 'glm-4-plus', name: 'GLM-4 Plus', description: '高性能版本' },
      { id: 'glm-4', name: 'GLM-4', description: '标准版本' },
    ],
    recommendedModel: 'glm-4-flash',
    docUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiKeyPlaceholder: '...',
  },

  alibaba: {
    id: 'alibaba',
    name: '阿里通义',
    description: '阿里云通义千问模型',
    region: 'domestic',
    apiFormat: 'dashscope',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/api',
    chatEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    modelsEndpoint: 'https://dashscope.aliyuncs.com/api/v1/models',
    modelsSupported: true,
    defaultModels: [
      { id: 'qwen-turbo', name: '通义千问 Turbo', description: '快速、经济', isRecommended: true },
      { id: 'qwen-plus', name: '通义千问 Plus', description: '平衡性能和成本' },
      { id: 'qwen-max', name: '通义千问 Max', description: '最强性能' },
    ],
    recommendedModel: 'qwen-turbo',
    docUrl: 'https://dashscope.console.aliyun.com/apiKey',
    apiKeyPlaceholder: 'sk-...',
  },

  baidu: {
    id: 'baidu',
    name: '百度文心',
    description: '百度文心一言模型（需要 API Key + Secret Key）',
    region: 'domestic',
    apiFormat: 'baidu',
    defaultEndpoint: 'https://aip.baidubce.com',
    chatEndpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{model}',
    modelsSupported: false, // 百度需要 OAuth，不支持直接查询模型
    defaultModels: [
      { id: 'ernie-speed-128k', name: 'ERNIE Speed', description: '快速、经济', isRecommended: true },
      { id: 'ernie-lite-8k', name: 'ERNIE Lite', description: '轻量级模型' },
      { id: 'ernie-4.0-8k', name: 'ERNIE 4.0', description: '最强性能' },
    ],
    recommendedModel: 'ernie-speed-128k',
    docUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
    apiKeyPlaceholder: 'API Key',
  },

  // ========== 本地部署 ==========
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: '本地部署的 Ollama，支持 Llama、Qwen 等开源模型',
    region: 'international',
    apiFormat: 'ollama',
    defaultEndpoint: 'http://localhost:11434',
    chatEndpoint: 'http://localhost:11434/v1/chat/completions',  // 使用 OpenAI 兼容 API，避免 CORS 问题
    modelsEndpoint: 'http://localhost:11434/api/tags',  // 原生模型列表端点
    modelsSupported: true,
    defaultModels: [
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', description: '中文能力强，翻译质量高', isRecommended: true },
      { id: 'qwen2.5:3b', name: 'Qwen 2.5 3B', description: '轻量快速，适合低配置' },
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', description: '综合能力强' },
      { id: 'gemma2:9b', name: 'Gemma 2 9B', description: 'Google 出品，质量稳定' },
    ],
    recommendedModel: 'qwen2.5:7b',
    docUrl: 'https://ollama.ai/',
    apiKeyPlaceholder: '留空或任意值',
  },

  // ========== 自定义供应商 ==========
  custom: {
    id: 'custom',
    name: '自定义 API',
    description: '使用兼容 OpenAI 格式的自定义 API 端点',
    region: 'international',
    apiFormat: 'openai',
    defaultEndpoint: '',
    chatEndpoint: '',
    modelsEndpoint: '',
    modelsSupported: true, // 自定义 API 可能支持 /models 端点
    defaultModels: [
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: '默认模型' },
    ],
    recommendedModel: 'gpt-3.5-turbo',
    docUrl: '',
    apiKeyPlaceholder: '输入 API Key',
  },
};

/**
 * 供应商分组（用于 UI 展示）
 */
export interface ProviderGroup {
  label: string;
  providers: ApiProvider[];
}

export const PROVIDER_GROUPS: ProviderGroup[] = [
  {
    label: '国外供应商',
    providers: ['openai', 'anthropic', 'gemini', 'groq'],
  },
  {
    label: '国内供应商',
    providers: ['deepseek', 'zhipu', 'alibaba', 'baidu'],
  },
  {
    label: '本地部署',
    providers: ['ollama'],
  },
  {
    label: '自定义',
    providers: ['custom'],
  },
];

/**
 * 获取供应商配置
 */
export function getProviderConfig(provider: ApiProvider): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

/**
 * 获取供应商的推荐模型
 */
export function getRecommendedModel(provider: ApiProvider): ModelInfo {
  const config = PROVIDER_CONFIGS[provider];
  const recommended = config.defaultModels.find(m => m.isRecommended);
  return recommended || config.defaultModels[0];
}

/**
 * 判断供应商是否需要二次密钥（如百度）
 */
export function requiresSecondaryKey(provider: ApiProvider): boolean {
  return provider === 'baidu';
}

/**
 * 获取供应商的 Chat 端点
 * 某些供应商需要在 URL 中替换模型名
 */
export function getChatEndpoint(provider: ApiProvider, model: string, customUrl?: string): string {
  if (customUrl) {
    return customUrl;
  }

  const config = PROVIDER_CONFIGS[provider];

  // Gemini 需要在 URL 中替换模型名
  if (provider === 'gemini') {
    return config.chatEndpoint.replace('{model}', model);
  }

  // 百度需要在 URL 中替换模型名
  if (provider === 'baidu') {
    return config.chatEndpoint.replace('{model}', model);
  }

  return config.chatEndpoint;
}
