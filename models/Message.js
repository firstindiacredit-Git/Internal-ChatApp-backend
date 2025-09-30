const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return !this.group; // Required if not a group message
      },
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: function () {
        return !this.receiver; // Required if not a personal message
      },
    },
    message: {
      type: String,
      required: function () {
        return !this.fileUrl; // Only required if no file is attached
      },
      trim: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "audio", "video"],
      default: "text",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    fileUrl: {
      type: String,
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    fileSize: {
      type: Number,
      default: null,
    },
    fileType: {
      type: String,
      default: null,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ group: 1, createdAt: -1 });
messageSchema.index({ "readBy.user": 1 });

module.exports = mongoose.model("Message", messageSchema);
