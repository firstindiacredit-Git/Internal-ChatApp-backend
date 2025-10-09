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

// Get group call history for a group
router.get("/group/:groupId/history", authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20, callType, status } = req.query;

    // Verify user is member of the group
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    const isMember = group.members.some(
      (member) => member.user.toString() === req.user.userId
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view group call history",
      });
    }

    // Build query
    const query = { group: groupId };

    if (callType) {
      query.callType = callType;
    }

    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch group calls with pagination
    const groupCalls = await GroupCall.find(query)
      .populate("group", "name avatar")
      .populate("initiator", "name avatar email")
      .populate("participants.user", "name avatar email")
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCalls = await GroupCall.countDocuments(query);

    // Transform calls to include user info
    const transformedCalls = groupCalls.map((call) => {
      const isInitiator = call.initiator._id.toString() === req.user.userId;
      const activeParticipants = call.getActiveParticipants();

      return {
        _id: call._id,
        callType: call.callType,
        status: call.status,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration || call.calculatedDuration,
        isInitiator: isInitiator,
        group: {
          _id: call.group._id,
          name: call.group.name,
          avatar: call.group.avatar,
        },
        initiator: {
          _id: call.initiator._id,
          name: call.initiator.name,
          avatar: call.initiator.avatar,
          email: call.initiator.email,
        },
        participants: call.participants.map((participant) => ({
          _id: participant.user._id,
          name: participant.user.name,
          avatar: participant.user.avatar,
          email: participant.user.email,
          joinedAt: participant.joinedAt,
          isActive: participant.isActive,
          isMuted: participant.isMuted,
          isVideoEnabled: participant.isVideoEnabled,
        })),
        activeParticipantsCount: activeParticipants.length,
        quality: call.quality,
        notes: call.notes,
        isRecorded: call.isRecorded,
        recordingUrl: call.recordingUrl,
      };
    });

    res.json({
      success: true,
      data: {
        calls: transformedCalls,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCalls / limit),
          totalCalls,
          hasNext: skip + groupCalls.length < totalCalls,
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

// Test route for debugging
router.get("/test", (req, res) => {
  res.json({ success: true, message: "Group calls API is working" });
});

// Initiate a new group call
router.post("/initiate", authenticateToken, async (req, res) => {
  try {
    console.log("📞 Group call initiate request:", req.body);
    const { groupId, callType = "voice" } = req.body;
    const initiatorId = req.user.userId;
    console.log(
      "📞 Initiator ID:",
      initiatorId,
      "Group ID:",
      groupId,
      "Call Type:",
      callType
    );

    // Validate group exists and user is member
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    const isMember = group.members.some(
      (member) => member.user.toString() === initiatorId
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to initiate calls in this group",
      });
    }

    // Create new group call record
    console.log("📞 Creating GroupCall instance...");

    // Generate unique room name
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substr(2, 6);
    const roomName = `group-call-${timestamp}-${random}`;

    console.log("🎥 ========================================");
    console.log("🎥 CREATING GROUP CALL");
    console.log("🎥 Room Name:", roomName);
    console.log("🎥 Group ID:", groupId);
    console.log("🎥 Initiator ID:", initiatorId);
    console.log("🎥 Call Type:", callType);
    console.log("🎥 ========================================");

    const groupCall = new GroupCall({
      group: groupId,
      initiator: initiatorId,
      callType,
      status: "initiated",
      roomName: roomName,
    });
    console.log("📞 GroupCall created with ID:", groupCall._id);

    // Add initiator as first participant
    console.log("📞 Adding initiator as participant...");
    groupCall.participants.push({
      user: initiatorId,
      joinedAt: new Date(),
      isActive: true,
      isMuted: false,
      isVideoEnabled: callType === "video",
    });
    console.log(
      "📞 Participants after adding initiator:",
      groupCall.participants
    );

    console.log("📞 Saving group call to database...");
    await groupCall.save();
    console.log("📞 Group call saved successfully:", groupCall._id);

    // Populate the call with user details
    await groupCall.populate("group", "name avatar");
    await groupCall.populate("initiator", "name avatar email");
    await groupCall.populate("participants.user", "name avatar email");

    const responseData = {
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          callType: groupCall.callType,
          status: groupCall.status,
          startTime: groupCall.startTime,
          roomName: groupCall.roomName, // ✅ IMPORTANT: Include roomName!
          isInitiator: true,
          group: {
            _id: groupCall.group._id,
            name: groupCall.group.name,
            avatar: groupCall.group.avatar,
          },
          initiator: {
            _id: groupCall.initiator._id,
            name: groupCall.initiator.name,
            avatar: groupCall.initiator.avatar,
            email: groupCall.initiator.email,
          },
          participants: groupCall.participants.map((participant) => ({
            _id: participant.user._id,
            name: participant.user.name,
            avatar: participant.user.avatar,
            email: participant.user.email,
            joinedAt: participant.joinedAt,
            isActive: participant.isActive,
            isMuted: participant.isMuted,
            isVideoEnabled: participant.isVideoEnabled,
          })),
        },
      },
    };

    console.log("✅ ========================================");
    console.log("✅ SENDING CALL DATA TO FRONTEND");
    console.log("✅ Room Name:", responseData.data.call.roomName);
    console.log("✅ Call ID:", responseData.data.call._id);
    console.log("✅ ========================================");

    res.json(responseData);
  } catch (error) {
    console.error("❌ Error initiating group call:", error);
    console.error("❌ Error stack:", error.stack);
    console.error("❌ Error message:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to initiate group call",
      error: error.message,
    });
  }
});

// Join a group call
router.post("/:callId/join", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    console.log("📞 ========================================");
    console.log("📞 JOIN GROUP CALL REQUEST");
    console.log("📞 Call ID:", callId);
    console.log("📞 User ID:", userId);
    console.log("📞 ========================================");

    const groupCall = await GroupCall.findById(callId)
      .populate("group", "name avatar")
      .populate("initiator", "name avatar email")
      .populate("participants.user", "name avatar email");

    if (!groupCall) {
      console.error("❌ Group call not found:", callId);
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    console.log("✅ Group call found:", groupCall._id);
    console.log("📊 Current status:", groupCall.status);
    console.log("👥 Current participants:", groupCall.participants.length);

    // Verify user is member of the group
    const group = await Group.findById(groupCall.group._id);
    if (!group) {
      console.error("❌ Group not found:", groupCall.group._id);
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    const isMember = group.members.some(
      (member) => member.user.toString() === userId
    );

    if (!isMember) {
      console.error("❌ User not a member:", userId);
      return res.status(403).json({
        success: false,
        message: "Not authorized to join this group call",
      });
    }

    console.log("✅ User is group member");

    // Check if call is still active
    if (groupCall.status !== "initiated" && groupCall.status !== "active") {
      console.error("❌ Call not active:", groupCall.status);
      return res.status(400).json({
        success: false,
        message: "Group call is no longer active",
      });
    }

    // Add participant to the call
    const existingParticipant = groupCall.participants.find(
      (p) => p.user && p.user.toString() === userId
    );

    if (!existingParticipant) {
      console.log("➕ Adding new participant:", userId);
      groupCall.participants.push({
        user: userId,
        joinedAt: new Date(),
        isActive: true,
        isMuted: false,
        isVideoEnabled: groupCall.callType === "video",
      });
    } else {
      console.log("♻️ Reactivating existing participant:", userId);
      existingParticipant.isActive = true;
      existingParticipant.joinedAt = new Date();
    }

    // Update call status to active if it was just initiated
    if (groupCall.status === "initiated") {
      console.log("📊 Updating status: initiated → active");
      groupCall.status = "active";
    }

    // Save changes
    console.log("💾 Saving group call...");
    await groupCall.save();
    console.log("✅ Group call saved successfully");

    // Re-populate after adding participant
    console.log("🔄 Re-populating participants...");
    try {
      await groupCall.populate("participants.user", "name avatar email");
      console.log("✅ Participants populated:", groupCall.participants.length);
    } catch (populateError) {
      console.error("⚠️ Populate warning:", populateError.message);
      // Continue even if populate fails
    }

    console.log("📦 Building response data...");
    
    const responseData = {
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          callType: groupCall.callType,
          status: groupCall.status,
          startTime: groupCall.startTime,
          roomName: groupCall.roomName, // Include roomName
          group: {
            _id: groupCall.group._id,
            name: groupCall.group.name,
            avatar: groupCall.group.avatar,
          },
          initiator: {
            _id: groupCall.initiator._id,
            name: groupCall.initiator.name,
            avatar: groupCall.initiator.avatar,
            email: groupCall.initiator.email,
          },
          participants: groupCall.participants
            .filter(p => p.user && p.user._id) // Only include valid participants
            .map((participant) => {
              try {
                return {
                  _id: participant.user._id,
                  name: participant.user.name || 'Unknown',
                  avatar: participant.user.avatar || '',
                  email: participant.user.email || '',
                  joinedAt: participant.joinedAt,
                  isActive: participant.isActive,
                  isMuted: participant.isMuted,
                  isVideoEnabled: participant.isVideoEnabled,
                };
              } catch (mapError) {
                console.error("⚠️ Error mapping participant:", mapError);
                return null;
              }
            })
            .filter(p => p !== null), // Remove failed mappings
        },
      },
    };

    console.log("✅ ========================================");
    console.log("✅ JOIN SUCCESSFUL");
    console.log("✅ Participant count:", groupCall.participants.length);
    console.log("✅ Valid participants:", responseData.data.call.participants.length);
    console.log("✅ Room Name:", groupCall.roomName);
    console.log("✅ ========================================");

    res.json(responseData);
  } catch (error) {
    console.error("❌ ========================================");
    console.error("❌ ERROR JOINING GROUP CALL");
    console.error("❌ Error:", error);
    console.error("❌ Error message:", error.message);
    console.error("❌ Error stack:", error.stack);
    console.error("❌ ========================================");

    res.status(500).json({
      success: false,
      message: "Failed to join group call",
      error: error.message,
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

    // Check if user is the initiator
    const isInitiator = groupCall.initiator.toString() === userId;

    if (isInitiator) {
      // If initiator leaves, end the call for everyone
      await groupCall.endCall();
    } else {
      // Regular participant leaving
      await groupCall.removeParticipant(userId);
    }

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          status: groupCall.status,
          endTime: groupCall.endTime,
          duration: groupCall.duration,
        },
        ended: isInitiator,
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

// End a group call
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

    // Check if user is the initiator or admin
    const isInitiator = groupCall.initiator.toString() === userId;

    // Check if user is group admin
    const group = await Group.findById(groupCall.group);
    const isAdmin = group.members.some(
      (member) => member.user.toString() === userId && member.role === "admin"
    );

    if (!isInitiator && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to end this group call",
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

// Get group call details
router.get("/:callId", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId)
      .populate("group", "name avatar")
      .populate("initiator", "name avatar email")
      .populate("participants.user", "name avatar email");

    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    // Verify user is member of the group
    const group = await Group.findById(groupCall.group._id);
    const isMember = group.members.some(
      (member) => member.user.toString() === userId
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this group call",
      });
    }

    const isInitiator = groupCall.initiator._id.toString() === userId;
    const activeParticipants = groupCall.getActiveParticipants();

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          callType: groupCall.callType,
          status: groupCall.status,
          startTime: groupCall.startTime,
          endTime: groupCall.endTime,
          duration: groupCall.duration || groupCall.calculatedDuration,
          isInitiator: isInitiator,
          group: {
            _id: groupCall.group._id,
            name: groupCall.group.name,
            avatar: groupCall.group.avatar,
          },
          initiator: {
            _id: groupCall.initiator._id,
            name: groupCall.initiator.name,
            avatar: groupCall.initiator.avatar,
            email: groupCall.initiator.email,
          },
          participants: groupCall.participants.map((participant) => ({
            _id: participant.user._id,
            name: participant.user.name,
            avatar: participant.user.avatar,
            email: participant.user.email,
            joinedAt: participant.joinedAt,
            isActive: participant.isActive,
            isMuted: participant.isMuted,
            isVideoEnabled: participant.isVideoEnabled,
          })),
          activeParticipantsCount: activeParticipants.length,
          quality: groupCall.quality,
          notes: groupCall.notes,
          isRecorded: groupCall.isRecorded,
          recordingUrl: groupCall.recordingUrl,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching group call details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch group call details",
    });
  }
});

// Toggle participant mute
router.put("/:callId/mute", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { isMuted } = req.body;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    await groupCall.toggleParticipantMute(userId, isMuted);

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          participant: {
            userId: userId,
            isMuted: isMuted,
          },
        },
      },
    });
  } catch (error) {
    console.error("Error toggling mute:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle mute",
    });
  }
});

// Toggle participant video
router.put("/:callId/video", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { isVideoEnabled } = req.body;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    await groupCall.toggleParticipantVideo(userId, isVideoEnabled);

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          participant: {
            userId: userId,
            isVideoEnabled: isVideoEnabled,
          },
        },
      },
    });
  } catch (error) {
    console.error("Error toggling video:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle video",
    });
  }
});

// Update group call notes
router.put("/:callId/notes", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { notes } = req.body;
    const userId = req.user.userId;

    const groupCall = await GroupCall.findById(callId);
    if (!groupCall) {
      return res.status(404).json({
        success: false,
        message: "Group call not found",
      });
    }

    // Check if user is the initiator or admin
    const isInitiator = groupCall.initiator.toString() === userId;

    const group = await Group.findById(groupCall.group);
    const isAdmin = group.members.some(
      (member) => member.user.toString() === userId && member.role === "admin"
    );

    if (!isInitiator && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this group call",
      });
    }

    groupCall.notes = notes || "";
    await groupCall.save();

    res.json({
      success: true,
      data: {
        call: {
          _id: groupCall._id,
          notes: groupCall.notes,
        },
      },
    });
  } catch (error) {
    console.error("Error updating group call notes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update group call notes",
    });
  }
});

// Delete group call history
router.delete("/:callId", authenticateToken, async (req, res) => {
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

    // Check if user is the initiator or admin
    const isInitiator = groupCall.initiator.toString() === userId;

    const group = await Group.findById(groupCall.group);
    const isAdmin = group.members.some(
      (member) => member.user.toString() === userId && member.role === "admin"
    );

    if (!isInitiator && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this group call",
      });
    }

    await GroupCall.findByIdAndDelete(callId);

    res.json({
      success: true,
      message: "Group call deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting group call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete group call",
    });
  }
});

module.exports = router;
