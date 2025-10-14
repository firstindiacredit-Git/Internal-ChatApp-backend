#!/bin/bash

# 🔧 Production Fix Script
# This script fixes the firebase-admin module not found error

echo "🔧 Fixing Production Server..."
echo ""

# Check if we're in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found!"
    echo "Please run this script from the Backend directory"
    exit 1
fi

# Check if config.env exists
if [ ! -f "config.env" ]; then
    echo "⚠️  Warning: config.env not found!"
    echo "Please ensure config.env exists before running the server"
fi

echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ npm install failed!"
    exit 1
fi

echo ""
echo "✅ Dependencies installed successfully"
echo ""

# Check if firebase-admin is installed
echo "🔍 Verifying firebase-admin installation..."
npm list firebase-admin

if [ $? -ne 0 ]; then
    echo "⚠️  firebase-admin not found, installing manually..."
    npm install firebase-admin@^13.5.0
fi

echo ""
echo "🔄 Restarting PM2 process..."

# Try to restart PM2
if command -v pm2 &> /dev/null; then
    pm2 restart internal-chat-app 2>/dev/null || pm2 restart all 2>/dev/null || echo "⚠️  No PM2 process found to restart"
    echo ""
    echo "📊 PM2 Status:"
    pm2 status
    echo ""
    echo "📝 Recent Logs:"
    pm2 logs internal-chat-app --lines 20 --nostream
else
    echo "⚠️  PM2 not found. Start server manually with: node server.js"
fi

echo ""
echo "✅ Fix completed!"
echo ""
echo "To monitor logs, run: pm2 logs internal-chat-app"

