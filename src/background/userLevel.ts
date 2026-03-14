import type { ExamType, UserProfile } from '@/shared/types';
import { calculateVocabularySize, updateVocabularyEstimate } from '@/shared/utils';
import { StorageManager } from './storage';
import { frequencyManager } from './frequencyManager';
import { MasteryManager } from './mastery';

/**
 * User Level Manager - handles vocabulary estimation and level updates
 */
export class UserLevelManager {
  /**
   * Initialize user profile with exam type and score
   */
  static async initializeProfile(
    examType: ExamType,
    examScore?: number
  ): Promise<UserProfile> {
    const estimatedVocabulary = calculateVocabularySize(examType, examScore);

    const profile: UserProfile = {
      examType,
      examScore,
      estimatedVocabulary,
      knownWords: [],
      unknownWords: [],
      levelConfidence: 0.5, // Start with medium confidence
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await StorageManager.saveUserProfile(profile);
    return profile;
  }

  /**
   * Update vocabulary estimate based on user marking a word
   */
  static async updateFromMarking(
    _word: string,
    isKnown: boolean,
    wordDifficulty: number
  ): Promise<UserProfile> {
    const profile = await StorageManager.getUserProfile();

    // Update vocabulary estimate using Bayesian update
    const { newEstimate, newConfidence } = updateVocabularyEstimate(
      profile.estimatedVocabulary,
      wordDifficulty,
      isKnown,
      profile.levelConfidence
    );

    profile.estimatedVocabulary = newEstimate;
    profile.levelConfidence = newConfidence;

    await StorageManager.saveUserProfile(profile);
    return profile;
  }

  /**
   * Update profile from quick test results
   */
  static async updateFromTestResult(
    correctAnswers: number,
    totalQuestions: number,
    questionDifficulties: number[]
  ): Promise<UserProfile> {
    const profile = await StorageManager.getUserProfile();

    // Calculate weighted score based on question difficulties
    let weightedCorrect = 0;
    let totalWeight = 0;

    for (let i = 0; i < totalQuestions; i++) {
      const weight = questionDifficulties[i] / 10;
      totalWeight += weight;
      if (i < correctAnswers) {
        weightedCorrect += weight;
      }
    }

    const weightedAccuracy = weightedCorrect / totalWeight;

    // Estimate vocabulary based on weighted accuracy
    // Map to vocabulary range (2000 - 15000)
    const estimatedVocabulary = Math.round(2000 + weightedAccuracy * 13000);

    // Increase confidence after test
    const newConfidence = Math.min(1, profile.levelConfidence + 0.2);

    profile.estimatedVocabulary = estimatedVocabulary;
    profile.levelConfidence = newConfidence;
    profile.updatedAt = Date.now();

    await StorageManager.saveUserProfile(profile);

    // 同步到掌握度系统
    await MasteryManager.syncUserVocabulary();

    return profile;
  }

  /**
   * Get word difficulty estimate based on user profile, mastery data, and frequency data
   */
  static async estimateWordDifficulty(
    word: string,
    userProfile: UserProfile
  ): Promise<number> {
    const lowerWord = word.toLowerCase();

    // 1. 首先检查掌握度系统（最准确的个性化数据）
    const masteryInfo = await MasteryManager.getWordMasteryInfo(lowerWord);
    if (masteryInfo) {
      // 根据掌握度调整难度：掌握度越高，难度越低
      // 将掌握度 (0-1) 映射到难度调整 (-5 到 +5)
      const masteryAdjustment = (0.5 - masteryInfo.masteryLevel) * 10;
      const baseDifficulty = 5;
      return Math.max(1, Math.min(10, Math.round(baseDifficulty + masteryAdjustment)));
    }

    // 2. 检查用户个人历史（已知/未知词汇列表）
    if (userProfile.knownWords.includes(lowerWord)) {
      return 1; // 已认识的词，难度最低
    }

    const unknownEntry = userProfile.unknownWords.find(
      (w) => w.word.toLowerCase() === lowerWord
    );
    if (unknownEntry) {
      return 10; // 已标记为未知的词，难度最高
    }

    // 3. 使用词频管理器（数据驱动的通用难度）
    const frequencyDifficulty = frequencyManager.getDifficulty(word);

    // 4. 应用启发式规则调整
    const wordLength = word.length;
    let adjustment = 0;

    // 启发式：短词通常更简单
    if (wordLength <= 3 && frequencyDifficulty > 3) adjustment -= 2;

    // 启发式：长词但带有简单后缀
    if (wordLength > 10) {
      if (lowerWord.endsWith('ing') || lowerWord.endsWith('ed') || lowerWord.endsWith('ly') || lowerWord.endsWith('ment')) {
        adjustment -= 1;
      } else {
        // 真正复杂的长词
        adjustment += 1;
      }
    }

    // 结合频率分数和启发式调整
    const finalDifficulty = frequencyDifficulty + adjustment;

    // 限制在 1-10 范围
    return Math.max(1, Math.min(10, Math.round(finalDifficulty)));
  }

  /**
   * Check if user should be prompted for re-assessment
   */
  static async shouldReassess(): Promise<boolean> {
    const profile = await StorageManager.getUserProfile();

    // Reassess if confidence is low
    if (profile.levelConfidence < 0.3) {
      return true;
    }

    // Reassess if many words have been marked
    const totalMarked =
      profile.knownWords.length + profile.unknownWords.length;
    const lastAssessment = profile.updatedAt;
    const daysSinceAssessment =
      (Date.now() - lastAssessment) / (1000 * 60 * 60 * 24);

    // If many marks and it's been a while, suggest reassessment
    if (totalMarked > 100 && daysSinceAssessment > 30) {
      return true;
    }

    return false;
  }

  /**
   * Get vocabulary statistics
   */
  static async getStats(): Promise<{
    estimatedVocabulary: number;
    knownWordsCount: number;
    unknownWordsCount: number;
    confidence: number;
    level: string;
  }> {
    const profile = await StorageManager.getUserProfile();

    // Determine level label
    let level: string;
    if (profile.estimatedVocabulary < 3000) {
      level = '初级';
    } else if (profile.estimatedVocabulary < 5000) {
      level = '中级';
    } else if (profile.estimatedVocabulary < 8000) {
      level = '中高级';
    } else if (profile.estimatedVocabulary < 12000) {
      level = '高级';
    } else {
      level = '专家级';
    }

    return {
      estimatedVocabulary: profile.estimatedVocabulary,
      knownWordsCount: profile.knownWords.length,
      unknownWordsCount: profile.unknownWords.length,
      confidence: profile.levelConfidence,
      level,
    };
  }
}
