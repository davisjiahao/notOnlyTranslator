#!/bin/bash
# 状态文件更新脚本
# 此脚本在 git commit 前自动更新状态文件

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_DAILY="${PROJECT_ROOT}/.paperclip/status/daily"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[STATUS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 获取今日日期
get_today() {
    date +%Y-%m-%d
}

# 获取今日分支名
get_branch() {
    git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# 获取最近的提交信息
get_last_commit() {
    git -C "${PROJECT_ROOT}" log -1 --pretty=format:"%s" 2>/dev/null || echo "No commits"
}

# 获取今日提交数
get_today_commits() {
    local today=$(get_today)
    git -C "${PROJECT_ROOT}" log --since="${today} 00:00:00" --pretty=oneline 2>/dev/null | wc -l | tr -d ' '
}

# 计算测试通过率（如果有测试）
get_test_status() {
    if [ -f "${PROJECT_ROOT}/package.json" ]; then
        # 检查是否有测试脚本
        if grep -q '"test"' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
            echo "available"
        else
            echo "none"
        fi
    else
        echo "unknown"
    fi
}

# 更新每日状态文件
update_daily_status() {
    local today=$(get_today)
    local status_file="${STATUS_DAILY}/${today}.md"

    mkdir -p "${STATUS_DAILY}"

    local branch=$(get_branch)
    local last_commit=$(get_last_commit)
    local today_commits=$(get_today_commits)
    local test_status=$(get_test_status)

    cat > "$status_file" << EOF
# 每日状态更新 - ${today}

> 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')

## 代码状态

| 指标 | 值 |
|------|-----|
| 当前分支 | ${branch} |
| 今日提交数 | ${today_commits} |
| 最后提交 | ${last_commit} |
| 测试状态 | ${test_status} |

## 文件变更

EOF

    # 添加 git status 信息
    if [ -d "${PROJECT_ROOT}/.git" ]; then
        echo "### 工作区状态" >> "$status_file"
        echo "" >> "$status_file"
        echo "\`\`\`" >> "$status_file"
        git -C "${PROJECT_ROOT}" status --short 2>/dev/null >> "$status_file" || echo "Unable to get git status" >> "$status_file"
        echo "\`\`\`" >> "$status_file"
        echo "" >> "$status_file"
    fi

    cat >> "$status_file" << EOF

## 下一步

- [ ] 确认今日提交内容
- [ ] 更新相关文档
- [ ] 同步状态到 board

---

*此文件由 pre-commit hook 自动生成*
EOF

    log_info "已更新每日状态: ${status_file}"
}

# 检查是否有未同步的状态更新
 check_sync_status() {
    local board_dir="${PROJECT_ROOT}/.paperclip/board"
    local latest_board=$(ls -t "${board_dir}"/*.md 2>/dev/null | head -1)

    if [ -z "$latest_board" ]; then
        log_warn "未找到 board 状态文件"
        return 1
    fi

    local board_date=$(basename "$latest_board" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
    local today=$(get_today)

    if [ "$board_date" != "$today" ]; then
        log_warn "board 状态文件已过期 (最新: ${board_date}, 今天: ${today})"
        return 1
    fi

    log_info "board 状态文件已是最新"
    return 0
}

# 主函数
main() {
    log_info "开始更新状态文件..."

    # 更新每日状态
    update_daily_status

    # 检查同步状态
    if ! check_sync_status; then
        log_warn "建议在提交前手动同步 board 状态"
    fi

    log_info "状态更新完成！"
}

# 如果直接运行此脚本
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
