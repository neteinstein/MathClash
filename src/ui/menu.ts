import type { PlayerId } from '../board';
import { Avatar, AVATAR_COUNT, AVATAR_NAMES } from '../avatar';
import { COLORS, applyColorVars } from '../colors';
import { DIFFICULTIES } from '../questions';
import { DURATIONS, saveSettings, type Settings } from '../settings';
import { isSoundEnabled, setSoundEnabled, sfx, unlockAudio } from '../audio';
import { h, isLandscape, pulse } from './dom';
import { ICONS } from './icons';

export interface MenuCallbacks {
  onStart(): void;
}

interface SetupUi {
  root: HTMLElement;
  avatar: Avatar;
  avatarName: HTMLElement;
  swatches: HTMLButtonElement[];
  diffs: HTMLButtonElement[];
  ready: HTMLButtonElement;
  isReady: boolean;
}

const durationLabel = (d: number) => (d === 0 ? 'Sem limite' : `${d / 60} min`);

export class MenuScreen {
  readonly el: HTMLDivElement;
  private readonly ui: Record<PlayerId, SetupUi>;
  private readonly durationBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private starting = false;

  constructor(
    private readonly settings: Settings,
    private readonly cb: MenuCallbacks,
  ) {
    this.el = h('div', { class: `screen menu ${isLandscape() ? 'landscape' : 'portrait'}` });
    this.el.append(this.makeBackground());
    const p1 = this.makeSetup(1);
    const p2 = this.makeSetup(2);
    this.ui = { 1: p1, 2: p2 };

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
    const center = h('div', { class: 'menu-center' },
      logo,
      h('div', { class: 'tagline', text: 'Acerta nas contas e pinta o tabuleiro!' }),
      h('div', { class: 'menu-opts' }, this.durationBtn, this.soundBtn, helpBtn),
    );
    this.el.append(p2.root, center, p1.root);
    this.refreshAll();
    this.refreshOptions();
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
        const otherId: PlayerId = id === 1 ? 2 : 1;
        if (this.settings.players[otherId].color === i) {
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
    return { root, avatar, avatarName, swatches, diffs, ready, isReady: false };
  }

  private toggleReady(id: PlayerId): void {
    if (this.starting) return;
    unlockAudio();
    const u = this.ui[id];
    u.isReady = !u.isReady;
    u.root.classList.toggle('is-ready', u.isReady);
    u.ready.textContent = u.isReady ? 'À espera…' : 'PRONTO!';
    if (u.isReady) {
      u.avatar.react('happy', 'jump');
      sfx.correct(0);
    } else sfx.tap();
    if (this.ui[1].isReady && this.ui[2].isReady) {
      this.starting = true;
      for (const p of [1, 2] as PlayerId[]) {
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
    const otherColor = this.settings.players[id === 1 ? 2 : 1].color;
    applyColorVars(u.root, COLORS[setup.color]);
    u.avatarName.textContent = AVATAR_NAMES[setup.avatar];
    u.swatches.forEach((b, i) => {
      b.classList.toggle('selected', i === setup.color);
      b.classList.toggle('taken', i === otherColor);
    });
    u.diffs.forEach((b, i) => b.classList.toggle('selected', i === setup.difficulty));
  }

  private refreshAll(): void {
    this.refresh(1);
    this.refresh(2);
  }

  private refreshOptions(): void {
    this.durationBtn.innerHTML = `${ICONS.timer}<span>${durationLabel(this.settings.duration)}</span>`;
    this.soundBtn.innerHTML = isSoundEnabled() ? ICONS.soundOn : ICONS.soundOff;
  }

  private save(): void {
    saveSettings(this.settings);
  }

  layout(): void {
    const o = isLandscape() ? 'landscape' : 'portrait';
    this.el.classList.toggle('landscape', o === 'landscape');
    this.el.classList.toggle('portrait', o === 'portrait');
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
