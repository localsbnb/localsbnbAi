#!/bin/bash

# 路客云MCP Server 安装脚本

echo "🚀 开始安装路客云MCP Server..."

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到Node.js，请先安装Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ 错误: Node.js版本过低，需要18+，当前版本: $(node -v)"
    exit 1
fi

echo "✅ Node.js版本检查通过: $(node -v)"

# 安装依赖
echo ""
echo "📦 安装依赖..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败"
    exit 1
fi

echo "✅ 依赖安装完成"

# 构建项目
echo ""
echo "🔨 构建项目..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 构建失败"
    exit 1
fi

echo "✅ 构建完成"

# 检查.env文件
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  未找到.env文件，正在从模板创建..."
    if [ -f env.template ]; then
        cp env.template .env
        echo "✅ 已创建.env文件，请编辑并填写您的配置"
    else
        echo "❌ 未找到env.template文件"
    fi
fi

# 获取绝对路径
PROJECT_DIR=$(pwd)
DIST_FILE="$PROJECT_DIR/dist/index.js"

echo ""
echo "✅ 安装完成！"
echo ""
echo "📝 下一步："
echo "1. 编辑 .env 文件，填写您的配置："
echo "   - HUDSON_ACCESS_TOKEN"
echo "   - CAMP_ID"
echo ""
echo "2. 配置Cursor MCP Server："
echo "   配置文件位置: ~/.cursor/mcp.json 或 ~/.config/cursor/mcp.json"
echo ""
echo "   添加以下配置："
echo "   {"
echo "     \"mcpServers\": {"
echo "       \"lukeyun-pms\": {"
echo "         \"command\": \"node\","
echo "         \"args\": [\"$DIST_FILE\"],"
echo "         \"env\": {"
echo "           \"LUKEYUN_API_BASE_URL\": \"https://api.lukeyun.com\","
echo "           \"HUDSON_ACCESS_TOKEN\": \"从.env文件读取\","
echo "           \"CAMP_ID\": \"从.env文件读取\""
echo "         }"
echo "       }"
echo "     }"
echo "   }"
echo ""
echo "3. 重启Cursor"
echo ""
echo "📖 详细配置说明请查看: CURSOR_SETUP.md"
