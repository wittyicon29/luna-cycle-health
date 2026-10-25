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
  test.each(NAMES)("%s has no filter and every url() resolves to an id", (n) => {
    const { container } = render(<WeatherIcon name={n} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/filter/);
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    [...html.matchAll(/url\(#([^)]+)\)/g)].forEach((m) => expect(ids).toContain(m[1]));
  });
  test("gradient ids are unique across instances", () => {
    const { container } = render(<>{NAMES.map((n) => <WeatherIcon key={n} name={n} />)}<WeatherIcon name="overcast" /></>);
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("plate={false} omits the ring and disc", () => {
    const withPlate = render(<WeatherIcon name="storm" />).container.querySelectorAll("circle").length;
    const without = render(<WeatherIcon name="storm" plate={false} />).container.querySelectorAll("circle").length;
    expect(withPlate - without).toBe(1);
  });
  test("active plate adds the gold disc", () => {
    const { container } = render(<WeatherIcon name="storm" active />);
    expect(container.innerHTML).toContain('stroke="#FFC84A"');
  });
});
