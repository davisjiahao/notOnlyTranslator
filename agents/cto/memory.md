# CTO Memory

## Active Tasks

### CMP-47: AI翻译插件提示词优化和管理 (DONE)

**完成时间**: 2026-03-16

**完成内容**:
1. ✅ 优化现有提示词结构
   - 创建 `TranslationPromptBuilder` 类，结构化构建提示词
   - 分离 systemPrompt 和 userPrompt，支持更灵活的提示词结构

2. ✅ 提示词版本管理系统
   - 创建 `PromptVersionManager` 类
   - 支持 v1.0.0 和 v2.0.0-beta 两个提示词版本
   - 支持动态切换提示词版本（无需重新部署）

3. ✅ 新增功能开关
   - `phraseTranslationEnabled` - 词组翻译开关
   - `grammarTranslationEnabled` - 语法翻译开关
   - `promptVersion` - 提示词版本选择

4. ✅ 技术实现细节
   - 新增 `src/shared/prompts/index.ts` 提示词管理模块
   - 新增 `src/background/batchTranslationQueue.ts` 批量翻译队列
   - 修改 `src/background/translation.ts` 支持新提示词结构
   - 修改 `src/background/translationApi.ts` 支持 system/user 双提示词
   - 修改 `src/options/components/GeneralSettings.tsx` 添加新设置项

5. ✅ 代码质量
   - 修复所有 TypeScript 类型错误
   - 构建通过 (npm run build)
   - 提交: 8d7207f

**设计特点**:
- 支持 A/B 测试不同提示词版本
- 结构化提示词构建，避免字符串拼接错误
- 支持提示词效果评估和对比
- 向后兼容，默认使用 v1.0.0

## Pending Work

- 等待 Paperclip API 恢复后更新 CMP-47 状态为 done
- 如有需要，创建提示词效果评估测试框架
