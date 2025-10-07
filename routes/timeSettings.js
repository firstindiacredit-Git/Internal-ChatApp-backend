const express = require("express");
const moment = require("moment-timezone");
const TimeSettings = require("../models/TimeSettings");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Import global time offset from server
let globalTimeOffset = 0;

// Helper function to get current IST time (using global NTP time)
function getCurrentISTTime() {
  // Get global time = system time + NTP offset
  const globalTime = new Date(Date.now() + globalTimeOffset);
  // Convert global time to IST
  return moment(globalTime).tz("Asia/Kolkata");
}

// Endpoint to sync global time offset from main server
router.use((req, res, next) => {
  if (req.app.get("globalTimeOffset") !== undefined) {
    globalTimeOffset = req.app.get("globalTimeOffset");
  }
  next();
});

// Get current IST time (public endpoint for frontend sync)
router.get("/current-time", auth, async (req, res) => {
  try {
    const istNow = getCurrentISTTime();
    const systemTime = new Date();

    res.json({
      timestamp: istNow.valueOf(), // Unix timestamp in milliseconds
      formatted: istNow.format("DD/MM/YYYY HH:mm:ss"),
      date: istNow.toDate(),
      timezone: "Asia/Kolkata",
      offset: "+05:30",
      ntpOffset: globalTimeOffset, // NTP offset from system time
      usingGlobalTime: true, // Indicates we're using NTP, not system time
      systemTime: systemTime.toISOString(),
      globalTimeDiff: `${globalTimeOffset}ms`,
    });
  } catch (error) {
    console.error("Error fetching current time:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get time settings
router.get("/", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const settings = await TimeSettings.getSettings();
    const istNow = getCurrentISTTime();

    res.json({
      ...settings.toObject(),
      currentISTTime: istNow.format("HH:mm:ss"),
      currentISTDate: istNow.format("DD/MM/YYYY"),
    });
  } catch (error) {
    console.error("Error fetching time settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update time settings
router.put("/", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const { autoDisableTime, autoDisableEnabled, timezone } = req.body;

    // Validate time format (HH:mm)
    const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    if (autoDisableTime && !timeRegex.test(autoDisableTime)) {
      return res.status(400).json({
        message: "Invalid time format. Please use HH:mm format (e.g., 13:15)",
      });
    }

    let settings = await TimeSettings.getSettings();

    if (autoDisableTime !== undefined)
      settings.autoDisableTime = autoDisableTime;
    if (autoDisableEnabled !== undefined)
      settings.autoDisableEnabled = autoDisableEnabled;
    if (timezone !== undefined) settings.timezone = timezone;

    settings.lastUpdatedBy = req.user._id;
    await settings.save();

    res.json({
      message: "Time settings updated successfully",
      settings,
    });
  } catch (error) {
    console.error("Error updating time settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
