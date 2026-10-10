export type LimitTier = "standard" | "reliable" | "established" | "restricted";
export function pickupTier(
  completedDays: number,
  eligibleDays: number,
  noShows: number,
  recoveryDays: number,
): LimitTier {
  if (noShows >= 3 && recoveryDays < 2) return "restricted";
  const reliableRate = completedDays / Math.max(1, eligibleDays) >= 0.9;
  return reliableRate && completedDays >= 20
    ? "established"
    : reliableRate && completedDays >= 5
      ? "reliable"
      : "standard";
}
export const LIMIT_TIERS = {
  standard: {
    activeOrders: 2,
    perOrder: 6,
    outstanding: 10,
    meals: 2,
    drinks: 4,
    perItem: 2,
  },
  reliable: {
    activeOrders: 2,
    perOrder: 8,
    outstanding: 14,
    meals: 3,
    drinks: 6,
    perItem: 3,
  },
  established: {
    activeOrders: 3,
    perOrder: 10,
    outstanding: 18,
    meals: 4,
    drinks: 8,
    perItem: 4,
  },
  restricted: {
    activeOrders: 1,
    perOrder: 4,
    outstanding: 4,
    meals: 1,
    drinks: 2,
    perItem: 1,
  },
} as const;
export type OrderLimits = {
  tier: LimitTier;
  limits: {
    activeOrders: number;
    perOrder: number;
    outstanding: number;
    meals: number;
    drinks: number;
    perItem: number;
  };
  usage: {
    activeOrders: number;
    outstanding: number;
    meals: number;
    drinks: number;
    byItem: Record<string, number>;
  };
  completedDays: number;
  cooldownUntil: string | null;
};
export function itemAllowance(
  item: { order_group?: string; order_cap?: number; available: number },
  policy: OrderLimits,
) {
  const normal =
    item.order_cap ||
    (item.order_group === "bread" ? 6 : policy.limits.perItem);
  return Math.min(
    normal,
    policy.tier === "restricted" ? 1 : 6,
    item.available <= 10 ? 1 : 6,
  );
}
