import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FogLayer } from "./FogLayer";

const DAY_W = 34;
const ONE = "Mist hasn't lifted here yet. Tap to add a day.";
const MANY = (n) => `Mist hasn't lifted on these ${n} days yet. Tap to add one.`;
const RUNS = [{ start: 60, end: 79 }, { start: 85, end: 85 }];
const runs = (c) => [...c.querySelectorAll(".fog-run")];

afterEach(() => jest.useRealTimers());

describe("FogLayer", () => {
  test("one button per run, positioned and sized from the indexes", () => {
    const { container } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    const els = runs(container);
    expect(els).toHaveLength(2);
    els.forEach((e) => {
      expect(e.getAttribute("role")).toBe("button");
      expect(e.getAttribute("tabindex")).toBe("0");
    });
    expect(els[0].style.left).toBe(`${60 * DAY_W}px`);
    expect(els[0].style.width).toBe(`${20 * DAY_W}px`);
    expect(els[1].style.left).toBe(`${85 * DAY_W}px`);
    expect(els[1].style.width).toBe(`${DAY_W}px`);
  });

  test("a 30-day window never needs more than 16 runs", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ start: i * 2, end: i * 2 }));
    const { container } = render(<FogLayer runs={many} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    expect(runs(container).length).toBeLessThanOrEqual(16);
  });

  test("aria labels: singular for one day, counted for many", () => {
    render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    expect(screen.getByRole("button", { name: MANY(20) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ONE })).toBeInTheDocument();
  });

  test("click reports the x within the run", () => {
    const onOpenRun = jest.fn();
    const { container } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={onOpenRun} animated />);
    fireEvent.click(runs(container)[0], { clientX: 100 });
    expect(onOpenRun).toHaveBeenCalledWith(RUNS[0], 100);
  });

  test("Enter and Space open the first day of the run", () => {
    const onOpenRun = jest.fn();
    const { container } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={onOpenRun} animated />);
    fireEvent.keyDown(runs(container)[1], { key: "Enter" });
    fireEvent.keyDown(runs(container)[1], { key: " " });
    expect(onOpenRun).toHaveBeenCalledTimes(2);
    expect(onOpenRun).toHaveBeenNthCalledWith(1, RUNS[1], 0);
    expect(onOpenRun).toHaveBeenNthCalledWith(2, RUNS[1], 0);
  });

  test("no filter or backdrop-filter in inline styles, flat lilac fill", () => {
    const { container } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    expect(container.innerHTML).not.toMatch(/filter/i);
    expect(runs(container)[0].style.backgroundColor).toContain("rgba(217, 200, 234, 0.16)");
  });

  test("animated=false never adds fog-lift, and a vanished run is gone at once", () => {
    const { container, rerender } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={jest.fn()} animated={false} />);
    rerender(<FogLayer runs={[RUNS[1]]} dayW={DAY_W} onOpenRun={jest.fn()} animated={false} />);
    expect(container.querySelector(".fog-lift")).toBeNull();
    expect(runs(container)).toHaveLength(1);
  });

  test("a vanished run lifts once, then is removed after the timer fallback", () => {
    jest.useFakeTimers();
    const { container, rerender } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    rerender(<FogLayer runs={[RUNS[1]]} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    const lifted = container.querySelectorAll(".fog-lift");
    expect(lifted).toHaveLength(1);
    expect(lifted[0].getAttribute("role")).toBeNull();
    expect(lifted[0].style.left).toBe(`${60 * DAY_W}px`);
    act(() => { jest.advanceTimersByTime(1500); });
    expect(container.querySelector(".fog-lift")).toBeNull();
  });

  test("onAnimationEnd also removes the lifted run", () => {
    const { container, rerender } = render(<FogLayer runs={RUNS} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    rerender(<FogLayer runs={[RUNS[1]]} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    fireEvent.animationEnd(container.querySelector(".fog-lift"));
    expect(container.querySelector(".fog-lift")).toBeNull();
  });

  test("a run that only shrinks lifts just the cleared days", () => {
    const { container, rerender } = render(<FogLayer runs={[{ start: 10, end: 14 }]} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    rerender(<FogLayer runs={[{ start: 10, end: 11 }, { start: 13, end: 14 }]} dayW={DAY_W} onOpenRun={jest.fn()} animated />);
    const lifted = container.querySelectorAll(".fog-lift");
    expect(lifted).toHaveLength(1);
    expect(lifted[0].style.left).toBe(`${12 * DAY_W}px`);
    expect(lifted[0].style.width).toBe(`${DAY_W}px`);
  });
});
