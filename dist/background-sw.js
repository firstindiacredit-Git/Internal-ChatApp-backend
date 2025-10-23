// Enhanced Service Worker for WhatsApp-like Background Functionality
const CACHE_NAME = "internal-chat-v1";
const API_CACHE = "api-cache-v1";
const MESSAGE_CACHE = "message-cache-v1";

// Background sync events
self.addEventListener("sync", (event) => {
  console.log("Background sync triggered:", event.tag);

  switch (event.tag) {
    case "background-messages":
      event.waitUntil(handleBackgroundMessages());
      break;
    case "background-notifications":
      event.waitUntil(handleBackgroundNotifications());
      break;
    case "send-queued-messages":
      event.waitUntil(sendQueuedMessages());
      break;
    case "check-messages":
      event.waitUntil(checkForNewMessages());
      break;
  }
});

// Periodic background sync
self.addEventListener("periodicsync", (event) => {
  console.log("Periodic background sync:", event.tag);

  if (event.tag === "check-messages") {
    event.waitUntil(checkForNewMessages());
  }
});

// Push notifications
self.addEventListener("push", (event) => {
  console.log("Push notification received:", event);

  const options = {
    body: "You have a new message",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: "chat-notification",
    requireInteraction: true,
    actions: [
      {
        action: "open",
        title: "Open Chat",
        icon: "/icon.svg",
      },
      {
        action: "reply",
        title: "Quick Reply",
        icon: "/icon.svg",
      },
    ],
  };

  if (event.data) {
    const data = event.data.json();
    options.body = data.message || options.body;
    options.data = data;
  }

  event.waitUntil(self.registration.showNotification("Internal Chat", options));
});

// Notification click handling
self.addEventListener("notificationclick", (event) => {
  console.log("Notification clicked:", event);

  event.notification.close();

  if (event.action === "open" || !event.action) {
    event.waitUntil(clients.openWindow("/"));
  } else if (event.action === "reply") {
    event.waitUntil(
      clients.openWindow("/?action=reply&id=" + event.notification.tag)
    );
  }
});

// Message handling from main thread
self.addEventListener("message", (event) => {
  console.log("Service worker received message:", event.data);

  const { type, data } = event.data;

  switch (type) {
    case "NETWORK_ONLINE":
      handleNetworkOnline();
      break;
    case "NETWORK_OFFLINE":
      handleNetworkOffline();
      break;
    case "CONNECTIVITY_CHECK":
      handleConnectivityCheck(data);
      break;
    case "NEW_MESSAGE":
      handleNewMessage(data);
      break;
  }
});

// Background message handling
async function handleBackgroundMessages() {
  try {
    console.log("Processing background messages...");

    // Check for new messages
    const response = await fetch("/api/messages/unread", {
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    if (response.ok) {
      const messages = await response.json();

      for (const message of messages) {
        // Show notification for new messages
        await showMessageNotification(message);

        // Cache the message
        await cacheMessage(message);
      }
    }

    // Notify main thread
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: "MESSAGES_PROCESSED",
        data: { count: messages?.length || 0 },
      });
    });
  } catch (error) {
    console.error("Background message handling failed:", error);
  }
}

// Background notification handling
async function handleBackgroundNotifications() {
  try {
    console.log("Processing background notifications...");

    // Check for pending notifications
    const notifications = await self.registration.getNotifications();

    // Clean up old notifications
    const now = Date.now();
    for (const notification of notifications) {
      if (now - notification.timestamp > 30000) {
        // 30 seconds old
        notification.close();
      }
    }
  } catch (error) {
    console.error("Background notification handling failed:", error);
  }
}

// Send queued messages
async function sendQueuedMessages() {
  try {
    console.log("Sending queued messages...");

    // Get queued messages from IndexedDB
    const messages = await getQueuedMessages();

    for (const message of messages) {
      try {
        const response = await fetch("/api/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        });

        if (response.ok) {
          // Remove from queue
          await removeQueuedMessage(message.id);
          console.log("Queued message sent successfully");
        }
      } catch (error) {
        console.error("Failed to send queued message:", error);
      }
    }
  } catch (error) {
    console.error("Failed to send queued messages:", error);
  }
}

// Check for new messages
async function checkForNewMessages() {
  try {
    console.log("Checking for new messages...");

    const response = await fetch("/api/messages/latest", {
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    if (response.ok) {
      const messages = await response.json();

      // Check if there are new messages since last check
      const lastCheck = await getLastMessageCheck();
      const newMessages = messages.filter((msg) => msg.timestamp > lastCheck);

      if (newMessages.length > 0) {
        // Show notifications for new messages
        for (const message of newMessages) {
          await showMessageNotification(message);
        }

        // Update last check time
        await setLastMessageCheck(Date.now());

        // Notify main thread
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: "NEW_MESSAGES",
            data: newMessages,
          });
        });
      }
    }
  } catch (error) {
    console.error("Failed to check for new messages:", error);
  }
}

// Network status handlers
async function handleNetworkOnline() {
  console.log("Network is online - processing queued operations");

  // Process any queued operations
  await sendQueuedMessages();
  await handleBackgroundMessages();
}

async function handleNetworkOffline() {
  console.log("Network is offline - queuing operations");

  // Store offline state
  await setOfflineState(true);
}

async function handleConnectivityCheck(data) {
  console.log("Connectivity check:", data.isOnline ? "Online" : "Offline");

  if (data.isOnline) {
    await handleNetworkOnline();
  } else {
    await handleNetworkOffline();
  }
}

async function handleNewMessage(data) {
  console.log("New message received:", data);

  // Show notification
  await showMessageNotification(data);

  // Cache message
  await cacheMessage(data);
}

// Helper functions
async function showMessageNotification(message) {
  const options = {
    body: `${message.sender}: ${message.text}`,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: `message-${message.id}`,
    timestamp: Date.now(),
    requireInteraction: true,
    data: message,
    actions: [
      {
        action: "reply",
        title: "Reply",
        icon: "/icon.svg",
      },
      {
        action: "mark-read",
        title: "Mark as Read",
        icon: "/icon.svg",
      },
    ],
  };

  await self.registration.showNotification("New Message", options);
}

async function cacheMessage(message) {
  try {
    const cache = await caches.open(MESSAGE_CACHE);
    await cache.put(
      `/api/messages/${message.id}`,
      new Response(JSON.stringify(message))
    );
  } catch (error) {
    console.error("Failed to cache message:", error);
  }
}

async function getQueuedMessages() {
  // This would interact with IndexedDB to get queued messages
  // Implementation depends on your IndexedDB setup
  return [];
}

async function removeQueuedMessage(messageId) {
  // Remove message from queue in IndexedDB
  console.log("Removing queued message:", messageId);
}

async function getLastMessageCheck() {
  // Get last message check timestamp from storage
  const result = await self.registration.getNotifications();
  return 0; // Default to 0 for first check
}

async function setLastMessageCheck(timestamp) {
  // Store last message check timestamp
  console.log("Setting last message check:", timestamp);
}

async function setOfflineState(isOffline) {
  // Store offline state
  console.log("Setting offline state:", isOffline);
}

// Install event
self.addEventListener("install", (event) => {
  console.log("Service worker installing...");
  self.skipWaiting();
});

// Activate event
self.addEventListener("activate", (event) => {
  console.log("Service worker activating...");
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== CACHE_NAME &&
              cacheName !== API_CACHE &&
              cacheName !== MESSAGE_CACHE
            ) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
    ])
  );
});

// Fetch event for caching
self.addEventListener("fetch", (event) => {
  // Cache API responses
  if (event.request.url.includes("/api/")) {
    event.respondWith(
      caches.open(API_CACHE).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            // Return cached response and update in background
            fetch(event.request).then((fetchResponse) => {
              cache.put(event.request, fetchResponse.clone());
            });
            return response;
          }

          // Not in cache, fetch and cache
          return fetch(event.request).then((fetchResponse) => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
    );
  }
});

console.log(
  "Background service worker loaded - WhatsApp-like functionality enabled"
);


