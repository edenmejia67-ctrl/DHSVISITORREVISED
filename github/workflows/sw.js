// DHS service worker v2: shows push alerts even when the app is closed, and tells the server it did.
// No caching (avoids stale pages). config.js is optional here: without it alerts still show, only the receipt is skipped.
try { importScripts("config.js"); } catch (_) {}
const CFG = self.DHS_CONFIG || {};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// RECEIPT: "this phone really woke up and displayed the alert". Needs the per-alert token the server put in the payload.
function receipt(d) {
  if (!CFG.url || !CFG.key || !d.tok || d.id == null) return Promise.resolve();
  const test = d.id === "test";
  const body = test ? { p_faculty: d.fid, p_token: d.tok } : { p_id: d.id, p_token: d.tok };
  return fetch(CFG.url + "/rest/v1/rpc/" + (test ? "push_receipt_test" : "push_receipt"), {
    method: "POST", keepalive: true,
    headers: { "Content-Type": "application/json", apikey: CFG.key },
    body: JSON.stringify(body),
  }).catch(() => {});
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const urgent = d.urgent === true;
  // A push MUST end in a visible notification (Chrome requires it), so this always shows something.
  const show = self.registration.showNotification(d.title || "DHS Visitor Alert", {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "badge-96.png",                 // white-on-transparent: Android only uses the shape
    tag: "dhs-" + (d.id || "alert"),
    renotify: true,
    requireInteraction: true,              // stays on screen until the teacher taps it: a missed visitor is worse than a lingering banner
    silent: false,
    timestamp: d.t || Date.now(),          // the time the server sent it, so a delayed alert shows how late it really was
    vibrate: urgent ? [900, 200, 900, 200, 900, 200, 900, 200, 1400] : [300, 120, 300],
    data: { id: d.id || null },
    actions: urgent ? [{ action: "open", title: "Open and reply" }] : [],
  });
  e.waitUntil(Promise.all([show, receipt(d)]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const url = new URL("./" + (id && id !== "test" ? "?n=" + id : ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ("focus" in c) { if (c.navigate) c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

// The browser can silently replace a push subscription. Re-subscribe now; the app re-registers it with the server the next time it opens.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    try { await self.registration.pushManager.subscribe((e.oldSubscription && e.oldSubscription.options) || { userVisibleOnly: true }); } catch (_) {}
    const cs = await self.clients.matchAll({ includeUncontrolled: true });
    cs.forEach((c) => c.postMessage({ type: "resub" }));
  })());
});
