import type { TranslationResult, UserProfile, UserSettings } from '@/shared/types';
import { buildVocabOnlyPrompt } from '@/shared/prompts';
import { getCEFRLevelByVocabulary } from '@/shared/constants/mastery';
import { extractJsonFromResponse } from '@/shared/utils';
import { enhancedCache } from './enhancedCache';
import { buildLocalTranslationResult, resolveLocalCandidates } from './localWordLookup';
import { TranslationApiService, type TranslationApiRequestOptions } from './translationApi';

interface RecoveryParagraph {
  text: string;
  context?: string;
}

type Resolution = ReturnType<typeof resolveLocalCandidates>;
type WordSense = { original: string; translation: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 只接受非空字符串词义；非法条目不能被过滤成看似合法的空选择。 */
function parseWords(words: unknown[]): WordSense[] {
  return words.map(word => {
    if (!isRecord(word) || typeof word.original !== 'string' || typeof word.translation !== 'string'
      || !word.original.trim() || !word.translation.trim()) throw new Error();
    return { original: word.original.trim(), translation: word.translation.trim() };
  });
}

/** 批量恢复必须完整回传唯一标记，不按数组位置猜测段落归属。 */
function parseResponse(content: string, count: number, isBatch: boolean): WordSense[][] {
  try {
    const parsed: unknown = JSON.parse(extractJsonFromResponse(content) || '');
    if (!isRecord(parsed)) throw new Error();
    if (!isBatch) {
      if (!Array.isArray(parsed.words)) throw new Error();
      return [parseWords(parsed.words)];
    }
    if (!Array.isArray(parsed.paragraphs) || parsed.paragraphs.length !== count) throw new Error();
    const paragraphs = parsed.paragraphs;
    const ids = Array.from({ length: count }, (_, index) => `PARA_${index}`);
    if (paragraphs.some(paragraph => !isRecord(paragraph)
      || typeof paragraph.id !== 'string' || !ids.includes(paragraph.id)
      || !Array.isArray(paragraph.words))) throw new Error();
    const byId = new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.words as unknown[]]));
    if (byId.size !== count) throw new Error();
    return ids.map(id => parseWords(byId.get(id)!));
  } catch {
    // 不回显模型正文或 JSON 解析异常，避免泄露页面内容。
    throw new Error('词汇恢复响应无效');
  }
}

function mergeSenses(text: string, resolution: Resolution, senses: WordSense[]): TranslationResult {
  // 必须匹配本地已验证位置对应的原样词，不能把模型额外生成的标点或词形归一化后接纳。
  const byOriginal = new Map(senses.map(sense => [sense.original, sense.translation]));
  const selectingLevel = resolution.candidates.some(candidate => candidate.requiresLevelAssessment);
  const candidates = resolution.candidates.flatMap(candidate => {
    const translation = byOriginal.get(candidate.original);
    if (candidate.requiresLevelAssessment) {
      return translation ? [{ ...candidate, translation, requiresLevelAssessment: false, source: 'sense_cache' as const }] : [];
    }
    if (candidate.translation || !translation) return [candidate];
    return [{ ...candidate, translation, source: 'sense_cache' as const }];
  });
  const result = buildLocalTranslationResult(text, candidates);
  if (resolution.needsContext.length > 0 && result.words.length === 0
    && (!selectingLevel || senses.length > 0)) {
    throw new Error('模型未返回有效的语境释义，请重试');
  }
  return selectingLevel || resolution.needsContext.some(candidate => byOriginal.has(candidate.original))
    ? { ...result, _source: 'llm' }
    : result;
}

function resolveRecoveryParagraph(paragraph: RecoveryParagraph, userLevel: UserProfile, cacheScope: string): Resolution {
  const { text, context } = paragraph;
  const options = { context: context ? `${text}\n${context}` : text, cacheScope };
  const resolution = resolveLocalCandidates(text, userLevel, options);
  // 明确的生词或超纲候选仍沿用本地释义；只复核启发式判定的零候选。
  return resolution.candidates.length > 0 ? resolution
    : resolveLocalCandidates(text, userLevel, { ...options, reassessUncertain: true });
}

function buildBatchPrompt(paragraphs: RecoveryParagraph[], resolutions: Resolution[]) {
  return {
    systemPrompt: '你是英语词汇释义助手。只翻译每段 candidates 中的候选词，不得添加其他词或跨段使用词义。'
      + '每词仅输出一个简短中文义项，禁止整句翻译、禁止解释。不要输出位置、难度、全文或语法分析。'
      + '必须完整回传所有段落ID，各ID仅一次；没有候选词的段落返回空words数组。'
      + '只输出JSON：{"paragraphs":[{"id":"PARA_0","words":[{"original":"候选词原样","translation":"简短中文义项"}]}]}',
    userPrompt: JSON.stringify({ paragraphs: paragraphs.map((paragraph, index) => ({
      id: `PARA_${index}`,
      sentence: paragraph.text,
      ...(paragraph.context ? { context: paragraph.context } : {}),
      ...(resolutions[index].candidates.some(candidate => candidate.requiresLevelAssessment) ? { selectAboveLevel: true } : {}),
      candidates: resolutions[index].needsContext.map(candidate => candidate.original),
    })) }),
  };
}

/** 输出耗尽后只恢复词汇，不写分析缓存或词义缓存；整批最多追加一次请求。 */
export async function recoverInlineVocabulary(
  paragraphs: RecoveryParagraph[],
  userLevel: UserProfile,
  settings: UserSettings,
  apiKey: string,
  options?: TranslationApiRequestOptions,
  isBatch = false
): Promise<{ results: TranslationResult[]; apiCallCount: number }> {
  options?.signal?.throwIfAborted();
  const cacheScope = enhancedCache.generateHash('', 'inline-only', { settings, userLevel, engine: 'llm' });
  const resolutions = paragraphs.map(paragraph => resolveRecoveryParagraph(paragraph, userLevel, cacheScope));
  if (resolutions.every(resolution => resolution.needsContext.length === 0)) {
    return { results: resolutions.map(resolution => resolution.result), apiCallCount: 0 };
  }
  const { systemPrompt, userPrompt } = isBatch
    ? buildBatchPrompt(paragraphs, resolutions)
    : buildVocabOnlyPrompt({ sentence: paragraphs[0].text, context: paragraphs[0].context,
      candidates: resolutions[0].needsContext.map(candidate => candidate.original) });
  const selectingLevel = resolutions.some(resolution => resolution.candidates.some(candidate => candidate.requiresLevelAssessment));
  const selectionInstruction = selectingLevel
    ? `\n用户水平为 ${getCEFRLevelByVocabulary(userLevel.estimatedVocabulary)}（估计词汇量 ${userLevel.estimatedVocabulary}）。`
      + (isBatch ? '仅对 selectAboveLevel=true 的段落' : '本次候选尚未确认超纲，')
      + '仅选择超出用户水平的候选词并给出语境释义，不要逐词全译；没有超纲词时允许返回空 words 数组。'
    : '';
  let content: string;
  try {
    content = await TranslationApiService.callWithSystem(systemPrompt + selectionInstruction, userPrompt, apiKey, settings,
      { maxRetries: 0 }, { ...options, responseFormat: { type: 'json_object' } });
  } catch (error) {
    options?.signal?.throwIfAborted();
    throw error;
  }
  options?.signal?.throwIfAborted();
  const senses = parseResponse(content, paragraphs.length, isBatch);
  return {
    results: resolutions.map((resolution, index) => mergeSenses(paragraphs[index].text, resolution, senses[index])),
    apiCallCount: 1,
  };
}
