/* ---------- shoot planner ----------
   Asks the phone where it is (only when the button is tapped), pulls a forecast and the year's weather so far from
   Open-Meteo (free, no key), and gives the next few days a plain rating for infrared shooting plus a light setting to
   use in Digital Aerochrome. Foliage state is an estimate from temperature and day length, not a measurement.
   Nothing is stored and nothing is sent anywhere but Open-Meteo, rounded to about a kilometre. */
const PL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function plDoy(d) { return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5); }
function plNoonHeight(lat, doy) {
  const dec = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365);
  return 90 - Math.abs(lat - dec);
}
/* Where the leaves are. Spring: growing degree days (above 5 C) since 1 January. Autumn: cool-day degrees (below 10 C)
   since 1 September. Southern hemisphere: shift the calendar by half a year. */
function plFoliage(lat, doyNow, history) {
  const sh = lat < 0, doy = sh ? (doyNow + 182) % 365 : doyNow;
  const temps = history.temps;    // daily means, oldest first, starting 1 Jan (or 1 Jul in the south)
  if (doy < 200) {
    let gdd = 0; temps.forEach(t => { if (t > 5) gdd += t - 5; });
    if (gdd < 80) return { state: 'Bare or just budding', score: 0 };
    if (gdd < 250) return { state: 'Leaves coming out', score: 1 };
    return { state: 'Full leaf', score: 2 };
  }
  let cool = 0; const from = Math.max(0, temps.length - (doy - 244));
  temps.slice(from).forEach(t => { if (t < 10) cool += 10 - t; });
  if (doy < 244 || cool < 40) return { state: 'Full leaf', score: 2 };
  if (cool < 120) return { state: 'Starting to turn', score: 2 };
  if (cool < 220) return { state: 'Turning and dropping', score: 1 };
  return { state: 'Mostly bare', score: 0 };
}
function plRate(d, lat) {
  const frac = d.daylight > 0 ? d.sun / d.daylight : 0;
  const high = plNoonHeight(lat, d.doy);
  let rating, light;
  if (d.rain >= 3) rating = 'Poor';
  else if (frac >= 0.5) rating = 'Good';
  else if (frac >= 0.2) rating = 'Fair';
  else rating = 'Poor';
  if (frac >= 0.35) light = high < 25 ? 'Low sun' : 'Sun, midday';
  else light = 'Overcast';
  return { rating, light, frac, high };
}
async function plRun() {
  const out = $('plOut'), btn = $('plGo');
  out.textContent = '';
  if (!navigator.geolocation) { out.textContent = 'This browser cannot give a location.'; return; }
  btn.disabled = true; out.textContent = 'Asking for your location…';
  try {
    const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 15000, maximumAge: 600000 }));
    const lat = Math.round(pos.coords.latitude * 100) / 100, lon = Math.round(pos.coords.longitude * 100) / 100;
    out.textContent = 'Fetching the forecast…';
    const now = new Date(), y = now.getFullYear(), sh = lat < 0;
    const start = sh ? new Date(y - (now.getMonth() < 6 ? 1 : 0), 6, 1) : new Date(y, 0, 1);
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const back = new Date(now - 7 * 864e5);
    const base = '&latitude=' + lat + '&longitude=' + lon + '&timezone=auto';
    const [fc, hs] = await Promise.all([
      fetch('https://api.open-meteo.com/v1/forecast?daily=sunshine_duration,daylight_duration,precipitation_sum,temperature_2m_mean&past_days=7&forecast_days=5' + base).then(r => r.json()),
      fetch('https://archive-api.open-meteo.com/v1/archive?daily=temperature_2m_mean&start_date=' + iso(start) + '&end_date=' + iso(back) + base).then(r => r.json())
    ]);
    const f = fc.daily, temps = (hs.daily.temperature_2m_mean || []).filter(v => v != null);
    // last week from the forecast service fills the archive's gap
    for (let i = 0; i < 7; i++) if (f.temperature_2m_mean[i] != null) temps.push(f.temperature_2m_mean[i]);
    const fol = plFoliage(lat, plDoy(now), { temps });
    const rows = [];
    for (let i = 7; i < f.time.length; i++) {
      const dt = new Date(f.time[i] + 'T12:00:00');
      rows.push(Object.assign({ label: i === 7 ? 'Today' : PL_DAYS[dt.getDay()], when: dt }, plRate({
        sun: f.sunshine_duration[i], daylight: f.daylight_duration[i], rain: f.precipitation_sum[i], doy: plDoy(dt) }, lat)));
    }
    let h = '<p class="plFol"><b>Foliage (estimate):</b> ' + fol.state + (fol.score === 0 ? ' — not much for infrared to work with yet.' : fol.score === 2 ? ' — good for the red-leaf look.' : '.') + '</p><div class="plRows">';
    rows.forEach(r => {
      h += '<div class="plRow"><span class="plDay">' + r.label + '</span><span class="plRate pl' + r.rating + '">' + r.rating + '</span>'
        + '<span class="plInfo">' + Math.round(r.frac * 100) + '% sun · noon sun ' + Math.round(r.high) + '° · light: ' + r.light + '</span></div>';
    });
    out.innerHTML = h + '</div><p class="plNote">Forecast and weather history from Open-Meteo. Foliage is estimated from temperature, so treat it as a guide.</p>';
  } catch (e) {
    out.textContent = (e && e.code === 1) ? 'Location was not allowed, so there is nothing to forecast for.' : 'Could not get the forecast just now. Check the connection and try again.';
  } finally { btn.disabled = false; }
}
if ($('plGo')) $('plGo').onclick = plRun;
