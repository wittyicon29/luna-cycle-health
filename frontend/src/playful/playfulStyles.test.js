import { PLAYFUL_CSS, injectPlayfulStyles } from "./playfulStyles";

function keyframeBodies(css) {
  const out = [];
  const re = /@keyframes\s+[\w-]+\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

describe("PLAYFUL_CSS", () => {
  test("keyframes animate only transform and opacity", () => {
    const bodies = keyframeBodies(PLAYFUL_CSS);
    expect(bodies.length).toBeGreaterThanOrEqual(5);
    bodies.forEach((b) => {
      const props = [...b.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
      expect(props.length).toBeGreaterThan(0);
      props.forEach((p) => expect(["transform", "opacity"]).toContain(p));
    });
  });
  test("no costly effects anywhere", () => {
    expect(PLAYFUL_CSS).not.toMatch(/filter|mix-blend-mode|box-shadow/);
  });
  test("quiet gate rule", () => {
    expect(PLAYFUL_CSS).toContain(
      '[data-playful="quiet"] .lc-animate, [data-playful="quiet"] .lc-hop, [data-playful="quiet"] .lc-spark, [data-playful="quiet"] .fog-lift, [data-playful="quiet"] .sky-pulse{animation:none !important}'
    );
  });
  test("quiet bob rule", () => {
    expect(PLAYFUL_CSS).toContain('[data-playful="quiet"] .lc-animate .lc-body{animation:none !important}');
  });
  test("reduced motion disables animations", () => {
    const start = PLAYFUL_CSS.indexOf("@media (prefers-reduced-motion: reduce){");
    expect(start).toBeGreaterThan(-1);
    let depth = 0, i = PLAYFUL_CSS.indexOf("{", start);
    const open = i;
    for (; i < PLAYFUL_CSS.length; i++) {
      if (PLAYFUL_CSS[i] === "{") depth++;
      else if (PLAYFUL_CSS[i] === "}" && --depth === 0) break;
    }
    const block = PLAYFUL_CSS.slice(open, i + 1);
    ["lc-body", "lc-hop", "lc-spark", "fog-lift", "sky-pulse"].forEach((c) => expect(block).toContain(c));
    expect(block).toContain("animation:none !important");
  });
  test("inject is idempotent", () => {
    injectPlayfulStyles();
    injectPlayfulStyles();
    expect(document.querySelectorAll("#playful-styles")).toHaveLength(1);
  });
});
