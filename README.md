# Tahquamenon Falls Live

A Michigan Outdoors Now flagship field tool for **Tahquamenon Falls State Park**. It combines the useful part of the existing waterfall decision engine (one clear answer) with the interaction model of the Soo Locks tool (live map + click-through operational detail), then makes both more site-specific.

## Product thesis

Tahquamenon is not one attraction. It is a nearly 50,000-acre park with two major falls areas, 35+ miles of trails, campgrounds, paddling access, an island bridge, concessions, a brewery and a river mouth on Lake Superior. The product therefore answers two questions:

1. **How good is Tahquamenon right now?**
2. **Given the conditions and the time I have, what should I actually do?**

The first answer is a transparent live score. The second is an interactive park map and time-based visit planner.

## Release benchmark — 100 points

| Dimension | Weight | Release standard |
|---|---:|---|
| Decision usefulness | 15 | First viewport answers whether conditions are worth the trip and why. |
| Live data depth + freshness | 15 | USGS, NWS and weather fallback normalized; visible freshness and source health. |
| Interactive map + POIs | 15 | Mobile-friendly map with real click targets for falls, trails, campgrounds, food, access, paddling and photo points. |
| Tahquamenon-specific depth | 10 | No generic waterfall copy; park-specific routes, facilities and site facts. |
| Explainability + provenance | 10 | Every score component and source is inspectable. Forecast rain never masquerades as current flow. |
| Mobile UX | 10 | Useful at ~390px width with no desktop-only interaction. |
| Reliability + fallbacks | 10 | Partial API failure does not break the page or fabricate a flow score. |
| Accessibility | 5 | Semantic controls, keyboard map markers, dialog labels, reduced-motion support and strong contrast. |
| Performance | 5 | Static front end, single normalized live endpoint, 5-minute edge cache. |
| Visual identity | 5 | Michigan / cedar / tannin visual language; not generic dashboard styling. |
| **Total** | **100** | **Release gate: 92/100** |

### Hard vetoes

A release fails even above 92 if any of these is true:

- A current waterfall score is shown without a fresh observed USGS discharge.
- Forecast precipitation is added to the *current* river-flow score.
- A live source fails silently or stale data is presented as current.
- The map is not usable on a phone.
- A trail line or POI is presented as survey-grade navigation when it is only a planning aid.

## Engine v2

The reusable idea from the older waterfall engine was good: synthesize flow and visitability into one decision. Tahquamenon v2 changes the hierarchy:

- **Observed USGS discharge is primary.**
- The discharge is compared with **USGS daily percentiles for the same calendar date**, so seasonal context is preserved.
- Forecast precipitation is kept in a **Next 24 Hours** outlook only.
- NWS/Open-Meteo drive trail comfort, photography and safety, not fake river flow.
- If USGS is unavailable, the tool can still describe weather but does **not** claim a current waterfall-flow score.

### Current score weights

- 46% observed river experience
- 24% trail comfort
- 18% photography conditions
- 12% safety

Severe NWS hazards cap the total score. Source failure lowers confidence.

## Live data

**USGS 04045500 — Tahquamenon River near Paradise, Michigan** supplies discharge (00060), gage height (00065), recent precipitation (00045), and daily historical statistics/percentiles. The gage is roughly 0.6 mile upstream of Upper Falls.

The **National Weather Service** supplies hourly weather and active alerts. **Open-Meteo** is a weather fallback and supplies cloud cover, 24-hour forecast precipitation, sunrise/sunset and apparent temperature. Forecast precipitation is never treated as current river flow.

## Park database

Curated points include Upper Falls, the new accessible boardwalk, Tahquamenon Falls Brewery & Pub / Camp 33, Fact Shack, Lower Falls, Ronald A. Olson Island Bridge, Lower Falls Café & Gift Shop, Portage and Hemlock campground loops, River Trail / North Country Trail corridor, Clark Lake trail connection, Lower Falls canoe/kayak launch, Rivermouth campground and boat access, and Rivermouth sunset views.

## Architecture

```text
index.html             Static UI / SEO shell
styles.css             Responsive Michigan visual system
app.js                 Live UI, map, filters, planner, share/deep links
data/places.js         Curated Tahquamenon POI database
api/live.js            Vercel serverless normalization + score engine
vercel.json            Cache/security headers
package.json           Syntax-check command only
```

No always-on Replit runtime is required. The front end uses Leaflet/OpenStreetMap and the serverless function uses Node's native fetch with no npm dependencies.

## Production verification

- `/api/live` returns HTTP 200 and includes `river.cfs`, `decision.score`, and `sourceHealth`.
- USGS timestamp is visible and fresh.
- Current-day USGS percentile is populated when the stats service is healthy.
- NWS alert card changes when active alerts are returned.
- Map filters work and `?place=upper-falls` deep-links to a selected point.
- 90-minute / half-day / full-day / hiker plans render and copy correctly.
- 390px mobile viewport has no horizontal page scroll.
- Turning off USGS produces no current river-flow score.
- Turning off NWS keeps the page useful through Open-Meteo.

## Research references

Michigan DNR Tahquamenon Falls State Park and 2025 trail maps; USGS Water Data station 04045500 and Water Services Statistics API; National Weather Service API; Tahquamenon Falls Brewery & Pub official site; Lower Tahquamenon Falls concession official site.
