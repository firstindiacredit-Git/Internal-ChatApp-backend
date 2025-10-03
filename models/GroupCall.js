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
      required: true,
      unique: true,
    },
    participants: [
      {
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
        isMuted: {
          type: Boolean,
          default: false,
        },
        isVideoEnabled: {
          type: Boolean,
          default: true,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        role: {
          type: String,
          enum: ["host", "participant"],
          default: "participant",
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
    // Maximum participants allowed
    maxParticipants: {
      type: Number,
      default: 10,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
groupCallSchema.index({ group: 1, startTime: -1 });
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

// Method to add a participant
groupCallSchema.methods.addParticipant = function (
  userId,
  role = "participant"
) {
  const existingParticipant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (existingParticipant) {
    // Rejoin if already exists
    existingParticipant.isActive = true;
    existingParticipant.joinedAt = new Date();
    existingParticipant.leftAt = null;
  } else {
    // Add new participant
    this.participants.push({
      user: userId,
      role: role,
      joinedAt: new Date(),
      isActive: true,
    });
  }

  return this.save();
};

// Method to remove a participant
groupCallSchema.methods.removeParticipant = function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (participant) {
    participant.isActive = false;
    participant.leftAt = new Date();
  }

  return this.save();
};

// Method to update participant status
groupCallSchema.methods.updateParticipantStatus = function (userId, updates) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (participant) {
    Object.assign(participant, updates);
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
    if (!participant.leftAt) {
      participant.leftAt = new Date();
    }
  });

  return this.save();
};

// Method to get active participants
groupCallSchema.methods.getActiveParticipants = function () {
  return this.participants.filter((p) => p.isActive);
};

// Method to check if user is in the call
groupCallSchema.methods.isUserInCall = function (userId) {
  return this.participants.some(
    (p) => p.user.toString() === userId.toString() && p.isActive
  );
};

// Method to check if user is the host
groupCallSchema.methods.isUserHost = function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );
  return participant && participant.role === "host";
};

// Static method to create a new group call
groupCallSchema.statics.createGroupCall = async function (
  groupId,
  initiatorId,
  callType = "voice"
) {
  // Generate unique room name
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.random().toString(36).substr(2, 6);
  const roomName = `group-call-${groupId}-${timestamp}-${random}`;

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

module.exports = mongoose.model("GroupCall", groupCallSchema);
