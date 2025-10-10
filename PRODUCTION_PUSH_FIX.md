# 🔧 Fix Push Notifications on Production

## ❌ Problem Identified

VAPID keys are **NOT being loaded** in your production environment at https://internalchat.pizeonfly.com/

### Diagnostic Results:
```
VAPID_PUBLIC_KEY: ❌ Not Set
VAPID_PRIVATE_KEY: ❌ Not Set
VAPID_MAILTO: ❌ Not Set
```

## ✅ Solution

You have **TWO OPTIONS** to fix this:

---

## **OPTION 1: Add Environment Variables to Production Server (Recommended)**

### Step 1: SSH into your production server
```bash
ssh your-username@your-server
```

### Step 2: Navigate to your app directory
```bash
cd /path/to/internalchatapp/Backend
```

### Step 3: Verify config.env exists and has the keys
```bash
cat config.env | grep VAPID
```

You should see:
```
VAPID_PUBLIC_KEY=BIEm8HC4k87rhonKudFzN88UiFPPxSkCi7A1nbCzXgRoDkp5xA91UeojzDYk5YIXVB6P-uXwIgnaKiOL2CqmjIA
VAPID_PRIVATE_KEY=BXz_TeXF3cPmk6gLnc7jkNxi8XiX144GlMGKa-VPpMA
VAPID_MAILTO=mailto:pizeonflyn@gmail.com
```

### Step 4: Restart your Node.js process
```bash
# If using PM2
pm2 restart all

# Or if using systemd
sudo systemctl restart your-app-service

# Or if running directly
# Kill the old process and restart
pkill -f "node server.js"
node server.js
```

---

## **OPTION 2: Set Environment Variables Directly (Alternative)**

If the config.env file is not being loaded properly, set the environment variables directly:

### Using PM2 (Recommended for Production):

Create or edit `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'internalchat',
    script: './server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 5001,
      VAPID_PUBLIC_KEY: 'BIEm8HC4k87rhonKudFzN88UiFPPxSkCi7A1nbCzXgRoDkp5xA91UeojzDYk5YIXVB6P-uXwIgnaKiOL2CqmjIA',
      VAPID_PRIVATE_KEY: 'BXz_TeXF3cPmk6gLnc7jkNxi8XiX144GlMGKa-VPpMA',
      VAPID_MAILTO: 'mailto:pizeonflyn@gmail.com'
    }
  }]
}
```

Then restart:
```bash
pm2 restart ecosystem.config.js
```

### Using systemd service file:

Edit your service file:
```bash
sudo nano /etc/systemd/system/your-app.service
```

Add these lines under `[Service]`:
```
Environment="VAPID_PUBLIC_KEY=BIEm8HC4k87rhonKudFzN88UiFPPxSkCi7A1nbCzXgRoDkp5xA91UeojzDYk5YIXVB6P-uXwIgnaKiOL2CqmjIA"
Environment="VAPID_PRIVATE_KEY=BXz_TeXF3cPmk6gLnc7jkNxi8XiX144GlMGKa-VPpMA"
Environment="VAPID_MAILTO=mailto:pizeonflyn@gmail.com"
```

Then reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart your-app
```

---

## 🧪 Verify the Fix

### Test 1: Check if VAPID keys are loaded

Visit this URL in your browser:
```
https://internalchat.pizeonfly.com/api/push-notifications/vapid-public-key
```

You should see:
```json
{
  "publicKey": "BIEm8HC4k87rhonKudFzN88UiFPPxSkCi7A1nbCzXgRoDkp5xA91UeojzDYk5YIXVB6P-uXwIgnaKiOL2CqmjIA",
  "configured": true
}
```

✅ If `"configured": true` → **Keys are loaded!**
❌ If `"configured": false` → **Keys still not loaded**

### Test 2: Check Service Worker

Visit:
```
https://internalchat.pizeonfly.com/push-sw.js
```

You should see the service worker JavaScript code.

### Test 3: Test Push Notification Demo

Visit:
```
https://internalchat.pizeonfly.com/push-demo.html
```

1. Click "Enable Notifications"
2. Allow notifications in your browser
3. Click "Send Test Notification"
4. You should receive a push notification! 🎉

### Test 4: Test in Chat App

1. Login to https://internalchat.pizeonfly.com/
2. Open browser console (F12) → Console tab
3. You should see: `✅ Push notifications initialized`
4. Open a second browser/device and login as another user
5. Close the second browser
6. Send a message to that user from the first browser
7. The second user should receive a push notification!

---

## 🔍 Additional Debugging

### Check Server Logs

Look for these messages in your production server logs:

✅ **Good signs:**
```
✅ New push subscription for user: 507f1f77...
📊 Total subscriptions: 3
📤 Push notification sent to user: 507f1f77...
```

❌ **Bad signs:**
```
Push notifications are not configured on the server
VAPID keys not found
```

### Browser Console Checks

Open DevTools (F12) on https://internalchat.pizeonfly.com/:

**Console Tab:**
Look for:
- `✅ Push notifications initialized`
- `✅ Service Worker registered`
- `✅ Push subscription created`

**Application Tab → Service Workers:**
- Should show `push-sw.js` as registered and activated
- Status should be "activated and is running"

**Application Tab → Push Messaging:**
- Should show subscription status

---

## 🚨 Common Issues & Solutions

### Issue 1: "Push notifications are not configured on the server"
**Cause:** VAPID keys not loaded
**Solution:** Follow Option 1 or 2 above

### Issue 2: Service Worker registration failed
**Cause:** Service worker file not accessible
**Solution:** 
- Ensure `Backend/dist/push-sw.js` exists
- Rebuild frontend: `cd Frontend && npm run build`
- Copy dist to Backend: `cp -r Frontend/dist/* Backend/dist/`

### Issue 3: "Notification permission denied"
**Cause:** User denied notification permission
**Solution:** 
- User needs to allow notifications in browser settings
- Chrome: Settings → Privacy and security → Site settings → Notifications
- Firefox: Settings → Privacy & Security → Permissions → Notifications

### Issue 4: Push notifications work locally but not in production
**Cause:** Environment variables not set in production
**Solution:** Follow the steps in this guide

---

## 📋 Quick Checklist

- [ ] VAPID keys are set in production environment
- [ ] Production server has been restarted
- [ ] `/api/push-notifications/vapid-public-key` returns `"configured": true`
- [ ] `/push-sw.js` is accessible and returns the service worker code
- [ ] Browser console shows "Push notifications initialized"
- [ ] Service worker is registered in Application tab
- [ ] Test notification works on `/push-demo.html`
- [ ] Push notifications work in the chat app

---

## 🎉 Once Fixed

After following these steps, push notifications will work on production:

✅ Users auto-subscribe on login
✅ Offline users receive push notifications for messages
✅ Online users get real-time updates (no push needed)
✅ Group messages notify all offline members
✅ Rich notifications with sender info and preview

---

## 📞 Still Not Working?

If you've followed all steps and it's still not working:

1. **Check PM2 logs:**
   ```bash
   pm2 logs
   ```

2. **Check system logs:**
   ```bash
   sudo journalctl -u your-app-service -n 100
   ```

3. **Test the endpoint manually:**
   ```bash
   curl https://internalchat.pizeonfly.com/api/push-notifications/vapid-public-key
   ```

4. **Verify environment in production:**
   ```bash
   node -e "require('dotenv').config({ path: './config.env' }); console.log('VAPID_PUBLIC_KEY:', process.env.VAPID_PUBLIC_KEY ? 'SET' : 'NOT SET')"
   ```

Need more help? Check the server logs for specific error messages!

