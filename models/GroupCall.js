const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  leftAt: {
    type: Date,
    default: null,
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
  role: {
    type: String,
    enum: ["participant", "host"],
    default: "participant",
  },
});

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
      required: true,
      unique: true,
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
    participants: [participantSchema],
    maxParticipants: {
      type: Number,
      default: 10,
    },
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
groupCallSchema.index({ roomName: 1 });

// Virtual for call duration calculation
groupCallSchema.virtual("calculatedDuration").get(function () {
  if (this.endTime && this.startTime) {
    return Math.floor((this.endTime - this.startTime) / 1000);
  }
  return 0;
});

// Virtual for active participants count
groupCallSchema.virtual("activeParticipantsCount").get(function () {
  return this.participants.filter((p) => p.isActive).length;
});

// Static method to create a new group call
groupCallSchema.statics.createGroupCall = async function (
  groupId,
  initiatorId,
  callType = "voice"
) {
  // Generate unique room name
  const roomName = `group-${groupId}-${Date.now()}-${Math.floor(
    Math.random() * 1000000
  )}`;

  const groupCall = new this({
    group: groupId,
    initiator: initiatorId,
    callType,
    roomName,
    participants: [
      {
        user: initiatorId,
        role: "host",
        joinedAt: new Date(),
        isActive: true,
      },
    ],
  });

  return await groupCall.save();
};

// Method to add a participant to the call
groupCallSchema.methods.addParticipant = async function (userId) {
  // Check if user is already a participant
  const existingParticipant = this.participants.find(
    (p) => p.user.toString() === userId && p.isActive
  );

  if (existingParticipant) {
    // If user was in call but left, reactivate them
    existingParticipant.isActive = true;
    existingParticipant.leftAt = null;
  } else {
    // Add new participant
    this.participants.push({
      user: userId,
      role: "participant",
      joinedAt: new Date(),
      isActive: true,
    });
  }

  return await this.save();
};

// Method to remove a participant from the call
groupCallSchema.methods.removeParticipant = async function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId && p.isActive
  );

  if (participant) {
    participant.isActive = false;
    participant.leftAt = new Date();
  }

  return await this.save();
};

// Method to get active participants
groupCallSchema.methods.getActiveParticipants = function () {
  return this.participants.filter((p) => p.isActive);
};

// Method to check if user is in the call
groupCallSchema.methods.isUserInCall = function (userId) {
  return this.participants.some(
    (p) => p.user.toString() === userId && p.isActive
  );
};

// Method to check if user is the host
groupCallSchema.methods.isUserHost = function (userId) {
  return this.participants.some(
    (p) => p.user.toString() === userId && p.role === "host" && p.isActive
  );
};

// Method to update participant status
groupCallSchema.methods.updateParticipantStatus = async function (
  userId,
  updates
) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId && p.isActive
  );

  if (participant) {
    Object.assign(participant, updates);
    return await this.save();
  }

  throw new Error("Participant not found or not active");
};

// Method to end the call
groupCallSchema.methods.endCall = async function () {
  this.status = "ended";
  this.endTime = new Date();
  this.duration = this.calculatedDuration;

  // Mark all participants as inactive
  this.participants.forEach((participant) => {
    if (participant.isActive) {
      participant.isActive = false;
      participant.leftAt = new Date();
    }
  });

  return await this.save();
};

module.exports = mongoose.model("GroupCall", groupCallSchema);
