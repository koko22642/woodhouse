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
const micButton = document.querySelector("#micButton");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;
const storageKey = "woodhouse.memory";
const transcriptKey = "woodhouse.transcript";

let recognition = null;
let isListening = false;
let aiOnline = false;
let messages = loadJson(transcriptKey, []);
let memory = loadJson(storageKey, [
  "Call the assistant Woodhouse.",
  "Keep answers useful and concise."
]);

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

function localReply(command) {
  const lower = command.toLowerCase().trim();

  if (lower.includes("clear memory")) {
    memory = [];
    renderMemory();
    return "Memory cleared.";
  }

  if (lower.startsWith("remember ")) {
    const item = command.replace(/^remember\s+/i, "").trim();
    if (item) {
      memory.unshift(item);
      memory = [...new Set(memory)].slice(0, 10);
      renderMemory();
      return `Remembered: ${item}`;
    }
  }

  if (lower.includes("status")) {
    const mode = aiOnline ? "AI backend connected" : "local fallback mode";
    return `Systems nominal. Voice output is ready, voice input is ${SpeechRecognition ? "available" : "not available in this browser"}, and I am running in ${mode}.`;
  }

  if (lower.includes("what can you do") || lower.includes("abilities")) {
    return "I can take typed or spoken commands, speak replies, store lightweight memory, summarize status, and route requests to an OpenAI backend when an API key is configured.";
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

  return "I can handle that as a local command once we add the tool. For now, I have captured it in the mission log.";
}

async function remoteReply() {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      memory: memory.map(item => `- ${item}`).join("\n")
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
    reply = aiOnline ? await remoteReply() : localReply(command);
  } catch (error) {
    reply = `${localReply(command)} Backend note: ${error.message}`;
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
  renderMemory();

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
    aiStatus.textContent = aiOnline ? data.model : "Local";
  } catch {
    aiStatus.textContent = "Local";
  }

  statusEl.classList.add("online");
  statusText.textContent = "Online";

  if (!messages.length) {
    addMessage("assistant", "Good evening. Woodhouse is online.");
  }
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

boot();
