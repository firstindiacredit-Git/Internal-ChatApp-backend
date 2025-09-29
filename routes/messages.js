const express = require("express");
const { body, validationResult } = require("express-validator");
const Message = require("../models/Message");
const Group = require("../models/Group");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

const router = express.Router();

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
  [
    body("receiver").isMongoId().withMessage("Valid receiver ID is required"),
    body("message")
      .trim()
      .isLength({ min: 1 })
      .withMessage("Message cannot be empty"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { receiver, message } = req.body;
      const sender = req.user._id;

      // Verify receiver exists and is active
      const receiverUser = await User.findById(receiver);
      if (!receiverUser || !receiverUser.isActive) {
        return res.status(404).json({ message: "Receiver not found" });
      }

      const newMessage = new Message({
        sender,
        receiver,
        message,
        messageType: "text",
      });

      await newMessage.save();

      const populatedMessage = await Message.findById(newMessage._id)
        .populate("sender", "name email profileImage")
        .populate("receiver", "name email profileImage");

      res.status(201).json({
        message: "Message sent successfully",
        data: populatedMessage,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Send group message
router.post(
  "/group",
  auth,
  [
    body("group").isMongoId().withMessage("Valid group ID is required"),
    body("message")
      .trim()
      .isLength({ min: 1 })
      .withMessage("Message cannot be empty"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { group, message } = req.body;
      const sender = req.user._id;

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

      const newMessage = new Message({
        sender,
        group,
        message,
        messageType: "text",
      });

      await newMessage.save();

      const populatedMessage = await Message.findById(newMessage._id).populate(
        "sender",
        "name email profileImage"
      );

      res.status(201).json({
        message: "Message sent successfully",
        data: populatedMessage,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

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
