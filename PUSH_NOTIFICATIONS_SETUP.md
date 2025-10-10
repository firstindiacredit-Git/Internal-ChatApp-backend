# Push Notifications Setup Guide

This guide will help you set up Web Push Notifications for your Internal Chat Application.

## 🚀 Quick Start

### Step 1: Install Dependencies
The `web-push` package has already been installed. If you need to reinstall:
```bash
cd Backend
npm install web-push
```

### Step 2: Generate VAPID Keys

VAPID keys are required for web push notifications. You can generate them in two ways:

#### Option A: Using the API Endpoint (Recommended)
1. Start your server:
   ```bash
   npm start
   ```

2. Visit this URL in your browser:
   ```
   http://localhost:5002/api/push-notifications/generate-vapid-keys
   ```

3. Copy the generated public and private keys

#### Option B: Using Node.js Command Line
1. Create a temporary file `generate-keys.js`:
   ```javascript
   const webpush = require('web-push');
   const vapidKeys = webpush.generateVAPIDKeys();
   console.log('Public Key:', vapidKeys.publicKey);
   console.log('Private Key:', vapidKeys.privateKey);
   ```

2. Run it:
   ```bash
   node generate-keys.js
   ```

### Step 3: Add VAPID Keys to config.env

Open `Backend/config.env` and add your generated keys:

```env
# Web Push Notifications (VAPID Keys)
VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY_HERE
VAPID_PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE
VAPID_MAILTO=mailto:your-email@example.com
```

**Important:** 
- Replace `YOUR_PUBLIC_KEY_HERE` and `YOUR_PRIVATE_KEY_HERE` with your actual generated keys
- Replace `your-email@example.com` with your actual email address
- Keep these keys secure and never commit them to public repositories

### Step 4: Restart Your Server

After adding the VAPID keys, restart your backend server:
```bash
npm start
```

## 📱 Testing Push Notifications

### Access the Demo Page

Once your server is running with VAPID keys configured, visit:
```
http://localhost:5002/push-demo.html
```

### Test Flow:
1. Click **"Enable Notifications"** button
2. Allow notifications when your browser prompts you
3. Click **"Send Test Notification"** to receive a test push notification
4. You should see a notification even if the browser tab is in the background

## 🔧 API Endpoints

Your application now has the following push notification endpoints:

### Get VAPID Public Key
```
GET /api/push-notifications/vapid-public-key
```
Returns the public VAPID key for client-side subscription.

### Subscribe to Notifications
```
POST /api/push-notifications/subscribe
Body: {subscription object from browser}
```
Saves a user's push subscription.

### Send Notification to All Users
```
POST /api/push-notifications/send-notification
Body: {
  "title": "Notification Title",
  "body": "Notification message",
  "icon": "/icon.png",
  "data": {}
}
```

### Send Notification to Specific User
```
POST /api/push-notifications/send-notification-to-user
Body: {
  "endpoint": "user-subscription-endpoint",
  "title": "Notification Title",
  "body": "Notification message"
}
```

### Unsubscribe
```
POST /api/push-notifications/unsubscribe
Body: {
  "endpoint": "subscription-endpoint"
}
```

### Get Subscription Count
```
GET /api/push-notifications/subscription-count
```

## 🔗 Integration with Your Chat App

To integrate push notifications with your chat application:

### 1. Subscribe Users on Login
Add this code to your frontend after user authentication:

```javascript
async function subscribeUserToPush() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      // Get VAPID public key from server
      const response = await fetch('/api/push-notifications/vapid-public-key');
      const { publicKey } = await response.json();
      
      // Register service worker
      const registration = await navigator.serviceWorker.register('/push-sw.js');
      await navigator.serviceWorker.ready;
      
      // Subscribe to push notifications
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      
      // Send subscription to server
      await fetch('/api/push-notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      
      console.log('✓ Subscribed to push notifications');
    } catch (error) {
      console.error('Push subscription failed:', error);
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
```

### 2. Send Notifications on New Messages
Add this to your backend message handling (in `server.js`):

```javascript
// After saving a message, send push notification
const webpush = require('web-push');

// Example: Notify receiver of new message
socket.on('send-message', async (data) => {
  // ... existing message handling code ...
  
  // Send push notification to receiver
  try {
    await fetch('http://localhost:5002/api/push-notifications/send-notification-to-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: receiverSubscriptionEndpoint, // Get this from user profile
        title: `New message from ${senderName}`,
        body: message.substring(0, 100), // Truncate long messages
        icon: senderProfileImage,
        data: {
          type: 'new-message',
          senderId: senderId,
          messageId: newMessage._id
        }
      })
    });
  } catch (error) {
    console.error('Failed to send push notification:', error);
  }
});
```

## 🌐 Browser Support

Web Push Notifications are supported in:
- ✅ Chrome 42+
- ✅ Firefox 44+
- ✅ Edge 17+
- ✅ Opera 37+
- ✅ Safari 16+ (macOS 13+, iOS 16.4+)

## 🔒 Security Notes

1. **HTTPS Required**: Push notifications require HTTPS in production (localhost works for development)
2. **Keep VAPID Keys Secret**: Never expose your private VAPID key
3. **User Permission**: Always request permission before subscribing users
4. **Respect Privacy**: Only send relevant notifications to avoid spam

## 🐛 Troubleshooting

### Notifications Not Working?
1. Check if VAPID keys are set in `config.env`
2. Ensure server is running on `http://localhost:5002`
3. Check browser console for errors
4. Verify browser supports push notifications
5. Make sure you've allowed notifications in browser settings

### "Service Worker Failed to Register"
- Ensure the service worker file (`push-sw.js`) is in the `Backend/public` folder
- Check browser console for specific errors
- Clear browser cache and try again

### "Subscription Failed"
- Verify VAPID keys are correctly set
- Check network tab for API errors
- Ensure you have an active internet connection

## 📚 Additional Resources

- [Web Push Protocol](https://tools.ietf.org/html/rfc8030)
- [Service Workers MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Push API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [web-push npm package](https://www.npmjs.com/package/web-push)

## 🎉 You're All Set!

Push notifications are now integrated into your chat application. Users can receive real-time notifications for:
- New messages
- Incoming calls
- Group mentions
- Important updates

Enjoy your enhanced real-time chat experience!

