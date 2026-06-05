// NammaEvents — Multi-source live event fetcher
// Sources: AllEvents.in + Eventbrite + Meetup
// Deployed at: /.netlify/functions/get-events

exports.handler = async function (event) {
  const cat = event.queryStringParameters?.category || "all";

  // Run all 3 source fetches in parallel
  const [allEventsResults, eventbriteResults, meetupResults] = await Promise.allSettled([
    fetchAllEvents(cat),
    fetchEventbrite(cat),
    fetchMeetup(cat),
  ]);

  // Collect successful results
  const sources = [];
  let combined = [];

  if (allEventsResults.status === "fulfilled" && allEventsResults.value.length) {
    combined = combined.concat(allEventsResults.value);
    sources.push("allevents");
  }
  if (eventbriteResults.status === "fulfilled" && eventbriteResults.value.length) {
    combined = combined.concat(eventbriteResults.value);
    sources.push("eventbrite");
  }
  if (meetupResults.status === "fulfilled" && meetupResults.value.length) {
    combined = combined.concat(meetupResults.value);
    sources.push("meetup");
  }

  // If all 3 failed, use fallback
  if (!combined.length) {
    combined = fallbackEvents();
    sources.push("fallback");
  }

  // Deduplicate by name similarity, sort by date, limit to 24
  const deduped = deduplicateEvents(combined);
  const sorted  = deduped.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const final   = sorted.slice(0, 24);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=1800", // cache 30 mins
    },
    body: JSON.stringify({
      events:  final,
      sources: sources,
      count:   final.length,
      fetched: new Date().toISOString(),
    }),
  };
};

// ── SOURCE 1: AllEvents.in ────────────────────────────────────────────────────
async function fetchAllEvents(cat) {
  const key = process.env.ALLEVENTS_API_KEY;
  if (!key) throw new Error("ALLEVENTS_API_KEY not set");

  const catMap = {
    all: "", music: "music", food: "food-and-drink",
    art: "arts", tech: "technology", sport: "sports-and-fitness", kids: "family-and-kids",
  };

  const params = new URLSearchParams({
    city: "Chennai", country: "IN", count: "20",
    ...(catMap[cat] && { interest: catMap[cat] }),
  });

  const res  = await fetch(`https://allevents.in/api/index.php?${params}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`AllEvents ${res.status}`);
  const data = await res.json();

  return (data.events || data || []).map((e) => normalise({
    id:       "ae-" + (e.event_id || e.id || Math.random()),
    name:     e.event_name || e.name,
    category: e.interest   || e.category || "",
    date:     e.start_time || e.date || "",
    venue:    e.venue_name || e.venue || "",
    area:     e.city_area  || "Chennai",
    price:    e.ticket_price || e.price || "",
    url:      e.event_url  || e.url || "#",
    image:    e.banner_url || e.thumbnail || "",
    seats:    e.going      || e.interested || "",
    source:   "AllEvents",
  }));
}

// ── SOURCE 2: Eventbrite ──────────────────────────────────────────────────────
async function fetchEventbrite(cat) {
  const key = process.env.EVENTBRITE_API_KEY;
  if (!key) throw new Error("EVENTBRITE_API_KEY not set");

  const catMap = {
    all: "", music: "103", food: "110", art: "105",
    tech: "102", sport: "108", kids: "115",
  };

  const params = new URLSearchParams({
    "location.address":        "Chennai, India",
    "location.within":         "30km",
    "expand":                  "venue,ticket_classes",
    "sort_by":                 "date",
    "start_date.keyword":      "today",
    ...(catMap[cat] && { "categories": catMap[cat] }),
  });

  const res = await fetch(`https://www.eventbriteapi.com/v3/events/search/?${params}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Eventbrite ${res.status}`);
  const data = await res.json();

  return (data.events || []).map((e) => {
    const minPrice = e.ticket_classes?.[0]?.cost?.major_value || 0;
    return normalise({
      id:       "eb-" + e.id,
      name:     e.name?.text || "Unnamed Event",
      category: e.category_id || "",
      date:     e.start?.local || "",
      venue:    e.venue?.name  || "",
      area:     e.venue?.address?.city || "Chennai",
      price:    minPrice,
      url:      e.url || "#",
      image:    e.logo?.url || "",
      seats:    e.capacity ? e.capacity + " capacity" : "",
      source:   "Eventbrite",
    });
  });
}

// ── SOURCE 3: Meetup ──────────────────────────────────────────────────────────
async function fetchMeetup(cat) {
  const key = process.env.MEETUP_API_KEY;
  if (!key) throw new Error("MEETUP_API_KEY not set");

  // Meetup GraphQL API
  const topicMap = {
    all: "tech", music: "music", food: "food",
    art: "arts", tech: "tech", sport: "outdoors-adventure", kids: "family",
  };
  const topic = topicMap[cat] || "tech";

  const query = `{
    rankedEvents(filter: {
      query: "Chennai",
      lat: 13.0827,
      lon: 80.2707,
      radius: 30,
      topicCategoryId: "${topic}"
    }) {
      edges { node {
        id title dateTime venue { name address }
        eventUrl featuredEventPhoto { highResUrl }
        going maxTickets
        feeSettings { amount currency }
      }}
    }
  }`;

  const res = await fetch("https://api.meetup.com/gql", {
    method:  "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Meetup ${res.status}`);
  const data = await res.json();

  return (data.data?.rankedEvents?.edges || []).map(({ node: e }) => normalise({
    id:       "mu-" + e.id,
    name:     e.title || "Unnamed Meetup",
    category: topic,
    date:     e.dateTime || "",
    venue:    e.venue?.name || "",
    area:     e.venue?.address || "Chennai",
    price:    e.feeSettings?.amount || 0,
    url:      e.eventUrl || "#",
    image:    e.featuredEventPhoto?.highResUrl || "",
    seats:    e.going ? `${e.going} going` : "",
    source:   "Meetup",
  }));
}

// ── Normalise into common shape ───────────────────────────────────────────────
function normalise(e) {
  return {
    id:          e.id,
    name:        e.name || "Unnamed Event",
    category:    mapCategory(e.category),
    date:        e.date,
    dateDisplay: formatDate(e.date),
    venue:       e.venue,
    area:        e.area || "Chennai",
    price:       formatPrice(e.price),
    url:         e.url,
    image:       e.image,
    seats:       e.seats,
    source:      e.source,
  };
}

// ── Deduplicate by name similarity ────────────────────────────────────────────
function deduplicateEvents(events) {
  const seen = new Set();
  return events.filter((e) => {
    const key = e.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapCategory(raw) {
  if (!raw) return "art";
  const r = String(raw).toLowerCase();
  if (r.includes("music") || r.includes("concert") || r.includes("103")) return "music";
  if (r.includes("food")  || r.includes("drink")   || r.includes("110")) return "food";
  if (r.includes("art")   || r.includes("culture")  || r.includes("comedy") || r.includes("theatre") || r.includes("105")) return "art";
  if (r.includes("tech")  || r.includes("business") || r.includes("startup") || r.includes("102")) return "tech";
  if (r.includes("sport") || r.includes("fitness")  || r.includes("run") || r.includes("108")) return "sport";
  if (r.includes("kid")   || r.includes("family")   || r.includes("child") || r.includes("115")) return "kids";
  return "art";
}

function formatDate(raw) {
  if (!raw) return "Date TBD";
  try {
    const d = new Date(raw);
    if (isNaN(d)) return String(raw);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) +
           " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch { return String(raw); }
}

function formatPrice(raw) {
  if (!raw || raw === "0" || raw === 0) return "Free";
  if (typeof raw === "number" && raw > 0) return "₹" + raw.toLocaleString("en-IN");
  if (typeof raw === "string") {
    if (raw.toLowerCase().includes("free")) return "Free";
    if (/^\d+$/.test(raw.trim())) return "₹" + parseInt(raw).toLocaleString("en-IN");
  }
  return String(raw);
}

// ── Fallback — shown only if all 3 APIs fail ──────────────────────────────────
function fallbackEvents() {
  return [
    { id:"1", name:"Timeless Chitra Live Music Concert",  category:"music", date:"2026-07-11T18:00:00", dateDisplay:"Sat, 11 Jul · 6:00 PM", venue:"Jawaharlal Nehru Indoor Stadium", area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/timeless-chitra-live-music-concert/3900030021435630",           image:"", seats:"",             source:"Fallback" },
    { id:"2", name:"Jagane Thandhiram Musical Stand-up",  category:"art",   date:"2026-07-12T18:30:00", dateDisplay:"Sun, 12 Jul · 6:30 PM", venue:"Museum Theatre",                  area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/jagane-thandhiram-chennai/3900029816787958",                    image:"", seats:"48 interested", source:"Fallback" },
    { id:"3", name:"Namma Chennai Juniorthon – 4th Ed.",  category:"sport", date:"2026-07-12T08:00:00", dateDisplay:"Sun, 12 Jul · 8:00 AM", venue:"Nehru Park, SDAT",                area:"Chennai", price:"₹599",       url:"https://allevents.in/chennai/namma-chennai-juniorthon-4th-edition/4100029945960732",          image:"", seats:"",             source:"Fallback" },
    { id:"4", name:"Kids & Junior Athletics Meet 2026",   category:"kids",  date:"2026-07-04T07:30:00", dateDisplay:"Sat, 4 Jul · 7:30 AM",  venue:"Jawaharlal Nehru Stadium",        area:"Chennai", price:"₹500",       url:"https://allevents.in/chennai/kids-and-junior-athletics-meet-2026-tickets/80002931242302",      image:"", seats:"",             source:"Fallback" },
    { id:"5", name:"Sikkil Gurucharan Grand Concert",     category:"music", date:"2026-07-05T12:30:00", dateDisplay:"Sun, 5 Jul · 12:30 PM", venue:"Club Road, Chetpet",              area:"Chennai", price:"Check site", url:"https://allevents.in/chennai/thumbai-centre-for-arts-grand-concert-of-shri-sikkil-gurucharan/200030057428742", image:"", seats:"",             source:"Fallback" },
    { id:"6", name:"The Great Chennai Job Fair 2026",     category:"tech",  date:"2026-07-11T08:00:00", dateDisplay:"Sat, 11 Jul · 8:00 AM", venue:"Loyola College, Nungambakkam",    area:"Chennai", price:"Free",       url:"https://allevents.in/chennai/the-great-chennai-job-fair-2026/200030103211241",                   image:"", seats:"500+ companies", source:"Fallback" },
  ];
}
