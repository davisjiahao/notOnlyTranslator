#!/bin/bash
# Git Hooks 设置脚本
# 配置项目使用自定义 Git Hooks

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="${PROJECT_ROOT}/.githooks"
GIT_HOOKS_DIR="${PROJECT_ROOT}/.git/hooks"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# 验证环境
validate_environment() {
    log_section "环境验证"

    # 检查是否在 git 仓库中
    if [ ! -d "${PROJECT_ROOT}/.git" ]; then
        log_error "当前目录不是 Git 仓库"
        exit 1
    fi
    log_info "Git 仓库验证通过"

    # 检查 hooks 目录是否存在
    if [ ! -d "$HOOKS_DIR" ]; then
        log_error "项目 hooks 目录不存在: ${HOOKS_DIR}"
        exit 1
    fi
    log_info "项目 hooks 目录存在"

    # 检查关键脚本是否存在
    local scripts=(
        "scripts/update-status.sh"
        "scripts/sync-status.sh"
        "scripts/check-status.sh"
    )

    for script in "${scripts[@]}"; do
        if [ -f "${PROJECT_ROOT}/${script}" ]; then
            log_info "脚本存在: ${script}"
        else
            log_warn "脚本不存在: ${script}"
        fi
    done
}

# 配置 Git 使用项目 hooks
configure_git_hooks() {
    log_section "配置 Git Hooks"

    # 设置 git hooks 目录
    git -C "$PROJECT_ROOT" config core.hooksPath "$HOOKS_DIR"

    if [ $? -eq 0 ]; then
        log_info "Git hooks 路径已设置为: ${HOOKS_DIR}"
    else
        log_error "配置 Git hooks 路径失败"
        exit 1
    fi

    # 验证配置
    local configured_path
    configured_path=$(git -C "$PROJECT_ROOT" config core.hooksPath)
    if [ "$configured_path" = "$HOOKS_DIR" ]; then
        log_info "Git hooks 配置验证通过"
    else
        log_error "Git hooks 配置验证失败"
        exit 1
    fi
}

# 验证 hooks 文件
validate_hooks() {
    log_section "验证 Hooks 文件"

    local hooks=(
        "pre-commit"
        "pre-push"
    )

    for hook in "${hooks[@]}"; do
        local hook_path="${HOOKS_DIR}/${hook}"

        if [ -f "$hook_path" ]; then
            if [ -x "$hook_path" ]; then
                log_info "${hook}: 存在且可执行"
            else
                log_warn "${hook}: 存在但不可执行，正在修复..."
                chmod +x "$hook_path"
                log_info "${hook}: 已修复可执行权限"
            fi
        else
            log_error "${hook}: 不存在"
        fi
    done
}

# 运行状态检查
run_status_check() {
    log_section "运行状态一致性检查"

    local check_script="${PROJECT_ROOT}/scripts/check-status.sh"

    if [ -f "$check_script" ]; then
        if bash "$check_script"; then
            log_info "状态检查通过"
        else
            log_warn "状态检查发现问题，建议运行同步脚本"
        fi
    else
        log_warn "状态检查脚本不存在，跳过"
    fi
}

# 生成配置摘要
print_summary() {
    log_section "配置摘要"

    echo ""
    echo "Git Hooks 已成功配置！"
    echo ""
    echo "配置详情:"
    echo "  项目根目录: ${PROJECT_ROOT}"
    echo "  Git hooks 路径: ${HOOKS_DIR}"
    echo ""
    echo "已配置的 hooks:"
    echo "  • pre-commit: 提交前自动更新状态文件"
    echo "  • pre-push: 推送前验证状态同步"
    echo ""
    echo "可用脚本:"
    echo "  • scripts/update-status.sh - 更新每日状态"
    echo "  • scripts/sync-status.sh   - 同步所有状态文件"
    echo "  • scripts/check-status.sh  - 检查状态一致性"
    echo ""
    echo "使用说明:"
    echo "  1. 正常进行代码修改和提交"
    echo "  2. pre-commit hook 会自动更新状态文件"
    echo "  3. pre-push 会检查状态同步"
    echo "  4. 如需手动同步，运行: bash scripts/sync-status.sh"
    echo ""

    if [ $ERRORS -gt 0 ]; then
        echo -e "${RED}注意: 配置过程中发现 ${ERRORS} 个错误，请检查上述日志。${NC}"
        echo ""
        exit 1
    elif [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}注意: 配置过程中发现 ${WARNINGS} 个警告，建议查看日志。${NC}"
        echo ""
    fi
}

# 主函数
main() {
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║        NotOnlyTranslator Git Hooks 设置脚本         ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""

    # 解析参数
    local skip_check=false
    local force=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-check)
                skip_check=true
                shift
                ;;
            --force)
                force=true
                shift
                ;;
            --help)
                echo "用法: $0 [选项]"
                echo ""
                echo "选项:"
                echo "  --skip-check    跳过状态检查"
                echo "  --force         强制重新配置"
                echo "  --help          显示此帮助"
                exit 0
                ;;
            *)
                echo "未知选项: $1"
                echo "使用 --help 查看用法"
                exit 1
                ;;
        esac
    done

    # 验证环境
    validate_environment

    # 检查是否已配置
    local current_path
    current_path=$(git -C "$PROJECT_ROOT" config core.hooksPath 2>/dev/null || echo "")

    if [ -n "$current_path" ] && [ "$force" != "true" ]; then
        log_warn "Git hooks 已经配置: ${current_path}"
        echo ""
        read -p "是否重新配置? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "跳过配置"
            exit 0
        fi
    fi

    # 配置 Git hooks
    configure_git_hooks

    # 验证 hooks 文件
    validate_hooks

    # 运行状态检查（可选）
    if [ "$skip_check" != "true" ]; then
        run_status_check
    fi

    # 生成配置摘要
    print_summary
}

# 运行主函数
main "$@"
