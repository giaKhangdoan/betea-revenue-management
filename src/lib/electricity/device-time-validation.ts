import { normalizeElectricityTime } from "@/lib/electricity/time-input";

export type ElectricityDeviceTimeInput = {
  period: "morning" | "evening";
  mode: "timed" | "continuous";
  status: "unrecorded" | "not_running" | "running";
  startedAt: string | null;
  endedAt: string | null;
  endsNextDay: boolean;
  ranFromPreviousNight: boolean | null;
  remainsOnAfterClose: boolean | null;
};

export function electricityDeviceTimeError(input: ElectricityDeviceTimeInput): string | null {
  if (input.status !== "running" || input.mode !== "timed") return null;

  const start = input.startedAt ? normalizeElectricityTime(input.startedAt) : null;
  const end = input.endedAt ? normalizeElectricityTime(input.endedAt) : null;
  if (input.period === "morning") {
    if (!end) return "Nhập giờ tắt của thiết bị trong ca sáng.";
    if (!start) {
      return input.ranFromPreviousNight === true
        ? null
        : "Nhập giờ bật, hoặc chọn “Đã chạy từ đêm hôm trước” nếu thiết bị đã bật từ tối qua.";
    }
    if (input.ranFromPreviousNight === true && start <= end) {
      return "Đã chạy từ đêm hôm trước chỉ đúng khi giờ bật lớn hơn giờ tắt, ví dụ 22:00 → 06:00.";
    }
    if (input.ranFromPreviousNight !== true && start > end) {
      return "Giờ bật muộn hơn giờ tắt. Chọn “Đã chạy từ đêm hôm trước?” là Có nếu thiết bị chạy qua nửa đêm.";
    }
    return null;
  }

  if (!start) return "Nhập giờ bật của thiết bị.";
  if (!end) {
    if (input.remainsOnAfterClose === true && !input.endsNextDay) return null;
    return "Nhập giờ tắt, hoặc chọn “Vẫn chạy sau khi đóng cửa” nếu chưa biết giờ tắt.";
  }

  if (input.endsNextDay && end > start) {
    return "Nếu giờ tắt thuộc ngày hôm sau, giờ tắt phải sớm hơn giờ bật.";
  }
  if (!input.endsNextDay && end < start) {
    return "Giờ tắt đang sớm hơn giờ bật. Chọn “Tắt sau nửa đêm?” nếu thiết bị chạy sang ngày hôm sau.";
  }
  return null;
}
