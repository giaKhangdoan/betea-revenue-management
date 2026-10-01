import Link from "next/link";

type InventoryItem = {
  id: string;
  name: string;
  category: string;
  large_unit: string;
  conversion_factor: number | string;
  small_unit: string;
};

export function InventoryWorkspace({
  basePath,
  items,
  tab,
  error,
}: {
  basePath: string;
  items: InventoryItem[];
  tab: "stock" | "receiving";
  error: boolean;
}) {
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">QUẢN LÝ CỬA HÀNG</p><h1>Kho</h1><p>Danh mục hàng hóa và các đơn vị quy đổi.</p></div>
    </div>

    <nav className="inventory-tabs" aria-label="Kho">
      <Link className="inventory-tab" href={`${basePath}?tab=stock`} aria-current={tab === "stock" ? "page" : undefined}>Tồn kho</Link>
      <Link className="inventory-tab" href={`${basePath}?tab=receiving`} aria-current={tab === "receiving" ? "page" : undefined}>Nhập kho</Link>
    </nav>

    {tab === "stock" ? <section className="surface inventory-panel">
      {error ? <div className="empty-state"><h2>Chưa tải được danh mục</h2><p>Vui lòng tải lại trang sau ít phút.</p></div> : <>
        <div className="section-heading"><div><h2>Danh mục mặt hàng</h2><p>Đơn vị lớn quy đổi sang đơn vị nhỏ.</p></div><strong>{items.length} mặt hàng</strong></div>
        {items.length === 0 ? <div className="empty-state"><h2>Chưa có mặt hàng</h2><p>Danh mục sẽ xuất hiện sau khi dữ liệu kho được khởi tạo.</p></div> : <ul className="inventory-item-list">
          {items.map((item) => <li className="inventory-item" key={item.id}>
            <div className="inventory-item-heading"><strong>{item.name}</strong><span className="status status-neutral">{item.category}</span></div>
            <p>1 {item.large_unit} = {Number(item.conversion_factor).toLocaleString("vi-VN")} {item.small_unit}</p>
          </li>)}
        </ul>}
      </>}
    </section> : <section className="empty-state inventory-empty"><h2>Chưa có phiếu nhập</h2><p>Các phiếu giao hàng sẽ xuất hiện tại đây.</p></section>}
  </>;
}
