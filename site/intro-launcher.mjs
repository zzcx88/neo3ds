import { createLauncher } from './launcher-model.mjs';

const screen = document.getElementById('deviceLauncherScreen');
if (screen && window.NEO3DS_DB) {
  const launcher = createLauncher(window.NEO3DS_DB);
  const lang = document.documentElement.lang === 'ko' ? 'ko' : 'en';
  const $ = id => document.getElementById(id);
  const rows = $('launcherRows');
  const message = $('launcherMessage');
  const notice = $('launcherNotice');
  const column = document.querySelector('.device-col');
  const titleCard = $('launcherTitleCard');
  const previews = [...$('launcherTopScreen').querySelectorAll('[data-preview-set]')];
  const favorites = document.querySelectorAll('[data-launcher-action="favorite"]');

  const focusSelected = () => rows.querySelector('[aria-pressed="true"]')?.focus();
  const tabLabel = view => view.tab === 'all' ? 'All' : 'Fav';
  const announce = (text, retrigger = false) => {
    if (!retrigger) {
      message.textContent = text;
      return;
    }
    // Pressing A/START twice produces the same string, which screen readers ignore,
    // so clear the live region and set it again on the next frame (#374).
    message.textContent = '';
    requestAnimationFrame(() => { message.textContent = text; });
  };
  const announceSelection = view => {
    announce(view.selected
      ? `${tabLabel(view)} · ${view.selected.title} · ${view.selected.statusLabel} · ${view.selected.favorite ? '★' : '☆'}`
      : view.messages.empty);
  };

  // The catalog note repeats the status label ("Verified · full speed"); the fixed status line
  // already says it, so only the remainder scrolls (#378).
  const noteBody = game => {
    if (!game?.note) return '';
    const rest = game.statusLabel && game.note.startsWith(game.statusLabel)
      ? game.note.slice(game.statusLabel.length)
      : game.note;
    return rest.replace(/^\s*·\s*/, '');
  };

  function render(status = false) {
    const view = launcher.view(lang);
    const game = view.selected;
    for (const tab of screen.querySelectorAll('[role="tab"]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === view.tab));
    }
    $('launcherCountAll').textContent = view.counts.all;
    $('launcherCountFav').textContent = view.counts.fav;
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
      const star = document.createElement('span');
      star.className = row.favorite ? 'launcher-star is-fav' : 'launcher-star';
      star.setAttribute('aria-hidden', 'true');
      star.textContent = row.favorite ? '★' : '☆';
      const title = document.createElement('span');
      title.className = 'launcher-row-title';
      title.textContent = row.title;
      button.append(star, title);
      rows.append(button);
    }
    $('launcherTitle').textContent = game?.title ?? view.messages.empty;
    $('launcherInfoTitle').textContent = game?.title ?? view.messages.empty;
    $('launcherInfoDetails').textContent = game ? [game.year, game.maker, `${game.romMb} MB`].filter(Boolean).join(' · ') : '';
    $('launcherInfoStatus').textContent = game?.statusLabel ?? '';
    $('launcherNote').textContent = noteBody(game);
    for (const favorite of favorites) {
      favorite.setAttribute('aria-pressed', String(!!game?.favorite));
      favorite.disabled = !game;
    }

    // The top screen shows gameplay for the five catalog sets that have a real screenshot;
    // every other selection keeps the title card (#378).
    titleCard.hidden = !!game?.image;
    for (const preview of previews) preview.hidden = !(game?.image && preview.dataset.previewSet === game.id);

    if (status) announceSelection(view);
  }

  // A/START is the only action that cannot run in a browser: say so, in the panel and in the
  // live region, without pretending to launch anything (#378).
  function playNotice() {
    const { messages } = launcher.view(lang);
    notice.textContent = messages.launch;
    notice.hidden = false;
    announce(messages.launch, true);
  }

  // `keyboard` only moves focus for keyboard navigation; a pointer click on the D-pad or
  // L/R must not pull focus into the row list (#374).
  function run(action, keyboard = false) {
    const reset = () => { notice.hidden = true; };
    if (action === 'up' || action === 'down') {
      launcher.move(action === 'down' ? 1 : -1);
      reset();
      render(true);
      if (keyboard) focusSelected();
    } else if (action === 'first' || action === 'last') {
      launcher[action]();
      reset();
      render(true);
      if (keyboard) focusSelected();
    } else if (action === 'tab-all' || action === 'tab-fav') {
      launcher.setTab(action === 'tab-all' ? 'all' : 'fav');
      reset();
      render(true);
    } else if (action === 'favorite') {
      launcher.toggleFavorite();
      reset();
      render(true);
    } else if (action === 'play') {
      playNotice();
    }
  }

  // One click handler for the whole device column: rows, tabs and shell buttons are all
  // handled here so a click never fires twice.
  column.addEventListener('click', event => {
    const row = event.target.closest('[data-id]');
    if (row) {
      notice.hidden = true;
      launcher.select(row.dataset.id);
      render(true);
      focusSelected();
      return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      launcher.setTab(tab.dataset.tab);
      notice.hidden = true;
      render(true);
      return;
    }
    const action = event.target.closest('[data-launcher-action]')?.dataset.launcherAction;
    if (action) run(action);
  });

  // Keyboard list navigation is scoped to the bottom screen so arrow keys on links in the
  // info panel still scroll the page (#374).
  screen.addEventListener('keydown', event => {
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
      run('play');
    }
  });

  render();
}
