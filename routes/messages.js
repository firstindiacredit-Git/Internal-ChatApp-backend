const express = require("express");
const { body, validationResult } = require("express-validator");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Message = require("../models/Message");
const Group = require("../models/Group");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
// io will be acquired from req.app.get('io') to avoid circular imports

const router = express.Router();

// Check if Cloudinary is configured
const isCloudinaryConfigured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

// GridFS setup for storing images directly in MongoDB
let gridfsBucket;
mongoose.connection.once("open", () => {
  gridfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "messageImages",
  });
});

// Use memory storage so we can route images to GridFS and others to cloud/local
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, true),
});

// Get messages between two users
router.get("/personal/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    // Verify the other user exists (don't check isActive for messages)
    const otherUser = await User.findById(userId);
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId },
      ],
    })
      .populate("sender", "name email profileImage")
      .populate("receiver", "name email profileImage")
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get group messages
router.get("/group/:groupId", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user._id;

    // Verify user is member of the group
    const group = await Group.findById(groupId);
    if (!group || !group.isActive) {
      return res.status(404).json({ message: "Group not found" });
    }

    const isMember = group.members.some(
      (member) => member.user.toString() === currentUserId.toString()
    );

    if (!isMember) {
      return res
        .status(403)
        .json({ message: "You are not a member of this group" });
    }

    const messages = await Message.find({ group: groupId })
      .populate("sender", "name email profileImage")
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Send personal message
router.post(
  "/personal",
  auth,
  upload.single("file"),
  [
    body("receiver").isMongoId().withMessage("Valid receiver ID is required"),
    body("message").optional().trim(),
    body("messageType").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { receiver, message, messageType } = req.body;
      const sender = req.user._id;

      console.log("📨 Personal message request:", {
        receiver,
        message,
        messageType,
        hasFile: !!req.file,
        fileInfo: req.file
          ? {
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
            }
          : null,
      });

      // Validate that either message or file is provided
      if (!message && !req.file) {
        return res
          .status(400)
          .json({ message: "Either message text or file is required" });
      }

      // Verify receiver exists and is active
      const receiverUser = await User.findById(receiver);
      if (!receiverUser || !receiverUser.isActive) {
        return res.status(404).json({ message: "Receiver not found" });
      }

      // Determine message type and content
      let finalMessage = message || "";
      let finalMessageType = messageType || "text";
      let fileData = {};

      // Define finalize before any async callbacks use it
      async function finalizeAndRespond() {
        const newMessage = new Message({
          sender,
          receiver,
          message: finalMessage,
          messageType: finalMessageType,
          ...fileData,
        });

        await newMessage.save();

        const populatedMessage = await Message.findById(newMessage._id)
          .populate("sender", "name email profileImage")
          .populate("receiver", "name email profileImage");

        // Emit realtime updates (REST path)
        const payload = {
          id: populatedMessage._id,
          sender: populatedMessage.sender,
          receiver,
          message: populatedMessage.message,
          messageType: populatedMessage.messageType,
          fileUrl: populatedMessage.fileUrl,
          fileName: populatedMessage.fileName,
          fileSize: populatedMessage.fileSize,
          fileType: populatedMessage.fileType,
          timestamp: populatedMessage.createdAt,
          createdAt: populatedMessage.createdAt,
        };
        try {
          const io = req.app.get("io");
          if (io) {
            io.to(receiver.toString()).emit("receive-message", payload);
            io.to(sender.toString()).emit("message-sent", payload);
          }
        } catch (e) {
          console.warn("Socket emit failed (REST personal):", e.message);
        }

        res.status(201).json({
          message: "Message sent successfully",
          data: populatedMessage,
        });
      }

      if (req.file) {
        // File upload
        finalMessageType = req.file.mimetype.startsWith("image/")
          ? "image"
          : req.file.mimetype.startsWith("video/")
          ? "video"
          : req.file.mimetype.startsWith("audio/")
          ? "audio"
          : "file";

        if (finalMessageType === "image") {
          // Save image to MongoDB GridFS
          if (!gridfsBucket) {
            return res
              .status(500)
              .json({ message: "File system not initialized" });
          }
          const filename = `img-${Date.now()}-${req.file.originalname}`;
          const uploadStream = gridfsBucket.openUploadStream(filename, {
            contentType: req.file.mimetype,
          });
          uploadStream.end(req.file.buffer);

          uploadStream.on("error", (err) => {
            console.error("GridFS upload error:", err);
            return res.status(500).json({ message: "Failed to store image" });
          });

          uploadStream.on("finish", (file) => {
            fileData = {
              fileUrl: `/api/messages/file/${file._id.toString()}`,
              fileName: req.file.originalname,
              fileSize: req.file.size,
              fileType: req.file.mimetype,
            };

            if (!finalMessage) {
              finalMessage = `📎 ${req.file.originalname}`;
            }

            finalizeAndRespond();
          });

          // Early return: will respond in finish handler
          return;
        } else {
          // Non-image: use Cloudinary if configured, else save to local filesystem
          if (isCloudinaryConfigured) {
            cloudinary.config({
              cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
              api_key: process.env.CLOUDINARY_API_KEY,
              api_secret: process.env.CLOUDINARY_API_SECRET,
            });
            await new Promise((resolve, reject) => {
              const cld = cloudinary.uploader.upload_stream(
                { folder: "chat-messages", resource_type: "auto" },
                (error, result) => {
                  if (error) return reject(error);
                  fileData = {
                    fileUrl: result.secure_url,
                    fileName: req.file.originalname,
                    fileSize: req.file.size,
                    fileType: req.file.mimetype,
                  };
                  resolve();
                }
              );
              cld.end(req.file.buffer);
            });
          } else {
            const uploadPath = path.join(__dirname, "../uploads/messages");
            if (!fs.existsSync(uploadPath)) {
              fs.mkdirSync(uploadPath, { recursive: true });
            }
            const fname = `message-${Date.now()}-${Math.round(
              Math.random() * 1e9
            )}${path.extname(req.file.originalname)}`;
            const fullPath = path.join(uploadPath, fname);
            fs.writeFileSync(fullPath, req.file.buffer);
            fileData = {
              fileUrl: `/uploads/messages/${fname}`,
              fileName: req.file.originalname,
              fileSize: req.file.size,
              fileType: req.file.mimetype,
            };
          }

          if (!finalMessage) {
            finalMessage = `📎 ${req.file.originalname}`;
          }
        }
      }

      if (!req.file || finalMessageType !== "image") {
        await finalizeAndRespond();
      }
    } catch (error) {
      console.error("Personal message error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Send group message
router.post(
  "/group",
  auth,
  upload.single("file"),
  [
    body("group").isMongoId().withMessage("Valid group ID is required"),
    body("message").optional().trim(),
    body("messageType").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log("❌ Group message validation errors:", errors.array());
        return res.status(400).json({ errors: errors.array() });
      }

      const { group, message, messageType } = req.body;
      const sender = req.user._id;

      console.log("📨 Group message request:", {
        group,
        message,
        messageType,
        hasFile: !!req.file,
        fileInfo: req.file
          ? {
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
            }
          : null,
      });

      // Validate that either message or file is provided
      if (!message && !req.file) {
        return res
          .status(400)
          .json({ message: "Either message text or file is required" });
      }

      // Verify group exists and user is member
      const groupData = await Group.findById(group);
      if (!groupData || !groupData.isActive) {
        return res.status(404).json({ message: "Group not found" });
      }

      const isMember = groupData.members.some(
        (member) => member.user.toString() === sender.toString()
      );

      if (!isMember) {
        return res
          .status(403)
          .json({ message: "You are not a member of this group" });
      }

      // Determine message type and content
      let finalMessage = message || "";
      let finalMessageType = messageType || "text";
      let fileData = {};

      // Define finalize before any async callbacks use it
      async function finalizeAndRespond() {
        const newMessage = new Message({
          sender,
          group,
          message: finalMessage,
          messageType: finalMessageType,
          ...fileData,
        });

        await newMessage.save();

        const populatedMessage = await Message.findById(
          newMessage._id
        ).populate("sender", "name email profileImage");

        // Emit realtime updates to group (REST path)
        const groupPayload = {
          id: populatedMessage._id,
          groupId: group,
          sender: populatedMessage.sender,
          message: populatedMessage.message,
          messageType: populatedMessage.messageType,
          fileUrl: populatedMessage.fileUrl,
          fileName: populatedMessage.fileName,
          fileSize: populatedMessage.fileSize,
          fileType: populatedMessage.fileType,
          timestamp: populatedMessage.createdAt,
          createdAt: populatedMessage.createdAt,
        };
        try {
          const io = req.app.get("io");
          if (io) {
            io.to(group.toString()).emit("receive-group-message", groupPayload);
            io.to(sender.toString()).emit("group-message-sent", groupPayload);
          }
        } catch (e) {
          console.warn("Socket emit failed (REST group):", e.message);
        }

        res.status(201).json({
          message: "Message sent successfully",
          data: populatedMessage,
        });
      }

      if (req.file) {
        // File upload
        finalMessageType = req.file.mimetype.startsWith("image/")
          ? "image"
          : req.file.mimetype.startsWith("video/")
          ? "video"
          : req.file.mimetype.startsWith("audio/")
          ? "audio"
          : "file";

        if (finalMessageType === "image") {
          // Save image to MongoDB GridFS
          if (!gridfsBucket) {
            return res
              .status(500)
              .json({ message: "File system not initialized" });
          }
          const filename = `img-${Date.now()}-${req.file.originalname}`;
          const uploadStream = gridfsBucket.openUploadStream(filename, {
            contentType: req.file.mimetype,
          });
          uploadStream.end(req.file.buffer);

          uploadStream.on("error", (err) => {
            console.error("GridFS upload error:", err);
            return res.status(500).json({ message: "Failed to store image" });
          });

          uploadStream.on("finish", (file) => {
            fileData = {
              fileUrl: `/api/messages/file/${file._id.toString()}`,
              fileName: req.file.originalname,
              fileSize: req.file.size,
              fileType: req.file.mimetype,
            };

            if (!finalMessage) {
              finalMessage = `📎 ${req.file.originalname}`;
            }

            finalizeAndRespond();
          });

          // Early return: will respond in finish handler
          return;
        } else {
          // Non-image: use Cloudinary if configured, else save to local filesystem
          if (isCloudinaryConfigured) {
            cloudinary.config({
              cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
              api_key: process.env.CLOUDINARY_API_KEY,
              api_secret: process.env.CLOUDINARY_API_SECRET,
            });
            await new Promise((resolve, reject) => {
              const cld = cloudinary.uploader.upload_stream(
                { folder: "chat-messages", resource_type: "auto" },
                (error, result) => {
                  if (error) return reject(error);
                  fileData = {
                    fileUrl: result.secure_url,
                    fileName: req.file.originalname,
                    fileSize: req.file.size,
                    fileType: req.file.mimetype,
                  };
                  resolve();
                }
              );
              cld.end(req.file.buffer);
            });
          } else {
            const uploadPath = path.join(__dirname, "../uploads/messages");
            if (!fs.existsSync(uploadPath)) {
              fs.mkdirSync(uploadPath, { recursive: true });
            }
            const fname = `message-${Date.now()}-${Math.round(
              Math.random() * 1e9
            )}${path.extname(req.file.originalname)}`;
            const fullPath = path.join(uploadPath, fname);
            fs.writeFileSync(fullPath, req.file.buffer);
            fileData = {
              fileUrl: `/uploads/messages/${fname}`,
              fileName: req.file.originalname,
              fileSize: req.file.size,
              fileType: req.file.mimetype,
            };
          }

          if (!finalMessage) {
            finalMessage = `📎 ${req.file.originalname}`;
          }
        }
      }

      if (!req.file || finalMessageType !== "image") {
        await finalizeAndRespond();
      }
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Stream files from GridFS by id (public, no auth so <img> tags work)
router.get("/file/:id", async (req, res) => {
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

    const filesColl = mongoose.connection.db.collection("messageImages.files");
    const chunksColl = mongoose.connection.db.collection(
      "messageImages.chunks"
    );
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
    res.status(500).json({ message: "Server error" });
  }
});

// Mark message as read
router.put("/:messageId/read", auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if user is already marked as read
    const alreadyRead = message.readBy.some(
      (read) => read.user.toString() === userId.toString()
    );

    if (!alreadyRead) {
      message.readBy.push({
        user: userId,
        readAt: new Date(),
      });
      await message.save();
    }

    res.json({ message: "Message marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get unread message count
router.get("/unread/count", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const unreadCount = await Message.countDocuments({
      $or: [
        { receiver: userId, isRead: false },
        { group: { $exists: true }, "readBy.user": { $ne: userId } },
      ],
    });

    res.json({ unreadCount });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Edit message text (sender only)
router.put("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });
    if (msg.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }
    msg.message = message.trim();
    msg.editedAt = new Date();
    await msg.save();

    const populated = await Message.findById(id).populate(
      "sender",
      "name email profileImage"
    );

    const io = req.app.get("io");
    if (io) {
      const room = msg.group ? msg.group.toString() : msg.receiver.toString();
      const event = msg.group ? "receive-group-message" : "receive-message";
      const payload = {
        id: populated._id,
        groupId: msg.group || undefined,
        sender: populated.sender,
        message: populated.message,
        messageType: populated.messageType,
        fileUrl: populated.fileUrl,
        fileName: populated.fileName,
        fileSize: populated.fileSize,
        fileType: populated.fileType,
        timestamp: populated.createdAt,
        createdAt: populated.createdAt,
        editedAt: populated.editedAt,
      };
      io.to(room).emit(event, payload);
    }

    res.json({ message: "Updated", data: populated });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// Soft delete a message (sender only)
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ message: "Message not found" });
    if (msg.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }
    msg.isDeleted = true;
    if (msg.messageType === "text") {
      msg.message = "This message was deleted";
    }
    await msg.save();

    const io = req.app.get("io");
    if (io) {
      const room = msg.group ? msg.group.toString() : msg.receiver.toString();
      const event = msg.group ? "receive-group-message" : "receive-message";
      io.to(room).emit(event, { id: msg._id, isDeleted: true });
    }

    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// Forward message to multiple users/groups
router.post("/forward", auth, async (req, res) => {
  try {
    const { messageId, targets } = req.body; // targets: { users:[], groups:[] }
    if (
      !messageId ||
      (!Array.isArray(targets?.users) && !Array.isArray(targets?.groups))
    ) {
      return res
        .status(400)
        .json({ message: "messageId and targets are required" });
    }
    const original = await Message.findById(messageId);
    if (!original)
      return res.status(404).json({ message: "Original message not found" });

    const created = [];
    const io = req.app.get("io");

    // Forward to users
    for (const uid of targets.users || []) {
      const m = new Message({
        sender: req.user._id,
        receiver: uid,
        message: original.message,
        messageType: original.messageType,
        fileUrl: original.fileUrl,
        fileName: original.fileName,
        fileSize: original.fileSize,
        fileType: original.fileType,
      });
      await m.save();
      await m.populate("sender", "name email profileImage");
      created.push(m);
      if (io) {
        const payload = {
          id: m._id,
          sender: m.sender,
          receiver: uid,
          message: m.message,
          messageType: m.messageType,
          fileUrl: m.fileUrl,
          fileName: m.fileName,
          fileSize: m.fileSize,
          fileType: m.fileType,
          timestamp: m.createdAt,
          createdAt: m.createdAt,
        };
        io.to(uid.toString()).emit("receive-message", payload);
        io.to(req.user._id.toString()).emit("message-sent", payload);
      }
    }

    // Forward to groups
    for (const gid of targets.groups || []) {
      const m = new Message({
        sender: req.user._id,
        group: gid,
        message: original.message,
        messageType: original.messageType,
        fileUrl: original.fileUrl,
        fileName: original.fileName,
        fileSize: original.fileSize,
        fileType: original.fileType,
      });
      await m.save();
      await m.populate("sender", "name email profileImage");
      created.push(m);
      if (io) {
        const payload = {
          id: m._id,
          groupId: gid,
          sender: m.sender,
          message: m.message,
          messageType: m.messageType,
          fileUrl: m.fileUrl,
          fileName: m.fileName,
          fileSize: m.fileSize,
          fileType: m.fileType,
          timestamp: m.createdAt,
          createdAt: m.createdAt,
        };
        io.to(gid.toString()).emit("receive-group-message", payload);
        io.to(req.user._id.toString()).emit("group-message-sent", payload);
      }
    }

    res.json({ message: "Forwarded", count: created.length });
  } catch (e) {
    console.error("Forward error", e);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user chat state (last messages and counts)
router.get("/chat-state", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get unread counts for personal chats
    const personalChats = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: userId }, { receiver: userId }],
          group: { $exists: false },
        },
      },
      {
        $addFields: {
          chatPartner: {
            $cond: [{ $eq: ["$sender", userId] }, "$receiver", "$sender"],
          },
          isUnreadForCurrentUser: {
            $and: [
              { $ne: ["$sender", userId] },
              {
                $or: [
                  { $eq: [{ $type: "$readBy" }, "missing"] },
                  { $eq: [{ $size: "$readBy" }, 0] },
                  {
                    $not: [{ $in: [userId, "$readBy.user"] }],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $sort: {
          createdAt: 1, // Sort by oldest first for $last to get newest
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "senderInfo",
        },
      },
      {
        $addFields: {
          sender: { $arrayElemAt: ["$senderInfo", 0] },
        },
      },
      {
        $group: {
          _id: "$chatPartner",
          lastMessage: {
            $last: "$$ROOT", // This will get the most recent message now
          },
          unreadCount: {
            $sum: {
              $cond: ["$isUnreadForCurrentUser", 1, 0],
            },
          },
        },
      },
      {
        $match: {
          "lastMessage.message": { $exists: true, $ne: null },
        },
      },
    ]);

    // Get last messages and unread counts for groups
    const groupChats = await Message.aggregate([
      {
        $match: {
          group: { $exists: true, $ne: null },
        },
      },
      {
        $lookup: {
          from: "groups",
          localField: "group",
          foreignField: "_id",
          as: "groupData",
        },
      },
      {
        $match: {
          "groupData.members.user": userId,
        },
      },
      {
        $addFields: {
          isUnreadForCurrentUser: {
            $and: [
              { $ne: ["$sender", userId] },
              {
                $or: [
                  { $eq: [{ $type: "$readBy" }, "missing"] },
                  { $eq: [{ $size: "$readBy" }, 0] },
                  {
                    $not: [{ $in: [userId, "$readBy.user"] }],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $sort: {
          createdAt: 1, // Sort by oldest first for $last to get newest
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "senderInfo",
        },
      },
      {
        $addFields: {
          sender: { $arrayElemAt: ["$senderInfo", 0] },
        },
      },
      {
        $group: {
          _id: "$group",
          lastMessage: {
            $last: "$$ROOT", // This will get the most recent message now
          },
          unreadCount: {
            $sum: {
              $cond: ["$isUnreadForCurrentUser", 1, 0],
            },
          },
        },
      },
      {
        $match: {
          "lastMessage.message": { $exists: true, $ne: null },
        },
      },
    ]);

    const result = {
      personalChats: personalChats.map((chat) => ({
        chatId: chat._id,
        lastMessage: {
          ...chat.lastMessage,
          // Get sender info properly
          sender: chat.lastMessage.sender,
          senderName:
            chat.lastMessage.sender?.name ||
            chat.lastMessage.sender?.firstName ||
            "Unknown",
          senderId: chat.lastMessage.sender?._id || chat.lastMessage.sender,
        },
        unreadCount: chat.unreadCount,
      })),
      groupChats: groupChats.map((chat) => ({
        chatId: chat._id,
        lastMessage: {
          ...chat.lastMessage,
          // Get sender info properly
          sender: chat.lastMessage.sender,
          senderName:
            chat.lastMessage.sender?.name ||
            chat.lastMessage.sender?.firstName ||
            "Unknown",
          senderId: chat.lastMessage.sender?._id || chat.lastMessage.sender,
        },
        unreadCount: chat.unreadCount,
      })),
    };

    res.json(result);
  } catch (error) {
    console.error("Error fetching chat state:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update chat state (clear unread count, update last read)
router.post("/chat-state", auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { chatId, chatType, action } = req.body;

    if (action === "clear_unread" && chatId) {
      if (chatType === "personal") {
        // Mark all messages from this user as read
        await Message.updateMany(
          {
            $or: [
              { sender: chatId, receiver: userId },
              { sender: userId, receiver: chatId },
            ],
            "readBy.user": { $ne: userId },
          },
          {
            $addToSet: {
              readBy: {
                user: userId,
                readAt: new Date(),
              },
            },
          }
        );
      } else if (chatType === "group") {
        // Mark all unread group messages as read by this user
        await Message.updateMany(
          {
            group: chatId,
            "readBy.user": { $ne: userId },
            sender: { $ne: userId },
          },
          {
            $addToSet: {
              readBy: {
                user: userId,
                readAt: new Date(),
              },
            },
          }
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error updating chat state:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
