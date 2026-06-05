// Netlify Serverless Function — fetches live Chennai events from AllEvents.in API
// Deployed automatically by Netlify at: /.netlify/functions/get-events

exports.handler = async function (event, context) {
  const API_KEY = process.env.ALLEVENTS_API_KEY; // set this in Netlify environment variables

  // Category mapping from query param to AllEvents interest ID
  const categoryMap = {
    all:    "",
    music:  "music",
    food:   "food-and-drink",
    art:    "arts",
    tech:   "technology",
    sport:  "sports-and-fitness",
    kids:   "family-and-kids",
  };

  const cat = event.queryStringParameters?.category || "all";
  const interest = categoryMap[cat] || "";

  // Build AllEvents API URL
  // Docs: https://developer.allevents.in
  const params = new URLSearchParams({
    city:     "Chennai",
    country:  "IN",
    count:    "12",
    ...(interest && { interest }),
  });

  const url = `https://allevents.in/api/index.php?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`AllEvents API error: ${response.status}`);
    }

    const data = await response.json();

    // Normalize the response into a clean shape for the frontend
    const events = (data.events || data || []).map((e) => ({
      id:          e.event_id || e.id || "",
      name:        e.event_name || e.name || "Unnamed Event",
      category:    mapCategory(e.interest || e.category || ""),
      date:        e.start_time || e.date || "",
      dateDisplay: formatDate(e.start_time || e.date || ""),
      venue:       e.venue_name || e.venue || "",
      area:        e.city_area || e.location || "Chennai",
      price:       formatPrice(e.ticket_price || e.price || ""),
      url:         e.event_url || e.url || "#",
      image:       e.banner_url || e.thumbnail || "",
      seats:       e.going || e.interested || "",
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // Cache for 1 hour so we don't hammer the API
        "Cache-Control": "public, max-age=3600",
      },
      body: JSON.stringify({ events, source: "allevents", fetched: new Date().toISOString() }),
    };

  } catch (err) {
    console.error("get-events error:", err.message);

    // Return fallback static events if API fails
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ events: fallbackEvents(), source: "fallback", error: err.message }),
    };
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapCategory(raw) {
  const r = raw.toLowerCase();
  if (r.includes("music") || r.includes("concert")) return "music";
  if (r.includes("food") || r.includes("drink"))    return "food";
  if (r.includes("art")  || r.includes("culture") || r.includes("comedy") || r.includes("theatre")) return "art";
  if (r.includes("tech") || r.includes("business") || r.includes("startup")) return "tech";
  if (r.includes("sport") || r.includes("fitness") || r.includes("run"))     return "sport";
  if (r.includes("kid")  || r.includes("family") || r.includes("child"))     return "kids";
  return "art";
}

function formatDate(raw) {
  if (!raw) return "Date TBD";
  try {
    const d = new Date(raw);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) +
           " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch { return raw; }
}

function formatPrice(raw) {
  if (!raw || raw === "0" || raw === 0) return "Free";
  if (typeof raw === "number") return "₹" + raw.toLocaleString("en-IN");
  if (typeof raw === "string" && raw.toLowerCase().includes("free")) return "Free";
  return "₹" + raw;
}

// Shown only if the API is unreachable — real verified Chennai events
function fallbackEvents() {
  return [
    { id:"1", name:"Timeless Chitra Live Music Concert", category:"music",  dateDisplay:"Sat, 11 Jul · 6:00 PM", venue:"Jawaharlal Nehru Indoor Stadium", area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/timeless-chitra-live-music-concert/3900030021435630", image:"", seats:"" },
    { id:"2", name:"Jagane Thandhiram Musical Stand-up", category:"art",    dateDisplay:"Sun, 12 Jul · 6:30 PM", venue:"Museum Theatre",                   area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/jagane-thandhiram-chennai/3900029816787958",          image:"", seats:"48 interested" },
    { id:"3", name:"Namma Chennai Juniorthon – 4th Ed.", category:"sport",  dateDisplay:"Sun, 12 Jul · 8:00 AM", venue:"Nehru Park, SDAT",                 area:"Chennai", price:"₹599",       url:"https://allevents.in/chennai/namma-chennai-juniorthon-4th-edition/4100029945960732", image:"", seats:"" },
    { id:"4", name:"Kids & Junior Athletics Meet 2026",  category:"kids",   dateDisplay:"Sat, 4 Jul · 7:30 AM",  venue:"Jawaharlal Nehru Stadium",         area:"Chennai", price:"₹500",       url:"https://allevents.in/chennai/kids-and-junior-athletics-meet-2026-tickets/80002931242302", image:"", seats:"" },
    { id:"5", name:"Sikkil Gurucharan Grand Concert",    category:"music",  dateDisplay:"Sun, 5 Jul · 12:30 PM", venue:"Club Road, Chetpet",               area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/thumbai-centre-for-arts-grand-concert-of-shri-sikkil-gurucharan/200030057428742", image:"", seats:"" },
    { id:"6", name:"The Great Chennai Job Fair 2026",    category:"tech",   dateDisplay:"Sat, 11 Jul · 8:00 AM", venue:"Loyola College, Nungambakkam",     area:"Chennai", price:"Free",       url:"https://allevents.in/chennai/the-great-chennai-job-fair-2026/200030103211241",          image:"", seats:"500+ companies" },
  ];
}
