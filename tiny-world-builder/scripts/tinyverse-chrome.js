// -------- Tinyverse page chrome (logo, language, home, logout) --------
(function () {
  'use strict';

  function homeUrl() {
    return '/tiny-world-builder.html';
  }

  async function syncAuthChrome() {
    const logoutBtn = document.getElementById('auth-logout-btn');
    const menuSignOut = document.getElementById('language-menu-signout');
    const loginBtn = document.getElementById('auth-login-btn-top');
    const Auth = window.TinyWorldAuth;
    const authAvailable = !!(Auth && typeof Auth.getUser === 'function');
    let loggedIn = false;
    if (authAvailable) {
      try {
        const user = await Auth.getUser();
        loggedIn = !!user;
      } catch (_) {}
    }
    if (!authAvailable) {
      if (logoutBtn) logoutBtn.hidden = true;
      if (menuSignOut) menuSignOut.hidden = true;
      if (loginBtn) loginBtn.hidden = true;
      return;
    }
    if (logoutBtn) logoutBtn.hidden = true;
    if (menuSignOut) menuSignOut.hidden = !loggedIn;
    if (loginBtn) loginBtn.hidden = loggedIn;
  }

  function wireHome() {
    const brandHomeBtn = document.getElementById('brand-home-btn');
    if (!brandHomeBtn || brandHomeBtn.__tvChromeWired) return;
    brandHomeBtn.__tvChromeWired = true;
    brandHomeBtn.addEventListener('click', function (event) {
      event.preventDefault();
      window.location.href = '/';
    });
  }

  function closeLanguageMenu() {
    const languagePicker = document.getElementById('language-picker');
    const languageTrigger = document.getElementById('language-trigger');
    const languageMenu = document.getElementById('language-menu');
    if (languagePicker) languagePicker.classList.remove('open');
    if (languageTrigger) languageTrigger.setAttribute('aria-expanded', 'false');
    if (languageMenu) languageMenu.hidden = true;
  }

  function wireLogout() {
    const menuSignOut = document.getElementById('language-menu-signout');
    if (!menuSignOut || menuSignOut.__tvChromeWired) return;
    menuSignOut.__tvChromeWired = true;
    menuSignOut.addEventListener('click', async function (event) {
      event.stopPropagation();
      closeLanguageMenu();
      const Auth = window.TinyWorldAuth;
      if (!Auth) return;
      try {
        if (typeof Auth.logout === 'function') await Auth.logout();
      } catch (_) {}
      syncAuthChrome();
    });
  }

  function wireLogin() {
    const loginBtn = document.getElementById('auth-login-btn-top');
    if (!loginBtn || loginBtn.__tvChromeWired) return;
    loginBtn.__tvChromeWired = true;
    loginBtn.addEventListener('click', function () {
      const gate = window.TinyverseAuthGate;
      if (gate && typeof gate.openLogin === 'function' && gate.openLogin()) return;
      window.location.href = homeUrl();
    });
  }

  function wireLanguagePicker() {
    const languagePicker = document.getElementById('language-picker');
    const languageTrigger = document.getElementById('language-trigger');
    const languageMenu = document.getElementById('language-menu');
    const languageCurrentFlag = document.getElementById('language-current-flag');
    const languageCurrentLabel = document.getElementById('language-current-label');
    if (!languagePicker || !languageTrigger || !languageMenu || !window.TWI18N) return;
    if (languagePicker.__tvChromeWired) return;
    languagePicker.__tvChromeWired = true;

    const languageOptions = Array.from(languageMenu.querySelectorAll('.language-option'));
    const closeLanguageMenu = function () {
      languagePicker.classList.remove('open');
      languageTrigger.setAttribute('aria-expanded', 'false');
      languageMenu.hidden = true;
    };
    const focusLanguageOption = function (direction) {
      if (!languageOptions.length) return;
      const activeElement = document.activeElement;
      const currentIndex = languageOptions.indexOf(activeElement);
      const nextIndex = currentIndex < 0
        ? Math.max(0, languageOptions.findIndex(function (btn) { return btn.classList.contains('is-active'); }))
        : (currentIndex + direction + languageOptions.length) % languageOptions.length;
      languageOptions[nextIndex].focus({ preventScroll: true });
    };
    const openLanguageMenu = function () {
      languagePicker.classList.add('open');
      languageTrigger.setAttribute('aria-expanded', 'true');
      languageMenu.hidden = false;
      focusLanguageOption(0);
    };
    const syncLanguagePicker = function () {
      const locale = window.TWI18N.locale || 'en';
      const active = languageOptions.find(function (btn) {
        return btn.getAttribute('data-lang') === locale;
      }) || languageOptions[0];
      languageOptions.forEach(function (btn) {
        const isActive = btn === active;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        if (isActive) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
      if (!active) return;
      const flag = active.querySelector('.language-flag-svg');
      const label = active.querySelector('.language-label');
      const labelText = label ? label.textContent.trim() : locale;
      if (flag && languageCurrentFlag) languageCurrentFlag.innerHTML = flag.innerHTML;
      if (languageCurrentLabel) languageCurrentLabel.textContent = labelText;
      languageTrigger.setAttribute('aria-label', 'Language: ' + labelText);
      languageTrigger.setAttribute('data-tooltip', labelText);
    };

    syncLanguagePicker();
    languageTrigger.addEventListener('click', function (event) {
      event.stopPropagation();
      if (languageMenu.hidden) openLanguageMenu();
      else closeLanguageMenu();
    });
    languageTrigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        openLanguageMenu();
      }
    });
    languageOptions.forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        const nextLocale = btn.getAttribute('data-lang');
        closeLanguageMenu();
        if (nextLocale && nextLocale !== window.TWI18N.locale) {
          window.TWI18N.setLocale(nextLocale);
        }
      });
      btn.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeLanguageMenu();
          languageTrigger.focus();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          focusLanguageOption(event.key === 'ArrowUp' ? -1 : 1);
        }
      });
    });
    document.addEventListener('click', function (event) {
      if (!languagePicker.contains(event.target)) closeLanguageMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeLanguageMenu();
    });
  }

  function wireAuthListener() {
    const Auth = window.TinyWorldAuth;
    if (!Auth || typeof Auth.onAuthChange !== 'function' || Auth.__tvChromeListener) return;
    Auth.__tvChromeListener = true;
    Auth.onAuthChange(function () {
      syncAuthChrome();
    });
  }

  function boot() {
    document.body.classList.add('tinyverse-chrome-active');
    wireHome();
    wireLogout();
    wireLogin();
    wireLanguagePicker();
    wireAuthListener();
    syncAuthChrome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.TinyverseChrome = {
    syncAuthChrome,
    homeUrl,
  };
})();