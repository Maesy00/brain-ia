/*
 * todo.js — onglet To-do (indépendant de celui de Pause).
 * « À faire » triées par échéance, puis « Faites » : une tâche faite y reste
 * 7 jours, puis elle est archivée automatiquement (jamais effacée).
 * Une échéance dépassée est signalée sans rouge.
 */

const Todo = (() => {
  const screen = document.getElementById("screen-todo");

  // Échéance d'abord (les plus proches en haut, sans échéance à la fin), puis ordre de création.
  function pending() {
    return Storage.getTodos()
      .filter((t) => !t.doneAt)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.createdAt.localeCompare(b.createdAt));
  }

  function done() {
    return Storage.getTodos()
      .filter((t) => t.doneAt)
      .sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  }

  function dueLabel(date) {
    if (!date) return "";
    const today = DateUtil.today();
    const diff = DateUtil.daysBetween(today, date);
    if (diff === 0) return "Aujourd'hui";
    if (diff === 1) return "Demain";
    if (diff < 0) return `En retard · ${Fmt.weekdayShort(date)} ${Fmt.shortDay(date)}`;
    if (diff < 7) return Fmt.weekdayLong(date).replace(/^./, (c) => c.toUpperCase());
    return `${Fmt.weekdayShort(date)} ${Fmt.shortDay(date)}`;
  }

  async function toggle(todo, isDone) {
    const ok = await Storage.updateTodo(todo.id, { doneAt: isDone ? new Date().toISOString() : null });
    if (!ok) {
      showToast("Enregistrement impossible, réessaie", "warning-circle");
      App.renderAll();
      return;
    }
    // On laisse l'animation de la coche se terminer avant de tout redessiner.
    setTimeout(() => App.renderAll(), 450);
  }

  // Ligne de tâche, partagée avec l'accueil.
  function row(todo) {
    const due = dueLabel(todo.dueDate);
    const late = todo.dueDate && !todo.doneAt && todo.dueDate < DateUtil.today();
    const el = html(`
      <div class="row todo-row${todo.doneAt ? " is-done" : ""}">
        <span class="todo-check"></span>
        <button type="button" class="row-main todo-open">
          <span class="row-title">${escapeHtml(todo.title)}</span>
          ${
            due || todo.notes
              ? `<span class="row-sub">${due ? `<span class="todo-due${late ? " is-late" : ""}">${icon(late ? "clock-countdown" : "calendar-blank")}${escapeHtml(due)}</span>` : ""}${due && todo.notes ? " · " : ""}${todo.notes ? escapeHtml(todo.notes) : ""}</span>`
              : ""
          }
        </button>
      </div>
    `);
    const check = checkButton(Boolean(todo.doneAt), (next) => toggle(todo, next), `Terminer ${todo.title}`);
    check.classList.add("check-sm");
    el.querySelector(".todo-check").appendChild(check);
    el.querySelector(".todo-open").addEventListener("click", () => edit(todo));
    return el;
  }

  function render() {
    const todo = pending();
    const finished = done();

    screen.innerHTML = `
      ${topbar({ title: "To-do" })}
      <div class="hero">
        <p class="eyebrow">${todo.length ? `${todo.length} à faire` : "Tout est fait"}</p>
        <h1 class="large-title">To-do</h1>
      </div>
      <form class="todo-add" autocomplete="off">
        <input class="input" type="text" maxlength="120" placeholder="Nouvelle tâche" aria-label="Nouvelle tâche" enterkeyhint="done">
        <button type="submit" class="icon-btn todo-add-btn" aria-label="Ajouter">${icon("plus")}</button>
      </form>
      <h3 class="section-label">À faire</h3>
      <div class="list" data-pending>${todo.length ? "" : `<p class="empty-list">Rien à faire pour le moment.</p>`}</div>
      ${
        finished.length
          ? `<h3 class="section-label">Faites</h3>
             <div class="list" data-done></div>
             <p class="section-note">Les tâches faites restent ici 7 jours, puis sont archivées.</p>`
          : ""
      }
    `;

    todo.forEach((t) => screen.querySelector("[data-pending]").appendChild(row(t)));
    finished.forEach((t) => screen.querySelector("[data-done]").appendChild(row(t)));

    const form = screen.querySelector(".todo-add");
    const input = form.querySelector("input");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return input.focus();
      input.value = "";
      Haptic.tap();
      if (!(await Storage.addTodo({ title }))) {
        input.value = title;
        showToast("Enregistrement impossible, réessaie", "warning-circle");
        return;
      }
      App.renderAll();
      screen.querySelector(".todo-add input").focus();
    });
    watchLargeTitle(screen);
  }

  function edit(todo) {
    const draft = { title: todo.title, notes: todo.notes || "", dueDate: todo.dueDate || "" };
    const today = DateUtil.today();
    const body = html(`
      <div>
        <label class="field">
          <span class="field-label">Tâche</span>
          <input class="input" type="text" maxlength="120" data-title>
        </label>
        <label class="field">
          <span class="field-label">Note</span>
          <textarea class="input textarea" rows="3" maxlength="500" placeholder="Facultatif" data-notes></textarea>
        </label>
        <span class="field-label">Échéance</span>
        <div data-quick></div>
        <input class="input" type="date" data-due style="margin-top:var(--s-3)">
      </div>
    `);
    const title = body.querySelector("[data-title]");
    const notes = body.querySelector("[data-notes]");
    const due = body.querySelector("[data-due]");
    title.value = draft.title;
    notes.value = draft.notes;
    due.value = draft.dueDate;

    const quickValue = () => (draft.dueDate === today ? "today" : draft.dueDate === DateUtil.addDays(today, 1) ? "tomorrow" : draft.dueDate ? "date" : "none");
    const quick = choiceChips(
      [
        { value: "none", label: "Aucune" },
        { value: "today", label: "Aujourd'hui" },
        { value: "tomorrow", label: "Demain" },
        { value: "date", label: "Date…", icon: "calendar-blank" },
      ],
      quickValue(),
      (v) => {
        if (v === "none") draft.dueDate = "";
        if (v === "today") draft.dueDate = today;
        if (v === "tomorrow") draft.dueDate = DateUtil.addDays(today, 1);
        due.value = draft.dueDate;
        if (v === "date") (due.showPicker ? due.showPicker() : due.focus());
      }
    );
    body.querySelector("[data-quick]").appendChild(quick);
    due.addEventListener("change", () => {
      draft.dueDate = due.value;
      quick.querySelectorAll(".choice-chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === quickValue())));
    });

    const footer = html(`
      <div style="display:contents">
        <button type="button" class="btn btn-primary btn-block" data-save>Enregistrer</button>
        <button type="button" class="btn btn-ghost btn-block" data-delete>Supprimer la tâche</button>
      </div>
    `);
    const save = footer.querySelector("[data-save]");
    title.addEventListener("input", () => (save.disabled = !title.value.trim()));
    save.addEventListener("click", async () => {
      save.disabled = true;
      const ok = await Storage.updateTodo(todo.id, { title: title.value.trim(), notes: notes.value.trim(), dueDate: draft.dueDate || null });
      if (!ok) {
        save.disabled = false;
        showToast("Enregistrement impossible, réessaie", "warning-circle");
        return;
      }
      Haptic.tap();
      sheet.close();
      App.renderAll();
    });
    footer.querySelector("[data-delete]").addEventListener("click", async () => {
      if (await Storage.archiveTodo(todo.id)) {
        sheet.close();
        showToast("Tâche supprimée", "trash");
        App.renderAll();
      }
    });
    const sheet = Sheet.open({ title: "Modifier la tâche", body, footer });
  }

  return { render, row, upcoming: (n) => pending().slice(0, n), pendingCount: () => pending().length };
})();
