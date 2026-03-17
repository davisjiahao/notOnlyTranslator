#!/bin/bash
# 状态一致性检查脚本
# 用于验证代码状态和文档状态是否一致

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOARD_DIR="${PROJECT_ROOT}/.paperclip/board"
STATUS_DIR="${PROJECT_ROOT}/.paperclip/status"
REPORTS_DIR="${PROJECT_ROOT}/agents"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

log_info() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
    ((WARNINGS++)) || true
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((ERRORS++)) || true
}

log_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# 检查目录结构
check_directories() {
    log_section "目录结构检查"

    local dirs=(
        ".paperclip/board"
        ".paperclip/status/daily"
        ".paperclip/status/weekly"
        ".paperclip/status/sprint"
        ".paperclip/status/archive"
    )

    for dir in "${dirs[@]}"; do
        if [ -d "${PROJECT_ROOT}/${dir}" ]; then
            log_info "目录存在: ${dir}"
        else
            log_warn "目录缺失: ${dir}"
        fi
    done
}

# 检查 board 文件的时间戳
check_board_freshness() {
    log_section "Board 文件时效性检查"

    local today=$(date +%Y-%m-%d)
    local week_ago=$(date -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)

    local outdated=0
    local fresh=0

    for file in "${BOARD_DIR}"/*.md; do
        [ -f "$file" ] || continue

        local filename=$(basename "$file")
        local file_date=$(echo "$filename" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)

        if [ -n "$file_date" ]; then
            if [[ "$file_date" < "$week_ago" ]]; then
                ((outdated++)) || true
            else
                ((fresh++)) || true
            fi
        fi
    done

    if [ $outdated -gt 0 ]; then
        log_warn "发现 ${outdated} 个过时 board 文件（超过7天）"
        log_warn "建议运行: bash scripts/sync-status.sh --archive"
    fi

    if [ $fresh -eq 0 ]; then
        log_warn "没有发现近期的 board 文件"
    else
        log_info "发现 ${fresh} 个近期 board 文件"
    fi
}

# 检查每日状态
check_daily_status() {
    log_section "每日状态检查"

    local today=$(date +%Y-%m-%d)
    local today_file="${STATUS_DIR}/daily/${today}.md"

    if [ -f "$today_file" ]; then
        log_info "今日状态文件已存在: ${today}.md"

        # 检查是否是最新的
        local file_age=$(( ($(date +%s) - $(stat -c %Y "$today_file" 2>/dev/null || stat -f %m "$today_file")) / 60 ))
        if [ $file_age -gt 120 ]; then
            log_warn "今日状态文件已过期 (${file_age} 分钟前创建)"
        fi
    else
        log_warn "今日状态文件不存在: ${today}.md"
        log_warn "建议运行: bash scripts/update-status.sh"
    fi
}

# 检查测试状态
check_test_status() {
    log_section "测试状态检查"

    if [ ! -f "${PROJECT_ROOT}/package.json" ]; then
        log_warn "未找到 package.json"
        return
    fi

    # 检查是否有测试脚本
    if grep -q '"test"' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
        log_info "测试脚本已配置"

        # 可选：实际运行测试（可能较慢）
        if [ "${RUN_TESTS:-false}" == "true" ]; then
            log_info "正在运行测试..."
            if (cd "${PROJECT_ROOT}" && npm test > /dev/null 2>&1); then
                log_info "所有测试通过 ✓"
            else
                log_error "测试失败，请检查测试输出"
            fi
        fi
    else
        log_warn "未配置测试脚本"
    fi
}

# 生成检查报告
generate_report() {
    log_section "检查报告"

    echo ""
    echo "═══════════════════════════════════════════"
    echo "          状态一致性检查报告"
    echo "═══════════════════════════════════════════"
    echo ""
    echo "检查时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "检查项目: $(basename "$PROJECT_ROOT")"
    echo ""
    echo "─────────────── 统计信息 ───────────────"
    echo "  错误数: ${ERRORS}"
    echo "  警告数: ${WARNINGS}"
    echo ""
    echo "─────────────── 结果评估 ───────────────"

    if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
        echo "  ✓ 所有检查通过！"
        echo "  状态文件与代码库保持同步。"
        return 0
    elif [ $ERRORS -eq 0 ]; then
        echo "  ⚠ 检查通过，但有 ${WARNINGS} 个警告"
        echo "  建议运行以下命令："
        echo "    bash scripts/sync-status.sh"
        return 0
    else
        echo "  ✗ 检查发现 ${ERRORS} 个错误"
        echo "  需要立即处理！建议运行："
        echo "    bash scripts/sync-status.sh --full"
        return 1
    fi
}

# 主函数
main() {
    echo "═══════════════════════════════════════════"
    echo "      NotOnlyTranslator 状态一致性检查"
    echo "═══════════════════════════════════════════"
    echo ""

    check_directories
    check_board_freshness
    check_daily_status
    check_test_status
    generate_report
}

# 如果直接运行此脚本
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
