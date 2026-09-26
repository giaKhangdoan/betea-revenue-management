export default function PrivateRouteLoading() {
  return (
    <section className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <p className="eyebrow">ĐANG TẢI DỮ LIỆU</p>
      <p className="route-loading-copy">Đang mở thông tin cửa hàng…</p>
      <div className="route-loading-track" aria-hidden="true"><span /></div>
    </section>
  );
}
