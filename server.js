const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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
  if (!OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "You are Woodhouse, a JARVIS-style local assistant. Be concise, capable, calm, and practical. " +
            "You can suggest actions, summarize plans, and remember user preferences provided in context. " +
            "Never claim you performed OS actions unless the local tool context says they happened."
        },
        {
          role: "user",
          content: `Known local memory:\n${memory || "No stored memory yet."}`
        },
        ...messages.slice(-12).map(message => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        }))
      ],
      temperature: 0.5,
      max_output_tokens: 450
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
        aiOnline: Boolean(OPENAI_API_KEY),
        model: OPENAI_API_KEY ? OPENAI_MODEL : null
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
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
  console.log(OPENAI_API_KEY ? `AI backend: ${OPENAI_MODEL}` : "AI backend: local fallback mode");
});
