const mongoose = require("mongoose");

const timeSettingsSchema = new mongoose.Schema(
  {
    autoDisableTime: {
      type: String,
      default: "13:15", // Default to 1:15 PM (HH:mm format)
      required: true,
    },
    autoDisableEnabled: {
      type: Boolean,
      default: true,
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
    },
  },
  {
    timestamps: true,
  }
);

// Singleton pattern - only one settings document
timeSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      autoDisableTime: "13:15",
      autoDisableEnabled: true,
    });
  }
  return settings;
};

module.exports = mongoose.model("TimeSettings", timeSettingsSchema);
