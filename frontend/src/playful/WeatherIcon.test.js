import React from "react";
import { render } from "@testing-library/react";
import WeatherIcon from "./WeatherIcon";

const NAMES = ["storm", "overcast", "thinCloud", "starry", "fullMoon"];

describe("WeatherIcon", () => {
  test.each(NAMES)("%s renders one hidden svg", (n) => {
    const { container } = render(<WeatherIcon name={n} />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 48 48");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("width")).toBe("40");
  });
  test.each(NAMES)("%s with title is an img", (n) => {
    const { container } = render(<WeatherIcon name={n} title="Sky" size={36} />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
    expect(svg.querySelector("title").textContent).toBe("Sky");
  });
  test("unknown name renders null", () => {
    const { container } = render(<WeatherIcon name="nope" />);
    expect(container.firstChild).toBeNull();
  });
  test.each(NAMES)("%s has no defs, filter or ids", (n) => {
    const { container } = render(<WeatherIcon name={n} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/<defs|filter|\sid=/);
  });
});
