# CMP-47: AI翻译插件提示词优化和管理 - 分析与实施计划

## 当前状态评估

### 已存在的基础架构 ✅

通过代码审查发现，系统已经具备了提示词管理的核心框架：

1. **`TranslationPromptBuilder`** (src/shared/prompts/index.ts:107-282)
   - 动态构建系统提示词和用户提示词
   - 支持词组翻译和语法翻译开关
   - 支持批量翻译模式（带 [PARA_n] 标记）

2. **`PromptVersionManager`** (src/shared/prompts/index.ts:438-493)
   - 版本注册和查询
   - 当前版本切换
   - 单例模式导出

3. **两个已定义的提示词版本**
   - `v1.0.0`: 基础版本，简洁直接
   - `v2.0.0-beta`: 增强版本，增加教学性描述和可选字段

4. **类型定义完整**
   - `PromptVariables`: 提示词变量
   - `PromptTemplate`: 提示词模板结构
   - `PromptConfig`: LLM 参数配置
   - `PromptEvaluation`: 评估指标（⚠️ 未实现）

---

## Part 1: 提示词优化分析

### v1.0.0 与 v2.0.0-beta 对比

| 维度 | v1.0.0 | v2.0.0-beta |
|------|--------|-------------|
| **系统角色** | "英语学习助手" | "英语教育专家和翻译家" |
| **指令结构** | 列举式（1. 2. 3.） | 分类式（识别标准/输出要求） |
| **难度评级** | 简单提及 1-10 | 强调客观性，考虑基准水平 |
| **输出字段** | 基础字段 | 增加音标、词性、例句（可选） |
| **temperature** | 0.3 | 0.2（更稳定） |
| **topP** | 0.95 | 0.9 |

### 优化建议

#### 1. 提示词结构优化（高优先级）

**问题识别**：
- 当前提示词混合了多种任务（词汇、短语、语法），可能导致 LLM 注意力分散
- JSON Schema 描述较长，可能占用过多上下文

**优化方案**：
```typescript
// 建议的 v2.0.0 正式版结构
{
  version: 'v2.0.0',
  systemPrompt: `你是一位专业的英语教育专家和翻译家...

## 任务优先级
1. 词汇标注（最高优先级）
2. 短语标注（如启用）
3. 语法结构（如启用）

## 词汇标注规则
- 只标注超出用户水平的词汇
- 参考词汇量：{vocabulary_size}（{exam_level}水平）
- 难度评级标准：...

## 输出要求
- 翻译要地道、符合中文习惯
- JSON 格式必须严格遵循 schema`,
  userPromptTemplate: `...`,
  outputSchema: { /* 更精简的 schema 描述 */ },
  config: { temperature: 0.2, maxTokens: 4000, topP: 0.9, responseFormat: 'json' }
}
```

#### 2. 输出 Schema 优化（中优先级）

**问题**：当前 schema 描述较长，放在 prompt 中占用 token

**优化**：使用 OpenAI/Anthropic 的 JSON mode 或 response_format 参数，减少 prompt 中的 schema 描述

#### 3. Few-shot 示例（中优先级）

在提示词中加入 1-2 个示例，提高输出稳定性：
```typescript
const exampleOutput = `{
  "fullText": "整段翻译...",
  "words": [
    {
      "original": "serendipity",
      "translation": "意外发现美好事物的能力",
      "position": [45, 56],
      "difficulty": 8,
      "isPhrase": false
    }
  ]
}`;
```

---

## Part 2: 管理系统增强计划

### 需要实现的功能

#### 1. 提示词效果评估系统 (PromptEvaluator)

**目标**：量化评估不同提示词版本的效果

**指标设计**：
```typescript
interface EvaluationMetrics {
  // 准确性指标
  wordDetectionAccuracy: number;      // 词汇检测准确率
  translationQuality: number;          // 翻译质量（可抽样人工评估）
  jsonValidityRate: number;            // JSON 格式有效率

  // 效率指标
  avgLatency: number;                  // 平均响应时间
  avgTokenUsage: number;               // 平均 token 消耗
  completionRate: number;              // 完整响应率

  // 用户体验指标
  userFeedbackScore?: number;          // 用户反馈评分（可选）
}
```

**实现方式**：
- 使用预定义的测试用例集（test cases）
- 对比不同版本的输出质量
- 自动化评估 + 人工抽样验证

#### 2. A/B 测试框架

**设计方案**：
```typescript
interface ABTestConfig {
  testId: string;
  versionA: string;
  versionB: string;
  trafficSplit: [number, number];      // [0.5, 0.5] 表示均分
  duration: number;                    // 测试持续时间（毫秒）
  successMetrics: ('accuracy' | 'speed' | 'userSatisfaction')[];
}

class PromptABTesting {
  activeTests: Map<string, ABTestConfig>;

  assignVersion(userId: string, testId: string): string {
    // 根据用户 ID 哈希分配到 A/B 组
  }

  recordResult(testId: string, version: string, metrics: EvaluationMetrics): void {
    // 记录测试结果
  }

  getTestResults(testId: string): ABTestResults {
    // 返回统计分析结果
  }
}
```

#### 3. 版本历史与回滚

**存储设计**：
```typescript
interface PromptVersionHistory {
  version: string;
  template: PromptTemplate;
  metadata: {
    createdAt: number;
    author: string;
    description: string;
    isActive: boolean;
    isDefault: boolean;
  };
  evaluation?: PromptEvaluation;
}

// 存储到 Chrome Storage
const STORAGE_KEY = 'promptVersionHistory';
```

**回滚机制**：
- 保留所有历史版本
- 可一键回滚到任意版本
- 回滚前自动备份当前版本

#### 4. 持久化存储集成

**当前问题**：`PromptVersionManager` 是内存中的，刷新后丢失

**解决方案**：
```typescript
class PersistentPromptVersionManager extends PromptVersionManager {
  async loadFromStorage(): Promise<void> {
    const stored = await chrome.storage.sync.get('promptVersions');
    // 恢复版本历史
  }

  async saveVersion(template: PromptTemplate): Promise<void> {
    // 保存到 chrome.storage.sync（云同步）
    await chrome.storage.sync.set({
      [`promptVersion:${template.version}`]: template
    });
  }
}
```

#### 5. UI 界面（Options 页面扩展）

在设置页面增加：
- 提示词版本选择器（下拉列表）
- 版本对比视图（并排对比两个版本的差异）
- 效果评估报告展示
- A/B 测试配置面板
- 版本历史列表（含回滚按钮）

---

## 实施优先级

### Phase 1: 提示词优化（1-2 天）
- [ ] 创建 v2.0.0 正式版提示词（基于 v2.0.0-beta 优化）
- [ ] 添加 few-shot 示例
- [ ] 精简 schema 描述
- [ ] 设置 v2.0.0 为默认版本

### Phase 2: 评估系统（2-3 天）
- [ ] 实现 `PromptEvaluator` 类
- [ ] 创建测试用例集（覆盖不同难度、领域的文本）
- [ ] 实现自动化评估流程
- [ ] 添加评估报告生成功能

### Phase 3: 持久化与回滚（1-2 天）
- [ ] 扩展 `PromptVersionManager` 支持持久化
- [ ] 实现版本历史存储
- [ ] 实现回滚功能
- [ ] 添加版本元数据管理

### Phase 4: A/B 测试（2-3 天）
- [ ] 实现 `PromptABTesting` 类
- [ ] 用户分组逻辑
- [ ] 结果收集与统计分析
- [ ] 测试报告生成

### Phase 5: UI 界面（2-3 天）
- [ ] Options 页面新增「提示词管理」标签页
- [ ] 版本选择器组件
- [ ] 版本对比视图
- [ ] 评估报告展示
- [ ] A/B 测试配置面板

---

## 技术实现细节

### 文件结构建议

```
src/shared/prompts/
├── index.ts                    # 主入口，导出所有类型和类
├── builder.ts                  # TranslationPromptBuilder
├── versions.ts                 # PROMPT_VERSIONS 定义
├── manager.ts                  # PromptVersionManager（增强版）
├── evaluator.ts                # PromptEvaluator（新增）
├── ab-testing.ts               # PromptABTesting（新增）
├── storage.ts                  # 持久化存储适配器（新增）
└── test-cases/                 # 测试用例集
    ├── basic.json
    ├── academic.json
    ├── literature.json
    └── tech.json
```

### API 设计

```typescript
// 主要导出
export { TranslationPromptBuilder } from './builder';
export { promptVersionManager, PersistentPromptVersionManager } from './manager';
export { PromptEvaluator } from './evaluator';
export { PromptABTesting } from './ab-testing';
export { PROMPT_VERSIONS } from './versions';
export type { PromptTemplate, PromptEvaluation, /* ... */ } from './types';

// 使用示例
import { promptVersionManager, PromptEvaluator } from '@/shared/prompts';

// 注册新版本
promptVersionManager.registerVersion(newTemplate);

// 运行评估
const evaluator = new PromptEvaluator();
const results = await evaluator.evaluate('v2.0.0', testCases);

// A/B 测试
const abTest = new PromptABTesting();
abTest.startTest({ versionA: 'v1.0.0', versionB: 'v2.0.0', trafficSplit: [0.5, 0.5] });
```

---

## 验收标准

### Part 1: 提示词优化
- [ ] v2.0.0 正式版提示词质量优于 v1.0.0
- [ ] JSON 格式错误率 < 1%
- [ ] 词汇检测准确率提升（通过人工抽样验证）

### Part 2: 管理系统
- [ ] 支持创建、注册新提示词版本
- [ ] 支持版本切换和回滚
- [ ] 提供评估指标（准确率、延迟、token 消耗）
- [ ] A/B 测试框架可正常运行
- [ ] 所有版本历史持久化存储
- [ ] UI 界面可管理提示词版本

---

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 提示词优化效果不明显 | 中 | 中 | 充分测试，准备多个候选版本 |
| 存储空间不足（Chrome sync 限制） | 低 | 高 | 压缩存储，定期清理旧版本 |
| A/B 测试统计显著性不足 | 中 | 中 | 延长测试周期，增加样本量 |
| 向后兼容性 | 低 | 高 | 保持 v1.0.0 作为 fallback |
