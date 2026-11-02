/*
 * home.js — onglet Accueil : la journée en un coup d'œil.
 * Horoscope Balance, affirmation et idée de journaling du jour, habitudes
 * du jour à cocher et les 3 prochaines tâches. L'horoscope arrive du réseau :
 * sa carte s'affiche tout de suite avec un état de chargement, puis se remplit.
 */

const Home = (() => {
  const screen = document.getElementById("screen-home");
  let horoscope = null;

  function loadHoroscope() {
    if (!horoscope) {
      const state = { promise: Horoscope.today(), result: null };
      state.promise.then((r) => (state.result = r));
      horoscope = state;
    }
    return horoscope;
  }

  // Retour sur l'app (ou nouveau jour) : on reprend l'horoscope.
  function reload() {
    horoscope = null;
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
        <section class="card" data-horoscope></section>

        <section class="card affirmation-card">
          <div class="card-label">${icon("sparkle")} Affirmation du jour</div>
          <p class="affirmation">${escapeHtml(Affirmations.today())}</p>
        </section>

        <section class="card">
          <div class="card-label">${icon("pencil-simple-line")} Journal du jour<button type="button" class="card-action link-btn" data-journal-next>${icon("shuffle")} Une autre</button></div>
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

    screen.querySelector("[data-journal-next]").addEventListener("click", () => {
      Haptic.tap();
      const prompt = screen.querySelector(".journal-prompt");
      prompt.classList.remove("is-new");
      prompt.textContent = Journal.another();
      void prompt.offsetWidth; // relance l'animation
      prompt.classList.add("is-new");
    });
    const newHabit = screen.querySelector("[data-new-habit]");
    if (newHabit) newHabit.addEventListener("click", () => Habits.edit(null));
    screen.querySelectorAll("[data-all-tasks]").forEach((b) => b.addEventListener("click", () => App.go("todo")));

    fillHoroscope(screen.querySelector("[data-horoscope]"));
    watchLargeTitle(screen);
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
