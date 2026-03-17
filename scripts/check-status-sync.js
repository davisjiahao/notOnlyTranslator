#!/usr/bin/env node
/**
 * 状态同步检查脚本
 *
 * 检查 board/status.md 与代码库实际状态的一致性
 * 在 CI/CD 或代码审查前运行
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, '..', 'board', 'status.md');

/**
 * 执行命令
 */
function exec(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    return null;
  }
}

/**
 * 获取测试数量
 */
function getTestCount() {
  try {
    const result = exec('npm test -- --passWithNoTests 2>/dev/null | grep -E "(Tests:|Test Suites:)" | tail -5');

    // 尝试多种格式匹配
    const match = result?.match(/(\d+)\s*(tests?|passed)/i) ||
                  result?.match(/Test Suites:.*?\d+\s+passed.*?\d+\s+tests?/i);

    if (match) {
      return parseInt(match[1], 10);
    }
  } catch (e) {}

  return null;
}

/**
 * 获取 Git 提交数量
 */
function getCommitCount() {
  try {
    const count = exec('git rev-list --count HEAD');
    return count ? parseInt(count, 10) : null;
  } catch (e) {
    return null;
  }
}

/**
 * 获取最近提交日期
 */
function getLastCommitDate() {
  try {
    return exec('git log -1 --pretty=%ci')?.split(' ')[0];
  } catch (e) {
    return null;
  }
}

/**
 * 解析状态文件
 */
function parseStatusFile() {
  if (!fs.existsSync(STATUS_FILE)) {
    return null;
  }

  const content = fs.readFileSync(STATUS_FILE, 'utf8');
  const lines = content.split('\n');

  const data = {
    lastUpdate: null,
    sprint: null,
    progress: null,
    testCount: null,
    lastCommit: null,
    raw: content
  };

  for (const line of lines) {
    // 最后更新日期
    const updateMatch = line.match(/\*\*最后更新\*\*:\s*(\d{4}-\d{2}-\d{2})/);
    if (updateMatch) {
      data.lastUpdate = updateMatch[1];
    }

    // Sprint
    const sprintMatch = line.match(/\*\*当前 Sprint\*\*:\s*Sprint\s*(\d+)/);
    if (sprintMatch) {
      data.sprint = parseInt(sprintMatch[1], 10);
    }

    // 进度
    const progressMatch = line.match(/\*\*进度\*\*:\s*(\d+)%/);
    if (progressMatch) {
      data.progress = parseInt(progressMatch[1], 10);
    }

    // 测试数量
    const testMatch = line.match(/(\d+)\s*个测试通过/);
    if (testMatch) {
      data.testCount = parseInt(testMatch[1], 10);
    }

    // 最近提交
    const commitMatch = line.match(/\*\*日期\*\*:\s*(\d{4}-\d{2}-\d{2})/);
    if (commitMatch) {
      data.lastCommit = commitMatch[1];
    }
  }

  return data;
}

/**
 * 主检查逻辑
 */
function main() {
  console.log('🔍 检查状态文件同步...\n');

  const issues = [];
  const warnings = [];

  // 1. 检查状态文件存在性
  if (!fs.existsSync(STATUS_FILE)) {
    console.error('❌ 状态文件不存在:', STATUS_FILE);
    console.log('\n💡 建议运行: node scripts/update-status.js');
    process.exit(1);
  }

  console.log('✓ 状态文件存在');

  // 2. 解析状态文件
  const statusData = parseStatusFile();
  if (!statusData) {
    console.error('❌ 无法解析状态文件');
    process.exit(1);
  }

  console.log(`✓ 解析状态文件成功`);
  console.log(`  - 最后更新: ${statusData.lastUpdate || '未知'}`);
  console.log(`  - 当前 Sprint: ${statusData.sprint || '未知'}`);
  console.log(`  - 进度: ${statusData.progress !== null ? statusData.progress + '%' : '未知'}`);
  console.log('');

  // 3. 检查最后更新日期
  const today = new Date().toISOString().split('T')[0];
  if (statusData.lastUpdate !== today) {
    warnings.push({
      type: 'outdated',
      message: `状态文件最后更新于 ${statusData.lastUpdate}，不是今天`,
      suggestion: '运行: node scripts/update-status.js'
    });
  }

  // 4. 检查测试数量一致性
  const actualTestCount = getTestCount();
  if (actualTestCount && statusData.testCount && actualTestCount !== statusData.testCount) {
    issues.push({
      type: 'test_mismatch',
      message: `测试数量不匹配: 状态文件显示 ${statusData.testCount}，实际 ${actualTestCount}`,
      suggestion: '更新状态文件或检查测试配置'
    });
  }

  // 5. 检查最近提交
  const lastCommitDate = getLastCommitDate();
  if (lastCommitDate && statusData.lastCommit && lastCommitDate !== statusData.lastCommit) {
    warnings.push({
      type: 'commit_mismatch',
      message: `提交日期不匹配: 状态文件显示 ${statusData.lastCommit}，最新提交 ${lastCommitDate}`,
      suggestion: '运行: node scripts/update-status.js'
    });
  }

  // 输出结果
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('检查结果\n');

  if (issues.length === 0 && warnings.length === 0) {
    console.log('✅ 所有检查通过！状态文件与代码库同步。');
  } else {
    if (issues.length > 0) {
      console.log(`❌ 发现 ${issues.length} 个问题:\n`);
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue.message}`);
        console.log(`   💡 ${issue.suggestion}\n`);
      });
    }

    if (warnings.length > 0) {
      console.log(`⚠️  ${warnings.length} 个警告:\n`);
      warnings.forEach((warning, i) => {
        console.log(`${i + 1}. ${warning.message}`);
        console.log(`   💡 ${warning.suggestion}\n`);
      });
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 返回退出码
  process.exit(issues.length > 0 ? 1 : 0);
}

// 运行主函数
main();
