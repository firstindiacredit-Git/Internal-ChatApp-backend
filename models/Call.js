const mongoose = require("mongoose");

const callSchema = new mongoose.Schema(
  {
    caller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    callType: {
      type: String,
      enum: ["voice", "video"],
      default: "voice",
    },
    status: {
      type: String,
      enum: ["initiated", "ringing", "answered", "declined", "missed", "ended"],
      default: "initiated",
    },
    roomName: {
      type: String,
      required: true,
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number, // Duration in seconds
      default: 0,
    },
    // WebRTC signaling data
    offer: {
      type: String,
      default: null,
    },
    answer: {
      type: String,
      default: null,
    },
    iceCandidates: [
      {
        candidate: String,
        sdpMLineIndex: Number,
        sdpMid: String,
      },
    ],
    // Call quality metrics
    quality: {
      audioQuality: {
        type: String,
        enum: ["excellent", "good", "fair", "poor"],
        default: "good",
      },
      videoQuality: {
        type: String,
        enum: ["excellent", "good", "fair", "poor"],
        default: "good",
      },
    },
    // Call notes or tags
    notes: {
      type: String,
      default: "",
    },
    // Whether the call was recorded
    isRecorded: {
      type: Boolean,
      default: false,
    },
    // Recording URL if available
    recordingUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
callSchema.index({ caller: 1, startTime: -1 });
callSchema.index({ receiver: 1, startTime: -1 });
callSchema.index({ status: 1 });
callSchema.index({ callType: 1 });

// Virtual for call duration calculation
callSchema.virtual("calculatedDuration").get(function () {
  if (this.endTime && this.startTime) {
    return Math.floor((this.endTime - this.startTime) / 1000);
  }
  return 0;
});

// Method to end the call
callSchema.methods.endCall = function () {
  this.status = "ended";
  this.endTime = new Date();
  this.duration = this.calculatedDuration;
  return this.save();
};

// Method to mark as missed
callSchema.methods.markAsMissed = function () {
  this.status = "missed";
  this.endTime = new Date();
  return this.save();
};

// Method to mark as declined
callSchema.methods.markAsDeclined = function () {
  this.status = "declined";
  this.endTime = new Date();
  return this.save();
};

// Method to answer the call
callSchema.methods.answerCall = function () {
  this.status = "answered";
  return this.save();
};

module.exports = mongoose.model("Call", callSchema);
