import { createLauncher } from './launcher-model.mjs';
import { DEMO_GAMES } from './demo-games.mjs';

const screen = document.getElementById('deviceLauncherScreen');
if (screen && window.NEO3DS_DB) {
  const launcher = createLauncher(window.NEO3DS_DB, DEMO_GAMES);
  const lang = document.documentElement.lang === 'ko' ? 'ko' : 'en';
  const $ = id => document.getElementById(id);
  const rows = $('launcherRows');
  const message = $('launcherMessage');
  const column = document.querySelector('.device-col');
  const panel = $('launcherPanel');
  const play = $('launcherPlay');
  const playTitle = $('launcherPlayTitle');
  const playBack = $('launcherPlayBack');
  const titleCard = $('launcherTitleCard');
  const previews = [...$('launcherTopScreen').querySelectorAll('[data-demo-id]')];
  const favorites = document.querySelectorAll('[data-launcher-action="favorite"]');
  const startAction = $('launcherStartAction');
  const backAction = $('launcherBackAction');

  const focusSelected = () => rows.querySelector('[aria-pressed="true"]')?.focus();
  const tabLabel = view => view.tab === 'all' ? 'All' : 'Fav';
  const announce = (view, retrigger = false) => {
    const text = view.playing
      ? `${view.messages.preview}: ${view.playing.title}`
      : view.selected
        ? `${tabLabel(view)} · ${view.selected.title} · ${view.selected.statusLabel} · ${view.selected.favorite ? '★' : '☆'}`
        : view.messages.empty;
    if (!retrigger) {
      message.textContent = text;
      return;
    }
    // Starting the same game twice produces the same string, which screen readers ignore,
    // so clear the live region and set it again on the next frame (#374).
    message.textContent = '';
    requestAnimationFrame(() => { message.textContent = text; });
  };

  function render(status = false) {
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
      button.dataset.id = row.id;
      button.setAttribute('aria-pressed', String(row.id === game?.id));
      const title = document.createElement('span');
      title.className = 'launcher-row-title';
      title.textContent = row.title;
      const mark = document.createElement('span');
      mark.className = 'launcher-row-meta';
      const star = document.createElement('span');
      star.className = 'launcher-star';
      star.textContent = row.favorite ? '★' : '☆';
      const status = document.createElement('span');
      status.className = 'launcher-status';
      status.textContent = row.statusLabel;
      mark.append(star, status);
      button.append(title, mark);
      rows.append(button);
    }
    $('launcherTitle').textContent = game?.title ?? view.messages.empty;
    $('launcherSubtitle').textContent = game ? [game.year, game.maker, game.statusLabel].filter(Boolean).join(' · ') : '';
    $('launcherInfoTitle').textContent = game?.title ?? view.messages.empty;
    $('launcherInfoDetails').textContent = game ? [game.year, game.maker, `${game.romMb} MB`].filter(Boolean).join(' · ') : '';
    $('launcherInfoStatus').textContent = game ? (game.note?.startsWith(game.statusLabel) && game.statusLabel ? game.note : [game.statusLabel, game.note].filter(Boolean).join(' — ')) : '';
    $('launcherDemo').textContent = view.messages.demo;
    for (const favorite of favorites) {
      favorite.setAttribute('aria-pressed', String(!!game?.favorite));
      favorite.disabled = !game;
    }

    const playing = view.playing;
    panel.hidden = !!playing;
    play.hidden = !playing;
    playTitle.textContent = playing?.title ?? '';
    titleCard.hidden = !!playing;
    for (const preview of previews) preview.hidden = !(playing && preview.dataset.demoId === playing.id);
    startAction.hidden = !!playing;
    startAction.disabled = !game;
    backAction.hidden = !playing;

    if (status) announce(view);
  }

  function start() {
    const view = launcher.start(lang);
    render();
    if (!view.playing) return;
    announce(view, true);
    playBack.focus();
  }

  function back() {
    const view = launcher.back(lang);
    render();
    message.textContent = view.messages.returned;
    // Every back path (physical B, info Back, Escape) restores focus to the selected row.
    focusSelected();
  }

  // `keyboard` only moves focus for keyboard navigation; a pointer click on the D-pad,
  // L/R or the info-panel buttons must not pull focus into the row list (#374).
  function run(action, keyboard = false) {
    const view = launcher.view(lang);
    if (view.playing) {
      if (action === 'back') back();
      return;
    }
    if (action === 'up' || action === 'down') {
      launcher.move(action === 'down' ? 1 : -1);
      render(true);
      if (keyboard) focusSelected();
    } else if (action === 'first' || action === 'last') {
      launcher[action]();
      render(true);
      if (keyboard) focusSelected();
    } else if (action === 'tab-all' || action === 'tab-fav') {
      launcher.setTab(action === 'tab-all' ? 'all' : 'fav');
      render(true);
    } else if (action === 'favorite') {
      launcher.toggleFavorite();
      render(true);
    } else if (action === 'start') {
      start();
    }
  }

  // One click handler for the whole device column: rows, tabs, shell buttons and the
  // info-panel actions are all handled here so a click never fires twice.
  column.addEventListener('click', event => {
    const row = event.target.closest('[data-id]');
    if (row) {
      launcher.select(row.dataset.id);
      render(true);
      focusSelected();
      return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      launcher.setTab(tab.dataset.tab);
      render(true);
      return;
    }
    const action = event.target.closest('[data-launcher-action]')?.dataset.launcherAction;
    if (action) run(action);
  });

  // Keyboard list navigation is scoped to the bottom screen so arrow keys on links in the
  // info panel still scroll the page (#374).
  screen.addEventListener('keydown', event => {
    if (launcher.view(lang).playing) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      run(event.key === 'ArrowDown' ? 'down' : 'up', true);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      run(event.key === 'ArrowLeft' ? 'tab-all' : 'tab-fav', true);
      return;
    }
    if (event.key === 'Enter' && (event.target === screen || event.target.closest('[data-id]'))) {
      event.preventDefault();
      run('start', true);
    }
  });

  // Escape leaves the playing view from anywhere on the page, not only inside .device-col.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !launcher.view(lang).playing) return;
    event.preventDefault();
    back();
  });

  render();
}
