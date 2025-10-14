const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const router = express.Router();
const Task = require("../models/Task");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const { sendFCMToUser } = require("../services/fcmService");
const { sendPushToUser } = require("./pushNotifications");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"));
    }
  },
});

// Upload media for task
router.post("/upload-media", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = req.file;
    const isVideo = file.mimetype.startsWith("video/");

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: isVideo ? "video" : "image",
        folder: "task-media",
        transformation: isVideo
          ? []
          : [{ width: 1200, height: 1200, crop: "limit" }],
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return res.status(500).json({ error: "Failed to upload file" });
        }

        res.json({
          type: isVideo ? "video" : "image",
          url: result.secure_url,
          publicId: result.public_id,
          filename: file.originalname,
          uploadedBy: req.user._id,
        });
      }
    );

    uploadStream.end(file.buffer);
  } catch (error) {
    console.error("Error uploading media:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add comment to task (with optional media)
router.post("/:id/comment", auth, async (req, res) => {
  try {
    const { text, media } = req.body;

    // Text is optional if media is provided
    if ((!text || !text.trim()) && (!media || media.length === 0)) {
      return res
        .status(400)
        .json({ error: "Comment text or media is required" });
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const comment = {
      user: req.user._id,
      userName: req.user.name,
      text: text ? text.trim() : "",
    };

    // Add media if provided
    if (media && Array.isArray(media) && media.length > 0) {
      comment.media = media;
    }

    task.comments.push(comment);

    await task.save();
    console.log(
      `✅ Comment added to task: ${task.title}`,
      media ? `with ${media.length} media files` : ""
    );

    // Send notification to task owner if comment is from someone else
    try {
      const taskWithUser = await Task.findById(req.params.id).populate(
        "user",
        "_id name email profileImage"
      );

      if (
        taskWithUser &&
        taskWithUser.user &&
        taskWithUser.user._id.toString() !== req.user._id.toString()
      ) {
        const { io } = require("../server");

        const notificationData = {
          type: "task_comment",
          message: `${req.user.name} commented on your task: ${taskWithUser.title}`,
          taskId: taskWithUser._id,
          taskTitle: taskWithUser.title,
          commentText: text ? text.substring(0, 100) : "Added media",
          commentedBy: req.user.name,
          timestamp: new Date(),
        };

        // Socket notification
        io.to(taskWithUser.user._id.toString()).emit(
          "task_notification",
          notificationData
        );

        // Push/FCM notification
        const notificationTitle = "💬 Task Comment";
        const notificationBody = `${req.user.name} commented: "${
          text ? text.substring(0, 50) : "See attachment"
        }..."`;

        try {
          const fcmResult = await sendFCMToUser(
            taskWithUser.user._id.toString(),
            notificationTitle,
            notificationBody,
            {
              type: "task_comment",
              taskId: taskWithUser._id.toString(),
              taskTitle: taskWithUser.title,
              commentedBy: req.user.name,
              commentedById: req.user._id.toString(),
              icon: req.user.profileImage || "/icon.png",
            }
          );

          if (!fcmResult.success) {
            await sendPushToUser(
              taskWithUser.user._id.toString(),
              notificationTitle,
              notificationBody,
              req.user.profileImage || "/icon.png",
              {
                type: "task_comment",
                taskId: taskWithUser._id.toString(),
                taskTitle: taskWithUser.title,
                commentedBy: req.user.name,
              }
            );
          }

          console.log(
            `📬 Task comment notification sent to: ${taskWithUser.user.name}`
          );
        } catch (notifError) {
          console.log(
            "⚠️ Failed to send comment notification:",
            notifError.message
          );
        }
      }
    } catch (notifError) {
      console.error(
        "⚠️ Failed to send task comment notification:",
        notifError.message
      );
    }

    res.json(task);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add media to task
router.post("/:id/media", auth, async (req, res) => {
  try {
    console.log("📎 Adding media to task. Task ID:", req.params.id);
    const { media } = req.body;

    if (!media || !Array.isArray(media)) {
      console.log("❌ Media array is invalid:", media);
      return res.status(400).json({ error: "Media array is required" });
    }

    console.log(`📎 Searching for task with ID: ${req.params.id}`);
    const task = await Task.findById(req.params.id);

    if (!task) {
      console.log(`❌ Task not found with ID: ${req.params.id}`);
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(
      `✅ Task found: ${task.title}, adding ${media.length} media items`
    );
    media.forEach((m) => {
      task.media.push({
        ...m,
        uploadedBy: req.user._id,
      });
    });

    await task.save();
    console.log(`✅ Media added to task: ${task.title}`);
    res.json(task);
  } catch (error) {
    console.error("❌ Error adding media:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get tasks for a specific user (Admin only)
router.get("/user/:userId", auth, async (req, res) => {
  try {
    // Check if user is admin or superadmin
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const tasks = await Task.find({ user: req.params.userId }).sort({
      createdAt: -1,
    });
    res.json(tasks);
  } catch (error) {
    console.error("Error fetching user tasks:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Assign task to a user (Admin only)
router.post("/assign", auth, async (req, res) => {
  try {
    // Check if user is admin or superadmin
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      console.log("❌ Access denied - User role:", req.user.role);
      return res.status(403).json({ error: "Access denied" });
    }

    const {
      userId,
      title,
      description,
      status,
      priority,
      startDate,
      dueDate,
      endDate,
      media,
    } = req.body;

    console.log("📋 Task assign request:");
    console.log("  - Admin:", req.user.name);
    console.log("  - Target User ID:", userId);
    console.log("  - Title:", title);
    console.log("  - Status:", status);
    console.log("  - Priority:", priority);
    console.log("  - Start Date:", startDate);
    console.log("  - Due Date:", dueDate);
    console.log("  - End Date:", endDate);
    console.log("  - Media count:", media?.length || 0);

    if (!userId || !title) {
      console.log("❌ Validation failed - userId:", userId, "title:", title);
      return res.status(400).json({ error: "User ID and title are required" });
    }

    // Validate userId is not 'undefined' or 'null'
    if (userId === "undefined" || userId === "null") {
      console.log("❌ Invalid userId string:", userId);
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const task = new Task({
      user: userId,
      title,
      description,
      status: status || "pending",
      priority: priority || "medium",
      startDate: startDate || new Date(),
      dueDate: dueDate || null,
      endDate: endDate || null,
      progress: 0, // Initial progress is 0
      media: media || [], // Include media if provided
    });

    await task.save();
    console.log(
      "✅ Task created successfully:",
      task._id,
      "with",
      task.media.length,
      "media files"
    );

    // Send notification to the user about task assignment
    try {
      const { io } = require("../server");
      const assignedUser = await User.findById(userId).select(
        "_id name email profileImage"
      );

      if (assignedUser) {
        const notificationData = {
          type: "task_assigned",
          message: `New task assigned: ${title}`,
          taskId: task._id,
          taskTitle: title,
          taskPriority: priority || "medium",
          taskDueDate: dueDate || null,
          assignedBy: req.user.name,
          timestamp: new Date(),
        };

        // Socket notification for online users
        io.to(userId).emit("task_notification", notificationData);

        // Push/FCM notification (will send if user is offline)
        const notificationTitle = "📋 New Task Assigned";
        const notificationBody = `${req.user.name} assigned you: "${title}"`;
        const priorityEmoji =
          priority === "high" ? "🔴" : priority === "low" ? "🟢" : "🟡";

        try {
          const fcmResult = await sendFCMToUser(
            userId,
            notificationTitle,
            `${priorityEmoji} ${notificationBody}`,
            {
              type: "task_assigned",
              taskId: task._id.toString(),
              taskTitle: title,
              taskPriority: priority || "medium",
              assignedBy: req.user.name,
              assignedById: req.user._id.toString(),
              icon: req.user.profileImage || "/icon.png",
            }
          );

          // Fallback to Web Push if FCM fails
          if (!fcmResult.success) {
            await sendPushToUser(
              userId,
              notificationTitle,
              `${priorityEmoji} ${notificationBody}`,
              req.user.profileImage || "/icon.png",
              {
                type: "task_assigned",
                taskId: task._id.toString(),
                taskTitle: title,
                taskPriority: priority || "medium",
                assignedBy: req.user.name,
              }
            );
          }

          console.log(
            `📬 Task assignment notification sent to user: ${assignedUser.name}`
          );
        } catch (notifError) {
          console.log(
            "⚠️ Failed to send push notification:",
            notifError.message
          );
        }
      }
    } catch (notifError) {
      // Don't fail the task assignment if notification fails
      console.error("⚠️ Failed to send task notification:", notifError.message);
    }

    res.status(201).json(task);
  } catch (error) {
    console.error("❌ Error assigning task:", error);
    res.status(500).json({ error: error.message || "Server error" });
  }
});

// Get all tasks for the logged-in user
router.get("/", auth, async (req, res) => {
  try {
    const { status, priority, sortBy } = req.query;
    let query = { user: req.user._id };

    // Filter by status if provided
    if (status && status !== "all") {
      query.status = status;
    }

    // Filter by priority if provided
    if (priority) {
      query.priority = priority;
    }

    // Determine sort order
    let sort = { createdAt: -1 }; // Default: newest first
    if (sortBy === "dueDate") {
      sort = { dueDate: 1 };
    } else if (sortBy === "priority") {
      // Custom sort for priority: high > medium > low
      const tasks = await Task.find(query);
      const priorityOrder = { high: 1, medium: 2, low: 3 };
      tasks.sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );
      return res.json(tasks);
    }

    const tasks = await Task.find(query).sort(sort);
    res.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get a specific task by ID
router.get("/:id", auth, async (req, res) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(task);
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Create a new task
router.post("/", auth, async (req, res) => {
  try {
    const { title, description, status, priority, dueDate } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    const task = new Task({
      user: req.user._id,
      title,
      description,
      status: status || "pending",
      priority: priority || "medium",
      dueDate: dueDate || null,
    });

    await task.save();
    res.status(201).json(task);
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Update an existing task
router.put("/:id", auth, async (req, res) => {
  try {
    const {
      title,
      description,
      status,
      priority,
      startDate,
      dueDate,
      endDate,
      progress,
    } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (startDate !== undefined) updateData.startDate = startDate;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (progress !== undefined) {
      // Ensure progress is between 0 and 100
      updateData.progress = Math.min(100, Math.max(0, progress));
    }

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      updateData,
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(
      `✅ Task updated: ${task.title} - Progress: ${task.progress}% - Status: ${task.status}`
    );
    res.json(task);
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete a task
router.delete("/:id", auth, async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ message: "Task deleted successfully" });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
