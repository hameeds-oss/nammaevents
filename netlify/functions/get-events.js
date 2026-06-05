// NammaEvents — Live Chennai events via Ticketmaster Discovery API
// Deployed at: /.netlify/functions/get-events
// Free API: https://developer.ticketmaster.com

exports.handler = async function (event) {
  const cat = event.queryStringParameters?.category || "all";

  try {
    const events = await fetchTicketmaster(cat);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=1800",
      },
      body: JSON.stringify({
        events:  events.length ? events : fallbackEvents(),
        source:  events.length ? "ticketmaster" : "fallback",
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

// ── Ticketmaster Discovery API ────────────────────────────────────────────────
async function fetchTicketmaster(cat) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error("TICKETMASTER_API_KEY not set");

  // Ticketmaster segment/classification IDs for categories
  const catMap = {
    all:   "",
    music: "KZFzniwnSyZfZ7v7nJ",  // Music
    art:   "KZFzniwnSyZfZ7v7na",  // Arts & Theatre
    sport: "KZFzniwnSyZfZ7v7nE",  // Sports
    kids:  "KZFzniwnSyZfZ7v7n1",  // Family
    food:  "",
    tech:  "",
  };

  const params = new URLSearchParams({
    apikey:         key,
    city:           "Chennai",
    countryCode:    "IN",
    size:           "20",
    sort:           "date,asc",
    startDateTime:  new Date().toISOString().split(".")[0] + "Z",
    ...(catMap[cat] && { segmentId: catMap[cat] }),
  });

  const res = await fetch(
    `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
    { headers: { Accept: "application/json" } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ticketmaster API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const items = data._embedded?.events || [];

  return items.map((e) => {
    const venue    = e._embedded?.venues?.[0];
    const priceMin = e.priceRanges?.[0]?.min;
    const currency = e.priceRanges?.[0]?.currency || "INR";
    const price    = priceMin
      ? (currency === "INR" ? "₹" : "$") + Number(priceMin).toLocaleString("en-IN")
      : "Check site";

    return {
      id:          "tm-" + e.id,
      name:        e.name || "Unnamed Event",
      category:    mapCategory(e.classifications?.[0]?.segment?.name || ""),
      date:        e.dates?.start?.localDate + "T" + (e.dates?.start?.localTime || "00:00:00"),
      dateDisplay: formatDate(e.dates?.start?.localDate, e.dates?.start?.localTime),
      venue:       venue?.name || "",
      area:        venue?.address?.line1 || venue?.city?.name || "Chennai",
      price:       price,
      url:         e.url || "#",
      image:       e.images?.find(i => i.ratio === "16_9" && i.width > 500)?.url || e.images?.[0]?.url || "",
      seats:       e.accessibility?.ticketLimit ? e.accessibility.ticketLimit + " tickets" : "",
      source:      "Ticketmaster",
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapCategory(segment) {
  const s = (segment || "").toLowerCase();
  if (s.includes("music"))                          return "music";
  if (s.includes("sport"))                          return "sport";
  if (s.includes("art") || s.includes("theatre"))  return "art";
  if (s.includes("family") || s.includes("kid"))   return "kids";
  if (s.includes("food"))                           return "food";
  if (s.includes("tech") || s.includes("misc"))    return "tech";
  return "art";
}

function formatDate(date, time) {
  if (!date) return "Date TBD";
  try {
    const d = new Date(date + "T" + (time || "00:00:00"));
    return (
      d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) +
      (time ? " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "")
    );
  } catch { return date; }
}

// ── Fallback — shown only if Ticketmaster API fails ───────────────────────────
function fallbackEvents() {
  return [
    { id:"1", name:"Timeless Chitra Live Music Concert",  category:"music", date:"2026-07-11T18:00:00", dateDisplay:"Sat, 11 Jul · 6:00 PM", venue:"Jawaharlal Nehru Indoor Stadium", area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/timeless-chitra-live-music-concert/3900030021435630",                    image:"", seats:"",             source:"Fallback" },
    { id:"2", name:"Jagane Thandhiram Musical Stand-up",  category:"art",   date:"2026-07-12T18:30:00", dateDisplay:"Sun, 12 Jul · 6:30 PM", venue:"Museum Theatre",                  area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/jagane-thandhiram-chennai/3900029816787958",                                image:"", seats:"48 interested", source:"Fallback" },
    { id:"3", name:"Namma Chennai Juniorthon – 4th Ed.",  category:"sport", date:"2026-07-12T08:00:00", dateDisplay:"Sun, 12 Jul · 8:00 AM", venue:"Nehru Park, SDAT",                area:"Chennai", price:"₹599",       url:"https://allevents.in/chennai/namma-chennai-juniorthon-4th-edition/4100029945960732",                     image:"", seats:"",             source:"Fallback" },
    { id:"4", name:"Kids & Junior Athletics Meet 2026",   category:"kids",  date:"2026-07-04T07:30:00", dateDisplay:"Sat, 4 Jul · 7:30 AM",  venue:"Jawaharlal Nehru Stadium",        area:"Chennai", price:"₹500",       url:"https://allevents.in/chennai/kids-and-junior-athletics-meet-2026-tickets/80002931242302",                   image:"", seats:"",             source:"Fallback" },
    { id:"5", name:"Sikkil Gurucharan Grand Concert",     category:"music", date:"2026-07-05T12:30:00", dateDisplay:"Sun, 5 Jul · 12:30 PM", venue:"Club Road, Chetpet",              area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/thumbai-centre-for-arts-grand-concert-of-shri-sikkil-gurucharan/200030057428742", image:"", seats:"",             source:"Fallback" },
    { id:"6", name:"The Great Chennai Job Fair 2026",     category:"tech",  date:"2026-07-11T08:00:00", dateDisplay:"Sat, 11 Jul · 8:00 AM", venue:"Loyola College, Nungambakkam",    area:"Chennai", price:"Free",       url:"https://allevents.in/chennai/the-great-chennai-job-fair-2026/200030103211241",                              image:"", seats:"500+ companies", source:"Fallback" },
  ];
}
