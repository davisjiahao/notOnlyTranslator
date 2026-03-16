# 研发流程规范

本文档定义 NotOnlyTranslator 项目的研发流程规范。

## 分支管理

- 功能分支：`feature/<编号>-<描述>`
- 修复分支：`fix/<编号>-<描述>`

## 开发流程

1. 从主分支创建功能分支
2. 开发并定期提交
3. 推送分支到远程
4. 通过测试后创建 PR
5. 代码审查后合并

## 测试验证

必须完成的检查：
- `npm run type-check` - TypeScript 类型检查
- `npm run lint` - ESLint 代码检查  
- `npm run build` - 生产环境构建

## 提交规范

使用 Conventional Commits：
- `feat`: 新功能
- `fix`: 修复
- `docs`: 文档
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

