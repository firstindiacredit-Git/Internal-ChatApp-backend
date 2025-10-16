const express = require("express");
const router = express.Router();
const {
  initializeFirebase,
  saveFCMToken,
  removeFCMToken,
  sendFCMToUser,
  getFCMTokenCount,
} = require("../services/fcmService");

// Initialize Firebase
initializeFirebase();

router.post("/register", (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: "userId and token required" });
  }

  saveFCMToken(userId, token);
  res.json({ message: "FCM token registered" });
});

router.post("/send", async (req, res) => {
  const { userId, title, body, data } = req.body;

  if (!userId || !title || !body) {
    return res.status(400).json({ error: "userId, title, body required" });
  }

  const result = await sendFCMToUser(userId, title, body, data || {});

  if (result.success) {
    res.json({ message: "Notification sent", messageId: result.messageId });
  } else {
    res.status(404).json({ error: result.error });
  }
});

router.get("/status", (req, res) => {
  res.json({
    configured: true,
    tokenCount: getFCMTokenCount(),
  });
});

module.exports = router;





