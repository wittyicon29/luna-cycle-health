import { render, screen, fireEvent, act } from "@testing-library/react";
import DaySheet, { buildPayload, isBlank } from "./DaySheet";
import { API } from "./api";
import { SYMPTOMS_LIST } from "./symptoms";

jest.mock("./api", () => ({
  API: {
    logs: { list: jest.fn(), put: jest.fn(), remove: jest.fn() },
    medications: { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() },
  },
}));

const DATE = "2026-10-24";
const MEDS = [{ id: "m1", name: "Iron", archived: false }, { id: "m2", name: "OldPill", archived: true }];
const ROW = { date: DATE, mood: 4, symptoms: ["cramps"], flow: "light", sleep_hours: 7.5, water_glasses: 3, medications_taken: ["m1", "m2", "gone"], note: "hello" };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 25, 12));
  API.logs.list.mockResolvedValue([]);
  API.logs.put.mockResolvedValue({});
  API.logs.remove.mockResolvedValue({});
  API.medications.list.mockResolvedValue(MEDS);
});
afterEach(() => { jest.useRealTimers(); });

async function setup(date = DATE) {
  const onClose = jest.fn(); const onSaved = jest.fn();
  const utils = render(<DaySheet token="tok" date={date} onClose={onClose} onSaved={onSaved} />);
  await flush();
  return { onClose, onSaved, ...utils };
}

describe("buildPayload", () => {
  test("omits empties", () => {
    expect(buildPayload({ mood: null, symptoms: [], flow: null, sleep: null, water: null, meds: [], note: "  " })).toEqual({});
  });
  test("keeps zeros, dedupes, trims", () => {
    expect(buildPayload({ mood: 3, symptoms: ["a", "a"], flow: "heavy", sleep: 0, water: 0, meds: ["x", "x"], note: " hi " }))
      .toEqual({ mood: 3, symptoms: ["a"], flow: "heavy", sleep_hours: 0, water_glasses: 0, medications_taken: ["x"], note: "hi" });
  });
  test("isBlank", () => {
    expect(isBlank({ sleep: 0 })).toBe(false);
    expect(isBlank({ note: " " })).toBe(true);
  });
});

test("loads an existing entry into the form", async () => {
  API.logs.list.mockResolvedValue([ROW]);
  await setup();
  expect(API.logs.list).toHaveBeenCalledWith(DATE, DATE, "tok");
  expect(screen.getByRole("radio", { name: "Good" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "cramps" })).toHaveClass("on");
  expect(screen.getByRole("button", { name: "light" })).toHaveClass("on");
  expect(screen.getByLabelText("sleep hours value")).toHaveTextContent("7.5");
  expect(screen.getByLabelText("glasses of water value")).toHaveTextContent("3");
  expect(screen.getByLabelText("Iron")).toBeChecked();
  expect(screen.getByLabelText(/OldPill/)).toBeChecked();
  expect(screen.queryByText(/gone/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Note")).toHaveValue("hello");
  expect(screen.getByText("October 24, 2026")).toBeInTheDocument();
});

test("archived medications not in the log are hidden", async () => {
  await setup();
  expect(screen.getByLabelText("Iron")).not.toBeChecked();
  expect(screen.queryByText(/OldPill/)).not.toBeInTheDocument();
});

test("dates beyond tomorrow show a message and no form", async () => {
  await setup("2026-10-27");
  expect(screen.getByRole("alert")).toHaveTextContent(/too far ahead/);
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  expect(API.logs.list).not.toHaveBeenCalled();
});

test("save sends the payload, shows Saved and calls onSaved and onClose", async () => {
  API.logs.list.mockResolvedValue([ROW]);
  const { onSaved, onClose } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(API.logs.put).toHaveBeenCalledWith(DATE, {
    mood: 4, symptoms: ["cramps"], flow: "light", sleep_hours: 7.5, water_glasses: 3, medications_taken: ["m1", "m2"], note: "hello",
  }, "tok");
  expect(screen.getByText("Saved.")).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("blank existing day sends the empty payload", async () => {
  API.logs.list.mockResolvedValue([{ date: DATE, mood: 2 }]);
  await setup();
  fireEvent.click(screen.getByRole("radio", { name: "Low" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(API.logs.put).toHaveBeenCalledWith(DATE, {}, "tok");
});

test("blank new day disables Save", async () => {
  await setup();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByText("Nothing to save yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Clear day" })).not.toBeInTheDocument();
  expect(API.logs.put).not.toHaveBeenCalled();
});

test("clear day asks for confirmation then removes", async () => {
  API.logs.list.mockResolvedValue([ROW]);
  const { onSaved, onClose } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Clear day" }));
  expect(API.logs.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Yes, clear" }));
  await flush();
  expect(API.logs.remove).toHaveBeenCalledWith(DATE, "tok");
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test("failed save keeps every input and says so", async () => {
  API.logs.put.mockRejectedValue(new Error("x"));
  const { onSaved, onClose } = await setup();
  fireEvent.click(screen.getByRole("radio", { name: "Great" }));
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(screen.getByText("Couldn't save this day. Your entries are still here — try again.")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Great" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("Note")).toHaveValue("keep me");
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("double click on Save sends one request", async () => {
  let release;
  API.logs.put.mockReturnValue(new Promise(r => { release = r; }));
  await setup();
  fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
  const save = screen.getByRole("button", { name: "Save" });
  fireEvent.click(save); fireEvent.click(save);
  expect(API.logs.put).toHaveBeenCalledTimes(1);
  release({}); await flush();
});

test("mood is a radio group of five labelled faces; pressing again clears", async () => {
  await setup();
  const group = screen.getByRole("radiogroup");
  const radios = Array.from(group.querySelectorAll('[role="radio"]'));
  expect(radios.map(r => r.getAttribute("aria-label"))).toEqual(["Very low", "Low", "Okay", "Good", "Great"]);
  fireEvent.click(radios[2]);
  expect(radios[2]).toHaveAttribute("aria-checked", "true");
  fireEvent.click(radios[2]);
  expect(radios[2]).toHaveAttribute("aria-checked", "false");
});

test("sleep stepper moves in half hours within 0-24", async () => {
  await setup();
  const val = () => screen.getByLabelText("sleep hours value");
  expect(val()).toHaveTextContent("—");
  fireEvent.click(screen.getByLabelText("Increase sleep hours"));
  expect(val()).toHaveTextContent("7");
  fireEvent.click(screen.getByLabelText("Decrease sleep hours"));
  expect(val()).toHaveTextContent("6.5");
  fireEvent.click(screen.getByLabelText("Clear sleep hours"));
  expect(val()).toHaveTextContent("—");
  fireEvent.click(screen.getByLabelText("Decrease sleep hours"));
  expect(val()).toHaveTextContent("6.5");
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByLabelText("Decrease sleep hours"));
  expect(val()).toHaveTextContent("0");
  expect(screen.getByLabelText("Decrease sleep hours")).toBeDisabled();
  for (let i = 0; i < 60; i++) fireEvent.click(screen.getByLabelText("Increase sleep hours"));
  expect(val()).toHaveTextContent("24");
  expect(screen.getByLabelText("Increase sleep hours")).toBeDisabled();
});

test("water stepper is bounded 0-30", async () => {
  await setup();
  const val = () => screen.getByLabelText("glasses of water value");
  fireEvent.click(screen.getByLabelText("Increase glasses of water"));
  expect(val()).toHaveTextContent("1");
  fireEvent.click(screen.getByLabelText("Decrease glasses of water"));
  expect(val()).toHaveTextContent("0");
  expect(screen.getByLabelText("Decrease glasses of water")).toBeDisabled();
  for (let i = 0; i < 40; i++) fireEvent.click(screen.getByLabelText("Increase glasses of water"));
  expect(val()).toHaveTextContent("30");
  expect(screen.getByLabelText("Increase glasses of water")).toBeDisabled();
});

test("note has a counter and a 1000-character cap", async () => {
  await setup();
  const note = screen.getByLabelText("Note");
  expect(note).toHaveAttribute("maxLength", "1000");
  fireEvent.change(note, { target: { value: "a".repeat(1005) } });
  expect(note.value).toHaveLength(1000);
  expect(screen.getByText("1000/1000")).toBeInTheDocument();
});

test("symptoms come from SYMPTOMS_LIST; flow is single choice and toggles off", async () => {
  await setup();
  SYMPTOMS_LIST.forEach(s => expect(screen.getByRole("button", { name: s })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "light" }));
  fireEvent.click(screen.getByRole("button", { name: "heavy" }));
  expect(screen.getByRole("button", { name: "light" })).not.toHaveClass("on");
  expect(screen.getByRole("button", { name: "heavy" })).toHaveClass("on");
  fireEvent.click(screen.getByRole("button", { name: "heavy" }));
  expect(screen.getByRole("button", { name: "heavy" })).not.toHaveClass("on");
  ["spotting", "light", "medium", "heavy"].forEach(f => expect(screen.getByRole("button", { name: f })).toBeInTheDocument());
});

test("Manage my list swaps to the manager and back", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "Manage my list" }));
  expect(screen.getByText("My medications")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Back to day/ }));
  expect(screen.getByRole("radiogroup")).toBeInTheDocument();
});

test("controls are at least 44px tall and copy avoids excluded topics", async () => {
  API.logs.list.mockResolvedValue([ROW]);
  const { container } = await setup();
  container.ownerDocument.body.querySelectorAll("button").forEach(b => {
    const cls = b.className || "";
    if (cls.includes("drawer-close")) return;
    expect(b.style.minHeight).toBe("44px");
  });
  expect(document.body.textContent).not.toMatch(/ovulat|fertil|pregnan|intimacy/i);
});
