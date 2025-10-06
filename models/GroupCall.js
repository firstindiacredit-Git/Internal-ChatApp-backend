const mongoose = require("mongoose");

const groupCallSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    initiator: {
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
      enum: ["initiated", "active", "ended"],
      default: "initiated",
    },
    roomName: {
      type: String,
      unique: true,
      sparse: true, // This allows multiple null values
    },
    participants: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        isMuted: {
          type: Boolean,
          default: false,
        },
        isVideoEnabled: {
          type: Boolean,
          default: true,
        },
      },
    ],
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
    // WebRTC signaling data for each participant
    connections: [
      {
        from: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        to: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
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
groupCallSchema.index({ group: 1, startTime: -1 });
groupCallSchema.index({ initiator: 1, startTime: -1 });
groupCallSchema.index({ status: 1 });
groupCallSchema.index({ callType: 1 });

// Virtual for call duration calculation
groupCallSchema.virtual("calculatedDuration").get(function () {
  if (this.endTime && this.startTime) {
    return Math.floor((this.endTime - this.startTime) / 1000);
  }
  return 0;
});

// Method to add participant to the call
groupCallSchema.methods.addParticipant = function (userId) {
  const existingParticipant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (!existingParticipant) {
    this.participants.push({
      user: userId,
      joinedAt: new Date(),
      isActive: true,
      isMuted: false,
      isVideoEnabled: this.callType === "video",
    });
  } else {
    existingParticipant.isActive = true;
    existingParticipant.joinedAt = new Date();
  }

  return this.save();
};

// Method to remove participant from the call
groupCallSchema.methods.removeParticipant = function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (participant) {
    participant.isActive = false;
  }

  return this.save();
};

// Method to end the call
groupCallSchema.methods.endCall = function () {
  this.status = "ended";
  this.endTime = new Date();
  this.duration = this.calculatedDuration;

  // Mark all participants as inactive
  this.participants.forEach((participant) => {
    participant.isActive = false;
  });

  return this.save();
};

// Method to get active participants
groupCallSchema.methods.getActiveParticipants = function () {
  return this.participants.filter((p) => p.isActive);
};

// Method to toggle participant mute
groupCallSchema.methods.toggleParticipantMute = function (userId, isMuted) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (participant) {
    participant.isMuted = isMuted;
    return this.save();
  }

  return Promise.reject(new Error("Participant not found"));
};

// Method to toggle participant video
groupCallSchema.methods.toggleParticipantVideo = function (
  userId,
  isVideoEnabled
) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (participant) {
    participant.isVideoEnabled = isVideoEnabled;
    return this.save();
  }

  return Promise.reject(new Error("Participant not found"));
};

module.exports = mongoose.model("GroupCall", groupCallSchema);
