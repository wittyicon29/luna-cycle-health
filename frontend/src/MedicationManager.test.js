import { render, screen, fireEvent, act } from "@testing-library/react";
import MedicationManager from "./MedicationManager";
import { API } from "./api";

jest.mock("./api", () => ({ API: { medications: { create: jest.fn(), update: jest.fn(), remove: jest.fn() } } }));

const MEDS = [{ id: "1", name: "Iron" }, { id: "2", name: "Vitamin D" }];
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function setup(meds = MEDS) {
  const onChange = jest.fn(); const onBack = jest.fn();
  render(<MedicationManager token="tok" medications={meds} onChange={onChange} onBack={onBack} />);
  return { onChange, onBack };
}
const add = async name => {
  fireEvent.change(screen.getByLabelText("Add a medication"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await flush();
};
const err = Object.assign(new Error("You already have a medication with that name"), { status: 409 });

test("lists active medications", () => {
  setup();
  expect(screen.getByText("Iron")).toBeInTheDocument();
  expect(screen.getByText("Vitamin D")).toBeInTheDocument();
});

test("add calls create, clears the input and reports the new list", async () => {
  API.medications.create.mockResolvedValue({ id: "3", name: "Zinc" });
  const { onChange } = setup();
  await add("  Zinc ");
  expect(API.medications.create).toHaveBeenCalledWith("Zinc", "tok");
  expect(onChange).toHaveBeenCalledWith([...MEDS, { id: "3", name: "Zinc" }], { type: "add", id: "3" });
  expect(screen.getByLabelText("Add a medication")).toHaveValue("");
});

test("duplicate shows the server message and keeps the input", async () => {
  API.medications.create.mockRejectedValue(err);
  const { onChange } = setup();
  await add("iron");
  expect(screen.getByRole("alert")).toHaveTextContent(/already have/);
  expect(screen.getByLabelText("Add a medication")).toHaveValue("iron");
  expect(onChange).not.toHaveBeenCalled();
});

test("30-item limit blocks adding", async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `m${i}` }));
  setup(many);
  await add("extra");
  expect(API.medications.create).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(/up to 30/);
});

test("blocks empty, whitespace and 61-char names client-side", async () => {
  setup();
  await add("");
  expect(screen.getByRole("alert")).toHaveTextContent(/Enter a medication name/);
  await add("   ");
  expect(screen.getByRole("alert")).toHaveTextContent(/Enter a medication name/);
  await add("x".repeat(61));
  expect(screen.getByRole("alert")).toHaveTextContent(/up to 60/);
  expect(API.medications.create).not.toHaveBeenCalled();
});

test("rename", async () => {
  API.medications.update.mockResolvedValue({ id: "1", name: "Iron 2" });
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Rename Iron" }));
  fireEvent.change(screen.getByLabelText("New name for Iron"), { target: { value: "Iron 2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await flush();
  expect(API.medications.update).toHaveBeenCalledWith("1", { name: "Iron 2" }, "tok");
  expect(onChange).toHaveBeenCalledWith([{ id: "1", name: "Iron 2" }, MEDS[1]], { type: "rename", id: "1" });
});

test("archive removes it from the list", async () => {
  API.medications.update.mockResolvedValue({});
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Archive Iron" }));
  await flush();
  expect(API.medications.update).toHaveBeenCalledWith("1", { archived: true }, "tok");
  expect(onChange).toHaveBeenCalledWith([MEDS[1]], { type: "archive", id: "1" });
});

test("delete asks for confirmation first", async () => {
  API.medications.remove.mockResolvedValue({});
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Delete Iron" }));
  expect(API.medications.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
  await flush();
  expect(API.medications.remove).toHaveBeenCalledWith("1", "tok");
  expect(onChange).toHaveBeenCalledWith([MEDS[1]], { type: "delete", id: "1" });
});

test("API failure leaves the list unchanged with an honest message", async () => {
  API.medications.update.mockRejectedValue(new Error("network"));
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Archive Iron" }));
  await flush();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText("Iron")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(/Nothing was changed/);
});

test("back button", () => {
  const { onBack } = setup();
  fireEvent.click(screen.getByRole("button", { name: /Back to day/ }));
  expect(onBack).toHaveBeenCalled();
});

test("a 422 about the 30 limit shows the server's own message", async () => {
  const msg = "You can keep up to 30 medications. Remove or archive one first.";
  API.medications.create.mockRejectedValue(Object.assign(new Error(msg), { status: 422 }));
  setup();
  await add("Zinc");
  expect(screen.getByRole("alert")).toHaveTextContent(msg);
  expect(screen.getByLabelText("Add a medication")).toHaveValue("Zinc");
});
