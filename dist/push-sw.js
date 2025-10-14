// Service Worker for Push Notifications

self.addEventListener("install", (event) => {
  console.log("Service Worker: Installed");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activated");
  event.waitUntil(self.clients.claim());
});

// Handle push event
self.addEventListener("push", (event) => {
  console.log("Push notification received:", event);

  let data = {
    title: "New Notification",
    body: "You have a new notification",
    icon: "/icon.png",
    badge: "/badge.png",
    data: {},
  };

  // Parse notification data
  if (event.data) {
    try {
      const payload = event.data.json();
      if (payload.notification) {
        data = {
          title: payload.notification.title || data.title,
          body: payload.notification.body || data.body,
          icon: payload.notification.icon || data.icon,
          badge: payload.notification.badge || data.badge,
          data: payload.notification.data || {},
          vibrate: payload.notification.vibrate || [200, 100, 200],
        };
      }
    } catch (e) {
      console.error("Error parsing push data:", e);
    }
  }

  const notificationType = data.data?.type || "message";
  const senderImage = data.data?.icon || data.icon || "/icon.png";

  // WhatsApp-style base options
  let options = {
    body: data.body,
    icon: senderImage, // Large sender profile image
    badge: data.badge,
    vibrate: data.vibrate,
    data: data.data,
    tag:
      notificationType === "personal-message"
        ? `chat-${data.data?.senderId}`
        : "chat-notification",
    timestamp: Date.now(),
    silent: false,
    // Large image preview (WhatsApp style)
    image: senderImage,
    dir: "ltr",
    lang: "en",
    requireInteraction: false,
    renotify: true,
  };

  // Message notifications (Teams-style with inline reply)
  if (
    notificationType === "personal-message" ||
    notificationType === "group-message"
  ) {
    options = {
      ...options,
      actions: [
        {
          action: "reply",
          title: "💬 Reply",
          type: "text",
          placeholder: "Type message...",
        },
        {
          action: "open",
          title: "📱 Open Chat",
        },
        {
          action: "mark-read",
          title: "✓✓ Mark Read",
        },
      ],
      vibrate: [100, 50, 100], // Subtle vibration
      // Teams-style rich content
      body: `${data.data?.senderName || "Someone"}: ${data.body}`,
      tag: `chat-${data.data?.senderId || "unknown"}`,
    };
  }

  // Call notifications (WhatsApp style)
  else if (
    notificationType === "incoming-call" ||
    notificationType === "incoming-group-call"
  ) {
    const callType = data.data?.callType || "voice";
    const callIcon = callType === "video" ? "📹" : "📞";

    options = {
      ...options,
      tag: "incoming-call",
      requireInteraction: true,
      vibrate: [1000, 500, 1000, 500, 1000, 500, 1000], // WhatsApp-style long ring
      actions: [
        {
          action: "answer",
          title: `${callIcon} Answer`,
        },
        {
          action: "decline",
          title: "❌ Decline",
        },
      ],
    };
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  console.log("Notification clicked:", event);
  console.log("Action:", event.action);

  const notificationData = event.notification.data || {};
  const notificationType = notificationData.type || "message";

  // Handle different actions (Teams-style)
  if (event.action === "reply") {
    // Inline reply action - send message directly
    event.notification.close();

    // Get the reply text from the notification input
    const replyText = event.reply || "";

    if (replyText.trim()) {
      // Send the reply message to backend
      event.waitUntil(
        // Send message via client app without opening/focusing
        clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then((clientList) => {
            for (let client of clientList) {
              if (client.url.includes(self.registration.scope)) {
                // Send message to client app without focusing
                client.postMessage({
                  type: "send-reply",
                  data: {
                    ...notificationData,
                    replyText: replyText,
                    receiver: notificationData.senderId,
                    sender: notificationData.receiverId,
                  },
                });

                // Show confirmation notification
                self.registration.showNotification("Reply sent", {
                  body: `Replied: ${replyText}`,
                  icon: "/icon.png",
                  tag: "reply-confirmation",
                  silent: true,
                });

                return; // Don't focus or open window
              }
            }

            // If no client found, show error
            self.registration.showNotification("Cannot send reply", {
              body: "Please open the app to send messages",
              icon: "/icon.png",
              tag: "reply-error",
              silent: true,
            });
          })
      );
    } else {
      // No text entered, open app to chat
      event.waitUntil(
        clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then((clientList) => {
            for (let client of clientList) {
              if (
                client.url.includes(self.registration.scope) &&
                "focus" in client
              ) {
                client.postMessage({
                  type: "notification-reply",
                  data: notificationData,
                });
                return client.focus();
              }
            }
            if (clients.openWindow) {
              return clients.openWindow("/chat");
            }
          })
      );
    }
    return;
  }

  if (event.action === "mark-read") {
    event.notification.close();
    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (let client of clientList) {
            if (client.url.includes(self.registration.scope)) {
              client.postMessage({
                type: "mark-message-read",
                data: notificationData,
              });
            }
          }
        })
    );
    return;
  }

  if (event.action === "answer") {
    event.notification.close();
    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (let client of clientList) {
            if (
              client.url.includes(self.registration.scope) &&
              "focus" in client
            ) {
              client.postMessage({
                type: "answer-call",
                data: notificationData,
              });
              return client.focus();
            }
          }
          if (clients.openWindow) {
            return clients.openWindow(
              "/chat?action=answer-call&callId=" + notificationData.callId
            );
          }
        })
    );
    return;
  }

  if (event.action === "decline") {
    event.notification.close();
    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (let client of clientList) {
            if (client.url.includes(self.registration.scope)) {
              client.postMessage({
                type: "decline-call",
                data: notificationData,
              });
            }
          }
        })
    );
    return;
  }

  if (event.action === "close") {
    event.notification.close();
    return;
  }

  // Default action (clicking notification body or "open" action)
  event.notification.close();

  let targetUrl = "/chat";

  if (
    notificationType === "incoming-call" ||
    notificationType === "incoming-group-call"
  ) {
    targetUrl = "/chat";
  }

  // Open or focus the app
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (let client of clientList) {
          if (
            client.url.includes(self.registration.scope) &&
            "focus" in client
          ) {
            client.postMessage({
              type: "notification-clicked",
              data: notificationData,
            });
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// Handle notification close
self.addEventListener("notificationclose", (event) => {
  console.log("Notification closed:", event);
});
