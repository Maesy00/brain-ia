/*
 * home.js — onglet Accueil : la journée en un coup d'œil.
 * Météo vélo (ou week-end), horoscope Balance, affirmation et question de
 * journaling du jour, habitudes du jour à cocher et les 3 prochaines tâches.
 * La météo et l'horoscope arrivent du réseau : la carte s'affiche tout de
 * suite avec un état de chargement, puis se remplit.
 */

const Home = (() => {
  const screen = document.getElementById("screen-home");
  let weather = null; // { promise, result }
  let horoscope = null;

  function loadWeather() {
    if (!weather) {
      const state = { promise: Weather.today(), result: null };
      state.promise.then((r) => (state.result = r));
      weather = state;
    }
    return weather;
  }

  function loadHoroscope() {
    if (!horoscope) {
      const state = { promise: Horoscope.today(), result: null };
      state.promise.then((r) => (state.result = r));
      horoscope = state;
    }
    return horoscope;
  }

  // Retour sur l'app (ou nouveau jour) : on reprend la météo et l'horoscope.
  function reload() {
    weather = null;
    horoscope = null;
    Weather.reset();
    Horoscope.reset();
  }

  function render() {
    const habits = Storage.getHabits();
    const today = DateUtil.today();
    const doneCount = habits.filter((h) => Habits.isDone(h, today)).length;
    const tasks = Todo.upcoming(3);
    const more = Todo.pendingCount() - tasks.length;

    screen.innerHTML = `
      ${topbar({ title: "Brain.ia" })}
      <div class="hero">
        <p class="eyebrow">${escapeHtml(Fmt.longDay(new Date()))}</p>
        <h1 class="large-title brand">Brain<span class="brand-dot">.</span>ia</h1>
      </div>

      <div class="home-stack">
        <section class="card weather-card" data-weather></section>
        <section class="card" data-horoscope></section>

        <section class="card affirmation-card">
          <div class="card-label">${icon("sparkle")} Affirmation du jour</div>
          <p class="affirmation">${escapeHtml(Affirmations.today())}</p>
        </section>

        <section class="card">
          <div class="card-label">${icon("pencil-simple-line")} Journal du jour</div>
          <p class="journal-prompt">${escapeHtml(Journal.today())}</p>
        </section>

        <section class="card" data-habits>
          <div class="card-label">${icon("flame")} Habitudes du jour${habits.length ? `<span class="card-action num">${doneCount}/${habits.length}</span>` : ""}</div>
          ${
            habits.length
              ? `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${habits.length}" aria-valuenow="${doneCount}"><span style="width:${(doneCount / habits.length) * 100}%"></span></div>
                 <div class="home-habits"></div>`
              : `<p class="card-text">Aucune habitude pour l'instant.</p>
                 <button type="button" class="btn btn-secondary btn-sm" data-new-habit style="margin-top:var(--s-4)">${icon("plus")} Créer une habitude</button>`
          }
        </section>

        <section class="card" data-tasks>
          <div class="card-label">${icon("list-checks")} Prochaines tâches${tasks.length ? `<button type="button" class="card-action link-btn" data-all-tasks>Tout voir</button>` : ""}</div>
          ${
            tasks.length
              ? `<div class="home-tasks"></div>${more > 0 ? `<p class="card-text home-more">+ ${more} autre${more > 1 ? "s" : ""}</p>` : ""}`
              : `<p class="card-text">Rien à faire. Profite.</p>
                 <button type="button" class="btn btn-secondary btn-sm" data-all-tasks style="margin-top:var(--s-4)">${icon("plus")} Ajouter une tâche</button>`
          }
        </section>
      </div>
    `;

    const list = screen.querySelector(".home-habits");
    habits.forEach((h) => {
      const row = html(`
        <div class="home-habit">
          ${Habits.habitTile(h, "sm")}
          <span class="row-main"><span class="row-title">${escapeHtml(h.name)}</span><span class="row-sub">${escapeHtml(Habits.progressLabel(h, today))}</span></span>
        </div>
      `);
      row.appendChild(Habits.dayButton(h, today, null, "sm"));
      list.appendChild(row);
    });
    const taskList = screen.querySelector(".home-tasks");
    tasks.forEach((t) => taskList.appendChild(Todo.row(t)));

    const newHabit = screen.querySelector("[data-new-habit]");
    if (newHabit) newHabit.addEventListener("click", () => Habits.edit(null));
    screen.querySelectorAll("[data-all-tasks]").forEach((b) => b.addEventListener("click", () => App.go("todo")));

    fillWeather(screen.querySelector("[data-weather]"));
    fillHoroscope(screen.querySelector("[data-horoscope]"));
    watchLargeTitle(screen);
  }

  // ---- Météo ----

  function fillWeather(card) {
    const state = loadWeather();
    if (state.result) return paintWeather(card, state.result);
    card.innerHTML = `
      <div class="card-label">${icon("bicycle")} Météo vélo</div>
      <p class="card-text loading">Chargement de la météo…</p>
    `;
    state.promise.then((r) => card.isConnected && paintWeather(card, r));
  }

  function paintWeather(card, w) {
    if (w.error) {
      const position = w.error === "position";
      card.innerHTML = `
        <div class="card-label">${icon("bicycle")} Météo vélo</div>
        <p class="card-title">${position ? "Position inconnue" : "Météo indisponible"}</p>
        <p class="card-text">${
          position
            ? "Autorise la localisation, ou enregistre Maison et Travail dans Réglages."
            : "Open-Meteo ne répond pas pour le moment."
        }</p>
        <div class="btn-row" style="margin-top:var(--s-4)">
          <button type="button" class="btn btn-secondary btn-sm" data-retry>${icon("arrow-clockwise")} Réessayer</button>
          ${position ? `<button type="button" class="btn btn-ghost btn-sm" data-settings>Réglages</button>` : ""}
        </div>
      `;
      card.querySelector("[data-retry]").addEventListener("click", () => {
        weather = null;
        Weather.reset();
        fillWeather(card);
      });
      const settings = card.querySelector("[data-settings]");
      if (settings) settings.addEventListener("click", () => App.go("settings"));
      return;
    }

    const when = w.isTomorrow ? "demain" : "aujourd'hui";
    const label = w.mode === "weekend"
      ? `${icon("sun-horizon")} Week-end · ${escapeHtml(Fmt.weekdayLong(w.date))}${w.isTomorrow ? " (demain)" : ""}`
      : `${icon("bicycle")} Vélo · ${when}`;
    const temps = w.blocks.flatMap((b) => b.hours.map((h) => Math.round(h.temp)));
    const range = temps.length ? `${Math.min(...temps)}°–${Math.max(...temps)}°` : "";
    const levelIcon = { dry: "drop-slash", risk: "umbrella", rain: "cloud-rain" };

    card.innerHTML = `
      <div class="card-label">${label}${range ? `<span class="card-action num">${range}</span>` : ""}</div>
      ${w.blocks
        .map((b) => {
          // Une étiquette d'heure sur trois quand la frise est longue (week-end).
          const step = b.hours.length > 6 ? 3 : 1;
          return `
        <div class="wx-row">
          <div class="wx-top">
            <span class="wx-title">${escapeHtml(b.title)}<span class="wx-meta">${escapeHtml(b.slot)} · ${escapeHtml(b.place)}</span></span>
            <span class="wx-pill is-${b.verdict.level}">${icon(levelIcon[b.verdict.level], b.verdict.level === "dry" ? "regular" : "fill")}${escapeHtml(Weather.LABEL[b.verdict.level])}</span>
          </div>
          ${b.verdict.detail ? `<p class="wx-detail">${escapeHtml(b.verdict.detail)}</p>` : ""}
          <div class="wx-bar" style="--n:${b.hours.length}">
            ${b.hours
              .map(
                (h, i) => `<span class="wx-seg is-${h.level}" title="${h.hour}h · ${escapeHtml(Weather.pct(h.prob))} · ${escapeHtml(Weather.mm(h.mm))} · ${Math.round(h.temp)}°">
                  <span class="wx-tick"></span><span class="wx-hour-label num">${i % step === 0 ? `${h.hour}h` : ""}</span>
                </span>`
              )
              .join("")}
          </div>
        </div>`;
        })
        .join("")}
      ${w.missing ? `<p class="section-note wx-note">Maison ou Travail pas encore enregistrés : météo à ta position actuelle.</p>` : ""}
    `;
  }

  // ---- Horoscope ----

  function fillHoroscope(card) {
    const state = loadHoroscope();
    if (state.result) return paintHoroscope(card, state.result);
    card.innerHTML = `
      <div class="card-label">${icon("scales")} Balance · horoscope du jour</div>
      <p class="card-text loading">Chargement de l'horoscope…</p>
    `;
    state.promise.then((r) => card.isConnected && paintHoroscope(card, r));
  }

  function paintHoroscope(card, r) {
    const label = `<div class="card-label">${icon("scales")} Balance · horoscope du jour</div>`;
    if (r.status === "unavailable") {
      card.innerHTML = `
        ${label}
        <p class="card-title">Horoscope indisponible</p>
        <p class="card-text">La source ne répond pas pour le moment.</p>
        <button type="button" class="btn btn-secondary btn-sm" data-retry style="margin-top:var(--s-4)">${icon("arrow-clockwise")} Réessayer</button>
      `;
      card.querySelector("[data-retry]").addEventListener("click", () => {
        horoscope = null;
        Horoscope.reset();
        fillHoroscope(card);
      });
      return;
    }
    if (r.status === "no-translation") {
      card.innerHTML = `
        ${label}
        <p class="horoscope" lang="en">${escapeHtml(r.en)}</p>
        <p class="section-note horoscope-note">${icon("translate")} Traduction indisponible : texte original en anglais.</p>
      `;
      return;
    }
    card.innerHTML = `
      ${label}
      <p class="horoscope">${escapeHtml(r.fr)}</p>
      <details class="horoscope-original">
        <summary>Voir l'original</summary>
        <p lang="en">${escapeHtml(r.en)}</p>
      </details>
    `;
  }

  return { render, reload };
})();
