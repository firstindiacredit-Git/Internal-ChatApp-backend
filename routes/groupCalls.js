const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const GroupCall = require("../models/GroupCall");
const Group = require("../models/Group");
const User = require("../models/User");

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
};

// Initiate a new group call
router.post("/initiate", authenticateToken, async (req, res) => {
  try {
    const { groupId, callType = "voice" } = req.body;
    const initiatorId = req.user.userId;

    console.log("Group call initiate request:", {
      groupId,
      callType,
      initiatorId,
    });

    // Validate required fields
    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: "Group ID is required",
      });
    }

    // Validate group exists and user is a member
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    // Check if user is a member of the group
    const isMember = group.members.some(
      (member) => member.user.toString() === initiatorId
    );
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    // Check if there's already an active call for this group
    const existingCall = await GroupCall.findOne({
      group: groupId,
      status: { $in: ["initiated", "active"] },
    });

    if (existingCall) {
      console.log("Existing call found:", existingCall._id);
      return res.status(400).json({
        success: false,
        message: "There is already an active call for this group",
        data: {
          call: {
            _id: existingCall._id,
            callType: existingCall.callType,
            status: existingCall.status,
            roomName: existingCall.roomName,
            participants: existingCall.participants.length,
          },
        },
      });
    }

    // Create new group call
    const groupCall = await GroupCall.createGroupCall(
      groupId,
      initiatorId,
      callType
    );

    console.log("Group call created:", groupCall._id);

    // Populate the call with user details
    await groupCall.populate("initiator", "name avatar email");
    await groupCall.populate("participants.user", "name avatar email");
    await groupCall.populate("group", "name");

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          callType: groupCall.callType,
          status: groupCall.status,
          roomName: groupCall.roomName,
          startTime: groupCall.startTime,
          group: groupCall.group,
          initiator: groupCall.initiator,
          participants: groupCall.participants,
          maxParticipants: groupCall.maxParticipants,
        },
      },
    });
  } catch (error) {
    console.error("Error initiating group call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate group call",
    });
  }
});

// Join an existing group call
router.post("/:callId/join", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId)
      .populate("group", "name members")
      .populate("participants.user", "name avatar email");

    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    // Check if call is still active
    if (groupCall.status !== "initiated" && groupCall.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Call is no longer active",
      });
    }

    // Check if user is a member of the group
    const isMember = groupCall.group.members.some(
      (member) => member.user.toString() === userId
    );
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    // Check if call is full
    const activeParticipants = groupCall.getActiveParticipants();
    if (activeParticipants.length >= groupCall.maxParticipants) {
      return res.status(400).json({
        success: false,
        message: "Call is full",
      });
    }

    // Add participant to call
    await groupCall.addParticipant(userId);

    // Update call status to active if it was just initiated
    if (groupCall.status === "initiated") {
      groupCall.status = "active";
      await groupCall.save();
    }

    // Populate with latest data
    await groupCall.populate("participants.user", "name avatar email");

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          callType: groupCall.callType,
          status: groupCall.status,
          roomName: groupCall.roomName,
          participants: groupCall.participants,
          activeParticipantsCount: groupCall.activeParticipantsCount,
        },
      },
    });
  } catch (error) {
    console.error("Error joining group call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to join group call",
    });
  }
});

// Leave a group call
router.post("/:callId/leave", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    // Check if user is in the call
    if (!groupCall.isUserInCall(userId)) {
      return res.status(400).json({
        success: false,
        message: "You are not in this call",
      });
    }

    // Remove participant from call
    await groupCall.removeParticipant(userId);

    // Check if call should end (no active participants left)
    const activeParticipants = groupCall.getActiveParticipants();
    if (activeParticipants.length === 0) {
      await groupCall.endCall();
    }

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          status: groupCall.status,
          activeParticipantsCount: groupCall.activeParticipantsCount,
        },
      },
    });
  } catch (error) {
    console.error("Error leaving group call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to leave group call",
    });
  }
});

// End a group call (host only)
router.post("/:callId/end", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    // Check if user is the host
    if (!groupCall.isUserHost(userId)) {
      return res.status(403).json({
        success: false,
        message: "Only the call host can end the call",
      });
    }

    // End the call
    await groupCall.endCall();

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          status: groupCall.status,
          endTime: groupCall.endTime,
          duration: groupCall.duration,
        },
      },
    });
  } catch (error) {
    console.error("Error ending group call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to end group call",
    });
  }
});

// Update participant status (mute, video, etc.)
router.put(
  "/:callId/participant/:userId/status",
  authenticateToken,
  async (req, res) => {
    try {
      const { callId, userId } = req.params;
      const { isMuted, isVideoEnabled } = req.body;
      const currentUserId = req.user.userId;

      const groupCall = await GroupCall.findById(callId);
      if (!groupCall) {
        return res.status(404).json({
          success: false,
          message: "Group call not found",
        });
      }

      console.log(`🔍 Update participant status request:`, {
        callId,
        userId,
        currentUserId,
        isMuted,
        isVideoEnabled,
      });

      // Check if current user is in the call
      const isUserInCall = groupCall.isUserInCall(currentUserId);
      console.log(`👤 User ${currentUserId} is in call:`, isUserInCall);

      if (!isUserInCall) {
        return res.status(403).json({
          success: false,
          message: "You are not in this call",
        });
      }

      // Users can only update their own status, or host can update anyone's
      const isUserHost = groupCall.isUserHost(currentUserId);
      const isUpdatingSelf = currentUserId === userId;
      console.log(`👑 User ${currentUserId} is host:`, isUserHost);
      console.log(`🔄 User updating self:`, isUpdatingSelf);

      if (!isUpdatingSelf && !isUserHost) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own status",
        });
      }

      // Update participant status
      const updates = {};
      if (typeof isMuted === "boolean") updates.isMuted = isMuted;
      if (typeof isVideoEnabled === "boolean")
        updates.isVideoEnabled = isVideoEnabled;

      await groupCall.updateParticipantStatus(userId, updates);

      res.json({
        success: true,
        data: {
          call: {
            _id: groupCall._id,
            participants: groupCall.participants,
          },
        },
      });
    } catch (error) {
      console.error("Error updating participant status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update participant status",
      });
    }
  }
);

// Remove participant from group call (host only)
router.delete(
  "/:callId/participant/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const { callId, userId } = req.params;
      const currentUserId = req.user.userId;

      const groupCall = await GroupCall.findById(callId);
      if (!groupCall) {
        return res.status(404).json({
          success: false,
          message: "Group call not found",
        });
      }

      // Check if current user is the host
      if (!groupCall.isUserHost(currentUserId)) {
        return res.status(403).json({
          success: false,
          message: "Only the call host can remove participants",
        });
      }

      // Check if target user is in the call
      if (!groupCall.isUserInCall(userId)) {
        return res.status(400).json({
          success: false,
          message: "User is not in this call",
        });
      }

      // Remove participant from call
      await groupCall.removeParticipant(userId);

      res.json({
        success: true,
        data: {
          call: {
            _id: groupCall._id,
            activeParticipantsCount: groupCall.activeParticipantsCount,
          },
        },
      });
    } catch (error) {
      console.error("Error removing participant:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove participant",
      });
    }
  }
);

// Get group call details
router.get("/:callId", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    console.log(
      `🔍 Fetching group call details for callId: ${callId}, userId: ${userId}`
    );

    let groupCall;
    try {
      console.log(`🔍 Attempting to find group call with ID: ${callId}`);

      // First try to find the group call without population
      const basicGroupCall = await GroupCall.findById(callId);
      console.log(`🔍 Basic group call found:`, basicGroupCall ? "Yes" : "No");

      if (!basicGroupCall) {
        return res.status(404).json({
          success: false,
          message: "Group call not found",
        });
      }

      console.log(`🔍 Group call data:`, {
        id: basicGroupCall._id,
        group: basicGroupCall.group,
        initiator: basicGroupCall.initiator,
        participantsCount: basicGroupCall.participants.length,
      });

      // Now try with population
      groupCall = await GroupCall.findById(callId)
        .populate("group", "name members")
        .populate("initiator", "name avatar email")
        .populate("participants.user", "name avatar email");

      console.log(
        `🔍 Group call with population found:`,
        groupCall ? "Yes" : "No"
      );
    } catch (populateError) {
      console.error("Population error:", populateError);
      console.error("Population error details:", {
        message: populateError.message,
        stack: populateError.stack,
        callId: callId,
        name: populateError.name,
        code: populateError.code,
      });

      // Fallback: try to get basic group call data without population
      try {
        console.log("🔄 Attempting fallback without population");
        const fallbackGroupCall = await GroupCall.findById(callId);

        if (!fallbackGroupCall) {
          return res.status(404).json({
            success: false,
            message: "Group call not found",
          });
        }

        // Return basic data without population
        return res.json({
          success: true,
          data: {
            call: {
              _id: fallbackGroupCall._id,
              callType: fallbackGroupCall.callType,
              status: fallbackGroupCall.status,
              roomName: fallbackGroupCall.roomName,
              startTime: fallbackGroupCall.startTime,
              endTime: fallbackGroupCall.endTime,
              duration: fallbackGroupCall.duration,
              group: fallbackGroupCall.group,
              initiator: fallbackGroupCall.initiator,
              participants: fallbackGroupCall.participants,
              activeParticipantsCount:
                fallbackGroupCall.activeParticipantsCount,
              maxParticipants: fallbackGroupCall.maxParticipants,
              quality: fallbackGroupCall.quality,
              notes: fallbackGroupCall.notes,
              isRecorded: fallbackGroupCall.isRecorded,
              recordingUrl: fallbackGroupCall.recordingUrl,
            },
          },
        });
      } catch (fallbackError) {
        console.error("Fallback error:", fallbackError);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch group call details",
          error: populateError.message,
          details: {
            name: populateError.name,
            code: populateError.code,
          },
        });
      }
    }

    console.log(`📞 Group call found:`, groupCall ? "Yes" : "No");

    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    // Check if user is a member of the group
    console.log(`👥 Group members:`, groupCall.group.members?.length || 0);
    const isMember = groupCall.group.members.some(
      (member) => member.user.toString() === userId
    );
    console.log(`✅ User is member:`, isMember);

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          callType: groupCall.callType,
          status: groupCall.status,
          roomName: groupCall.roomName,
          startTime: groupCall.startTime,
          endTime: groupCall.endTime,
          duration: groupCall.duration,
          group: groupCall.group,
          initiator: groupCall.initiator,
          participants: groupCall.participants,
          activeParticipantsCount: groupCall.activeParticipantsCount,
          maxParticipants: groupCall.maxParticipants,
          quality: groupCall.quality,
          notes: groupCall.notes,
          isRecorded: groupCall.isRecorded,
          recordingUrl: groupCall.recordingUrl,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching group call details:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to fetch group call details",
      error: error.message,
    });
  }
});

// Get active group calls for a group
router.get("/group/:groupId/active", authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    console.log("Getting active calls for group:", groupId, "user:", userId);

    // Validate group exists and user is a member
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    const isMember = group.members.some(
      (member) => member.user.toString() === userId
    );
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    // Find active calls for this group
    const activeCalls = await GroupCall.find({
      group: groupId,
      status: { $in: ["initiated", "active"] },
    })
      .populate("initiator", "name avatar email")
      .populate("participants.user", "name avatar email")
      .sort({ startTime: -1 });

    console.log("Found active calls:", activeCalls.length);

    res.json({
      success: true,
      data: {
        calls: activeCalls.map((call) => ({
          _id: call._id,
          callType: call.callType,
          status: call.status,
          roomName: call.roomName,
          startTime: call.startTime,
          initiator: call.initiator,
          participants: call.participants,
          activeParticipantsCount: call.activeParticipantsCount,
          maxParticipants: call.maxParticipants,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching active group calls:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active group calls",
    });
  }
});

// Get group call history for a group
router.get("/group/:groupId/history", authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;

    // Validate group exists and user is a member
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    const isMember = group.members.some(
      (member) => member.user.toString() === userId
    );
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group",
      });
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Find ended calls for this group
    const calls = await GroupCall.find({
      group: groupId,
      status: "ended",
    })
      .populate("initiator", "name avatar email")
      .populate("participants.user", "name avatar email")
      .sort({ endTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCalls = await GroupCall.countDocuments({
      group: groupId,
      status: "ended",
    });

    res.json({
      success: true,
      data: {
        calls: calls.map((call) => ({
          _id: call._id,
          callType: call.callType,
          status: call.status,
          startTime: call.startTime,
          endTime: call.endTime,
          duration: call.duration,
          initiator: call.initiator,
          participants: call.participants,
          quality: call.quality,
          notes: call.notes,
          isRecorded: call.isRecorded,
          recordingUrl: call.recordingUrl,
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCalls / limit),
          totalCalls,
          hasNext: skip + calls.length < totalCalls,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching group call history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch group call history",
    });
  }
});

// Test route to verify the group calls API is working
router.get("/test", authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: "Group calls API is working",
    user: req.user.userId,
  });
});

// Debug route to end all active calls (for testing)
router.post("/debug/end-all-active", authenticateToken, async (req, res) => {
  try {
    const activeCalls = await GroupCall.find({
      status: { $in: ["initiated", "active"] },
    });

    console.log("Found active calls to end:", activeCalls.length);

    for (const call of activeCalls) {
      await call.endCall();
      console.log("Ended call:", call._id);
    }

    res.json({
      success: true,
      message: `Ended ${activeCalls.length} active calls`,
      data: {
        endedCalls: activeCalls.map((call) => ({
          _id: call._id,
          group: call.group,
          status: call.status,
        })),
      },
    });
  } catch (error) {
    console.error("Error ending active calls:", error);
    res.status(500).json({
      success: false,
      message: "Failed to end active calls",
    });
  }
});

module.exports = router;
