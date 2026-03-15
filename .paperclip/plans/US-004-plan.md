# US-004: 实现 Background Service Worker 核心功能

## 任务概述

实现 Chrome Extension Background Service Worker 的核心功能，包括消息路由、LLM API 调用、词汇管理和用户配置管理。

## 当前状态分析

### 已存在的模块
- `src/background/index.ts` - 主入口，基础消息处理
- `src/background/translation.ts` - LLM API 调用
- `src/background/storage.ts` - Chrome Storage 封装
- `src/background/userLevel.ts` - 词汇估计和贝叶斯更新

### 需要完善的功能
1. 消息路由系统 - 需要更完善的路由和错误处理
2. 词汇管理系统 - 需要完整的词汇数据库操作
3. 用户配置管理 - 需要更灵活的配置系统
4. 上下文菜单 - 需要实现右键菜单功能

## 实现计划

### Phase 1: 消息路由系统 (2小时)

#### 1.1 创建 MessageRouter 类
```typescript
// src/background/messageRouter.ts
export class MessageRouter {
  private handlers: Map<string, MessageHandler>;

  register(type: string, handler: MessageHandler): void;
  unregister(type: string): void;
  route(message: Message, sender: chrome.runtime.MessageSender): Promise<MessageResponse>;
}
```

**测试要点**:
- 处理器注册和注销
- 消息路由正确性
- 错误处理和超时
- 并发消息处理

#### 1.2 更新 index.ts
- 使用 MessageRouter 替换现有的 switch-case
- 添加全局错误处理

### Phase 2: 词汇管理系统 (2小时)

#### 2.1 创建 VocabularyManager 类
```typescript
// src/background/vocabularyManager.ts
export class VocabularyManager {
  // 已知词汇管理
  async addKnownWord(word: string, context?: string): Promise<void>;
  async removeKnownWord(word: string): Promise<void>;
  async isKnownWord(word: string): Promise<boolean>;
  async getKnownWords(): Promise<string[]>;

  // 生词本管理
  async addToVocabulary(word: string, translation: string, context?: string): Promise<void>;
  async removeFromVocabulary(word: string): Promise<void>;
  async getVocabulary(): Promise<VocabularyItem[]>;

  // 词汇统计
  async getVocabularyStats(): Promise<VocabularyStats>;
}
```

**测试要点**:
- 词汇添加、删除、查询
- 已知词汇和生词本分离
- 持久化存储验证
- 统计功能准确性

#### 2.2 与 Storage 模块集成
- 使用 Storage 类进行数据持久化
- 添加数据迁移逻辑（如果需要）

### Phase 3: 用户配置管理 (2小时)

#### 3.1 创建 ConfigManager 类
```typescript
// src/background/configManager.ts
export class ConfigManager {
  // 配置获取和更新
  async getConfig(): Promise<UserConfig>;
  async updateConfig(updates: Partial<UserConfig>): Promise<void>;
  async resetConfig(): Promise<void>;

  // 特定配置项
  async getAPIKey(): Promise<string | null>;
  async setAPIKey(apiKey: string): Promise<void>;
  async getTranslationMode(): Promise<TranslationMode>;
  async setTranslationMode(mode: TranslationMode): Promise<void>;

  // 配置验证
  validateConfig(config: Partial<UserConfig>): ValidationResult;
}
```

**测试要点**:
- 配置读写正确性
- 配置验证逻辑
- 默认值处理
- 敏感数据（API Key）安全存储

#### 3.2 与 Settings 集成
- 与现有的 Settings 类型兼容
- 添加配置变更通知机制

### Phase 4: 上下文菜单 (1小时)

#### 4.1 创建 ContextMenuManager 类
```typescript
// src/background/contextMenuManager.ts
export class ContextMenuManager {
  private menuIds: string[];

  // 菜单管理
  createMenus(): void;
  removeMenus(): void;
  updateMenuState(enabled: boolean): void;

  // 事件处理
  handleMenuClick(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab): void;

  // 特定菜单项
  private createTranslateMenu(): void;
  private createAddToVocabularyMenu(): void;
  private createMarkAsKnownMenu(): void;
}
```

**测试要点**:
- 菜单创建和删除
- 菜单点击事件处理
- 菜单状态更新
- 权限检查

#### 4.2 在 index.ts 中集成
- 初始化 ContextMenuManager
- 处理权限变化

### Phase 5: 测试和优化 (1小时)

#### 5.1 集成测试
```typescript
// tests/unit/background/index.test.ts
// 测试完整的 Background 功能

describe('Background Service Worker Integration', () => {
  it('should handle all message types', async () => {
    // 测试所有消息类型的路由
  });

  it('should manage vocabulary correctly', async () => {
    // 测试词汇管理流程
  });

  it('should handle configuration changes', async () => {
    // 测试配置管理
  });
});
```

#### 5.2 性能优化
- 添加请求缓存
- 优化存储操作
- 添加批处理支持

## 验收标准

- [ ] 所有 Phase 完成
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] 代码审查通过
- [ ] 性能指标达标

## 依赖关系

- **US-001**: PageScanner 模块 ✓
- **US-002**: VocabularyFilter + Highlighter + Tooltip ✓
- **US-003**: Content Script 整合 ✓

## 风险分析

1. **存储限制**: Chrome Storage 有容量限制，需要实现数据压缩/分页
2. **权限问题**: 某些功能需要额外权限，需要优雅降级
3. **性能问题**: 大量词汇时可能影响性能，需要优化数据结构

## 下一步行动

1. 开始 Phase 1: 消息路由系统
2. 创建 MessageRouter 类和测试
3. 更新 index.ts 使用新的路由系统
4. 进行代码审查

---

**计划完成时间**: 2026-03-16
**负责人**: Founding Engineer
**审核人**: CEO (待分配)
