/**
 * FCM Notification Test Script
 *
 * Usage:
 *   node test-notification.js <userId> [title] [body]
 *
 * Example:
 *   node test-notification.js 507f1f77bcf86cd799439011 "Test" "Hello!"
 */

const {
  initializeFirebase,
  sendFCMToUser,
  getFCMTokenCount,
} = require("./services/fcmService");

async function testNotification() {
  console.log("🧪 Starting FCM Notification Test...\n");

  // Initialize Firebase
  console.log("1️⃣ Initializing Firebase...");
  const initialized = initializeFirebase();

  if (!initialized) {
    console.error("❌ Firebase initialization failed");
    console.log("ℹ️ Make sure firebase-service-account.json exists");
    process.exit(1);
  }

  console.log("✅ Firebase initialized successfully\n");

  // Check token count
  console.log("2️⃣ Checking registered tokens...");
  const tokenCount = getFCMTokenCount();
  console.log(`📊 Total registered devices: ${tokenCount}`);

  if (tokenCount === 0) {
    console.log("⚠️ No FCM tokens registered");
    console.log("ℹ️ Login from a device with notifications enabled first");
    process.exit(0);
  }

  console.log("");

  // Get test parameters
  const userId = process.argv[2];
  const title = process.argv[3] || "🧪 Test Notification";
  const body =
    process.argv[4] || "This is a test notification from the backend";

  if (!userId) {
    console.error("❌ Error: userId required");
    console.log("Usage: node test-notification.js <userId> [title] [body]");
    process.exit(1);
  }

  // Send test notification
  console.log("3️⃣ Sending test notification...");
  console.log(`   User ID: ${userId}`);
  console.log(`   Title: ${title}`);
  console.log(`   Body: ${body}\n`);

  const result = await sendFCMToUser(userId, title, body, {
    type: "test",
    timestamp: new Date().toISOString(),
  });

  if (result.success) {
    console.log("✅ Notification sent successfully!");
    console.log(`📨 Message ID: ${result.messageId}`);
  } else {
    console.error("❌ Failed to send notification");
    console.error(`Error: ${result.error}`);

    if (result.error === "No FCM token") {
      console.log("ℹ️ This user has not registered for FCM notifications");
      console.log("   Ask them to:");
      console.log("   1. Login to the app");
      console.log("   2. Allow notifications when prompted");
      console.log("   3. Refresh the page if needed");
    }
  }

  console.log("\n🏁 Test completed");
}

// Run the test
testNotification().catch((error) => {
  console.error("❌ Test failed:", error.message);
  process.exit(1);
});
