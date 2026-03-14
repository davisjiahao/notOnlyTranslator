import type {
  Message,
  MessageResponse,
  TranslationRequest,
  UnknownWordEntry,
  BatchTranslationRequest,
} from '@/shared/types';
import { CONTEXT_MENU_IDS } from '@/shared/constants';
import { logger } from '@/shared/utils';
import { StorageManager } from './storage';
import { TranslationService } from './translation';
import { UserLevelManager } from './userLevel';
import { BatchTranslationService } from './batchTranslation';
import { MasteryManager } from './mastery';
import { enhancedCache } from './enhancedCache';
import { frequencyManager } from './frequencyManager';

logger.info('NotOnlyTranslator: Background service worker started');

// 初始化核心服务
Promise.all([
  enhancedCache.initialize().then(() => logger.info('NotOnlyTranslator: 增强缓存已初始化')),
  frequencyManager.initialize().then(() => logger.info('NotOnlyTranslator: 词频管理器已初始化'))
]).catch(err => logger.error('NotOnlyTranslator: 初始化失败', err));

// Initialize context menus on install
chrome.runtime.onInstalled.addListener(() => {
  // Create context menu items
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.TRANSLATE_SELECTION,
    title: 'Translate Selection',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.MARK_KNOWN,
    title: 'Mark as Known',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.MARK_UNKNOWN,
    title: 'Mark as Unknown',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.ADD_TO_VOCABULARY,
    title: 'Add to Vocabulary',
    contexts: ['selection'],
  });

  logger.info('NotOnlyTranslator installed and context menus created');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText?.trim();
  if (!selectedText || !tab?.id) return;

  switch (info.menuItemId) {
    case CONTEXT_MENU_IDS.TRANSLATE_SELECTION:
      // Send message to content script to show translation
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_TRANSLATION',
        payload: { text: selectedText },
      });
      break;

    case CONTEXT_MENU_IDS.MARK_KNOWN:
      await StorageManager.addKnownWord(selectedText);
      chrome.tabs.sendMessage(tab.id, {
        type: 'WORD_MARKED',
        payload: { word: selectedText, isKnown: true },
      });
      break;

    case CONTEXT_MENU_IDS.MARK_UNKNOWN:
      await StorageManager.addUnknownWord({
        word: selectedText,
        context: '',
        translation: '',
        markedAt: Date.now(),
        reviewCount: 0,
      });
      chrome.tabs.sendMessage(tab.id, {
        type: 'WORD_MARKED',
        payload: { word: selectedText, isKnown: false },
      });
      break;

    case CONTEXT_MENU_IDS.ADD_TO_VOCABULARY:
      // Get translation first
      try {
        const settings = await StorageManager.getSettings();
        const apiKey = await StorageManager.getApiKey();
        const translation = await TranslationService.quickTranslate(
          selectedText,
          apiKey,
          settings
        );
        await StorageManager.addUnknownWord({
          word: selectedText,
          context: '',
          translation,
          markedAt: Date.now(),
          reviewCount: 0,
        });
        chrome.tabs.sendMessage(tab.id, {
          type: 'ADDED_TO_VOCABULARY',
          payload: { word: selectedText, translation },
        });
      } catch (error) {
        logger.error('Failed to add to vocabulary:', error);
      }
      break;
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );

    // Return true to indicate we will send response asynchronously
    return true;
  }
);

async function handleMessage(message: Message): Promise<MessageResponse> {
  logger.info('NotOnlyTranslator: Received message:', message.type);

  switch (message.type) {
    case 'TRANSLATE_TEXT': {
      try {
        const request = message.payload as TranslationRequest;
        const userProfile = await StorageManager.getUserProfile();
        logger.info('NotOnlyTranslator: Translating text, length:', request.text?.length);
        const result = await TranslationService.translate({
          ...request,
          userLevel: userProfile,
        });
        logger.info('NotOnlyTranslator: Translation result:', result);
        return { success: true, data: result };
      } catch (error) {
        logger.error('NotOnlyTranslator: Translation error:', error);
        return { success: false, error: (error as Error).message };
      }
    }

    // 批量翻译请求处理
    case 'BATCH_TRANSLATE_TEXT': {
      try {
        const request = message.payload as BatchTranslationRequest;
        logger.info('NotOnlyTranslator: 批量翻译请求，段落数:', request.paragraphs?.length);

        // 获取用户配置
        const userProfile = await StorageManager.getUserProfile();
        request.userLevel = userProfile;

        // 调用批量翻译服务
        const response = await BatchTranslationService.translateBatch(request);

        logger.info('NotOnlyTranslator: 批量翻译完成', {
          total: response.results.length,
          apiCalls: response.apiCallCount,
          cacheHits: response.cacheHitCount,
        });

        return { success: true, data: response };
      } catch (error) {
        logger.error('NotOnlyTranslator: 批量翻译错误:', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'MARK_WORD_KNOWN': {
      const { word, difficulty, context } = message.payload as {
        word: string;
        difficulty: number;
        context?: string;
      };

      // 添加到已知词汇列表
      await StorageManager.addKnownWord(word);

      // 更新用户档案
      const profile = await UserLevelManager.updateFromMarking(
        word,
        true,
        difficulty
      );

      // 更新掌握度系统
      const wordEntry: UnknownWordEntry = {
        word,
        context: context || '',
        translation: '',
        markedAt: Date.now(),
        reviewCount: 0,
      };
      await MasteryManager.markWord(wordEntry, true, difficulty);

      return { success: true, data: profile };
    }

    case 'MARK_WORD_UNKNOWN': {
      const entry = message.payload as UnknownWordEntry;

      // 添加到未知词汇列表
      await StorageManager.addUnknownWord(entry);

      // 更新用户档案
      const profile = await UserLevelManager.updateFromMarking(
        entry.word,
        false,
        5 // Default difficulty
      );

      // 更新掌握度系统
      await MasteryManager.markWord(entry, false, 5);

      return { success: true, data: profile };
    }

    case 'GET_USER_PROFILE': {
      const profile = await StorageManager.getUserProfile();
      return { success: true, data: profile };
    }

    case 'UPDATE_USER_PROFILE': {
      const updates = message.payload as Partial<import('@/shared/types').UserProfile>;
      const current = await StorageManager.getUserProfile();
      await StorageManager.saveUserProfile({ ...current, ...updates });
      const updated = await StorageManager.getUserProfile();
      return { success: true, data: updated };
    }

    case 'GET_SETTINGS': {
      const settings = await StorageManager.getSettings();
      return { success: true, data: settings };
    }

    case 'UPDATE_SETTINGS': {
      const newSettings = message.payload as Partial<import('@/shared/types').UserSettings>;
      const currentSettings = await StorageManager.getSettings();
      await StorageManager.saveSettings({ ...currentSettings, ...newSettings });

      // 通知所有标签页的 content script 设置已更新
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {
              // 忽略无法发送消息的标签页（如 chrome:// 页面）
            });
          }
        }
      } catch (error) {
        logger.error('NotOnlyTranslator: 通知标签页设置更新失败', error);
      }

      return { success: true };
    }

    case 'GET_VOCABULARY': {
      const profile = await StorageManager.getUserProfile();
      return { success: true, data: profile.unknownWords };
    }

    case 'ADD_TO_VOCABULARY': {
      const entry = message.payload as UnknownWordEntry;
      await StorageManager.addUnknownWord(entry);
      return { success: true };
    }

    case 'REMOVE_FROM_VOCABULARY': {
      const { word } = message.payload as { word: string };
      await StorageManager.removeFromVocabulary(word);
      return { success: true };
    }

    // 掌握度系统相关消息
    case 'GET_MASTERY_OVERVIEW': {
      try {
        const overview = await MasteryManager.getMasteryOverview();
        return { success: true, data: overview };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取掌握度概览失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_CEFR_LEVEL': {
      try {
        const level = await MasteryManager.getUserCEFRLevel();
        return { success: true, data: level };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取 CEFR 等级失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_REVIEW_WORDS': {
      try {
        const { limit = 20 } = message.payload as { limit?: number };
        const words = await MasteryManager.getReviewWords(limit);
        return { success: true, data: words };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取复习单词失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_MASTERY_TREND': {
      try {
        const { days = 30 } = message.payload as { days?: number };
        const trend = await MasteryManager.getMasteryTrend(days);
        return { success: true, data: trend };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取掌握度趋势失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'SYNC_USER_VOCABULARY': {
      try {
        await MasteryManager.syncUserVocabulary();
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 同步用户词汇量失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'EXPORT_MASTERY_DATA': {
      try {
        const data = await MasteryManager.exportData();
        return { success: true, data };
      } catch (error) {
        logger.error('NotOnlyTranslator: 导出掌握度数据失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'IMPORT_MASTERY_DATA': {
      try {
        const data = message.payload as Partial<import('@/shared/types/mastery').MasteryProfile>;
        await MasteryManager.importData(data);
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 导入掌握度数据失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_WORD_MASTERY_INFO': {
      try {
        const { word } = message.payload as { word: string };
        const info = await MasteryManager.getWordMasteryInfo(word);
        return { success: true, data: info };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取单词掌握度信息失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// Export for testing
export { handleMessage };
