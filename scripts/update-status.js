#!/usr/bin/env node
/**
 * 状态文件自动更新脚本
 *
 * 此脚本在每次 git commit 后运行，自动更新 board/status.md 文件
 * 使其与当前代码库状态保持同步。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置
const STATUS_FILE = path.join(__dirname, '..', 'board', 'status.md');
const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * 执行 shell 命令并返回输出
 */
function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', ...options }).trim();
  } catch (error) {
    return null;
  }
}

/**
 * 获取当前日期
 */
function getCurrentDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * 获取最近的 git 提交信息
 */
function getGitInfo() {
  const commitHash = exec('git rev-parse --short HEAD');
  const commitMessage = exec('git log -1 --pretty=%B');
  const branch = exec('git branch --show-current');
  const commitDate = exec('git log -1 --pretty=%ci');

  return {
    commitHash,
    commitMessage,
    branch,
    commitDate: commitDate ? commitDate.split(' ')[0] : getCurrentDate()
  };
}

/**
 * 获取测试状态
 */
function getTestStatus() {
  try {
    const result = exec('npm test -- --passWithNoTests 2>/dev/null | tail -20');

    // 尝试解析测试数量
    const testMatch = result?.match(/(\d+)\s+tests?\s+passed/i) ||
                      result?.match(/Test Suites:.*?(\d+)\s+passed/);

    if (testMatch) {
      return {
        count: parseInt(testMatch[1], 10),
        passing: true,
        raw: result
      };
    }

    return { count: null, passing: null, raw: result };
  } catch (error) {
    return { count: null, passing: null, error: error.message };
  }
}

/**
 * 解析现有的 Sprint 状态
 */
function parseSprintStatus(content) {
  const lines = content.split('\n');
  let currentSprint = null;
  let progress = null;

  for (const line of lines) {
    // 查找 Sprint 信息
    const sprintMatch = line.match(/Sprint\s+(\d+)/i);
    if (sprintMatch) {
      currentSprint = parseInt(sprintMatch[1], 10);
    }

    // 查找进度信息
    const progressMatch = line.match(/(\d+)%\s+完成/);
    if (progressMatch) {
      progress = parseInt(progressMatch[1], 10);
    }
  }

  return { currentSprint, progress };
}

/**
 * 生成更新后的状态文件内容
 */
function generateStatusContent(gitInfo, testStatus, existingContent) {
  const date = getCurrentDate();
  const parsed = parseSprintStatus(existingContent || '');

  // 根据 git 提交信息推断 Sprint
  let currentSprint = parsed.currentSprint || 2;
  let progress = parsed.progress || 100;
  let status = '进行中';

  // 如果检测到 Sprint 完成的关键字，更新状态
  const completeKeywords = ['feat:', 'feature:', '完成', 'complete', 'finish'];
  const isCompletion = completeKeywords.some(kw =>
    gitInfo.commitMessage.toLowerCase().includes(kw.toLowerCase())
  );

  if (isCompletion && progress < 100) {
    progress = Math.min(100, progress + 10);
  }

  if (progress >= 100) {
    status = '已完成';
    // 自动推进到下一个 Sprint
    currentSprint++;
    progress = 0;
    status = '规划中';
  }

  // 测试状态
  const testStatusText = testStatus.count
    ? `${testStatus.count} 个测试通过`
    : '测试状态未知';

  return `# 项目状态

**最后更新**: ${date}
**当前 Sprint**: Sprint ${currentSprint}
**进度**: ${progress}% 完成
**状态**: ${status}

## 最新提交

- **Commit**: ${gitInfo.commitHash}
- **分支**: ${gitInfo.branch}
- **消息**: ${gitInfo.commitMessage.split('\n')[0]}
- **日期**: ${gitInfo.commitDate}

## 测试状态

${testStatusText}

## 历史 Sprint

| Sprint | 状态 | 完成日期 | 主要交付 |
|--------|------|----------|----------|
| Sprint 1 | 已完成 | 2026-03-10 | 核心翻译功能 |
| Sprint 2 | 已完成 | 2026-03-16 | 闪卡、统计、主题切换 |

## 待办事项

- [ ] 继续推进当前 Sprint 任务
- [ ] 保持状态文件与代码同步
- [ ] 定期更新测试覆盖情况
`;
}

/**
 * 主函数
 */
function main() {
  console.log('🔄 更新状态文件...\n');

  try {
    // 收集信息
    const gitInfo = getGitInfo();
    const testStatus = getTestStatus();

    console.log('Git 信息:');
    console.log(`  Commit: ${gitInfo.commitHash}`);
    console.log(`  分支: ${gitInfo.branch}`);
    console.log(`  消息: ${gitInfo.commitMessage.split('\n')[0]}`);
    console.log('');

    console.log('测试状态:');
    console.log(`  ${testStatus.count || '未知'} 个测试通过`);
    console.log('');

    // 读取现有状态文件
    let existingContent = '';
    if (fs.existsSync(STATUS_FILE)) {
      existingContent = fs.readFileSync(STATUS_FILE, 'utf8');
      console.log('✓ 读取现有状态文件');
    } else {
      console.log('ℹ 状态文件不存在，将创建新文件');
    }

    // 生成新内容
    const newContent = generateStatusContent(gitInfo, testStatus, existingContent);

    // 写入文件
    const dir = path.dirname(STATUS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(STATUS_FILE, newContent, 'utf8');
    console.log(`✓ 状态文件已更新: ${STATUS_FILE}`);
    console.log('');

    // 提示是否需要提交
    const status = exec('git status --porcelain board/status.md');
    if (status) {
      console.log('💡 提示: 状态文件有变更，建议提交:');
      console.log('   git add board/status.md');
      console.log('   git commit -m "chore: 更新项目状态文件"');
    }

  } catch (error) {
    console.error('❌ 更新失败:', error.message);
    process.exit(1);
  }
}

// 运行主函数
main();
