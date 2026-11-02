/*
 * horoscope.js — horoscope Balance du jour.
 * Source : freehoroscopeapi.com (gratuit, sans clé, en anglais), traduit en
 * français par MyMemory (gratuit, sans clé, ~5 000 caractères par jour).
 * Récupéré à la première ouverture du jour puis gardé dans brain_daily.
 *
 * Jamais de texte de remplacement : si la source ne répond pas, on le dit.
 * Si seule la traduction échoue, on montre l'anglais et on retentera
 * la traduction à la prochaine ouverture.
 */

const Horoscope = (() => {
  const SOURCE = "https://freehoroscopeapi.com/api/v1/get-horoscope/daily?sign=libra&day=today";
  const KIND = "horoscope";
  let pending = null;

  async function fetchSource() {
    const response = await fetch(SOURCE);
    if (!response.ok) throw new Error(`Horoscope ${response.status}`);
    const data = await response.json();
    const text = data && data.data && data.data.horoscope;
    if (!text || typeof text !== "string") throw new Error("Horoscope vide");
    return text.trim();
  }

  // MyMemory accepte 500 octets par requête : on découpe par phrases.
  function chunks(text) {
    const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
    const out = [];
    let current = "";
    sentences.forEach((s) => {
      if ((current + s).length > 400 && current) {
        out.push(current.trim());
        current = "";
      }
      current += s;
    });
    if (current.trim()) out.push(current.trim());
    return out;
  }

  async function translate(text) {
    try {
      const parts = [];
      for (const chunk of chunks(text)) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|fr`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        const out = data && data.responseData && data.responseData.translatedText;
        if (data.responseStatus !== 200 || data.quotaFinished || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) return null;
        parts.push(out.trim());
      }
      return parts.join(" ");
    } catch {
      return null;
    }
  }

  /*
   * { status: "ok", fr, en } | { status: "no-translation", en } | { status: "unavailable" }
   */
  async function load(date) {
    let cached = await Storage.getDaily(date, KIND);
    if (cached && cached.fr) return { status: "ok", fr: cached.fr, en: cached.en };

    let en = cached && cached.en;
    if (!en) {
      try {
        en = await fetchSource();
      } catch (err) {
        console.error("Horoscope indisponible :", err.message);
        return { status: "unavailable" };
      }
    }
    const fr = await translate(en);
    await Storage.saveDaily(date, KIND, { en, fr });
    return fr ? { status: "ok", fr, en } : { status: "no-translation", en };
  }

  // Un seul chargement par ouverture de l'app, même si l'accueil se redessine :
  // on ne retente qu'avec « Réessayer » ou au retour sur l'app.
  function today() {
    if (!pending) pending = load(DateUtil.today());
    return pending;
  }

  function reset() {
    pending = null;
  }

  return { today, reset };
})();
