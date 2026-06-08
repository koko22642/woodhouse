const conversation = document.querySelector("#conversation");
const composer = document.querySelector("#composer");
const commandInput = document.querySelector("#commandInput");
const directive = document.querySelector("#directive");
const statusEl = document.querySelector("#status");
const statusText = document.querySelector("#statusText");
const aiStatus = document.querySelector("#aiStatus");
const voiceInputStatus = document.querySelector("#voiceInputStatus");
const voiceOutputStatus = document.querySelector("#voiceOutputStatus");
const memoryList = document.querySelector("#memoryList");
const notesList = document.querySelector("#notesList");
const remindersList = document.querySelector("#remindersList");
const syncStatus = document.querySelector("#syncStatus");
const syncForm = document.querySelector("#syncForm");
const syncKeyInput = document.querySelector("#syncKeyInput");
const syncNowButton = document.querySelector("#syncNowButton");
const notificationStatus = document.querySelector("#notificationStatus");
const enableNotificationsButton = document.querySelector("#enableNotificationsButton");
const testNotificationsButton = document.querySelector("#testNotificationsButton");
const micButton = document.querySelector("#micButton");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;
const storageKey = "woodhouse.memory";
const transcriptKey = "woodhouse.transcript";
const notesKey = "woodhouse.notes";
const remindersKey = "woodhouse.reminders";
const syncKeyStorageKey = "woodhouse.syncKey";
const notifiedRemindersKey = "woodhouse.notifiedReminders";

let recognition = null;
let isListening = false;
let aiOnline = false;
let syncAvailable = false;
let syncKey = localStorage.getItem(syncKeyStorageKey) || "";
let serviceWorkerRegistration = null;
let notifiedReminders = loadJson(notifiedRemindersKey, []);
let messages = loadJson(transcriptKey, []);
let memory = loadJson(storageKey, [
  "Call the assistant Woodhouse.",
  "Keep answers useful and concise."
]);
let notes = loadJson(notesKey, []);
let reminders = loadJson(remindersKey, []);

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(memory));
  localStorage.setItem(transcriptKey, JSON.stringify(messages.slice(-50)));
  localStorage.setItem(notesKey, JSON.stringify(notes.slice(0, 25)));
  localStorage.setItem(remindersKey, JSON.stringify(reminders.slice(0, 25)));
  localStorage.setItem(notifiedRemindersKey, JSON.stringify(notifiedReminders.slice(0, 100)));
}

function setSyncStatus(text) {
  syncStatus.textContent = text;
}

function setNotificationStatus(text) {
  notificationStatus.textContent = text;
}

function addMessage(role, content) {
  messages.push({ role, content });
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.textContent = content;
  conversation.appendChild(message);
  conversation.scrollTop = conversation.scrollHeight;
  saveState();
}

function renderMemory() {
  memoryList.innerHTML = "";
  if (!memory.length) {
    const item = document.createElement("li");
    item.textContent = "No memory stored.";
    memoryList.appendChild(item);
    return;
  }

  memory.forEach(entry => {
    const item = document.createElement("li");
    item.textContent = entry;
    memoryList.appendChild(item);
  });
}

function renderToolList(list, items, emptyText) {
  list.innerHTML = "";
  if (!items.length) {
    const item = document.createElement("li");
    item.textContent = emptyText;
    list.appendChild(item);
    return;
  }

  items.slice(0, 6).forEach(entry => {
    const item = document.createElement("li");
    item.textContent = formatEntry(entry);
    list.appendChild(item);
  });
}

function renderTools() {
  renderToolList(notesList, notes, "No notes yet.");
  renderToolList(remindersList, activeReminders(), "No reminders yet.");
}

function createEntry(text) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    text,
    createdAt: new Date().toISOString()
  };
}

function createReminder(text, schedule) {
  return {
    ...createEntry(text),
    dueAt: schedule.dueAt,
    repeat: schedule.repeat || null,
    completedAt: null
  };
}

function formatEntry(entry) {
  if (!entry.dueAt) {
    return entry.text;
  }

  const due = new Date(entry.dueAt);
  const dateText = due.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const repeatText = entry.repeat === "weekly" ? ", weekly" : "";
  const doneText = entry.completedAt ? " [done]" : "";
  return `${entry.text} - ${dateText}${repeatText}${doneText}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function applyTime(date, timeText) {
  if (!timeText) {
    date.setHours(9, 0, 0, 0);
    return date;
  }

  const match = timeText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) {
    return date;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  }
  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  date.setHours(hours, minutes, 0, 0);
  return date;
}

function parseTimePhrase(text) {
  const match = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  return match?.[1] || "";
}

function nextWeekday(targetDay, repeat = false) {
  const now = new Date();
  const date = startOfDay(now);
  const delta = (targetDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + (delta === 0 && (repeat || date <= now) ? 7 : delta));
  return date;
}

function parseReminderSchedule(text) {
  const lower = text.toLowerCase();
  const timeText = parseTimePhrase(text);
  const weekdays = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  let due = null;
  let repeat = null;

  const everyMatch = lower.match(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (everyMatch) {
    repeat = "weekly";
    due = nextWeekday(weekdays[everyMatch[1]], true);
  } else if (lower.includes("tomorrow")) {
    due = startOfDay(new Date());
    due.setDate(due.getDate() + 1);
  } else if (lower.includes("today")) {
    due = startOfDay(new Date());
  } else {
    const weekdayMatch = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekdayMatch) {
      due = nextWeekday(weekdays[weekdayMatch[1]]);
    }
  }

  if (!due) {
    return { dueAt: null, repeat: null };
  }

  return {
    dueAt: applyTime(due, timeText).toISOString(),
    repeat
  };
}

function cleanReminderText(text) {
  return text
    .replace(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function activeReminders() {
  return reminders.filter(reminder => !reminder.completedAt);
}

function dueRemindersFor(date = new Date()) {
  const start = startOfDay(date);
  const end = endOfDay(date);
  return activeReminders().filter(reminder => {
    if (!reminder.dueAt) {
      return false;
    }
    const due = new Date(reminder.dueAt);
    return due >= start && due <= end;
  });
}

function overdueReminders() {
  const now = new Date();
  return activeReminders().filter(reminder => reminder.dueAt && new Date(reminder.dueAt) < now);
}

function dueNowReminders() {
  const now = new Date();
  return activeReminders().filter(reminder => reminder.dueAt && new Date(reminder.dueAt) <= now);
}

function mergeEntries(existing = [], incoming = []) {
  const merged = new Map();
  for (const entry of [...incoming, ...existing]) {
    if (!entry?.text) {
      continue;
    }
    const id = entry.id || entry.text.toLowerCase();
    merged.set(id, {
      id,
      text: entry.text,
      createdAt: entry.createdAt || new Date().toISOString(),
      dueAt: entry.dueAt || null,
      repeat: entry.repeat || null,
      completedAt: entry.completedAt || null
    });
  }
  return [...merged.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 25);
}

function mergeMemory(existing = [], incoming = []) {
  return [...new Set([...incoming, ...existing].filter(Boolean))].slice(0, 10);
}

async function syncNow(announce = false) {
  if (!syncAvailable) {
    setSyncStatus("Unavailable");
    if (announce) {
      addMessage("assistant", "Sync is not configured on this server yet.");
    }
    return false;
  }

  if (!syncKey) {
    setSyncStatus("Needs key");
    if (announce) {
      addMessage("assistant", "Enter your sync key first.");
    }
    return false;
  }

  setSyncStatus("Syncing");

  try {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-woodhouse-sync-key": syncKey
      },
      body: JSON.stringify({ memory, notes, reminders })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Sync failed.");
    }

    const data = await response.json();
    memory = mergeMemory(memory, data.memory || []);
    notes = mergeEntries(notes, data.notes || []);
    reminders = mergeEntries(reminders, data.reminders || []);
    saveState();
    renderMemory();
    renderTools();
    setSyncStatus("On");

    if (announce) {
      addMessage("assistant", "Sync complete.");
    }
    return true;
  } catch (error) {
    setSyncStatus("Error");
    if (announce) {
      addMessage("assistant", `Sync failed: ${error.message}`);
    }
    return false;
  }
}

function scheduleSync() {
  if (syncAvailable && syncKey) {
    syncNow(false);
  }
}

async function setupNotifications() {
  if (!("Notification" in window)) {
    setNotificationStatus("Unavailable");
    enableNotificationsButton.disabled = true;
    testNotificationsButton.disabled = true;
    return;
  }

  if ("serviceWorker" in navigator) {
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("sw.js");
    } catch {
      serviceWorkerRegistration = null;
    }
  }

  setNotificationStatus(Notification.permission === "granted" ? "On" : "Off");
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    setNotificationStatus("Unavailable");
    addMessage("assistant", "Notifications are not available in this browser.");
    return false;
  }

  const permission = await Notification.requestPermission();
  setNotificationStatus(permission === "granted" ? "On" : "Blocked");

  if (permission === "granted") {
    addMessage("assistant", "Notifications enabled.");
    await sendNotification("Woodhouse notifications enabled", "I will notify you when reminders become due while Woodhouse is open.");
    return true;
  }

  addMessage("assistant", "Notifications were not enabled.");
  return false;
}

async function sendNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const options = {
    body,
    tag: title,
    renotify: true
  };

  if (serviceWorkerRegistration?.showNotification) {
    await serviceWorkerRegistration.showNotification(title, options);
    return true;
  }

  new Notification(title, options);
  return true;
}

async function checkDueNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const due = dueNowReminders();
  for (const reminder of due) {
    const key = `${reminder.id}:${reminder.dueAt || "no-date"}`;
    if (notifiedReminders.includes(key)) {
      continue;
    }

    notifiedReminders.unshift(key);
    await sendNotification("Woodhouse reminder", reminder.text);
    addMessage("assistant", `Reminder due: ${reminder.text}`);
  }

  saveState();
}

function speak(text) {
  if (!synth) {
    voiceOutputStatus.textContent = "Unavailable";
    return;
  }

  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  utterance.pitch = 0.86;
  utterance.volume = 0.9;
  synth.speak(utterance);
}

function runTool(command) {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "daily brief" || lower === "briefing" || lower === "brief") {
    const noteCount = notes.length;
    const activeCount = activeReminders().length;
    const dueToday = dueRemindersFor();
    const overdue = overdueReminders();
    return [
      `You have ${noteCount} note${noteCount === 1 ? "" : "s"} and ${activeCount} active reminder${activeCount === 1 ? "" : "s"}.`,
      overdue.length ? `Overdue: ${overdue.map(formatEntry).join("; ")}.` : "No overdue reminders.",
      dueToday.length ? `Due today: ${dueToday.map(formatEntry).join("; ")}.` : "Nothing due today.",
      aiOnline ? "AI backend is online." : "AI backend is in local mode."
    ].join(" ");
  }

  if (lower === "test notification") {
    sendNotification("Woodhouse test", "Notifications are working.").then(sent => {
      if (!sent) {
        addMessage("assistant", "Notifications are not enabled yet. Use the Enable button first.");
      }
    });
    return "Testing notifications.";
  }

  if (lower === "clear memory") {
    memory = [];
    renderMemory();
    saveState();
    return "Memory cleared.";
  }

  if (lower === "clear notes") {
    notes = [];
    renderTools();
    saveState();
    return "Notes cleared.";
  }

  if (lower === "clear reminders") {
    reminders = [];
    renderTools();
    saveState();
    return "Reminders cleared.";
  }

  if (lower === "list notes" || lower === "show notes") {
    if (!notes.length) {
      return "You do not have any notes yet.";
    }
    return `Notes: ${notes.map((note, index) => `${index + 1}. ${note.text}`).join(" ")}`;
  }

  if (lower === "list reminders" || lower === "show reminders") {
    const active = activeReminders();
    if (!active.length) {
      return "You do not have any reminders yet.";
    }
    return `Reminders: ${active.map((reminder, index) => `${index + 1}. ${formatEntry(reminder)}`).join(" ")}`;
  }

  if (
    lower === "due today" ||
    lower === "today's reminders" ||
    lower.startsWith("what reminders are due today")
  ) {
    const dueToday = dueRemindersFor();
    if (!dueToday.length) {
      return "No reminders are due today.";
    }
    return `Due today: ${dueToday.map((reminder, index) => `${index + 1}. ${formatEntry(reminder)}`).join(" ")}`;
  }

  if (lower === "overdue reminders" || lower === "what is overdue") {
    const overdue = overdueReminders();
    if (!overdue.length) {
      return "No reminders are overdue.";
    }
    return `Overdue: ${overdue.map((reminder, index) => `${index + 1}. ${formatEntry(reminder)}`).join(" ")}`;
  }

  const completeMatch = lower.match(/^(?:complete|done|finish)\s+reminder\s+(\d+)$/);
  if (completeMatch) {
    const index = Number(completeMatch[1]) - 1;
    const active = activeReminders();
    const reminder = active[index];
    if (!reminder) {
      return "I could not find that reminder number.";
    }

    if (reminder.repeat === "weekly" && reminder.dueAt) {
      const next = new Date(reminder.dueAt);
      next.setDate(next.getDate() + 7);
      reminder.dueAt = next.toISOString();
      renderTools();
      saveState();
      scheduleSync();
      return `Completed and rescheduled: ${formatEntry(reminder)}`;
    }

      reminder.completedAt = new Date().toISOString();
    renderTools();
    saveState();
    scheduleSync();
    return `Completed: ${reminder.text}`;
  }

  const noteMatch = trimmed.match(/^(?:note|add note|take note)\s+(.+)/i);
  if (noteMatch) {
    const text = noteMatch[1].trim();
    notes.unshift(createEntry(text));
    renderTools();
    saveState();
    scheduleSync();
    return `Noted: ${text}`;
  }

  const reminderMatch = trimmed.match(/^(?:remind me to|remind me|remind|add reminder)\s+(.+)/i);
  if (reminderMatch) {
    const rawText = reminderMatch[1].trim();
    const schedule = parseReminderSchedule(rawText);
    const text = cleanReminderText(rawText) || rawText;
    reminders.unshift(createReminder(text, schedule));
    renderTools();
    saveState();
    scheduleSync();
    return `Reminder added: ${formatEntry(reminders[0])}`;
  }

  if (lower.startsWith("remember ")) {
    const item = trimmed.replace(/^remember\s+/i, "").trim();
    if (item) {
      memory.unshift(item);
      memory = [...new Set(memory)].slice(0, 10);
      renderMemory();
      saveState();
      scheduleSync();
      return `Remembered: ${item}`;
    }
  }

  if (lower.includes("status")) {
    const mode = aiOnline ? "AI backend connected" : "local fallback mode";
    return `Systems nominal. Voice output is ready, voice input is ${SpeechRecognition ? "available" : "not available in this browser"}, and I am running in ${mode}.`;
  }

  if (lower.includes("what can you do") || lower.includes("abilities")) {
    return "I can answer with AI, speak replies, store memory, save notes, keep reminders, give a daily brief, and open simple browser commands.";
  }

  if (lower.includes("open google")) {
    window.open("https://www.google.com", "_blank", "noopener,noreferrer");
    return "Opening Google.";
  }

  if (lower.includes("time")) {
    return `It is ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }

  if (lower.includes("date")) {
    return `Today is ${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`;
  }

  return null;
}

function localReply(command) {
  return runTool(command) || "I can handle that as a local command once we add the tool. For now, I have captured it in the mission log.";
}

async function remoteReply() {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      memory: [
        "Memory:",
        ...memory.map(item => `- ${item}`),
        "Notes:",
        ...notes.slice(0, 10).map(note => `- ${note.text}`),
        "Reminders:",
        ...activeReminders().slice(0, 10).map(reminder => `- ${formatEntry(reminder)}`)
      ].join("\n")
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "AI backend failed");
  }

  const data = await response.json();
  return data.text;
}

async function handleCommand(command) {
  if (!command.trim()) {
    return;
  }

  directive.textContent = command;
  addMessage("user", command);
  commandInput.value = "";

  let reply;
  try {
    const toolReply = runTool(command);
    if (toolReply) {
      reply = toolReply;
    } else if (aiOnline) {
      directive.textContent = "Thinking.";
      reply = await remoteReply();
    } else {
      reply = localReply(command);
    }
  } catch (error) {
    reply = `${localReply(command)} Backend note: ${error.message}`;
  } finally {
    directive.textContent = command;
  }

  addMessage("assistant", reply);
  speak(reply);
}

function setupVoiceInput() {
  if (!SpeechRecognition) {
    voiceInputStatus.textContent = "Unavailable";
    micButton.disabled = true;
    return;
  }

  voiceInputStatus.textContent = "Ready";
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.addEventListener("start", () => {
    isListening = true;
    micButton.classList.add("listening");
    directive.textContent = "Listening.";
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    micButton.classList.remove("listening");
  });

  recognition.addEventListener("result", event => {
    const command = event.results[0][0].transcript;
    handleCommand(command);
  });
}

async function boot() {
  setupVoiceInput();
  setupNotifications();
  renderMemory();
  renderTools();

  messages.forEach(message => {
    const node = document.createElement("article");
    node.className = `message ${message.role}`;
    node.textContent = message.content;
    conversation.appendChild(node);
  });

  if (!synth) {
    voiceOutputStatus.textContent = "Unavailable";
  }

  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    aiOnline = data.aiOnline;
    syncAvailable = Boolean(data.syncEnabled);
    aiStatus.textContent = aiOnline ? data.model : "Local";
    setSyncStatus(syncAvailable ? (syncKey ? "On" : "Needs key") : "Off");
  } catch {
    aiStatus.textContent = "Local";
    setSyncStatus("Off");
  }

  statusEl.classList.add("online");
  statusText.textContent = "Online";

  if (!messages.length) {
    addMessage("assistant", "Good evening. Woodhouse is online.");
  }

  if (syncKey) {
    syncKeyInput.value = syncKey;
    syncNow(false);
  }

  checkDueNotifications();
  window.setInterval(checkDueNotifications, 60_000);
}

composer.addEventListener("submit", event => {
  event.preventDefault();
  handleCommand(commandInput.value);
});

micButton.addEventListener("click", () => {
  if (!recognition || isListening) {
    return;
  }
  recognition.start();
});

document.querySelectorAll("[data-command]").forEach(button => {
  button.addEventListener("click", () => handleCommand(button.dataset.command));
});

syncForm.addEventListener("submit", event => {
  event.preventDefault();
  syncKey = syncKeyInput.value.trim();
  if (syncKey) {
    localStorage.setItem(syncKeyStorageKey, syncKey);
  } else {
    localStorage.removeItem(syncKeyStorageKey);
  }
  syncNow(true);
});

syncNowButton.addEventListener("click", () => {
  syncNow(true);
});

enableNotificationsButton.addEventListener("click", () => {
  requestNotificationPermission();
});

testNotificationsButton.addEventListener("click", () => {
  sendNotification("Woodhouse test", "Notifications are working.").then(sent => {
    addMessage("assistant", sent ? "Test notification sent." : "Enable notifications first.");
  });
});

boot();
