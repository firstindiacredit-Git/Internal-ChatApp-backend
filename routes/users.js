const express = require("express");
const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { auth, authorize } = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { io } = require("../server");

const router = express.Router();

// GridFS setup for storing profile images in MongoDB
let gridfsBucket;
mongoose.connection.once("open", () => {
  gridfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "profileImages",
  });
});

// Use memory storage for profile images (like messages)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Get all users (Super Admin and Admin can see all users)
router.get("/", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const users = await User.find({})
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    // Transform _id to id for frontend compatibility
    const transformedUsers = users.map((user) => ({
      id: user._id,
      name: user.name,
      email: user.email,
      password: user.plainPassword || "[Password not available - please reset]", // Show plain password or placeholder
      role: user.role,
      phone: user.phone,
      designation: user.designation,
      bio: user.bio,
      profileImage: user.profileImage,
      isActive: user.isActive,
      disabledAt: user.disabledAt,
      disableReason: user.disableReason,
      createdBy: user.createdBy,
      lastSeen: user.lastSeen,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    res.json(transformedUsers);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all users for regular users (include both active and disabled users with status)
router.get("/active", auth, async (req, res) => {
  try {
    const users = await User.find({})
      .select("_id name email role lastSeen profileImage isActive")
      .sort({ name: 1 });

    // Transform _id to id for frontend compatibility
    const transformedUsers = users.map((user) => ({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      lastSeen: user.lastSeen,
      profileImage: user.profileImage,
      isActive: user.isActive,
    }));

    res.json(transformedUsers);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Create new user (Super Admin can create Admin, Admin can create User)
router.post(
  "/",
  auth,
  authorize("superadmin", "admin"),
  [
    body("name")
      .trim()
      .isLength({ min: 2 })
      .withMessage("Name must be at least 2 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role")
      .isIn(["admin", "user"])
      .withMessage("Role must be either admin or user"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, password, role } = req.body;

      // Super admin can create admin, Admin can only create user
      if (req.user.role === "admin" && role === "admin") {
        return res
          .status(403)
          .json({ message: "Admin cannot create another admin" });
      }

      const user = new User({
        name,
        email,
        password,
        role,
        createdBy: req.user._id,
      });

      await user.save();

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdBy: user.createdBy,
        },
      });
    } catch (error) {
      if (error.code === 11000) {
        res.status(400).json({ message: "Email already exists" });
      } else {
        res.status(500).json({ message: "Server error" });
      }
    }
  }
);

// Update user profile
router.put(
  "/profile",
  auth,
  upload.single("profileImage"),
  [
    body("name").optional().trim().isLength({ min: 2 }),
    body("phone").optional().trim().isLength({ min: 10, max: 15 }),
    body("designation").optional().trim().isLength({ max: 100 }),
    body("bio").optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, phone, designation, bio } = req.body;
      const userId = req.user._id;

      const updateData = {};
      if (name) updateData.name = name;
      if (phone) updateData.phone = phone;
      if (designation) updateData.designation = designation;
      if (bio) updateData.bio = bio;

      // Handle profile image upload to GridFS (like messages)
      if (req.file) {
        // Initialize GridFS bucket if not already done
        if (!gridfsBucket) {
          try {
            gridfsBucket = new mongoose.mongo.GridFSBucket(
              mongoose.connection.db,
              {
                bucketName: "profileImages",
              }
            );
          } catch (err) {
            console.error("GridFS bucket initialization error:", err);
            return res.status(500).json({
              message: "File system not initialized. Please try again.",
            });
          }
        }

        // Delete old profile image from GridFS if exists
        const user = await User.findById(userId);
        if (
          user.profileImage &&
          user.profileImage.startsWith("/api/users/profile-image/")
        ) {
          try {
            const oldFileId = user.profileImage.split("/").pop();
            const objectId = new mongoose.Types.ObjectId(oldFileId);
            await gridfsBucket.delete(objectId);
          } catch (err) {
            console.warn("Could not delete old profile image:", err.message);
          }
        }

        // Upload new image to GridFS
        const filename = `profile-${Date.now()}-${req.file.originalname}`;
        const uploadStream = gridfsBucket.openUploadStream(filename, {
          contentType: req.file.mimetype,
        });

        // Create a promise to handle the upload
        try {
          await new Promise((resolve, reject) => {
            uploadStream.on("error", (err) => {
              console.error("GridFS upload error:", err);
              reject(new Error("Failed to store profile image"));
            });

            uploadStream.on("finish", (file) => {
              updateData.profileImage = `/api/users/profile-image/${file._id.toString()}`;
              console.log(
                "✅ Profile image uploaded to GridFS:",
                updateData.profileImage
              );
              resolve();
            });

            uploadStream.end(req.file.buffer);
          });
        } catch (uploadError) {
          console.error("Profile image upload failed:", uploadError);
          return res.status(500).json({
            message: "Failed to upload profile image. Please try again.",
            error: uploadError.message,
          });
        }
      }

      const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      }).select("-password");

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Emit avatar update event to all connected users
      if (req.file) {
        io.emit("avatar-updated", {
          userId: updatedUser._id,
          profileImage: updatedUser.profileImage,
          name: updatedUser.name,
        });
      }

      res.json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.json({ message: "Profile updated successfully" });
    }
  }
);

// Update user
router.put(
  "/:id",
  auth,
  authorize("superadmin", "admin"),
  [
    body("name").optional().trim().isLength({ min: 2 }),
    body("email").optional().isEmail().normalizeEmail(),
    body("role").optional().isIn(["admin", "user"]),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, role, password } = req.body;
      const userId = req.params.id;

      // Admin cannot update another admin
      if (req.user.role === "admin") {
        const targetUser = await User.findById(userId);
        if (targetUser && targetUser.role === "admin") {
          return res
            .status(403)
            .json({ message: "Admin cannot update another admin" });
        }
      }

      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email;
      if (role) updateData.role = role;
      if (password) {
        updateData.password = password;
        updateData.plainPassword = password; // Store plain password for admin viewing
      }

      const user = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        message: "User updated successfully",
        user,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Toggle user active status
router.put(
  "/:id/toggle-status",
  auth,
  authorize("superadmin", "admin"),
  async (req, res) => {
    try {
      const userId = req.params.id;

      // Validate MongoDB ObjectId format
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Can't disable yourself
      if (userId === req.user._id.toString()) {
        return res
          .status(400)
          .json({ message: "Cannot disable your own account" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Admin cannot toggle another admin
      if (req.user.role === "admin" && user.role === "admin") {
        return res
          .status(403)
          .json({ message: "Admin cannot toggle another admin" });
      }

      // Toggle the active status
      const newStatus = !user.isActive;

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { isActive: newStatus },
        { new: true }
      );

      if (!updatedUser) {
        return res
          .status(404)
          .json({ message: "User not found during update" });
      }

      // Update disable tracking
      if (!newStatus) {
        updatedUser.disabledAt = new Date();
        updatedUser.disableReason = "manual";
        await updatedUser.save();

        try {
          io.to(userId).emit("force-logout", {
            message: "Your account has been disabled",
            reason: "disabled_by_admin",
          });
        } catch (socketError) {
          console.log(
            "Socket emit failed, continuing anyway:",
            socketError.message
          );
        }
      } else {
        // Clear disable tracking when enabling
        updatedUser.disabledAt = null;
        updatedUser.disableReason = null;
        await updatedUser.save();
      }

      // Handle potential populated fields safely
      const userResponse = {
        id: updatedUser._id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        phone: updatedUser.phone || null,
        designation: updatedUser.designation || null,
        bio: updatedUser.bio || null,
        profileImage: updatedUser.profileImage || null,
        isActive: updatedUser.isActive,
        createdBy: updatedUser.createdBy || null,
        lastSeen: updatedUser.lastSeen,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      };

      res.json({
        message: `User ${newStatus ? "enabled" : "disabled"} successfully`,
        user: userResponse,
      });
    } catch (error) {
      console.error("Toggle user status error:", error);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        message: "Server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
);

// Delete user (soft delete)
router.delete(
  "/:id",
  auth,
  authorize("superadmin", "admin"),
  async (req, res) => {
    try {
      const userId = req.params.id;

      // Admin cannot delete another admin
      if (req.user.role === "admin") {
        const targetUser = await User.findById(userId);
        if (targetUser && targetUser.role === "admin") {
          return res
            .status(403)
            .json({ message: "Admin cannot delete another admin" });
        }
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { isActive: false },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User deactivated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Stream profile images from GridFS (public, no auth so <img> tags work)
router.get("/profile-image/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!gridfsBucket) {
      return res.status(500).json({ message: "File store not initialized" });
    }
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(id);
    } catch (e) {
      return res.status(400).json({ message: "Invalid file id" });
    }

    const filesColl = mongoose.connection.db.collection("profileImages.files");
    const file = await filesColl.findOne({ _id: objectId });
    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }
    res.set(
      "Content-Type",
      file.contentType ||
        file.metadata?.contentType ||
        "application/octet-stream"
    );
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    const downloadStream = gridfsBucket.openDownloadStream(objectId);
    downloadStream.on("error", () => res.status(500).end());
    downloadStream.pipe(res);
  } catch (error) {
    console.error("Profile image stream error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
