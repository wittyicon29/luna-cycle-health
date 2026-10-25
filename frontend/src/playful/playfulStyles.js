export const PLAYFUL_CSS = `
.lc-animate .lc-body{animation:lcBob 3.2s ease-in-out infinite;transform-origin:50% 90%}
@keyframes lcBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.lc-hop{animation:lcHop .7s ease-out 1}
@keyframes lcHop{0%{transform:translateY(0)}35%{transform:translateY(-9px)}70%{transform:translateY(0)}85%{transform:translateY(-2px)}100%{transform:translateY(0)}}
.lc-spark{opacity:0;animation:lcSpark 1.1s ease-out 1 both;transform-origin:0 0}
@keyframes lcSpark{0%{opacity:0;transform:scale(.4)}30%{opacity:1;transform:scale(1)}100%{opacity:0;transform:translateY(-8px) scale(.6)}}
/* Under Quiet mode / reduced motion this animation is none, so no animationend fires: consumers must remove lifted fog with a timer fallback, not only onAnimationEnd. */
.fog-lift{animation:fogLift .6s ease-out 1 both}
@keyframes fogLift{from{opacity:1}to{opacity:0}}
.sky-pulse{animation:skyPulse .5s ease-out 1}
@keyframes skyPulse{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}
[data-playful="quiet"] .lc-animate, [data-playful="quiet"] .lc-hop, [data-playful="quiet"] .lc-spark, [data-playful="quiet"] .fog-lift, [data-playful="quiet"] .sky-pulse{animation:none !important}
[data-playful="quiet"] .lc-animate .lc-body{animation:none !important}
@media (prefers-reduced-motion: reduce){
.lc-animate .lc-body, .lc-hop, .lc-spark, .fog-lift, .sky-pulse{animation:none !important}
}
.sky-row{display:flex;gap:8px;justify-content:space-between;margin:10px 0}
.sky-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;background:transparent;border:1px solid var(--border);border-radius:12px;color:inherit;cursor:pointer;font:inherit;font-size:11px;min-height:44px}
.sky-btn.on{border-color:#FFC84A;background:rgba(255,200,74,.12)}
.lc-bubble{background:#241539;border:1px solid var(--border);border-radius:12px;padding:8px 12px;font-size:13px;line-height:1.4}
.fog-run{display:flex;align-items:center;gap:6px}
`;

export function injectPlayfulStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("playful-styles")) return;
  const s = document.createElement("style");
  s.id = "playful-styles";
  s.textContent = PLAYFUL_CSS;
  document.head.appendChild(s);
}
