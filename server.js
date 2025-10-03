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

// Authenticate socket connections with JWT and track active users
const activeUsers = new Map();

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
