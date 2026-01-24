import type { ExamType, UserProfile } from '@/shared/types';
import { calculateVocabularySize, updateVocabularyEstimate } from '@/shared/utils';
import { StorageManager } from './storage';
import { frequencyManager } from './frequencyManager';

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
    return profile;
  }

  /**
   * Get word difficulty estimate based on user profile and frequency data
   */
  static estimateWordDifficulty(
    word: string,
    userProfile: UserProfile
  ): number {
    // 1. Check User Personal History first
    // Check if word is in known words
    if (userProfile.knownWords.includes(word.toLowerCase())) {
      return 1; // Very easy for this user
    }

    // Check if word is in unknown words
    const unknownEntry = userProfile.unknownWords.find(
      (w) => w.word.toLowerCase() === word.toLowerCase()
    );
    if (unknownEntry) {
      return 10; // Confirmed difficult for this user
    }

    // 2. Use Frequency Manager (Data-driven)
    // This uses the "COCA-like" simulated frequency tables
    const frequencyDifficulty = frequencyManager.getDifficulty(word);

    // 3. Apply Heuristics (Rule-based adjustment)
    const lowerWord = word.toLowerCase();
    const wordLength = word.length;
    let adjustment = 0;

    // Heuristic: Very short words are usually easier
    if (wordLength <= 3 && frequencyDifficulty > 3) adjustment -= 2;

    // Heuristic: Long words but with simple suffixes
    if (wordLength > 10) {
      if (lowerWord.endsWith('ing') || lowerWord.endsWith('ed') || lowerWord.endsWith('ly') || lowerWord.endsWith('ment')) {
        adjustment -= 1;
      } else {
        // Truly long complex word
        adjustment += 1;
      }
    }

    // Combine Frequency + Heuristics
    // Weight the frequency score heavily as it's data-backed
    let finalDifficulty = frequencyDifficulty + adjustment;

    // Clamp to 1-10 range
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
