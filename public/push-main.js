let publicVapidKey = "";
let currentSubscription = null;

// UI Elements
const subscribeBtn = document.getElementById("subscribeBtn");
const testBtn = document.getElementById("testBtn");
const unsubscribeBtn = document.getElementById("unsubscribeBtn");
const statusDiv = document.getElementById("status");
const subscriptionInfo = document.getElementById("subscriptionInfo");

// Initialize
async function init() {
  try {
    // Fetch VAPID public key from server
    const response = await fetch("/api/push-notifications/vapid-public-key");
    const data = await response.json();

    if (!data.configured) {
      showStatus(
        "error",
        "Push notifications are not configured on the server. Please generate VAPID keys first."
      );
      subscribeBtn.disabled = true;
      return;
    }

    publicVapidKey = data.publicKey;

    // Check if service worker and push are supported
    if (!("serviceWorker" in navigator)) {
      showStatus("error", "Service Workers are not supported in this browser.");
      subscribeBtn.disabled = true;
      return;
    }

    if (!("PushManager" in window)) {
      showStatus(
        "error",
        "Push notifications are not supported in this browser."
      );
      subscribeBtn.disabled = true;
      return;
    }

    // Check existing subscription
    const registration = await navigator.serviceWorker.register("/push-sw.js", {
      scope: "/",
    });

    currentSubscription = await registration.pushManager.getSubscription();

    if (currentSubscription) {
      showStatus("success", "✓ You are subscribed to push notifications");
      updateButtonStates(true);
      showSubscriptionInfo(currentSubscription);
    } else {
      showStatus(
        "info",
        'Click "Enable Notifications" to receive push notifications'
      );
      updateButtonStates(false);
    }
  } catch (error) {
    console.error("Initialization error:", error);
    showStatus("error", "Failed to initialize: " + error.message);
  }
}

// Subscribe to push notifications
subscribeBtn.addEventListener("click", async () => {
  try {
    subscribeBtn.disabled = true;
    subscribeBtn.textContent = "Subscribing...";

    const register = await navigator.serviceWorker.register("/push-sw.js", {
      scope: "/",
    });

    // Wait for service worker to be ready
    await navigator.serviceWorker.ready;

    const subscription = await register.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
    });

    // Send subscription to the server
    const response = await fetch("/api/push-notifications/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      currentSubscription = subscription;
      showStatus("success", "✓ Successfully subscribed to push notifications!");
      updateButtonStates(true);
      showSubscriptionInfo(subscription);
    } else {
      throw new Error("Failed to save subscription on server");
    }
  } catch (error) {
    console.error("Subscription error:", error);
    showStatus("error", "Failed to subscribe: " + error.message);
    subscribeBtn.disabled = false;
    subscribeBtn.textContent = "Enable Notifications";
  }
});

// Send test notification
testBtn.addEventListener("click", async () => {
  try {
    testBtn.disabled = true;
    testBtn.textContent = "Sending...";

    const response = await fetch("/api/push-notifications/send-notification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Notification",
        body: "This is a test push notification from your chat app!",
        icon: "/icon.png",
      }),
    });

    if (response.ok) {
      showStatus(
        "success",
        "✓ Test notification sent! Check your notifications."
      );
    } else {
      const error = await response.json();
      throw new Error(error.error || "Failed to send notification");
    }
  } catch (error) {
    console.error("Test notification error:", error);
    showStatus("error", "Failed to send test: " + error.message);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "Send Test Notification";
  }
});

// Unsubscribe from push notifications
unsubscribeBtn.addEventListener("click", async () => {
  try {
    if (!currentSubscription) {
      showStatus("error", "No active subscription found");
      return;
    }

    unsubscribeBtn.disabled = true;
    unsubscribeBtn.textContent = "Unsubscribing...";

    // Unsubscribe from push
    await currentSubscription.unsubscribe();

    // Remove from server
    await fetch("/api/push-notifications/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: currentSubscription.endpoint,
      }),
    });

    currentSubscription = null;
    showStatus("info", "You have been unsubscribed from push notifications");
    updateButtonStates(false);
    subscriptionInfo.classList.remove("show");
  } catch (error) {
    console.error("Unsubscribe error:", error);
    showStatus("error", "Failed to unsubscribe: " + error.message);
  } finally {
    unsubscribeBtn.disabled = false;
    unsubscribeBtn.textContent = "Disable Notifications";
  }
});

// Helper functions
function showStatus(type, message) {
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
}

function updateButtonStates(isSubscribed) {
  if (isSubscribed) {
    subscribeBtn.style.display = "none";
    testBtn.style.display = "block";
    unsubscribeBtn.style.display = "block";
  } else {
    subscribeBtn.style.display = "block";
    subscribeBtn.disabled = false;
    subscribeBtn.textContent = "Enable Notifications";
    testBtn.style.display = "none";
    unsubscribeBtn.style.display = "none";
  }
}

function showSubscriptionInfo(subscription) {
  const endpoint = subscription.endpoint;
  const shortEndpoint = endpoint.substring(0, 50) + "...";
  subscriptionInfo.innerHTML = `
    <strong>Subscription Status:</strong> Active<br>
    <strong>Endpoint:</strong> ${shortEndpoint}
  `;
  subscriptionInfo.classList.add("show");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// Initialize on load
init();









