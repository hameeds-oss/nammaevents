// NammaEvents Telegram Bot
// Runs on Node.js — deploy on any server or use webhook
// Commands:
//   Send any text → adds event to Google Sheet
//   Send an image → AI reads it and adds event
//   /list → shows all current events
//   /help → shows usage instructions

const TELEGRAM_TOKEN   = "8739056975:AAHjA-RvGfK_U7S4GpUKZTQvXmmOEprS5p8";
const ADMIN_CHAT_ID    = "1031732366";
const APPS_SCRIPT_URL  = "https://script.google.com/macros/s/AKfycby2HrMZQMrW37ZVXx_-Mqw1s4iSNuXeX-Lhl06VhD3N5TpsO26sFnzuZaZ7cZJxOvOlpQ/exec";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // set this as environment variable

const https    = require("https");
const http     = require("http");

// ── Telegram API helper ───────────────────────────────────────────────────────
async function telegramAPI(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function sendMessage(chatId, text) {
  return telegramAPI("sendMessage", {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
  });
}

// ── Download file from Telegram ───────────────────────────────────────────────
async function getFileURL(fileId) {
  const res  = await telegramAPI("getFile", { file_id: fileId });
  const path = res.result.file_path;
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${path}`;
}

async function downloadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      res.on("error", reject);
    });
  });
}

// ── Claude AI — extract event details from image or text ─────────────────────
async function extractEventWithClaude(input, isImage = false) {
  const today     = new Date();
  const thisYear  = today.getFullYear();
  const nextYear  = thisYear + 1;
  const todayStr  = today.toISOString().split("T")[0];

  const prompt = `You are an event data extractor for NammaEvents, a Chennai event discovery website.

Today's date is ${todayStr}. Current year is ${thisYear}.

Extract event details and return ONLY a JSON object with these exact fields:
{
  "name": "event name",
  "category": "one of: music, food, art, tech, sport, kids, wellness",
  "date": "YYYY-MM-DD format",
  "time": "HH:MM in 24hr format",
  "venue": "venue name",
  "area": "area in Chennai",
  "price": "price like ₹500 or Free",
  "url": "booking URL if visible, else https://nammaevents.org",
  "seats": "capacity or availability info if visible"
}

IMPORTANT DATE RULES:
- Today is ${todayStr}
- If the event shows a date that has already passed this year, use ${nextYear} instead
- If no year is mentioned, use ${thisYear} if the date is in the future, or ${nextYear} if it has passed
- Always return date in YYYY-MM-DD format
- Never return a date in the past

If any field is not found, use empty string "".
Return ONLY the JSON, no other text.`;

  const messages = isImage
    ? [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input } },
        { type: "text", text: prompt }
      ]}]
    : [{ role: "user", content: prompt + "\n\nEvent text:\n" + input }];

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages,
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text   = parsed.content[0].text;
          const json   = JSON.parse(text.replace(/```json|```/g, "").trim());
          resolve(json);
        } catch (e) {
          reject(new Error("Could not parse Claude response: " + data));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Add event to Google Sheet ─────────────────────────────────────────────────
async function addEventToSheet(event) {
  // Use URL-encoded form data with redirect following
  const formData = new URLSearchParams();
  Object.keys(event).forEach(key => formData.append(key, event[key] || ""));
  const body = formData.toString();

  return new Promise((resolve, reject) => {
    function doRequest(url, redirectCount) {
      if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
      const urlObj  = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path:     urlObj.pathname + urlObj.search,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      };
      const req = https.request(options, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    }
    doRequest(APPS_SCRIPT_URL, 0);
  });
}

// ── Process incoming Telegram update ─────────────────────────────────────────
async function processUpdate(update) {
  const msg    = update.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const text   = msg.text || "";

  // Security — only allow admin
  if (chatId !== ADMIN_CHAT_ID) {
    await sendMessage(chatId, "⛔ Unauthorised. This is a private bot.");
    return;
  }

  // /help
  if (text === "/help" || text === "/start") {
    await sendMessage(chatId, `*NammaEvents Admin Bot* 🎉

*How to add events:*

📸 *Send an image* — forward any event poster/screenshot and I'll extract the details automatically!

📝 *Send text* in this format:
\`Event Name | category | YYYY-MM-DD | HH:MM | Venue | Area | Price | URL\`

Example:
\`Jazz Night | music | 2026-07-15 | 19:00 | Hard Rock Cafe | Anna Nagar | ₹600 | https://...\`

*Commands:*
/list — view current events
/help — show this message`);
    return;
  }

  // /list
  if (text === "/list") {
    await sendMessage(chatId, "⏳ Fetching events from your sheet...");
    try {
      const res = await new Promise((resolve, reject) => {
        https.get(APPS_SCRIPT_URL + "?action=getEvents", (r) => {
          let d = ""; r.on("data", c => d += c); r.on("end", () => resolve(d));
        }).on("error", reject);
      });
      const data   = JSON.parse(res);
      const events = data.events || [];
      if (!events.length) { await sendMessage(chatId, "No events found."); return; }
      const list = events.slice(0, 10).map((e, i) =>
        `${i+1}. *${e.name}*\n   📅 ${e.dateDisplay} | 📍 ${e.venue}`
      ).join("\n\n");
      await sendMessage(chatId, `*Current Events (latest 10):*\n\n${list}`);
    } catch (err) {
      await sendMessage(chatId, "❌ Could not fetch events: " + err.message);
    }
    return;
  }

  // Image message — extract with Claude AI
  if (msg.photo) {
    await sendMessage(chatId, "🔍 Reading event details from image...");
    try {
      const fileId  = msg.photo[msg.photo.length - 1].file_id;
      const fileUrl = await getFileURL(fileId);
      const base64  = await downloadImageAsBase64(fileUrl);
      const event   = await extractEventWithClaude(base64, true);
      await addEventToSheet(event);
      await sendMessage(chatId, `✅ *Event added to NammaEvents!*

📌 *${event.name}*
🏷 Category: ${event.category}
📅 Date: ${event.date} at ${event.time}
📍 Venue: ${event.venue}, ${event.area}
💰 Price: ${event.price}

Your website will show this event within minutes!`);
    } catch (err) {
      await sendMessage(chatId, "❌ Could not read image: " + err.message + "\n\nTry sending the event details as text instead.");
    }
    return;
  }

  // Text message — parse pipe-separated or extract with Claude
  if (text && !text.startsWith("/")) {
    await sendMessage(chatId, "⏳ Processing event details...");
    try {
      let event;
      // Try pipe-separated format first
      const parts = text.split("|").map(p => p.trim());
      if (parts.length >= 4) {
        event = {
          name:     parts[0] || "",
          category: parts[1] || "art",
          date:     parts[2] || "",
          time:     parts[3] || "00:00",
          venue:    parts[4] || "",
          area:     parts[5] || "Chennai",
          price:    parts[6] || "Check site",
          url:      parts[7] || "https://nammaevents.org",
          seats:    parts[8] || "",
        };
      } else {
        // Use Claude to extract from free text
        event = await extractEventWithClaude(text, false);
      }
      await addEventToSheet(event);
      await sendMessage(chatId, `✅ *Event added to NammaEvents!*

📌 *${event.name}*
🏷 Category: ${event.category}
📅 Date: ${event.date} at ${event.time}
📍 Venue: ${event.venue}, ${event.area}
💰 Price: ${event.price}

Your website will show this event within minutes!`);
    } catch (err) {
      await sendMessage(chatId, "❌ Error: " + err.message);
    }
    return;
  }
}

// ── Webhook server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        const update = JSON.parse(body);
        await processUpdate(update);
      } catch (e) {
        console.error("Error processing update:", e);
      }
      res.writeHead(200);
      res.end("OK");
    });
  } else {
    res.writeHead(200);
    res.end("NammaEvents Bot is running!");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`NammaEvents Telegram Bot running on port ${PORT}`);
  console.log(`Set webhook to: https://YOUR_SERVER_URL/webhook`);
});
