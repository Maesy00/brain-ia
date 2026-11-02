/*
 * storage.js — seul endroit qui lit/écrit les données de Brain.ia.
 * Parle à la base Supabase en ligne (tables brain_*, synchronisées entre
 * appareils). Comme dans Coach.ia, les getters restent synchrones :
 * ils lisent un cache local mis à jour après chaque appel réseau.
 *
 * Archivage : rien n'est effacé. « Supprimer » ou « Archiver » renseigne
 * archived_at, et les éléments archivés sont exclus de l'affichage.
 */

const Storage = (() => {
  // Correspondance champ JS → colonne Supabase, par type de donnée.
  const KINDS = {
    habits: {
      table: "brain_habits",
      fields: { name: "name", icon: "icon", color: "color", goalType: "goal_type", goalCount: "goal_count", position: "position" },
      order: [["position", true], ["created_at", true]],
      keepArchived: true,
    },
    logs: {
      table: "brain_habit_logs",
      fields: { habitId: "habit_id", date: "date", count: "count" },
      order: [["date", true]],
      noArchive: true,
    },
    todos: {
      table: "brain_todos",
      fields: { title: "title", notes: "notes", dueDate: "due_date", doneAt: "done_at" },
      order: [["created_at", true]],
    },
  };

  const cache = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  let userId = null;
  let userEmail = "";

  function fromRow(kind, row) {
    const obj = { id: row.id, archivedAt: row.archived_at || null, createdAt: row.created_at };
    for (const [key, col] of Object.entries(KINDS[kind].fields)) obj[key] = row[col] ?? null;
    return obj;
  }

  // Ne convertit que les champs présents : sert aussi aux mises à jour partielles.
  function toRow(kind, obj) {
    const row = {};
    for (const [key, col] of Object.entries(KINDS[kind].fields)) {
      if (obj[key] !== undefined) row[col] = obj[key] === "" ? null : obj[key];
    }
    return row;
  }

  function sortCache(kind) {
    const { order } = KINDS[kind];
    const fields = Object.entries(KINDS[kind].fields);
    const keyOf = (col) => (col === "created_at" ? "createdAt" : fields.find(([, c]) => c === col)[0]);
    cache[kind].sort((a, b) => {
      for (const [col, asc] of order) {
        const k = keyOf(col);
        const va = a[k] ?? "";
        const vb = b[k] ?? "";
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
      }
      return 0;
    });
  }

  // Supabase renvoie 1000 lignes au plus par requête : on pagine.
  async function fetchAll(kind) {
    const { table, order, keepArchived, noArchive } = KINDS[kind];
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = supabaseClient.from(table).select("*");
      if (!keepArchived && !noArchive) query = query.is("archived_at", null);
      order.forEach(([col, asc]) => (query = query.order(col, { ascending: asc, nullsFirst: false })));
      const { data, error } = await query.range(from, from + 999);
      if (error) throw new Error(`${table} : ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows.map((r) => fromRow(kind, r));
  }

  async function load(kind) {
    try {
      cache[kind] = await fetchAll(kind);
      return true;
    } catch (err) {
      console.error("Erreur de chargement :", err.message);
      return false;
    }
  }

  async function refresh() {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    userId = user ? user.id : null;
    userEmail = user ? user.email : "";
    const results = await Promise.all(Object.keys(KINDS).map(load));
    if (results.every(Boolean)) await archiveOldDone();
    return results.every(Boolean);
  }

  // ---- Écritures génériques (le cache est mis à jour sans tout recharger) ----

  async function insert(kind, obj) {
    const { data, error } = await supabaseClient
      .from(KINDS[kind].table)
      .insert({ user_id: userId, ...toRow(kind, obj) })
      .select()
      .single();
    if (error) {
      console.error(`Erreur d'enregistrement (${kind}) :`, error.message);
      return null;
    }
    const created = fromRow(kind, data);
    cache[kind].push(created);
    sortCache(kind);
    return created;
  }

  async function update(kind, id, changes) {
    const { data, error } = await supabaseClient.from(KINDS[kind].table).update(toRow(kind, changes)).eq("id", id).select().single();
    if (error) {
      console.error(`Erreur de modification (${kind}) :`, error.message);
      return null;
    }
    const updated = fromRow(kind, data);
    const index = cache[kind].findIndex((x) => x.id === id);
    if (index >= 0) cache[kind][index] = updated;
    sortCache(kind);
    return updated;
  }

  async function setArchived(kind, id, archived) {
    const { data, error } = await supabaseClient
      .from(KINDS[kind].table)
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      console.error(`Erreur d'archivage (${kind}) :`, error.message);
      return false;
    }
    if (KINDS[kind].keepArchived) {
      const index = cache[kind].findIndex((x) => x.id === id);
      cache[kind][index] = fromRow(kind, data);
    } else {
      cache[kind] = cache[kind].filter((x) => x.id !== id);
    }
    return true;
  }

  // ---- Habitudes ----

  function addHabit(habit) {
    const position = cache.habits.reduce((max, h) => Math.max(max, h.position), -1) + 1;
    return insert("habits", { ...habit, position });
  }

  // Nouvel ordre après un glisser-déposer : seules les positions qui changent sont écrites.
  async function reorderHabits(ids) {
    const changed = ids.filter((id, index) => cache.habits.find((h) => h.id === id).position !== index);
    const results = await Promise.all(changed.map((id) => update("habits", id, { position: ids.indexOf(id) })));
    return results.every(Boolean);
  }

  function getLogCount(habitId, date) {
    const log = cache.logs.find((l) => l.habitId === habitId && l.date === date);
    return log ? log.count : 0;
  }

  // Une ligne par habitude et par jour : décocher remet le compteur à 0.
  async function setLogCount(habitId, date, count) {
    const existing = cache.logs.find((l) => l.habitId === habitId && l.date === date);
    if (existing) return Boolean(await update("logs", existing.id, { count }));
    if (count === 0) return true;
    return Boolean(await insert("logs", { habitId, date, count }));
  }

  // ---- To-do ----

  // Les tâches faites depuis plus de 7 jours quittent « Faites » (archivées, pas effacées).
  async function archiveOldDone() {
    const limit = Date.now() - 7 * 86400000;
    const old = cache.todos.filter((t) => t.doneAt && new Date(t.doneAt).getTime() < limit);
    await Promise.all(old.map((t) => setArchived("todos", t.id, true)));
  }

  // ---- Contenu du jour (horoscope) ----

  async function getDaily(date, kind) {
    const { data, error } = await supabaseClient.from("brain_daily").select("*").eq("date", date).eq("kind", kind).maybeSingle();
    if (error) {
      console.error("Erreur de lecture du contenu du jour :", error.message);
      return null;
    }
    return data ? data.payload : null;
  }

  async function saveDaily(date, kind, payload) {
    const { error } = await supabaseClient
      .from("brain_daily")
      .upsert({ user_id: userId, date, kind, payload }, { onConflict: "user_id,date,kind" });
    if (error) console.error("Erreur d'enregistrement du contenu du jour :", error.message);
    return !error;
  }

  return {
    refresh,
    getUserEmail: () => userEmail,
    getDaily,
    saveDaily,

    getHabits: () => cache.habits.filter((h) => !h.archivedAt),
    getArchivedHabits: () => cache.habits.filter((h) => h.archivedAt),
    getHabit: (id) => cache.habits.find((h) => h.id === id) || null,
    addHabit,
    updateHabit: (id, changes) => update("habits", id, changes),
    setHabitArchived: (id, archived) => setArchived("habits", id, archived),
    reorderHabits,
    getLogs: (habitId) => cache.logs.filter((l) => l.habitId === habitId && l.count > 0),
    getLogCount,
    setLogCount,

    getTodos: () => cache.todos,
    addTodo: (todo) => insert("todos", todo),
    updateTodo: (id, changes) => update("todos", id, changes),
    archiveTodo: (id) => setArchived("todos", id, true),
  };
})();
