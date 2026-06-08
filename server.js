const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const hasRealApiKey = Boolean(
  OPENAI_API_KEY &&
    OPENAI_API_KEY !== "your_api_key_here" &&
    OPENAI_API_KEY !== "replace_me"
);
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
  return data.output_text || "I received a response, but it did not include text output.";
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
        model: hasRealApiKey ? OPENAI_MODEL : null
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true });
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
});
