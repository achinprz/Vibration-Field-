/* VibeMon — localStorage notes, theme toggle/init, view-preference reset */

/* ===== localStorage ENABLED =====
   Browser localStorage is used for persisting:
   - Login session (AUTH_KEY) — so you don't re-login on every open
   - GSheet URL, theme preference
   Credentials (username/password) are saved separately under CREDS_KEY
   and auto-filled / auto-logged-in on app open.                       */
function toggleTheme() {
  const root = document.documentElement;
  if (root.classList.contains('theme-light')) {
    root.classList.remove('theme-light');
    localStorage.setItem('vibemon-theme', 'dark');
  } else {
    root.classList.add('theme-light');
    localStorage.setItem('vibemon-theme', 'light');
  }
}
(function initTheme() {
  const theme = localStorage.getItem('vibemon-theme') || 'dark';
  if (theme === 'light') {
    document.documentElement.classList.add('theme-light');
  } else {
    document.documentElement.classList.remove('theme-light');
  }
})();
// Always use auto view — remove any saved view preference and ensure no data-view attribute
(function(){
  localStorage.removeItem('vibemon-view');
  document.documentElement.removeAttribute('data-view');
})();
