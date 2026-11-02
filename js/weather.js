/*
 * weather.js — météo heure par heure (Open-Meteo : gratuit, sans clé) et
 * verdict pluie à trois niveaux pour les trajets à vélo.
 *
 * Par heure : Pluie si (probabilité ≥ rainProb et ≥ rainMmMin mm) ou ≥ rainMm mm ;
 * sinon Risque si probabilité ≥ riskProb ou ≥ riskMm mm ; sinon Sec.
 * Le Risque est toujours signalé, jamais masqué. Les créneaux sont en heures
 * pleines, fin exclue : 7–10 = 7h, 8h et 9h.
 */

const Weather = (() => {
  const RANK = { dry: 0, risk: 1, rain: 2 };
  const LABEL = { dry: "Sec", risk: "Risque", rain: "Pluie" };
  const WEEKEND_START = 7;
  const WEEKEND_END = 22;
  const forecasts = new Map(); // "lat,lon" → { at, promise }
  let currentPosition = null;

  function level(hour, s) {
    const p = hour.prob ?? 0;
    const mm = hour.mm ?? 0;
    if ((p >= s.rainProb && mm >= s.rainMmMin) || mm >= s.rainMm) return "rain";
    if (p >= s.riskProb || mm >= s.riskMm) return "risk";
    return "dry";
  }

  // Pictogramme d'une heure : pluie et risque d'abord, sinon le ciel.
  function hourIcon(hour) {
    if (hour.level === "rain") return "cloud-rain";
    if (hour.level === "risk") return "umbrella";
    const c = hour.code ?? 0;
    if (c <= 1) return "sun";
    if (c === 2) return "cloud-sun";
    if (c === 45 || c === 48) return "cloud-fog";
    return "cloud";
  }

  // ---- Positions ----

  function locate() {
    if (currentPosition && Date.now() - currentPosition.at < 15 * 60 * 1000) return Promise.resolve(currentPosition);
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() };
          resolve(currentPosition);
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  // Nom de la ville pour une position (gratuit, sans clé) ; à défaut, les coordonnées.
  async function placeName(lat, lon) {
    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=fr`;
      const data = await (await fetch(url)).json();
      return data.city || data.locality || coords(lat, lon);
    } catch {
      return coords(lat, lon);
    }
  }

  function coords(lat, lon) {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }

  // ---- Prévisions ----

  async function fetchForecast(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: "precipitation_probability,precipitation,temperature_2m,weather_code",
      timezone: "auto",
      forecast_days: "3",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
    const data = await response.json();
    const h = data.hourly;
    return h.time.map((time, i) => ({
      date: time.slice(0, 10),
      hour: Number(time.slice(11, 13)),
      prob: h.precipitation_probability[i],
      mm: h.precipitation[i],
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
    }));
  }

  // Une prévision par lieu, gardée 15 minutes.
  function forecast(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = forecasts.get(key);
    if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.promise;
    const promise = fetchForecast(lat, lon);
    forecasts.set(key, { at: Date.now(), promise });
    promise.catch(() => forecasts.delete(key));
    return promise;
  }

  // ---- Verdicts ----

  function slice(hours, date, start, end, s) {
    return hours
      .filter((h) => h.date === date && h.hour >= start && h.hour < end)
      .map((h) => ({ ...h, level: level(h, s) }));
  }

  // Heures consécutives regroupées : [8] → « 8h » ; [18, 19] → « 18h–20h ».
  function ranges(hours) {
    const out = [];
    hours.forEach((h) => {
      const last = out[out.length - 1];
      if (last && h.hour === last.to) last.to = h.hour + 1;
      else out.push({ from: h.hour, to: h.hour + 1 });
    });
    return out.map((r) => (r.to - r.from === 1 ? `vers ${r.from}h` : `${r.from}h–${r.to}h`));
  }

  const pct = (v) => `${Math.round(v ?? 0)} %`;
  const mm = (v) => `${Fmt.number(Math.round((v ?? 0) * 10) / 10)} mm`;

  // Verdict d'un créneau = la pire heure, avec les heures concernées.
  function verdict(hours) {
    if (!hours.length) return { level: "dry", text: "Pas de prévision" };
    const worst = hours.reduce((w, h) => (RANK[h.level] > RANK[w] ? h.level : w), "dry");
    if (worst === "dry") return { level: "dry", text: "Sec" };
    const hit = hours.filter((h) => h.level === worst);
    const maxProb = Math.max(...hit.map((h) => h.prob ?? 0));
    const maxMm = Math.max(...hit.map((h) => h.mm ?? 0));
    return { level: worst, text: `${LABEL[worst]} ${ranges(hit).join(", ")} · ${pct(maxProb)} · ${mm(maxMm)}` };
  }

  // Résumé d'une journée de week-end : les plages Pluie puis Risque.
  function daySummary(hours) {
    const parts = ["rain", "risk"]
      .map((lvl) => {
        const hit = hours.filter((h) => h.level === lvl);
        return hit.length ? `${LABEL[lvl]} ${ranges(hit).join(", ")}` : "";
      })
      .filter(Boolean);
    const worst = hours.reduce((w, h) => (RANK[h.level] > RANK[w] ? h.level : w), "dry");
    return { level: worst, text: parts.length ? parts.join(" · ") : "Sec toute la journée" };
  }

  // Le jour affiché : aujourd'hui, ou demain une fois le dernier créneau passé.
  function targetDay(s) {
    const now = new Date();
    const today = DateUtil.today();
    const weekend = DateUtil.weekday(today) >= 5;
    const lastHour = weekend ? WEEKEND_END : s.backEnd;
    return now.getHours() >= lastHour ? DateUtil.addDays(today, 1) : today;
  }

  /*
   * Tout ce que la carte météo de l'accueil affiche.
   * { date, isTomorrow, mode: "commute" | "weekend", blocks: [...] } ou { error }
   */
  async function today() {
    const s = Storage.getSettings();
    const date = targetDay(s);
    const isTomorrow = date !== DateUtil.today();
    const weekend = DateUtil.weekday(date) >= 5;

    if (weekend) {
      const here = await locate();
      const place = here || (s.homeLat !== null ? { lat: s.homeLat, lon: s.homeLon } : null);
      if (!place) return { error: "position" };
      try {
        const hours = slice(await forecast(place.lat, place.lon), date, WEEKEND_START, WEEKEND_END, s);
        return { date, isTomorrow, mode: "weekend", blocks: [{ title: "Toute la journée", place: here ? "Ta position" : s.homeLabel || "Maison", hours, verdict: daySummary(hours) }] };
      } catch {
        return { error: "network" };
      }
    }

    const needsHere = s.homeLat === null || s.workLat === null;
    const here = needsHere ? await locate() : null;
    const home = s.homeLat !== null ? { lat: s.homeLat, lon: s.homeLon, label: s.homeLabel || "Maison" } : here && { ...here, label: "Ta position" };
    const work = s.workLat !== null ? { lat: s.workLat, lon: s.workLon, label: s.workLabel || "Travail" } : here && { ...here, label: "Ta position" };
    if (!home || !work) return { error: "position" };
    try {
      const [homeHours, workHours] = await Promise.all([forecast(home.lat, home.lon), forecast(work.lat, work.lon)]);
      const out = slice(homeHours, date, s.outStart, s.outEnd, s);
      const back = slice(workHours, date, s.backStart, s.backEnd, s);
      return {
        date,
        isTomorrow,
        mode: "commute",
        missing: needsHere,
        blocks: [
          { title: `Aller · ${s.outStart}h–${s.outEnd}h`, place: home.label, hours: out, verdict: verdict(out) },
          { title: `Retour · ${s.backStart}h–${s.backEnd}h`, place: work.label, hours: back, verdict: verdict(back) },
        ],
      };
    } catch {
      return { error: "network" };
    }
  }

  function reset() {
    forecasts.clear();
  }

  return { today, locate, placeName, hourIcon, reset, LABEL, pct, mm };
})();
