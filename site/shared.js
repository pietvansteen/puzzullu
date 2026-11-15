/* Puzzullu — helpers shared by all pages (window.PZ). */
(function () {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getal = new Intl.NumberFormat("nl-NL");

  // seconds -> "u:mm:ss" (1:01:00, 0:59:26)
  function tijd(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // "2026-07-03" -> "03-07-2026"
  function datum(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  }

  // rating 1–5 -> ★★★☆☆
  const sterren = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");

  // a YouTube link (youtube.com, www./m.youtube.com, youtu.be); the API only saves these, the site only links these
  const youtube = (url) => /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/\S{1,300}$/.test(url || "");

  let dataPromise = null;
  function data() {
    dataPromise = dataPromise || fetch("/data.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`data.json: ${r.status}`);
      return r.json();
    });
    return dataPromise;
  }

  // the password for /loggen/, kept on this device after logging in once
  const ADMIN_KEY = "pz_admin";
  const admin = {
    get: () => { try { return localStorage.getItem(ADMIN_KEY) || ""; } catch (e) { return ""; } },
    set: (t) => { try { localStorage.setItem(ADMIN_KEY, t); } catch (e) { /* private window */ } },
    clear: () => { try { localStorage.removeItem(ADMIN_KEY); } catch (e) { /* ignore */ } },
  };

  // "Loggen" in the menu, only on devices with the password
  const nav = document.querySelector(".nav");
  if (nav && admin.get() && !nav.querySelector('a[href="/loggen/"]')) {
    const here = location.pathname.startsWith("/loggen");
    nav.insertAdjacentHTML("beforeend", `<a href="/loggen/"${here ? ' aria-current="page"' : ""}>Loggen</a>`);
  }

  // push messages on this device ("Up-to-date blijven"): the service worker /sw.js shows them
  const meldingen = {
    // can this browser get them at all? (an iPhone only as an app on the home screen)
    kan: () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    iphoneZonderApp: () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone
      && !matchMedia("(display-mode: standalone)").matches,
    geblokkeerd: () => "Notification" in window && Notification.permission === "denied",
    async abonnement() {
      if (!meldingen.kan()) return null;
      const reg = await navigator.serviceWorker.getRegistration("/");
      return reg ? reg.pushManager.getSubscription() : null;
    },
    // the endpoint of this device when it gets messages, so a log from here doesn't notify itself
    async endpoint() {
      try { return ((await meldingen.abonnement()) || {}).endpoint || ""; } catch (e) { return ""; }
    },
    async aan() {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Je hebt meldingen niet toegestaan.");
      const r = await fetch("/api/push/sleutel", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "De server is niet bereikbaar.");
      const raw = atob(j.sleutel.replace(/-/g, "+").replace(/_/g, "/"));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
      await meldingen.melden("/api/push/aan", sub.endpoint);
      // what is on the site now counts as seen, so the first message is about a new puzzle
      await meldingen.gezien();
    },
    async uit() {
      const sub = await meldingen.abonnement();
      if (!sub) return;
      await meldingen.melden("/api/push/uit", sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    },
    async melden(pad, endpoint) {
      const r = await fetch(pad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Dat lukte niet.");
    },
    // the highest log number this device knows (the service worker reads it to tell what is new);
    // without n: the newest log on the site now
    async gezien(n) {
      try {
        if (n == null) n = Math.max(0, ...(await data()).logs.map((l) => Number(String(l.id).replace(/\D/g, "")) || 0));
        await (await caches.open("pz-push")).put("/pz-push/gezien", new Response(String(n)));
      } catch (e) { /* no caches in a private window: then a message may also mention older logs */ }
    },
  };

  window.PZ = { esc, getal: (n) => getal.format(n), tijd, datum, sterren, data, admin, youtube, meldingen };
})();
