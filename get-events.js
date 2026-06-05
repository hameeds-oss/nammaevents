// NammaEvents — Live Chennai events via Eventbrite API
// Deployed at: /.netlify/functions/get-events

exports.handler = async function (event) {
  const cat = event.queryStringParameters?.category || "all";

  try {
    const events = await fetchEventbrite(cat);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=1800",
      },
      body: JSON.stringify({
        events:  events.length ? events : fallbackEvents(),
        source:  events.length ? "eventbrite" : "fallback",
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

// ── Eventbrite ────────────────────────────────────────────────────────────────
async function fetchEventbrite(cat) {
  const key = process.env.EVENTBRITE_API_KEY;
  if (!key) throw new Error("EVENTBRITE_API_KEY not set");

  // Eventbrite category IDs
  const catMap = {
    all:   "",
    music: "103",
    food:  "110",
    art:   "105",
    tech:  "102",
    sport: "108",
    kids:  "115",
  };

  const params = new URLSearchParams({
    "location.address":   "Chennai, Tamil Nadu, India",
    "location.within":    "30km",
    "expand":             "venue,ticket_classes,logo",
    "sort_by":            "date",
    "start_date.keyword": "today",
    "page_size":          "20",
    ...(catMap[cat] && { "categories": catMap[cat] }),
  });

  const res = await fetch(
    `https://www.eventbriteapi.com/v3/events/search/?${params}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Eventbrite API error ${res.status}: ${errText}`);
  }

  const data = await res.json();

  return (data.events || [])
    .filter((e) => {
      // Only show Chennai events
      const addr = (e.venue?.address?.city || "").toLowerCase();
      return addr.includes("chennai") || addr.includes("tamil");
    })
    .map((e) => {
      // Get lowest ticket price
      const tickets   = e.ticket_classes || [];
      const freeTicket = tickets.find((t) => t.free);
      const paidMin    = tickets
        .filter((t) => !t.free && t.cost)
        .map((t) => t.cost.major_value)
        .sort((a, b) => a - b)[0];

      const price = freeTicket
        ? "Free"
        : paidMin
        ? "₹" + Number(paidMin).toLocaleString("en-IN")
        : "Check site";

      return {
        id:          "eb-" + e.id,
        name:        e.name?.text || "Unnamed Event",
        category:    mapCategory(e.category_id || ""),
        date:        e.start?.local || "",
        dateDisplay: formatDate(e.start?.local || ""),
        venue:       e.venue?.name || "",
        area:        e.venue?.address?.localized_area_display || e.venue?.address?.city || "Chennai",
        price:       price,
        url:         e.url || "#",
        image:       e.logo?.url || "",
        seats:       e.capacity ? e.capacity + " capacity" : "",
        source:      "Eventbrite",
      };
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapCategory(categoryId) {
  const map = {
    "103": "music",
    "110": "food",
    "105": "art",
    "102": "tech",
    "108": "sport",
    "115": "kids",
    "101": "art",
    "104": "art",
    "107": "art",
    "109": "sport",
    "111": "tech",
    "113": "tech",
    "199": "art",
  };
  return map[categoryId] || "art";
}

function formatDate(raw) {
  if (!raw) return "Date TBD";
  try {
    const d = new Date(raw);
    if (isNaN(d)) return String(raw);
    return (
      d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }) +
      " · " +
      d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    );
  } catch {
    return String(raw);
  }
}

// ── Fallback — shown only if Eventbrite API fails ─────────────────────────────
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
