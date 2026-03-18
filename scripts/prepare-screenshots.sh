#!/bin/bash
# Chrome Web Store 截图准备脚本
# 使用 Playwright MCP 工具自动化截图

set -e

echo "=== NotOnlyTranslator 截图准备脚本 ==="
echo ""

# 检查 dist 目录是否存在
if [ ! -d "dist" ]; then
    echo "❌ dist 目录不存在，请先运行 npm run build"
    exit 1
fi

echo "✅ 扩展构建文件已准备"
echo ""

# 创建截图目录
mkdir -p assets/screenshots

echo "📸 截图规格要求:"
echo "  - 主界面截图: 1280x800px"
echo "  - Popup 截图: 640x400px"
echo "  - 格式: PNG"
echo ""

echo "📝 手动截图步骤:"
echo ""
echo "1. 在 Chrome 中加载扩展:"
echo "   - 打开 chrome://extensions/"
echo "   - 启用开发者模式"
echo "   - 点击'加载已解压的扩展程序'"
echo "   - 选择 dist 目录"
echo ""

echo "2. 配置扩展:"
echo "   - 点击扩展图标打开 Popup"
echo "   - 点击'设置'进入 Options 页面"
echo "   - 配置 API Key (可使用测试密钥)"
echo "   - 设置英语水平 (如 CET-6)"
echo ""

echo "3. 访问测试页面:"
echo "   - 打开英文技术文档 (如 https://developer.mozilla.org/en-US/docs/Web/JavaScript)"
echo "   - 等待页面扫描和高亮完成"
echo ""

echo "4. 截取以下画面:"
echo ""
echo "   📱 截图1: Popup 界面 (640x400)"
echo "   - 操作: 点击扩展图标"
echo "   - 内容: 显示用户等级、统计数据"
echo "   - 保存: assets/screenshots/screenshot-1-popup.png"
echo ""

echo "   🌐 截图2: 网页高亮效果 (1280x800)"
echo "   - 操作: 在英文页面上查看高亮单词"
echo "   - 内容: 显示多种颜色的高亮单词"
echo "   - 保存: assets/screenshots/screenshot-2-highlight.png"
echo ""

echo "   💬 截图3: 翻译提示框 (1280x800)"
echo "   - 操作: 鼠标悬停在高亮单词上"
echo "   - 内容: 显示翻译、音标、标记按钮"
echo "   - 保存: assets/screenshots/screenshot-3-tooltip.png"
echo ""

echo "   ⚙️ 截图4: 设置页面 (1280x800)"
echo "   - 操作: 打开 Options 页面"
echo "   - 内容: 显示所有设置选项"
echo "   - 保存: assets/screenshots/screenshot-4-settings.png"
echo ""

echo "   📊 截图5: 统计仪表盘 (1280x800)"
echo "   - 操作: 切换到统计标签页"
echo "   - 内容: 显示学习图表和数据"
echo "   - 保存: assets/screenshots/screenshot-5-stats.png"
echo ""

echo "   🌙 截图6: 暗色模式 (1280x800)"
echo "   - 操作: 切换到暗色主题"
echo "   - 内容: 显示暗色模式下的界面"
echo "   - 保存: assets/screenshots/screenshot-6-darkmode.png"
echo ""

echo "5. 使用 Playwright MCP 自动化截图:"
echo "   - 可以使用 browser_navigate 访问测试页面"
echo "   - 使用 browser_screenshot 截取指定区域"
echo ""

echo "✅ 截图准备脚本执行完毕"
echo ""
echo "下一步: 按照上述步骤手动截图，或使用 Playwright MCP 工具自动化截图"
