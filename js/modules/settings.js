/*
 * settings.js — onglet Réglages : thème, compte et sources des contenus du jour.
 */

const Settings = (() => {
  const screen = document.getElementById("screen-settings");

  function render() {
    screen.innerHTML = `
      ${topbar({ title: "Réglages" })}
      <div class="hero">
        <h1 class="large-title">Réglages</h1>
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
        <div class="row"><span class="row-main"><span class="row-title">Horoscope</span><span class="row-sub">freehoroscopeapi.com, traduit par MyMemory</span></span></div>
        <div class="row"><span class="row-main"><span class="row-title">Affirmations</span><span class="row-sub">Banque Brain.ia · ${Affirmations.count} phrases</span></span></div>
        <div class="row"><span class="row-main"><span class="row-title">Journal</span><span class="row-sub">Banque Brain.ia · ${Journal.count} idées</span></span></div>
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
    screen.querySelector("[data-signout]").addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      Page.popAll();
    });
    watchLargeTitle(screen);
  }

  return { render };
})();
