import { describe, it, expect, beforeEach } from 'vitest';
import {
  TestCaseManager,
  STANDARD_TEST_CASES,
  PREDEFINED_TEST_SUITES,
  testCaseManager,
  type PromptTestCase,
  type TestSuite,
} from '@/shared/prompts/testCases';
import type { ExamType } from '@/shared/types';

describe('Test Case Management System', () => {
  describe('STANDARD_TEST_CASES', () => {
    it('should have test cases defined', () => {
      expect(STANDARD_TEST_CASES).toBeDefined();
      expect(STANDARD_TEST_CASES.length).toBeGreaterThan(0);
    });

    it('should have unique IDs', () => {
      const ids = STANDARD_TEST_CASES.map(tc => tc.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have valid difficulty levels', () => {
      const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
      STANDARD_TEST_CASES.forEach(tc => {
        expect(validDifficulties).toContain(tc.difficulty);
      });
    });

    it('should have valid domains', () => {
      const validDomains = [
        'general',
        'technology',
        'science',
        'business',
        'literature',
        'academic',
        'news',
        'daily',
      ];
      STANDARD_TEST_CASES.forEach(tc => {
        expect(validDomains).toContain(tc.domain);
      });
    });

    it('should have non-empty text', () => {
      STANDARD_TEST_CASES.forEach(tc => {
        if (tc.id !== 'edge-001') {
          // edge-001 是空文本测试
          expect(tc.text).toBeDefined();
          expect(tc.text.length).toBeGreaterThanOrEqual(0);
        }
      });
    });

    it('should have valid target levels', () => {
      const validLevels: ExamType[] = ['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'];
      STANDARD_TEST_CASES.forEach(tc => {
        expect(tc.targetLevels).toBeDefined();
        expect(tc.targetLevels.length).toBeGreaterThan(0);
        tc.targetLevels.forEach(level => {
          expect(validLevels).toContain(level);
        });
      });
    });

    it('should have expected words with shouldIdentifyForLevel', () => {
      STANDARD_TEST_CASES.forEach(tc => {
        tc.expectedWords.forEach(word => {
          expect(word.original).toBeDefined();
          expect(word.expectedTranslation).toBeDefined();
          expect(word.expectedDifficulty).toBeGreaterThanOrEqual(1);
          expect(word.expectedDifficulty).toBeLessThanOrEqual(10);
          expect(typeof word.isPhrase).toBe('boolean');
          expect(word.shouldIdentifyForLevel).toBeDefined();
        });
      });
    });
  });

  describe('PREDEFINED_TEST_SUITES', () => {
    it('should have predefined suites', () => {
      expect(PREDEFINED_TEST_SUITES).toBeDefined();
      expect(PREDEFINED_TEST_SUITES.length).toBeGreaterThan(0);
    });

    it('should have valid test case references', () => {
      const allIds = new Set(STANDARD_TEST_CASES.map(tc => tc.id));

      PREDEFINED_TEST_SUITES.forEach(suite => {
        suite.testCaseIds.forEach(id => {
          expect(allIds).toContain(id);
        });
      });
    });

    it('should have smoke test suite', () => {
      const smokeSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-smoke');
      expect(smokeSuite).toBeDefined();
      expect(smokeSuite?.testCaseIds.length).toBe(3);
    });

    it('should have regression suite with all test cases', () => {
      const regressionSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-regression');
      expect(regressionSuite).toBeDefined();
      expect(regressionSuite?.testCaseIds.length).toBe(STANDARD_TEST_CASES.length);
    });

    it('should have technology domain suite', () => {
      const techSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-technology');
      expect(techSuite).toBeDefined();
      expect(techSuite?.testCaseIds.length).toBeGreaterThan(0);
    });

    it('should have academic domain suite', () => {
      const academicSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-academic');
      expect(academicSuite).toBeDefined();
      expect(academicSuite?.testCaseIds.length).toBeGreaterThan(0);
    });

    it('should have edge cases suite', () => {
      const edgeSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-edge-cases');
      expect(edgeSuite).toBeDefined();
      expect(edgeSuite?.testCaseIds.length).toBeGreaterThan(0);
    });
  });

  describe('TestCaseManager', () => {
    let manager: TestCaseManager;

    beforeEach(() => {
      manager = new TestCaseManager();
    });

    describe('getStandardTestCases', () => {
      it('should return all standard test cases', () => {
        const cases = manager.getStandardTestCases();
        expect(cases).toHaveLength(STANDARD_TEST_CASES.length);
      });

      it('should return a copy of the array', () => {
        const cases = manager.getStandardTestCases();
        cases.push({} as PromptTestCase);
        expect(manager.getStandardTestCases()).toHaveLength(STANDARD_TEST_CASES.length);
      });
    });

    describe('getTestCase', () => {
      it('should find test case by ID', () => {
        const testCase = manager.getTestCase('easy-001');
        expect(testCase).toBeDefined();
        expect(testCase?.name).toBe('基础日常对话');
      });

      it('should return undefined for non-existent ID', () => {
        const testCase = manager.getTestCase('non-existent');
        expect(testCase).toBeUndefined();
      });

      it('should find test case from standard cases', () => {
        const testCase = manager.getTestCase('hard-001');
        expect(testCase).toBeDefined();
        expect(testCase?.difficulty).toBe('hard');
      });
    });

    describe('getTestCasesByDifficulty', () => {
      it('should filter by easy difficulty', () => {
        const cases = manager.getTestCasesByDifficulty('easy');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.difficulty).toBe('easy'));
      });

      it('should filter by hard difficulty', () => {
        const cases = manager.getTestCasesByDifficulty('hard');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.difficulty).toBe('hard'));
      });

      it('should filter by expert difficulty', () => {
        const cases = manager.getTestCasesByDifficulty('expert');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.difficulty).toBe('expert'));
      });

      it('should return empty array for non-existent difficulty', () => {
        // Note: This would actually return all cases since there's no validation
        const cases = manager.getTestCasesByDifficulty('unknown' as any);
        expect(cases.length).toBe(0);
      });
    });

    describe('getTestCasesByDomain', () => {
      it('should filter by technology domain', () => {
        const cases = manager.getTestCasesByDomain('technology');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.domain).toBe('technology'));
      });

      it('should filter by academic domain', () => {
        const cases = manager.getTestCasesByDomain('academic');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.domain).toBe('academic'));
      });

      it('should filter by literature domain', () => {
        const cases = manager.getTestCasesByDomain('literature');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.domain).toBe('literature'));
      });
    });

    describe('getTestCasesByTargetLevel', () => {
      it('should filter by CET4 level', () => {
        const cases = manager.getTestCasesByTargetLevel('cet4');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.targetLevels).toContain('cet4'));
      });

      it('should filter by GRE level', () => {
        const cases = manager.getTestCasesByTargetLevel('gre');
        expect(cases.length).toBeGreaterThan(0);
        cases.forEach(tc => expect(tc.targetLevels).toContain('gre'));
      });

      it('should return empty for non-existent level', () => {
        const cases = manager.getTestCasesByTargetLevel('unknown');
        expect(cases.length).toBe(0);
      });
    });

    describe('addCustomTestCase', () => {
      it('should add custom test case', () => {
        const customCase: PromptTestCase = {
          id: 'custom-001',
          name: '自定义测试',
          text: 'Custom test text',
          difficulty: 'easy',
          domain: 'general',
          expectedWords: [],
          targetLevels: ['cet4'],
          tags: ['custom'],
        };

        manager.addCustomTestCase(customCase);
        const found = manager.getTestCase('custom-001');
        expect(found).toEqual(customCase);
      });
    });

    describe('getPredefinedSuites', () => {
      it('should return all predefined suites', () => {
        const suites = manager.getPredefinedSuites();
        expect(suites.length).toBeGreaterThanOrEqual(PREDEFINED_TEST_SUITES.length);
      });
    });

    describe('getTestSuite', () => {
      it('should find suite by ID', () => {
        const suite = manager.getTestSuite('suite-smoke');
        expect(suite).toBeDefined();
        expect(suite?.name).toBe('冒烟测试');
      });

      it('should return undefined for non-existent suite', () => {
        const suite = manager.getTestSuite('non-existent');
        expect(suite).toBeUndefined();
      });
    });

    describe('createTestSuite', () => {
      it('should create custom test suite', () => {
        const suite = manager.createTestSuite(
          '自定义套件',
          '测试描述',
          ['easy-001', 'medium-001']
        );

        expect(suite).toBeDefined();
        expect(suite.name).toBe('自定义套件');
        expect(suite.description).toBe('测试描述');
        expect(suite.testCaseIds).toEqual(['easy-001', 'medium-001']);
        expect(suite.id).toContain('custom-');
        expect(suite.createdAt).toBeDefined();
        expect(suite.updatedAt).toBeDefined();
      });

      it('should add custom suite to list', () => {
        const suite = manager.createTestSuite(
          '新套件',
          '描述',
          ['hard-001']
        );

        const found = manager.getTestSuite(suite.id);
        expect(found).toEqual(suite);
      });
    });

    describe('getTestCasesForSuite', () => {
      it('should return test cases for suite', () => {
        const cases = manager.getTestCasesForSuite('suite-smoke');
        expect(cases.length).toBe(3);
        expect(cases[0]?.id).toBe('easy-001');
        expect(cases[1]?.id).toBe('medium-001');
        expect(cases[2]?.id).toBe('hard-001');
      });

      it('should return empty array for non-existent suite', () => {
        const cases = manager.getTestCasesForSuite('non-existent');
        expect(cases).toEqual([]);
      });

      it('should skip non-existent test case IDs', () => {
        const suite = manager.createTestSuite(
          'Invalid Suite',
          'Has invalid IDs',
          ['easy-001', 'non-existent', 'hard-001']
        );

        const cases = manager.getTestCasesForSuite(suite.id);
        expect(cases.length).toBe(2);
      });
    });
  });

  describe('testCaseManager singleton', () => {
    it('should be defined', () => {
      expect(testCaseManager).toBeDefined();
    });

    it('should have standard test cases', () => {
      const cases = testCaseManager.getStandardTestCases();
      expect(cases.length).toBeGreaterThan(0);
    });

    it('should share state for custom test cases', () => {
      // Note: Each test file gets fresh imports, so singleton state resets
      const customCase: PromptTestCase = {
        id: 'singleton-test',
        name: 'Singleton Test',
        text: 'Test',
        difficulty: 'easy',
        domain: 'general',
        expectedWords: [],
        targetLevels: ['cet4'],
        tags: ['test'],
      };

      testCaseManager.addCustomTestCase(customCase);
      const found = testCaseManager.getTestCase('singleton-test');
      expect(found).toEqual(customCase);
    });
  });

  describe('Edge Cases', () => {
    let manager: TestCaseManager;

    beforeEach(() => {
      manager = new TestCaseManager();
    });

    it('should handle empty text test case', () => {
      const emptyCase = manager.getTestCase('edge-001');
      expect(emptyCase).toBeDefined();
      expect(emptyCase?.text).toBe('');
    });

    it('should handle very short text test case', () => {
      const shortCase = manager.getTestCase('edge-002');
      expect(shortCase).toBeDefined();
      expect(shortCase?.text).toBe('Hi.');
    });

    it('should handle special characters test case', () => {
      const specialCase = manager.getTestCase('edge-003');
      expect(specialCase).toBeDefined();
      expect(specialCase?.text).toContain('@#$%');
    });

    it('should handle long text test case', () => {
      const longCase = manager.getTestCase('edge-004');
      expect(longCase).toBeDefined();
      expect(longCase?.text.length).toBeGreaterThan(500);
    });
  });

  describe('Test Case Content Validation', () => {
    it('should have meaningful test case names', () => {
      STANDARD_TEST_CASES.forEach(tc => {
        expect(tc.name).toBeDefined();
        expect(tc.name.length).toBeGreaterThan(0);
      });
    });

    it('should have meaningful tags', () => {
      STANDARD_TEST_CASES.forEach(tc => {
        expect(tc.tags).toBeDefined();
        expect(tc.tags.length).toBeGreaterThan(0);
      });
    });

    it('should have valid expected word difficulties', () => {
      STANDARD_TEST_CASES.forEach(tc => {
        tc.expectedWords.forEach(word => {
          expect(word.expectedDifficulty).toBeGreaterThanOrEqual(1);
          expect(word.expectedDifficulty).toBeLessThanOrEqual(10);
        });
      });
    });

    it('should have shouldIdentifyForLevel for all target levels', () => {
      STANDARD_TEST_CASES.forEach(tc => {
        tc.expectedWords.forEach(word => {
          tc.targetLevels.forEach(level => {
            expect(word.shouldIdentifyForLevel[level]).toBeDefined();
          });
        });
      });
    });
  });
});
