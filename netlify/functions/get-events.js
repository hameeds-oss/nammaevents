// NammaEvents — Live Chennai events from Google Sheets
// Deployed at: /.netlify/functions/get-events
// Update events anytime by editing the Google Sheet — no code changes needed!

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8khfDKXYjEt_phEdj8-VH3l36ObE2MmJ5QqrQD55Y_lOIlYl0InCeGUNrA36uiPbPzyi9IWuRyxGF/pub?gid=0&single=true&output=csv";

exports.handler = async function (event) {
  const cat = event.queryStringParameters?.category || "all";

  try {
    const events = await fetchFromSheet(cat);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=1800",
      },
      body: JSON.stringify({
        events:  events.length ? events : fallbackEvents(),
        source:  events.length ? "google-sheets" : "fallback",
        count:   events.length || fallbackEvents().length,
        fetched: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("get-events error:", err.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        events:  fallbackEvents(),
        source:  "fallback",
        error:   err.message,
        fetched: new Date().toISOString(),
      }),
    };
  }
};

// ── Fetch & parse Google Sheet CSV ────────────────────────────────────────────
async function fetchFromSheet(cat) {
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error("Sheet fetch error: " + res.status);

  const csv  = await res.text();
  const rows = parseCSV(csv);
  if (rows.length < 2) throw new Error("Sheet is empty or has no data rows");

  // First row = headers: name, category, date, time, venue, area, price, url, seats
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    name:     headers.indexOf("name"),
    category: headers.indexOf("category"),
    date:     headers.indexOf("date"),
    time:     headers.indexOf("time"),
    venue:    headers.indexOf("venue"),
    area:     headers.indexOf("area"),
    price:    headers.indexOf("price"),
    url:      headers.indexOf("url"),
    seats:    headers.indexOf("seats"),
  };

  // Today at midnight for filtering past events
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const events = rows
    .slice(1)
    .filter(row => row[idx.name] && row[idx.name].trim())
    .map((row, i) => {
      const date     = (row[idx.date] || "").trim();
      const time     = padTime((row[idx.time] || "00:00").trim());
      const dateTime = date ? date + "T" + time + ":00" : "";
      const rawCat   = (row[idx.category] || "").trim().toLowerCase();

      return {
        id:          "gs-" + (i + 1),
        name:        (row[idx.name]  || "").trim() || "Unnamed Event",
        category:    normaliseCategory(rawCat),
        date:        dateTime,
        dateDisplay: formatDate(date, time),
        venue:       (row[idx.venue] || "").trim(),
        area:        (row[idx.area]  || "").trim() || "Chennai",
        price:       (row[idx.price] || "").trim() || "Check site",
        url:         (row[idx.url]   || "").trim() || "#",
        seats:       (row[idx.seats] || "").trim(),
        source:      "Google Sheets",
      };
    })
    .filter(e => {
      // Remove past events
      if (e.date) {
        const d = new Date(e.date);
        if (!isNaN(d) && d < today) return false;
      }
      // Category filter
      if (cat === "all") return true;
      return e.category === cat;
    })
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  return events;
}

// ── Normalise any category string into our 7 known slugs ─────────────────────
function normaliseCategory(raw) {
  if (!raw) return "art";
  if (raw === "music")                                          return "music";
  if (raw === "food" || raw.includes("drink"))                 return "food";
  if (raw === "sport" || raw.includes("fitness") || raw.includes("run") || raw.includes("athletics")) return "sport";
  if (raw === "kids" || raw.includes("family") || raw.includes("child") || raw.includes("junior"))    return "kids";
  if (raw === "tech" || raw.includes("business") || raw.includes("startup") || raw.includes("job") || raw.includes("expo") || raw.includes("packag")) return "tech";
  if (raw === "art"  || raw.includes("culture") || raw.includes("comedy") || raw.includes("theatre") || raw.includes("stand")) return "art";
  if (raw === "wellness" || raw.includes("health") || raw.includes("yoga") || raw.includes("meditat")) return "art";
  return "art"; // default bucket
}

// ── Pad single-digit time values e.g. "8:00" → "08:00" ───────────────────────
function padTime(t) {
  if (!t) return "00:00";
  const parts = t.split(":");
  return parts[0].padStart(2, "0") + ":" + (parts[1] || "00").padStart(2, "0");
}

// ── Simple CSV parser (handles quoted fields) ─────────────────────────────────
function parseCSV(text) {
  const rows  = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"')             { inQ = !inQ; }
      else if (ch === "," && !inQ){ cols.push(cur); cur = ""; }
      else                        { cur += ch; }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

// ── Format date nicely ────────────────────────────────────────────────────────
function formatDate(date, time) {
  if (!date) return "Date TBD";
  try {
    const d = new Date(date + "T" + (time || "00:00") + ":00");
    if (isNaN(d)) return date;
    return (
      d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) +
      (time && time !== "00:00"
        ? " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
        : "")
    );
  } catch (e) { return date; }
}

// ── Fallback — shown only if Google Sheet is unreachable ──────────────────────
function fallbackEvents() {
  return [
    { id:"1", name:"Timeless Chitra Live Music Concert", category:"music", date:"2026-07-11T18:00:00", dateDisplay:"Sat, 11 Jul · 6:00 PM", venue:"Jawaharlal Nehru Indoor Stadium", area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/timeless-chitra-live-music-concert/3900030021435630", seats:"", source:"Fallback" },
    { id:"2", name:"Jagane Thandhiram Musical Stand-up", category:"art",   date:"2026-07-12T18:30:00", dateDisplay:"Sun, 12 Jul · 6:30 PM", venue:"Museum Theatre",                  area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/jagane-thandhiram-chennai/3900029816787958",                seats:"48 interested", source:"Fallback" },
    { id:"3", name:"Namma Chennai Juniorthon",           category:"sport", date:"2026-07-12T08:00:00", dateDisplay:"Sun, 12 Jul · 8:00 AM", venue:"Nehru Park, SDAT",                area:"Chennai", price:"₹599",       url:"https://allevents.in/chennai/namma-chennai-juniorthon-4th-edition/4100029945960732",    seats:"", source:"Fallback" },
    { id:"4", name:"Kids & Junior Athletics Meet 2026",  category:"kids",  date:"2026-07-04T07:30:00", dateDisplay:"Sat, 4 Jul · 7:30 AM",  venue:"Jawaharlal Nehru Stadium",        area:"Chennai", price:"₹500",       url:"https://allevents.in/chennai/kids-and-junior-athletics-meet-2026-tickets/80002931242302", seats:"", source:"Fallback" },
    { id:"5", name:"Sikkil Gurucharan Grand Concert",    category:"music", date:"2026-07-05T12:30:00", dateDisplay:"Sun, 5 Jul · 12:30 PM", venue:"Club Road, Chetpet",              area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/thumbai-centre-for-arts-grand-concert-of-shri-sikkil-gurucharan/200030057428742", seats:"", source:"Fallback" },
    { id:"6", name:"The Great Chennai Job Fair 2026",    category:"tech",  date:"2026-07-11T08:00:00", dateDisplay:"Sat, 11 Jul · 8:00 AM", venue:"Loyola College, Nungambakkam",    area:"Chennai", price:"Free",       url:"https://allevents.in/chennai/the-great-chennai-job-fair-2026/200030103211241",               seats:"500+ companies", source:"Fallback" },
  ];
}
