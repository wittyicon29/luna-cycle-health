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
  fireEvent.click(screen.getByLabelText("Reset sleep"));
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

describe("medication list inside the sheet", () => {
  const openManager = () => fireEvent.click(screen.getByRole("button", { name: "Manage my list" }));
  const back = async () => { fireEvent.click(screen.getByRole("button", { name: /Back to day/ })); await flush(); };

  test("add shows immediately even when the refetch fails, and the checklist has it", async () => {
    await setup();
    API.medications.list.mockRejectedValue(new Error("net"));
    API.medications.create.mockResolvedValue({ id: "m3", name: "Zinc" });
    openManager();
    fireEvent.change(screen.getByLabelText("Add a medication"), { target: { value: "Zinc" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await flush();
    expect(screen.getByText("Zinc")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
    await back();
    expect(screen.getByLabelText("Zinc")).toBeInTheDocument();
  });

  test("archive A then B with the first refetch resolving last keeps both archived", async () => {
    MEDS_TWO();
    await setup();
    let resolveA; let resolveB;
    API.medications.update.mockResolvedValue({});
    API.medications.list
      .mockImplementationOnce(() => new Promise(r => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise(r => { resolveB = r; }));
    openManager();
    fireEvent.click(screen.getByRole("button", { name: "Archive Iron" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Archive Calcium" }));
    await flush();
    const both = [{ id: "m1", name: "Iron", archived: true }, { id: "m3", name: "Calcium", archived: true }];
    await act(async () => { resolveB(both); await Promise.resolve(); });
    await act(async () => { resolveA([{ id: "m1", name: "Iron", archived: true }, { id: "m3", name: "Calcium", archived: false }]); await Promise.resolve(); });
    await back();
    expect(screen.queryByLabelText("Calcium")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Iron")).not.toBeInTheDocument();
  });

  test("delete updates the checklist and drops the id from the next save", async () => {
    API.logs.list.mockResolvedValue([{ date: DATE, medications_taken: ["m1"] }]);
    await setup();
    API.medications.remove.mockResolvedValue({});
    API.medications.list.mockRejectedValue(new Error("net"));
    openManager();
    fireEvent.click(screen.getByRole("button", { name: "Delete Iron" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await flush();
    await back();
    expect(screen.queryByLabelText("Iron")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(API.logs.put).toHaveBeenCalledWith(DATE, { note: "x" }, "tok");
  });

  test("rename is reflected in the checklist", async () => {
    await setup();
    API.medications.update.mockResolvedValue({ id: "m1", name: "Iron Plus" });
    API.medications.list.mockRejectedValue(new Error("net"));
    openManager();
    fireEvent.click(screen.getByRole("button", { name: "Rename Iron" }));
    fireEvent.change(screen.getByLabelText("New name for Iron"), { target: { value: "Iron Plus" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await flush();
    await back();
    expect(screen.getByLabelText("Iron Plus")).toBeInTheDocument();
  });
});

function MEDS_TWO() {
  API.medications.list.mockResolvedValue([{ id: "m1", name: "Iron", archived: false }, { id: "m3", name: "Calcium", archived: false }]);
}

test("an archived medication checked on load stays visible after unchecking", async () => {
  API.logs.list.mockResolvedValue([ROW]);
  await setup();
  fireEvent.click(screen.getByLabelText(/OldPill/));
  expect(screen.getByLabelText(/OldPill/)).not.toBeChecked();
  fireEvent.click(screen.getByLabelText(/OldPill/));
  expect(screen.getByLabelText(/OldPill/)).toBeChecked();
});

describe("closing safety", () => {
  test("while saving, backdrop, close and Escape do nothing and a failure is shown", async () => {
    let fail;
    API.logs.put.mockReturnValue(new Promise((_, rej) => { fail = rej; }));
    const { onClose, container } = await setup();
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.click(container.ownerDocument.querySelector(".o-backdrop"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { fail(new Error("x")); await Promise.resolve(); });
    await flush();
    expect(screen.getByText(/Couldn't save this day/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("onClose is not called when the sheet unmounted during the save", async () => {
    let ok;
    API.logs.put.mockReturnValue(new Promise(r => { ok = r; }));
    const { onClose, onSaved, unmount } = await setup();
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    unmount();
    await act(async () => { ok({}); await Promise.resolve(); });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("unsaved edits ask before discarding; Keep editing and Discard work", async () => {
    const { onClose } = await setup();
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("no prompt when nothing changed (also after undoing an edit)", async () => {
    const { onClose } = await setup();
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
  });
});

describe("load robustness", () => {
  test("medications failing still shows the form with a Retry", async () => {
    API.medications.list.mockRejectedValue(new Error("x"));
    await setup();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your medications.")).toBeInTheDocument();
    API.medications.list.mockResolvedValue(MEDS);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();
    expect(screen.getByLabelText("Iron")).toBeInTheDocument();
  });

  test("log failing shows the message and Retry reloads", async () => {
    API.logs.list.mockRejectedValueOnce(new Error("x"));
    await setup();
    expect(screen.getByText("Couldn't load this day.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    API.logs.list.mockResolvedValue([ROW]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();
    expect(screen.getByRole("radio", { name: "Good" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("keyboard and focus", () => {
  test("focus moves into the sheet and is restored on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener); opener.focus();
    const { unmount } = await setup();
    expect(document.activeElement).toBe(screen.getByText("October 24, 2026"));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test("mood radiogroup supports arrow keys with roving tabindex", async () => {
    await setup();
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("tabindex", "0");
    expect(radios[0]).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(radios[1], { key: "ArrowLeft" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[0], { key: "ArrowUp" });
    expect(radios[4]).toHaveAttribute("aria-checked", "true");
  });
});

describe("save and clear failures", () => {
  test("422 about the date range shows the date message", async () => {
    API.logs.put.mockRejectedValue(Object.assign(new Error("Date is out of range"), { status: 422 }));
    await setup();
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(screen.getByText("That date can't be saved yet. Pick today or an earlier day.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Okay" })).toHaveAttribute("aria-checked", "true");
  });

  test("another 422 keeps the generic message", async () => {
    API.logs.put.mockRejectedValue(Object.assign(new Error("Sleep must be at most 24"), { status: 422 }));
    await setup();
    fireEvent.click(screen.getByRole("radio", { name: "Okay" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(screen.getByText(/Couldn't save this day/)).toBeInTheDocument();
  });

  test("clear day failure keeps the form and says so", async () => {
    API.logs.list.mockResolvedValue([ROW]);
    API.logs.remove.mockRejectedValue(new Error("x"));
    const { onClose, onSaved } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear day" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, clear" }));
    await flush();
    expect(screen.getByText(/Couldn't clear this day/)).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("hello");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
