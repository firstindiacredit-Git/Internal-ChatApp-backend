const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config({ path: "./config.env" });
const path = require("path");

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

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

// Socket.io connection handling
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join user to their personal room
  socket.on("join", (userId) => {
    socket.join(userId);
    connectedUsers.set(socket.id, userId);
    console.log(`User ${userId} joined their room`);
  });

  // Handle personal messages
  socket.on("send-message", async (data) => {
    try {
      console.log("🔄 Backend received send-message:", data);
      const { receiver, message, sender } = data;

      // IMPORTANT: Save message to database first
      const Message = require("./models/Message");
      const newMessage = new Message({
        sender: sender,
        receiver: receiver,
        message: message,
        messageType: "text",
      });

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
        message: message,
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
        message: message,
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
      const { groupId, message, sender } = data;

      // Save group message to database
      const Message = require("./models/Message");
      const Group = require("./models/Group");

      const newMessage = new Message({
        sender: sender,
        group: groupId,
        message: message,
        messageType: "text",
      });

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
        message,
        timestamp: newMessage.createdAt,
        createdAt: newMessage.createdAt,
        _id: newMessage._id,
      });

      // Emit back to sender for confirmation
      socket.emit("group-message-sent", {
        id: newMessage._id,
        groupId,
        sender: newMessage.sender,
        message,
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

  // Handle disconnect
  socket.on("disconnect", () => {
    const userId = connectedUsers.get(socket.id);
    if (userId) {
      connectedUsers.delete(socket.id);
      console.log(`User ${userId} disconnected`);
    }
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
