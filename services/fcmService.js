const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) {
    return true;
  }

  try {
    // Try JSON file first (most reliable method)
    const jsonPath = path.join(__dirname, "../firebase-service-account.json");

    if (fs.existsSync(jsonPath)) {
      console.log("🔥 Loading Firebase from JSON file...");
      const serviceAccount = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      firebaseInitialized = true;
      console.log("✅ Firebase Admin SDK initialized (JSON)");
      return true;
    }

    // Fallback: Use environment variables
    console.log("🔥 Loading Firebase from environment variables...");

    if (
      !process.env.FIREBASE_PROJECT_ID ||
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !process.env.FIREBASE_PRIVATE_KEY
    ) {
      console.warn("⚠️ Firebase credentials not found");
      console.log("ℹ️ Web Push will be used");
      return false;
    }

    // Create service account object from env vars
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      universe_domain: "googleapis.com",
    };

    // Parse private key carefully - handle both escaped and actual newlines
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!privateKey) {
      console.warn("⚠️ FIREBASE_PRIVATE_KEY is empty or undefined");
      return false;
    }

    // Convert to string and trim
    privateKey = privateKey.toString().trim();

    // Remove outer quotes if present
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }

    // Replace literal \n with actual newlines (for escaped format)
    privateKey = privateKey.replace(/\\n/g, "\n");

    // Ensure proper formatting
    if (!privateKey.includes("BEGIN PRIVATE KEY")) {
      console.error(
        "❌ Invalid private key format - missing BEGIN PRIVATE KEY header"
      );
      return false;
    }

    serviceAccount.private_key = privateKey;

    // Validate the service account object before initialization
    console.log("🔍 Firebase config validation:");
    console.log("   Project ID:", serviceAccount.project_id ? "✓" : "✗");
    console.log("   Client Email:", serviceAccount.client_email ? "✓" : "✗");
    console.log(
      "   Private Key Length:",
      serviceAccount.private_key?.length || 0
    );
    console.log(
      "   Private Key Start:",
      serviceAccount.private_key?.substring(0, 30) || "N/A"
    );

    // Debug: Check if newlines are properly formatted
    const lines = privateKey.split("\n");
    console.log("   Private Key Lines:", lines.length);
    console.log("   Line 1:", lines[0]);
    console.log("   Line 2:", lines[1]?.substring(0, 50) || "N/A");
    console.log("   Last Line:", lines[lines.length - 1]);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    firebaseInitialized = true;
    console.log("✅ Firebase Admin SDK initialized (ENV)");
    return true;
  } catch (error) {
    console.error("❌ Firebase init failed:", error.message);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    console.log("ℹ️ Web Push will be used as fallback");
    return false;
  }
}

// Store FCM tokens
let fcmTokens = new Map();

function saveFCMToken(userId, token) {
  fcmTokens.set(userId, { token, updatedAt: new Date() });
  console.log(`✅ FCM token saved for user: ${userId}`);
  return true;
}

function removeFCMToken(userId) {
  if (fcmTokens.has(userId)) {
    fcmTokens.delete(userId);
    console.log(`✅ FCM token removed for user: ${userId}`);
    return true;
  }
  return false;
}

function getFCMToken(userId) {
  const data = fcmTokens.get(userId);
  return data ? data.token : null;
}

async function sendFCMToUser(userId, title, body, data = {}) {
  if (!initializeFirebase()) {
    return { success: false, error: "Firebase not initialized" };
  }

  const token = getFCMToken(userId);
  if (!token) {
    console.log(`ℹ️ No FCM token for user: ${userId}`);
    return { success: false, error: "No FCM token" };
  }

  try {
    const message = {
      notification: { title, body },
      data: {
        ...data,
        timestamp: new Date().toISOString(),
      },
      token: token,
      webpush: {
        notification: {
          title,
          body,
          icon: data.icon || "/icon.png",
          badge: "/badge.png",
          requireInteraction: false,
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`📤 FCM sent to user: ${userId}`);
    return { success: true, messageId: response };
  } catch (error) {
    console.error(`❌ FCM failed for user ${userId}:`, error.code);

    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      removeFCMToken(userId);
    }

    return { success: false, error: error.message };
  }
}

function getFCMTokenCount() {
  return fcmTokens.size;
}

module.exports = {
  initializeFirebase,
  saveFCMToken,
  removeFCMToken,
  getFCMToken,
  sendFCMToUser,
  getFCMTokenCount,
};
