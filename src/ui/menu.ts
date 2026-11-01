import { ALL_PLAYERS, playerIds, type PlayerId } from '../board';
import { Avatar, AVATAR_COUNT, AVATAR_NAMES } from '../avatar';
import { COLORS, applyColorVars } from '../colors';
import { DIFFICULTIES } from '../questions';
import { DURATIONS, PLAYER_COUNTS, activePlayerCount, fixColors, saveSettings, type Settings } from '../settings';
import { isSoundEnabled, setSoundEnabled, sfx, unlockAudio } from '../audio';
import { h, isLandscape, isLargeScreen, pulse } from './dom';
import { ICONS } from './icons';
import { canRequestFullscreen, enterFullscreen, isFullscreen, isIOS } from './fullscreen';
import { clearSeat, contentBox, frame, measureDepth, placeSeat, sideOf } from './seats';

export interface MenuCallbacks {
  onStart(): void;
}

interface SetupUi {
  id: PlayerId;
  root: HTMLElement;
  avatar: Avatar;
  avatarName: HTMLElement;
  swatches: HTMLButtonElement[];
  diffs: HTMLButtonElement[];
  ready: HTMLButtonElement;
  isReady: boolean;
}

const durationLabel = (d: number) => (d === 0 ? 'Sem limite' : `${d / 60} min`);

/** `fixColors`, telling whether any colour had to change. */
function fixColorsChanged(s: Settings, count: number): boolean {
  const before = ALL_PLAYERS.map((p) => s.players[p].color).join();
  fixColors(s, count);
  return ALL_PLAYERS.map((p) => s.players[p].color).join() !== before;
}

export class MenuScreen {
  readonly el: HTMLDivElement;
  private readonly ui: Record<PlayerId, SetupUi>;
  private readonly center: HTMLElement;
  private readonly countBtn: HTMLButtonElement;
  private readonly durationBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private starting = false;

  constructor(
    private readonly settings: Settings,
    private readonly cb: MenuCallbacks,
  ) {
    this.el = h('div', { class: `screen menu ${isLandscape() ? 'landscape' : 'portrait'}` });
    this.el.append(this.makeBackground());
    const [p1, p2, p3, p4] = ALL_PLAYERS.map((id) => this.makeSetup(id));
    this.ui = { 1: p1, 2: p2, 3: p3, 4: p4 };

    // Tablets: 2, 3 or 4 players, one on each side of the screen.
    this.countBtn = h('button', { class: 'chip', attrs: { 'aria-label': 'Número de jogadores' } });
    this.countBtn.addEventListener('click', () => {
      const i = PLAYER_COUNTS.indexOf(this.settings.playerCount);
      this.settings.playerCount = PLAYER_COUNTS[(i + 1) % PLAYER_COUNTS.length];
      fixColors(this.settings, this.settings.playerCount);
      this.save();
      // Everyone confirms again for the new line-up.
      for (const u of Object.values(this.ui)) this.setReady(u, false);
      this.refreshAll();
      this.refreshOptions();
      this.layout();
      sfx.tap();
      pulse(this.countBtn, 'pop', 300);
    });

    this.durationBtn = h('button', { class: 'chip', attrs: { 'aria-label': 'Duração da partida' } });
    this.durationBtn.addEventListener('click', () => {
      const i = DURATIONS.indexOf(this.settings.duration);
      this.settings.duration = DURATIONS[(i + 1) % DURATIONS.length];
      this.save();
      this.refreshOptions();
      sfx.tap();
      pulse(this.durationBtn, 'pop', 300);
    });
    this.soundBtn = h('button', { class: 'chip icon-only', attrs: { 'aria-label': 'Som' } });
    this.soundBtn.addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      setSoundEnabled(this.settings.sound);
      this.save();
      this.refreshOptions();
      sfx.tap();
    });
    const helpBtn = h('button', { class: 'chip icon-only', html: ICONS.help, attrs: { 'aria-label': 'Como jogar' } });
    helpBtn.addEventListener('click', () => this.showHelp());

    const logo = h('h1', { class: 'logo', attrs: { 'aria-label': 'MathClash' } });
    'MathClash'.split('').forEach((ch, i) => {
      const s = h('span', { text: ch });
      s.style.setProperty('--i', String(i));
      logo.append(s);
    });
    this.center = h('div', { class: 'menu-center' },
      logo,
      h('div', { class: 'tagline', text: 'Acerta nas contas e pinta o tabuleiro!' }),
      h('div', { class: 'menu-opts' }, this.countBtn, this.durationBtn, this.soundBtn, helpBtn, this.makeFullscreenButton()),
    );
    this.el.append(p2.root, this.center, p1.root, p3.root, p4.root);
    this.refreshAll();
    this.refreshOptions();
    this.layout();
  }

  /** Players taking part right now (always 2 on a phone). */
  private active(): PlayerId[] {
    return playerIds(activePlayerCount(this.settings));
  }

  private makeBackground(): HTMLElement {
    const bg = h('div', { class: 'math-bg', attrs: { 'aria-hidden': 'true' } });
    const symbols = ['+', '−', '×', '÷', '=', '7', '3', '%', '9', '2', '√', '5'];
    for (let i = 0; i < 18; i++) {
      const s = h('span', { text: symbols[i % symbols.length] });
      s.style.left = `${(i * 37) % 100}%`;
      s.style.setProperty('--dur', `${14 + ((i * 7) % 11)}s`);
      s.style.setProperty('--delay', `${-((i * 3.3) % 14)}s`);
      s.style.setProperty('--size', `${22 + ((i * 13) % 36)}px`);
      bg.append(s);
    }
    return bg;
  }

  private makeSetup(id: PlayerId): SetupUi {
    const setup = this.settings.players[id];
    const root = h('section', { class: `setup p${id}` });
    const avatar = new Avatar(setup.avatar);
    const avatarName = h('div', { class: 'avatar-name' });

    const changeAvatar = (d: number) => {
      setup.avatar = (setup.avatar + d + AVATAR_COUNT) % AVATAR_COUNT;
      avatar.setVariant(setup.avatar);
      avatar.react('happy', 'jump');
      sfx.tap();
      this.save();
      this.refresh(id);
    };
    const prev = h('button', { class: 'arrow', html: ICONS.chevL, attrs: { 'aria-label': 'Avatar anterior' } });
    const next = h('button', { class: 'arrow', html: ICONS.chevR, attrs: { 'aria-label': 'Avatar seguinte' } });
    prev.addEventListener('click', () => changeAvatar(-1));
    next.addEventListener('click', () => changeAvatar(1));
    avatar.el.addEventListener('click', () => changeAvatar(1));
    avatar.el.setAttribute('role', 'button');
    avatar.el.setAttribute('aria-label', 'Mudar avatar');

    const swatches = COLORS.map((c, i) => {
      const b = h('button', { class: 'swatch', attrs: { 'aria-label': c.name } });
      b.style.setProperty('--sw', c.main);
      b.addEventListener('click', () => {
        if (this.active().some((q) => q !== id && this.settings.players[q].color === i)) {
          pulse(b, 'nope', 400);
          return;
        }
        setup.color = i;
        avatar.react('happy', 'squish');
        sfx.tap();
        this.save();
        this.refreshAll();
      });
      return b;
    });

    const diffs = DIFFICULTIES.map((d, i) => {
      const b = h('button', { class: 'diff', attrs: { 'aria-label': `${d.label}: ${d.ops}` } },
        h('span', { class: 'diff-emoji', text: d.emoji }),
        h('span', { class: 'diff-label', text: d.label }),
        h('span', { class: 'diff-ops', text: d.ops }),
      );
      b.addEventListener('click', () => {
        setup.difficulty = i;
        sfx.tap();
        this.save();
        this.refresh(id);
      });
      return b;
    });

    const ready = h('button', { class: 'ready-btn', text: 'PRONTO!' });
    ready.addEventListener('click', () => this.toggleReady(id));

    root.append(
      h('div', { class: 'setup-title', text: `Jogador ${id}` }),
      h('div', { class: 'setup-avatar' }, prev, avatar.el, next),
      avatarName,
      h('div', { class: 'swatches' }, ...swatches),
      h('div', { class: 'diffs' }, ...diffs),
      ready,
    );
    return { id, root, avatar, avatarName, swatches, diffs, ready, isReady: false };
  }

  private setReady(u: SetupUi, on: boolean): void {
    u.isReady = on;
    u.root.classList.toggle('is-ready', on);
    u.ready.textContent = on ? 'À espera…' : 'PRONTO!';
  }

  private toggleReady(id: PlayerId): void {
    if (this.starting) return;
    unlockAudio();
    const u = this.ui[id];
    this.setReady(u, !u.isReady);
    if (u.isReady) {
      u.avatar.react('happy', 'jump');
      sfx.correct(0);
    } else sfx.tap();
    const players = this.active();
    if (players.every((p) => this.ui[p].isReady)) {
      this.starting = true;
      fixColors(this.settings, players.length);
      for (const p of players) {
        this.ui[p].ready.textContent = 'Vamos lá!';
        this.ui[p].avatar.react('happy', 'spin', 900);
      }
      this.el.classList.add('leaving');
      window.setTimeout(() => this.cb.onStart(), 650);
    }
  }

  private refresh(id: PlayerId): void {
    const setup = this.settings.players[id];
    const u = this.ui[id];
    const taken = new Set(this.active().filter((q) => q !== id).map((q) => this.settings.players[q].color));
    applyColorVars(u.root, COLORS[setup.color]);
    u.avatarName.textContent = AVATAR_NAMES[setup.avatar];
    u.swatches.forEach((b, i) => {
      b.classList.toggle('selected', i === setup.color);
      b.classList.toggle('taken', taken.has(i));
    });
    u.diffs.forEach((b, i) => b.classList.toggle('selected', i === setup.difficulty));
  }

  private refreshAll(): void {
    for (const id of ALL_PLAYERS) this.refresh(id);
  }

  private refreshOptions(): void {
    this.countBtn.innerHTML = `${ICONS.players}<span>${this.settings.playerCount} jogadores</span>`;
    this.durationBtn.innerHTML = `${ICONS.timer}<span>${durationLabel(this.settings.duration)}</span>`;
    this.soundBtn.innerHTML = isSoundEnabled() ? ICONS.soundOn : ICONS.soundOff;
  }

  private save(): void {
    saveSettings(this.settings);
  }

  layout(): void {
    const large = isLargeScreen();
    const count = activePlayerCount(this.settings);
    const multi = count > 2;
    this.countBtn.hidden = !large;
    const o = isLandscape() ? 'landscape' : 'portrait';
    this.el.classList.toggle('multi', multi);
    this.el.classList.toggle('landscape', !multi && o === 'landscape');
    this.el.classList.toggle('portrait', !multi && o === 'portrait');
    for (const u of Object.values(this.ui)) {
      const on = u.id <= count;
      if (!on && u.isReady) this.setReady(u, false);
      u.root.hidden = !on;
      if (!multi) clearSeat(u.root);
    }
    // The colours on offer depend on who is playing (the screen may have just changed size).
    if (fixColorsChanged(this.settings, count)) this.save();
    this.refreshAll();
    const c = this.center.style;
    if (!multi) {
      for (const p of ['left', 'top', 'width', 'height', '--cw']) c.removeProperty(p);
      return;
    }
    // 3-4 players: each setup on its own side of the screen, facing its player; logo and options in the middle.
    const box = contentBox(this.el);
    this.el.style.setProperty('--vm', `${Math.min(box.w, box.h) / 100}px`);
    const side = (id: PlayerId) => sideOf(id, count, box.w > box.h);
    const roots = new Map(this.active().map((id) => [side(id), this.ui[id].root]));
    const { strips, middle } = frame(box, (side, len) => {
      const el = roots.get(side);
      return el ? measureDepth(el, len) : 0;
    });
    for (const id of this.active()) placeSeat(this.ui[id].root, side(id), strips[side(id)]);
    c.left = `${middle.x}px`;
    c.top = `${middle.y}px`;
    c.width = `${middle.w}px`;
    c.height = `${middle.h}px`;
    c.setProperty('--cw', `${middle.w}px`);
  }

  /** Android back button: closes the help if open. */
  back(): boolean {
    const help = this.el.querySelector('.help');
    if (help) {
      help.remove();
      return true;
    }
    return false;
  }

  /** "Ecrã inteiro" button on mobile web; hidden when already full screen or nothing can be done. */
  private makeFullscreenButton(): HTMLElement | null {
    if (isFullscreen() || (!canRequestFullscreen() && !isIOS())) return null;
    const b = h('button', { class: 'chip fs-btn', html: `${ICONS.fullscreen}<span>Ecrã inteiro</span>`, attrs: { 'aria-label': 'Ecrã inteiro' } });
    const update = () => b.toggleAttribute('hidden', isFullscreen());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    b.addEventListener('click', async () => {
      sfx.tap();
      if (canRequestFullscreen() && (await enterFullscreen())) return;
      this.showInstallTip();
    });
    return b;
  }

  /** iPhone Safari cannot go full screen: the only way is "Add to Home Screen". */
  private showInstallTip(): void {
    const close = h('button', { class: 'btn btn-primary', html: `${ICONS.close}<span>Percebi!</span>` });
    const tip = h('div', { class: 'help' },
      h('div', { class: 'help-card' },
        h('h2', { text: 'Ecrã inteiro no iPhone' }),
        h('p', { text: 'O Safari do iPhone não deixa as páginas ficarem em ecrã inteiro. Instala o jogo no ecrã principal:' }),
        h('ol', {},
          h('li', { html: 'Abre esta página no <b>Safari</b> (se vieste do WhatsApp, usa "Abrir no Safari").' }),
          h('li', { html: 'Toca em <b>Partilhar</b> (o quadrado com a seta para cima).' }),
          h('li', { html: 'Escolhe <b>Adicionar ao ecrã principal</b>.' }),
          h('li', { html: 'Abre o MathClash pelo ícone: fica em ecrã inteiro e funciona sem internet.' }),
        ),
        close,
      ),
    );
    close.addEventListener('click', () => tip.remove());
    tip.addEventListener('click', (e) => { if (e.target === tip) tip.remove(); });
    this.el.append(tip);
  }

  private showHelp(): void {
    sfx.tap();
    const close = h('button', { class: 'btn btn-primary', html: `${ICONS.close}<span>Percebi!</span>` });
    const help = h('div', { class: 'help' },
      h('div', { class: 'help-card' },
        h('h2', { text: 'Como jogar' }),
        h('ol', {},
          h('li', { html: 'Cada jogador fica numa <b>ponta</b> do ecrã com o seu avatar e a sua cor.' }),
          h('li', { html: 'Resolve a conta e toca na resposta certa — há <b>4 hipóteses</b>.' }),
          h('li', { html: 'Acertaste? A tua cor <b>expande</b> e pode roubar casas ao adversário!' }),
          h('li', { html: 'Erraste? A tua cor <b>encolhe</b> um bocadinho e ficas bloqueado por um instante.' }),
          h('li', { html: 'Séries de acertos (🔥), respostas rápidas (⚡) e contas douradas (⭐) dão mais casas.' }),
          h('li', { html: '<b>10 acertos seguidos</b> enviam um 😈 diabinho: o adversário recebe uma conta bem mais difícil. Quem a acertar ganha a dobrar!' }),
          h('li', { html: 'O nível escolhe as contas: 🐣 <b>+ −</b>, 🙂 <b>+ − ×</b>, 😎 <b>+ − × ÷</b>, 🔥 e 🧠 <b>tudo</b>. A cada 4 acertos os números ficam maiores.' }),
          h('li', { html: 'Ganha quem pintar o tabuleiro todo — ou quem tiver mais quando o tempo acabar.' }),
          h('li', { html: 'Num <b>tablet</b> podem jogar <b>até 4</b> (botão 👥): um em cada lado do ecrã — com 3, o tabuleiro é um <b>triângulo</b> 🔺. Quem fica sem território sai e os outros continuam; o 😈 vai para o adversário com mais território.' }),
        ),
        h('p', { class: 'help-tip', text: 'Dica: escolham níveis diferentes para jogar miúdos contra graúdos!' }),
        close,
      ),
    );
    close.addEventListener('click', () => help.remove());
    help.addEventListener('click', (e) => {
      if (e.target === help) help.remove();
    });
    this.el.append(help);
  }

  tick(): void {
    /* menu is CSS-animated */
  }

  destroy(): void {
    this.el.remove();
  }
}
