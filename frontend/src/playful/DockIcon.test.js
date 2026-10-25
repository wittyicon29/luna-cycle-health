import React from "react";
import { render } from "@testing-library/react";
import DockIcon, { DOCK_ICON_NAMES } from "./DockIcon";

describe("DockIcon", () => {
  test.each(DOCK_ICON_NAMES)("%s is a hidden line icon", (n) => {
    const { container } = render(<DockIcon name={n} size={28} />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke-width")).toBe("1.8");
    expect(svg.getAttribute("width")).toBe("28");
    expect(svg.querySelector("[fill]:not([fill='none'])")).toBeNull();
  });
  test("five names, five distinct drawings", () => {
    expect(DOCK_ICON_NAMES).toHaveLength(5);
    const html = DOCK_ICON_NAMES.map((n) => render(<DockIcon name={n} />).container.innerHTML);
    expect(new Set(html).size).toBe(5);
  });
  test("active flag is reflected without adding shapes", () => {
    const off = render(<DockIcon name="journey" />).container;
    const on = render(<DockIcon name="journey" active />).container;
    expect(off.querySelector("svg").getAttribute("data-active")).toBe("false");
    expect(on.querySelector("svg").getAttribute("data-active")).toBe("true");
    expect(on.querySelectorAll("path,circle,rect")).toHaveLength(off.querySelectorAll("path,circle,rect").length);
  });
  test("unknown name renders null", () => {
    expect(render(<DockIcon name="x" />).container.firstChild).toBeNull();
  });
});
