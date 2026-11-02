/*
 * settings.js — onglet Réglages : positions Maison / Travail (une touche,
 * sans adresse à taper), horaires vélo, seuils de pluie, thème et compte.
 */

const Settings = (() => {
  const screen = document.getElementById("screen-settings");

  function placeRow(kind) {
    const s = Storage.getSettings();
    const saved = s[`${kind}Lat`] !== null;
    const name = kind === "home" ? "Maison" : "Travail";
    return `
      <button type="button" class="row" data-place="${kind}">
        <span class="tile sm neutral">${icon(kind === "home" ? "house-line" : "briefcase")}</span>
        <span class="row-main">
          <span class="row-title">${name}</span>
          <span class="row-sub">${saved ? escapeHtml(s[`${kind}Label`] || "Position enregistrée") : "Non enregistrée"}</span>
        </span>
        <span class="tag tag-neutral">${icon("crosshair")} ${saved ? "Mettre à jour" : "Ma position"}</span>
      </button>
    `;
  }

  function render() {
    const s = Storage.getSettings();
    screen.innerHTML = `
      ${topbar({ title: "Réglages" })}
      <div class="hero">
        <h1 class="large-title">Réglages</h1>
      </div>

      <h3 class="section-label">Météo vélo</h3>
      <div class="list has-tiles">
        ${placeRow("home")}
        ${placeRow("work")}
      </div>
      <p class="section-note">Touche une ligne quand tu es sur place pour enregistrer ta position. L'aller utilise Maison, le retour Travail ; le week-end, ta position du moment.</p>

      <div class="list has-tiles" style="margin-top:var(--s-4)">
        <button type="button" class="row" data-hours>
          <span class="tile sm neutral">${icon("clock")}</span>
          <span class="row-main"><span class="row-title">Horaires vélo</span></span>
          <span class="row-value">${s.outStart}h–${s.outEnd}h · ${s.backStart}h–${s.backEnd}h</span>${icon("caret-right", "regular", "row-chevron")}
        </button>
        <button type="button" class="row" data-thresholds>
          <span class="tile sm neutral">${icon("umbrella")}</span>
          <span class="row-main"><span class="row-title">Seuils de pluie</span></span>
          <span class="row-value">${s.riskProb} % · ${s.rainProb} %</span>${icon("caret-right", "regular", "row-chevron")}
        </button>
      </div>

      <h3 class="section-label">Apparence</h3>
      <div data-theme-picker></div>

      <h3 class="section-label">Compte</h3>
      <div class="list">
        <div class="row"><span class="row-title">Email</span><span class="row-value">${escapeHtml(Storage.getUserEmail())}</span></div>
        <button type="button" class="row row-danger" data-signout><span class="row-title">Se déconnecter</span></button>
      </div>
      <p class="section-note">Le même compte que Coach.ia et Pause.</p>

      <h3 class="section-label">Sources</h3>
      <div class="list">
        <div class="row"><span class="row-main"><span class="row-title">Météo</span><span class="row-sub">Open-Meteo</span></span></div>
        <div class="row"><span class="row-main"><span class="row-title">Horoscope</span><span class="row-sub">freehoroscopeapi.com, traduit par MyMemory</span></span></div>
        <div class="row"><span class="row-main"><span class="row-title">Affirmations</span><span class="row-sub">Banque Brain.ia · ${Affirmations.count} phrases</span></span></div>
      </div>
      <p class="section-note">Tout est gratuit, sans clé ni abonnement. Brain.ia · version 1.0</p>
    `;

    screen.querySelector("[data-theme-picker]").appendChild(
      segmented(
        [
          { value: "light", label: "Clair" },
          { value: "dark", label: "Sombre" },
          { value: "auto", label: "Auto" },
        ],
        Theme.get(),
        (value) => Theme.set(value)
      )
    );
    screen.querySelectorAll("[data-place]").forEach((b) => b.addEventListener("click", () => savePlace(b.dataset.place, b)));
    screen.querySelector("[data-hours]").addEventListener("click", openHours);
    screen.querySelector("[data-thresholds]").addEventListener("click", openThresholds);
    screen.querySelector("[data-signout]").addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      Page.popAll();
    });
    watchLargeTitle(screen);
  }

  async function savePlace(kind, button) {
    const name = kind === "home" ? "Maison" : "Travail";
    button.disabled = true;
    button.querySelector(".row-sub").textContent = "Localisation…";
    const pos = await Weather.locate();
    if (!pos) {
      button.disabled = false;
      render();
      showToast("Position indisponible : autorise la localisation", "warning-circle");
      return;
    }
    const label = await Weather.placeName(pos.lat, pos.lon);
    const ok = await Storage.saveSettings({ [`${kind}Lat`]: pos.lat, [`${kind}Lon`]: pos.lon, [`${kind}Label`]: label });
    if (!ok) {
      showToast("Enregistrement impossible, réessaie", "warning-circle");
      render();
      return;
    }
    Haptic.tap();
    showToast(`${name} : ${label}`, "map-pin");
    Home.reload();
    App.renderAll();
  }

  // Une page de réglages chiffrés : steppers + Enregistrer.
  function numberPage({ title, intro, fields, note, validate }) {
    Page.push({
      title,
      backLabel: "Réglages",
      render(content) {
        const draft = { ...Storage.getSettings() };
        const defaults = Storage.getDefaultSettings();
        content.innerHTML = `
          <p class="card-text" style="margin:0 4px var(--s-5)">${intro}</p>
          ${fields.map((group) => `<span class="field-label">${escapeHtml(group.label)}</span><div class="field-row" style="margin-bottom:var(--s-5)">${group.items.map((f) => `<div data-field="${f.key}"></div>`).join("")}</div>`).join("")}
          ${note ? `<p class="section-note" style="margin-top:0">${note}</p>` : ""}
          <button type="button" class="btn btn-primary btn-block btn-lg" data-save style="margin-top:var(--s-6)">Enregistrer</button>
          <button type="button" class="btn btn-ghost btn-block" data-reset style="margin-top:var(--s-2)">Valeurs par défaut</button>
        `;
        const steppers = {};
        fields.flatMap((g) => g.items).forEach((f) => {
          steppers[f.key] = stepper({ label: f.label, value: draft[f.key], step: f.step || 1, min: f.min, max: f.max, unit: f.unit, onChange: (v) => (draft[f.key] = v) });
          content.querySelector(`[data-field="${f.key}"]`).appendChild(steppers[f.key].el);
        });
        content.querySelector("[data-reset]").addEventListener("click", () => {
          Haptic.tap();
          Object.keys(steppers).forEach((k) => {
            draft[k] = defaults[k];
            steppers[k].set(defaults[k]);
          });
        });
        content.querySelector("[data-save]").addEventListener("click", async (event) => {
          const problem = validate(draft);
          if (problem) return showToast(problem, "warning-circle");
          event.currentTarget.disabled = true;
          const changes = Object.fromEntries(Object.keys(steppers).map((k) => [k, draft[k]]));
          if (await Storage.saveSettings(changes)) {
            Haptic.tap();
            showToast(`${title} enregistrés`);
            Home.reload();
            Page.pop();
          } else {
            event.currentTarget.disabled = false;
            showToast("Enregistrement impossible, réessaie", "warning-circle");
          }
        });
      },
    });
  }

  function openHours() {
    numberPage({
      title: "Horaires vélo",
      intro: "Les créneaux où tu peux partir. La météo regarde chaque heure du créneau : 7h–10h couvre 7h, 8h et 9h.",
      fields: [
        { label: "Aller (Maison)", items: [{ key: "outStart", label: "De", min: 0, max: 23, unit: "h" }, { key: "outEnd", label: "À", min: 1, max: 24, unit: "h" }] },
        { label: "Retour (Travail)", items: [{ key: "backStart", label: "De", min: 0, max: 23, unit: "h" }, { key: "backEnd", label: "À", min: 1, max: 24, unit: "h" }] },
      ],
      validate: (d) => (d.outEnd <= d.outStart || d.backEnd <= d.backStart ? "La fin d'un créneau doit suivre son début" : d.backStart < d.outEnd ? "Le retour doit commencer après l'aller" : null),
    });
  }

  function openThresholds() {
    numberPage({
      title: "Seuils de pluie",
      intro: "Chaque heure reçoit un niveau : Sec, Risque ou Pluie. Le verdict d'un créneau est sa pire heure. Le Risque est toujours signalé.",
      fields: [
        { label: "Risque dès", items: [{ key: "riskProb", label: "Probabilité", min: 0, max: 100, step: 5, unit: "%" }, { key: "riskMm", label: "ou quantité", min: 0, max: 5, step: 0.1, unit: "mm" }] },
        { label: "Pluie si probable…", items: [{ key: "rainProb", label: "Probabilité", min: 0, max: 100, step: 5, unit: "%" }, { key: "rainMmMin", label: "et au moins", min: 0, max: 5, step: 0.1, unit: "mm" }] },
        { label: "…ou de toute façon dès", items: [{ key: "rainMm", label: "Quantité", min: 0.1, max: 10, step: 0.1, unit: "mm" }] },
      ],
      note: "Repères : 0,1–0,5 mm/h = bruine, 0,5–2,5 = pluie faible, au-delà on est trempé.",
      validate: (d) => (d.rainProb < d.riskProb ? "Le seuil Pluie doit dépasser le seuil Risque" : null),
    });
  }

  return { render };
})();
