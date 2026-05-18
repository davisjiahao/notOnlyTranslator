import { describe, it, expect } from 'vitest';
import {
  EXAM_VOCABULARY_SIZES,
  SCORE_MULTIPLIERS,
  EXAM_DISPLAY_NAMES,
  EXAM_SCORE_RANGES,
  DEFAULT_SETTINGS,
  DEFAULT_USER_PROFILE,
  CHINESE_DETECTION_THRESHOLD,
  TIMING,
  STORAGE_KEYS,
  CONTEXT_MENU_IDS,
  COMMAND_IDS,
  CSS_CLASSES,
  API_ENDPOINTS,
  DEFAULT_BATCH_CONFIG,
  PARAGRAPH_CACHE_KEY,
  DEEPL_CACHE_EXPIRE_TIME,
  LLM_CACHE_EXPIRE_TIME,
  CACHE_VERSION,
} from '@/shared/constants';

describe('EXAM_VOCABULARY_SIZES', () => {
  it('should define vocabulary sizes for all exam types', () => {
    const examTypes = ['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'];
    for (const type of examTypes) {
      expect(EXAM_VOCABULARY_SIZES).toHaveProperty(type);
      expect(EXAM_VOCABULARY_SIZES[type]).toBeGreaterThan(0);
    }
  });

  it('should have GRE with largest vocabulary', () => {
    expect(EXAM_VOCABULARY_SIZES.gre).toBe(12000);
    for (const [key, value] of Object.entries(EXAM_VOCABULARY_SIZES)) {
      if (key !== 'gre') {
        expect(EXAM_VOCABULARY_SIZES.gre).toBeGreaterThan(value);
      }
    }
  });

  it('should have CET-4 less than CET-6', () => {
    expect(EXAM_VOCABULARY_SIZES.cet4).toBeLessThan(EXAM_VOCABULARY_SIZES.cet6);
  });
});

describe('SCORE_MULTIPLIERS', () => {
  it('should define multipliers for all exam types', () => {
    const examTypes = ['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'];
    for (const type of examTypes) {
      expect(SCORE_MULTIPLIERS).toHaveProperty(type);
      expect(typeof SCORE_MULTIPLIERS[type]).toBe('function');
    }
  });

  it('should return 0.6-1.0 for CET-4 scores', () => {
    expect(SCORE_MULTIPLIERS.cet4(220)).toBeCloseTo(0.6);
    expect(SCORE_MULTIPLIERS.cet4(710)).toBeCloseTo(1.0);
    expect(SCORE_MULTIPLIERS.cet4(465)).toBeCloseTo(0.8);
  });

  it('should return 0.5-1.0 for TOEFL scores', () => {
    expect(SCORE_MULTIPLIERS.toefl(0)).toBeCloseTo(0.5);
    expect(SCORE_MULTIPLIERS.toefl(120)).toBeCloseTo(1.0);
    expect(SCORE_MULTIPLIERS.toefl(60)).toBeCloseTo(0.75);
  });

  it('should return 0.5-1.0 for IELTS scores', () => {
    expect(SCORE_MULTIPLIERS.ielts(0)).toBeCloseTo(0.5);
    expect(SCORE_MULTIPLIERS.ielts(9)).toBeCloseTo(1.0);
    expect(SCORE_MULTIPLIERS.ielts(4.5)).toBeCloseTo(0.75);
  });

  it('should return 0.5-1.0 for GRE scores', () => {
    expect(SCORE_MULTIPLIERS.gre(130)).toBeCloseTo(0.5);
    expect(SCORE_MULTIPLIERS.gre(170)).toBeCloseTo(1.0);
    expect(SCORE_MULTIPLIERS.gre(150)).toBeCloseTo(0.75);
  });

  it('should return 1.0 for custom', () => {
    expect(SCORE_MULTIPLIERS.custom(0)).toBe(1);
    expect(SCORE_MULTIPLIERS.custom(9999)).toBe(1);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('should have enabled true by default', () => {
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
  });

  it('should have autoHighlight true', () => {
    expect(DEFAULT_SETTINGS.autoHighlight).toBe(true);
  });

  it('should have default apiProvider openai', () => {
    expect(DEFAULT_SETTINGS.apiProvider).toBe('openai');
  });

  it('should have default translationMode inline-only', () => {
    expect(DEFAULT_SETTINGS.translationMode).toBe('inline-only');
  });

  it('should have default promptVersion v1.0.0', () => {
    expect(DEFAULT_SETTINGS.promptVersion).toBe('v1.0.0');
  });

  it('should have hybridTranslation disabled by default', () => {
    expect(DEFAULT_SETTINGS.hybridTranslation.enabled).toBe(false);
  });

  it('should have hoverDelay 500ms', () => {
    expect(DEFAULT_SETTINGS.hoverDelay).toBe(500);
  });

  it('should have theme set to system', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
  });

  it('should have default fontSize 14', () => {
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
  });

  it('should have empty blacklist', () => {
    expect(DEFAULT_SETTINGS.blacklist).toEqual([]);
  });
});

describe('DEFAULT_USER_PROFILE', () => {
  it('should have cet4 as default examType', () => {
    expect(DEFAULT_USER_PROFILE.examType).toBe('cet4');
  });

  it('should have estimatedVocabulary 4500', () => {
    expect(DEFAULT_USER_PROFILE.estimatedVocabulary).toBe(4500);
  });

  it('should have levelConfidence 0.5', () => {
    expect(DEFAULT_USER_PROFILE.levelConfidence).toBe(0.5);
  });

  it('should have empty knownWords and unknownWords', () => {
    expect(DEFAULT_USER_PROFILE.knownWords).toEqual([]);
    expect(DEFAULT_USER_PROFILE.unknownWords).toEqual([]);
  });

  it('should have createdAt and updatedAt timestamps', () => {
    expect(DEFAULT_USER_PROFILE.createdAt).toBeGreaterThan(0);
    expect(DEFAULT_USER_PROFILE.updatedAt).toBeGreaterThan(0);
  });
});

describe('CHINESE_DETECTION_THRESHOLD', () => {
  it('should have PAGE threshold at 0.3', () => {
    expect(CHINESE_DETECTION_THRESHOLD.PAGE).toBe(0.3);
  });

  it('should have PARAGRAPH threshold at 0.2', () => {
    expect(CHINESE_DETECTION_THRESHOLD.PARAGRAPH).toBe(0.2);
  });

  it('PARAGRAPH should be stricter than PAGE', () => {
    expect(CHINESE_DETECTION_THRESHOLD.PARAGRAPH).toBeLessThan(CHINESE_DETECTION_THRESHOLD.PAGE);
  });
});

describe('TIMING', () => {
  it('should define event delays', () => {
    expect(TIMING.SELECTION_DELAY).toBe(50);
    expect(TIMING.DEFAULT_HOVER_DELAY).toBe(500);
    expect(TIMING.MODE_SWITCH_TRANSITION).toBe(150);
    expect(TIMING.NAVIGATION_HIGHLIGHT_DURATION).toBe(2000);
  });

  it('should define completion transition delay', () => {
    expect(TIMING.COMPLETION_TRANSITION_DELAY).toBe(800);
  });

  it('should define message timeouts', () => {
    expect(TIMING.DEFAULT_MESSAGE_TIMEOUT).toBe(5000);
    expect(TIMING.TRANSLATION_MESSAGE_TIMEOUT).toBe(30000);
  });

  it('should define debounce delays', () => {
    expect(TIMING.SCAN_DEBOUNCE).toBe(1000);
    expect(TIMING.TOOLTIP_HIDE_DELAY).toBe(100);
  });

  it('should define content thresholds', () => {
    expect(TIMING.MIN_PARAGRAPH_LENGTH).toBe(50);
    expect(TIMING.MAX_SAMPLE_LENGTH).toBe(2000);
    expect(TIMING.TEXT_SELECTION_MAX_LENGTH).toBe(100);
  });

  it('translation timeout should be greater than default timeout', () => {
    expect(TIMING.TRANSLATION_MESSAGE_TIMEOUT).toBeGreaterThan(TIMING.DEFAULT_MESSAGE_TIMEOUT);
  });
});

describe('STORAGE_KEYS', () => {
  it('should define LOCAL storage keys', () => {
    expect(STORAGE_KEYS.LOCAL.KNOWN_WORDS).toBe('knownWords');
    expect(STORAGE_KEYS.LOCAL.UNKNOWN_WORDS).toBe('unknownWords');
    expect(STORAGE_KEYS.LOCAL.TRANSLATION_CACHE).toBe('translationCache');
  });

  it('should define SYNC storage keys', () => {
    expect(STORAGE_KEYS.SYNC.USER_PROFILE).toBe('userProfile');
    expect(STORAGE_KEYS.SYNC.SETTINGS).toBe('settings');
    expect(STORAGE_KEYS.SYNC.API_KEY).toBe('apiKey');
  });
});

describe('CONTEXT_MENU_IDS', () => {
  it('should define all context menu IDs', () => {
    expect(CONTEXT_MENU_IDS.TRANSLATE_SELECTION).toBe('translateSelection');
    expect(CONTEXT_MENU_IDS.TRANSLATE_PAGE).toBe('translatePage');
    expect(CONTEXT_MENU_IDS.MARK_KNOWN).toBe('markKnown');
    expect(CONTEXT_MENU_IDS.MARK_UNKNOWN).toBe('markUnknown');
    expect(CONTEXT_MENU_IDS.ADD_TO_VOCABULARY).toBe('addToVocabulary');
  });

  it('all IDs should be unique', () => {
    const values = Object.values(CONTEXT_MENU_IDS);
    const uniqueValues = new Set(values);
    expect(values.length).toBe(uniqueValues.size);
  });
});

describe('COMMAND_IDS', () => {
  it('should define all command IDs', () => {
    expect(COMMAND_IDS.TRANSLATE_PARAGRAPH).toBe('translate-paragraph');
    expect(COMMAND_IDS.TOGGLE_TRANSLATION).toBe('toggle-translation');
    expect(COMMAND_IDS.TRANSLATE_FULL_PAGE).toBe('translate-full-page');
    expect(COMMAND_IDS.TOGGLE_MODE).toBe('toggle-mode');
  });
});

describe('CSS_CLASSES', () => {
  it('should define all CSS class names', () => {
    expect(CSS_CLASSES.HIGHLIGHT).toBe('not-translator-highlight');
    expect(CSS_CLASSES.TOOLTIP).toBe('not-translator-tooltip');
    expect(CSS_CLASSES.TOOLTIP_VISIBLE).toBe('not-translator-tooltip-visible');
    expect(CSS_CLASSES.MARK_BUTTON).toBe('not-translator-mark-btn');
    expect(CSS_CLASSES.KNOWN).toBe('not-translator-known');
    expect(CSS_CLASSES.UNKNOWN).toBe('not-translator-unknown');
  });

  it('all classes should use not-translator prefix', () => {
    for (const value of Object.values(CSS_CLASSES)) {
      expect(value.startsWith('not-translator-')).toBe(true);
    }
  });
});

describe('API_ENDPOINTS', () => {
  it('should define OpenAI endpoint', () => {
    expect(API_ENDPOINTS.OPENAI).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('should define Anthropic endpoint', () => {
    expect(API_ENDPOINTS.ANTHROPIC).toBe('https://api.anthropic.com/v1/messages');
  });

  it('endpoints should be valid HTTPS URLs', () => {
    for (const value of Object.values(API_ENDPOINTS)) {
      expect(value.startsWith('https://')).toBe(true);
    }
  });
});

describe('DEFAULT_BATCH_CONFIG', () => {
  it('should define maxParagraphsPerBatch as 15', () => {
    expect(DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch).toBe(15);
  });

  it('should define maxCharsPerBatch as 10000', () => {
    expect(DEFAULT_BATCH_CONFIG.maxCharsPerBatch).toBe(10000);
  });

  it('should define debounceDelay as 150', () => {
    expect(DEFAULT_BATCH_CONFIG.debounceDelay).toBe(150);
  });

  it('should define maxCacheEntries as 500', () => {
    expect(DEFAULT_BATCH_CONFIG.maxCacheEntries).toBe(500);
  });

  it('should define cacheExpireTime as 7 days', () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(DEFAULT_BATCH_CONFIG.cacheExpireTime).toBe(sevenDays);
  });
});

describe('cache expiration constants', () => {
  it('PARAGRAPH_CACHE_KEY should be defined', () => {
    expect(PARAGRAPH_CACHE_KEY).toBe('paragraphCache');
  });

  it('DEEPL_CACHE_EXPIRE_TIME should be 30 days', () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(DEEPL_CACHE_EXPIRE_TIME).toBe(thirtyDays);
  });

  it('LLM_CACHE_EXPIRE_TIME should be 7 days', () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(LLM_CACHE_EXPIRE_TIME).toBe(sevenDays);
  });

  it('DeepL cache expire time should be longer than LLM', () => {
    expect(DEEPL_CACHE_EXPIRE_TIME).toBeGreaterThan(LLM_CACHE_EXPIRE_TIME);
  });
});

describe('CACHE_VERSION', () => {
  it('should be a positive number', () => {
    expect(CACHE_VERSION).toBeGreaterThan(0);
  });
});
