-- Brain.ia — tables Supabase.
-- À exécuter dans l'éditeur SQL du projet Supabase « Divers.ia » (ex-Aurora,
-- le même que pour Coach.ia, Pause, Ironly et Osmosy : même compte de connexion).
-- Tables préfixées "brain_" : aucun risque pour les données des autres apps.
-- Le script peut être relancé sans danger (if not exists partout).
--
-- Archivage (comme dans Coach.ia et Pause) : rien n'est effacé, « Supprimer »
-- renseigne archived_at et l'élément est simplement masqué.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Habitudes
-- goal_type : 'daily' (chaque jour), 'weekly' (goal_count fois par semaine),
-- 'multi' (goal_count fois par jour). color = le point de la pastille.
-- ---------------------------------------------------------------------------

create table if not exists brain_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null,
  color text not null,
  goal_type text not null default 'daily' check (goal_type in ('daily', 'weekly', 'multi')),
  goal_count smallint not null default 1 check (goal_count between 1 and 20),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table brain_habits enable row level security;

-- Chacun ne peut lire/écrire que ses propres données (pas de suppression : on archive).
drop policy if exists "brain_habits_select_own" on brain_habits;
drop policy if exists "brain_habits_insert_own" on brain_habits;
drop policy if exists "brain_habits_update_own" on brain_habits;
create policy "brain_habits_select_own" on brain_habits for select using (auth.uid() = user_id);
create policy "brain_habits_insert_own" on brain_habits for insert with check (auth.uid() = user_id);
create policy "brain_habits_update_own" on brain_habits for update using (auth.uid() = user_id);

-- Une ligne par habitude et par jour ; décocher remet count à 0 (rien n'est effacé).
create table if not exists brain_habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references brain_habits(id) on delete cascade,
  date date not null,
  count smallint not null default 1 check (count between 0 and 99),
  created_at timestamptz not null default now(),
  unique (habit_id, date)
);

create index if not exists brain_habit_logs_user_date on brain_habit_logs (user_id, date);

alter table brain_habit_logs enable row level security;

drop policy if exists "brain_habit_logs_select_own" on brain_habit_logs;
drop policy if exists "brain_habit_logs_insert_own" on brain_habit_logs;
drop policy if exists "brain_habit_logs_update_own" on brain_habit_logs;
create policy "brain_habit_logs_select_own" on brain_habit_logs for select using (auth.uid() = user_id);
create policy "brain_habit_logs_insert_own" on brain_habit_logs for insert with check (auth.uid() = user_id);
create policy "brain_habit_logs_update_own" on brain_habit_logs for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- To-do (indépendante de celle de Pause)
-- Les tâches faites restent 7 jours dans « Faites », puis l'app les archive.
-- ---------------------------------------------------------------------------

create table if not exists brain_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  due_date date,
  done_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table brain_todos enable row level security;

drop policy if exists "brain_todos_select_own" on brain_todos;
drop policy if exists "brain_todos_insert_own" on brain_todos;
drop policy if exists "brain_todos_update_own" on brain_todos;
create policy "brain_todos_select_own" on brain_todos for select using (auth.uid() = user_id);
create policy "brain_todos_insert_own" on brain_todos for insert with check (auth.uid() = user_id);
create policy "brain_todos_update_own" on brain_todos for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Contenu du jour mis en cache (horoscope) : récupéré à la première
-- ouverture du jour, relu ensuite. payload = { en, fr }.
-- ---------------------------------------------------------------------------

create table if not exists brain_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, date, kind)
);

alter table brain_daily enable row level security;

drop policy if exists "brain_daily_select_own" on brain_daily;
drop policy if exists "brain_daily_insert_own" on brain_daily;
drop policy if exists "brain_daily_update_own" on brain_daily;
create policy "brain_daily_select_own" on brain_daily for select using (auth.uid() = user_id);
create policy "brain_daily_insert_own" on brain_daily for insert with check (auth.uid() = user_id);
create policy "brain_daily_update_own" on brain_daily for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Réglages (une ligne par utilisateur) : positions Maison / Travail,
-- créneaux vélo (heures pleines, fin exclue : 7–10 = 7h, 8h, 9h) et seuils de pluie.
-- Sec < risk_prob % et < risk_mm mm ; Pluie si (≥ rain_prob % et ≥ rain_mm_min mm)
-- ou ≥ rain_mm mm ; sinon Risque.
-- ---------------------------------------------------------------------------

create table if not exists brain_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home_lat double precision,
  home_lon double precision,
  home_label text,
  work_lat double precision,
  work_lon double precision,
  work_label text,
  out_start smallint not null default 7 check (out_start between 0 and 23),
  out_end smallint not null default 10 check (out_end between 1 and 24),
  back_start smallint not null default 17 check (back_start between 0 and 23),
  back_end smallint not null default 20 check (back_end between 1 and 24),
  risk_prob smallint not null default 30 check (risk_prob between 0 and 100),
  risk_mm numeric(4, 2) not null default 0.1,
  rain_prob smallint not null default 60 check (rain_prob between 0 and 100),
  rain_mm_min numeric(4, 2) not null default 0.5,
  rain_mm numeric(4, 2) not null default 1,
  updated_at timestamptz not null default now()
);

alter table brain_settings enable row level security;

drop policy if exists "brain_settings_select_own" on brain_settings;
drop policy if exists "brain_settings_insert_own" on brain_settings;
drop policy if exists "brain_settings_update_own" on brain_settings;
create policy "brain_settings_select_own" on brain_settings for select using (auth.uid() = user_id);
create policy "brain_settings_insert_own" on brain_settings for insert with check (auth.uid() = user_id);
create policy "brain_settings_update_own" on brain_settings for update using (auth.uid() = user_id);
