const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

const router = express.Router();

// Register Super Admin (only for initial setup)
router.post(
  "/register-superadmin",
  [
    body("name")
      .trim()
      .isLength({ min: 2 })
      .withMessage("Name must be at least 2 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, password } = req.body;

      // Check if super admin already exists
      const existingSuperAdmin = await User.findOne({ role: "superadmin" });
      if (existingSuperAdmin) {
        return res.status(400).json({ message: "Super admin already exists" });
      }

      // Check if email already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          message:
            "Email already exists. Please use a different email or try logging in instead.",
        });
      }

      const user = new User({
        name,
        email,
        password,
        role: "superadmin",
      });

      await user.save();

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      res.status(201).json({
        message: "Super admin created successfully",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone || null,
          designation: user.designation || null,
          profileImage: user.profileImage || null,
          bio: user.bio || null,
          lastSeen: user.lastSeen,
        },
      });
    } catch (error) {
      console.error("Super admin registration error:", error);
      if (error.code === 11000) {
        res.status(400).json({ message: "Email already exists" });
      } else {
        res.status(500).json({ message: "Server error" });
      }
    }
  }
);

// Login
router.post(
  "/login",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Check if user exists by email
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Check password first (hashed). If fails, fall back to plainPassword field if present
      let isMatch = await user.comparePassword(password);
      if (!isMatch && user.plainPassword) {
        if (password === user.plainPassword) {
          isMatch = true;
        }
      }
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // If password is correct but user is disabled
      if (!user.isActive) {
        // Send notification to admins about disabled user trying to login
        const { io } = require("../server");
        const { sendFCMToUser } = require("../services/fcmService");
        const { sendPushToUser } = require("./pushNotifications");

        // Get all admins and superadmins
        const admins = await User.find({
          role: { $in: ["superadmin", "admin"] },
          isActive: true,
        }).select("_id name email");

        // Send notification to all admins
        const notificationData = {
          type: "disabled_user_login_attempt",
          message: `${user.name} (${user.email}) is trying to login but account is  disabled`,
          userId: user._id,
          userName: user.name,
          userEmail: user.email,
          timestamp: new Date(),
          actions: {
            canActivate: true,
          },
        };

        // Emit to all admin sockets and send push notifications
        admins.forEach(async (admin) => {
          // Socket notification for online admins
          io.to(admin._id.toString()).emit(
            "admin_notification",
            notificationData
          );

          // Push/FCM notification for offline admins
          const title = "🔒 Disabled User Login Attempt";
          const body = `${user.name} is trying to login but their account is disabled`;

          // Try FCM first, fallback to Web Push
          try {
            const result = await sendFCMToUser(
              admin._id.toString(),
              title,
              body,
              {
                type: "disabled_user_login_attempt",
                userId: user._id.toString(),
                userName: user.name,
                userEmail: user.email,
                icon: user.profileImage || "/icon.png",
              }
            );

            if (!result.success) {
              // Fallback to Web Push
              await sendPushToUser(
                admin._id.toString(),
                title,
                body,
                user.profileImage || "/icon.png",
                {
                  type: "disabled_user_login_attempt",
                  userId: user._id.toString(),
                  userName: user.name,
                  userEmail: user.email,
                }
              );
            }
          } catch (err) {
            console.log("Push notification failed for admin:", err.message);
          }
        });

        return res.status(403).json({
          message: "Your account has been disabled by administrator",
          disabled: true,
        });
      }

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      // Update last seen
      user.lastSeen = new Date();
      await user.save();

      // Send login notification to admins (for regular users only)
      if (user.role === "user") {
        try {
          const { io } = require("../server");
          const { sendFCMToUser } = require("../services/fcmService");
          const { sendPushToUser } = require("./pushNotifications");

          // Get all admins and superadmins
          const admins = await User.find({
            role: { $in: ["superadmin", "admin"] },
            isActive: true,
          }).select("_id name email");

          const loginNotificationData = {
            type: "user_login",
            message: `${user.name} (${user.email}) has logged in`,
            userId: user._id,
            userName: user.name,
            userEmail: user.email,
            timestamp: new Date(),
          };

          // Notify all admins
          admins.forEach(async (admin) => {
            // Socket notification for online admins
            io.to(admin._id.toString()).emit(
              "admin_notification",
              loginNotificationData
            );

            // Push/FCM notification for offline admins
            const title = "👤 User Login";
            const body = `${user.name} has logged in`;

            try {
              const result = await sendFCMToUser(
                admin._id.toString(),
                title,
                body,
                {
                  type: "user_login",
                  userId: user._id.toString(),
                  userName: user.name,
                  userEmail: user.email,
                  icon: user.profileImage || "/icon.png",
                }
              );

              if (!result.success) {
                // Fallback to Web Push
                await sendPushToUser(
                  admin._id.toString(),
                  title,
                  body,
                  user.profileImage || "/icon.png",
                  {
                    type: "user_login",
                    userId: user._id.toString(),
                    userName: user.name,
                    userEmail: user.email,
                  }
                );
              }
            } catch (err) {
              console.log("Login notification failed for admin:", err.message);
            }
          });
        } catch (notifError) {
          // Don't fail login if notification fails
          console.error("Failed to send login notifications:", notifError);
        }
      }

      res.json({
        message: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone || null,
          designation: user.designation || null,
          profileImage: user.profileImage || null,
          bio: user.bio || null,
          lastSeen: user.lastSeen,
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get current user
router.get("/me", auth, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone || null,
      designation: req.user.designation || null,
      profileImage: req.user.profileImage || null,
      bio: req.user.bio || null,
      lastSeen: req.user.lastSeen,
    },
  });
});

// Check if super admin exists
router.get("/check-superadmin", async (req, res) => {
  try {
    const existingSuperAdmin = await User.findOne({ role: "superadmin" });
    res.json({
      exists: !!existingSuperAdmin,
      message: existingSuperAdmin
        ? "Super admin already exists"
        : "No super admin found",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
