/* Puzzullu — service worker, only for push messages ("Up-to-date blijven" on /statistieken/).
   The server sends an empty message when a puzzle is logged; this worker then fetches /data.json itself and
   shows the newest log(s). It does not cache the site or touch any page request. */
"use strict";

const OPSLAG = "pz-push";           // the highest log number this device has seen, so it knows what is new
const GEZIEN = "/pz-push/gezien";

const nr = (l) => Number(String(l.id).replace(/\D/g, "")) || 0;

async function gezien(n) {
  const c = await caches.open(OPSLAG);
  if (n != null) return c.put(GEZIEN, new Response(String(n)));
  const r = await c.match(GEZIEN);
  return r ? Number(await r.text()) || 0 : 0;
}

const tijd = (sec) => (sec == null ? "" : `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`);
const wie = (m) => (m.length < 2 ? m.join("") : `${m.slice(0, -1).join(", ")} & ${m[m.length - 1]}`);

async function bericht() {
  try {
    const d = await (await fetch("/data.json", { cache: "no-store" })).json();
    const afb = Object.fromEntries(d.afbeeldingen.map((a) => [a.id, a]));
    const ex = Object.fromEntries(d.exemplaren.map((e) => [e.id, e]));
    const logs = [...d.logs].sort((x, y) => nr(y) - nr(x));
    if (!logs.length) throw new Error("geen logs");
    const vorig = await gezien();
    const nieuw = vorig ? logs.filter((l) => nr(l) > vorig) : [];
    const l = nieuw[0] || logs[0];
    await gezien(nr(logs[0]));
    const e = ex[l.exemplaar] || {};
    const a = afb[e.afbeelding] || {};
    const regels = [`${a.en || a.nl || "Een puzzel"}${e.stukjes ? ` (${e.stukjes})` : ""}`,
      [wie(l.makers), tijd(l.sec)].filter(Boolean).join(" · ")];
    if (nieuw.length > 1) regels.push(`En nog ${nieuw.length - 1} ${nieuw.length === 2 ? "andere puzzel" : "andere puzzels"}.`);
    return { titel: "Nieuwe puzzel gelegd! 🧩", tekst: regels.join("\n") };
  } catch (err) {
    return { titel: "Nieuwe puzzel gelegd! 🧩", tekst: "Kijk op Puzzullu welke het is." };
  }
}

self.addEventListener("push", (ev) => {
  ev.waitUntil(bericht().then(({ titel, tekst }) => self.registration.showNotification(titel, {
    body: tekst, icon: "/icons/icon-192.png", tag: "pz-log", data: { url: "/statistieken/" },
  })));
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const url = new URL(ev.notification.data && ev.notification.data.url || "/", self.location.origin).href;
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ramen) => {
    const open = ramen.find((r) => r.url === url);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});

// a new version of this file takes over at once
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));
