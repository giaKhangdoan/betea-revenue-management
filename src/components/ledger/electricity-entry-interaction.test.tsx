// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyElectricityJournal } from "./daily-electricity-journal";
import { StaffEntryForm } from "@/components/staff/staff-entry-form";

const { ownerSave, staffSave } = vi.hoisted(() => ({ ownerSave: vi.fn(), staffSave: vi.fn() }));
vi.mock("@/app/(private)/ledger/actions", () => ({
  saveOwnerElectricityPeriod: ownerSave,
  saveOwnerElectricityDeviceAction: vi.fn(),
}));
vi.mock("@/app/(staff)/staff/actions", () => ({
  saveStaffElectricityPeriodAction: staffSave,
  saveStaffEntryAction: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let renderErrors: unknown[];

beforeEach(() => {
  ownerSave.mockReset();
  staffSave.mockReset();
  ownerSave.mockResolvedValue({ success: "Đã lưu." });
  staffSave.mockResolvedValue({ success: "Đã lưu." });
  container = document.createElement("div");
  document.body.append(container);
  renderErrors = [];
  root = createRoot(container, { onUncaughtError: (error) => renderErrors.push(error) });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

type Role = "admin" | "staff";
const devices = Array.from({ length: 5 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name: `Thiết bị ${index + 1}`, mode: "continuous" as const, sort_order: index, is_active: true,
}));

async function renderEntry(role: Role, deviceCount = 0, editable = true) {
  await act(async () => root.render(role === "admin"
    ? createElement(DailyElectricityJournal, { date: "2026-10-15", record: null, nextMorningKwh: null, devices: devices.slice(0, deviceCount), deviceLogs: [] })
    : createElement(StaffEntryForm, { date: "2026-10-15", record: null, editable, electricityDevices: devices.slice(0, deviceCount), electricityDeviceLogs: [] })));
}

function periodForm(period: "morning" | "evening") {
  const form = [...container.querySelectorAll<HTMLFormElement>("form.electricity-period-form")]
    .find((candidate) => candidate.querySelector<HTMLInputElement>('input[name="period"]')?.value === period);
  if (!form) throw new Error(`Missing ${period} form`);
  return form;
}

function findButton(parent: ParentNode, text: string) {
  const button = [...parent.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.click(); });
}

function titles(form: HTMLFormElement) {
  return [...form.querySelectorAll(".electricity-device-heading strong")].map((heading) => heading.textContent);
}

async function setDeviceStatus(form: HTMLFormElement, index: number, value = "not_running") {
  const select = form.querySelectorAll<HTMLSelectElement>(".electricity-device-card select")[index];
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function payload(role: Role) {
  const formData = (role === "admin" ? ownerSave : staffSave).mock.calls.at(-1)?.[1] as FormData;
  return {
    logs: JSON.parse(String(formData.get("device_logs_json"))) as { device_id: string }[],
    checklist: JSON.parse(String(formData.get("checklist_json"))),
  };
}

describe.each<Role>(["admin", "staff"])("%s electricity entry", (role) => {
  it("can tick all three closing checks in one React batch without reading an expired event", async () => {
    await renderEntry(role);
    await click(findButton(container, "Ca tối"));
    const checks = [...periodForm("evening").querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks).toHaveLength(3);

    await act(async () => { checks.forEach((check) => check.click()); });

    expect(renderErrors).toEqual([]);
    expect(checks.map((check) => check.checked)).toEqual([true, true, true]);
    expect([...periodForm("evening").querySelectorAll("label small")].map((label) => label.textContent))
      .toEqual(["Đã xác nhận", "Đã xác nhận", "Đã xác nhận"]);

    await act(async () => { checks.forEach((check) => check.click()); });
    expect(renderErrors).toEqual([]);
    expect(checks.map((check) => check.checked)).toEqual([false, false, false]);
  });

  it("shows two devices at a time, saves only this group and handles an odd final group", async () => {
    await renderEntry(role, 5);
    const morning = periodForm("morning");
    expect(titles(morning)).toEqual(["Thiết bị 1", "Thiết bị 2"]);
    await setDeviceStatus(morning, 0);
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(payload(role).logs.map((log) => log.device_id)).toEqual([devices[0].id]);
    expect(titles(morning)).toEqual(["Thiết bị 3", "Thiết bị 4"]);

    await setDeviceStatus(morning, 0);
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(payload(role).logs.map((log) => log.device_id)).toEqual([devices[2].id]);
    expect(titles(morning)).toEqual(["Thiết bị 5"]);
    expect(morning.textContent).toContain("Nhóm 3 / 3");
    await click(findButton(morning, "Lưu ca sáng"));
    expect(titles(morning)).toEqual(["Thiết bị 5"]);
    expect(renderErrors).toEqual([]);
  });

  it("keeps the current group and entered values when the server refuses a save", async () => {
    (role === "admin" ? ownerSave : staffSave).mockResolvedValueOnce({ error: "Lưu thất bại." });
    await renderEntry(role, 4);
    const morning = periodForm("morning");
    await setDeviceStatus(morning, 0);
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(titles(morning)).toEqual(["Thiết bị 1", "Thiết bị 2"]);
    expect(morning.querySelector<HTMLSelectElement>(".electricity-device-card select")?.value).toBe("not_running");
    expect(morning.querySelector('[role="alert"]')?.textContent).toBe("Lưu thất bại.");
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(titles(morning)).toEqual(["Thiết bị 3", "Thiết bị 4"]);
  });

  it("handles a connection failure without losing the group or crashing the page", async () => {
    (role === "admin" ? ownerSave : staffSave).mockRejectedValueOnce(new Error("Connection lost"));
    await renderEntry(role, 4);
    const morning = periodForm("morning");
    await setDeviceStatus(morning, 1);
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(titles(morning)).toEqual(["Thiết bị 1", "Thiết bị 2"]);
    expect(morning.querySelector('[role="alert"]')?.textContent).toContain("Dữ liệu vừa nhập vẫn được giữ");
    expect(renderErrors).toEqual([]);
  });

  it("preserves edits on another group instead of clearing or submitting hidden device changes", async () => {
    await renderEntry(role, 4);
    const morning = periodForm("morning");
    await click(findButton(morning, "Lưu và tiếp tục"));
    await setDeviceStatus(morning, 0);
    await click(findButton(morning, "Quay lại"));
    await setDeviceStatus(morning, 1);
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(payload(role).logs.map((log) => log.device_id)).toEqual([devices[1].id]);
    const unsaved = JSON.parse(morning.querySelector<HTMLInputElement>('[name="device_logs_json"]')!.value) as { device_id: string }[];
    expect(unsaved.map((log) => log.device_id)).toEqual([devices[2].id]);
    expect(morning.querySelector<HTMLSelectElement>(".electricity-device-card select")?.value).toBe("not_running");
  });

  it("shows one period at a time and retains unsaved values when switching periods", async () => {
    await renderEntry(role, 5);
    const morning = periodForm("morning");
    await setDeviceStatus(morning, 0);
    expect(container.querySelectorAll('.electricity-period-panel:not([hidden]) .electricity-device-card')).toHaveLength(2);
    await click(findButton(container, "Ca tối"));
    expect(periodForm("evening").closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(false);
    expect(morning.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
    await click(findButton(container, "Ca sáng"));
    expect(morning.querySelector<HTMLSelectElement>(".electricity-device-card select")?.value).toBe("not_running");
    expect(ownerSave).not.toHaveBeenCalled();
    expect(staffSave).not.toHaveBeenCalled();
  });

  it("disables navigation and inputs until a save finishes, then advances", async () => {
    let resolveSave!: (value: { success: string }) => void;
    (role === "admin" ? ownerSave : staffSave).mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    await renderEntry(role, 4);
    const morning = periodForm("morning");
    await click(findButton(morning, "Lưu và tiếp tục"));
    expect(titles(morning)).toEqual(["Thiết bị 1", "Thiết bị 2"]);
    expect(findButton(container, "Ca tối").disabled).toBe(true);
    expect(morning.querySelector<HTMLSelectElement>(".electricity-device-card select")?.disabled).toBe(true);
    await act(async () => resolveSave({ success: "Đã lưu." }));
    expect(titles(morning)).toEqual(["Thiết bị 3", "Thiết bị 4"]);
    expect(findButton(container, "Ca tối").disabled).toBe(false);
  });

  it("shows the evening checks on the final group and submits true and false explicitly", async () => {
    await renderEntry(role, 3);
    await click(findButton(container, "Ca tối"));
    const evening = periodForm("evening");
    expect(evening.querySelector(".electricity-closing-checklist")).toBeNull();
    await click(findButton(evening, "Lưu và tiếp tục"));
    const checks = [...evening.querySelectorAll<HTMLInputElement>('.electricity-closing-checklist input[type="checkbox"]')];
    expect(checks).toHaveLength(3);
    await act(async () => { checks.forEach((check) => check.click()); });
    await click(findButton(evening, "Lưu ca tối"));
    expect(Object.values(payload(role).checklist)).toEqual([true, true, true]);
    await act(async () => { checks.forEach((check) => check.click()); });
    await click(findButton(evening, "Lưu ca tối"));
    expect(Object.values(payload(role).checklist)).toEqual([false, false, false]);
    expect(renderErrors).toEqual([]);
  });
});

it("lets staff browse a past day's groups without exposing a save action", async () => {
  await renderEntry("staff", 5, false);
  const morning = periodForm("morning");
  expect(morning.querySelector('button[type="submit"]')).toBeNull();
  await click(findButton(morning, "Xem nhóm tiếp"));
  expect(titles(morning)).toEqual(["Thiết bị 3", "Thiết bị 4"]);
  expect(morning.querySelector<HTMLSelectElement>(".electricity-device-card select")?.disabled).toBe(true);
  expect(staffSave).not.toHaveBeenCalled();
});
