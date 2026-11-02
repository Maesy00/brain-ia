/*
 * habits.js — onglet Habitudes, inspiré de HabitKit : chaque habitude a
 * un nom, un pictogramme, une couleur (le point de sa pastille) et un
 * objectif (chaque jour, X fois par semaine ou N fois par jour).
 * Coche en un tap, jours passés modifiables, série en cours, carte de
 * régularité (une case par jour). Un jour manqué n'est jamais en rouge.
 */

const Habits = (() => {
  const screen = document.getElementById("screen-habits");

  const ICONS = [
    "book-open", "brain", "barbell", "person-simple-run", "person-simple-walk", "bicycle", "drop", "moon",
    "bed", "sun-horizon", "flower-lotus", "leaf", "heart", "pencil-simple", "notebook", "translate",
    "music-notes", "guitar", "paint-brush", "camera", "code", "coffee", "carrot", "pill",
    "tooth", "broom", "wallet", "device-mobile-slash", "phone-call", "users", "smiley", "sparkle",
  ];
  const COLORS = ["#ff7a59", "#f5b041", "#e9d758", "#7bc96f", "#3fb68b", "#45b5c4", "#5b8def", "#8b7cf6", "#d16ba5", "#9a8478", "#6b7a90", "#0a0a0b"];
  const GOALS = [
    { value: "daily", label: "Chaque jour" },
    { value: "weekly", label: "Par semaine" },
    { value: "multi", label: "Plusieurs/jour" },
  ];
  const CARD_WEEKS = 18;

  // ---- Règles ----

  // Ce qu'il faut atteindre un jour donné : N fois pour « plusieurs par jour », sinon une.
  const dayTarget = (h) => (h.goalType === "multi" ? h.goalCount : 1);
  const count = (h, date) => Storage.getLogCount(h.id, date);
  const isDone = (h, date) => count(h, date) >= dayTarget(h);

  function weekDoneDays(h, weekStart) {
    let n = 0;
    for (let i = 0; i < 7; i++) if (count(h, DateUtil.addDays(weekStart, i)) > 0) n++;
    return n;
  }

  // Série en cours : jours (ou semaines) d'affilée. Aujourd'hui pas encore fait ne la casse pas.
  function streak(h) {
    const today = DateUtil.today();
    let n = 0;
    if (h.goalType === "weekly") {
      let week = DateUtil.weekStart(today);
      if (weekDoneDays(h, week) < h.goalCount) week = DateUtil.addDays(week, -7);
      while (weekDoneDays(h, week) >= h.goalCount) {
        n++;
        week = DateUtil.addDays(week, -7);
      }
      return { value: n, unit: n > 1 ? "semaines" : "semaine" };
    }
    let day = isDone(h, today) ? today : DateUtil.addDays(today, -1);
    while (isDone(h, day)) {
      n++;
      day = DateUtil.addDays(day, -1);
    }
    return { value: n, unit: n > 1 ? "jours" : "jour" };
  }

  function bestStreak(h) {
    const logs = Storage.getLogs(h.id);
    if (!logs.length) return 0;
    const today = DateUtil.today();
    let best = 0;
    let run = 0;
    if (h.goalType === "weekly") {
      for (let w = DateUtil.weekStart(logs[0].date); w <= today; w = DateUtil.addDays(w, 7)) {
        run = weekDoneDays(h, w) >= h.goalCount ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    }
    for (let d = logs[0].date; d <= today; d = DateUtil.addDays(d, 1)) {
      run = isDone(h, d) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  }

  function goalLabel(h) {
    if (h.goalType === "weekly") return `${h.goalCount} fois par semaine`;
    if (h.goalType === "multi") return `${h.goalCount} fois par jour`;
    return "Chaque jour";
  }

  // Sous-titre du jour : où j'en suis par rapport à l'objectif.
  function progressLabel(h, date = DateUtil.today()) {
    if (h.goalType === "weekly") return `${weekDoneDays(h, DateUtil.weekStart(date))}/${h.goalCount} cette semaine`;
    if (h.goalType === "multi") return `${count(h, date)}/${h.goalCount} aujourd'hui`;
    const s = streak(h);
    return s.value ? `Série : ${s.value} ${s.unit}` : goalLabel(h);
  }

  // ---- Coche ----

  // Bouton du jour : case ronde (une fois) ou compteur qui tourne (plusieurs fois).
  function dayButton(h, date, onChange) {
    if (h.goalType !== "multi") {
      return checkButton(isDone(h, date), (done) => save(h, date, done ? 1 : 0, onChange), `Valider ${h.name}`);
    }
    const target = dayTarget(h);
    const btn = html(`<button type="button" class="counter-check" aria-label="${escapeHtml(h.name)} : ajouter une fois"></button>`);
    const paint = (n) => {
      btn.classList.toggle("is-done", n >= target);
      btn.innerHTML = `${ring(n, target, 44, 4)}<span class="counter-value num">${n >= target ? icon("check", "regular") : `${n}/${target}`}</span>`;
    };
    paint(count(h, date));
    // Un tap ajoute une fois ; une fois l'objectif atteint, un tap repart de zéro.
    btn.addEventListener("click", () => {
      const current = count(h, date);
      const next = current >= target ? 0 : current + 1;
      Haptic.tap();
      paint(next);
      save(h, date, next, onChange);
    });
    return btn;
  }

  async function save(h, date, value, onChange) {
    if (!(await Storage.setLogCount(h.id, date, value))) {
      showToast("Enregistrement impossible, réessaie", "warning-circle");
      App.renderAll();
      return;
    }
    if (onChange) onChange();
    // On laisse l'animation de la coche se terminer avant de tout redessiner.
    setTimeout(() => App.renderAll(), 450);
  }

  // ---- Carte de régularité ----

  // Une colonne par semaine (lundi en haut), la dernière est la semaine en cours.
  function heatmap(h, weeks, { interactive = false } = {}) {
    const today = DateUtil.today();
    const first = DateUtil.addDays(DateUtil.weekStart(today), -7 * (weeks - 1));
    const target = dayTarget(h);
    let cells = "";
    let months = "";
    let lastMonth = null;
    for (let w = 0; w < weeks; w++) {
      const monday = DateUtil.addDays(first, w * 7);
      const month = DateUtil.parse(monday).getMonth();
      months += `<span>${month !== lastMonth && w < weeks - 1 ? escapeHtml(Fmt.monthShort(monday)) : ""}</span>`;
      lastMonth = month;
      for (let d = 0; d < 7; d++) {
        const date = DateUtil.addDays(monday, d);
        if (date > today) {
          cells += `<span class="hm-cell is-future"></span>`;
          continue;
        }
        const n = count(h, date);
        const level = n >= target ? 1 : n / target;
        const style = level > 0 ? ` style="--level:${Math.max(0.3, level).toFixed(2)}"` : "";
        const tag = interactive ? "button" : "span";
        const label = interactive ? ` type="button" data-date="${date}" aria-label="${escapeHtml(Fmt.longDay(date))} : ${n} fois"` : "";
        cells += `<${tag} class="hm-cell${level > 0 ? " is-on" : ""}${date === today ? " is-today" : ""}"${label}${style}></${tag}>`;
      }
    }
    return `
      <div class="heatmap${interactive ? " is-interactive" : ""}" style="--weeks:${weeks}">
        ${interactive ? `<div class="hm-months">${months}</div>` : ""}
        <div class="hm-grid">${cells}</div>
      </div>
    `;
  }

  // ---- Onglet ----

  function render() {
    const habits = Storage.getHabits();
    const archived = Storage.getArchivedHabits();
    const today = DateUtil.today();
    const doneToday = habits.filter((h) => isDone(h, today)).length;

    screen.innerHTML = `
      ${topbar({ title: "Habitudes", trailing: `<button type="button" class="icon-btn" data-add aria-label="Nouvelle habitude">${icon("plus")}</button>` })}
      <div class="hero">
        <p class="eyebrow">${habits.length ? `${doneToday} sur ${habits.length} aujourd'hui` : escapeHtml(Fmt.longDay(new Date()))}</p>
        <h1 class="large-title">Habitudes</h1>
      </div>
      ${
        habits.length
          ? `<div class="habit-list"></div>
             <div class="btn-row" style="margin-top:var(--s-4)">
               <button type="button" class="btn btn-secondary" data-add style="flex:1">${icon("plus")} Nouvelle habitude</button>
               ${habits.length > 1 ? `<button type="button" class="btn btn-ghost" data-reorder>${icon("arrows-down-up")} Réorganiser</button>` : ""}
             </div>`
          : `<div class="empty">
               <span class="tile lg neutral">${icon("flame")}</span>
               <h2 class="card-title">Ta première habitude</h2>
               <p>Lire, méditer, boire de l'eau… Coche-la chaque jour et regarde ta carte se remplir.</p>
               <button type="button" class="btn btn-primary" data-add>${icon("plus")} Créer une habitude</button>
             </div>`
      }
      ${
        archived.length
          ? `<h3 class="section-label">Archivées</h3>
             <div class="list has-tiles">${archived
               .map(
                 (h) => `<button type="button" class="row" data-restore="${h.id}">
                   ${habitTile(h, "sm")}
                   <span class="row-main"><span class="row-title">${escapeHtml(h.name)}</span><span class="row-sub">${escapeHtml(goalLabel(h))}</span></span>
                   <span class="tag tag-neutral">Réactiver</span>
                 </button>`
               )
               .join("")}</div>
             <p class="section-note">Une habitude archivée garde tout son historique.</p>`
          : ""
      }
    `;

    const list = screen.querySelector(".habit-list");
    habits.forEach((h) => list && list.appendChild(habitCard(h, today)));

    screen.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => edit(null)));
    const reorder = screen.querySelector("[data-reorder]");
    if (reorder) reorder.addEventListener("click", openReorder);
    screen.querySelectorAll("[data-restore]").forEach((row) =>
      row.addEventListener("click", async () => {
        const h = Storage.getHabit(row.dataset.restore);
        if (await Storage.setHabitArchived(h.id, false)) {
          Haptic.tap();
          showToast(`${h.name} est de retour`);
          App.renderAll();
        }
      })
    );
    watchLargeTitle(screen);
  }

  function habitTile(h, size = "") {
    return `<span class="tile${size ? ` ${size}` : ""}" style="--dot:${escapeHtml(h.color)}">${icon(h.icon)}</span>`;
  }

  function habitCard(h, today) {
    const s = streak(h);
    const card = html(`
      <section class="card habit-card">
        <div class="habit-head">
          <button type="button" class="habit-open">
            ${habitTile(h)}
            <span class="row-main">
              <span class="row-title">${escapeHtml(h.name)}</span>
              <span class="row-sub">${escapeHtml(progressLabel(h, today))}</span>
            </span>
          </button>
          <span class="habit-check"></span>
        </div>
        <button type="button" class="habit-map" aria-label="Voir le détail de ${escapeHtml(h.name)}">${heatmap(h, CARD_WEEKS)}</button>
        ${s.value ? `<p class="habit-streak">${icon("flame", "fill")}<span class="num">${s.value}</span> ${escapeHtml(s.unit)}</p>` : ""}
      </section>
    `);
    card.querySelector(".habit-check").appendChild(dayButton(h, today));
    card.querySelector(".habit-open").addEventListener("click", () => openDetail(h.id));
    card.querySelector(".habit-map").addEventListener("click", () => openDetail(h.id));
    return card;
  }

  // ---- Détail : la carte de l'année, les séries, les jours passés ----

  function openDetail(id) {
    Page.push({
      title: Storage.getHabit(id).name,
      backLabel: "Habitudes",
      render(content, page) {
        const h = Storage.getHabit(id);
        const total = Storage.getLogs(h.id).filter((l) => l.count >= dayTarget(h)).length;
        const s = streak(h);
        let rate = 0;
        for (let i = 0; i < 30; i++) if (count(h, DateUtil.addDays(DateUtil.today(), -i)) > 0) rate++;

        content.innerHTML = `
          <div class="habit-preview">
            ${habitTile(h, "lg")}
            <div class="row-main">
              <p class="card-title">${escapeHtml(h.name)}</p>
              <p class="card-text">${escapeHtml(goalLabel(h))}</p>
            </div>
            <span class="habit-check"></span>
          </div>
          <div class="bento">
            <section class="card"><div class="card-label">${icon("flame")} Série</div><span class="metric">${s.value}</span><span class="metric-unit">${escapeHtml(s.unit)}</span></section>
            <section class="card"><div class="card-label">${icon("trophy")} Record</div><span class="metric">${bestStreak(h)}</span><span class="metric-unit">${h.goalType === "weekly" ? "sem." : "j"}</span></section>
            <section class="card"><div class="card-label">${icon("check-circle")} Réussis</div><span class="metric">${total}</span><span class="metric-unit">jours</span></section>
            <section class="card"><div class="card-label">${icon("calendar-blank")} 30 jours</div><span class="metric">${Math.round((rate / 30) * 100)}</span><span class="metric-unit">%</span></section>
          </div>
          <h3 class="section-label">Une année</h3>
          <div class="card year-card">
            <div class="year-scroll">${heatmap(h, 53, { interactive: true })}</div>
          </div>
          <p class="section-note">Touche un jour pour le cocher ou le corriger.</p>
          <div class="btn-row" style="margin-top:var(--s-6)">
            <button type="button" class="btn btn-secondary" data-edit style="flex:1">${icon("pencil-simple")} Modifier</button>
            <button type="button" class="btn btn-ghost" data-archive>${icon("archive")} Archiver</button>
          </div>
        `;

        content.querySelector(".habit-check").appendChild(dayButton(h, DateUtil.today(), () => setTimeout(() => page.refresh(), 450)));
        // La page n'est pas encore à l'écran au premier rendu : on attend une image pour défiler à la fin.
        const scroller = content.querySelector(".year-scroll");
        requestAnimationFrame(() => (scroller.scrollLeft = scroller.scrollWidth));
        content.querySelectorAll("[data-date]").forEach((cell) => cell.addEventListener("click", () => editDay(h, cell.dataset.date, page)));
        content.querySelector("[data-edit]").addEventListener("click", () => edit(h, page));
        content.querySelector("[data-archive]").addEventListener("click", async () => {
          const ok = await confirmSheet({ title: "Archiver l'habitude ?", text: `${h.name} disparaîtra de l'accueil et de la liste. Son historique est gardé : tu pourras la réactiver.`, confirmLabel: "Archiver" });
          if (!ok) return;
          if (await Storage.setHabitArchived(h.id, true)) {
            showToast(`${h.name} est archivée`, "archive");
            Page.pop();
          }
        });
      },
    });
  }

  // Corriger un jour passé : coche directe, ou compteur pour « plusieurs par jour ».
  async function editDay(h, date, page) {
    Haptic.tap();
    if (h.goalType !== "multi") {
      const next = count(h, date) > 0 ? 0 : 1;
      if (await Storage.setLogCount(h.id, date, next)) page.refresh();
      else showToast("Enregistrement impossible, réessaie", "warning-circle");
      return;
    }
    let value = count(h, date);
    const body = html(`<div><p class="card-text" style="margin:0 0 var(--s-4)">Objectif : ${h.goalCount} fois.</p><div data-stepper></div></div>`);
    body.querySelector("[data-stepper]").appendChild(stepper({ label: "Fois", value, min: 0, max: 99, size: "xl", onChange: (v) => (value = v) }).el);
    const footer = html(`<div style="display:contents"><button type="button" class="btn btn-primary btn-block">Enregistrer</button></div>`);
    const sheet = Sheet.open({ title: Fmt.longDay(date), body, footer });
    footer.querySelector("button").addEventListener("click", async () => {
      if (await Storage.setLogCount(h.id, date, value)) {
        sheet.close();
        page.refresh();
      } else showToast("Enregistrement impossible, réessaie", "warning-circle");
    });
  }

  // ---- Créer / modifier ----

  function edit(habit, page = null) {
    const draft = habit
      ? { name: habit.name, icon: habit.icon, color: habit.color, goalType: habit.goalType, goalCount: habit.goalCount }
      : { name: "", icon: ICONS[0], color: COLORS[0], goalType: "daily", goalCount: 3 };

    const body = html(`
      <div>
        <div class="habit-preview">
          <span class="preview-tile"></span>
          <div class="row-main">
            <p class="card-title preview-name"></p>
            <p class="card-text preview-goal"></p>
          </div>
        </div>
        <label class="field">
          <span class="field-label">Nom</span>
          <input class="input" type="text" maxlength="40" placeholder="Lire 20 minutes" autocomplete="off">
        </label>
        <span class="field-label">Objectif</span>
        <div data-goal></div>
        <div data-count style="margin-top:var(--s-4)"></div>
        <span class="field-label" style="margin-top:var(--s-6)">Pictogramme</span>
        <div class="picker-grid icon-grid">
          ${ICONS.map((name) => `<button type="button" data-icon="${name}" aria-label="${name}">${icon(name)}</button>`).join("")}
        </div>
        <span class="field-label" style="margin-top:var(--s-6)">Couleur</span>
        <div class="picker-grid swatch-grid">
          ${COLORS.map((c) => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join("")}
        </div>
      </div>
    `);

    const nameInput = body.querySelector(".input");
    nameInput.value = draft.name;
    const countWrap = body.querySelector("[data-count]");
    const counter = stepper({ label: "Combien de fois", value: draft.goalCount, min: 1, max: 20, onChange: (v) => ((draft.goalCount = v), paint()) });
    countWrap.appendChild(counter.el);

    function paint() {
      body.querySelector(".preview-tile").innerHTML = habitTile(draft, "lg");
      body.querySelector(".preview-name").textContent = draft.name.trim() || "Nouvelle habitude";
      body.querySelector(".preview-goal").textContent = goalLabel(draft);
      countWrap.hidden = draft.goalType === "daily";
      if (draft.goalType === "weekly" && draft.goalCount > 7) counter.set((draft.goalCount = 7));
      body.querySelectorAll("[data-icon]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.icon === draft.icon)));
      body.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === draft.color)));
    }

    body.querySelector("[data-goal]").appendChild(
      segmented(GOALS, draft.goalType, (v) => {
        draft.goalType = v;
        paint();
      })
    );
    body.querySelectorAll("[data-icon]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.icon = b.dataset.icon;
        Haptic.tap();
        paint();
      })
    );
    body.querySelectorAll("[data-color]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.color = b.dataset.color;
        Haptic.tap();
        paint();
      })
    );
    nameInput.addEventListener("input", () => {
      draft.name = nameInput.value;
      paint();
      save.disabled = !draft.name.trim();
    });

    const footer = html(`<div style="display:contents"><button type="button" class="btn btn-primary btn-block">${habit ? "Enregistrer" : "Créer l'habitude"}</button></div>`);
    const save = footer.querySelector("button");
    save.disabled = !draft.name.trim();
    save.addEventListener("click", async () => {
      save.disabled = true;
      const payload = { ...draft, name: draft.name.trim(), goalCount: draft.goalType === "daily" ? 1 : draft.goalCount };
      const ok = habit ? await Storage.updateHabit(habit.id, payload) : await Storage.addHabit(payload);
      if (!ok) {
        save.disabled = false;
        showToast("Enregistrement impossible, réessaie", "warning-circle");
        return;
      }
      Haptic.tap();
      sheet.close();
      showToast(habit ? "Habitude modifiée" : `${payload.name} ajoutée`);
      if (page) page.refresh();
      App.renderAll();
    });

    paint();
    const sheet = Sheet.open({ title: habit ? "Modifier l'habitude" : "Nouvelle habitude", body, footer });
    if (!habit) setTimeout(() => nameInput.focus(), 350);
  }

  // ---- Réorganiser (glisser-déposer par la poignée) ----

  function openReorder() {
    Page.push({
      title: "Réorganiser",
      backLabel: "Habitudes",
      render(content) {
        const order = Storage.getHabits().map((h) => h.id);
        content.innerHTML = `
          <p class="card-text" style="margin:0 4px var(--s-4)">Fais glisser une habitude par sa poignée. L'ordre est aussi celui de l'accueil.</p>
          <div class="list has-tiles reorder-list">
            ${order
              .map((id) => {
                const h = Storage.getHabit(id);
                return `<div class="row reorder-row" data-id="${id}">
                  ${habitTile(h, "sm")}
                  <span class="row-main"><span class="row-title">${escapeHtml(h.name)}</span></span>
                  <span class="drag-handle" aria-label="Déplacer ${escapeHtml(h.name)}">${icon("dots-six-vertical")}</span>
                </div>`;
              })
              .join("")}
          </div>
        `;
        enableDrag(content.querySelector(".reorder-list"), order);
      },
    });
  }

  function enableDrag(list, order) {
    const rows = () => [...list.querySelectorAll(".reorder-row")];

    list.querySelectorAll(".drag-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        const row = handle.closest(".reorder-row");
        const all = rows();
        const from = all.indexOf(row);
        const height = row.offsetHeight;
        const startY = event.clientY;
        let to = from;
        handle.setPointerCapture(event.pointerId);
        row.classList.add("is-dragging");
        list.classList.add("is-sorting");
        Haptic.tap();

        const move = (e) => {
          const dy = e.clientY - startY;
          to = Math.max(0, Math.min(all.length - 1, from + Math.round(dy / height)));
          row.style.transform = `translateY(${dy}px)`;
          all.forEach((other, i) => {
            if (other === row) return;
            const shift = i > from && i <= to ? -height : i < from && i >= to ? height : 0;
            other.style.transform = shift ? `translateY(${shift}px)` : "";
          });
        };

        const end = async () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
          row.classList.remove("is-dragging");
          list.classList.remove("is-sorting");
          all.forEach((r) => (r.style.transform = ""));
          if (to === from) return;
          if (to > from) all[to].after(row);
          else all[to].before(row);
          const [moved] = order.splice(from, 1);
          order.splice(to, 0, moved);
          Haptic.tap();
          if (!(await Storage.reorderHabits(order))) showToast("Ordre non enregistré, réessaie", "warning-circle");
        };

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      });
    });
  }

  return { render, edit, isDone, dayButton, progressLabel, habitTile };
})();
