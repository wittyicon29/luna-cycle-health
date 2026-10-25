import React from "react";
import { render } from "@testing-library/react";
import Companion, { companionMood } from "./Companion";

const MOODS = ["neutral", "happy", "sleepy", "cozy", "curious"];

describe("Companion", () => {
  test.each(MOODS)("%s renders with its own face", (m) => {
    const { container } = render(<Companion mood={m} ariaLabel="Luna" />);
    const svg = container.querySelector('svg[viewBox="0 0 64 64"]');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Luna");
    expect(svg.querySelectorAll("[data-face]")).toHaveLength(1);
    expect(svg.querySelector("[data-face]").getAttribute("data-face")).toBe(m);
  });
  test("faces are distinct", () => {
    const html = MOODS.map((m) => render(<Companion mood={m} />).container.querySelector("[data-face]").innerHTML);
    expect(new Set(html).size).toBe(5);
  });
  test("animate=false has no animation markup", () => {
    const { container } = render(<Companion mood="happy" sparkles />);
    expect(container.querySelector(".lc-animate")).toBeNull();
    expect(container.querySelector(".lc-spark")).toBeNull();
    expect(container.querySelector(".lc-hop")).toBeNull();
  });
  test("animate and sparkles gives three sparks and a hop", () => {
    const { container } = render(<Companion mood="happy" animate sparkles />);
    expect(container.querySelector("svg").classList.contains("lc-animate")).toBe(true);
    expect(container.querySelectorAll(".lc-spark")).toHaveLength(3);
    expect(container.querySelector(".lc-hop")).toBeTruthy();
  });
  test.each(["neutral", "sleepy", "cozy", "curious"])("%s never sparkles or hops", (m) => {
    const { container } = render(<Companion mood={m} animate sparkles />);
    expect(container.querySelector(".lc-spark")).toBeNull();
    expect(container.querySelector(".lc-hop")).toBeNull();
    expect(container.querySelector(".lc-body")).toBeTruthy();
  });
  test("without a label it is aria-hidden", () => {
    const svg = render(<Companion />).container.querySelector("svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.hasAttribute("role")).toBe(false);
    expect(svg.hasAttribute("aria-label")).toBe(false);
  });
  test("size applies", () => {
    const { container } = render(<Companion size={96} />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("width")).toBe("96");
    expect(svg.getAttribute("height")).toBe("96");
  });
  test("gradient ids are unique per instance and every url() resolves", () => {
    const { container } = render(<><Companion /><Companion mood="happy" /></>);
    const ids = [...container.querySelectorAll("[id]")].map((n) => n.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const refs = [...container.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    refs.forEach((r) => expect(ids).toContain(r));
  });
  test("accent colours the scarf", () => {
    const { container } = render(<Companion accent="#64DCB4" />);
    expect(container.innerHTML).toContain('fill="#64DCB4"');
  });
  test("unknown mood falls back to neutral", () => {
    const { container } = render(<Companion mood="nope" />);
    expect(container.querySelector("[data-face]").getAttribute("data-face")).toBe("neutral");
  });
});

describe("companionMood", () => {
  test("happy wins over everything", () => {
    expect(companionMood({ phase: "menstrual", hour: 23, justLogged: true })).toBe("happy");
  });
  test("sleepy at night beats cozy", () => {
    expect(companionMood({ phase: "menstrual", hour: 22, justLogged: false })).toBe("sleepy");
    expect(companionMood({ phase: "luteal", hour: 4, justLogged: false })).toBe("sleepy");
  });
  test("cozy in menstrual by day", () => {
    expect(companionMood({ phase: "menstrual", hour: 12, justLogged: false })).toBe("cozy");
  });
  test("neutral otherwise, with the day boundaries", () => {
    expect(companionMood({ phase: "follicular", hour: 5, justLogged: false })).toBe("neutral");
    expect(companionMood({ phase: "luteal", hour: 21, justLogged: false })).toBe("neutral");
    expect(companionMood({})).toBe("neutral");
  });
});
