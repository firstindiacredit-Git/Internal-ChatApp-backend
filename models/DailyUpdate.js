const mongoose = require("mongoose");

const dailyUpdateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    media: [
      {
        type: {
          type: String,
          enum: ["image", "video"],
        },
        url: String,
        publicId: String, // For Cloudinary
        filename: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
dailyUpdateSchema.index({ user: 1, date: -1 });

// Ensure one update per user per day
dailyUpdateSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("DailyUpdate", dailyUpdateSchema);
