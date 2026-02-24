import mineflayer from "mineflayer";
import express from "express";
import fetch from "node-fetch";

const SERVER = "alt3.6b6t.org";
const LOGIN_DELAY_MS = 3500;
const PORTAL_WALK_MS = 3500;
const BETWEEN_PORTALS_DELAY_MS = 6000;
const RECONNECT_DELAY_MS = 30000;
const AFK_INTERVAL_MS = 30000;
const PSI_TIMEOUT_MS = 20000;


const BOT_NAME = process.env.BOT_NAME;
const PSI09_API_URL = process.env.PSI09_API_URL;
const BOT_PASSWORD = process.env.BOT_PASSWORD;
const HTTP_PORT = process.env.PORT || 3000;

if (!PSI09_API_URL || !BOT_PASSWORD) {
  console.error("Missing env vars: PSI09_API_URL or BOT_PASSWORD");
  process.exit(1);
}

let bot;
let reconnectTimer = null;

// -------------------- HTTP keep-alive --------------------
const app = express();
app.get("/health", (_req, res) => res.send("ok"));
app.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Keep-alive listening on ${HTTP_PORT}`);
});

// -------------------- Helpers --------------------
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function walkForward(ms) {
  if (!bot?.entity) return;
  bot.setControlState("forward", true);
  await sleep(ms);
  bot.setControlState("forward", false);
}

// Per-player cooldown (anti-spam / API protection)
const lastMsg = new Map();
function canReply(player) {
  const now = Date.now();
  const last = lastMsg.get(player) || 0;
  if (now - last < 5000) return false; // 5 seconds
  lastMsg.set(player, now);
  return true;
}

// -------------------- PSI-09 call with timeout --------------------
async function callPsi09(sender, content) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PSI_TIMEOUT_MS);

  try {
    const res = await fetch(PSI09_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: content,
        sender_id: sender,
        username: sender
      }),
      signal: controller.signal
    });

    const data = await res.json();
    return (data.reply || "…").toString();
  } finally {
    clearTimeout(t);
  }
}

// -------------------- Bot lifecycle --------------------
function createBot() {
  console.log("[BOT] Connecting…");

  bot = mineflayer.createBot({
    host: SERVER,
    username: BOT_NAME,
    version: "1.21.8",
    auth: "offline" // cracked server
  });

  bot.once("spawn", async () => {
    console.log("[BOT] Spawned, logging in…");
    await sleep(LOGIN_DELAY_MS);
    bot.chat(`/login ${BOT_PASSWORD}`);

    // Walk into portal 1, then portal 2
    await sleep(4000);
    await walkForward(PORTAL_WALK_MS);
    await sleep(BETWEEN_PORTALS_DELAY_MS);
    await walkForward(PORTAL_WALK_MS);

    console.log("[BOT] Portal sequence done");
  });

  // -------------------- DM listener --------------------
  bot.on("messagestr", async (msg) => {
    // Example: "_greg05 whispers: hello"
    const m = msg.match(/^([A-Za-z0-9_]+)\s+whispers:\s+(.+)$/i);
    if (!m) return;

    const sender = m[1];
    const content = m[2];

    if (sender.toLowerCase() === BOT_NAME.toLowerCase()) return;
    if (!canReply(sender)) return;

    console.log(`[DM] ${sender}: ${content}`);

    try {
      const reply = await callPsi09(sender, content);

      // Minecraft hard limit ~256 chars; be safe
      const safeReply = reply.replace(/\s+/g, " ").trim().slice(0, 240);
      bot.chat(`/msg ${sender} ${safeReply || "…"}`);
    } catch (err) {
      console.error("[PSI-09] error:", err.message);
      bot.chat(`/msg ${sender} brain lag, try again`);
    }
  });

  // -------------------- AFK prevention --------------------
  const afkTimer = setInterval(() => {
    if (!bot?.entity) return;
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 200);
  }, AFK_INTERVAL_MS);

  // -------------------- Reconnect logic --------------------
  function scheduleReconnect(reason) {
    if (reconnectTimer) return;
    console.log(`[BOT] Disconnected (${reason}), reconnecting in ${RECONNECT_DELAY_MS / 1000}s…`);
    clearInterval(afkTimer);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      createBot();
    }, RECONNECT_DELAY_MS);
  }

  bot.on("end", () => scheduleReconnect("end"));
  bot.on("kicked", (r) => scheduleReconnect(`kicked: ${r}`));
  bot.on("error", (err) => {
    console.error("[BOT] error:", err.message);
  });
}

// -------------------- Start --------------------
createBot();

// Safety: restart on hard crashes
process.on("uncaughtException", (e) => {
  console.error("[FATAL] uncaughtException:", e);
});
process.on("unhandledRejection", (e) => {
  console.error("[FATAL] unhandledRejection:", e);
});