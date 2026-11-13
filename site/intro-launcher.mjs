import { createLauncher } from './launcher-model.mjs';

const screen = document.getElementById('deviceLauncherScreen');
if (screen && window.NEO3DS_DB) {
  const launcher = createLauncher(window.NEO3DS_DB);
  const lang = document.documentElement.lang === 'ko' ? 'ko' : 'en';
  const $ = id => document.getElementById(id);
  const rows = $('launcherRows');
  const message = $('launcherMessage');
  const favorites = document.querySelectorAll('[data-launcher-action="favorite"]');

  function render(announce = false) {
    const view = launcher.view(lang);
    const game = view.selected;
    for (const tab of screen.querySelectorAll('[role="tab"]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === view.tab));
    }
    rows.replaceChildren();
    if (!view.rows.length) {
      const empty = document.createElement('p');
      empty.className = 'launcher-empty';
      empty.textContent = view.messages.empty;
      rows.append(empty);
    }
    for (const row of view.rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'launcher-row';
      button.dataset.set = row.set;
      button.setAttribute('aria-pressed', String(row.set === game?.set));
      const title = document.createElement('span');
      title.textContent = row.title;
      const mark = document.createElement('span');
      mark.textContent = `${row.favorite ? '★' : '☆'} · ${row.statusLabel}`;
      button.append(title, mark);
      rows.append(button);
    }
    $('launcherTitle').textContent = game?.title ?? view.messages.empty;
    $('launcherSubtitle').textContent = game ? [game.year, game.maker, game.statusLabel].filter(Boolean).join(' · ') : '';
    $('launcherInfoTitle').textContent = game?.title ?? view.messages.empty;
    $('launcherInfoDetails').textContent = game ? [game.year, game.maker, `${game.romMb} MB`].filter(Boolean).join(' · ') : '';
    $('launcherInfoStatus').textContent = game ? [game.statusLabel, game.note].filter(Boolean).join(' — ') : '';
    $('launcherDemo').textContent = view.messages.demo;
    for (const favorite of favorites) {
      favorite.setAttribute('aria-pressed', String(!!game?.favorite));
      favorite.disabled = !game;
    }
    for (const tab of document.querySelectorAll('[data-launcher-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.launcherTab === view.tab));
    if (announce) message.textContent = game ? `${game.title} · ${game.statusLabel} · ${game.favorite ? '★' : '☆'}` : view.messages.empty;
  }

  screen.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    const row = event.target.closest('[data-set]');
    if (tab) { launcher.setTab(tab.dataset.tab); render(true); }
    if (row) { launcher.select(row.dataset.set); render(true); screen.focus(); }
  });
  screen.addEventListener('keydown', event => {
    if (event.target.closest('[role="tab"]')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      launcher.move(event.key === 'ArrowDown' ? 1 : -1);
      render(true);
    } else if (event.key === 'Enter' && (event.target === screen || event.target.closest('[data-set]'))) {
      event.preventDefault();
      message.textContent = launcher.view(lang).messages.launch;
    }
  });
  document.querySelector('.device-col').addEventListener('click', event => {
    const action = event.target.closest('[data-launcher-action]')?.dataset.launcherAction;
    const tab = event.target.closest('[data-launcher-tab]')?.dataset.launcherTab;
    if (tab) { launcher.setTab(tab); render(true); }
    if (action === 'previous' || action === 'next') { launcher.move(action === 'next' ? 1 : -1); render(true); }
    if (action === 'favorite') { launcher.toggleFavorite(); render(true); }
    if (action === 'launch' || action === 'qr') message.textContent = launcher.view(lang).messages[action];
  });
  render();
}
