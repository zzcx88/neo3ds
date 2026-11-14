import { createLauncher } from './launcher-model.mjs';

const screen = document.getElementById('deviceLauncherScreen');
export let launcherReady = false;
if (screen && window.NEO3DS_DB) {
  const launcher = createLauncher(window.NEO3DS_DB);
  const $ = id => document.getElementById(id);
  const rows = $('launcherRows');
  const message = $('launcherMessage');
  const notice = $('launcherNotice');
  const column = document.querySelector('.device-col');
  const titleCard = $('launcherTitleCard');
  const playTop = $('launcherPlayTop');
  const panel = $('launcherPanel');
  const ingamePanel = $('ingamePanel');
  const back = $('launcherBack');
  const previews = [...$('launcherTopScreen').querySelectorAll('[data-preview-set]')];
  const favorites = document.querySelectorAll('[data-launcher-action="favorite"]');
  const ingameTitle = $('ingameTitle');
  const ingameStatus = $('ingameStatus');
  const ingameLabels = {
    turbo: $('ingameTurbo'),
    system: $('ingameSystem'),
    service: $('ingameService'),
    slot: $('ingameSlot'),
    load: $('ingameLoad'),
    list: $('ingameGameList'),
  };

  const focusSelected = () => rows.querySelector('[aria-pressed="true"]')?.focus();
  const tabLabel = view => view.tab === 'all' ? 'All' : 'Fav';
  const announce = (text) => {
    if (message.textContent === text) {
      // The same sentence twice (A, B, A) is ignored by screen readers, so clear it first (#374).
      message.textContent = '';
      requestAnimationFrame(() => { message.textContent = text; });
      return;
    }
    message.textContent = text;
  };
  const announceSelection = view => {
    announce(view.selected
      ? `${tabLabel(view)} · ${view.selected.title} · ${view.selected.statusLabel} · ${view.selected.favorite ? '★' : '☆'}`
      : view.messages.empty);
  };

  // The catalog note repeats the status ("verified · full speed") under a fixed status line;
  // when the first segment is that status word, the rest is what the panel should show (#361).
  const STATUS_WORDS = new Set(['verified', 'buildable', 'unsupported', 'plays fine']);
  const noteBody = game => {
    if (!game?.note) return '';
    const [head, ...rest] = game.note.split('·').map(part => part.trim());
    return rest.length && STATUS_WORDS.has(head.toLowerCase()) ? rest.join(' · ') : game.note;
  };

  function render(status = false) {
    const view = launcher.view();
    const game = view.selected;
    const playing = view.mode === 'play';
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
    for (const button of column.querySelectorAll('[data-launcher-action]')) {
      const action = button.dataset.launcherAction;
      // The hardware keeps its place, but only B does something while a game is up.
      button.setAttribute('aria-disabled', String(playing ? action !== 'back' : action === 'back'));
    }
    for (const favorite of favorites) {
      favorite.setAttribute('aria-pressed', String(!!game?.favorite));
      favorite.setAttribute('aria-disabled', String(!game || playing));
    }

    // Two screens (#361): the list keeps the title card and the launcher panel; starting a game
    // swaps in the screenshot and the in-game menu of the running game.
    panel.hidden = playing;
    ingamePanel.hidden = !playing;
    titleCard.hidden = playing;
    playTop.hidden = !playing;
    screen.classList.toggle('is-playing', playing);
    for (const preview of previews) preview.hidden = !(playing && preview.dataset.previewSet === game?.id);
    notice.textContent = playing ? view.messages.preview : '';
    notice.hidden = !playing;
    back.hidden = !playing;
    screen.setAttribute('aria-label', playing ? 'In-game menu' : 'Launcher list: use arrow keys to select');

    if (playing) {
      ingameTitle.textContent = game?.title ?? '';
      ingameStatus.textContent = view.ingame.status;
      for (const [key, label] of Object.entries(ingameLabels)) label.textContent = view.ingame[key];
      for (const key of ['system', 'load', 'list']) {
        ingameLabels[key].classList.toggle('is-confirm', view.ingame.confirm === key);
      }
    }

    if (status) announceSelection(view);
  }

  function enterGame(keyboard = false) {
    launcher.play();
    if (launcher.view().mode !== 'play') return;
    render();
    announce(`Playing ${launcher.view().selected.title}`);
    $('ingameGameList').focus();
    if (keyboard) $('ingameGameList').scrollIntoView({ block: 'nearest' });
  }

  function leaveGame() {
    launcher.exit();
    render(true);
    focusSelected();
  }

  // The in-game menu's touch buttons: text state only. The screens that need real hardware say
  // so on the status line, exactly where the real menu reports what happened.
  function runIngame(action) {
    if (action === 'game-list') {
      // The real Game list button asks for a second tap, so the demo does too.
      if (launcher.press('list')) leaveGame();
      else {
        render();
        announce('Tap again to return to the list');
      }
      return;
    }
    const before = launcher.view().ingame.status;
    launcher.press(action);
    const after = launcher.view().ingame.status;
    render();
    const slot = launcher.view().ingame.slot;
    if (after !== before) announce(after);
    else if (action === 'load') announce(`Tap Load again to load ${slot.toLowerCase()}`);
    else if (['turbo', 'slot', 'system'].includes(action)) {
      // These change the button's own label; the live region carries it for screen readers.
      announce(ingamePanel.querySelector(`[data-ingame="${action}"]`).textContent);
    }
  }

  // `keyboard` only moves focus for keyboard navigation; a pointer click on the D-pad or
  // L/R must not pull focus into the row list (#374).
  function run(action, keyboard = false) {
    const view = launcher.view();
    if (view.mode === 'play') {
      if (action === 'back') leaveGame();
      return;
    }
    const reset = () => { notice.hidden = true; };
    if (action === 'play') {
      enterGame(keyboard);
      return;
    }
    if (action === 'up' || action === 'down') {
      launcher.move(action === 'down' ? 1 : -1);
      reset();
      render(true);
      if (keyboard) focusSelected();
    } else if (action === 'page-up' || action === 'page-down') {
      launcher.movePage(action === 'page-down' ? 1 : -1);
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
      // An empty Fav tab has no row to hold focus, so the key-driven switch keeps it on the tab
      // instead of dropping it to the page and stranding keyboard users (#361).
      if (keyboard) {
        const selected = rows.querySelector('[aria-pressed="true"]');
        (selected ?? screen.querySelector(`[data-tab="${action === 'tab-all' ? 'all' : 'fav'}"]`))?.focus();
      }
    } else if (action === 'favorite') {
      launcher.toggleFavorite();
      reset();
      render(true);
    }
  }

  // One click handler for the whole device column: rows, tabs, the in-game buttons and the
  // shell buttons are all handled here so a click never fires twice.
  column.addEventListener('click', event => {
    const ingame = event.target.closest('[data-ingame]');
    if (ingame) {
      // Hold:reset is driven by the pointer timer; a keyboard Enter has no detail.
      if (ingame.dataset.ingame !== 'reset' || event.detail === 0) runIngame(ingame.dataset.ingame);
      return;
    }
    const row = event.target.closest('[data-id]');
    if (row) {
      if (launcher.view().mode === 'play') return;
      notice.hidden = true;
      // A tap on the star toggles the favorite, like t.px < STAR_W in launcher.c.
      if (event.target.closest('.launcher-star')) {
        launcher.select(row.dataset.id);
        launcher.toggleFavorite();
        render(true);
        focusSelected();
        return;
      }
      if (row.dataset.id === launcher.view().selected?.id) {
        enterGame();
        return;
      }
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

  back.addEventListener('click', leaveGame);

  // Hold:reset needs a full press, like the real menu; a short tap does nothing.
  const resetButton = ingamePanel.querySelector('[data-ingame="reset"]');
  let holdTimer = 0;
  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    resetButton.classList.remove('is-holding');
  };
  resetButton.addEventListener('pointerdown', () => {
    resetButton.classList.add('is-holding');
    holdTimer = setTimeout(() => {
      stopHold();
      runIngame('reset');
    }, 1000);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
    resetButton.addEventListener(type, stopHold);
  }

  // Keyboard list navigation is scoped to the bottom screen so arrow keys on links in the
  // info panel still scroll the page (#374).
  screen.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (launcher.view().mode === 'play') return;
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
    if (event.key === 'l' || event.key === 'L' || event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      run(event.key === 'l' || event.key === 'L' ? 'page-up' : 'page-down', true);
      return;
    }
    if (event.key === 'Enter') {
      const row = event.target.closest('[data-id]');
      if (row) launcher.select(row.dataset.id);
      if (row || event.target === screen) {
        event.preventDefault();
        run('play', true);
      }
    }
  });

  // Escape leaves the game screen from anywhere, including the panel's back button.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && launcher.view().mode === 'play') leaveGame();
  });

  render();
  launcherReady = true;
}
