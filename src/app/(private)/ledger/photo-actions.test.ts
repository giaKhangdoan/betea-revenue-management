import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerClient: vi.fn(),
  requireStaff: vi.fn(),
  deleteR2Object: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  remove: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-owner", () => ({ requireOwnerClient: mocks.requireOwnerClient }));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/lib/storage/r2", () => ({ deleteR2Object: mocks.deleteR2Object }));

import { addDayPhotoRecord, deleteDayPhotoRecord } from "./photo-actions";

const ownerId = "93000000-0000-4000-8000-000000000001";
const photoId = "96000000-0000-4000-8000-000000000001";
const date = "2026-10-15";
const objectPath = `${ownerId}/${date}/00000000-0000-4000-8000-000000000001.webp`;
const photo = {
  id: photoId,
  owner_id: ownerId,
  business_date: date,
  shift_code: null,
  electricity_period: "evening",
  category: "electricity_meter",
  object_path: objectPath,
  storage_provider: "r2",
  caption: "Sau khi đóng cửa",
  created_at: "2026-10-15T15:00:00Z",
};

function makeOwner() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: mocks.maybeSingle,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  return {
    ownerId,
    supabase: {
      rpc: mocks.rpc,
      from: mocks.from,
      storage: { from: vi.fn(() => ({ remove: mocks.remove })) },
    },
  };
}

describe("day photo electricity metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerClient.mockResolvedValue(makeOwner());
    mocks.requireStaff.mockResolvedValue(null);
    mocks.deleteR2Object.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: photoId, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: photo, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
  });

  it("saves meter photos with an explicit period and no sales shift", async () => {
    const result = await addDayPhotoRecord({
      date,
      category: "electricity_meter",
      shiftCode: "",
      electricityPeriod: "evening",
      objectPath,
      caption: "Sau khi đóng cửa",
    });

    expect(result.error).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("owner_create_day_photo_r2", {
      p_business_date: date,
      p_category: "electricity_meter",
      p_shift_code: "",
      p_electricity_period: "evening",
      p_object_path: objectPath,
      p_caption: "Sau khi đóng cửa",
    });
  });

  it("keeps sales shifts separate and writes null period for existing photo categories", async () => {
    const result = await addDayPhotoRecord({
      date,
      category: "bluebook",
      shiftCode: "18-22",
      electricityPeriod: "",
      objectPath,
      caption: "",
    });

    expect(result.error).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("owner_create_day_photo_r2", expect.objectContaining({
      p_category: "bluebook",
      p_shift_code: "18-22",
      p_electricity_period: null,
    }));
  });

  it("rejects missing or conflicting meter-period metadata before writing", async () => {
    const missingPeriod = await addDayPhotoRecord({
      date, category: "electricity_meter", shiftCode: "", electricityPeriod: "", objectPath, caption: "",
    });
    const conflictingShift = await addDayPhotoRecord({
      date, category: "electricity_meter", shiftCode: "06-10", electricityPeriod: "morning", objectPath, caption: "",
    });
    const nonMeterWithPeriod = await addDayPhotoRecord({
      date, category: "bluebook", shiftCode: "", electricityPeriod: "morning", objectPath, caption: "",
    });

    expect(missingPeriod.error).toBe("Thông tin ảnh chưa hợp lệ.");
    expect(conflictingShift.error).toBe("Thông tin ảnh chưa hợp lệ.");
    expect(nonMeterWithPeriod.error).toBe("Thông tin ảnh chưa hợp lệ.");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the staff metadata RPC when adding a staff photo", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    mocks.requireStaff.mockResolvedValue({ ownerId, supabase: { rpc: mocks.rpc } });

    const result = await addDayPhotoRecord({
      date,
      category: "electricity_meter",
      shiftCode: "",
      electricityPeriod: "morning",
      objectPath,
      caption: "Mở cửa",
    });

    expect(result.error).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("staff_create_day_photo_r2", expect.objectContaining({
      p_business_date: date,
      p_electricity_period: "morning",
    }));
  });

  it("does not write photo metadata without an owner or active staff session", async () => {
    mocks.requireOwnerClient.mockResolvedValue(null);
    mocks.requireStaff.mockResolvedValue(null);

    const result = await addDayPhotoRecord({
      date,
      category: "electricity_meter",
      shiftCode: "",
      electricityPeriod: "morning",
      objectPath,
      caption: "Mở cửa",
    });

    expect(result.error).toContain("Phiên đăng nhập hết hạn");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves the period when an R2 deletion fails and restores the metadata row", async () => {
    mocks.deleteR2Object.mockRejectedValue(new Error("R2 unavailable"));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: photoId, error: null });

    const result = await deleteDayPhotoRecord({ date, id: photoId });

    expect(result.error).toContain("Bản ghi đã được khôi phục");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "owner_create_day_photo_r2", expect.objectContaining({
      p_category: "electricity_meter",
      p_shift_code: "",
      p_electricity_period: "evening",
      p_object_path: objectPath,
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/ledger/${date}`);
  });

  it("preserves the period when the legacy Supabase copy prevents R2 deletion completion", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: photoId, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: { message: "legacy copy still present" } });

    const result = await deleteDayPhotoRecord({ date, id: photoId });

    expect(result.error).toContain("Bản ghi đã chuyển về bản sao");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "owner_create_day_photo", expect.objectContaining({
      p_category: "electricity_meter",
      p_shift_code: "",
      p_electricity_period: "evening",
      p_object_path: objectPath,
    }));
  });
});
