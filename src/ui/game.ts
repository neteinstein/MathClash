import { Board, playerIds, type CellChange, type PlayerId } from '../board';
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
import { ANGLE, contentBox, frame, measureDepth, overlayFrame, placeSeat, sideOf, type Side } from './seats';

type State = 'countdown' | 'playing' | 'paused' | 'ending' | 'over';

const KEYS: Record<PlayerId, string[][]> = {
  1: [['1', 'a'], ['2', 's'], ['3', 'd'], ['4', 'f']],
  2: [['7', 'h'], ['8', 'j'], ['9', 'k'], ['0', 'l']],
  3: [['q'], ['w'], ['e'], ['r']],
  4: [['y'], ['u'], ['i'], ['o']],
};

const MEDALS = ['', '🥇', '🥈', '🥉', '🏅'];

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
  /** One bar per opponent, stacked from the right end of the tug bar. */
  theirBars: { id: PlayerId; el: HTMLElement }[];
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
  /** Devil questions waiting for this player (sent by an opponent's 10-streaks). */
  devilsPending: number;
  /** The question on screen is a devil question. */
  devilActive: boolean;
  /** The little devil sitting next to this player's avatar. */
  devilEl: HTMLDivElement | null;
  /** Lost every cell (3-4 players: the others play on). */
  out: boolean;
}

export interface GameCallbacks {
  onMenu(): void;
  onRematch(): void;
}

export interface GameOptions {
  /** Players controlled by the computer (only used for demos/testing). */
  bots?: PlayerId[];
  /** How many play (2-4). With 3-4 there is one player on each side of the screen. */
  players?: number;
}

export class GameScreen {
  readonly el: HTMLDivElement;
  private readonly arena: HTMLDivElement;
  private readonly overlayHost: HTMLDivElement;
  private board!: Board;
  private view!: BoardView;
  private readonly players: PlayerRt[];
  /** 3-4 players around the screen (otherwise the classic two-player layout). */
  private readonly multi: boolean;
  private state: State = 'countdown';
  private elapsed = 0;
  private lastSecond = -1;
  private orientation: Orientation;
  /** 3 players on a tablet lying sideways: player 2 on the right and the triangle pointing up. */
  private turned = false;
  private readonly timers = new Set<number>();
  private finale = false;
  /** Knocked-out players, first one out first. */
  private readonly outOrder: PlayerId[] = [];
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
    const ids = playerIds(opts.players ?? 2);
    this.multi = ids.length > 2;
    // With players all around, the board is drawn as is (player 1 at the bottom).
    this.orientation = !this.multi && isLandscape() ? 'landscape' : 'portrait';
    this.el = h('div', { class: `screen game ${this.multi ? 'multi' : this.orientation}` });
    this.arena = h('div', { class: 'arena' });
    this.overlayHost = h('div', { class: 'overlay-host' });
    this.players = ids.map((id) => this.makePlayer(id, ids));
    if (this.multi) this.el.append(this.arena, ...this.players.map((p) => p.panel), this.overlayHost);
    else this.el.append(this.player(2).panel, this.arena, this.player(1).panel, this.overlayHost);
    window.addEventListener('keydown', this.keyHandler);
    document.addEventListener('visibilitychange', this.visHandler);
  }

  // ------------------------------------------------------------------ setup

  private player(id: PlayerId): PlayerRt {
    return this.players.find((p) => p.id === id)!;
  }

  /** Rotation that makes things face a player (degrees, clockwise). */
  private angleOf(id: PlayerId): number {
    // Around the screen they face their own side of the board (on a triangle, a slanted one).
    if (this.multi) return this.view ? this.view.homeAngle(id) : ANGLE[this.seat(id)];
    return this.orientation === 'portrait' && id === 2 ? 180 : 0;
  }

  /** Which side of the screen a player sits on (3-4 players). */
  private seat(id: PlayerId): Side {
    return sideOf(id, this.players.length, this.turned);
  }

  /** How the board is turned on screen; the triangle (3 players) points up when the tablet lies sideways. */
  private boardTurn(): Orientation {
    if (!this.multi) return this.orientation;
    return this.turned ? 'landscape' : 'portrait';
  }

  private makePlayer(id: PlayerId, ids: PlayerId[]): PlayerRt {
    const setup = this.settings.players[id];
    const color = COLORS[setup.color];
    const opponents = ids.filter((q) => q !== id);
    const panel = h('section', { class: `panel p${id}` });
    applyColorVars(panel, color);
    panel.style.setProperty('--ec', COLORS[this.settings.players[opponents[0]].color].main);

    const pauseBtn = h('button', { class: 'hud-btn', html: ICONS.pause, attrs: { 'aria-label': 'Pausa' } });
    onPress(pauseBtn, () => this.pause());
    const myPct = h('b', { class: 'tug-pct mine', text: '0%' });
    const theirPct = h('b', { class: 'tug-pct theirs', text: '0%' });
    const myBar = h('i', { class: 'tug-fill mine' });
    const theirBars = opponents.map((q) => {
      const el = h('i', { class: 'tug-fill theirs' });
      el.style.background = COLORS[this.settings.players[q].color].main;
      return { id: q, el };
    });
    const tug = h('div', { class: 'tug' }, myPct, h('div', { class: 'tug-bar' }, myBar, ...theirBars.map((b) => b.el)), theirPct);
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
    const outMsg = h('div', { class: 'out-msg' }, h('b', { text: '😵 FORA!' }), h('span', { text: 'Ficaste sem território' }));
    panel.append(header, h('div', { class: 'qwrap' }, qcard), answers, countdown, outMsg);

    const avatar = new Avatar(setup.avatar);
    const avatarWrap = h('div', { class: `avatar-wrap p${id}` }, avatar.el);
    applyColorVars(avatarWrap, color);

    return {
      id, color, difficulty: setup.difficulty, avatar, avatarWrap, panel, qcard, qtext,
      streakBadge, levelBadge, buttons, floats, timeEl, myPct, theirPct, myBar, theirBars, countdown,
      question: null, shownAt: 0, busy: true, timer: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0,
      fastest: Infinity, recent: [], shownPct: 0, devilsPending: 0, devilActive: false, devilEl: null, out: false,
    };
  }

  /** Call once the element is in the DOM: sizes the board to the screen and starts the countdown. */
  start(): void {
    if (this.multi) this.layoutSeats();
    const r = this.arena.getBoundingClientRect();
    const ids = this.players.map((p) => p.id);
    if (ids.length === 3) {
      // Three players: a triangle, one side facing each of them.
      this.board = Board.triangle(BoardView.triangleSizeFor(r.width, r.height, this.boardTurn()), ids);
    } else {
      const [w, hCells] = this.multi ? GameScreen.multiBoardSize(r.width, r.height) : this.boardSize(r.width, r.height);
      this.board = new Board(w, hCells, ids);
    }
    const colors: Partial<Record<PlayerId, PlayerColor>> = {};
    for (const p of this.players) colors[p.id] = p.color;
    this.view = new BoardView(this.board, colors);
    this.view.onPaint = (e) => this.onPaint(e);
    this.arena.append(this.view.canvas, ...this.players.map((p) => p.avatarWrap), ...this.players.map((p) => p.floats));
    this.layout();
    for (const p of this.players) this.updateHud(p, true);
    this.runCountdown();
  }

  /** Two players: cells across the screen and along the axis between them. */
  private boardSize(width: number, height: number): [number, number] {
    const portrait = this.orientation === 'portrait';
    const across = portrait ? width : height;
    const along = portrait ? height : width;
    let w = Math.max(9, Math.min(13, Math.round(across / 44)));
    if (w % 2 === 0) w--;
    const s0 = BoardView.cellSizeFor(across, 1e9, w, 1, 'portrait');
    return [w, Math.max(8, Math.min(16, Math.round(along / s0 - AVATAR_MARGIN * 2)))];
  }

  /** 4 players: odd sizes so the avatars on every side sit in the middle of their edge. */
  static multiBoardSize(width: number, height: number): [number, number] {
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    let n = Math.max(9, Math.min(13, Math.round(short / 46)));
    if (n % 2 === 0) n--;
    const s0 = short / (n + AVATAR_MARGIN * 2);
    let m = Math.max(n, Math.min(21, Math.round(long / s0 - AVATAR_MARGIN * 2)));
    if (m % 2 === 0) m--;
    return width <= height ? [n, m] : [m, n];
  }

  layout(): void {
    if (this.multi) this.layoutSeats();
    else {
      const o: Orientation = isLandscape() ? 'landscape' : 'portrait';
      if (o !== this.orientation) {
        this.el.classList.replace(this.orientation, o);
        this.orientation = o;
      }
    }
    if (!this.view) return;
    const o = this.orientation;
    const r = this.arena.getBoundingClientRect();
    this.view.layout(r.width, r.height, this.boardTurn());
    const size = this.view.cell * 1.7;
    const unit = Math.max(15, Math.min(30, this.view.cell * 0.56));
    for (const p of this.players) {
      const [x, y] = this.view.avatarAnchor(p.id);
      const s = p.avatarWrap.style;
      s.width = s.height = `${size}px`;
      s.left = `${x - size / 2}px`;
      s.top = `${y - size / 2}px`;
      // Message spot: just past the avatar, on the board, growing towards the middle.
      const reach = size / 2 + 6;
      let fx = x;
      let fy = y;
      if (this.multi) {
        // Avatar and messages face the player, growing towards the middle of the board.
        const deg = this.angleOf(p.id);
        const a = (deg * Math.PI) / 180;
        fx += Math.sin(a) * reach;
        fy -= Math.cos(a) * reach;
        p.avatarWrap.style.setProperty('rotate', `${deg}deg`);
        p.floats.style.setProperty('rotate', `${deg}deg`);
      } else if (o === 'portrait') fy = p.id === 1 ? y - reach : y + reach;
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

  /** 3-4 players: a panel on each side of the screen, facing its player, and the board in the middle. */
  private layoutSeats(): void {
    const box = contentBox(this.el);
    this.turned = this.players.length === 3 && box.w > box.h;
    this.el.style.setProperty('--vm', `${Math.min(box.w, box.h) / 100}px`);
    const panels = new Map(this.players.map((p) => [this.seat(p.id), p.panel]));
    const { strips, middle } = frame(box, (side, len) => {
      const el = panels.get(side);
      return el ? measureDepth(el, len) : 0;
    });
    for (const p of this.players) placeSeat(p.panel, this.seat(p.id), strips[this.seat(p.id)]);
    const s = this.arena.style;
    s.left = `${middle.x}px`;
    s.top = `${middle.y}px`;
    s.width = `${middle.w}px`;
    s.height = `${middle.h}px`;
    this.layoutOverlay();
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
        for (const p of this.players) {
          p.countdown.textContent = txt;
          pulse(p.countdown, 'show', 900);
        }
        if (k < 3) sfx.count();
        else {
          sfx.go();
          this.state = 'playing';
          for (const p of this.players) {
            p.avatar.react('happy', 'jump');
            this.nextQuestion(p);
          }
        }
      }, 250 + k * 750);
    });
  }

  private nextQuestion(p: PlayerRt): void {
    if (p.out) return;
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
    const p = this.player(id);
    if (!p || this.state !== 'playing' || p.busy || p.out || !p.question) return;
    p.busy = true;
    const q = p.question;
    const btn = p.buttons[i];
    const now = performance.now();

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
      const stolen = new Map<PlayerId, number>();
      for (const c of changes) if (c.from !== 0) stolen.set(c.from, (stolen.get(c.from) ?? 0) + 1);

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
      if (isDevilStreak(p.streak)) {
        const target = this.devilTarget(p);
        if (target) this.sendDevil(p, target);
      }
      let totalStolen = 0;
      for (const [vid, n] of stolen) {
        const victim = this.player(vid);
        totalStolen += n;
        victim.avatar.react('shock', 'shake', 800);
        this.later(() => this.float(victim, `−${n}`, 'minus'), 250);
      }
      if (totalStolen >= 4) pulse(this.arena, 'shake', 400);
      this.updateHud(p);

      const alive = this.board.alive();
      const knockedOut = [...stolen.keys()].filter((vid) => !alive.includes(vid));
      if (alive.length <= 1) {
        for (const vid of knockedOut) this.knockOut(this.player(vid), false);
        this.state = 'ending';
        this.later(() => this.finish([id], 'ko'), changes.length * 55 + 600);
        return;
      }
      for (const vid of knockedOut) this.knockOut(this.player(vid), true);
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

  /**
   * A player lost their last cell. With 3-4 players the others play on
   * (`show`: their panel says so); otherwise the match is over anyway.
   */
  private knockOut(v: PlayerRt, show: boolean): void {
    if (v.out) return;
    v.out = true;
    v.busy = true;
    v.question = null;
    v.streak = 0;
    v.devilsPending = 0;
    v.devilActive = false;
    window.clearTimeout(v.timer);
    window.clearTimeout(this.botTimers[v.id]);
    this.outOrder.push(v.id);
    if (v.devilEl) this.dismissDevil(v, 'leave');
    if (!show) return;
    v.panel.classList.add('out');
    v.avatarWrap.classList.add('out');
    v.avatar.setMood('lose');
    v.avatar.play('shake');
    this.later(() => this.float(v, '😵 FORA!', 'combo c3'), 450);
    this.later(() => sfx.knockout(), 250);
    vibrate([60, 40, 120]);
  }

  /** Ranks every player: territory for those still in, then the knocked out, last one out first. */
  private placings(): Map<PlayerId, number> {
    const score = (p: PlayerRt) => (p.out ? this.outOrder.indexOf(p.id) - this.outOrder.length : this.board.count(p.id));
    const scores = this.players.map(score);
    return new Map(this.players.map((p, k) => [p.id, 1 + scores.filter((s) => s > scores[k]).length]));
  }

  private finish(winners: PlayerId[], reason: 'ko' | 'time'): void {
    if (this.state === 'over') return;
    this.state = 'over';
    const places = this.placings();
    this.stopBots();
    for (const p of this.players) {
      window.clearTimeout(p.timer);
      p.busy = true;
      p.devilsPending = 0;
      p.devilActive = false;
      if (p.devilEl) this.dismissDevil(p, 'leave');
    }
    const now = performance.now();
    if (winners.length === 1) {
      this.finale = true;
      const changes: CellChange[] = this.board.flood(winners[0]);
      this.view.queue(changes, now, 45, 380);
      const w = this.player(winners[0]);
      w.avatar.setMood('win');
      w.avatar.play('jump');
      for (const l of this.players) {
        if (l === w) continue;
        l.avatar.setMood('lose');
        l.avatar.play('shake');
      }
      w.avatarWrap.classList.add('winner');
      sfx.win();
      const maxOrder = changes.reduce((m, c) => Math.max(m, c.order), 0);
      this.later(() => this.fx.confetti([w.color.main, w.color.light, '#fde047', '#ffffff'], 3500), Math.min(1500, maxOrder * 45));
    } else {
      sfx.draw();
      for (const p of this.players) p.avatar.setMood(winners.includes(p.id) ? 'shock' : 'lose');
    }
    this.later(() => this.showResults(winners, reason, places), winners.length === 1 ? 1500 : 700);
  }

  // ------------------------------------------------------------------ pause

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    for (const p of this.players) window.clearTimeout(p.timer);
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
    for (const p of this.players) this.nextQuestion(p);
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
          // Most territory wins; a tie for the top is a draw between them.
          const counts = this.players.map((p) => this.board.count(p.id));
          const best = Math.max(...counts);
          const winners = this.players.filter((_, k) => counts[k] === best).map((p) => p.id);
          this.state = 'ending';
          for (const p of this.players) this.float(p, 'TEMPO!', 'combo c2');
          this.later(() => this.finish(winners, 'time'), 700);
        }
      }
    }
    for (const p of this.players) this.updateHud(p);
    this.view.draw(now);
  }

  // ------------------------------------------------------------------ devil

  /** Who gets the devil: the opponent with the most territory (the only one with 2 players). */
  private devilTarget(from: PlayerRt): PlayerRt | null {
    let best: PlayerRt | null = null;
    let bestCount = -1;
    for (const q of this.players) {
      if (q === from || q.out) continue;
      const n = this.board.count(q.id);
      if (n > bestCount) {
        best = q;
        bestCount = n;
      }
    }
    return best;
  }

  /** Where a player's devil sits: beside their avatar, on the board, facing them. */
  private devilSpot(id: PlayerId): { x: number; y: number; rot: number; size: number } {
    const [ax, ay] = this.view.avatarAnchor(id);
    const c = this.view.cell;
    const size = c * 1.45;
    if (this.orientation === 'landscape') {
      const side = id === 1 ? 1 : -1;
      return { x: ax + side * 0.35 * c, y: ay - 1.8 * c, rot: 0, size };
    }
    // To the player's right and a little towards the middle, in their own frame.
    const rot = this.angleOf(id);
    const a = (rot * Math.PI) / 180;
    const [rx, ry] = [Math.cos(a), Math.sin(a)];
    const [ux, uy] = [Math.sin(a), -Math.cos(a)];
    return { x: ax + (1.8 * rx + 0.35 * ux) * c, y: ay + (1.8 * ry + 0.35 * uy) * c, rot, size };
  }

  private placeDevil(el: HTMLDivElement, id: PlayerId): void {
    const { x, y, rot, size } = this.devilSpot(id);
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${rot}deg)`;
  }

  /** 10 in a row: a little devil flies across the board and hands an opponent a hard question. */
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
    let mx: number;
    let my: number;
    if (this.multi) {
      const dx = end.x - x0;
      const dy = end.y - y0;
      const len = Math.hypot(dx, dy) || 1;
      mx = (x0 + end.x) / 2 + (dy / len) * 2.5 * this.view.cell;
      my = (y0 + end.y) / 2 - (dx / len) * 2.5 * this.view.cell;
    } else {
      mx = (x0 + end.x) / 2 + (this.orientation === 'portrait' ? -2.5 : 0) * this.view.cell;
      my = (y0 + end.y) / 2 + (this.orientation === 'landscape' ? -2.5 : 0) * this.view.cell;
    }
    const startRot = this.angleOf(from.id);
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
      if (this.state === 'over' || this.state === 'ending' || to.out) {
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
    const size = this.board.size;
    const mine = this.board.count(p.id) / size;
    p.shownPct = instant ? mine : p.shownPct + (mine - p.shownPct) * 0.12;
    const myPct = Math.round(mine * 100);
    if (p.myPct.textContent !== `${myPct}%`) p.myPct.textContent = `${myPct}%`;
    p.myBar.style.width = `${(p.shownPct * 100).toFixed(1)}%`;
    // Opponents fill the bar from the other end; the number shows the strongest one.
    let right = 0;
    let lead = p.theirBars[0];
    let leadShare = -1;
    for (const b of p.theirBars) {
      const share = this.board.count(b.id) / size;
      b.el.style.right = `${(right * 100).toFixed(1)}%`;
      b.el.style.width = `${(share * 100).toFixed(1)}%`;
      right += share;
      if (share > leadShare) {
        leadShare = share;
        lead = b;
      }
    }
    const theirPct = `${Math.round(leadShare * 100)}%`;
    if (p.theirPct.textContent !== theirPct) p.theirPct.textContent = theirPct;
    if (this.multi) p.theirPct.style.color = this.player(lead.id).color.main;

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
    const color = e.to === 0 ? '#8b86b8' : this.player(e.to).color.main;
    if (this.finale) {
      if (Math.random() < 0.35) this.fx.splat(e.x, e.y, color, 3, 0.8);
      sfx.pop(false);
      return;
    }
    const stolen = e.from !== 0 && e.to !== 0;
    this.fx.splat(e.x, e.y, color, stolen ? 9 : 5, stolen ? 1.2 : 0.9);
    if (stolen) {
      this.fx.splat(e.x, e.y, this.player(e.from as PlayerId).color.light, 4, 0.7);
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

  /** Overlay with one card per player, each facing its player (two halves with 2 players). */
  private showDual(kind: string, content: (p: PlayerRt) => HTMLElement[]): void {
    const order = this.multi ? this.players : [this.player(2), this.player(1)];
    const halves = order.map((p) => {
      const half = h('div', { class: `dual-half p${p.id}`, attrs: { 'data-id': String(p.id) } }, h('div', { class: 'dual-card' }, ...content(p)));
      applyColorVars(half, p.color);
      return half;
    });
    this.overlayHost.replaceChildren(h('div', { class: `dual ${kind}` }, ...halves));
    this.layoutOverlay();
  }

  /** 3-4 players: each card sits on its player's side of the screen. */
  private layoutOverlay(): void {
    if (!this.multi) return;
    const halves = this.overlayHost.querySelectorAll<HTMLElement>('.dual-half');
    if (!halves.length) return;
    const strips = overlayFrame(contentBox(this.el));
    for (const el of halves) {
      const side = this.seat(Number(el.dataset.id) as PlayerId);
      placeSeat(el, side, strips[side]);
    }
  }

  private showResults(winners: PlayerId[], reason: 'ko' | 'time', places: Map<PlayerId, number>): void {
    const draw = winners.length > 1;
    this.showDual('results', (p) => {
      const won = !draw && winners[0] === p.id;
      const tied = draw && winners.includes(p.id);
      const title = won ? 'GANHASTE!' : tied ? 'EMPATE!' : 'PERDESTE!';
      const emoji = won ? '🏆' : tied ? '🤝' : '😵';
      let sub: string;
      if (won) sub = reason === 'ko' ? 'Conquistaste o tabuleiro todo!' : 'Acabou o tempo e tinhas mais território!';
      else if (tied) sub = 'Exatamente o mesmo território!';
      else sub = p.out ? 'Ficaste sem território… Desforra?' : 'Por um triz! Para a próxima é tua.';
      const total = p.correct + p.wrong;
      const acc = total ? Math.round((p.correct / total) * 100) : 0;
      const fastest = Number.isFinite(p.fastest) ? `${(p.fastest / 1000).toFixed(1).replace('.', ',')}s` : '—';
      const stat = (v: string, l: string) => h('div', { class: 'stat' }, h('b', { text: v }), h('span', { text: l }));
      const place = places.get(p.id) ?? 1;
      return [
        h('div', { class: `dual-title ${won ? 'won' : tied ? '' : 'lost'}`, text: `${emoji} ${title}` }),
        this.multi ? h('div', { class: 'dual-place', text: `${MEDALS[place]} ${place}.º lugar` }) : null,
        h('div', { class: 'dual-sub', text: sub }),
        h('div', { class: 'stats' },
          stat(`${p.correct}/${total}`, `acertos (${acc}%)`),
          stat(`${p.bestStreak}`, 'melhor série'),
          stat(fastest, 'mais rápida'),
        ),
        this.actions([
          { label: 'Desforra', icon: ICONS.again, primary: true, fn: () => this.cb.onRematch() },
          { label: 'Menu', icon: ICONS.home, fn: () => this.cb.onMenu() },
        ]),
      ].filter((el): el is HTMLElement => el !== null);
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
    for (const p of this.players) {
      const i = KEYS[p.id].findIndex((keys) => keys.includes(k));
      if (i >= 0) {
        pulse(p.buttons[i], 'pressed', 150);
        this.answer(p.id, i);
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
    for (const p of this.players) window.clearTimeout(this.botTimers[p.id]);
  }

  destroy(): void {
    this.stopBots();
    for (const id of this.timers) window.clearTimeout(id);
    for (const p of this.players) window.clearTimeout(p.timer);
    window.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('visibilitychange', this.visHandler);
    this.fx.clear();
    this.el.remove();
  }
}
