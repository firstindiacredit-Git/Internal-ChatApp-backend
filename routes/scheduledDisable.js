const express = require("express");
const mongoose = require("mongoose");
const ScheduledDisable = require("../models/ScheduledDisable");
const User = require("../models/User");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Get all scheduled disable rules
router.get("/", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const schedules = await ScheduledDisable.find()
      .populate("users", "name email role profileImage")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json(schedules);
  } catch (error) {
    console.error("Error fetching schedules:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get single schedule
router.get("/:id", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const schedule = await ScheduledDisable.findById(req.params.id)
      .populate("users", "name email role profileImage")
      .populate("createdBy", "name email");

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    res.json(schedule);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create new schedule
router.post("/", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const { name, enableTime, disableTime, users, applyToAllUsers, days } =
      req.body;

    // Validate at least one time is provided
    if (!enableTime && !disableTime) {
      return res.status(400).json({
        message: "Please provide at least one time (Enable or Disable)",
      });
    }

    // Validate time format (HH:mm)
    const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    if (enableTime && !timeRegex.test(enableTime)) {
      return res.status(400).json({
        message:
          "Invalid enable time format. Please use HH:mm format (e.g., 09:00)",
      });
    }
    if (disableTime && !timeRegex.test(disableTime)) {
      return res.status(400).json({
        message:
          "Invalid disable time format. Please use HH:mm format (e.g., 18:00)",
      });
    }

    // Validate users
    if (!applyToAllUsers && (!users || users.length === 0)) {
      return res.status(400).json({
        message:
          "Please select at least one user or enable 'Apply to all users'",
      });
    }

    const schedule = new ScheduledDisable({
      name,
      enableTime: enableTime || null,
      disableTime: disableTime || null,
      users: applyToAllUsers ? [] : users,
      applyToAllUsers,
      days: days || [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
      createdBy: req.user._id,
    });

    await schedule.save();

    const populatedSchedule = await ScheduledDisable.findById(schedule._id)
      .populate("users", "name email role profileImage")
      .populate("createdBy", "name email");

    res.status(201).json({
      message: "Schedule created successfully",
      schedule: populatedSchedule,
    });
  } catch (error) {
    console.error("Error creating schedule:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update schedule
router.put("/:id", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const {
      name,
      enableTime,
      disableTime,
      users,
      applyToAllUsers,
      days,
      isActive,
    } = req.body;

    // Validate time formats if provided
    const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
    if (enableTime && enableTime !== "" && !timeRegex.test(enableTime)) {
      return res.status(400).json({
        message:
          "Invalid enable time format. Please use HH:mm format (e.g., 09:00)",
      });
    }
    if (disableTime && disableTime !== "" && !timeRegex.test(disableTime)) {
      return res.status(400).json({
        message:
          "Invalid disable time format. Please use HH:mm format (e.g., 18:00)",
      });
    }

    // Get current schedule to check if times changed
    const currentSchedule = await ScheduledDisable.findById(req.params.id);
    if (!currentSchedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;

    if (enableTime !== undefined) {
      updateData.enableTime = enableTime || null;
      // If enable time changed, reset lastTriggeredEnable
      if (enableTime !== currentSchedule.enableTime) {
        updateData.lastTriggeredEnable = null;
        console.log(
          `⏰ Enable time changed, reset lastTriggeredEnable for schedule: ${currentSchedule.name}`
        );
      }
    }

    if (disableTime !== undefined) {
      updateData.disableTime = disableTime || null;
      // If disable time changed, reset lastTriggeredDisable
      if (disableTime !== currentSchedule.disableTime) {
        updateData.lastTriggeredDisable = null;
        console.log(
          `⏰ Disable time changed, reset lastTriggeredDisable for schedule: ${currentSchedule.name}`
        );
      }
    }

    if (users !== undefined) updateData.users = users;
    if (applyToAllUsers !== undefined) {
      updateData.applyToAllUsers = applyToAllUsers;
      if (applyToAllUsers) updateData.users = [];
    }
    if (days !== undefined) updateData.days = days;
    if (isActive !== undefined) updateData.isActive = isActive;

    const schedule = await ScheduledDisable.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    )
      .populate("users", "name email role profileImage")
      .populate("createdBy", "name email");

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    res.json({
      message: "Schedule updated successfully",
      schedule,
    });
  } catch (error) {
    console.error("Error updating schedule:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete schedule
router.delete(
  "/:id",
  auth,
  authorize("superadmin", "admin"),
  async (req, res) => {
    try {
      const schedule = await ScheduledDisable.findByIdAndDelete(req.params.id);

      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      res.json({ message: "Schedule deleted successfully" });
    } catch (error) {
      console.error("Error deleting schedule:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Toggle schedule active status
router.put(
  "/:id/toggle",
  auth,
  authorize("superadmin", "admin"),
  async (req, res) => {
    try {
      const schedule = await ScheduledDisable.findById(req.params.id);

      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      schedule.isActive = !schedule.isActive;
      await schedule.save();

      const populatedSchedule = await ScheduledDisable.findById(schedule._id)
        .populate("users", "name email role profileImage")
        .populate("createdBy", "name email");

      res.json({
        message: `Schedule ${
          schedule.isActive ? "enabled" : "disabled"
        } successfully`,
        schedule: populatedSchedule,
      });
    } catch (error) {
      console.error("Error toggling schedule:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Reset lastTriggered (allow re-trigger today)
router.put(
  "/:id/reset-trigger",
  auth,
  authorize("superadmin", "admin"),
  async (req, res) => {
    try {
      const schedule = await ScheduledDisable.findByIdAndUpdate(
        req.params.id,
        {
          lastTriggeredEnable: null,
          lastTriggeredDisable: null,
        },
        { new: true }
      )
        .populate("users", "name email role profileImage")
        .populate("createdBy", "name email");

      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }

      console.log(`🔄 Manually reset triggers for schedule: ${schedule.name}`);

      res.json({
        message: "Schedule reset successfully - can trigger again today",
        schedule,
      });
    } catch (error) {
      console.error("Error resetting schedule:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
