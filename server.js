const http = require("http");
const fs = require("fs");
const path = require("path");
let webpush = null;

try {
  webpush = require("web-push");
} catch {
  webpush = null;
}

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.WOODHOUSE_DATA_DIR || path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "woodhouse-store.json");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const WOODHOUSE_SYNC_KEY = process.env.WOODHOUSE_SYNC_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:you@example.com";
const WOODHOUSE_TIMEZONE = process.env.WOODHOUSE_TIMEZONE || "America/Chicago";
const WOODHOUSE_BRIEFING_TIMES = (process.env.WOODHOUSE_BRIEFING_TIMES || "07:00,20:00")
  .split(",")
  .map(time => time.trim())
  .filter(Boolean);
const hasRealApiKey = Boolean(
  OPENAI_API_KEY &&
    OPENAI_API_KEY !== "your_api_key_here" &&
    OPENAI_API_KEY !== "replace_me"
);
const hasSyncKey = Boolean(
  WOODHOUSE_SYNC_KEY &&
    WOODHOUSE_SYNC_KEY !== "your_sync_key_here" &&
    WOODHOUSE_SYNC_KEY !== "replace_me"
);
const hasPushBackend = Boolean(
  webpush &&
    VAPID_PUBLIC_KEY &&
    VAPID_PRIVATE_KEY &&
    VAPID_PUBLIC_KEY !== "replace_me" &&
    VAPID_PRIVATE_KEY !== "replace_me"
);
let pushBackendReady = false;

if (hasPushBackend) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushBackendReady = true;
  } catch (error) {
    console.error(`Push backend disabled: ${error.message}`);
  }
}
const SYSTEM_PROMPT = [
  "You are Woodhouse, Jorge's JARVIS-style local assistant.",
  "Be concise, capable, calm, and practical. Speak like a useful copilot, not a chatbot demo.",
  "Use the conversation and local memory to personalize answers.",
  "When the user asks for action, explain what you can do now and what needs a future tool.",
  "Never claim you performed OS, browser, file, or network actions unless the tool context says they happened.",
  "If a request is vague, make one useful assumption and continue."
].join(" ");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {
      memory: [],
      notes: [],
      reminders: [],
      pushSubscriptions: [],
      notifiedPushKeys: [],
      notifiedBriefingKeys: []
    };
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function isSyncAuthorized(req) {
  return hasSyncKey && req.headers["x-woodhouse-sync-key"] === WOODHOUSE_SYNC_KEY;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function normalizeEntry(entry) {
  if (typeof entry === "string") {
    const text = cleanText(entry);
    return text ? { id: text.toLowerCase(), text, createdAt: new Date().toISOString() } : null;
  }

  const text = cleanText(entry?.text);
  if (!text) {
    return null;
  }

  return {
    id: cleanText(entry.id) || text.toLowerCase(),
    text,
    createdAt: cleanText(entry.createdAt) || new Date().toISOString(),
    dueAt: cleanText(entry.dueAt) || null,
    repeat: cleanText(entry.repeat) || null,
    completedAt: cleanText(entry.completedAt) || null
  };
}

function normalizePushSubscription(subscription) {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return null;
  }

  return {
    endpoint: String(subscription.endpoint),
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: String(subscription.keys.p256dh),
      auth: String(subscription.keys.auth)
    }
  };
}

function mergeEntries(existing = [], incoming = [], limit = 50) {
  const merged = new Map();

  for (const entry of [...existing, ...incoming]) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    const key = normalized.id || normalized.text.toLowerCase();
    merged.set(key, normalized);
  }

  return [...merged.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function mergeMemory(existing = [], incoming = []) {
  const items = [...incoming, ...existing]
    .map(cleanText)
    .filter(Boolean);
  return [...new Set(items)].slice(0, 25);
}

function mergeStore(existing, incoming) {
  return {
    memory: mergeMemory(existing.memory, incoming.memory),
    notes: mergeEntries(existing.notes, incoming.notes),
    reminders: mergeEntries(existing.reminders, incoming.reminders),
    pushSubscriptions: existing.pushSubscriptions || [],
    notifiedPushKeys: existing.notifiedPushKeys || [],
    notifiedBriefingKeys: existing.notifiedBriefingKeys || []
  };
}

function activeDueReminders(reminders = []) {
  const now = new Date();
  return reminders.filter(reminder => !reminder.completedAt && reminder.dueAt && new Date(reminder.dueAt) <= now);
}

function activeReminders(reminders = []) {
  return reminders.filter(reminder => !reminder.completedAt);
}

function formatReminder(reminder, timezone = WOODHOUSE_TIMEZONE) {
  if (!reminder.dueAt) {
    return reminder.text;
  }

  const due = new Date(reminder.dueAt);
  const dateText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(due);
  const repeatText = reminder.repeat === "weekly" ? ", weekly" : "";
  return `${reminder.text} - ${dateText}${repeatText}`;
}

function zonedParts(date = new Date(), timezone = WOODHOUSE_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function zonedDateKey(date = new Date(), timezone = WOODHOUSE_TIMEZONE) {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedMinuteKey(date = new Date(), timezone = WOODHOUSE_TIMEZONE) {
  const parts = zonedParts(date, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function remindersDueToday(reminders = [], timezone = WOODHOUSE_TIMEZONE) {
  const today = zonedDateKey(new Date(), timezone);
  return activeReminders(reminders).filter(reminder => {
    if (!reminder.dueAt) {
      return false;
    }
    return zonedDateKey(new Date(reminder.dueAt), timezone) === today;
  });
}

function overdueReminders(reminders = []) {
  const now = new Date();
  return activeReminders(reminders).filter(reminder => reminder.dueAt && new Date(reminder.dueAt) < now);
}

function buildBriefingBody(store) {
  const notes = store.notes || [];
  const active = activeReminders(store.reminders || []);
  const dueToday = remindersDueToday(store.reminders || []);
  const overdue = overdueReminders(store.reminders || []);
  const lines = [
    `${notes.length} note${notes.length === 1 ? "" : "s"}. ${active.length} active reminder${active.length === 1 ? "" : "s"}.`
  ];

  if (overdue.length) {
    lines.push(`Overdue: ${overdue.slice(0, 3).map(reminder => reminder.text).join("; ")}.`);
  }

  if (dueToday.length) {
    lines.push(`Today: ${dueToday.slice(0, 3).map(reminder => formatReminder(reminder)).join("; ")}.`);
  } else {
    lines.push("Nothing due today.");
  }

  return lines.join(" ");
}

async function sendPushToSubscriptions(store, title, body, tag) {
  if (!pushBackendReady || !store.pushSubscriptions?.length) {
    return 0;
  }

  const payload = JSON.stringify({ title, body, tag, url: "/" });
  const keptSubscriptions = [];
  let sent = 0;

  for (const subscription of store.pushSubscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      keptSubscriptions.push(subscription);
      sent += 1;
    } catch (error) {
      if (![404, 410].includes(error.statusCode)) {
        keptSubscriptions.push(subscription);
      }
    }
  }

  store.pushSubscriptions = keptSubscriptions;
  return sent;
}

async function checkDuePushReminders() {
  if (!pushBackendReady) {
    return;
  }

  const store = readStore();
  const notified = new Set(store.notifiedPushKeys || []);
  let changed = false;

  for (const reminder of activeDueReminders(store.reminders || [])) {
    const key = `${reminder.id}:${reminder.dueAt || "no-date"}`;
    if (notified.has(key)) {
      continue;
    }

    const sent = await sendPushToSubscriptions(store, "Woodhouse reminder", reminder.text, key);
    if (sent > 0) {
      notified.add(key);
      changed = true;
    }
  }

  if (changed) {
    store.notifiedPushKeys = [...notified].slice(-500);
  }

  writeStore(store);
}

async function checkScheduledBriefings() {
  if (!pushBackendReady || !WOODHOUSE_BRIEFING_TIMES.length) {
    return;
  }

  const now = new Date();
  const currentTime = zonedMinuteKey(now);
  if (!WOODHOUSE_BRIEFING_TIMES.includes(currentTime)) {
    return;
  }

  const store = readStore();
  const briefingKeys = new Set(store.notifiedBriefingKeys || []);
  const key = `${zonedDateKey(now)}:${currentTime}`;
  if (briefingKeys.has(key)) {
    return;
  }

  const title = currentTime < "12:00" ? "Woodhouse morning brief" : "Woodhouse evening brief";
  const sent = await sendPushToSubscriptions(store, title, buildBriefingBody(store), `briefing:${key}`);
  if (sent > 0) {
    briefingKeys.add(key);
    store.notifiedBriefingKeys = [...briefingKeys].slice(-120);
    writeStore(store);
  }
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const textParts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        textParts.push(content.text);
      }
      if (content.type === "refusal" && content.refusal) {
        textParts.push(content.refusal);
      }
    }
  }

  return textParts.join("\n").trim();
}

async function askOpenAI(messages, memory) {
  if (!hasRealApiKey) {
    throw new Error("OPENAI_API_KEY is missing or still set to the placeholder value.");
  }

  const conversation = messages.slice(-16).map(message => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: `Local memory:\n${memory || "No stored memory yet."}`
        },
        ...conversation
      ],
      max_output_tokens: 650
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = extractResponseText(data);

  if (!text) {
    throw new Error(`OpenAI response completed without text output. Response status: ${data.status || "unknown"}`);
  }

  return text;
}

function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url);
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/status") {
      sendJson(res, 200, {
        aiOnline: hasRealApiKey,
        model: hasRealApiKey ? OPENAI_MODEL : null,
        syncEnabled: hasSyncKey,
        pushEnabled: pushBackendReady,
        briefingTimes: WOODHOUSE_BRIEFING_TIMES,
        timezone: WOODHOUSE_TIMEZONE
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/api/sync") {
      if (!isSyncAuthorized(req)) {
        sendJson(res, 401, { error: "Woodhouse sync is not configured or the sync key is incorrect." });
        return;
      }

      sendJson(res, 200, readStore());
      return;
    }

    if (req.method === "GET" && req.url === "/api/push/public-key") {
      sendJson(res, 200, {
        enabled: pushBackendReady,
        publicKey: pushBackendReady ? VAPID_PUBLIC_KEY : null
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/push/subscribe") {
      if (!isSyncAuthorized(req)) {
        sendJson(res, 401, { error: "Woodhouse sync key is required for push subscriptions." });
        return;
      }

      if (!pushBackendReady) {
        sendJson(res, 503, { error: "Push notifications are not configured on this server." });
        return;
      }

      const body = await readRequestBody(req);
      const subscription = normalizePushSubscription(JSON.parse(body || "{}"));
      if (!subscription) {
        sendJson(res, 400, { error: "Invalid push subscription." });
        return;
      }

      const store = readStore();
      const subscriptions = new Map((store.pushSubscriptions || []).map(item => [item.endpoint, item]));
      subscriptions.set(subscription.endpoint, subscription);
      store.pushSubscriptions = [...subscriptions.values()].slice(-10);
      writeStore(store);
      sendJson(res, 200, { ok: true, subscriptions: store.pushSubscriptions.length });
      return;
    }

    if (req.method === "POST" && req.url === "/api/push/test") {
      if (!isSyncAuthorized(req)) {
        sendJson(res, 401, { error: "Woodhouse sync key is required for push tests." });
        return;
      }

      const store = readStore();
      const sent = await sendPushToSubscriptions(store, "Woodhouse background test", "Background push is working.", "woodhouse-test");
      writeStore(store);
      sendJson(res, 200, { sent });
      return;
    }

    if (req.method === "POST" && req.url === "/api/sync") {
      if (!isSyncAuthorized(req)) {
        sendJson(res, 401, { error: "Woodhouse sync is not configured or the sync key is incorrect." });
        return;
      }

      const body = await readRequestBody(req);
      const incoming = JSON.parse(body || "{}");
      const store = mergeStore(readStore(), incoming);
      writeStore(store);
      sendJson(res, 200, store);
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      if (!hasRealApiKey) {
        sendJson(res, 401, {
          error: "OPENAI_API_KEY is missing or still set to the placeholder value."
        });
        return;
      }

      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const aiText = await askOpenAI(payload.messages || [], payload.memory || "");
      sendJson(res, 200, { text: aiText });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    res.writeHead(405);
    res.end("Method not allowed");
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Woodhouse JARVIS is online at http://localhost:${PORT}`);
  console.log(hasRealApiKey ? `AI backend: ${OPENAI_MODEL}` : "AI backend: local fallback mode");
  console.log(hasSyncKey ? "Sync backend: enabled" : "Sync backend: disabled");
  console.log(pushBackendReady ? "Push backend: enabled" : "Push backend: disabled");
  console.log(`Briefings: ${WOODHOUSE_BRIEFING_TIMES.join(", ")} ${WOODHOUSE_TIMEZONE}`);
});

setInterval(() => {
  checkDuePushReminders().catch(error => {
    console.error("Push reminder check failed:", error.message);
  });
  checkScheduledBriefings().catch(error => {
    console.error("Briefing check failed:", error.message);
  });
}, 60_000);
