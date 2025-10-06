const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config({ path: "./config.env" });
const path = require("path");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Call = require("./models/Call");
const GroupCall = require("./models/GroupCall");

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Make io available to routes via req.app.get('io')
app.set("io", io);

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files for profile images
app.use("/uploads", express.static("uploads"));

// Serve static files from frontend build
app.use(express.static(path.join(__dirname, "dist")));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/groups", require("./routes/groups"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/calls", require("./routes/calls"));
app.use("/api/group-calls", require("./routes/groupCalls"));

// Authenticate socket connections with JWT and track active users
const activeUsers = new Map();
// Dedup keys for noisy group-call logs (offer)
const seenGroupOfferLogs = new Set();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return next(new Error("Authentication error: User not found"));
    }
    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (err) {
    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", (socket) => {
  console.log(
    `✅ User connected: ${socket.user?.name || socket.userId} - ${socket.id}`
  );

  // Track active users and join personal room
  activeUsers.set(socket.userId, {
    socketId: socket.id,
    user: socket.user,
    lastSeen: new Date(),
  });
  socket.join(socket.userId);

  // Handle personal messages
  socket.on("send-message", async (data) => {
    try {
      console.log("🔄 Backend received send-message:", data);
      const {
        receiver,
        message,
        sender,
        messageType,
        fileUrl,
        fileName,
        fileSize,
        fileType,
      } = data;

      // IMPORTANT: Save message to database first
      const Message = require("./models/Message");
      const messageData = {
        sender: sender,
        receiver: receiver,
        message: message || "",
        messageType: messageType || "text",
      };

      // Add file data if present
      if (fileUrl) {
        messageData.fileUrl = fileUrl;
        messageData.fileName = fileName;
        messageData.fileSize = fileSize;
        messageData.fileType = fileType;
      }

      const newMessage = new Message(messageData);
      await newMessage.save();
      console.log("💾 Message saved to database:", newMessage._id);

      // Populate message data for response
      await newMessage.populate("sender", "name email profileImage");
      await newMessage.populate("receiver", "name email profileImage");

      // Emit to receiver if they're online
      const receiverMessage = {
        id: newMessage._id, // Use actual message ID from database
        sender: newMessage.sender,
        receiver: receiver,
        message: newMessage.message,
        messageType: newMessage.messageType,
        fileUrl: newMessage.fileUrl,
        fileName: newMessage.fileName,
        fileSize: newMessage.fileSize,
        fileType: newMessage.fileType,
        timestamp: newMessage.createdAt,
        createdAt: newMessage.createdAt,
        isFromOtherUser: true,
        _id: newMessage._id,
      };
      console.log(
        "📤 Emitting to receiver:",
        receiver,
        "message:",
        receiverMessage
      );
      socket.to(receiver).emit("receive-message", receiverMessage);

      // Emit back to sender for confirmation
      const confirmationMessage = {
        id: newMessage._id,
        sender: newMessage.sender,
        receiver: receiver,
        message: newMessage.message,
        messageType: newMessage.messageType,
        fileUrl: newMessage.fileUrl,
        fileName: newMessage.fileName,
        fileSize: newMessage.fileSize,
        fileType: newMessage.fileType,
        timestamp: newMessage.createdAt,
        createdAt: newMessage.createdAt,
        isConfirmMessage: true,
        _id: newMessage._id,
      };
      console.log(
        "📤 Emitting confirmation back to sender:",
        confirmationMessage
      );
      socket.emit("message-sent", confirmationMessage);
      console.log("✅ Message saved and handling completed successfully");
    } catch (error) {
      console.error("❌ Error in backend message handling:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // Handle group messages
  socket.on("send-group-message", async (data) => {
    try {
      const {
        groupId,
        message,
        sender,
        messageType,
        fileUrl,
        fileName,
        fileSize,
        fileType,
      } = data;

      // Save group message to database
      const Message = require("./models/Message");
      const Group = require("./models/Group");

      const messageData = {
        sender: sender,
        group: groupId,
        message: message || "",
        messageType: messageType || "text",
      };

      // Add file data if present
      if (fileUrl) {
        messageData.fileUrl = fileUrl;
        messageData.fileName = fileName;
        messageData.fileSize = fileSize;
        messageData.fileType = fileType;
      }

      const newMessage = new Message(messageData);
      await newMessage.save();
      console.log("💾 Group message saved to database:", newMessage._id);

      // Populate message data
      await newMessage.populate("sender", "name email profileImage");
      await newMessage.populate("group", "name");

      // Emit to all members of the group
      socket.to(groupId).emit("receive-group-message", {
        id: newMessage._id,
        groupId,
        sender: newMessage.sender,
        message: newMessage.message,
        messageType: newMessage.messageType,
        fileUrl: newMessage.fileUrl,
        fileName: newMessage.fileName,
        fileSize: newMessage.fileSize,
        fileType: newMessage.fileType,
        timestamp: newMessage.createdAt,
        createdAt: newMessage.createdAt,
        _id: newMessage._id,
      });

      // Emit back to sender for confirmation
      socket.emit("group-message-sent", {
        id: newMessage._id,
        groupId,
        sender: newMessage.sender,
        message: newMessage.message,
        messageType: newMessage.messageType,
        fileUrl: newMessage.fileUrl,
        fileName: newMessage.fileName,
        fileSize: newMessage.fileSize,
        fileType: newMessage.fileType,
        timestamp: newMessage.createdAt,
        createdAt: newMessage.createdAt,
        _id: newMessage._id,
      });
      console.log("✅ Group message saved and handling completed successfully");
    } catch (error) {
      console.error("❌ Error in group message handling:", error);
      socket.emit("error", { message: "Failed to send group message" });
    }
  });

  // Join group room
  socket.on("join-group", (groupId) => {
    socket.join(groupId);
    console.log(`User joined group: ${groupId}`);
  });

  // Leave group room
  socket.on("leave-group", (groupId) => {
    socket.leave(groupId);
    console.log(`User left group: ${groupId}`);
  });

  // Handle typing indicators
  socket.on("typing", (data) => {
    socket.to(data.receiver || data.groupId).emit("user-typing", {
      sender: data.sender,
      isTyping: data.isTyping,
    });
  });

  // ========================
  // Call signaling handlers
  // ========================
  socket.on("call-initiate", async (data) => {
    try {
      const { receiverId, callType = "voice", callId } = data || {};
      console.log(`📞 Call initiate request:`, {
        receiverId,
        callType,
        callId,
        caller: socket.userId,
        callerName: socket.user?.name,
      });

      if (!receiverId) {
        socket.emit("call-error", { error: "Receiver ID is required" });
        return;
      }

      // Notify caller (confirmation)
      socket.emit("call-initiated", {
        callId,
        callType,
        receiver: await User.findById(receiverId).select("name avatar email"),
      });

      // Notify receiver if online - Check both string and object ID formats
      const receiverSocketData =
        activeUsers.get(receiverId) || activeUsers.get(receiverId.toString());

      console.log(`🔍 Looking for receiver ${receiverId}:`, {
        found: !!receiverSocketData,
        activeUsersCount: activeUsers.size,
        activeUserIds: Array.from(activeUsers.keys()),
      });

      if (receiverSocketData) {
        console.log(
          `✅ Receiver ${receiverId} is online, sending incoming-call to socket ${receiverSocketData.socketId}`
        );
        io.to(receiverSocketData.socketId).emit("incoming-call", {
          callId,
          caller: socket.user,
          callType,
        });
        console.log(
          `📤 Incoming call notification sent to receiver ${receiverId}`
        );
      } else {
        console.log(`❌ Receiver ${receiverId} is not online`);
        socket.emit("call-error", {
          error: "Receiver is not online",
          receiverId: receiverId,
        });
      }
    } catch (error) {
      console.error("Call initiate error:", error);
      socket.emit("call-error", { error: "Failed to initiate call" });
    }
  });

  socket.on("call-answer", async (data) => {
    try {
      const { callId, answer } = data || {};
      if (!callId) {
        socket.emit("call-error", { error: "Call ID is required" });
        return;
      }
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("call-error", { error: "Call not found" });
        return;
      }
      if (call.receiver.toString() !== socket.userId) {
        socket.emit("call-error", {
          error: "Not authorized to answer this call",
        });
        return;
      }
      call.status = "answered";
      if (answer) {
        call.answer = JSON.stringify(answer);
      }
      await call.save();
      const callerActive = activeUsers.get(call.caller.toString());
      if (callerActive) {
        io.to(callerActive.socketId).emit("call-answered", {
          callId: call._id,
          status: call.status,
          answer,
          receiver: socket.user,
          callType: call.callType,
        });
      }
    } catch (error) {
      console.error("Call answer error:", error);
      socket.emit("call-error", { error: "Failed to answer call" });
    }
  });

  socket.on("call-decline", async (data) => {
    try {
      const { callId } = data || {};
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("call-error", { error: "Call not found" });
        return;
      }
      if (call.receiver.toString() !== socket.userId) {
        socket.emit("call-error", {
          error: "Not authorized to decline this call",
        });
        return;
      }
      await call.markAsDeclined();
      socket.emit("call-declined", {
        callId: call._id,
        status: call.status,
        callType: call.callType,
      });
      const callerActive = activeUsers.get(call.caller.toString());
      if (callerActive) {
        io.to(callerActive.socketId).emit("call-declined", {
          callId: call._id,
          status: call.status,
          receiver: socket.user,
          callType: call.callType,
        });
      }
    } catch (error) {
      console.error("Call decline error:", error);
      socket.emit("call-error", { error: "Failed to decline call" });
    }
  });

  socket.on("call-end", async (data) => {
    try {
      const { callId } = data || {};
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("call-error", { error: "Call not found" });
        return;
      }
      if (
        call.caller.toString() !== socket.userId &&
        call.receiver.toString() !== socket.userId
      ) {
        socket.emit("call-error", { error: "Not authorized to end this call" });
        return;
      }
      await call.endCall();
      socket.emit("call-ended", {
        callId: call._id,
        status: call.status,
        duration: call.duration,
        callType: call.callType,
      });
      const otherUserId =
        call.caller.toString() === socket.userId
          ? call.receiver.toString()
          : call.caller.toString();
      const otherSocket = activeUsers.get(otherUserId);
      if (otherSocket) {
        io.to(otherSocket.socketId).emit("call-ended", {
          callId: call._id,
          status: call.status,
          duration: call.duration,
          endedBy: socket.user,
          callType: call.callType,
        });
      }
    } catch (error) {
      console.error("Call end error:", error);
      socket.emit("call-error", { error: "Failed to end call" });
    }
  });

  socket.on("call-offer", async (data) => {
    try {
      const { callId, offer } = data || {};
      if (!callId || !offer) {
        socket.emit("call-error", { error: "Call ID and offer are required" });
        return;
      }
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("call-error", { error: "Call not found" });
        return;
      }
      if (call.caller.toString() !== socket.userId) {
        socket.emit("call-error", { error: "Not authorized to send offer" });
        return;
      }
      call.offer = JSON.stringify(offer);
      await call.save();
      const receiverActive = activeUsers.get(call.receiver.toString());
      if (receiverActive) {
        io.to(receiverActive.socketId).emit("call-offer", {
          callId: call._id,
          offer,
          from: socket.user,
          callType: call.callType,
        });
      }
    } catch (error) {
      console.error("Call offer error:", error);
      socket.emit("call-error", { error: "Failed to send call offer" });
    }
  });

  socket.on("call-answer-webrtc", async (data) => {
    try {
      const { callId, answer } = data || {};
      if (!callId || !answer) {
        socket.emit("call-error", { error: "Call ID and answer are required" });
        return;
      }
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("call-error", { error: "Call not found" });
        return;
      }
      if (call.receiver.toString() !== socket.userId) {
        socket.emit("call-error", { error: "Not authorized to send answer" });
        return;
      }
      call.answer = JSON.stringify(answer);
      await call.save();
      const callerActive = activeUsers.get(call.caller.toString());
      if (callerActive) {
        io.to(callerActive.socketId).emit("call-answer-webrtc", {
          callId: call._id,
          answer,
          from: socket.user,
          callType: call.callType,
        });
      }
    } catch (error) {
      console.error("WebRTC answer error:", error);
      socket.emit("call-error", { error: "Failed to send answer" });
    }
  });

  socket.on("ice-candidate", async (data) => {
    try {
      const { callId, candidate, sdpMLineIndex, sdpMid } = data || {};
      if (!callId || !candidate) {
        socket.emit("call-error", {
          error: "Call ID and candidate are required",
        });
        return;
      }
      const call = await Call.findById(callId);
      if (!call) {
        socket.emit("call-error", { error: "Call not found" });
        return;
      }
      // Save candidate (optional)
      try {
        call.iceCandidates.push({ candidate, sdpMLineIndex, sdpMid });
        await call.save();
      } catch (_) {}
      const otherUserId =
        call.caller.toString() === socket.userId
          ? call.receiver.toString()
          : call.caller.toString();
      const otherSocket = activeUsers.get(otherUserId);
      if (otherSocket) {
        io.to(otherSocket.socketId).emit("ice-candidate", {
          callId: call._id,
          candidate,
          sdpMLineIndex,
          sdpMid,
          from: socket.user,
          callType: call.callType,
        });
      }
    } catch (error) {
      console.error("ICE candidate error:", error);
      socket.emit("call-error", { error: "Failed to send ICE candidate" });
    }
  });

  // ========================
  // Group Call signaling handlers
  // ========================
  socket.on("group-call-initiate", async (data) => {
    try {
      const { groupId, callType = "voice", callId } = data || {};
      console.log(`📞 Group call initiate request:`, {
        groupId,
        callType,
        callId,
        initiator: socket.userId,
        initiatorName: socket.user?.name,
      });

      if (!groupId) {
        socket.emit("group-call-error", { error: "Group ID is required" });
        return;
      }

      // Notify initiator (confirmation)
      socket.emit("group-call-initiated", {
        callId,
        callType,
        groupId,
        initiator: socket.user,
      });

      // Notify all group members about the new call
      const Group = require("./models/Group");
      const group = await Group.findById(groupId).populate(
        "members.user",
        "name avatar email"
      );

      if (group) {
        group.members.forEach((member) => {
          const memberSocketData = activeUsers.get(member.user._id.toString());
          if (
            memberSocketData &&
            member.user._id.toString() !== socket.userId
          ) {
            console.log(
              `📤 Notifying group member ${member.user.name} about new call`
            );
            io.to(memberSocketData.socketId).emit("incoming-group-call", {
              callId,
              callType,
              groupId,
              groupName: group.name,
              initiator: socket.user,
            });
          }
        });
      }
    } catch (error) {
      console.error("Group call initiate error:", error);
      socket.emit("group-call-error", {
        error: "Failed to initiate group call",
      });
    }
  });

  socket.on("group-call-join", async (data) => {
    try {
      const { callId, groupId } = data || {};
      console.log(`📞 Group call join request:`, {
        callId,
        groupId,
        userId: socket.userId,
        userName: socket.user?.name,
      });

      if (!callId || !groupId) {
        socket.emit("group-call-error", {
          error: "Call ID and Group ID are required",
        });
        return;
      }

      // Notify all other participants in the call
      const GroupCall = require("./models/GroupCall");
      const groupCall = await GroupCall.findById(callId).populate(
        "participants.user",
        "name avatar email"
      );

      if (groupCall) {
        groupCall.participants.forEach((participant) => {
          if (
            participant.user._id.toString() !== socket.userId &&
            participant.isActive
          ) {
            const participantSocketData = activeUsers.get(
              participant.user._id.toString()
            );
            if (participantSocketData) {
              const newParticipantData = {
                id: socket.user._id.toString(),
                name: socket.user.name,
                email: socket.user.email,
                role: socket.user.role,
                isActive: true,
              };
              console.log(
                `📤 Notifying participant ${participant.user.name} about new joiner:`,
                {
                  callId,
                  groupId,
                  newParticipant: newParticipantData,
                }
              );
              io.to(participantSocketData.socketId).emit(
                "group-call-participant-joined",
                {
                  callId,
                  groupId,
                  newParticipant: newParticipantData,
                }
              );
            }
          }
        });

        // Also emit the full active participants list to all current participants
        const participantsPayload = (groupCall.participants || [])
          .filter((p) => p.isActive && p.user)
          .map((p) => ({
            id: p.user._id.toString(),
            name: p.user.name,
            email: p.user.email,
            avatar: p.user.avatar || p.user.profileImage || null,
            isActive: true,
          }));

        groupCall.participants.forEach((participant) => {
          if (participant.isActive) {
            const participantSocketData = activeUsers.get(
              participant.user._id.toString()
            );
            if (participantSocketData) {
              io.to(participantSocketData.socketId).emit(
                "group-call-participants",
                {
                  callId,
                  groupId,
                  participants: participantsPayload,
                }
              );
            }
          }
        });
      }

      // Confirm join to the user with current active participants
      const participantsPayload = (groupCall?.participants || [])
        .filter((p) => p.isActive && p.user)
        .map((p) => ({
          id:
            p.user._id?.toString?.() || p.user?.toString?.() || String(p.user),
          name: p.user.name,
          email: p.user.email,
          avatar: p.user.avatar || p.user.profileImage || null,
          isActive: !!p.isActive,
        }));

      socket.emit("group-call-joined", {
        callId,
        groupId,
        participant: socket.user,
        participants: participantsPayload,
      });
    } catch (error) {
      console.error("Group call join error:", error);
      socket.emit("group-call-error", { error: "Failed to join group call" });
    }
  });

  socket.on("group-call-leave", async (data) => {
    try {
      const { callId, groupId } = data || {};
      console.log(`📞 Group call leave request:`, {
        callId,
        groupId,
        userId: socket.userId,
        userName: socket.user?.name,
      });

      if (!callId || !groupId) {
        socket.emit("group-call-error", {
          error: "Call ID and Group ID are required",
        });
        return;
      }

      // Notify all other participants in the call
      const GroupCall = require("./models/GroupCall");
      const groupCall = await GroupCall.findById(callId).populate(
        "participants.user",
        "name avatar email"
      );

      if (groupCall) {
        // Check if the leaving user is the initiator
        const isInitiator = groupCall.initiator.toString() === socket.userId;

        if (isInitiator) {
          // If initiator leaves, end the call for everyone
          console.log(
            `📞 Initiator ${socket.user?.name} left, ending call for all participants`
          );

          // End the call in database
          await groupCall.endCall();

          // Notify all participants that call has ended
          groupCall.participants.forEach((participant) => {
            if (participant.isActive) {
              const participantSocketData = activeUsers.get(
                participant.user._id.toString()
              );
              if (participantSocketData) {
                console.log(
                  `📤 Notifying participant ${participant.user.name} about call end`
                );
                io.to(participantSocketData.socketId).emit("group-call-ended", {
                  callId,
                  groupId,
                  reason: "Initiator left the call",
                  endedBy: socket.user,
                });
              }
            }
          });
        } else {
          // Regular participant leaving, just notify others
          groupCall.participants.forEach((participant) => {
            if (
              participant.user._id.toString() !== socket.userId &&
              participant.isActive
            ) {
              const participantSocketData = activeUsers.get(
                participant.user._id.toString()
              );
              if (participantSocketData) {
                console.log(
                  `📤 Notifying participant ${participant.user.name} about leaver`
                );
                io.to(participantSocketData.socketId).emit(
                  "group-call-participant-left",
                  {
                    callId,
                    groupId,
                    leftParticipant: socket.user,
                  }
                );
              }
            }
          });

          // Recompute and emit the full active participants list after leave
          const participantsPayload = (groupCall.participants || [])
            .filter(
              (p) =>
                p.isActive && p.user && p.user._id.toString() !== socket.userId
            )
            .map((p) => ({
              id: p.user._id.toString(),
              name: p.user.name,
              email: p.user.email,
              avatar: p.user.avatar || p.user.profileImage || null,
              isActive: true,
            }));

          groupCall.participants.forEach((participant) => {
            if (
              participant.user._id.toString() !== socket.userId &&
              participant.isActive
            ) {
              const participantSocketData = activeUsers.get(
                participant.user._id.toString()
              );
              if (participantSocketData) {
                io.to(participantSocketData.socketId).emit(
                  "group-call-participants",
                  {
                    callId,
                    groupId,
                    participants: participantsPayload,
                  }
                );
              }
            }
          });
        }
      }

      // Confirm leave to the user
      socket.emit("group-call-left", {
        callId,
        groupId,
        participant: socket.user,
      });
    } catch (error) {
      console.error("Group call leave error:", error);
      socket.emit("group-call-error", { error: "Failed to leave group call" });
    }
  });

  socket.on("group-call-end", async (data) => {
    try {
      const { callId, groupId } = data || {};
      console.log(`📞 Group call end request:`, {
        callId,
        groupId,
        userId: socket.userId,
        userName: socket.user?.name,
      });

      if (!callId || !groupId) {
        socket.emit("group-call-error", {
          error: "Call ID and Group ID are required",
        });
        return;
      }

      // Notify all participants in the call
      const GroupCall = require("./models/GroupCall");
      const groupCall = await GroupCall.findById(callId).populate(
        "participants.user",
        "name avatar email"
      );

      if (groupCall) {
        groupCall.participants.forEach((participant) => {
          if (participant.isActive) {
            const participantSocketData = activeUsers.get(
              participant.user._id.toString()
            );
            if (participantSocketData) {
              console.log(
                `📤 Notifying participant ${participant.user.name} about call end`
              );
              io.to(participantSocketData.socketId).emit("group-call-ended", {
                callId,
                groupId,
                endedBy: socket.user,
              });
            }
          }
        });
      }
    } catch (error) {
      console.error("Group call end error:", error);
      socket.emit("group-call-error", { error: "Failed to end group call" });
    }
  });

  // Group call WebRTC signaling
  socket.on("group-call-offer", async (data) => {
    try {
      const { callId, groupId, targetUserId, offer } = data || {};
      if (process.env.DEBUG_GROUP_CALL === "1") {
        const key = `${callId || "no-call"}:${socket.userId || "no-user"}:${
          targetUserId || "broadcast"
        }`;
        if (!seenGroupOfferLogs.has(key)) {
          console.log(`📞 Group call offer`, {
            callId,
            groupId,
            from: socket.userId,
            to: targetUserId,
          });
          seenGroupOfferLogs.add(key);
        }
      }

      if (!callId || !groupId || !targetUserId || !offer) {
        socket.emit("group-call-error", {
          error: "Call ID, Group ID, target user ID, and offer are required",
        });
        return;
      }

      const targetSocketData = activeUsers.get(targetUserId);
      if (targetSocketData) {
        io.to(targetSocketData.socketId).emit("group-call-offer", {
          callId,
          groupId,
          from: socket.user,
          offer,
        });
      }
    } catch (error) {
      console.error("Group call offer error:", error);
      socket.emit("group-call-error", {
        error: "Failed to send group call offer",
      });
    }
  });

  socket.on("group-call-answer", async (data) => {
    try {
      const { callId, groupId, targetUserId, answer } = data || {};
      // Silence repeated logs by default; opt-in with DEBUG_GROUP_CALL
      if (process.env.DEBUG_GROUP_CALL === "1") {
        console.log(`📞 Group call answer`, {
          callId,
          groupId,
          from: socket.userId,
          to: targetUserId,
        });
      }

      if (!callId || !groupId || !targetUserId || !answer) {
        socket.emit("group-call-error", {
          error: "Call ID, Group ID, target user ID, and answer are required",
        });
        return;
      }

      const targetSocketData = activeUsers.get(targetUserId);
      if (targetSocketData) {
        io.to(targetSocketData.socketId).emit("group-call-answer", {
          callId,
          groupId,
          from: socket.user,
          answer,
        });
      }
    } catch (error) {
      console.error("Group call answer error:", error);
      socket.emit("group-call-error", {
        error: "Failed to send group call answer",
      });
    }
  });

  socket.on("group-call-ice-candidate", async (data) => {
    try {
      const {
        callId,
        groupId,
        targetUserId,
        candidate,
        sdpMLineIndex,
        sdpMid,
      } = data || {};
      if (process.env.DEBUG_GROUP_CALL === "1") {
        console.log(`🧊 Group call ICE candidate`, {
          callId,
          groupId,
          from: socket.userId,
          to: targetUserId,
          hasCandidate: !!candidate,
          sdpMid,
          sdpMLineIndex,
        });
      }

      if (!callId || !groupId || !candidate) {
        socket.emit("group-call-error", {
          error: "Call ID, Group ID, and candidate are required",
        });
        return;
      }

      // If targetUserId is specified, send to that specific user
      if (targetUserId) {
        const targetSocketData = activeUsers.get(targetUserId);
        if (targetSocketData) {
          io.to(targetSocketData.socketId).emit("group-call-ice-candidate", {
            callId,
            groupId,
            fromUserId: socket.userId,
            candidate,
            sdpMLineIndex,
            sdpMid,
          });
        }
      } else {
        // If no targetUserId, broadcast to all group members except sender
        const Group = require("./models/Group");
        const group = await Group.findById(groupId).populate(
          "members.user",
          "name avatar email"
        );

        if (group) {
          group.members.forEach((member) => {
            if (member.user._id.toString() !== socket.userId) {
              const memberSocketData = activeUsers.get(
                member.user._id.toString()
              );
              if (memberSocketData) {
                io.to(memberSocketData.socketId).emit(
                  "group-call-ice-candidate",
                  {
                    callId,
                    groupId,
                    fromUserId: socket.userId,
                    candidate,
                    sdpMLineIndex,
                    sdpMid,
                  }
                );
              }
            }
          });
        }
      }
    } catch (error) {
      console.error("Group call ICE candidate error:", error);
      socket.emit("group-call-error", {
        error: "Failed to send group call ICE candidate",
      });
    }
  });

  // ========================
  // Group Audio over Socket fallback (PCM/Opus chunks relayed)
  // ========================
  socket.on("group-audio-chunk", async (data) => {
    try {
      const { callId, groupId, chunk, mimeType } = data || {};
      if (!callId || !groupId || !chunk) {
        return; // silently drop invalid packets
      }

      // Relay to all active participants except sender
      const GroupCall = require("./models/GroupCall");
      const groupCall = await GroupCall.findById(callId).populate(
        "participants.user",
        "_id"
      );
      if (!groupCall) return;

      groupCall.participants.forEach((participant) => {
        if (participant.isActive) {
          const uid = participant.user._id.toString();
          if (uid !== socket.userId) {
            const target = activeUsers.get(uid);
            if (target) {
              io.to(target.socketId).emit("group-audio-chunk", {
                callId,
                groupId,
                fromUserId: socket.userId,
                chunk, // binary payload (ArrayBuffer)
                mimeType: mimeType || "audio/webm;codecs=opus",
              });
            }
          }
        }
      });
    } catch (err) {
      // Avoid noisy logs in production
      if (process.env.DEBUG_GROUP_CALL === "1") {
        console.error("group-audio-chunk relay error:", err.message);
      }
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    activeUsers.delete(socket.userId);
    console.log(
      `❌ User disconnected: ${socket.user?.name || socket.userId} - ${
        socket.id
      }`
    );
  });
});

// Database connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
  });

// Catch-all handler: send back React's index.html file for any non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

const PORT = process.env.PORT;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, io };
