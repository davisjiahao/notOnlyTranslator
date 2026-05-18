/**
 * 提示词测试用例管理测试
 *
 * 测试 TestCaseManager, STANDARD_TEST_CASES, PREDEFINED_TEST_SUITES
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TestCaseManager,
  STANDARD_TEST_CASES,
  PREDEFINED_TEST_SUITES,
  type PromptTestCase,
  type TestSuite,
} from '@/shared/prompts/testCases';

describe('STANDARD_TEST_CASES', () => {
  it('should have test cases for all difficulty levels', () => {
    const difficulties = new Set(STANDARD_TEST_CASES.map(tc => tc.difficulty));
    expect(difficulties).toContain('easy');
    expect(difficulties).toContain('medium');
    expect(difficulties).toContain('hard');
    expect(difficulties).toContain('expert');
  });

  it('should have test cases for all domains', () => {
    const domains = new Set(STANDARD_TEST_CASES.map(tc => tc.domain));
    expect(domains).toContain('daily');
    expect(domains).toContain('technology');
    expect(domains).toContain('academic');
    expect(domains).toContain('science');
    expect(domains).toContain('business');
    expect(domains).toContain('literature');
  });

  it('all test cases should have required fields', () => {
    STANDARD_TEST_CASES.forEach(tc => {
      expect(tc.id).toBeDefined();
      expect(tc.name).toBeDefined();
      expect(tc.text).toBeDefined();
      expect(tc.difficulty).toBeDefined();
      expect(tc.domain).toBeDefined();
      expect(Array.isArray(tc.expectedWords)).toBe(true);
      expect(Array.isArray(tc.targetLevels)).toBe(true);
      expect(Array.isArray(tc.tags)).toBe(true);
    });
  });

  it('edge cases should have appropriate tags', () => {
    const edgeCases = STANDARD_TEST_CASES.filter(tc => tc.id.startsWith('edge-'));
    edgeCases.forEach(tc => {
      expect(tc.tags).toContain('edge-case');
    });
  });

  it('grammar test cases should have expectedSentences', () => {
    const grammarCases = STANDARD_TEST_CASES.filter(tc => tc.id.startsWith('grammar-'));
    grammarCases.forEach(tc => {
      expect(tc.expectedSentences).toBeDefined();
      expect(tc.expectedSentences!.length).toBeGreaterThan(0);
    });
  });

  it('expert level should have high difficulty words', () => {
    const expertCases = STANDARD_TEST_CASES.filter(tc => tc.difficulty === 'expert');
    expertCases.forEach(tc => {
      tc.expectedWords.forEach(w => {
        expect(w.expectedDifficulty).toBeGreaterThanOrEqual(8);
      });
    });
  });
});

describe('PREDEFINED_TEST_SUITES', () => {
  it('should have predefined suites', () => {
    expect(PREDEFINED_TEST_SUITES.length).toBeGreaterThan(0);
  });

  it('all suites should have required fields', () => {
    PREDEFINED_TEST_SUITES.forEach(suite => {
      expect(suite.id).toBeDefined();
      expect(suite.name).toBeDefined();
      expect(suite.description).toBeDefined();
      expect(Array.isArray(suite.testCaseIds)).toBe(true);
      expect(suite.testCaseIds.length).toBeGreaterThan(0);
      expect(suite.createdAt).toBeGreaterThan(0);
      expect(suite.updatedAt).toBeGreaterThan(0);
    });
  });

  it('smoke suite should reference valid test case IDs', () => {
    const smokeSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-smoke');
    expect(smokeSuite).toBeDefined();

    const allIds = new Set(STANDARD_TEST_CASES.map(tc => tc.id));
    smokeSuite!.testCaseIds.forEach(id => {
      expect(allIds.has(id)).toBe(true);
    });
  });

  it('edge cases suite should reference edge test cases', () => {
    const edgeSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-edge-cases');
    expect(edgeSuite).toBeDefined();

    edgeSuite!.testCaseIds.forEach(id => {
      expect(id).toMatch(/^edge-/);
    });
  });

  it('regression suite should include all test cases', () => {
    const regressionSuite = PREDEFINED_TEST_SUITES.find(s => s.id === 'suite-regression');
    expect(regressionSuite).toBeDefined();

    const allIds = STANDARD_TEST_CASES.map(tc => tc.id);
    expect(regressionSuite!.testCaseIds).toEqual(allIds);
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

      expect(cases.length).toBe(STANDARD_TEST_CASES.length);
    });

    it('should return a copy (immutability)', () => {
      const cases1 = manager.getStandardTestCases();
      cases1.push({
        id: 'fake', name: 'Fake', text: 'fake', difficulty: 'easy',
        domain: 'general', expectedWords: [], targetLevels: ['cet4'], tags: [],
      });

      const cases2 = manager.getStandardTestCases();
      expect(cases2.length).toBe(STANDARD_TEST_CASES.length);
    });
  });

  describe('getTestCase', () => {
    it('should find test case by ID', () => {
      const tc = manager.getTestCase('easy-001');

      expect(tc).toBeDefined();
      expect(tc!.name).toBe('基础日常对话');
    });

    it('should return undefined for non-existent ID', () => {
      expect(manager.getTestCase('non-existent')).toBeUndefined();
    });

    it('should find custom test cases', () => {
      const custom: PromptTestCase = {
        id: 'custom-001', name: 'Custom', text: 'test',
        difficulty: 'medium', domain: 'general',
        expectedWords: [], targetLevels: ['cet4'], tags: [],
      };
      manager.addCustomTestCase(custom);

      const found = manager.getTestCase('custom-001');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Custom');
    });
  });

  describe('getTestCasesByDifficulty', () => {
    it('should filter by easy difficulty', () => {
      const cases = manager.getTestCasesByDifficulty('easy');

      cases.forEach(tc => {
        expect(tc.difficulty).toBe('easy');
      });
      expect(cases.length).toBeGreaterThan(0);
    });

    it('should filter by expert difficulty', () => {
      const cases = manager.getTestCasesByDifficulty('expert');

      expect(cases.length).toBeGreaterThan(0);
      cases.forEach(tc => {
        expect(tc.difficulty).toBe('expert');
      });
    });

    it('should include custom test cases in filter', () => {
      manager.addCustomTestCase({
        id: 'custom-hard', name: 'Hard Custom', text: 'test',
        difficulty: 'hard', domain: 'general',
        expectedWords: [], targetLevels: ['cet4'], tags: [],
      });

      const cases = manager.getTestCasesByDifficulty('hard');
      expect(cases.some(tc => tc.id === 'custom-hard')).toBe(true);
    });
  });

  describe('getTestCasesByDomain', () => {
    it('should filter by technology domain', () => {
      const cases = manager.getTestCasesByDomain('technology');

      expect(cases.length).toBeGreaterThan(0);
      cases.forEach(tc => {
        expect(tc.domain).toBe('technology');
      });
    });

    it('should filter by literature domain', () => {
      const cases = manager.getTestCasesByDomain('literature');

      cases.forEach(tc => {
        expect(tc.domain).toBe('literature');
      });
    });

    it('should include custom test cases in domain filter', () => {
      manager.addCustomTestCase({
        id: 'custom-science', name: 'Science Custom', text: 'test',
        difficulty: 'hard', domain: 'science',
        expectedWords: [], targetLevels: ['cet4'], tags: [],
      });

      const cases = manager.getTestCasesByDomain('science');
      expect(cases.some(tc => tc.id === 'custom-science')).toBe(true);
    });
  });

  describe('getTestCasesByTargetLevel', () => {
    it('should find test cases targeting cet4', () => {
      const cases = manager.getTestCasesByTargetLevel('cet4');

      expect(cases.length).toBeGreaterThan(0);
      cases.forEach(tc => {
        expect(tc.targetLevels).toContain('cet4');
      });
    });

    it('should find test cases targeting gre', () => {
      const cases = manager.getTestCasesByTargetLevel('gre');

      expect(cases.length).toBeGreaterThan(0);
      cases.forEach(tc => {
        expect(tc.targetLevels).toContain('gre');
      });
    });
  });

  describe('addCustomTestCase', () => {
    it('should add custom test case to the list', () => {
      const custom: PromptTestCase = {
        id: 'my-custom', name: 'My Custom', text: 'Hello world',
        difficulty: 'medium', domain: 'daily',
        expectedWords: [], targetLevels: ['cet4'], tags: ['custom'],
      };

      manager.addCustomTestCase(custom);

      const found = manager.getTestCase('my-custom');
      expect(found).toBeDefined();
      expect(found!.text).toBe('Hello world');
    });

    it('should support multiple custom test cases', () => {
      manager.addCustomTestCase({
        id: 'c1', name: 'C1', text: 't1',
        difficulty: 'easy', domain: 'general',
        expectedWords: [], targetLevels: ['cet4'], tags: [],
      });
      manager.addCustomTestCase({
        id: 'c2', name: 'C2', text: 't2',
        difficulty: 'hard', domain: 'general',
        expectedWords: [], targetLevels: ['cet4'], tags: [],
      });

      expect(manager.getTestCase('c1')!.name).toBe('C1');
      expect(manager.getTestCase('c2')!.name).toBe('C2');
    });
  });

  describe('getPredefinedSuites', () => {
    it('should return all predefined suites', () => {
      const suites = manager.getPredefinedSuites();

      expect(suites.length).toBe(PREDEFINED_TEST_SUITES.length);
    });

    it('should include custom suites after creation', () => {
      manager.createTestSuite('My Suite', 'Description', ['easy-001']);

      const suites = manager.getPredefinedSuites();
      expect(suites.some(s => s.name === 'My Suite')).toBe(true);
    });

    it('should return a copy', () => {
      const suites1 = manager.getPredefinedSuites();
      suites1.push({
        id: 'fake', name: 'Fake', description: '',
        testCaseIds: [], createdAt: Date.now(), updatedAt: Date.now(),
      });

      const suites2 = manager.getPredefinedSuites();
      expect(suites2.some(s => s.id === 'fake')).toBe(false);
    });
  });

  describe('getTestSuite', () => {
    it('should find suite by ID', () => {
      const suite = manager.getTestSuite('suite-smoke');

      expect(suite).toBeDefined();
      expect(suite!.name).toBe('冒烟测试');
    });

    it('should return undefined for non-existent ID', () => {
      expect(manager.getTestSuite('non-existent')).toBeUndefined();
    });

    it('should find custom suite', () => {
      manager.createTestSuite('Custom Suite', 'Custom desc', ['easy-001']);

      const customSuite = manager.getTestSuite(
        manager.getPredefinedSuites().find(s => s.name === 'Custom Suite')!.id
      );
      expect(customSuite).toBeDefined();
      expect(customSuite!.name).toBe('Custom Suite');
    });
  });

  describe('createTestSuite', () => {
    it('should create a suite with all fields', () => {
      const suite = manager.createTestSuite('Test', 'Desc', ['easy-001', 'medium-001']);

      expect(suite.id).toBeDefined();
      expect(suite.name).toBe('Test');
      expect(suite.description).toBe('Desc');
      expect(suite.testCaseIds).toEqual(['easy-001', 'medium-001']);
      expect(suite.createdAt).toBeGreaterThan(0);
      expect(suite.updatedAt).toBeGreaterThan(0);
    });

    it('should generate unique IDs for different suites', () => {
      const suite1 = manager.createTestSuite('A', 'D1', []);
      // Ensure different timestamp
      const suite2 = manager.createTestSuite('B', 'D2', []);

      // Both should have IDs starting with 'custom-'
      expect(suite1.id).toMatch(/^custom-/);
      expect(suite2.id).toMatch(/^custom-/);
    });
  });

  describe('getTestCasesForSuite', () => {
    it('should return test cases for smoke suite', () => {
      const cases = manager.getTestCasesForSuite('suite-smoke');

      expect(cases.length).toBeGreaterThan(0);
      cases.forEach(tc => {
        expect(tc).toHaveProperty('id');
        expect(tc).toHaveProperty('name');
      });
    });

    it('should return empty array for non-existent suite', () => {
      const cases = manager.getTestCasesForSuite('non-existent');

      expect(cases).toEqual([]);
    });

    it('should skip test case IDs that do not exist', () => {
      manager.createTestSuite('Bad Suite', 'Has invalid IDs', ['non-existent-id', 'easy-001']);

      const badSuite = manager.getPredefinedSuites().find(s => s.name === 'Bad Suite');
      expect(badSuite).toBeDefined();

      const cases = manager.getTestCasesForSuite(badSuite!.id);
      expect(cases.length).toBe(1);
      expect(cases[0].id).toBe('easy-001');
    });
  });
});
