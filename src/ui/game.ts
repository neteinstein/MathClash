import { Board, other, type CellChange, type PlayerId } from '../board';
import { BoardView, AVATAR_MARGIN, type Orientation, type PaintEvent } from '../renderer';
import type { Fx } from '../fx';
import { Avatar } from '../avatar';
import { COLORS, applyColorVars, type PlayerColor } from '../colors';
import { DIFFICULTIES, formatNumber, generateQuestion, type Question } from '../questions';
import { COMBO_LABELS, WRONG_LOCK_MS, penalty, reward, stageFor } from '../rules';
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
    const qcard = h('div', { class: 'qcard' }, qtext, streakBadge, levelBadge, h('div', { class: 'badge gold', text: '⭐ x2' }));
    const floats = h('div', { class: 'floats' });
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
    panel.append(header, h('div', { class: 'qwrap' }, qcard, floats), answers, countdown);

    const avatar = new Avatar(setup.avatar);
    const avatarWrap = h('div', { class: `avatar-wrap p${id}` }, avatar.el);
    applyColorVars(avatarWrap, color);

    return {
      id, color, difficulty: setup.difficulty, avatar, avatarWrap, panel, qcard, qtext,
      streakBadge, levelBadge, buttons, floats, timeEl, myPct, theirPct, myBar, theirBar, countdown,
      question: null, shownAt: 0, busy: true, timer: 0, correct: 0, wrong: 0, streak: 0, bestStreak: 0,
      fastest: Infinity, recent: [], shownPct: 0,
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
    this.arena.append(this.view.canvas, this.players[1].avatarWrap, this.players[2].avatarWrap);
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
    for (const p of this.each()) {
      const [x, y] = this.view.avatarAnchor(p.id);
      const s = p.avatarWrap.style;
      s.width = s.height = `${size}px`;
      s.left = `${x - size / 2}px`;
      s.top = `${y - size / 2}px`;
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
    const stage = stageFor(p.difficulty, p.correct);
    const q = generateQuestion(p.difficulty, stage, { avoid: p.recent });
    p.recent = [...p.recent.slice(-5), q.text];
    p.question = q;
    p.shownAt = this.elapsed;
    p.busy = false;
    p.qtext.textContent = q.text;
    p.qcard.classList.toggle('golden', q.golden);
    p.qcard.classList.toggle('long', q.text.length > 9);
    p.levelBadge.textContent = `${DIFFICULTIES[q.difficulty].emoji} Nv ${q.stage}`;
    pulse(p.qcard, 'enter', 400);
    if (q.golden) sfx.golden();
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

    if (q.options[i] === q.answer) {
      p.correct++;
      p.streak++;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      const answerMs = this.elapsed - p.shownAt;
      p.fastest = Math.min(p.fastest, answerMs);
      const rw = reward({ boardSize: this.board.size, elapsedMs: this.elapsed, streak: p.streak, answerMs, golden: q.golden });
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
        const [x, y] = this.center(p.qcard);
        this.fx.stars(x, y, 10);
      }
      if (rw.fast) this.float(p, '⚡ RÁPIDO!', 'fast', 200);
      if (rw.combo > 0 && (p.streak === 3 || p.streak === 5 || p.streak === 8 || p.streak % 5 === 0)) {
        this.float(p, `${COMBO_LABELS[rw.combo]} x${p.streak}`, `combo c${rw.combo}`, 300);
      }
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
