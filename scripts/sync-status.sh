#!/bin/bash
# 状态文件同步脚本
# 保持 .paperclip/board/、agents/*/reports/ 和状态目录同步

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOARD_DIR="${PROJECT_ROOT}/.paperclip/board"
STATUS_DIR="${PROJECT_ROOT}/.paperclip/status"
DAILY_DIR="${STATUS_DIR}/daily"
WEEKLY_DIR="${STATUS_DIR}/weekly"
SPRINT_DIR="${STATUS_DIR}/sprint"
ARCHIVE_DIR="${STATUS_DIR}/archive"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 确保目录结构存在
ensure_directories() {
    log_info "确保目录结构存在..."
    mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}" "${SPRINT_DIR}" "${ARCHIVE_DIR}"
}

# 分析 board 目录中的文件状态
analyze_board_files() {
    log_info "分析 board 目录..."

    local today=$(date +%Y-%m-%d)
    local week_ago=$(date -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)

    local outdated_count=0
    local recent_count=0

    for file in "${BOARD_DIR}"/*.md; do
        [ -f "$file" ] || continue

        # 提取文件日期
        local filename=$(basename "$file")
        local file_date=$(echo "$filename" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)

        if [ -n "$file_date" ]; then
            if [[ "$file_date" < "$week_ago" ]]; then
                ((outdated_count++)) || true
            else
                ((recent_count++)) || true
            fi
        fi
    done

    log_info "发现 ${recent_count} 个近期文件，${outdated_count} 个过时文件（7天前）"

    # 返回过时文件数量
    echo "$outdated_count"
}

# 将过时的 board 文件归档
archive_outdated_files() {
    local archive_count=0
    local today=$(date +%Y-%m-%d)
    local week_ago=$(date -d "7 days ago" +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)

    log_info "归档超过7天的旧文件..."

    for file in "${BOARD_DIR}"/*.md; do
        [ -f "$file" ] || continue

        local filename=$(basename "$file")
        local file_date=$(echo "$filename" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)

        if [ -n "$file_date" ] && [[ "$file_date" < "$week_ago" ]]; then
            # 跳过 README 等文档
            if [[ "$filename" == "README"* ]] || [[ "$filename" == "INDEX"* ]]; then
                continue
            fi

            log_info "归档: $filename"
            mv "$file" "${ARCHIVE_DIR}/"
            ((archive_count++)) || true
        fi
    done

    log_info "归档完成，共归档 ${archive_count} 个文件"
}

# 创建最新的状态索引
create_status_index() {
    log_info "创建状态索引..."

    local today=$(date +%Y-%m-%d)
    local index_file="${STATUS_DIR}/INDEX.md"

    cat > "$index_file" << EOF
# 项目状态索引

> 自动生成于: ${today}

## 快速链接

- [今日状态](./daily/) - 每日状态更新
- [本周汇总](./weekly/) - 每周状态报告
- [Sprint 状态](./sprint/) - Sprint 进度跟踪
- [归档历史](./archive/) - 历史状态归档

## 最新状态

EOF

    # 查找最新的状态文件并添加链接
    local latest_daily=$(ls -t "${DAILY_DIR}"/*.md 2>/dev/null | head -1)
    if [ -n "$latest_daily" ]; then
        local daily_name=$(basename "$latest_daily")
        echo "- [今日日报 - ${daily_name}](./daily/${daily_name})" >> "$index_file"
    fi

    local latest_weekly=$(ls -t "${WEEKLY_DIR}"/*.md 2>/dev/null | head -1)
    if [ -n "$latest_weekly" ]; then
        local weekly_name=$(basename "$latest_weekly")
        echo "- [本周汇总 - ${weekly_name}](./weekly/${weekly_name})" >> "$index_file"
    fi

    echo "" >> "$index_file"
    echo "---" >> "$index_file"
    echo "" >> "$index_file"
    echo "*最后更新: ${today}*" >> "$index_file"

    log_info "状态索引已创建: ${index_file}"
}

# 主函数
main() {
    log_info "开始状态文件同步..."

    # 确保目录存在
    ensure_directories

    # 分析 board 文件
    local outdated_count=$(analyze_board_files)

    # 如果有过时文件，询问是否归档
    if [ "$outdated_count" -gt 0 ]; then
        archive_outdated_files
    fi

    # 创建状态索引
    create_status_index

    log_info "状态同步完成！"
}

# 如果直接运行此脚本
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
