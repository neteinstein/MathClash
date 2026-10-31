import { Board, other, type CellChange, type PlayerId } from '../board';
import { BoardView, AVATAR_MARGIN, type Orientation, type PaintEvent } from '../renderer';
import type { Fx } from '../fx';
import { Avatar, devilSVG } from '../avatar';
import { COLORS, applyColorVars, type PlayerColor } from '../colors';
import { DIFFICULTIES, formatNumber, generateQuestion, type Question } from '../questions';
import { COMBO_LABELS, WRONG_LOCK_MS, devilStage, isDevilStreak, penalty, reward, stageFor } from '../rules';
import { sfx, vibrate } from '../audio';
import type { Settings } from '../settings';
import { h, hasKeyboard, isLandscape, onPress, pulse } from './dom';
import { ICONS } from './icons';

type State = 'countdown' | 'playing' | 'paused' | 'ending' | 'over';

const KEYS: Record<PlayerId, string[][]> = {
  1: [['1', 'a'], ['2', 's'], ['3', 'd'], ['4', 'f']],
  2: [['7', 'h'], ['8', 'j'], ['9', 'k'], ['0', 'l']],
};

interface PlayerRt {
  id: PlayerId;
  color: PlayerColor;
  difficulty: number;
  avatar: Avatar;
  avatarWrap: HTMLDivElement;
  panel: HTMLElement;
  qcard: HTMLDivElement;
  qtext: HTMLSpanElement;
  streakBadge: HTMLDivElement;
  levelBadge: HTMLDivElement;
  buttons: HTMLButtonElement[];
  floats: HTMLDivElement;
  timeEl: HTMLSpanElement;
  myPct: HTMLElement;
  theirPct: HTMLElement;
  myBar: HTMLElement;
  theirBar: HTMLElement;
  countdown: HTMLDivElement;
  question: Question | null;
  shownAt: number;
  busy: boolean;
  timer: number;
  correct: number;
  wrong: number;
  streak: number;
  bestStreak: number;
  fastest: number;
  recent: string[];
  shownPct: number;
  /** Devil questions waiting for this player (sent by the opponent's 10-streaks). */
  devilsPending: number;
  /** The question on screen is a devil question. */
  devilActive: boolean;
  /** The little devil sitting next to this player's avatar. */
  devilEl: HTMLDivElement | null;
}

export interface GameCallbacks {
  onMenu(): void;
  onRematch(): void;
}

export interface GameOptions {
  /** Players controlled by the computer (only used for demos/testing). */
  bots?: PlayerId[];
}

export class GameScreen {
  readonly el: HTMLDivElement;
  private readonly arena: HTMLDivElement;
  private readonly overlayHost: HTMLDivElement;
  private board!: Board;
  private view!: BoardView;
  private readonly players: Record<PlayerId, PlayerRt>;
  private state: State = 'countdown';
  private elapsed = 0;
  private lastSecond = -1;
  private orientation: Orientation;
  private readonly timers = new Set<number>();
  private finale = false;
  private botTimers: Partial<Record<PlayerId, number>> = {};
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private readonly visHandler = () => {
    if (document.hidden && this.state === 'playing') this.pause();
  };

  constructor(
    private readonly settings: Settings,
    private readonly fx: Fx,
    private readonly cb: GameCallbacks,
    private readonly opts: GameOptions = {},
  ) {
    this.orientation = isLandscape() ? 'landscape' : 'portrait';
    this.el = h('div', { class: `screen game ${this.orientation}` });
    this.arena = h('div', { class: 'arena' });
    this.overlayHost = h('div', { class: 'overlay-host' });
    const p1 = this.makePlayer(1);
    const p2 = this.makePlayer(2);
    this.players = { 1: p1, 2: p2 };
    this.el.append(p2.panel, this.arena, p1.panel, this.overlayHost);
    window.addEventListener('keydown', this.keyHandler);
    document.addEventListener('visibilitychange', this.visHandler);
  }

  // ------------------------------------------------------------------ setup

  private makePlayer(id: PlayerId): PlayerRt {
    const setup = this.settings.players[id];
    const color = COLORS[setup.color];
    const enemyColor = COLORS[this.settings.players[other(id)].color];
    const panel = h('section', { class: `panel p${id}` });
    applyColorVars(panel, color);
    panel.style.setProperty('--ec', enemyColor.main);

    const pauseBtn = h('button', { class: 'hud-btn', html: ICONS.pause, attrs: { 'aria-label': 'Pausa' } });
    onPress(pauseBtn, () => this.pause());
    const myPct = h('b', { class: 'tug-pct mine', text: '0%' });
    const theirPct = h('b', { class: 'tug-pct theirs', text: '0%' });
    const myBar = h('i', { class: 'tug-fill mine' });
    const theirBar = h('i', { class: 'tug-fill theirs' });
    const tug = h('div', { class: 'tug' }, myPct, h('div', { class: 'tug-bar' }, myBar, theirBar), theirPct);
    const timeEl = h('span', { class: 'hud-time', text: '' });
    const header = h('header', { class: 'hud' }, pauseBtn, tug, timeEl);

    const qtext = h('span', { class: 'qtext', text: '' });
    const streakBadge = h('div', { class: 'badge streak' });
    const levelBadge = h('div', { class: 'badge level' });
    const qcard = h('div', { class: 'qcard' }, qtext, streakBadge, levelBadge,
      h('div', { class: 'badge gold', text: '⭐ x2' }),
      h('div', { class: 'badge devilb', text: '😈 DIABINHO · x2' }),
    );
    // Messages (+4, COMBO…) live on the board next to the player's avatar, never over the question.
    const floats = h('div', { class: `float-zone p${id}` });
    applyColorVars(floats, color);
    const countdown = h('div', { class: 'countdown' });

    const answers = h('div', { class: 'answers' });
    const buttons: HTMLButtonElement[] = [];
    const showKeys = hasKeyboard();
    for (let i = 0; i < 4; i++) {
      const b = h('button', { class: 'ans', attrs: { 'aria-label': `Resposta ${i + 1}` } }, h('span', { class: 'ans-n' }));
      if (showKeys) b.append(h('kbd', { text: KEYS[id][i][0] }));
      onPress(b, () => this.answer(id, i));
      buttons.push(b);
      answers.append(b);
    }
    panel.append(header, h('div', { class: 'qwrap' }, qcard), answers, countdown);

    const avatar = new Avatar(setup.avatar);
    const avatarWrap = h('div', { class: `avatar-wrap p${id}` }, avatar.el);
    applyColorVars(avatarWrap, color);

    return {
      id, color, difficulty: setup.difficulty, avatar, avatarWrap, panel, qcard, qtext,
      streakBadge, levelBadge, buttons, floats, timeEl, myPct, theirPct, myBar, theirBar, countdown,
      question: null, shownAt: 0, busy: true, timer: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0,
      fastest: Infinity, recent: [], shownPct: 0, devilsPending: 0, devilActive: false, devilEl: null,
    };
  }

  /** Call once the element is in the DOM: sizes the board to the screen and starts the countdown. */
  start(): void {
    const r = this.arena.getBoundingClientRect();
    const portrait = this.orientation === 'portrait';
    const across = portrait ? r.width : r.height;
    const along = portrait ? r.height : r.width;
    let w = Math.max(9, Math.min(13, Math.round(across / 44)));
    if (w % 2 === 0) w--;
    const s0 = BoardView.cellSizeFor(across, 1e9, w, 1, 'portrait');
    const hCells = Math.max(8, Math.min(16, Math.round(along / s0 - AVATAR_MARGIN * 2)));
    this.board = new Board(w, hCells);
    this.view = new BoardView(this.board, { 1: this.players[1].color, 2: this.players[2].color });
    this.view.onPaint = (e) => this.onPaint(e);
    this.arena.append(this.view.canvas, this.players[1].avatarWrap, this.players[2].avatarWrap, this.players[1].floats, this.players[2].floats);
    this.layout();
    for (const p of this.each()) this.updateHud(p, true);
    this.runCountdown();
  }

  private *each(): Generator<PlayerRt> {
    yield this.players[1];
    yield this.players[2];
  }

  layout(): void {
    const o: Orientation = isLandscape() ? 'landscape' : 'portrait';
    if (o !== this.orientation) {
      this.el.classList.replace(this.orientation, o);
      this.orientation = o;
    }
    if (!this.view) return;
    const r = this.arena.getBoundingClientRect();
    this.view.layout(r.width, r.height, o);
    const size = this.view.cell * 1.7;
    const unit = Math.max(15, Math.min(30, this.view.cell * 0.56));
    for (const p of this.each()) {
      const [x, y] = this.view.avatarAnchor(p.id);
      const s = p.avatarWrap.style;
      s.width = s.height = `${size}px`;
      s.left = `${x - size / 2}px`;
      s.top = `${y - size / 2}px`;
      // Message spot: just past the avatar, on the board, growing towards the middle.
      const reach = size / 2 + 6;
      let fx = x;
      let fy = y;
      if (o === 'portrait') fy = p.id === 1 ? y - reach : y + reach;
      else fx = p.id === 1 ? x + reach : x - reach;
      const z = p.floats;
      z.style.left = `${fx}px`;
      z.style.top = `${fy}px`;
      z.style.setProperty('--u', `${unit}px`);
      z.classList.toggle('start', o === 'landscape' && p.id === 1);
      z.classList.toggle('end', o === 'landscape' && p.id === 2);
      if (p.devilEl) this.placeDevil(p.devilEl, p.id);
    }
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  // -------------------------------------------------------------- game flow

  private runCountdown(): void {
    this.state = 'countdown';
    const steps = ['3', '2', '1', 'JÁ!'];
    steps.forEach((txt, k) => {
      this.later(() => {
        for (const p of this.each()) {
          p.countdown.textContent = txt;
          pulse(p.countdown, 'show', 900);
        }
        if (k < 3) sfx.count();
        else {
          sfx.go();
          this.state = 'playing';
          for (const p of this.each()) {
            p.avatar.react('happy', 'jump');
            this.nextQuestion(p);
          }
        }
      }, 250 + k * 750);
    });
  }

  private nextQuestion(p: PlayerRt): void {
    const devil = p.devilsPending > 0;
    if (devil) p.devilsPending--;
    p.devilActive = devil;
    const stage = stageFor(p.difficulty, p.correct);
    const q = generateQuestion(p.difficulty, devil ? devilStage(p.difficulty, stage) : stage, {
      avoid: p.recent,
      goldenChance: devil ? 0 : undefined,
    });
    p.recent = [...p.recent.slice(-5), q.text];
    p.question = q;
    p.shownAt = this.elapsed;
    p.busy = false;
    p.qtext.textContent = q.text;
    p.qcard.classList.toggle('golden', q.golden);
    p.qcard.classList.toggle('devil', devil);
    p.qcard.classList.toggle('long', q.text.length > 9);
    p.levelBadge.textContent = `${DIFFICULTIES[q.difficulty].emoji} Nv ${q.stage}`;
    pulse(p.qcard, 'enter', 400);
    if (q.golden) sfx.golden();
    if (devil) {
      sfx.devil();
      p.avatar.react('shock', 'shake', 900);
      if (p.devilEl) pulse(p.devilEl, 'cackle', 900);
    }
    p.buttons.forEach((b, i) => {
      b.classList.remove('ok', 'bad', 'reveal');
      const label = formatNumber(q.options[i]);
      (b.firstChild as HTMLElement).textContent = label;
      b.classList.toggle('long', label.length >= 5);
      b.style.setProperty('--d', `${i * 40}ms`);
      pulse(b, 'enter', 400);
    });
    this.scheduleBot(p);
  }

  private answer(id: PlayerId, i: number): void {
    const p = this.players[id];
    if (this.state !== 'playing' || p.busy || !p.question) return;
    p.busy = true;
    const q = p.question;
    const btn = p.buttons[i];
    const now = performance.now();
    const enemy = this.players[other(id)];

    const wasDevil = p.devilActive;
    p.devilActive = false;

    if (q.options[i] === q.answer) {
      p.correct++;
      p.streak++;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      const answerMs = this.elapsed - p.shownAt;
      p.fastest = Math.min(p.fastest, answerMs);
      const rw = reward({
        boardSize: this.board.size, elapsedMs: this.elapsed, streak: p.streak, answerMs, golden: q.golden, devil: wasDevil,
      });
      const changes = this.board.expand(id, rw.cells);
      this.view.queue(changes, now);
      const stolen = changes.filter((c) => c.from === enemy.id).length;

      btn.classList.add('ok');
      pulse(p.qcard, 'good', 500);
      sfx.correct(p.streak);
      vibrate(15);
      p.avatar.react('happy', 'jump');
      this.float(p, `+${changes.length}`, 'plus');
      if (q.golden) {
        this.float(p, '⭐ DOURADA!', 'gold', 120);
        const [x, y] = this.center(p.floats);
        this.fx.stars(x, y, 10);
      }
      if (rw.fast) this.float(p, '⚡ RÁPIDO!', 'fast', 200);
      if (rw.combo > 0 && !isDevilStreak(p.streak) && (p.streak === 3 || p.streak === 5 || p.streak === 8 || p.streak % 5 === 0)) {
        this.float(p, `${COMBO_LABELS[rw.combo]} x${p.streak}`, `combo c${rw.combo}`, 300);
      }
      if (wasDevil) this.devilBeaten(p);
      if (isDevilStreak(p.streak)) this.sendDevil(p, enemy);
      if (stolen > 0) {
        enemy.avatar.react('shock', 'shake', 800);
        this.later(() => this.float(enemy, `−${stolen}`, 'minus'), 250);
        if (stolen >= 4) pulse(this.arena, 'shake', 400);
      }
      this.updateHud(p);

      if (this.board.count(enemy.id) === 0) {
        this.state = 'ending';
        this.later(() => this.finish(id, 'ko'), changes.length * 55 + 600);
        return;
      }
      p.timer = window.setTimeout(() => this.nextQuestion(p), 380);
    } else {
      p.wrong++;
      p.streak = 0;
      const changes = this.board.shrink(id, penalty(this.board.size, this.elapsed));
      this.view.queue(changes, now, 70, 380);
      btn.classList.add('bad');
      p.buttons[q.options.indexOf(q.answer)].classList.add('reveal');
      pulse(p.panel, 'hurt', 450);
      sfx.wrong();
      vibrate([40, 40, 60]);
      p.avatar.react('sad', 'shake', 1100);
      if (changes.length) this.float(p, `−${changes.length}`, 'minus');
      else this.float(p, 'Ups!', 'minus');
      if (wasDevil) this.devilWins(p);
      this.updateHud(p);
      p.timer = window.setTimeout(() => this.nextQuestion(p), WRONG_LOCK_MS);
    }
  }

  private finish(winner: PlayerId | 0, reason: 'ko' | 'time'): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.stopBots();
    for (const p of this.each()) {
      window.clearTimeout(p.timer);
      p.busy = true;
      p.devilsPending = 0;
      p.devilActive = false;
      if (p.devilEl) this.dismissDevil(p, 'leave');
    }
    const now = performance.now();
    if (winner) {
      this.finale = true;
      const changes: CellChange[] = this.board.flood(winner);
      this.view.queue(changes, now, 45, 380);
      const w = this.players[winner];
      const l = this.players[other(winner)];
      w.avatar.setMood('win');
      w.avatar.play('jump');
      l.avatar.setMood('lose');
      l.avatar.play('shake');
      w.avatarWrap.classList.add('winner');
      sfx.win();
      const maxOrder = changes.reduce((m, c) => Math.max(m, c.order), 0);
      this.later(() => this.fx.confetti([w.color.main, w.color.light, '#fde047', '#ffffff'], 3500), Math.min(1500, maxOrder * 45));
    } else {
      sfx.draw();
      for (const p of this.each()) p.avatar.setMood('shock');
    }
    this.later(() => this.showResults(winner, reason), winner ? 1500 : 700);
  }

  // ------------------------------------------------------------------ pause

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    for (const p of this.each()) window.clearTimeout(p.timer);
    this.stopBots();
    sfx.tap();
    this.showDual('pause', (p) => [
      h('div', { class: 'dual-title', text: 'Pausa' }),
      h('div', { class: 'dual-sub', text: `Tens ${this.pct(p.id)}% do tabuleiro` }),
      this.actions([
        { label: 'Continuar', icon: ICONS.play, primary: true, fn: () => this.resume() },
        { label: 'Menu', icon: ICONS.home, fn: () => this.cb.onMenu() },
      ]),
    ]);
  }

  /** Android back button / Escape. Returns true if handled. */
  back(): boolean {
    if (this.state === 'playing') {
      this.pause();
      return true;
    }
    if (this.state === 'paused') {
      this.resume();
      return true;
    }
    return false;
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.overlayHost.replaceChildren();
    this.state = 'playing';
    // Whoever was mid-answer gets a fresh question.
    for (const p of this.each()) this.nextQuestion(p);
  }

  // ------------------------------------------------------------------- tick

  tick(now: number, dt: number): void {
    if (!this.view) return;
    if (this.state === 'playing') {
      this.elapsed += dt * 1000;
      const limit = this.settings.duration * 1000;
      if (limit > 0) {
        const left = Math.ceil((limit - this.elapsed) / 1000);
        if (left !== this.lastSecond) {
          this.lastSecond = left;
          if (left <= 10 && left > 0) sfx.tick();
        }
        if (this.elapsed >= limit) {
          const a = this.board.count(1);
          const b = this.board.count(2);
          this.state = 'ending';
          for (const p of this.each()) this.float(p, 'TEMPO!', 'combo c2');
          this.later(() => this.finish(a === b ? 0 : a > b ? 1 : 2, 'time'), 700);
        }
      }
    }
    for (const p of this.each()) this.updateHud(p);
    this.view.draw(now);
  }

  // ------------------------------------------------------------------ devil

  /** Where a player's devil sits: beside their avatar, on the board, facing them. */
  private devilSpot(id: PlayerId): { x: number; y: number; rot: number; size: number } {
    const [ax, ay] = this.view.avatarAnchor(id);
    const c = this.view.cell;
    const size = c * 1.45;
    const side = id === 1 ? 1 : -1;
    if (this.orientation === 'portrait') return { x: ax + side * 1.8 * c, y: ay - side * 0.35 * c, rot: id === 1 ? 0 : 180, size };
    return { x: ax + side * 0.35 * c, y: ay - 1.8 * c, rot: 0, size };
  }

  private placeDevil(el: HTMLDivElement, id: PlayerId): void {
    const { x, y, rot, size } = this.devilSpot(id);
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${rot}deg)`;
  }

  /** 10 in a row: a little devil flies across the board and hands the opponent a hard question. */
  private sendDevil(from: PlayerRt, to: PlayerRt): void {
    this.float(from, `🔥 ${from.streak} SEGUIDAS!`, 'combo c3', 150);
    this.later(() => this.float(from, '😈 DIABINHO ENVIADO!', 'combo devil'), 650);
    from.avatar.react('happy', 'spin', 900);
    sfx.devil();
    vibrate([30, 30, 30]);

    const el = h('div', { class: 'devil-sprite flying' }, h('div', { class: 'devil-body', html: devilSVG() }));
    this.arena.append(el);
    const [x0, y0] = this.view.avatarAnchor(from.id);
    const end = this.devilSpot(to.id);
    const half = end.size / 2;
    el.style.width = el.style.height = `${end.size}px`;
    // Arc across the board: the middle point bulges sideways.
    const mx = (x0 + end.x) / 2 + (this.orientation === 'portrait' ? -2.5 : 0) * this.view.cell;
    const my = (y0 + end.y) / 2 + (this.orientation === 'landscape' ? -2.5 : 0) * this.view.cell;
    const startRot = from.id === 1 || this.orientation === 'landscape' ? 0 : 180;
    const anim = el.animate(
      [
        { transform: `translate(${x0 - half}px, ${y0 - half}px) scale(0.2) rotate(${startRot}deg)`, opacity: 0 },
        { transform: `translate(${mx - half}px, ${my - half}px) scale(1.5) rotate(${startRot + 360}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${end.x - half}px, ${end.y - half}px) scale(1) rotate(${end.rot + 720}deg)`, opacity: 1 },
      ],
      { duration: 1100, easing: 'cubic-bezier(.45,0,.25,1)' },
    );
    const land = () => {
      if (!el.isConnected) return;
      el.classList.remove('flying');
      this.placeDevil(el, to.id);
      if (this.state === 'over' || this.state === 'ending') {
        el.remove();
        return;
      }
      to.devilEl?.remove();
      to.devilEl = el;
      el.classList.add('sitting');
      to.devilsPending++;
      const sx = end.x + this.view.canvas.getBoundingClientRect().left;
      const sy = end.y + this.view.canvas.getBoundingClientRect().top;
      this.fx.splat(sx, sy, '#a855f7', 10, 1.1);
      this.fx.splat(sx, sy, '#ef4444', 6, 0.9);
      this.fx.ring(sx, sy, '#f0abfc', this.view.cell * 1.2);
      to.avatar.react('shock', 'shake', 900);
      this.float(to, '😈 CONTA DIFÍCIL!', 'combo devil');
      // An idle player gets the devil's question right away; a busy one gets it next.
      if (this.state === 'playing' && !to.busy) {
        window.clearTimeout(to.timer);
        this.nextQuestion(to);
      }
    };
    anim.onfinish = land;
  }

  private devilBeaten(p: PlayerRt): void {
    sfx.devilDefeated();
    this.float(p, '😇 VENCESTE O DIABINHO!', 'combo angel', 150);
    if (p.devilEl) {
      const r = p.devilEl.getBoundingClientRect();
      this.fx.stars(r.left + r.width / 2, r.top + r.height / 2, 12);
      if (p.devilsPending === 0) this.dismissDevil(p, 'poof');
    }
  }

  private devilWins(p: PlayerRt): void {
    this.later(() => sfx.devil(), 250);
    this.float(p, '😈 HA HA HA!', 'combo devil', 150);
    if (p.devilEl) {
      pulse(p.devilEl, 'cackle', 900);
      if (p.devilsPending === 0) this.later(() => this.dismissDevil(p, 'leave'), 900);
    }
  }

  private dismissDevil(p: PlayerRt, how: 'poof' | 'leave'): void {
    const el = p.devilEl;
    if (!el || p.devilActive || p.devilsPending > 0) return;
    p.devilEl = null;
    el.classList.remove('sitting', 'cackle');
    el.classList.add(how);
    window.setTimeout(() => el.remove(), 750);
  }

  // -------------------------------------------------------------------- HUD

  private pct(id: PlayerId): number {
    return Math.round((this.board.count(id) / this.board.size) * 100);
  }

  private updateHud(p: PlayerRt, instant = false): void {
    const mine = this.board.count(p.id) / this.board.size;
    const theirs = this.board.count(other(p.id)) / this.board.size;
    p.shownPct = instant ? mine : p.shownPct + (mine - p.shownPct) * 0.12;
    const myPct = Math.round(mine * 100);
    const theirPct = Math.round(theirs * 100);
    if (p.myPct.textContent !== `${myPct}%`) p.myPct.textContent = `${myPct}%`;
    if (p.theirPct.textContent !== `${theirPct}%`) p.theirPct.textContent = `${theirPct}%`;
    p.myBar.style.width = `${(p.shownPct * 100).toFixed(1)}%`;
    p.theirBar.style.width = `${(theirs * 100).toFixed(1)}%`;

    const limit = this.settings.duration;
    let t: string;
    let hurry = false;
    if (limit > 0) {
      const left = Math.max(0, Math.ceil(limit - this.elapsed / 1000));
      t = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      hurry = left <= 10 && this.state === 'playing';
    } else {
      const s = Math.floor(this.elapsed / 1000);
      t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (p.timeEl.textContent !== t) p.timeEl.textContent = t;
    p.timeEl.classList.toggle('hurry', hurry);

    const streak = p.streak >= 2 ? `🔥${p.streak}` : '';
    if (p.streakBadge.textContent !== streak) {
      p.streakBadge.textContent = streak;
      if (streak) pulse(p.streakBadge, 'pop', 400);
    }
    p.panel.classList.toggle('on-fire', p.streak >= 5);
  }

  private float(p: PlayerRt, text: string, cls: string, delay = 0): void {
    const el = h('div', { class: `float ${cls}`, text });
    el.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 50)}px`);
    el.style.animationDelay = `${delay}ms`;
    el.addEventListener('animationend', () => el.remove());
    p.floats.append(el);
  }

  private center(el: Element): [number, number] {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  private onPaint(e: PaintEvent): void {
    const color = e.to === 0 ? '#8b86b8' : this.players[e.to].color.main;
    if (this.finale) {
      if (Math.random() < 0.35) this.fx.splat(e.x, e.y, color, 3, 0.8);
      sfx.pop(false);
      return;
    }
    const stolen = e.from !== 0 && e.to !== 0;
    this.fx.splat(e.x, e.y, color, stolen ? 9 : 5, stolen ? 1.2 : 0.9);
    if (stolen) {
      this.fx.splat(e.x, e.y, this.players[e.from as PlayerId].color.light, 4, 0.7);
      this.fx.ring(e.x, e.y, '#ffffff', this.view.cell);
    }
    if (e.to === 0) sfx.shrink();
    else sfx.pop(stolen);
  }

  // ---------------------------------------------------------------- overlays

  private actions(list: { label: string; icon: string; primary?: boolean; fn: () => void }[]): HTMLElement {
    const row = h('div', { class: 'dual-actions' });
    for (const a of list) {
      const b = h('button', { class: `btn ${a.primary ? 'btn-primary' : ''}`, html: `${a.icon}<span>${a.label}</span>` });
      b.addEventListener('click', () => {
        sfx.tap();
        a.fn();
      });
      row.append(b);
    }
    return row;
  }

  /** Overlay split in two halves, each facing its player. */
  private showDual(kind: string, content: (p: PlayerRt) => HTMLElement[]): void {
    const halves = [this.players[2], this.players[1]].map((p) => {
      const half = h('div', { class: `dual-half p${p.id}` }, h('div', { class: 'dual-card' }, ...content(p)));
      applyColorVars(half, p.color);
      return half;
    });
    this.overlayHost.replaceChildren(h('div', { class: `dual ${kind}` }, ...halves));
  }

  private showResults(winner: PlayerId | 0, reason: 'ko' | 'time'): void {
    this.showDual('results', (p) => {
      const won = winner === p.id;
      const lost = winner !== 0 && !won;
      const title = won ? 'GANHASTE!' : lost ? 'PERDESTE!' : 'EMPATE!';
      const emoji = won ? '🏆' : lost ? '😵' : '🤝';
      let sub: string;
      if (won) sub = reason === 'ko' ? 'Conquistaste o tabuleiro todo!' : 'Acabou o tempo e tinhas mais território!';
      else if (lost) sub = reason === 'ko' ? 'Ficaste sem território… Revanche?' : 'Por um triz! Para a próxima é tua.';
      else sub = 'Exatamente o mesmo território!';
      const total = p.correct + p.wrong;
      const acc = total ? Math.round((p.correct / total) * 100) : 0;
      const fastest = Number.isFinite(p.fastest) ? `${(p.fastest / 1000).toFixed(1).replace('.', ',')}s` : '—';
      const stat = (v: string, l: string) => h('div', { class: 'stat' }, h('b', { text: v }), h('span', { text: l }));
      return [
        h('div', { class: `dual-title ${won ? 'won' : lost ? 'lost' : ''}`, text: `${emoji} ${title}` }),
        h('div', { class: 'dual-sub', text: sub }),
        h('div', { class: 'stats' },
          stat(`${p.correct}/${total}`, `acertos (${acc}%)`),
          stat(`${p.bestStreak}`, 'melhor série'),
          stat(fastest, 'mais rápida'),
        ),
        this.actions([
          { label: 'Revanche', icon: ICONS.again, primary: true, fn: () => this.cb.onRematch() },
          { label: 'Menu', icon: ICONS.home, fn: () => this.cb.onMenu() },
        ]),
      ];
    });
  }

  // -------------------------------------------------------------- keyboard

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
      if (!this.back() && this.state === 'over') this.cb.onMenu();
      return;
    }
    for (const id of [1, 2] as PlayerId[]) {
      const i = KEYS[id].findIndex((keys) => keys.includes(k));
      if (i >= 0) {
        const b = this.players[id].buttons[i];
        pulse(b, 'pressed', 150);
        this.answer(id, i);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ bots

  private scheduleBot(p: PlayerRt): void {
    if (!this.opts.bots?.includes(p.id)) return;
    window.clearTimeout(this.botTimers[p.id]);
    const effort = (p.question?.difficulty ?? 0) * 2 + (p.question?.stage ?? 1);
    const delay = 900 + Math.random() * (1200 + effort * 250);
    this.botTimers[p.id] = window.setTimeout(() => {
      const q = p.question;
      if (!q || this.state !== 'playing') return;
      const right = Math.random() < 0.82;
      const i = right ? q.options.indexOf(q.answer) : q.options.findIndex((o) => o !== q.answer);
      this.answer(p.id, i);
    }, delay);
  }

  private stopBots(): void {
    for (const id of [1, 2] as PlayerId[]) window.clearTimeout(this.botTimers[id]);
  }

  destroy(): void {
    this.stopBots();
    for (const id of this.timers) window.clearTimeout(id);
    for (const p of this.each()) window.clearTimeout(p.timer);
    window.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
    this.fx.clear();
    this.el.remove();
  }
}
