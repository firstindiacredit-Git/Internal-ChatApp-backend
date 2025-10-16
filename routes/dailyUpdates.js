const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const router = express.Router();
const DailyUpdate = require("../models/DailyUpdate");
const { auth } = require("../middleware/auth");

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
    // Accept images, videos, and documents
    const allowedMimeTypes = [
      "image/",
      "video/",
      "application/pdf",
      "application/zip",
      "application/x-zip-compressed",
      "application/postscript", // .ps, .ai
      "application/x-photoshop", // .psd
      "application/vnd.corel-draw", // .cdr
      "application/illustrator", // .ai
      "image/vnd.adobe.photoshop", // .psd
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    const isAllowed = allowedMimeTypes.some(
      (type) => file.mimetype.startsWith(type) || file.mimetype.includes(type)
    );

    if (isAllowed) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "File type not supported. Supported: images, videos, PDF, ZIP, PSD, AI, CDR, PS, DOC, XLS"
        )
      );
    }
  },
});

// Get daily updates for a specific user (Admin only)
router.get("/user/:userId", auth, async (req, res) => {
  try {
    // Check if user is admin or superadmin
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
      console.log("❌ Access denied - User role:", req.user.role);
      return res.status(403).json({ error: "Access denied" });
    }

    const userId = req.params.userId;

    // Validate userId
    if (!userId || userId === "undefined" || userId === "null") {
      console.log("❌ Invalid userId received:", userId);
      return res.status(400).json({ error: "Invalid user ID" });
    }

    console.log("👤 Fetching daily updates for user:", userId);
    console.log("🔑 Requested by admin:", req.user._id, req.user.name);

    const updates = await DailyUpdate.find({ user: userId })
      .sort({ date: -1 })
      .limit(100);

    console.log("✅ Found updates for user:", updates.length);

    res.json(updates);
  } catch (error) {
    console.error("❌ Error fetching user daily updates:", error);
    res.status(500).json({ error: error.message || "Server error" });
  }
});

// Get daily updates for a specific date or all updates for the user
router.get("/", auth, async (req, res) => {
  try {
    const { date } = req.query;
    let query = { user: req.user._id };

    console.log("📋 Fetching daily updates for user:", req.user._id);
    console.log("📅 Date query:", date);

    if (date) {
      // Get updates for a specific date
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      query.date = { $gte: startDate, $lte: endDate };
    }

    const updates = await DailyUpdate.find(query).sort({ date: -1 }).limit(30); // Limit to last 30 updates

    console.log("✅ Found updates:", updates.length);

    res.json(updates);
  } catch (error) {
    console.error("❌ Error fetching daily updates:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get a specific daily update by ID
router.get("/:id", auth, async (req, res) => {
  try {
    const update = await DailyUpdate.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!update) {
      return res.status(404).json({ error: "Update not found" });
    }

    res.json(update);
  } catch (error) {
    console.error("Error fetching daily update:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Upload media for daily update (MUST BE BEFORE THE GENERAL POST ROUTE)
router.post("/upload-media", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = req.file;
    const isVideo = file.mimetype.startsWith("video/");
    const isImage = file.mimetype.startsWith("image/");

    // Determine resource type for Cloudinary
    let resourceType = "raw"; // default for documents
    let fileType = "document";

    if (isVideo) {
      resourceType = "video";
      fileType = "video";
    } else if (isImage) {
      resourceType = "image";
      fileType = "image";
    }

    // Upload to Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: "daily-updates",
        transformation:
          resourceType === "image"
            ? [{ width: 1200, height: 1200, crop: "limit" }]
            : [],
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          return res.status(500).json({ error: "Failed to upload file" });
        }

        res.json({
          type: fileType,
          url: result.secure_url,
          publicId: result.public_id,
          filename: file.originalname,
        });
      }
    );

    uploadStream.end(file.buffer);
  } catch (error) {
    console.error("Error uploading media:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Create a new daily update
router.post("/", auth, async (req, res) => {
  try {
    const { date, content } = req.body;

    if (!date || !content) {
      return res.status(400).json({ error: "Date and content are required" });
    }

    // Parse and normalize the date
    const updateDate = new Date(date);
    updateDate.setHours(0, 0, 0, 0);

    // Check if update already exists for this date
    const existingUpdate = await DailyUpdate.findOne({
      user: req.user._id,
      date: {
        $gte: updateDate,
        $lt: new Date(updateDate.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    if (existingUpdate) {
      return res.status(400).json({
        error:
          "Update already exists for this date. Please edit the existing update.",
      });
    }

    const update = new DailyUpdate({
      user: req.user._id,
      date: updateDate,
      content,
      media: req.body.media || [],
    });

    await update.save();
    res.status(201).json(update);
  } catch (error) {
    console.error("Error creating daily update:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Update an existing daily update
router.put("/:id", auth, async (req, res) => {
  try {
    const { content, media } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    const updateData = { content };
    if (media !== undefined) {
      updateData.media = media;
    }

    const update = await DailyUpdate.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      updateData,
      { new: true }
    );

    if (!update) {
      return res.status(404).json({ error: "Update not found" });
    }

    res.json(update);
  } catch (error) {
    console.error("Error updating daily update:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete a daily update
router.delete("/:id", auth, async (req, res) => {
  try {
    const update = await DailyUpdate.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!update) {
      return res.status(404).json({ error: "Update not found" });
    }

    res.json({ message: "Update deleted successfully" });
  } catch (error) {
    console.error("Error deleting daily update:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
