import { redirect } from "next/navigation";
import { EvidenceMigrationManager } from "@/components/admin/evidence-migration-manager";
import { requireOwnerClient } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function StorageMigrationPage() {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  const { count, error } = await owner.supabase.from("day_photos")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", owner.ownerId)
    .eq("storage_provider", "supabase");

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">KHO ẢNH</p>
          <h1>Chuyển ảnh Bluebook sang R2</h1>
          <p>Mỗi ảnh được sao chép và kiểm tra trước khi ứng dụng đổi nơi đọc. Bản Supabase vẫn được giữ làm bản dự phòng.</p>
        </div>
      </div>
      <section className="surface" aria-labelledby="evidence-migration-heading">
        <h2 id="evidence-migration-heading">Tiến độ chuyển ảnh</h2>
        {error ? <p className="form-error">Chưa đọc được số ảnh cần chuyển. Hãy tải lại trang.</p> : null}
        <EvidenceMigrationManager initialRemaining={count ?? 0} unavailable={Boolean(error)} />
      </section>
    </>
  );
}
