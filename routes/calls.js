const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Call = require("../models/Call");
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

// Get call history for a user
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, callType, status } = req.query;

    // Build query
    const query = {
      $or: [{ caller: userId }, { receiver: userId }],
    };

    if (callType) {
      query.callType = callType;
    }

    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch calls with pagination
    const calls = await Call.find(query)
      .populate("caller", "name avatar email phone")
      .populate("receiver", "name avatar email phone")
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCalls = await Call.countDocuments(query);

    // Transform calls to include user info
    const transformedCalls = calls.map((call) => {
      const isCaller = call.caller._id.toString() === userId;
      const otherUser = isCaller ? call.receiver : call.caller;

      return {
        _id: call._id,
        callType: call.callType,
        status: call.status,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration || call.calculatedDuration,
        isCaller: isCaller,
        otherUser: {
          _id: otherUser._id,
          name: otherUser.name,
          avatar: otherUser.avatar,
          email: otherUser.email,
          phone: otherUser.phone,
        },
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
          hasNext: skip + calls.length < totalCalls,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching call history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch call history",
    });
  }
});

// Initiate a new call
router.post("/initiate", authenticateToken, async (req, res) => {
  try {
    const { receiverId, callType = "voice", offer } = req.body;
    const callerId = req.user.userId;

    // Validate receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "Receiver not found",
      });
    }

    // Check if user is trying to call themselves
    if (callerId === receiverId) {
      return res.status(400).json({
        success: false,
        message: "Cannot call yourself",
      });
    }

    // Create new call record (roomName required by model)
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substr(2, 6);
    const roomName = `call-${timestamp}-${random}`;

    const call = new Call({
      caller: callerId,
      receiver: receiverId,
      callType,
      status: "initiated",
      offer: offer || null,
      roomName,
    });

    await call.save();

    // Populate the call with user details
    await call.populate("caller", "name avatar email phone");
    await call.populate("receiver", "name avatar email phone");

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          callType: call.callType,
          status: call.status,
          startTime: call.startTime,
          isCaller: true,
          otherUser: {
            _id: call.receiver._id,
            name: call.receiver.name,
            avatar: call.receiver.avatar,
            email: call.receiver.email,
            phone: call.receiver.phone,
          },
        },
      },
    });
  } catch (error) {
    console.error("Error initiating call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate call",
    });
  }
});

// Answer a call
router.put("/:callId/answer", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { answer } = req.body;
    const userId = req.user.userId;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is the receiver
    if (call.receiver.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to answer this call",
      });
    }

    // Check if call is still active
    if (call.status !== "initiated" && call.status !== "ringing") {
      return res.status(400).json({
        success: false,
        message: "Call is no longer active",
      });
    }

    // Update call status and answer
    call.status = "answered";
    if (answer) {
      call.answer = answer;
    }

    await call.save();

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          status: call.status,
          answer: call.answer,
        },
      },
    });
  } catch (error) {
    console.error("Error answering call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to answer call",
    });
  }
});

// Decline a call
router.put("/:callId/decline", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is the receiver
    if (call.receiver.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to decline this call",
      });
    }

    // Update call status
    await call.markAsDeclined();

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          status: call.status,
        },
      },
    });
  } catch (error) {
    console.error("Error declining call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to decline call",
    });
  }
});

// End a call
router.put("/:callId/end", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is either caller or receiver
    if (
      call.caller.toString() !== userId &&
      call.receiver.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to end this call",
      });
    }

    // End the call
    await call.endCall();

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          status: call.status,
          endTime: call.endTime,
          duration: call.duration,
        },
      },
    });
  } catch (error) {
    console.error("Error ending call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to end call",
    });
  }
});

// Add ICE candidate
router.post("/:callId/ice-candidate", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { candidate, sdpMLineIndex, sdpMid } = req.body;
    const userId = req.user.userId;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is either caller or receiver
    if (
      call.caller.toString() !== userId &&
      call.receiver.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to add ICE candidate",
      });
    }

    // Add ICE candidate
    call.iceCandidates.push({
      candidate,
      sdpMLineIndex,
      sdpMid,
    });

    await call.save();

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          iceCandidates: call.iceCandidates,
        },
      },
    });
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add ICE candidate",
    });
  }
});

// Get call details
router.get("/:callId", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findById(callId)
      .populate("caller", "name avatar email phone")
      .populate("receiver", "name avatar email phone");

    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is either caller or receiver
    if (
      call.caller._id.toString() !== userId &&
      call.receiver._id.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this call",
      });
    }

    const isCaller = call.caller._id.toString() === userId;
    const otherUser = isCaller ? call.receiver : call.caller;

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          callType: call.callType,
          status: call.status,
          startTime: call.startTime,
          endTime: call.endTime,
          duration: call.duration || call.calculatedDuration,
          isCaller: isCaller,
          otherUser: {
            _id: otherUser._id,
            name: otherUser.name,
            avatar: otherUser.avatar,
            email: otherUser.email,
            phone: otherUser.phone,
          },
          offer: call.offer,
          answer: call.answer,
          iceCandidates: call.iceCandidates,
          quality: call.quality,
          notes: call.notes,
          isRecorded: call.isRecorded,
          recordingUrl: call.recordingUrl,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching call details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch call details",
    });
  }
});

// Update call notes
router.put("/:callId/notes", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { notes } = req.body;
    const userId = req.user.userId;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is either caller or receiver
    if (
      call.caller.toString() !== userId &&
      call.receiver.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this call",
      });
    }

    call.notes = notes || "";
    await call.save();

    res.json({
      success: true,
      data: {
        call: {
          _id: call._id,
          notes: call.notes,
        },
      },
    });
  } catch (error) {
    console.error("Error updating call notes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update call notes",
    });
  }
});

// Delete call history
router.delete("/:callId", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.userId;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Check if user is either caller or receiver
    if (
      call.caller.toString() !== userId &&
      call.receiver.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this call",
      });
    }

    await Call.findByIdAndDelete(callId);

    res.json({
      success: true,
      message: "Call deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete call",
    });
  }
});

module.exports = router;
