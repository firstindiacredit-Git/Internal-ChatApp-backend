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
  
    const options = {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      vibrate: data.vibrate,
      data: data.data,
      actions: [
        {
          action: "open",
          title: "Open App",
        },
        {
          action: "close",
          title: "Close",
        },
      ],
      requireInteraction: false,
      tag: "chat-notification",
      renotify: true,
    };
  
    event.waitUntil(self.registration.showNotification(data.title, options));
  });
  
  // Handle notification click
  self.addEventListener("notificationclick", (event) => {
    console.log("Notification clicked:", event);
  
    event.notification.close();
  
    if (event.action === "close") {
      return;
    }
  
    // Open or focus the app
    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          // Check if there's already a window open
          for (let client of clientList) {
            if (
              client.url.includes(self.registration.scope) &&
              "focus" in client
            ) {
              return client.focus();
            }
          }
  
          // If no window is open, open a new one
          if (clients.openWindow) {
            return clients.openWindow("/");
          }
        })
    );
  });
  
  // Handle notification close
  self.addEventListener("notificationclose", (event) => {
    console.log("Notification closed:", event);
  });