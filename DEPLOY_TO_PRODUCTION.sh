#!/bin/bash
# Deploy config.env to production server

echo "🚀 Deploying Push Notification Config to Production"
echo "=================================================="
echo ""

# Configuration - UPDATE THESE VALUES
PRODUCTION_SERVER="your-username@your-server-ip"
PRODUCTION_PATH="/path/to/internalchatapp/Backend"

echo "⚠️  IMPORTANT: Update these values in this script first:"
echo "   PRODUCTION_SERVER: $PRODUCTION_SERVER"
echo "   PRODUCTION_PATH: $PRODUCTION_PATH"
echo ""

# Uncomment these lines after updating the configuration above
# echo "📤 Uploading config.env to production..."
# scp config.env $PRODUCTION_SERVER:$PRODUCTION_PATH/config.env

# echo "🔄 Restarting production server..."
# ssh $PRODUCTION_SERVER "cd $PRODUCTION_PATH && pm2 restart all"

# echo "✅ Deployment complete!"
# echo ""
# echo "🧪 Test the deployment:"
# echo "   Visit: https://internalchat.pizeonfly.com/api/push-notifications/vapid-public-key"
# echo "   Should show: { \"configured\": true }"

echo "=================================================="
echo "📋 Manual Deployment Steps:"
echo ""
echo "1. Upload config.env to your production server:"
echo "   scp config.env your-user@your-server:/path/to/Backend/"
echo ""
echo "2. SSH into your production server:"
echo "   ssh your-user@your-server"
echo ""
echo "3. Restart your Node.js application:"
echo "   cd /path/to/Backend"
echo "   pm2 restart all"
echo "   # OR"
echo "   sudo systemctl restart your-app-service"
echo ""
echo "4. Verify the deployment:"
echo "   curl https://internalchat.pizeonfly.com/api/push-notifications/vapid-public-key"
echo ""
echo "   Expected response:"
echo "   {\"configured\": true, \"publicKey\": \"BIEm8HC4k...\"}"
echo ""
echo "=================================================="

