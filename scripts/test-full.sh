#!/bin/bash
#
# 完整测试脚本 - 在提交前运行
# Usage: ./scripts/test-full.sh [options]
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  notOnlyTranslator 完整测试流程"
echo "=========================================="
echo ""

# 检查参数
RUN_E2E=true
RUN_COVERAGE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-e2e)
      RUN_E2E=false
      shift
      ;;
    --coverage)
      RUN_COVERAGE=true
      shift
      ;;
    --help)
      echo "Usage: ./scripts/test-full.sh [options]"
      echo ""
      echo "Options:"
      echo "  --skip-e2e     跳过 E2E 测试"
      echo "  --coverage     运行覆盖率测试"
      echo "  --help         显示帮助信息"
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

# 步骤 1: TypeScript 类型检查
echo -e "${YELLOW}[1/5] 检查 TypeScript 类型...${NC}"
npm run type-check
echo -e "${GREEN}✓ TypeScript 类型检查通过${NC}"
echo ""

# 步骤 2: ESLint 检查
echo -e "${YELLOW}[2/5] 运行 ESLint 检查...${NC}"
npm run lint
echo -e "${GREEN}✓ ESLint 检查通过${NC}"
echo ""

# 步骤 3: 单元测试
echo -e "${YELLOW}[3/5] 运行单元测试...${NC}"
if [ "$RUN_COVERAGE" = true ]; then
  npm run test:coverage
else
  npm test
fi
echo -e "${GREEN}✓ 单元测试通过${NC}"
echo ""

# 步骤 4: 构建扩展
echo -e "${YELLOW}[4/5] 构建扩展...${NC}"
npm run build
echo -e "${GREEN}✓ 扩展构建成功${NC}"
echo ""

# 步骤 5: E2E 测试
echo -e "${YELLOW}[5/5] 运行 E2E 测试...${NC}"
if [ "$RUN_E2E" = true ]; then
  # 检查 Chromium 是否安装
  if ! npx playwright chromium --version &> /dev/null; then
    echo -e "${YELLOW}警告: Chromium 未安装，正在安装...${NC}"
    npx playwright install chromium
  fi

  npm run test:e2e
  echo -e "${GREEN}✓ E2E 测试通过${NC}"
else
  echo -e "${YELLOW}跳过 E2E 测试${NC}"
fi
echo ""

# 测试完成
echo "=========================================="
echo -e "${GREEN}✅ 所有测试通过！${NC}"
echo "=========================================="
echo ""
echo "可以安全提交代码。"
echo ""

# 显示报告位置
if [ "$RUN_COVERAGE" = true ]; then
  echo "覆盖率报告: coverage/index.html"
fi

if [ "$RUN_E2E" = true ]; then
  echo "E2E 报告: npx playwright show-report"
fi
