// Firebase Cloud Messaging Service Worker

importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js"
);

// Import Firebase config (generated at build time from environment variables)
importScripts("/firebase-sw-config.js");

// Initialize Firebase with the config from firebase-sw-config.js
firebase.initializeApp(FIREBASE_CONFIG);

// Initialize Firebase Messaging
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Received background message:",
    payload
  );

  const notificationTitle = payload.notification?.title || "New Message";
  const notificationBody =
    payload.notification?.body || "You have a new message";
  const notificationType = payload.data?.type || "message";
  const senderImage =
    payload.data?.icon || payload.notification?.icon || "/icon.png";

  // WhatsApp-style base options
  let notificationOptions = {
    body: notificationBody,
    icon: senderImage, // Large sender profile image
    badge: "/badge.png",
    tag:
      notificationType === "personal-message"
        ? `chat-${payload.data?.senderId}`
        : "chat-notification",
    data: payload.data || {},
    requireInteraction: false,
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    silent: false,
    // Large image preview (WhatsApp style)
    image: senderImage,
    dir: "ltr",
    lang: "en",
  };

  // Message notifications (Teams-style with inline reply)
  if (
    notificationType === "personal-message" ||
    notificationType === "group-message"
  ) {
    notificationOptions = {
      ...notificationOptions,
      requireInteraction: false,
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
      body: `${payload.data?.senderName || "Someone"}: ${notificationBody}`,
      tag: `chat-${payload.data?.senderId || "unknown"}`,
    };
  }

  // Call notifications (WhatsApp style with answer/decline)
  else if (
    notificationType === "incoming-call" ||
    notificationType === "incoming-group-call"
  ) {
    const callType = payload.data?.callType || "voice";
    const callIcon = callType === "video" ? "📹" : "📞";

    notificationOptions = {
      ...notificationOptions,
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
      silent: false,
      renotify: true,
    };
  }

  return self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  console.log("[firebase-messaging-sw.js] Notification clicked:", event);
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
    // Mark as read action - just close notification
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
    // Answer call action
    event.notification.close();

    const answerData = {
      type: "answer-call",
      data: notificationData,
      timestamp: Date.now(),
    };

    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          console.log("[SW] Answer call - Found windows:", clientList.length);

          for (let client of clientList) {
            const clientUrl = new URL(client.url);
            const scopeUrl = new URL(self.registration.scope);

            // Match by origin
            if (clientUrl.origin === scopeUrl.origin) {
              console.log(
                "[SW] Sending answer-call message to existing window"
              );
              client.postMessage(answerData);
              return client.focus();
            }
          }

          if (clients.openWindow) {
            console.log("[SW] Opening new window for answer-call");
            const encodedData = btoa(JSON.stringify(answerData));
            return clients.openWindow(`/chat?notificationData=${encodedData}`);
          }
        })
    );
    return;
  }

  if (event.action === "decline") {
    // Decline call action
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

  // Determine URL based on notification type
  let targetUrl = "/chat";

  if (
    notificationType === "incoming-call" ||
    notificationType === "incoming-group-call"
  ) {
    targetUrl = "/chat";
  } else if (notificationData.groupId) {
    targetUrl = "/chat";
  } else if (notificationData.senderId) {
    targetUrl = "/chat";
  }

  // Store notification data for new window
  const storageKey = `notification_data_${Date.now()}`;
  const dataToStore = {
    type: "notification-clicked",
    data: notificationData,
    timestamp: Date.now(),
  };

  // Open or focus the app
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        console.log("[SW] Found client windows:", clientList.length);

        // Check if there's already a window open
        for (let client of clientList) {
          const clientUrl = new URL(client.url);
          const scopeUrl = new URL(self.registration.scope);

          console.log(
            "[SW] Checking client:",
            clientUrl.origin,
            scopeUrl.origin
          );

          // Match by origin
          if (clientUrl.origin === scopeUrl.origin) {
            console.log(
              "[SW] Found matching window, sending message and focusing"
            );

            // Send message to client with notification data
            client.postMessage(dataToStore);

            return client.focus();
          }
        }

        // If no window is open, open a new one with data in URL
        console.log("[SW] No matching window found, opening new window");

        if (clients.openWindow) {
          // Store data in URL as base64 to pass to new window
          const encodedData = btoa(JSON.stringify(dataToStore));
          const urlWithData = `${targetUrl}?notificationData=${encodedData}`;
          return clients.openWindow(urlWithData);
        }
      })
  );
});

// Handle service worker activation
self.addEventListener("activate", (event) => {
  console.log("[firebase-messaging-sw.js] Service Worker activated");
  event.waitUntil(self.clients.claim());
});

// Handle service worker installation
self.addEventListener("install", (event) => {
  console.log("[firebase-messaging-sw.js] Service Worker installed");
  self.skipWaiting();
});
