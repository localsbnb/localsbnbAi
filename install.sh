#!/bin/bash

# LocalsBnb MCP Server install script

echo "🚀 Installing LocalsBnb MCP Server..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js not found. Install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ required; current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js OK: $(node -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ npm install failed"
    exit 1
fi

echo "✅ Dependencies installed"

# Build
echo ""
echo "🔨 Building..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build complete"

# .env from template
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  No .env file; creating from template..."
    if [ -f env.template ]; then
        cp env.template .env
        echo "✅ Created .env — edit it with your credentials"
    else
        echo "❌ env.template not found"
    fi
fi

# Absolute path for MCP config snippet
PROJECT_DIR=$(pwd)
DIST_FILE="$PROJECT_DIR/dist/index.js"

echo ""
echo "✅ Install complete!"
echo ""
echo "📝 Next steps:"
echo "1. Edit .env and set:"
echo "   - HUDSON_ACCESS_TOKEN"
echo "   - CAMP_ID"
echo ""
echo "2. Configure Cursor MCP Server:"
echo "   Config file: ~/.cursor/mcp.json or ~/.config/cursor/mcp.json"
echo ""
echo "   Add:"
echo "   {"
echo "     \"mcpServers\": {"
echo "       \"lukeyun-pms\": {"
echo "         \"command\": \"node\","
echo "         \"args\": [\"$DIST_FILE\"],"
echo "         \"env\": {"
echo "           \"LUKEYUN_API_BASE_URL\": \"https://api.lukeyun.com\","
echo "           \"HUDSON_ACCESS_TOKEN\": \"<from your .env file>\","
echo "           \"CAMP_ID\": \"<from your .env file>\""
echo "         }"
echo "       }"
echo "     }"
echo "   }"
echo ""
echo "3. Restart Cursor"
echo ""
echo "📖 See docs/internal/CURSOR_SETUP.md for detailed setup"
