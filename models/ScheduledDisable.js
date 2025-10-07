const mongoose = require("mongoose");

const scheduledDisableSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    enableTime: {
      type: String,
      default: null, // Format: "HH:mm" - Time to enable users
    },
    disableTime: {
      type: String,
      default: null, // Format: "HH:mm" - Time to disable users
    },
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    applyToAllUsers: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    days: {
      type: [String],
      enum: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
      default: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastTriggeredEnable: {
      type: Date,
      default: null,
    },
    lastTriggeredDisable: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ScheduledDisable", scheduledDisableSchema);
