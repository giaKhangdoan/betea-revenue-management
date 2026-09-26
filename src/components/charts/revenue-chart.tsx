import { formatVnd } from "@/lib/finance/format";
import type { CSSProperties } from "react";

export type RevenueChartItem = {
  label: string;
  shortLabel: string;
  value: number | null;
  hasMissingDays?: boolean;
};

export function RevenueChart({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: RevenueChartItem[];
}) {
  const recordedItems = items.filter((item) => item.value !== null);
  const maximum = Math.max(1, ...recordedItems.map((item) => item.value ?? 0));
  const total = recordedItems.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const missingCount = items.length - recordedItems.length;
  const labelInterval = Math.max(1, Math.ceil(items.length / 12));
  const count = Math.max(items.length, 1);
  const accessibleSummary = `${title}. ${recordedItems.length} trên ${items.length} mốc có doanh thu; tổng phần đã có dữ liệu ${formatVnd(total)}.${missingCount > 0 ? ` Còn ${missingCount} mốc chưa có dữ liệu.` : ""} Chiều cao cột thể hiện doanh thu.`;

  return (
    <figure className="revenue-chart" aria-labelledby="revenue-chart-title">
      <figcaption className="revenue-chart-heading">
        <div>
          <h2 id="revenue-chart-title">{title}</h2>
          <p>{description}</p>
        </div>
        <strong>{formatVnd(total)}</strong>
      </figcaption>
      {items.length === 0 ? (
        <p className="empty-inline">Chưa có ngày trong khoảng để vẽ biểu đồ.</p>
      ) : (
        <>
          <div className="revenue-chart-scroll" role="img" aria-label={accessibleSummary} tabIndex={0}>
            <div className="revenue-chart-columns" style={{ "--chart-count": count } as CSSProperties}>
              {items.map((item, index) => {
                const height = item.value === null
                  ? 3
                  : Math.max(2, ((item.value ?? 0) / maximum) * 100);
                const isIncomplete = item.value === null || item.hasMissingDays;
                const valueLabel = item.value === null ? "Chưa có dữ liệu" : formatVnd(item.value);
                return (
                  <div className="revenue-chart-column" key={`${item.label}-${index}`} title={`${item.label}: ${valueLabel}${item.hasMissingDays ? " · còn ngày thiếu doanh thu" : ""}`}>
                    <div className="revenue-chart-bar-space">
                      <span
                        className={`revenue-chart-bar${isIncomplete ? " revenue-chart-bar-incomplete" : ""}`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <span className="revenue-chart-label">{index % labelInterval === 0 || index === items.length - 1 ? item.shortLabel : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="revenue-chart-legend" aria-hidden="true">
            <span><i className="revenue-chart-swatch" />Đã có dữ liệu</span>
            {items.some((item) => item.value === null || item.hasMissingDays) ? <span><i className="revenue-chart-swatch revenue-chart-swatch-incomplete" />Thiếu dữ liệu</span> : null}
          </div>
        </>
      )}
    </figure>
  );
}
