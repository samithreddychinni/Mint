"use client";
import { ArrowUpRight, PackageCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ManagerSummary = {
  canteen_id: string;
  period: "today" | "week";
  start_at: string;
  server_time: string;
  paid_orders: number;
  paid_value: number | string;
  payments_captured: number | string;
  credit_used: number | string;
  credit_issued: number | string;
  credit_balance: number | string;
  missed_pickup_fines?: number | string;
  collected_portions: number;
  pending_portions: number;
  arrived_portions: number;
  payment_reviews: number;
  pending_refunds: number;
  overdue_portions: number;
  paused_items: number;
  worker_healthy: boolean;
  popular_items: { name: string; portions: number; value: number | string }[];
  low_stock: { id: string; name: string; available: number }[];
};
const rupees = (value: number | string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) / 100);

export function ManagerDashboard({
  summary,
  period,
  onPeriod,
  error,
  onRetry,
  onStock,
}: {
  summary: ManagerSummary | null;
  period: "today" | "week";
  onPeriod: (period: "today" | "week") => void;
  error: string;
  onRetry: () => void;
  onStock: () => void;
}) {
  return (
    <section className="manager-dashboard" aria-label="Online sales dashboard">
      <div className="dashboard-toolbar">
        <div className="segmented" aria-label="Sales period">
          <Button
            variant={period === "today" ? "default" : "ghost"}
            aria-pressed={period === "today"}
            onClick={() => onPeriod("today")}
          >
            Today
          </Button>
          <Button
            variant={period === "week" ? "default" : "ghost"}
            aria-pressed={period === "week"}
            onClick={() => onPeriod("week")}
          >
            Last 7 days
          </Button>
        </div>
        <span className="help-text">Campus time · IST</span>
      </div>
      {error ? (
        <div className="paper stack" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw size={16} />
            Retry sales
          </Button>
        </div>
      ) : !summary ? (
        <div className="dashboard-skeleton" role="status">
          <p>Gathering your canteen’s numbers…</p>
          <div />
          <div />
          <div />
        </div>
      ) : (
        <>
          {(summary.payment_reviews > 0 ||
            summary.pending_refunds > 0 ||
            summary.overdue_portions > 0 ||
            !summary.worker_healthy) && (
            <section
              className="dashboard-attention"
              aria-label="Needs attention"
            >
              <h2>Needs attention</h2>
              {summary.payment_reviews > 0 && (
                <p>
                  {summary.payment_reviews} payment{" "}
                  {summary.payment_reviews === 1 ? "case needs" : "cases need"}{" "}
                  review.
                </p>
              )}
              {summary.pending_refunds > 0 && (
                <p>
                  {summary.pending_refunds} bank{" "}
                  {summary.pending_refunds === 1 ? "refund is" : "refunds are"}{" "}
                  still processing.
                </p>
              )}
              {summary.overdue_portions > 0 && (
                <p>
                  {summary.overdue_portions} checked-in{" "}
                  {summary.overdue_portions === 1
                    ? "portion is"
                    : "portions are"}{" "}
                  past the collection deadline.
                </p>
              )}
              {!summary.worker_healthy && (
                <p>
                  Automatic order checks need attention. Ask the system
                  administrator to check the worker.
                </p>
              )}
            </section>
          )}
          <div className="sales-hero">
            <div>
              <p className="eyebrow">PAID ORDER VALUE</p>
              <strong className="sales-total">
                {rupees(summary.paid_value)}
              </strong>
              <p>
                {summary.paid_orders} paid{" "}
                {summary.paid_orders === 1 ? "order" : "orders"} ·{" "}
                {period === "today" ? "today" : "last 7 days"}
              </p>
            </div>
          </div>
          <div className="sales-grid">
            {[
              [
                "Missed pickup fines",
                summary.missed_pickup_fines ?? 0,
                "10% of unarrived expired portions",
              ],
              [
                "Payments captured",
                summary.payments_captured,
                "Money received through Razorpay",
              ],
              [
                "Canteen credit used",
                summary.credit_used,
                "Credit spent on paid orders",
              ],
              [
                "Credit returned",
                summary.credit_issued,
                "Cancelled portions, kept in MINT",
              ],
              [
                "Credit held in MINT",
                summary.credit_balance,
                "Current balance, including reservations",
              ],
            ].map(([label, value, note]) => (
              <div className="sales-stat paper" key={label}>
                <span>{label}</span>
                <strong>{rupees(value)}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <p className="help-text">
            Paid order value includes credit payments and portions later
            cancelled. Captured payments and returned credit are separate
            totals. Missed-pickup fines are included in paid order value. Online
            orders only.
          </p>
          <section
            className="paper pickup-pulse"
            aria-labelledby="pickup-pulse-title"
          >
            <div className="dashboard-section-heading">
              <h2 id="pickup-pulse-title">Pickup activity</h2>
              <PackageCheck size={20} aria-hidden="true" />
            </div>
            <div className="pickup-counts">
              <div>
                <strong>{summary.collected_portions}</strong>
                <small>
                  Collected {period === "today" ? "today" : "in 7 days"}
                </small>
              </div>
              <div>
                <strong>{summary.pending_portions}</strong>
                <small>Waiting now</small>
              </div>
              <div>
                <strong>{summary.arrived_portions}</strong>
                <small>Checked in now</small>
              </div>
            </div>
          </section>
          <div className="dashboard-lists">
            <section className="paper" aria-labelledby="popular-title">
              <h2 id="popular-title">Campus favourites</h2>
              <p className="help-text">
                Paid portions, excluding cancellations.
              </p>
              {summary.popular_items.length ? (
                <ol className="dashboard-item-list">
                  {summary.popular_items.map((item, index) => (
                    <li key={item.name}>
                      <span className="favourite-rank">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong>{item.name}</strong>
                      <span>{item.portions} sold</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="dashboard-empty">
                  No paid orders in this period.
                </p>
              )}
            </section>
            <section className="paper" aria-labelledby="stock-attention-title">
              <div className="dashboard-section-heading">
                <h2 id="stock-attention-title">Running low</h2>
                <Button variant="ghost" size="sm" onClick={onStock}>
                  Stock
                  <ArrowUpRight size={16} />
                </Button>
              </div>
              <p className="help-text">
                Available online now · 5 portions or fewer
              </p>
              {summary.low_stock.length ? (
                <ul className="dashboard-item-list">
                  {summary.low_stock.map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                      <span className={item.available === 0 ? "error" : ""}>
                        {item.available === 0
                          ? "Sold out"
                          : `${item.available} left`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-empty">No items running low.</p>
              )}
              {summary.paused_items > 0 && (
                <p className="help-text">
                  {summary.paused_items} menu{" "}
                  {summary.paused_items === 1 ? "item is" : "items are"}{" "}
                  switched off.
                </p>
              )}
            </section>
          </div>
          <p className="dashboard-updated help-text">
            Updated{" "}
            {new Date(summary.server_time).toLocaleTimeString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            IST · Refreshes while this screen is open
          </p>
        </>
      )}
    </section>
  );
}
