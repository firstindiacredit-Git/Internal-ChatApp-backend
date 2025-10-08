const express = require("express");
const { body, validationResult } = require("express-validator");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Group = require("../models/Group");
const User = require("../models/User");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Configure multer for group avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../uploads/groups");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "group-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for group avatars
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Get all groups
router.get("/", auth, async (req, res) => {
  try {
    const groups = await Group.find({ isActive: true })
      .populate("createdBy", "name email")
      .populate("members.user", "name email")
      .sort({ createdAt: -1 });

    // Transform _id to id for frontend compatibility
    const transformedGroups = groups.map((group) => ({
      id: group._id,
      name: group.name,
      description: group.description,
      createdBy: group.createdBy,
      members: group.members,
      isActive: group.isActive,
      avatar: group.avatar,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    }));

    res.json(transformedGroups);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get user's groups
router.get("/my-groups", auth, async (req, res) => {
  try {
    const groups = await Group.find({
      isActive: true,
      "members.user": req.user._id,
    })
      .populate("createdBy", "name email")
      .populate("members.user", "name email")
      .sort({ createdAt: -1 });

    // Transform _id to id for frontend compatibility
    const transformedGroups = groups.map((group) => ({
      id: group._id,
      name: group.name,
      description: group.description,
      createdBy: group.createdBy,
      members: group.members,
      isActive: group.isActive,
      avatar: group.avatar,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    }));

    res.json(transformedGroups);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Create new group (Admin can create groups)
router.post(
  "/",
  auth,
  authorize("admin"),
  [
    body("name")
      .trim()
      .isLength({ min: 2 })
      .withMessage("Group name must be at least 2 characters"),
    body("description").optional().trim(),
    body("members").isArray().withMessage("Members must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, members } = req.body;

      // Validate that all members exist and are active
      const memberIds = members.map((member) => member.user);
      const users = await User.find({
        _id: { $in: memberIds },
        isActive: true,
      });

      if (users.length !== memberIds.length) {
        return res
          .status(400)
          .json({ message: "Some members are invalid or inactive" });
      }

      // Add creator as admin
      const groupMembers = [
        {
          user: req.user._id,
          role: "admin",
        },
        ...members,
      ];

      const group = new Group({
        name,
        description,
        createdBy: req.user._id,
        members: groupMembers,
      });

      await group.save();

      const populatedGroup = await Group.findById(group._id)
        .populate("createdBy", "name email")
        .populate("members.user", "name email");

      res.status(201).json({
        message: "Group created successfully",
        group: populatedGroup,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Add members to group
router.post(
  "/:id/members",
  auth,
  authorize("admin"),
  [body("members").isArray().withMessage("Members must be an array")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { members } = req.body;
      const groupId = req.params.id;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({ message: "Group not found" });
      }

      // Check if user is admin of the group
      const isAdmin = group.members.some(
        (member) =>
          member.user.toString() === req.user._id.toString() &&
          member.role === "admin"
      );

      if (!isAdmin) {
        return res
          .status(403)
          .json({ message: "Only group admins can add members" });
      }

      // Validate new members
      const memberIds = members.map((member) => member.user);
      const users = await User.find({
        _id: { $in: memberIds },
        isActive: true,
      });

      if (users.length !== memberIds.length) {
        return res
          .status(400)
          .json({ message: "Some members are invalid or inactive" });
      }

      // Add new members
      group.members.push(...members);
      await group.save();

      const populatedGroup = await Group.findById(group._id)
        .populate("createdBy", "name email")
        .populate("members.user", "name email");

      res.json({
        message: "Members added successfully",
        group: populatedGroup,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Remove member from group
router.delete(
  "/:id/members/:memberId",
  auth,
  authorize("admin"),
  async (req, res) => {
    try {
      const { id: groupId, memberId } = req.params;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({ message: "Group not found" });
      }

      // Check if user is admin of the group
      const isAdmin = group.members.some(
        (member) =>
          member.user.toString() === req.user._id.toString() &&
          member.role === "admin"
      );

      if (!isAdmin) {
        return res
          .status(403)
          .json({ message: "Only group admins can remove members" });
      }

      group.members = group.members.filter(
        (member) => member.user.toString() !== memberId
      );

      await group.save();

      res.json({ message: "Member removed successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Update group
router.put(
  "/:id",
  auth,
  authorize("admin"),
  [
    body("name").optional().trim().isLength({ min: 2 }),
    body("description").optional().trim(),
    body("members")
      .optional()
      .isArray()
      .withMessage("Members must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, members } = req.body;
      const groupId = req.params.id;

      const group = await Group.findById(groupId);
      if (!group || !group.isActive) {
        return res.status(404).json({ message: "Group not found" });
      }

      // Check if user is admin of the group
      const isAdmin = group.members.some(
        (member) =>
          member.user.toString() === req.user._id.toString() &&
          member.role === "admin"
      );

      if (!isAdmin) {
        return res
          .status(403)
          .json({ message: "Only group admins can update the group" });
      }

      const updateData = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      // Handle members update - no maximum limit
      if (members && Array.isArray(members)) {
        // Validate that all members exist and are active
        const memberIds = members.map((member) => member.user);
        const users = await User.find({
          _id: { $in: memberIds },
          isActive: true,
        });

        if (users.length !== memberIds.length) {
          return res
            .status(400)
            .json({ message: "Some members are invalid or inactive" });
        }

        // Ensure the admin (creator) is always included
        const hasAdmin = members.some(
          (member) =>
            member.user.toString() === req.user._id.toString() &&
            member.role === "admin"
        );

        if (!hasAdmin) {
          // Add the current admin if not present
          members.unshift({
            user: req.user._id,
            role: "admin",
          });
        }

        updateData.members = members;
      }

      const updatedGroup = await Group.findByIdAndUpdate(groupId, updateData, {
        new: true,
        runValidators: true,
      })
        .populate("createdBy", "name email")
        .populate("members.user", "name email");

      res.json({
        message: "Group updated successfully",
        group: updatedGroup,
      });
    } catch (error) {
      console.error("Group update error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete group
router.delete("/:id", auth, authorize("admin"), async (req, res) => {
  try {
    const groupId = req.params.id;

    const group = await Group.findById(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if user is admin of the group
    const isAdmin = group.members.some(
      (member) =>
        member.user.toString() === req.user._id.toString() &&
        member.role === "admin"
    );

    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: "Only group admins can delete the group" });
    }

    await Group.findByIdAndUpdate(groupId, { isActive: false });

    res.json({ message: "Group deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Upload group avatar
router.post(
  "/:id/avatar",
  auth,
  authorize("admin"),
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const groupId = req.params.id;
      const group = await Group.findById(groupId);

      if (!group || !group.isActive) {
        return res.status(404).json({ message: "Group not found" });
      }

      // Check if user is admin of the group
      const isAdmin = group.members.some(
        (member) =>
          member.user.toString() === req.user._id.toString() &&
          member.role === "admin"
      );

      if (!isAdmin) {
        return res
          .status(403)
          .json({ message: "Only group admins can upload avatars" });
      }

      // Delete old avatar if exists
      if (group.avatar) {
        const oldAvatarPath = path.join(
          __dirname,
          "../uploads/groups",
          path.basename(group.avatar)
        );
        if (fs.existsSync(oldAvatarPath)) {
          fs.unlinkSync(oldAvatarPath);
        }
      }

      // Update group with new avatar
      group.avatar = `/uploads/groups/${req.file.filename}`;
      await group.save();

      const populatedGroup = await Group.findById(group._id)
        .populate("createdBy", "name email")
        .populate("members.user", "name email");

      res.json({
        message: "Avatar uploaded successfully",
        group: populatedGroup,
      });
    } catch (error) {
      console.error("Avatar upload error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
