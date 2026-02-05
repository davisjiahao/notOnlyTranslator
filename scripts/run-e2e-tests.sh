#!/bin/bash

# Chrome 扩展 E2E 测试运行脚本
# 使用方法: ./scripts/run-e2e-tests.sh [options]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 帮助信息
show_help() {
    echo -e "${BLUE}NotOnlyTranslator E2E 测试运行脚本${NC}"
    echo ""
    echo "用法: ./scripts/run-e2e-tests.sh [选项]"
    echo ""
    echo "选项:"
    echo "  -h, --help          显示帮助信息"
    echo "  -u, --ui            以 UI 模式运行（非 headless）"
    echo "  -d, --debug         以调试模式运行"
    echo "  -s, --specific      运行特定测试文件"
    echo "  -r, --report        生成 HTML 报告"
    echo "  -c, --coverage      收集覆盖率信息"
    echo ""
    echo "示例:"
    echo "  ./scripts/run-e2e-tests.sh              # 运行所有测试"
    echo "  ./scripts/run-e2e-tests.sh -u             # 以 UI 模式运行"
    echo "  ./scripts/run-e2e-tests.sh -s translation # 运行 translation 相关测试"
    echo ""
}

# 默认参数
UI_MODE=false
DEBUG_MODE=false
SPECIFIC_TEST=""
GENERATE_REPORT=false
COVERAGE=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -u|--ui)
            UI_MODE=true
            shift
            ;;
        -d|--debug)
            DEBUG_MODE=true
            shift
            ;;
        -s|--specific)
            if [[ -n "$2" && ! "$2" =~ ^- ]]; then
                SPECIFIC_TEST="$2"
                shift 2
            else
                echo -e "${RED}错误: --specific 需要一个测试文件名参数${NC}"
                exit 1
            fi
            ;;
        -r|--report)
            GENERATE_REPORT=true
            shift
            ;;
        -c|--coverage)
            COVERAGE=true
            shift
            ;;
        *)
            echo -e "${RED}错误: 未知参数 $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# 检查依赖
echo -e "${BLUE}🔍 检查依赖...${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm 未安装${NC}"
    exit 1
fi

if ! npx playwright --version &> /dev/null; then
    echo -e "${YELLOW}⚠️  Playwright 未安装，正在安装...${NC}"
    npm install -D @playwright/test
    npx playwright install chromium
fi

# 检查扩展构建
echo -e "${BLUE}🔍 检查扩展构建...${NC}"
if [[ ! -d "./dist" ]]; then
    echo -e "${YELLOW}⚠️  扩展未构建，正在构建...${NC}"
    npm run build
else
    echo -e "${GREEN}✅ 扩展已构建${NC}"
fi

# 构建 Playwright 参数
echo ""
echo -e "${BLUE}🚀 启动 E2E 测试...${NC}"
echo ""

PLAYWRIGHT_ARGS=""

# UI 模式
if [[ "$UI_MODE" == "true" ]]; then
    PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS --ui"
    echo -e "${YELLOW}🖥️  UI 模式已启用${NC}"
fi

# 调试模式
if [[ "$DEBUG_MODE" == "true" ]]; then
    export PWDEBUG=1
    PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS --debug"
    echo -e "${YELLOW}🐛 调试模式已启用${NC}"
fi

# 特定测试文件
if [[ -n "$SPECIFIC_TEST" ]]; then
    PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS $SPECIFIC_TEST"
    echo -e "${YELLOW}📝 运行特定测试: $SPECIFIC_TEST${NC}"
fi

# 生成报告
if [[ "$GENERATE_REPORT" == "true" ]]; then
    PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS --reporter=html"
    echo -e "${YELLOW}📊 HTML 报告将在测试后生成${NC}"
fi

# 覆盖率
if [[ "$COVERAGE" == "true" ]]; then
    echo -e "${YELLOW}📈 覆盖率收集已启用${NC}"
fi

echo ""
echo -e "${BLUE}⏳ 运行测试中...${NC}"
echo ""

# 运行 Playwright
if npx playwright test $PLAYWRIGHT_ARGS; then
    echo ""
    echo -e "${GREEN}✅ 所有测试通过！${NC}"
    echo ""

    # 显示报告路径
    if [[ "$GENERATE_REPORT" == "true" ]]; then
        echo -e "${BLUE}📊 查看报告:${NC}"
        echo "   npx playwright show-report"
        echo "   或在浏览器中打开: playwright-report/index.html"
        echo ""
    fi

    exit 0
else
    echo ""
    echo -e "${RED}❌ 测试失败${NC}"
    echo ""
    echo -e "${YELLOW}调试提示:${NC}"
    echo "   1. 使用 --ui 参数以 UI 模式运行: ./scripts/run-e2e-tests.sh -u"
    echo "   2. 使用 --debug 参数以调试模式运行: ./scripts/run-e2e-tests.sh -d"
    echo "   3. 查看测试报告: npx playwright show-report"
    echo ""

    exit 1
fi