import type {
  Message,
  MessageResponse,
  TranslationRequest,
  UnknownWordEntry,
  BatchTranslationRequest,
  TranslationResult,
  TranslationMode,
  UserProfile,
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
import { CacheMetrics } from './cacheMetrics';
import { reviewReminderManager } from './reviewReminder';
import {
  getErrorStats,
  queryErrors,
  deleteError,
  deleteErrors,
  clearAllErrors,
  markErrorsAsReported,
  getUnreportedErrors,
} from '@/shared/error-tracking';
import {
  saveTranslationHistory,
  queryTranslationHistory,
  getHistoryById,
  deleteHistoryEntry,
  deleteHistoryEntries,
  clearAllHistory,
  getHistoryStats,
  exportHistoryData,
  importHistoryData,
} from './translationHistory';

logger.info('NotOnlyTranslator: Background service worker started');

// Keep-alive mechanism for Manifest V3 service worker
// Chrome may terminate idle service workers, which breaks message passing
// This alarm keeps the service worker alive during active sessions

// Create alarm at startup (service worker may restart without onInstalled firing)
chrome.alarms.get('keep-alive', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('keep-alive', { periodInMinutes: 0.5 }); // Every 30 seconds
    logger.info('NotOnlyTranslator: Keep-alive alarm created at startup');
  } else {
    logger.debug('NotOnlyTranslator: Keep-alive alarm already exists');
  }
});

// Also create on install/update (for first-time setup)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keep-alive', { periodInMinutes: 0.5 });
  logger.info('NotOnlyTranslator: Keep-alive alarm created on install');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keep-alive') {
    // Service worker stays alive as long as it has active event listeners
    // This alarm firing is enough to prevent termination
    logger.debug('NotOnlyTranslator: Keep-alive alarm fired');
  } else if (alarm.name === 'review-reminder') {
    // 复习提醒闹钟
    reviewReminderManager.checkAndSendReminder().catch(err =>
      logger.error('Failed to send review reminder:', err)
    );
  }
});

// 初始化核心服务
Promise.all([
  enhancedCache.initialize().then(() => logger.info('NotOnlyTranslator: 增强缓存已初始化')),
  frequencyManager.initialize().then(() => logger.info('NotOnlyTranslator: 词频管理器已初始化')),
  reviewReminderManager.load().then(async () => {
    logger.info('NotOnlyTranslator: 复习提醒管理器已初始化');
    // 设置复习提醒闹钟
    await reviewReminderManager.scheduleReminderAlarm();
  }),
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

// Handle notification clicks (for review reminders)
chrome.notifications.onClicked.addListener((notificationId) => {
  logger.info(`Notification clicked: ${notificationId}`);
  // 打开选项页面，导航到生词复习区域
  chrome.runtime.openOptionsPage();
});

// Handle keyboard commands (shortcuts defined in manifest.json)
chrome.commands.onCommand.addListener(async (command, tab) => {
  logger.info(`NotOnlyTranslator: Command received: ${command}`);

  if (!tab?.id) {
    logger.warn('Command received but no active tab');
    return;
  }

  switch (command) {
    case 'translate-paragraph':
      // 发送消息到 content script 触发段落翻译
      chrome.tabs.sendMessage(tab.id, {
        type: 'TRANSLATE_PARAGRAPH',
      }).catch(err => logger.error('Failed to send TRANSLATE_PARAGRAPH:', err));
      break;

    case 'toggle-translation':
      // 发送消息到 content script 切换翻译显示
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_TRANSLATION',
      }).catch(err => logger.error('Failed to send TOGGLE_TRANSLATION:', err));
      break;

    default:
      logger.warn(`Unknown command: ${command}`);
  }
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
      const { word, context, translation, isKnown, wordDifficulty } = message.payload as {
        word: string;
        context?: string;
        translation?: string;
        isKnown?: boolean;
        wordDifficulty?: number;
      };

      // 确定实际的认识状态和难度（兼容旧调用和闪卡复习调用）
      const actualIsKnown = isKnown ?? true;
      const actualDifficulty = wordDifficulty ?? 5;
      const actualContext = context || '';
      const actualTranslation = translation || '';

      // 添加到已知词汇列表（如果认识）
      if (actualIsKnown) {
        await StorageManager.addKnownWord(word);
      }

      // 更新用户档案
      const profile = await UserLevelManager.updateFromMarking(
        word,
        actualIsKnown,
        actualDifficulty
      );

      // 更新掌握度系统
      const wordEntry: UnknownWordEntry = {
        word,
        context: actualContext,
        translation: actualTranslation,
        markedAt: Date.now(),
        reviewCount: 0,
      };
      const masteryResult = await MasteryManager.markWord(
        wordEntry,
        actualIsKnown,
        actualDifficulty
      );

      return { success: true, data: { profile, masteryResult } };
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

    case 'GET_LEARNING_STATISTICS': {
      try {
        const { days = 90 } = message.payload as { days?: number };
        const stats = await MasteryManager.getLearningStatistics(days);
        return { success: true, data: stats };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取学习统计数据失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    // 缓存统计相关消息
    case 'GET_CACHE_STATS': {
      try {
        const stats = await enhancedCache.getStats();
        return { success: true, data: stats };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取缓存统计失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_CACHE_METRICS': {
      try {
        const report = CacheMetrics.getReport();
        return { success: true, data: report };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取缓存指标失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'CLEAR_TRANSLATION_CACHE': {
      try {
        await enhancedCache.clearAll();
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 清空缓存失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'RESET_CACHE_METRICS': {
      try {
        await CacheMetrics.reset();
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 重置缓存指标失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    // 错误追踪系统相关消息
    case 'GET_ERROR_STATS': {
      try {
        const stats = await getErrorStats();
        return { success: true, data: stats };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取错误统计失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'QUERY_ERRORS': {
      try {
        const { params } = message.payload as { params: import('@/shared/error-tracking').ErrorQueryParams };
        const result = await queryErrors(params);
        return { success: true, data: result };
      } catch (error) {
        logger.error('NotOnlyTranslator: 查询错误失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'DELETE_ERROR': {
      try {
        const { id } = message.payload as { id: string };
        await deleteError(id);
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 删除错误失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'DELETE_ERRORS': {
      try {
        const { ids } = message.payload as { ids: string[] };
        await deleteErrors(ids);
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 批量删除错误失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'CLEAR_ALL_ERRORS': {
      try {
        await clearAllErrors();
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 清空所有错误失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'MARK_ERRORS_AS_REPORTED': {
      try {
        const { ids } = message.payload as { ids: string[] };
        await markErrorsAsReported(ids);
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 标记错误已上报失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'REPORT_ERRORS': {
      try {
        const { ids } = message.payload as { ids?: string[] };
        const result = ids && ids.length > 0
          ? await queryErrors({ ids })
          : await getUnreportedErrors();

        // 统一转换为 ErrorEntry[]
        const errors = Array.isArray(result) ? result : result.errors;

        if (errors.length === 0) {
          return { success: true, data: { message: '没有需要上报的错误' } };
        }

        // 这里可以实现实际的上报逻辑，比如发送到服务器
        // 目前先标记为已上报
        const errorIds = errors.map(e => e.id);
        await markErrorsAsReported(errorIds);

        return {
          success: true,
          data: {
            reportedCount: errors.length,
            message: `成功上报 ${errors.length} 个错误`
          }
        };
      } catch (error) {
        logger.error('NotOnlyTranslator: 上报错误失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    // 翻译历史记录消息处理 (CMP-87)
    case 'SAVE_TRANSLATION_HISTORY': {
      try {
        const { originalText, translation, pageUrl, mode, userProfile, pageTitle } = message.payload as {
          originalText: string;
          translation: TranslationResult;
          pageUrl: string;
          mode: TranslationMode;
          userProfile?: UserProfile;
          pageTitle?: string;
        };
        const entry = await saveTranslationHistory(originalText, translation, pageUrl, mode, userProfile, pageTitle);
        return { success: true, data: entry };
      } catch (error) {
        logger.error('NotOnlyTranslator: 保存翻译历史失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'QUERY_TRANSLATION_HISTORY': {
      try {
        const { params } = message.payload as { params?: import('./translationHistory').HistoryQueryParams };
        const result = await queryTranslationHistory(params);
        return { success: true, data: result };
      } catch (error) {
        logger.error('NotOnlyTranslator: 查询翻译历史失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_HISTORY_BY_ID': {
      try {
        const { id } = message.payload as { id: string };
        const entry = await getHistoryById(id);
        return { success: true, data: entry };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取历史记录失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'DELETE_HISTORY_ENTRY': {
      try {
        const { id } = message.payload as { id: string };
        await deleteHistoryEntry(id);
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 删除历史记录失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'DELETE_HISTORY_ENTRIES': {
      try {
        const { ids } = message.payload as { ids: string[] };
        await deleteHistoryEntries(ids);
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 批量删除历史记录失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'CLEAR_ALL_HISTORY': {
      try {
        await clearAllHistory();
        return { success: true };
      } catch (error) {
        logger.error('NotOnlyTranslator: 清空历史记录失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'GET_HISTORY_STATS': {
      try {
        const stats = await getHistoryStats();
        return { success: true, data: stats };
      } catch (error) {
        logger.error('NotOnlyTranslator: 获取历史统计失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'EXPORT_HISTORY_DATA': {
      try {
        const data = await exportHistoryData();
        return { success: true, data };
      } catch (error) {
        logger.error('NotOnlyTranslator: 导出历史数据失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    case 'IMPORT_HISTORY_DATA': {
      try {
        const { entries } = message.payload as { entries: import('./translationHistory').TranslationHistoryEntry[] };
        const result = await importHistoryData(entries);
        return { success: true, data: result };
      } catch (error) {
        logger.error('NotOnlyTranslator: 导入历史数据失败', error);
        return { success: false, error: (error as Error).message };
      }
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// Export for testing
export { handleMessage };
