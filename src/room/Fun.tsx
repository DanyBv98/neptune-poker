import { useCallback, useEffect, useRef, useState } from 'react';
import { NEPTUNE_FACTS } from '../lib/domain';
import { supabase } from '../lib/supabase';
import type { FunEvent } from '../lib/types';
import { flashTitle, prefersReducedMotion, sfx, usePrefs } from '../lib/util';
import { useTeam } from '../state/TeamContext';
import { useToast } from '../state/Toasts';
import { THROWABLES } from './Stage';

export interface FeedItem {
  id: number;
  text: string;
  at: number;
}

// ------------------------------------------------------------------ overlay: flying things, bubbles, confetti
interface Sprite {
  id: number;
  emoji: string;
  kind: 'throw' | 'float' | 'confetti' | 'poke';
  x: number;
  y: number;
  tx?: number;
  ty?: number;
}

function seatCenter(memberId: string) {
  const el = document.querySelector<HTMLElement>(`[data-seat="${memberId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
}

function bump(el: HTMLElement | undefined, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 900);
}

export function FunLayer({ pushFeed, celebrate }: { pushFeed: (t: string) => void; celebrate: number }) {
  const { onFun, me, memberById } = useTeam();
  const toast = useToast();
  const [prefs] = usePrefs();
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const seq = useRef(0);
  const add = useCallback((s: Omit<Sprite, 'id'>) => {
    const id = ++seq.current;
    setSprites((xs) => [...xs.slice(-60), { ...s, id }]);
    window.setTimeout(() => setSprites((xs) => xs.filter((x) => x.id !== id)), 2200);
  }, []);

  useEffect(
    () =>
      onFun((e: FunEvent) => {
        const from = memberById(e.from);
        const fromName = e.from === me.id ? 'You' : from?.display_name ?? 'Someone';
        const motion = prefs.effects && !prefersReducedMotion();
        if (e.kind === 'react') {
          const c = seatCenter(e.from);
          if (prefs.effects) {
            for (let i = 0; i < 3; i++)
              add({ emoji: e.emoji, kind: 'float', x: (c?.x ?? window.innerWidth - 120) + (Math.random() - 0.5) * 40, y: (c?.y ?? window.innerHeight - 80) - i * 8 });
          }
          return;
        }
        if (e.kind === 'score') {
          pushFeed(`🫧 ${fromName} popped ${e.score} points of bubbles`);
          return;
        }
        const target = memberById(e.to);
        const toName = e.to === me.id ? 'you' : target?.display_name ?? 'someone';
        const a = seatCenter(e.from);
        const b = seatCenter(e.to);
        if (e.kind === 'poke') {
          pushFeed(e.nudge ? `⏰ ${fromName} nudged ${toName} to vote` : `👉 ${fromName} poked ${toName}`);
          if (prefs.effects) {
            bump(b?.el, 'shake');
            if (b) add({ emoji: e.nudge ? '⏰' : '👉', kind: 'poke', x: b.x - 34, y: b.y });
          }
          if (e.to === me.id) {
            sfx.poke();
            navigator.vibrate?.(120);
            toast(e.nudge ? `${fromName} is waiting for your vote` : `${fromName} poked you`, { tone: 'fun', icon: e.nudge ? '⏰' : '👉' });
            flashTitle(e.nudge ? '⏰ Your vote is needed' : `👉 ${fromName} poked you`);
          }
          return;
        }
        // throw
        const label = THROWABLES.find((t) => t.item === e.item)?.label ?? e.item;
        pushFeed(`${e.item} ${fromName} threw ${label} at ${toName}`);
        const hit = () => {
          if (prefs.effects) {
            bump(b?.el, 'hit');
            if (b) for (let i = 0; i < 4; i++) add({ emoji: '💦', kind: 'confetti', x: b.x, y: b.y });
          }
          if (e.to === me.id) {
            sfx.hit();
            navigator.vibrate?.([40, 30, 40]);
            toast(`${fromName} threw ${label} at you`, { tone: 'fun', icon: e.item });
            flashTitle(`${e.item} incoming!`);
          }
        };
        if (motion && b) {
          const start = a ?? { x: window.innerWidth / 2, y: window.innerHeight + 30 };
          add({ emoji: e.item, kind: 'throw', x: start.x, y: start.y, tx: b.x, ty: b.y });
          window.setTimeout(hit, 650);
        } else hit();
      }),
    [onFun, me.id, memberById, add, toast, prefs.effects, pushFeed],
  );

  // Consensus celebration
  useEffect(() => {
    if (!celebrate || !prefs.effects || prefersReducedMotion()) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2.4;
    const pieces = ['🔱', '🫧', '✨', '🐟', '🪐', '💙'];
    for (let i = 0; i < 26; i++) add({ emoji: pieces[i % pieces.length], kind: 'confetti', x: cx, y: cy });
  }, [celebrate, add, prefs.effects]);

  return (
    <div className="fun-layer" aria-hidden="true">
      {sprites.map((s) => (
        <SpriteEl key={s.id} s={s} />
      ))}
    </div>
  );
}

function SpriteEl({ s }: { s: Sprite }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el?.animate) return;
    if (s.kind === 'throw' && s.tx !== undefined && s.ty !== undefined) {
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const lift = -Math.min(180, 60 + Math.hypot(dx, dy) * 0.25);
      el.animate(
        [
          { transform: 'translate(-50%,-50%) translate(0,0) rotate(0deg) scale(.8)' },
          { transform: `translate(-50%,-50%) translate(${dx / 2}px, ${dy / 2 + lift}px) rotate(260deg) scale(1.3)`, offset: 0.5 },
          { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) rotate(520deg) scale(1)` },
        ],
        { duration: 650, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'forwards' },
      ).onfinish = () => el.animate([{ opacity: 1 }, { opacity: 0, transform: `translate(-50%,-50%) translate(${dx}px, ${dy + 30}px) scale(.6)` }], { duration: 400, fill: 'forwards' });
    } else if (s.kind === 'float') {
      const drift = (Math.random() - 0.5) * 60;
      el.animate(
        [
          { transform: 'translate(-50%,-50%) translate(0,0) scale(.6)', opacity: 0 },
          { transform: `translate(-50%,-50%) translate(${drift / 2}px,-60px) scale(1.2)`, opacity: 1, offset: 0.25 },
          { transform: `translate(-50%,-50%) translate(${drift}px,-200px) scale(1)`, opacity: 0 },
        ],
        { duration: 1800 + Math.random() * 400, easing: 'ease-out', fill: 'forwards' },
      );
    } else if (s.kind === 'confetti') {
      const ang = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 220;
      el.animate(
        [
          { transform: 'translate(-50%,-50%) translate(0,0) rotate(0) scale(.5)', opacity: 1 },
          { transform: `translate(-50%,-50%) translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 120}px) rotate(${Math.random() * 720 - 360}deg) scale(1)`, opacity: 0 },
        ],
        { duration: 1400 + Math.random() * 600, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' },
      );
    } else if (s.kind === 'poke') {
      el.animate(
        [
          { transform: 'translate(-50%,-50%) translateX(-14px)', opacity: 0 },
          { transform: 'translate(-50%,-50%) translateX(6px)', opacity: 1, offset: 0.3 },
          { transform: 'translate(-50%,-50%) translateX(-4px)', opacity: 1, offset: 0.6 },
          { transform: 'translate(-50%,-50%) translateX(0)', opacity: 0 },
        ],
        { duration: 1100, fill: 'forwards' },
      );
    }
  }, [s]);
  return (
    <span ref={ref} className={`sprite sprite-${s.kind}`} style={{ left: s.x, top: s.y }}>
      {s.emoji}
    </span>
  );
}

// ------------------------------------------------------------------ fun zone sidebar
const REACTIONS = ['👍', '🎉', '🤔', '😂', '🔥', '🫠', '☕', '🐙', '🌊', '🔱'];

export function FunZone({ feed }: { feed: FeedItem[] }) {
  const { me, members, sendFun } = useTeam();
  const [playing, setPlaying] = useState(false);
  const [fact, setFact] = useState(() => Math.floor(Math.random() * NEPTUNE_FACTS.length));
  const last = useRef(0);
  useEffect(() => {
    const t = window.setInterval(() => setFact((f) => (f + 1) % NEPTUNE_FACTS.length), 14000);
    return () => window.clearInterval(t);
  }, []);
  const react = (emoji: string) => {
    if (Date.now() - last.current < 350) return;
    last.current = Date.now();
    sendFun({ kind: 'react', from: me.id, emoji });
  };
  const leaders = [...members].filter((m) => m.bubble_best > 0).sort((a, b) => b.bubble_best - a.bubble_best).slice(0, 5);

  return (
    <section className="panel fun" aria-label="While you wait">
      <h2>While you wait</h2>
      <div className="reactions" role="group" aria-label="Send a reaction">
        {REACTIONS.map((r) => (
          <button key={r} onClick={() => react(r)} aria-label={`React ${r}`}>
            {r}
          </button>
        ))}
      </div>
      <p className="hint">Click someone’s avatar to poke them or throw a fish.</p>

      <div className="game-box">
        {playing ? (
          <BubbleGame onDone={() => setPlaying(false)} />
        ) : (
          <button className="btn btn-quiet game-start" onClick={() => setPlaying(true)}>
            <span>🫧 Bubble pop</span>
            <small>30-second round</small>
          </button>
        )}
        {leaders.length > 0 && (
          <ol className="leaders">
            {leaders.map((m) => (
              <li key={m.id}>
                <span>
                  {m.avatar} {m.display_name}
                </span>
                <strong>{m.bubble_best}</strong>
              </li>
            ))}
          </ol>
        )}
      </div>

      <figure className="fact">
        <figcaption>Neptune fact</figcaption>
        <p key={fact}>{NEPTUNE_FACTS[fact]}</p>
      </figure>

      {feed.length > 0 && (
        <ul className="feed" aria-live="polite">
          {feed.slice(0, 8).map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ bubble pop mini game
interface Bubble {
  id: number;
  x: number;
  y: number;
  r: number;
  speed: number;
  wobble: number;
  golden: boolean;
}

function BubbleGame({ onDone }: { onDone: () => void }) {
  const { me, sendFun, refreshTeam } = useTeam();
  const toast = useToast();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(30);
  const [over, setOver] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const state = useRef({ bubbles: [] as Bubble[], seq: 0, lastSpawn: 0, start: performance.now(), score: 0 });

  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const loop = (t: number) => {
      const s = state.current;
      const dt = Math.min(0.05, (t - prev) / 1000);
      prev = t;
      const elapsed = (t - s.start) / 1000;
      const h = area.current?.clientHeight ?? 260;
      const w = area.current?.clientWidth ?? 260;
      const rate = 0.55 - Math.min(0.35, elapsed * 0.012); // spawns get faster
      if (t - s.lastSpawn > rate * 1000) {
        s.lastSpawn = t;
        const r = 12 + Math.random() * 22;
        s.bubbles.push({ id: ++s.seq, x: r + Math.random() * (w - 2 * r), y: h + r, r, speed: 50 + Math.random() * 70 + elapsed * 3, wobble: Math.random() * 6, golden: Math.random() < 0.05 });
      }
      s.bubbles = s.bubbles.map((b) => ({ ...b, y: b.y - b.speed * dt, x: b.x + Math.sin((t / 400) + b.wobble) * 0.4 })).filter((b) => b.y > -b.r);
      setBubbles(s.bubbles);
      const remaining = Math.max(0, 30 - elapsed);
      setLeft(Math.ceil(remaining));
      if (remaining <= 0) {
        setOver(true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!over) return;
    const final = state.current.score;
    void (async () => {
      if (final > me.bubble_best) {
        await supabase.from('members').update({ bubble_best: final }).eq('id', me.id);
        await refreshTeam();
        toast(`New personal best: ${final}`, { tone: 'good', icon: '🏆' });
      }
      if (final > 0) sendFun({ kind: 'score', from: me.id, score: final });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  const pop = (b: Bubble) => {
    if (over) return;
    const pts = b.golden ? 10 : b.r < 18 ? 3 : b.r < 26 ? 2 : 1;
    state.current.score += pts;
    state.current.bubbles = state.current.bubbles.filter((x) => x.id !== b.id);
    setScore(state.current.score);
    sfx.pop();
  };

  return (
    <div className="bubble-game">
      <div className="game-hud">
        <span>Score {score}</span>
        <span>{over ? 'Time’s up' : `${left}s`}</span>
      </div>
      <div className="game-area" ref={area}>
        {bubbles.map((b) => (
          <button
            key={b.id}
            className={`bubble ${b.golden ? 'golden' : ''}`}
            style={{ left: b.x - b.r, top: b.y - b.r, width: b.r * 2, height: b.r * 2 }}
            onPointerDown={() => pop(b)}
            aria-label={b.golden ? 'Golden bubble' : 'Bubble'}
            tabIndex={-1}
          />
        ))}
        {over && (
          <div className="game-over">
            <strong>{score} points</strong>
            <small>Your best: {Math.max(score, me.bubble_best)}</small>
            <button className="btn btn-primary btn-small" onClick={onDone}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
