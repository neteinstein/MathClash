/**
 * Cute blob avatars drawn in SVG. Colours come from the CSS variables
 * --c / --cd / --cl set on a parent, so one markup works for every colour.
 */

export const AVATAR_NAMES = ['Bolinha', 'Antena', 'Diabrete', 'Gatito', 'Coelho', 'Rebento'];
export const AVATAR_COUNT = AVATAR_NAMES.length;

export type Mood = 'idle' | 'happy' | 'sad' | 'shock' | 'win' | 'lose';

const INK = '#1a1240';

function accessoryBack(v: number): string {
  switch (v) {
    case 3: // cat ears
      return `
        <path class="av-fill" d="M24 52 L26 10 L56 30 Z"/>
        <path class="av-fill" d="M96 52 L94 10 L64 30 Z"/>
        <path class="av-light" d="M30 42 L31 20 L48 32 Z"/>
        <path class="av-light" d="M90 42 L89 20 L72 32 Z"/>`;
    case 4: // bunny ears
      return `
        <ellipse class="av-fill" cx="44" cy="8" rx="9" ry="26" transform="rotate(-14 44 8)"/>
        <ellipse class="av-fill" cx="76" cy="8" rx="9" ry="26" transform="rotate(14 76 8)"/>
        <ellipse class="av-light" cx="44" cy="10" rx="4.5" ry="18" transform="rotate(-14 44 10)"/>
        <ellipse class="av-light" cx="76" cy="10" rx="4.5" ry="18" transform="rotate(14 76 10)"/>`;
    default:
      return '';
  }
}

function accessoryFront(v: number): string {
  switch (v) {
    case 0: // little hair tuft
      return `<path d="M52 24 Q54 8 62 20 Q64 10 72 16" fill="none" stroke="var(--cd)" stroke-width="4" stroke-linecap="round"/>`;
    case 1: // antenna
      return `
        <path d="M60 24 Q58 10 66 2" fill="none" stroke="var(--cd)" stroke-width="4" stroke-linecap="round"/>
        <circle class="av-antenna" cx="66" cy="0" r="7" fill="#fde047" stroke="var(--cd)" stroke-width="3"/>`;
    case 2: // little horns
      return `
        <path d="M34 34 Q24 16 22 6 Q38 14 46 28 Z" fill="var(--cd)"/>
        <path d="M86 34 Q96 16 98 6 Q82 14 74 28 Z" fill="var(--cd)"/>`;
    case 5: // sprout
      return `
        <path d="M60 24 Q60 12 60 6" fill="none" stroke="#15803d" stroke-width="4" stroke-linecap="round"/>
        <path d="M60 8 Q48 -4 38 4 Q48 14 60 8 Z" fill="#4ade80" stroke="#15803d" stroke-width="2"/>
        <path d="M60 8 Q72 -6 84 2 Q74 14 60 8 Z" fill="#4ade80" stroke="#15803d" stroke-width="2"/>`;
    default:
      return '';
  }
}

/** Returns SVG markup for an avatar variant. */
export function avatarSVG(variant: number): string {
  const v = ((variant % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  return `
<svg class="avatar-svg" viewBox="0 -14 120 134" aria-hidden="true">
  <ellipse class="av-shadow" cx="60" cy="112" rx="34" ry="6" fill="rgba(0,0,0,.28)"/>
  <g class="av-body">
    ${accessoryBack(v)}
    <path class="av-fill" d="M60 20 C90 20 104 44 104 72 C104 98 86 108 60 108 C34 108 16 98 16 72 C16 44 30 20 60 20 Z"/>
    <path class="av-dark" opacity=".35" d="M20 82 C26 100 42 108 60 108 C78 108 94 100 100 82 C92 96 78 102 60 102 C42 102 28 96 20 82 Z"/>
    <ellipse cx="42" cy="38" rx="12" ry="6.5" fill="#fff" opacity=".35" transform="rotate(-28 42 38)"/>
    ${accessoryFront(v)}
    <g class="av-eyes av-eyes-open">
      <g class="av-eye"><ellipse cx="45" cy="62" rx="10" ry="11.5" fill="#fff"/><circle class="av-pupil" cx="47" cy="64" r="5.5" fill="${INK}"/><circle cx="49" cy="61" r="2" fill="#fff"/></g>
      <g class="av-eye"><ellipse cx="75" cy="62" rx="10" ry="11.5" fill="#fff"/><circle class="av-pupil" cx="77" cy="64" r="5.5" fill="${INK}"/><circle cx="79" cy="61" r="2" fill="#fff"/></g>
    </g>
    <g class="av-eyes av-eyes-happy" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round">
      <path d="M36 65 Q45 53 54 65"/><path d="M66 65 Q75 53 84 65"/>
    </g>
    <g class="av-eyes av-eyes-sad" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round">
      <path d="M37 58 Q45 66 53 62"/><path d="M83 58 Q75 66 67 62"/>
    </g>
    <g class="av-eyes av-eyes-ko" stroke="${INK}" stroke-width="4.5" stroke-linecap="round">
      <path d="M38 55 L52 69 M52 55 L38 69"/><path d="M68 55 L82 69 M82 55 L68 69"/>
    </g>
    <ellipse cx="33" cy="78" rx="7" ry="4.5" fill="#ff7aa2" opacity=".55"/>
    <ellipse cx="87" cy="78" rx="7" ry="4.5" fill="#ff7aa2" opacity=".55"/>
    <path class="av-mouth av-mouth-idle" d="M52 80 Q60 88 68 80" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <g class="av-mouth av-mouth-happy">
      <path d="M46 78 Q60 100 74 78 Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <ellipse cx="60" cy="90" rx="7" ry="4" fill="#ff6b8b"/>
    </g>
    <path class="av-mouth av-mouth-sad" d="M50 90 Q60 79 70 90" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <ellipse class="av-mouth av-mouth-shock" cx="60" cy="86" rx="6.5" ry="8.5" fill="${INK}"/>
    <path class="av-tear" d="M86 66 Q82 74 86 78 Q90 74 86 66 Z" fill="#7dd3fc"/>
    <g class="av-crown">
      <path d="M36 26 L40 2 L51 16 L60 -6 L69 16 L80 2 L84 26 Z" fill="#facc15" stroke="#a16207" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="60" cy="16" r="4" fill="#ef4444"/><circle cx="46" cy="20" r="3" fill="#3b82f6"/><circle cx="74" cy="20" r="3" fill="#22c55e"/>
    </g>
  </g>
</svg>`;
}

/**
 * A live avatar element: knows how to change mood and play reactions.
 */
export class Avatar {
  readonly el: HTMLDivElement;
  private variant: number;
  private moodTimer = 0;
  private baseMood: Mood = 'idle';

  constructor(variant: number, className = '') {
    this.variant = variant;
    this.el = document.createElement('div');
    this.el.className = `avatar mood-idle ${className}`;
    this.el.innerHTML = avatarSVG(variant);
  }

  setVariant(v: number): void {
    this.variant = v;
    this.el.innerHTML = avatarSVG(v);
  }

  getVariant(): number {
    return this.variant;
  }

  /** Persistent mood (e.g. win / lose at the end). */
  setMood(mood: Mood): void {
    this.baseMood = mood;
    window.clearTimeout(this.moodTimer);
    this.applyMood(mood);
  }

  /** Temporary reaction that falls back to the base mood. */
  react(mood: Mood, anim: 'jump' | 'shake' | 'squish' | 'spin' | null, ms = 700): void {
    this.applyMood(mood);
    if (anim) this.play(anim);
    window.clearTimeout(this.moodTimer);
    this.moodTimer = window.setTimeout(() => this.applyMood(this.baseMood), ms);
  }

  play(anim: 'jump' | 'shake' | 'squish' | 'spin'): void {
    this.el.classList.remove('a-jump', 'a-shake', 'a-squish', 'a-spin');
    void this.el.offsetWidth; // restart CSS animation
    this.el.classList.add(`a-${anim}`);
  }

  private applyMood(m: Mood): void {
    this.el.classList.remove('mood-idle', 'mood-happy', 'mood-sad', 'mood-shock', 'mood-win', 'mood-lose');
    this.el.classList.add(`mood-${m}`);
  }
}

/** The little devil sent after 10 correct answers in a row. */
export function devilSVG(): string {
  return `
<svg class="devil-svg" viewBox="0 0 100 100" aria-hidden="true">
  <path d="M72 78 Q96 84 90 60 Q88 50 95 44" fill="none" stroke="#7f1d1d" stroke-width="5" stroke-linecap="round"/>
  <path d="M95 36 L101 48 L89 46 Z" fill="#7f1d1d"/>
  <path d="M27 40 Q16 18 26 6 Q30 24 41 32 Z" fill="#7f1d1d"/>
  <path d="M73 40 Q84 18 74 6 Q70 24 59 32 Z" fill="#7f1d1d"/>
  <ellipse cx="50" cy="60" rx="32" ry="30" fill="#dc2626"/>
  <path d="M20 66 C24 84 38 90 50 90 C62 90 76 84 80 66 C74 80 62 85 50 85 C38 85 26 80 20 66 Z" fill="#991b1b"/>
  <ellipse cx="38" cy="42" rx="9" ry="5" fill="#fff" opacity=".3" transform="rotate(-25 38 42)"/>
  <path d="M31 44 L46 51" stroke="#1f0a14" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M69 44 L54 51" stroke="#1f0a14" stroke-width="4.5" stroke-linecap="round"/>
  <ellipse cx="40" cy="57" rx="6.5" ry="6" fill="#fde047"/>
  <ellipse cx="60" cy="57" rx="6.5" ry="6" fill="#fde047"/>
  <ellipse cx="42" cy="58" rx="2" ry="4.5" fill="#1f0a14"/>
  <ellipse cx="62" cy="58" rx="2" ry="4.5" fill="#1f0a14"/>
  <path d="M32 67 Q50 86 68 67 Q50 75 32 67 Z" fill="#1f0a14"/>
  <path d="M41 70 L44 76 L46 71 Z M59 70 L56 76 L54 71 Z" fill="#fff"/>
</svg>`;
}
