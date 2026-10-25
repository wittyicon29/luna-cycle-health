import { render, screen, fireEvent, act } from "@testing-library/react";
import CalendarScreen, { maxSelectableDay } from "./CalendarScreen";
import { API } from "./api";

jest.mock("./api", () => ({
  API: { logs: { list: jest.fn() }, periods: { prediction: jest.fn() } },
}));

const PRED = { predicted_next_period: "2026-10-28", earliest: "2026-10-26", latest: "2026-10-30" };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

function setup(props = {}) {
  const onOpenDay = jest.fn();
  const onClose = jest.fn();
  const utils = render(<CalendarScreen token="tok" periods={[]} logsVersion={0} onClose={onClose} onOpenDay={onOpenDay} {...props} />);
  return { onOpenDay, onClose, ...utils };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 25, 12));
  API.logs.list.mockResolvedValue([]);
  API.periods.prediction.mockResolvedValue(PRED);
});
afterEach(() => { jest.useRealTimers(); });

test("renders month, weekday labels and 35 day buttons, first fetch uses grid range", async () => {
  const { container } = setup();
  await flush();
  expect(screen.getByText("October 2026")).toBeInTheDocument();
  expect(container.querySelectorAll(".cal-wd")).toHaveLength(7);
  expect(container.querySelectorAll(".cal-day")).toHaveLength(35);
  expect(API.logs.list).toHaveBeenCalledWith("2026-09-27", "2026-10-31", "tok");
});

test("prev/next change title and refetch; year wraps", async () => {
  setup();
  await flush();
  fireEvent.click(screen.getByLabelText("Next month"));
  await flush();
  expect(screen.getByText("November 2026")).toBeInTheDocument();
  expect(API.logs.list).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByLabelText("Next month"));
  await flush();
  expect(screen.getByText("December 2026")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Next month"));
  await flush();
  expect(screen.getByText("January 2027")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Previous month"));
  await flush();
  expect(screen.getByText("December 2026")).toBeInTheDocument();
});

test("marks logged, flow, period, expected and today days", async () => {
  API.logs.list.mockResolvedValue([{ date: "2026-10-10", flow: "light" }, { date: "2026-10-12", flow: null }]);
  setup({ periods: [{ start_date: "2026-10-23", end_date: null }] });
  await flush();
  expect(screen.getByRole("button", { name: /October 10.*logged.*flow light/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^October 12, 2026, logged$/ })).toBeInTheDocument();
  expect(screen.getAllByTestId("logged-dot")).toHaveLength(2);
  expect(screen.getAllByTestId("flow-mark")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /October 24, 2026, period day/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /October 25, 2026, today, period day/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /October 28, 2026, expected period/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /October 27, 2026, expected period/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /October 31, 2026$/ })).toBeInTheDocument();
});

test("clicking a day opens it; days after tomorrow are disabled; Log today", async () => {
  const { onOpenDay } = setup();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /October 20, 2026/ }));
  expect(onOpenDay).toHaveBeenCalledWith("2026-10-20");
  fireEvent.click(screen.getByRole("button", { name: /October 26, 2026/ }));
  expect(onOpenDay).toHaveBeenCalledWith("2026-10-26");
  const far = screen.getByRole("button", { name: /October 27, 2026/ });
  expect(far).toBeDisabled();
  fireEvent.click(far);
  expect(onOpenDay).not.toHaveBeenCalledWith("2026-10-27");
  fireEvent.click(screen.getByText("Log today"));
  expect(onOpenDay).toHaveBeenLastCalledWith("2026-10-25");
});

test("logs failure shows message and Retry, grid still shows periods and prediction", async () => {
  API.logs.list.mockRejectedValueOnce(new Error("x"));
  setup({ periods: [{ start_date: "2026-10-20", end_date: "2026-10-22" }] });
  await flush();
  expect(screen.getByText(/Couldn't load your logs/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /October 21, 2026, period day/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /October 28, 2026, expected period/ })).toBeInTheDocument();
  API.logs.list.mockResolvedValue([{ date: "2026-10-10" }]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await flush();
  expect(screen.queryByText(/Couldn't load your logs/)).toBeNull();
  expect(screen.getAllByTestId("logged-dot")).toHaveLength(1);
});

test("prediction failure does not block the grid", async () => {
  API.periods.prediction.mockRejectedValue(new Error("x"));
  const { container } = setup();
  await flush();
  expect(container.querySelectorAll(".cal-day")).toHaveLength(35);
  expect(screen.queryByRole("button", { name: /expected period/ })).toBeNull();
  expect(screen.queryByText(/Couldn't load your logs/)).toBeNull();
});

test("logsVersion change refetches", async () => {
  const { rerender, onOpenDay, onClose } = setup();
  await flush();
  expect(API.logs.list).toHaveBeenCalledTimes(1);
  rerender(<CalendarScreen token="tok" periods={[]} logsVersion={1} onClose={onClose} onOpenDay={onOpenDay} />);
  await flush();
  expect(API.logs.list).toHaveBeenCalledTimes(2);
});

test("stale response from a previous month never overwrites the current one", async () => {
  let resolveFirst;
  API.logs.list.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
  API.logs.list.mockResolvedValue([{ date: "2026-11-10" }]);
  setup();
  fireEvent.click(screen.getByLabelText("Next month"));
  await flush();
  expect(screen.getAllByTestId("logged-dot")).toHaveLength(1);
  await act(async () => { resolveFirst([{ date: "2026-11-11" }, { date: "2026-11-12" }]); await Promise.resolve(); });
  expect(screen.getAllByTestId("logged-dot")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /November 10, 2026, logged/ })).toBeInTheDocument();
});

test("44px targets, legend, close, and no sensitive wording", async () => {
  const { container, onClose } = setup();
  await flush();
  container.querySelectorAll(".cal-day").forEach(b => expect(b.style.minHeight).toBe("44px"));
  expect(screen.getByText(/Expected period/)).toBeInTheDocument();
  expect(screen.getByText(/Logged/)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/ovulat|fertil|pregnan/i);
  fireEvent.click(screen.getByLabelText("Close"));
  expect(onClose).toHaveBeenCalled();
});

test("maxSelectableDay is the earlier of local tomorrow and UTC tomorrow", () => {
  // Local date ahead of UTC date: capped to UTC today + 1.
  const ahead = { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 26, toISOString: () => "2026-10-25T20:00:00.000Z" };
  expect(maxSelectableDay(ahead)).toBe("2026-10-26");
  // Local date behind UTC date: local tomorrow wins.
  const behind = { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 25, toISOString: () => "2026-10-26T03:00:00.000Z" };
  expect(maxSelectableDay(behind)).toBe("2026-10-26");
});

test("today rolls over at local midnight and when the page becomes visible", async () => {
  setup();
  await flush();
  expect(screen.getByRole("button", { name: /October 25, 2026, today/ })).toBeInTheDocument();
  await act(async () => { jest.setSystemTime(new Date(2026, 9, 26, 0, 0, 5)); jest.advanceTimersByTime(13 * 3600 * 1000); });
  expect(screen.getByRole("button", { name: /October 26, 2026, today/ })).toBeInTheDocument();
  await act(async () => { jest.setSystemTime(new Date(2026, 9, 27, 9)); document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByRole("button", { name: /October 27, 2026, today/ })).toBeInTheDocument();
});
