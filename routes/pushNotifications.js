const express = require("express");
const webpush = require("web-push");
const router = express.Router();

// Store subscriptions with user IDs in memory (in production, use a database)
// Structure: { userId: string, subscription: object, createdAt: Date }
let subscriptions = [];

// VAPID keys setup - will be configured from environment variables
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Get VAPID public key
router.get("/vapid-public-key", (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    configured: !!(
      process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ),
  });
});

// Generate VAPID keys (one-time setup endpoint - should be protected in production)
router.get("/generate-vapid-keys", (req, res) => {
  const vapidKeys = webpush.generateVAPIDKeys();
  res.json({
    message: "Generated VAPID keys. Add these to your config.env file:",
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    note: "These keys should be kept secure and added to your config.env file",
  });
});

// Save subscription
router.post("/subscribe", (req, res) => {
  const { userId, endpoint, keys, expirationTime } = req.body;

  // Create subscription object
  const subscription = { endpoint, keys, expirationTime };

  // Check if subscription already exists for this user
  const existingIndex = subscriptions.findIndex(
    (sub) => sub.subscription.endpoint === endpoint || sub.userId === userId
  );

  if (existingIndex !== -1) {
    // Update existing subscription
    subscriptions[existingIndex] = {
      userId,
      subscription,
      createdAt: new Date(),
    };
    console.log(`✅ Updated push subscription for user: ${userId}`);
  } else {
    // Add new subscription
    subscriptions.push({
      userId,
      subscription,
      createdAt: new Date(),
    });
    console.log(`✅ New push subscription for user: ${userId}`);
  }

  console.log(`📊 Total subscriptions: ${subscriptions.length}`);
  res.status(201).json({ message: "Subscription saved successfully" });
});

// Unsubscribe
router.post("/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  const beforeCount = subscriptions.length;
  subscriptions = subscriptions.filter(
    (sub) => sub.subscription.endpoint !== endpoint
  );
  const removed = beforeCount - subscriptions.length;
  console.log(`✅ Removed ${removed} push notification subscription(s)`);
  res.json({ message: "Unsubscribed successfully" });
});

// Send notification to all subscribed users
router.post("/send-notification", async (req, res) => {
  const { title, body, icon, data } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: "Title and body are required" });
  }

  const notificationPayload = {
    notification: {
      title: title,
      body: body,
      icon: icon || "/icon.png",
      badge: "/badge.png",
      vibrate: [200, 100, 200],
      data: data || {},
    },
  };

  if (subscriptions.length === 0) {
    return res.status(400).json({
      error: "No subscriptions available",
      message: "Please subscribe to notifications first",
    });
  }

  const sendPromises = subscriptions.map((sub) =>
    webpush
      .sendNotification(sub.subscription, JSON.stringify(notificationPayload))
      .catch((err) => {
        console.error("Error sending notification to subscription:", err);
        // Remove failed subscriptions
        subscriptions = subscriptions.filter(
          (s) => s.subscription.endpoint !== sub.subscription.endpoint
        );
        return { error: true, endpoint: sub.subscription.endpoint };
      })
  );

  try {
    const results = await Promise.all(sendPromises);
    const failedCount = results.filter((r) => r && r.error).length;
    const successCount = subscriptions.length;

    res.status(200).json({
      message: "Notifications sent",
      sent: successCount,
      failed: failedCount,
      total: successCount + failedCount,
    });

    console.log(
      `📤 Sent ${successCount} push notifications (${failedCount} failed)`
    );
  } catch (err) {
    console.error("Error sending notifications:", err);
    res.status(500).json({
      error: "Error sending notification",
      details: err.message,
    });
  }
});

// Send notification to specific user (by userId)
router.post("/send-notification-to-user", async (req, res) => {
  const { userId, title, body, icon, data } = req.body;

  if (!userId || !title || !body) {
    return res
      .status(400)
      .json({ error: "userId, title, and body are required" });
  }

  // Find subscription for this user
  const userSub = subscriptions.find((sub) => sub.userId === userId);

  if (!userSub) {
    return res.status(404).json({ error: "Subscription not found for user" });
  }

  const notificationPayload = {
    notification: {
      title: title,
      body: body,
      icon: icon || "/icon.png",
      badge: "/badge.png",
      vibrate: [200, 100, 200],
      data: data || {},
    },
  };

  try {
    await webpush.sendNotification(
      userSub.subscription,
      JSON.stringify(notificationPayload)
    );
    res.status(200).json({ message: "Notification sent successfully" });
    console.log(`📤 Sent push notification to user: ${userId}`);
  } catch (err) {
    console.error("Error sending notification:", err);
    // Remove failed subscription
    subscriptions = subscriptions.filter((s) => s.userId !== userId);
    res.status(500).json({
      error: "Error sending notification",
      details: err.message,
    });
  }
});

// Get subscription count
router.get("/subscription-count", (req, res) => {
  res.json({
    count: subscriptions.length,
    configured: !!(
      process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ),
  });
});

// Helper function to send push notification (exported for use in server.js)
async function sendPushToUser(userId, title, body, icon, data = {}) {
  try {
    const userSub = subscriptions.find((sub) => sub.userId === userId);

    if (!userSub) {
      console.log(`ℹ️ No push subscription found for user: ${userId}`);
      return { success: false, error: "No subscription found" };
    }

    const notificationPayload = {
      notification: {
        title,
        body,
        icon: icon || "/icon.png",
        badge: "/badge.png",
        vibrate: [200, 100, 200],
        data,
      },
    };

    await webpush.sendNotification(
      userSub.subscription,
      JSON.stringify(notificationPayload)
    );

    console.log(`📤 Push notification sent to user: ${userId}`);
    return { success: true };
  } catch (err) {
    console.error(`❌ Failed to send push to user ${userId}:`, err.message);
    // Remove failed subscription
    subscriptions = subscriptions.filter((s) => s.userId !== userId);
    return { success: false, error: err.message };
  }
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
