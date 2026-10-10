"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search,
  ArrowRight,
  MapPin,
  Utensils,
  Clock,
  ScanLine,
  Check,
  Plus,
  Minus,
  RefreshCw,
  LogOut,
  Users,
  Wallet,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  ChevronLeft,
  ChevronRight,
  ReceiptText,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InstallPrompt } from "@/components/install-prompt";
import {
  fulfillmentSummary,
  isClosed,
  type FulfillmentState,
} from "@/lib/fulfillment";
type Canteen = {
  id: string;
  name: string;
  lat: string;
  lng: string;
  radius: number;
  max_accuracy: number;
  paused: boolean;
  demo: boolean;
};
type Station = {
  id: string;
  name: string;
  canteen_id: string;
  paused: boolean;
};
type Item = {
  id: string;
  name: string;
  price: number;
  available: number;
  mode: string;
  station_name: string;
  station_id: string;
  canteen_id: string;
  note: string;
  paused: boolean;
  station_paused: boolean;
};
type Role = {
  role: string;
  canteen_id: string;
  station_id: string | null;
  canteen_name: string;
  station_name: string | null;
};
type Unit = {
  id: string;
  name: string;
  state: string;
  mode: string;
  version: number;
  station_id: string;
  station_name: string;
  arrived_at: string | null;
  collection_deadline: string | null;
  collected_at: string | null;
  collector_id: string;
  collector_name: string;
  token: string;
  price?: number;
  overdue?: boolean;
  reference?: string;
};
type Order = {
  id: string;
  reference: string;
  state: string;
  total?: number;
  credit?: number;
  external?: number;
  provider_order?: string;
  hold_until: string;
  deadline: string | null;
  target_at: string | null;
  canteen_id: string;
  payer: boolean;
  fulfillment?: FulfillmentState[];
  canteen_name?: string;
};
type Invitation = {
  id: string;
  state: string;
  reference?: string;
  sender_name?: string;
  deadline?: string;
  portions?: { name: string; station: string }[];
};
type Credit = {
  canteen_id: string;
  canteen_name: string;
  available: number;
  reserved: number;
};
type Ledger = {
  amount: number;
  reserved_delta: number;
  reason: string;
  order_id: string | null;
  created_at: string;
  canteen_name: string;
};
type Me = {
  actor: { id: string; email: string; kind: string };
  roles: Role[];
  orders: Order[];
  credits: Credit[];
  ledger: Ledger[];
  invitations: Invitation[];
  serverTime: string;
};
type Detail = {
  order: Order;
  units: Unit[];
  invitations: Invitation[];
  resolutions: { amount: number; state: string; reason: string }[];
  serverTime: string;
};
type Catalogue = {
  canteens: Canteen[];
  stations: Station[];
  items: Item[];
  serverTime: string;
};
type PaymentResult = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}
const money = (n = 0) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );
const time = (s: string | null) =>
  s
    ? new Date(s).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : "—";
class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const mutationKeys = new Map<string, string>();
async function api<T>(path: string, data?: unknown): Promise<T> {
  const managerMutation = data !== undefined && path.startsWith("manager/");
  const fingerprint = path + JSON.stringify(data);
  if (managerMutation) {
    if (!mutationKeys.has(fingerprint))
      mutationKeys.set(fingerprint, crypto.randomUUID());
    data = {
      ...(data as Record<string, unknown>),
      key: mutationKeys.get(fingerprint),
    };
  }
  if (!navigator.onLine)
    throw new ApiError(
      "OFFLINE",
      "You are offline. Reconnect before trying again.",
    );
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const result = await response.json().catch(() => {
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "MINT is temporarily unavailable. Refresh to check your order before retrying.",
    );
  });
  if (!response.ok) throw new ApiError(result.code, result.message);
  if (managerMutation) mutationKeys.delete(fingerprint);
  return result as T;
}
export function MintApp() {
  const [catalogue, setCatalogue] = useState<Catalogue>({
    canteens: [],
    stations: [],
    items: [],
    serverTime: "",
  });
  const [me, setMe] = useState<Me | null>(null);
  const [canteen, setCanteen] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const tab = pathname.split("/")[1] || "menu";
  const selectedOrder = tab === "orders" ? pathname.split("/")[2] || "" : "";
  const setTab = (value: string) => router.push("/" + value);
  const [authReady, setAuthReady] = useState(false);
  const [staffView, setStaffView] = useState("scan");
  const [orderFilter, setOrderFilter] = useState("active");
  const [cart, setCart] = useState<
    Record<string, { quantity: number; price: number }>
  >({});
  const [readyOnly, setReadyOnly] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [credit, setCredit] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [station, setStation] = useState("");
  const [work, setWork] = useState<Unit[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [fresh, setFresh] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [friend, setFriend] = useState("");
  const [codes, setCodes] = useState<
    { token: string; stationName: string; image: string; arrived: boolean }[]
  >([]);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode, setLoginMode] = useState("otp");
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");
  const [reference, setReference] = useState("");
  const [collector, setCollector] = useState("");
  const [resolved, setResolved] = useState<Unit[]>([]);
  const [staffSelected, setStaffSelected] = useState<string[]>([]);
  const [queueTab, setQueueTab] = useState("ready");
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const [priceChanged, setPriceChanged] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const passDialog = useRef<HTMLDialogElement>(null);
  const [pickupView, setPickupView] = useState("pickup");
  const video = useRef<HTMLVideoElement>(null);
  const scanControls = useRef<{ stop: () => void } | null>(null);
  const [scanning, setScanning] = useState(false);
  const checkoutKey = useRef<string>("");
  const handoverKey = useRef<string>("");
  const activeRefreshes = useRef(0);
  const actionRunning = useRef(false);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
    scanControls.current?.stop();
    passDialog.current?.close();
    const timer = setTimeout(() => {
      setPickupView("pickup");
      setScanning(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (viewport?.scale === 1)
        root.current?.style.setProperty("--app-height", `${viewport.height}px`);
      if (document.activeElement instanceof HTMLInputElement)
        document.activeElement.scrollIntoView({ block: "nearest" });
    };
    resize();
    viewport?.addEventListener("resize", resize);
    return () => viewport?.removeEventListener("resize", resize);
  }, []);
  const refresh = useCallback(async () => {
    activeRefreshes.current++;
    try {
      const c = await api<Catalogue>("catalogue");
      c.canteens.sort(
        (a, b) =>
          ["Main", "IT", "MBA"].indexOf(a.name) -
          ["Main", "IT", "MBA"].indexOf(b.name),
      );
      setCatalogue(c);
      setCanteen((v) => v || c.canteens[0]?.id || "");
      setOffset(Date.parse(c.serverTime) - Date.now());
      let current: Me | null = null;
      try {
        current = await api<Me>("me");
        setMe(current);
        if (pathname === "/") {
          const destination =
            current.actor.kind === "student"
              ? "menu"
              : current.roles.some((r) => r.role === "manager")
                ? "manager"
                : current.roles.some((r) => r.role === "serving")
                  ? "staff"
                  : "account";
          router.replace("/" + destination);
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED") setMe(null);
        else throw e;
      }
      if (current && selectedOrder)
        setDetail(await api<Detail>("orders/" + selectedOrder));
      if (current && station && tab === "staff")
        setWork(await api<Unit[]>("staff/worklist?station=" + station));
      setFresh(new Date().toLocaleTimeString("en-IN"));
      return current;
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Unable to refresh. Last visible values may be stale.",
      );
      return null;
    } finally {
      activeRefreshes.current--;
      setAuthReady(true);
    }
  }, [selectedOrder, station, tab, pathname, router]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!activeRefreshes.current) void refresh();
    }, 0);
    const polling = setInterval(() => {
      if (
        !activeRefreshes.current &&
        document.visibilityState === "visible" &&
        navigator.onLine
      )
        void refresh();
    }, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(polling);
    };
  }, [refresh]);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void refresh();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const initial = setTimeout(() => setOnline(navigator.onLine), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Browser use remains available without installation support. */
      });
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(timer);
      clearTimeout(initial);
      scanControls.current?.stop();
    };
  }, [refresh]);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setMessage("");
    try {
      await fn();
      if (success) setMessage(success);
      await refresh();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "This request failed. Reload to check the outcome.",
      );
      if (
        e instanceof ApiError &&
        ["PRICE_CHANGED", "STOCK_CHANGED"].includes(e.code)
      ) {
        if (e.code === "PRICE_CHANGED") setPriceChanged(true);
        await refresh();
      }
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  };
  const menus = catalogue.items.filter((i) => i.canteen_id === canteen);
  const c = catalogue.canteens.find((c) => c.id === canteen);
  const total = Object.entries(cart).reduce(
    (sum, [, line]) => sum + line.price * line.quantity,
    0,
  );
  const balance =
    me?.credits.find((ac) => ac.canteen_id === canteen)?.available || 0;
  const usedCredit = credit ? Math.min(balance, total) : 0;
  const stationOptions = catalogue.stations.filter((s) =>
    me?.roles.some(
      (r) =>
        r.canteen_id === s.canteen_id &&
        (r.role === "manager" ||
          (r.role === "serving" && r.station_id === s.id)),
    ),
  );
  const canManage = me?.roles.some(
    (r) => r.role === "manager" && r.canteen_id === canteen,
  );
  const serverNow = now + offset;
  const queued = work.filter((u) =>
    queueTab === "ready"
      ? u.state === "ready" || (u.mode === "ready" && u.state === "pending")
      : queueTab === "pending"
        ? u.state === "pending" && u.mode === "made"
        : u.state === queueTab,
  );
  const openOrder = (id: string) => {
    router.push("/orders/" + id);
    setDetail(null);
    setSelected([]);
    setCodes([]);
  };
  const pay = async (o: Order) => {
    if (o.state === "confirmed") {
      openOrder(o.id);
      setMessage(
        "Order confirmed. Check in through your app before collection.",
      );
      return;
    }
    if (!o.provider_order) {
      setMessage(
        "Payment setup is pending. Refresh this order. Do not start another payment.",
      );
      openOrder(o.id);
      return;
    }
    if (!window.Razorpay)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(
            new Error(
              "MINT cannot open payment checkout. Your order remains in Orders.",
            ),
          );
        document.head.appendChild(script);
      });
    const checkout = new window.Razorpay({
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      order_id: o.provider_order,
      amount: o.external,
      currency: "INR",
      name: "MINT",
      description: "Canteen order",
      prefill: { email: me?.actor.email },
      theme: { color: "#A4123F" },
      handler: (p: PaymentResult) =>
        void run(async () => {
          const result = await api<Order>("orders/" + o.id + "/payment", {
            paymentId: p.razorpay_payment_id,
            providerOrder: p.razorpay_order_id,
            signature: p.razorpay_signature,
          });
          openOrder(o.id);
          setMessage(
            result.state === "confirmed"
              ? "Payment verified. Order confirmed."
              : "MINT received the payment. Financial review is pending.",
          );
        }),
      modal: {
        ondismiss: () => {
          openOrder(o.id);
          setMessage(
            "Checkout closed. MINT will verify your payment. If your bank deducted money, do not pay again.",
          );
        },
      },
    });
    checkout.open();
  };
  const locate = () =>
    run(async () => {
      const sample = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation
            ? navigator.geolocation.getCurrentPosition(
                resolve,
                (error) =>
                  reject(
                    new Error(
                      error.code === 1
                        ? "Allow location access in your browser settings, then retry check-in."
                        : error.code === 3
                          ? "Location timed out. Move outdoors and retry with precise location enabled."
                          : "Location is unavailable. Move outdoors and retry.",
                    ),
                  ),
                {
                  enableHighAccuracy: true,
                  maximumAge: 0,
                  timeout: 20000,
                },
              )
            : reject(
                new Error("Location is unavailable. Use a supported browser."),
              ),
      );
      const r = await api<{ accepted: boolean; message: string }>(
        "orders/" + selectedOrder + "/check-in",
        {
          latitude: sample.coords.latitude,
          longitude: sample.coords.longitude,
          accuracy: sample.coords.accuracy,
          timestamp: sample.timestamp,
        },
      );
      setMessage(r.message);
    }, undefined);
  const scan = async () => {
    setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      scanControls.current = await reader.decodeFromVideoDevice(
        undefined,
        video.current!,
        (result) => {
          if (result) {
            setToken(result.getText());
            scanControls.current?.stop();
            setScanning(false);
            setMessage("Code captured. Resolve the pass to inspect portions.");
          }
        },
      );
    } catch {
      setScanning(false);
      setMessage(
        "Camera unavailable. Paste the pass or use the order reference and collector email.",
      );
    }
  };
  const stopScan = () => {
    scanControls.current?.stop();
    setScanning(false);
  };
  useEffect(() => {
    if (!me) return;
    const timer = setTimeout(() => {
      if (tab === "staff" && !station) setStation(stationOptions[0]?.id || "");
      if (
        tab === "manager" &&
        !me.roles.some(
          (r) =>
            r.canteen_id === canteen &&
            (r.role === "manager" || r.role === tab),
        )
      ) {
        setCanteen(
          me.roles.find((r) => r.role === "manager" || r.role === tab)
            ?.canteen_id || canteen,
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [me, tab, station, stationOptions, canteen]);
  const rightsSignature = detail?.units
    .map((u) => `${u.id}:${u.version}:${u.state}:${u.arrived_at}`)
    .join(",");
  useEffect(() => {
    const timer = setTimeout(() => {
      passDialog.current?.close();
      setCodes([]);
      setSelected([]);
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedOrder, rightsSignature]);
  const student = me?.actor.kind === "student";
  const visibleOrders = (me?.orders || []).filter((o) =>
    orderFilter === "history"
      ? isClosed(o.fulfillment || []) ||
        !["confirmed", "pending"].includes(o.state)
      : !isClosed(o.fulfillment || []) &&
        ["confirmed", "pending"].includes(o.state),
  );
  const navigation = student
    ? [
        { route: "menu", label: "Menu", icon: Utensils },
        { route: "orders", label: "Orders", icon: ReceiptText },
        { route: "account", label: "Account", icon: UserRound },
      ]
    : [
        ...(me?.roles.some((r) => ["serving", "manager"].includes(r.role))
          ? [{ route: "staff", label: "Serving", icon: ScanLine }]
          : []),
        ...(me?.roles.some((r) => r.role === "manager")
          ? [{ route: "manager", label: "Stock", icon: Store }]
          : []),
        { route: "account", label: "Account", icon: UserRound },
      ];
  const cartCount = Object.values(cart).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );
  const switchCanteen = (id: string) => {
    if (id === canteen) return;
    if (
      cartCount &&
      !window.confirm("Clear your current cart and switch canteens?")
    )
      return;
    setCanteen(id);
    setCart({});
    setCredit(false);
    setPriceChanged(false);
    setMenuSearch("");
    checkoutKey.current = "";
  };
  const logout = () =>
    run(async () => {
      await api("auth/logout", {});
      setMe(null);
      setDetail(null);
      setResolved([]);
      passDialog.current?.close();
      setCodes([]);
      setSelected([]);
      setCart({});
      setWork([]);
      setPassword("");
      setEmail("");
      setOtp("");
      setSent(false);
      setFriend("");
      setToken("");
      setReference("");
      setCollector("");
      setStaffSelected([]);
      setStation("");
      setCanteen("");
      setCredit(false);
      setPriceChanged(false);
      setMenuSearch("");
      checkoutKey.current = "";
      handoverKey.current = "";
      mutationKeys.clear();
      passDialog.current?.close();
      stopScan();
      router.replace("/");
    });
  const ownActive =
    detail?.units.filter(
      (u) =>
        u.collector_id === me?.actor.id &&
        ["pending", "preparing", "ready"].includes(u.state),
    ) || [];
  const disabled = busy || !online;
  const filteredMenu = menus.filter(
    (i) =>
      (!readyOnly || i.mode === "ready") &&
      `${i.name} ${i.station_name}`
        .toLowerCase()
        .includes(menuSearch.trim().toLowerCase()),
  );
  const activeOrders = (me?.orders || []).filter(
    (o) => o.state === "confirmed" && !isClosed(o.fulfillment || []),
  );
  const changeQuantity = (item: Item, delta: number) => {
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[item.id]?.quantity || 0) + delta;
      if (quantity <= 0) delete next[item.id];
      else
        next[item.id] = { quantity, price: next[item.id]?.price ?? item.price };
      return next;
    });
    checkoutKey.current = "";
  };
  const showPasses = () =>
    run(async () => {
      const passes = await api<
        { token: string; stationName: string; arrived: boolean }[]
      >(`orders/${selectedOrder}/passes`, {});
      setCodes(
        await Promise.all(
          passes.map(async (pass) => ({
            ...pass,
            image: await QRCode.toDataURL(pass.token, {
              width: 280,
              margin: 2,
              color: { dark: "#272127", light: "#ffffff" },
            }),
          })),
        ),
      );
      if (passes.length) passDialog.current?.showModal();
      else
        setMessage(
          "No active portions are assigned to you. Refresh this order to see its current pickup status.",
        );
    });
  const canteenSelect = (role: string) => (
    <label className="field">
      Canteen
      <select
        value={canteen}
        onChange={(e) => {
          switchCanteen(e.target.value);
        }}
      >
        {catalogue.canteens
          .filter((site) =>
            me?.roles.some(
              (r) =>
                r.canteen_id === site.id && [role, "manager"].includes(r.role),
            ),
          )
          .map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <div
      ref={root}
      className={`app-root ${me ? "authenticated" : "signed-out"}`}
    >
      <header className="app-header">
        <Link href="/" className="app-brand" aria-label="MINT home">
          <span className="brand-symbol">
            m<span>✳</span>
          </span>
          mint<span className="brand-dot">.</span>
        </Link>
        <span className="header-context">
          {me && !student ? "COUNTER WORKSPACE" : "A LITTLE BREAK, WELL SPENT"}
        </span>
        <div className="header-actions">
          <InstallPrompt
            enabled={!!me && !busy && ["menu", "account"].includes(tab)}
          />
          <span className={`connection ${online ? "" : "disconnected"}`}>
            <i />
            {online ? "Connected" : "Offline"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            disabled={busy || !online}
            onClick={() => void refresh()}
          >
            <RefreshCw />
          </Button>
          {me && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut />
            </Button>
          )}
        </div>
      </header>
      {me && (
        <nav className="app-nav" aria-label="Workspace">
          {navigation.map(({ route, label, icon: Icon }) => (
            <Link
              key={route}
              href={`/${route}`}
              aria-current={
                tab === route ||
                (route === "account" && tab === "credit") ||
                (route === "menu" && tab === "cart")
                  ? "page"
                  : undefined
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      )}
      <main
        ref={content}
        className={`app-content ${!me ? "auth-content" : ""}`}
        id="main"
        data-screen={me ? (selectedOrder ? "pickup" : tab) : "signin"}
        data-has-cart={student && tab === "menu" && cartCount > 0}
      >
        {!online && (
          <div className="offline-notice" role="status">
            Offline. Data is stale. Actions are disabled.
          </div>
        )}
        {message && (
          <div role="status" aria-live="polite" className="app-notice">
            <span>{message}</span>
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              ×
            </button>
          </div>
        )}
        {!authReady ? (
          <div className="app-loading" role="status">
            <span className="brand-symbol">m✳</span>
            <p>Opening MINT…</p>
            {!catalogue.serverTime && <span>Loading the menu…</span>}
          </div>
        ) : !me ? (
          <section className="signin-screen">
            <div className="signin-art" aria-hidden="true">
              <BreakIllustration />
              <span className="handwritten">See you at the canteen.</span>
            </div>
            <div className="signin-form">
              <p className="eyebrow">YOUR CAMPUS CANTEENS</p>
              <h1>Sign in</h1>
              <p className="screen-subtitle">
                Good food. A little less waiting.
              </p>
              <div className="segmented" aria-label="Sign-in method">
                <Button
                  variant={loginMode === "otp" ? "default" : "ghost"}
                  onClick={() => {
                    setLoginMode("otp");
                    setSent(false);
                    setMessage("");
                  }}
                >
                  Student
                </Button>
                <Button
                  variant={loginMode === "password" ? "default" : "ghost"}
                  onClick={() => {
                    setLoginMode("password");
                    setSent(false);
                    setMessage("");
                  }}
                >
                  Staff sign in
                </Button>
              </div>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (loginMode === "password") {
                      await api("auth/password", { email, password });
                      setPassword("");
                      router.replace("/");
                    } else if (sent) {
                      await api("auth/verify", { email, token: otp });
                      setOtp("");
                      setSent(false);
                      router.replace("/");
                    } else {
                      const response = await api<{ message: string }>(
                        "auth/request",
                        { email },
                      );
                      setSent(true);
                      setMessage(response.message);
                    }
                  });
                }}
              >
                <label className="field" htmlFor="email">
                  {loginMode === "otp"
                    ? "University student email"
                    : "Staff account email"}
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    placeholder={
                      loginMode === "otp"
                        ? "you@cb.students.amrita.edu"
                        : "Your assigned email"
                    }
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setSent(false);
                    }}
                  />
                </label>
                {loginMode === "password" ? (
                  <div className="field">
                    <label htmlFor="password">Password</label>
                    <Input
                      id="password"
                      type="password"
                      aria-describedby="password-help"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <span className="help-text" id="password-help">
                      Use the account assigned by your canteen administrator.
                    </span>
                  </div>
                ) : sent ? (
                  <>
                    <label className="field" htmlFor="otp">
                      Six-digit email code
                      <Input
                        id="otp"
                        className="otp-input"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                      />
                      <span className="help-text">
                        Sent to {email}. Valid for five minutes.
                      </span>
                    </label>
                    <Button
                      type="button"
                      variant="link"
                      disabled={disabled}
                      onClick={() => setSent(false)}
                    >
                      Change email or resend code
                    </Button>
                    <p className="help-text">
                      Wait 60 seconds before requesting another code.
                    </p>
                  </>
                ) : (
                  <p className="help-text">
                    A six-digit code. No password to remember.
                  </p>
                )}
                <Button className="primary-action" disabled={disabled}>
                  {busy
                    ? "Please wait…"
                    : loginMode === "password"
                      ? "Sign in"
                      : sent
                        ? "Verify code"
                        : "Continue"}
                  <ArrowRight />
                </Button>
              </form>
              <p className="signin-campus">
                Amrita Vishwa Vidyapeetham · Coimbatore
              </p>
            </div>
          </section>
        ) : (
          <>
            {tab === "menu" && student && (
              <>
                <div className="menu-heading">
                  <div>
                    <p className="eyebrow">MAKE TIME FOR YOUR BREAK</p>
                    <h1>What sounds good?</h1>
                    <p className="screen-subtitle">
                      Pick your canteen. We’ll take it from here.
                    </p>
                  </div>
                  <span className="day-stamp">
                    <span>✳</span>Made for
                    <br />
                    campus days
                  </span>
                </div>
                <div
                  className="canteen-switch"
                  role="group"
                  aria-label="Canteens"
                >
                  {catalogue.canteens.map((site, index) => (
                    <button
                      key={site.id}
                      aria-label={`Choose ${site.name} canteen`}
                      aria-pressed={canteen === site.id}
                      onClick={() => switchCanteen(site.id)}
                      disabled={busy}
                    >
                      <span className="canteen-letter">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong>{site.name}</strong>
                      <span>
                        {canteen === site.id ? (
                          <Check size={16} />
                        ) : (
                          <ArrowRight size={16} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                {activeOrders.length > 0 && (
                  <button
                    className="active-pickup"
                    onClick={() => openOrder(activeOrders[0].id)}
                  >
                    <span className="status-dot" />
                    <span>
                      <strong>You have a pickup to make</strong>
                      <small>
                        {activeOrders[0].canteen_name} ·{" "}
                        {activeOrders[0].reference}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                )}
                <div className="menu-toolbar">
                  <div>
                    <h2>
                      On the menu{" "}
                      <span className="menu-count">{menus.length}</span>
                    </h2>
                    <p className="help-text">
                      <span
                        className={`status-dot ${c?.paused ? "paused" : ""}`}
                      />
                      {c?.name} ·{" "}
                      {c?.paused ? "Ordering paused" : "Accepting orders"}
                    </p>
                  </div>
                  <div className="menu-search">
                    <Search size={18} />
                    <Input
                      aria-label="Search menu"
                      placeholder="Find your favourite"
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="menu-filters">
                  <Button
                    variant={!readyOnly ? "default" : "ghost"}
                    onClick={() => setReadyOnly(false)}
                  >
                    All items
                  </Button>
                  <Button
                    variant={readyOnly ? "default" : "ghost"}
                    onClick={() => setReadyOnly(true)}
                  >
                    <Clock size={15} />
                    Ready now
                  </Button>
                  <span className="freshness">
                    Updated {fresh || "just now"}
                  </span>
                </div>
                {!catalogue.serverTime ? (
                  <div className="empty-state">Loading the menu…</div>
                ) : filteredMenu.length === 0 ? (
                  <Empty
                    icon={<Search />}
                    title="No matching items."
                    text="Try another search or switch off the readiness filter."
                  />
                ) : (
                  <div className="menu-grid">
                    {filteredMenu.map((item, index) => {
                      const unavailable =
                        item.paused ||
                        item.station_paused ||
                        c?.paused ||
                        item.available === 0;
                      return (
                        <article
                          key={item.id}
                          className={`food-card ${unavailable ? "unavailable" : ""}`}
                        >
                          <div className={`food-art art-${index % 3}`}>
                            <FoodIllustration name={item.name} />
                            <span className="readiness-tag">
                              <span
                                className={`status-dot ${item.mode === "made" ? "paused" : ""}`}
                              />
                              {item.mode === "ready"
                                ? "Ready now"
                                : "Made to order"}
                            </span>
                          </div>
                          <div className="food-info">
                            <p className="item-counter">{item.station_name}</p>
                            <h3>{item.name}</h3>
                            {item.note &&
                              !/demo|synthetic/i.test(item.note) && (
                                <p className="item-note">{item.note}</p>
                              )}
                            <p className="item-availability">
                              {unavailable
                                ? item.available === 0
                                  ? "Sold out for now"
                                  : "Ordering paused"
                                : `${item.available} available`}
                            </p>
                            <div className="food-purchase">
                              <strong className="money">
                                {money(item.price)}
                              </strong>
                              <div className="quantity-stepper">
                                {cart[item.id]?.quantity > 0 ? (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Remove ${item.name}`}
                                      disabled={busy}
                                      onClick={() => changeQuantity(item, -1)}
                                    >
                                      <Minus />
                                    </Button>
                                    <span aria-live="polite">
                                      {cart[item.id].quantity}
                                    </span>
                                  </>
                                ) : (
                                  <span className="add-label">Add</span>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Add ${item.name}`}
                                  disabled={
                                    disabled ||
                                    unavailable ||
                                    (cart[item.id]?.quantity || 0) >=
                                      Math.min(20, item.available)
                                  }
                                  onClick={() => changeQuantity(item, 1)}
                                >
                                  <Plus />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {tab === "cart" && student && (
              <>
                <Button
                  variant="ghost"
                  className="back-button"
                  onClick={() => setTab("menu")}
                >
                  <ChevronLeft />
                  Back to menu
                </Button>
                <PageHeading
                  eyebrow="ONE CANTEEN. ONE EASY STOP."
                  title="Review order"
                  text={`${c?.name || "Your"} canteen · stock is reserved when you place your order.`}
                />
                {cartCount === 0 ? (
                  <Empty
                    icon={<ShoppingBag />}
                    title="Your break starts here"
                    text="Add something good from the menu."
                    action={
                      <Button onClick={() => setTab("menu")}>
                        Browse menu
                        <ArrowRight />
                      </Button>
                    }
                  />
                ) : (
                  <div className="checkout-grid">
                    <section className="paper">
                      <h2>
                        Your bag <span className="menu-count">{cartCount}</span>
                      </h2>
                      {Object.entries(cart).map(([id, line]) => {
                        const item = menus.find((i) => i.id === id);
                        return (
                          <div className="cart-line" key={id}>
                            <div>
                              <strong>
                                {item?.name || "Unavailable item"}
                              </strong>
                              <p className="help-text">
                                {item?.station_name} ·{" "}
                                {item?.mode === "ready"
                                  ? "Ready now"
                                  : "Made to order"}
                              </p>
                              <div className="quantity-stepper">
                                {item && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Decrease ${item.name}`}
                                      disabled={busy}
                                      onClick={() => changeQuantity(item, -1)}
                                    >
                                      <Minus />
                                    </Button>
                                    <span>{line.quantity}</span>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Increase ${item.name}`}
                                      disabled={
                                        disabled ||
                                        item.paused ||
                                        item.station_paused ||
                                        c?.paused ||
                                        line.quantity >=
                                          Math.min(20, item.available)
                                      }
                                      onClick={() => changeQuantity(item, 1)}
                                    >
                                      <Plus />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                            <strong>{money(line.price * line.quantity)}</strong>
                          </div>
                        );
                      })}
                    </section>
                    <section className="paper checkout-summary">
                      <p className="eyebrow">A QUICK HEADS-UP</p>
                      <div className="policy-line">
                        <Clock />
                        <p>
                          Arrive within <strong>25 minutes</strong>, with 5
                          minutes of grace. Check in using a fresh phone
                          location.
                        </p>
                      </div>
                      <div className="policy-line">
                        <Wallet />
                        <p>
                          Eligible canceled or unarrived portions become{" "}
                          <strong>{c?.name} canteen credit</strong>, not a bank
                          refund. Prepared food needs staff review.
                        </p>
                      </div>
                      <p className="help-text">
                        Skip the billing queue. Preparation and serving queues
                        still apply.
                      </p>
                      <label className="credit-toggle">
                        <input
                          type="checkbox"
                          checked={credit}
                          disabled={disabled || !balance}
                          onChange={(e) => {
                            setCredit(e.target.checked);
                            checkoutKey.current = "";
                          }}
                        />
                        <span>
                          Use same-canteen credit
                          <small>{money(balance)} available</small>
                        </span>
                      </label>
                      {priceChanged && (
                        <Button
                          variant="outline"
                          disabled={disabled}
                          onClick={() => {
                            setCart((current) =>
                              Object.fromEntries(
                                Object.entries(current).map(([id, line]) => [
                                  id,
                                  {
                                    ...line,
                                    price:
                                      menus.find((i) => i.id === id)?.price ||
                                      line.price,
                                  },
                                ]),
                              ),
                            );
                            setPriceChanged(false);
                            checkoutKey.current = "";
                          }}
                        >
                          Accept updated menu prices
                        </Button>
                      )}
                      <div className="screen-action checkout-action">
                        <div className="total-line">
                          <strong>{money(total)}</strong>
                          <span className="help-text">
                            Credit {money(usedCredit)} · Online{" "}
                            {money(total - usedCredit)}
                          </span>
                        </div>
                        <Button
                          className="primary-action"
                          disabled={disabled || priceChanged || c?.paused}
                          onClick={() =>
                            void run(async () => {
                              checkoutKey.current ||= crypto.randomUUID();
                              const order = await api<Order>("checkouts", {
                                canteenId: canteen,
                                lines: Object.entries(cart).map(
                                  ([itemId, line]) => ({ itemId, ...line }),
                                ),
                                credit: usedCredit,
                                key: checkoutKey.current,
                              });
                              setCart({});
                              checkoutKey.current = "";
                              await pay(order);
                            })
                          }
                        >
                          {busy ? "Reserving your items…" : "Place order"}
                          <ArrowRight />
                        </Button>
                      </div>
                      <p className="secure-note">
                        <ShieldCheck size={14} />
                        Secure payment · stock checked at checkout
                      </p>
                    </section>
                  </div>
                )}
              </>
            )}
            {tab === "orders" &&
              student &&
              (selectedOrder ? (
                <>
                  <Button
                    variant="ghost"
                    className="back-button"
                    onClick={() => {
                      setDetail(null);
                      setCodes([]);
                      setTab("orders");
                    }}
                  >
                    <ChevronLeft />
                    All orders
                  </Button>
                  {detail?.order.id !== selectedOrder ? (
                    <div className="app-loading">Opening your order…</div>
                  ) : (
                    <>
                      <div className="ticket-header">
                        <p className="eyebrow">
                          {
                            catalogue.canteens.find(
                              (site) => site.id === detail.order.canteen_id,
                            )?.name
                          }{" "}
                          CANTEEN
                        </p>
                        <h1>Your pickup</h1>
                        <p className="screen-subtitle">
                          {detail.order.reference} ·{" "}
                          <strong>
                            {fulfillmentSummary(
                              detail.order.state,
                              detail.units,
                            )}
                          </strong>
                        </p>
                      </div>
                      {detail.order.state === "pending" && (
                        <section className="paper stack">
                          <h2>Payment pending</h2>
                          <p>
                            Stock hold ends at {time(detail.order.hold_until)}.
                            If your bank deducted money, wait for verification
                            before paying again.
                          </p>
                          {detail.order.payer &&
                            Date.parse(detail.order.hold_until) > serverNow && (
                              <Button
                                disabled={disabled}
                                onClick={() =>
                                  void run(async () =>
                                    pay(
                                      await api<Order>(
                                        `orders/${selectedOrder}/payment-setup`,
                                        {},
                                      ),
                                    ),
                                  )
                                }
                              >
                                Resume payment
                              </Button>
                            )}
                        </section>
                      )}
                      {detail.order.state === "confirmed" &&
                        !isClosed(detail.units) && (
                          <section className="arrival-card">
                            <div>
                              <p className="eyebrow">
                                FIRST, LET US KNOW YOU’RE HERE
                              </p>
                              <h2>
                                {ownActive.length === 0
                                  ? "Pickup assigned to friends"
                                  : ownActive.every((u) => !!u.arrived_at)
                                    ? "You’re checked in."
                                    : "A quick check-in."}
                              </h2>
                              <p>
                                Target {time(detail.order.target_at)} · final
                                arrival {time(detail.order.deadline)}
                              </p>
                              {detail.order.deadline &&
                                detail.units.some(
                                  (u) =>
                                    !u.arrived_at &&
                                    !["collected", "cancelled"].includes(
                                      u.state,
                                    ),
                                ) && (
                                  <span className="arrival-time">
                                    {Math.max(
                                      0,
                                      Math.ceil(
                                        (Date.parse(detail.order.deadline) -
                                          serverNow) /
                                          60000,
                                      ),
                                    )}{" "}
                                    min left for unarrived portions
                                  </span>
                                )}
                            </div>
                            {detail.units.some(
                              (u) =>
                                u.collector_id === me.actor.id &&
                                !u.arrived_at &&
                                ["pending", "preparing", "ready"].includes(
                                  u.state,
                                ),
                            ) && (
                              <div>
                                <Button
                                  className="primary-action"
                                  disabled={
                                    disabled ||
                                    !detail.order.deadline ||
                                    serverNow >=
                                      Date.parse(detail.order.deadline)
                                  }
                                  onClick={locate}
                                >
                                  <MapPin />
                                  Check in through my app
                                </Button>
                                <p className="help-text">
                                  Allow precise location. If accuracy is poor,
                                  move outdoors and retry.
                                </p>
                              </div>
                            )}
                          </section>
                        )}
                      <div
                        className="segmented pickup-tabs"
                        role="group"
                        aria-label="Order views"
                      >
                        {[
                          "pickup",
                          "share",
                          ...(detail.order.payer ? ["receipt"] : []),
                        ].map((view) => (
                          <Button
                            key={view}
                            aria-pressed={pickupView === view}
                            variant={pickupView === view ? "default" : "ghost"}
                            onClick={() => {
                              setPickupView(view);
                              content.current?.scrollTo(0, 0);
                            }}
                          >
                            {view === "pickup"
                              ? "Pickup"
                              : view === "share"
                                ? "Share"
                                : "Receipt"}
                          </Button>
                        ))}
                      </div>
                      <section
                        className="paper pickup-portions"
                        hidden={pickupView === "receipt"}
                      >
                        <h2>
                          {pickupView === "share"
                            ? "Choose portions to share"
                            : "At your serving counters"}
                        </h2>
                        <p className="help-text">
                          {pickupView === "share"
                            ? "Select portions, then invite a verified friend or cancel eligible items."
                            : "Go directly to each counter. Your token stays active during preparation."}
                        </p>
                        {[
                          ...new Set(detail.units.map((u) => u.station_name)),
                        ].map((counter) => (
                          <div className="counter-group" key={counter}>
                            <h3>
                              <Store size={17} />
                              {counter}
                            </h3>
                            {detail.units
                              .filter((u) => u.station_name === counter)
                              .map((unit) => (
                                <label className="portion" key={unit.id}>
                                  <input
                                    type="checkbox"
                                    hidden={pickupView !== "share"}
                                    checked={selected.includes(unit.id)}
                                    disabled={
                                      disabled ||
                                      pickupView !== "share" ||
                                      ![
                                        "pending",
                                        "preparing",
                                        "ready",
                                      ].includes(unit.state)
                                    }
                                    onChange={(e) =>
                                      setSelected((current) =>
                                        e.target.checked
                                          ? [...current, unit.id]
                                          : current.filter(
                                              (id) => id !== unit.id,
                                            ),
                                      )
                                    }
                                  />
                                  <span>
                                    <strong>{unit.name} × 1</strong>
                                    <small>
                                      {unit.collector_name} · token {unit.token}
                                    </small>
                                    <small>
                                      {unit.arrived_at
                                        ? `Checked in ${time(unit.arrived_at)}`
                                        : "Check-in needed"}
                                      {unit.collection_deadline
                                        ? ` · collect by ${time(unit.collection_deadline)}`
                                        : ""}
                                    </small>
                                  </span>
                                  <Badge variant="secondary">
                                    {unit.state === "pending"
                                      ? unit.mode === "ready"
                                        ? "Ready"
                                        : "Awaiting prep"
                                      : unit.state === "cancelled"
                                        ? "Canceled"
                                        : unit.state[0].toUpperCase() +
                                          unit.state.slice(1)}
                                  </Badge>
                                </label>
                              ))}
                          </div>
                        ))}
                        {detail.order.state === "confirmed" &&
                          !isClosed(detail.units) && (
                            <section
                              className="share-panel"
                              hidden={pickupView !== "share"}
                            >
                              <h2>
                                <Users size={18} />
                                Share pickup or cancel items
                                <span>{selected.length} selected</span>
                              </h2>
                              <div className="stack">
                                <p className="help-text">
                                  A verified friend accepts selected portions
                                  and receives their own pass. Payment stays
                                  with the payer; no extra kitchen order is
                                  created.
                                </p>
                                {detail.order.payer ? (
                                  <>
                                    <label className="field">
                                      Friend email
                                      <Input
                                        type="email"
                                        value={friend}
                                        onChange={(e) =>
                                          setFriend(e.target.value)
                                        }
                                      />
                                    </label>
                                    <Button
                                      disabled={
                                        disabled ||
                                        !selected.length ||
                                        !friend.trim()
                                      }
                                      onClick={() =>
                                        void run(
                                          () =>
                                            api(
                                              `orders/${selectedOrder}/invite`,
                                              {
                                                ids: selected,
                                                email: friend.trim(),
                                              },
                                            ),
                                          "Invitation sent. Rights transfer only after acceptance.",
                                        )
                                      }
                                    >
                                      Invite for {selected.length} portions
                                      <ArrowRight />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      disabled={disabled || !selected.length}
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            "Cancel selected eligible portions for same-canteen credit? This cannot be undone.",
                                          )
                                        )
                                          void run(
                                            () =>
                                              api(
                                                `orders/${selectedOrder}/cancel`,
                                                { ids: selected },
                                              ),
                                            "Eligible portions canceled. Credit added to the payer’s canteen account.",
                                          );
                                      }}
                                    >
                                      Cancel selected
                                    </Button>
                                    {detail.invitations
                                      .filter((i) => i.state === "pending")
                                      .map((invitation) => (
                                        <Button
                                          key={invitation.id}
                                          variant="ghost"
                                          disabled={disabled}
                                          onClick={() =>
                                            void run(
                                              () =>
                                                api(
                                                  `invitations/${invitation.id}`,
                                                  { action: "withdraw" },
                                                ),
                                              "Invitation withdrawn.",
                                            )
                                          }
                                        >
                                          Withdraw pending invitation
                                        </Button>
                                      ))}
                                  </>
                                ) : (
                                  <Button
                                    variant="outline"
                                    disabled={disabled || !selected.length}
                                    onClick={() =>
                                      void run(
                                        () =>
                                          api(
                                            `orders/${selectedOrder}/return`,
                                            { ids: selected },
                                          ),
                                        "Pickup rights returned to payer.",
                                      )
                                    }
                                  >
                                    Return selected pickup rights
                                  </Button>
                                )}
                              </div>
                            </section>
                          )}
                      </section>
                      {detail.order.payer && (
                        <section
                          className="paper receipt"
                          hidden={pickupView !== "receipt"}
                        >
                          <h2>
                            <ReceiptText size={18} />
                            Your receipt
                          </h2>
                          <div className="total-line">
                            <span>
                              {detail.order.state === "confirmed"
                                ? "Total paid"
                                : "Order total"}
                            </span>
                            <strong>{money(detail.order.total)}</strong>
                          </div>
                          <p className="help-text">
                            Credit {money(detail.order.credit)} · Online{" "}
                            {money(detail.order.external)}
                          </p>
                          <p className="help-text">
                            Eligible expired or canceled portions return as
                            same-canteen credit.
                          </p>
                          <Button
                            variant="link"
                            onClick={() => setTab("credit")}
                          >
                            View credit activity
                            <ArrowRight />
                          </Button>
                        </section>
                      )}
                      {detail.resolutions.map((resolution, index) => (
                        <div
                          className="paper"
                          key={index}
                          hidden={pickupView !== "receipt"}
                        >
                          <strong>
                            Payment resolution · {resolution.state}
                          </strong>
                          <p>
                            {money(resolution.amount)} · {resolution.reason}
                          </p>
                        </div>
                      ))}

                      {pickupView === "pickup" &&
                        detail.order.state === "confirmed" &&
                        ownActive.length > 0 && (
                          <div className="screen-action">
                            <Button
                              className="primary-action"
                              disabled={disabled}
                              onClick={() => void showPasses()}
                            >
                              Show my station passes
                              <ScanLine />
                            </Button>
                          </div>
                        )}
                      <dialog
                        ref={passDialog}
                        className="pass-dialog"
                        aria-labelledby="pass-title"
                      >
                        <div className="dialog-heading">
                          <h2 id="pass-title">Your pickup passes</h2>
                          <Button
                            variant="ghost"
                            aria-label="Close pickup passes"
                            onClick={() => passDialog.current?.close()}
                          >
                            Close
                          </Button>
                        </div>
                        <p className="help-text">
                          Show your pass and collector identity at the named
                          counter.
                        </p>
                        {codes.map((code) => (
                          <div key={code.token} className="qr-pass">
                            <h3>{code.stationName}</h3>
                            <Image
                              unoptimized
                              src={code.image}
                              width={280}
                              height={280}
                              alt={`Collection pass for ${code.stationName}`}
                            />
                            <p className="help-text">
                              {code.arrived
                                ? "Checked in · ready for staff verification"
                                : "Check in before handover"}
                            </p>
                            <Button
                              variant="ghost"
                              disabled={!online}
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(code.token)
                                  .then(() =>
                                    setMessage(
                                      "Pass copied for scanner fallback.",
                                    ),
                                  )
                                  .catch(() =>
                                    setMessage(
                                      "Cannot copy this pass. Show the QR code instead.",
                                    ),
                                  )
                              }
                            >
                              Copy pass
                            </Button>
                          </div>
                        ))}
                      </dialog>
                    </>
                  )}
                </>
              ) : (
                <>
                  <PageHeading
                    eyebrow="FROM PAYMENT TO THE LAST PORTION"
                    title="Your orders"
                    text="Pickups, shared portions, and little breaks past."
                  />
                  {me.invitations
                    .filter((i) => i.state === "pending")
                    .map((invitation) => (
                      <section className="invitation-card" key={invitation.id}>
                        <Users />
                        <div>
                          <h2>A friend saved you a pickup</h2>
                          <p>
                            {invitation.sender_name} · {invitation.reference}
                          </p>
                          {invitation.portions?.map((portion, index) => (
                            <p className="help-text" key={index}>
                              {portion.name} · {portion.station}
                            </p>
                          ))}
                          <p className="help-text">
                            Accepting transfers pickup rights. Check in before{" "}
                            {time(invitation.deadline || null)}.
                          </p>
                          <div className="actions">
                            <Button
                              disabled={disabled}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(`invitations/${invitation.id}`, {
                                      action: "accept",
                                    }),
                                  "Pickup assignment accepted.",
                                )
                              }
                            >
                              Accept
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={disabled}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(`invitations/${invitation.id}`, {
                                      action: "decline",
                                    }),
                                  "Invitation declined.",
                                )
                              }
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      </section>
                    ))}
                  <div className="segmented order-tabs">
                    {["active", "history"].map((filter) => (
                      <Button
                        key={filter}
                        variant={orderFilter === filter ? "default" : "ghost"}
                        onClick={() => setOrderFilter(filter)}
                      >
                        {filter === "active" ? "Active pickups" : "Past orders"}
                      </Button>
                    ))}
                  </div>
                  {visibleOrders.length ? (
                    <div className="order-list">
                      {visibleOrders.map((order) => (
                        <button
                          className="order-row"
                          key={order.id}
                          onClick={() => openOrder(order.id)}
                        >
                          <span className="order-icon">
                            <ReceiptText />
                          </span>
                          <span>
                            <strong>
                              {order.canteen_name ||
                                catalogue.canteens.find(
                                  (site) => site.id === order.canteen_id,
                                )?.name}{" "}
                              canteen
                            </strong>
                            <small>
                              {order.reference} ·{" "}
                              {fulfillmentSummary(
                                order.state,
                                order.fulfillment,
                              )}
                            </small>
                            <small>
                              {order.payer ? "Your order" : "Shared pickup"}
                              {order.deadline &&
                              !isClosed(order.fulfillment || [])
                                ? ` · arrival by ${time(order.deadline)}`
                                : ""}
                            </small>
                          </span>
                          <ChevronRight />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={<ReceiptText />}
                      title={
                        orderFilter === "active"
                          ? "Nothing to pick up. Yet."
                          : "Your breaks will live here."
                      }
                      text={
                        orderFilter === "active"
                          ? "Your next order and accepted pickups will appear here."
                          : "Completed and canceled orders appear here."
                      }
                      action={
                        <Button onClick={() => setTab("menu")}>
                          Find something good
                          <ArrowRight />
                        </Button>
                      }
                    />
                  )}
                </>
              ))}
            {tab === "account" && (
              <>
                <PageHeading
                  eyebrow="YOUR CORNER OF CAMPUS"
                  title="Your account"
                />
                <section className="paper account-card">
                  <span className="avatar">
                    {me.actor.email[0].toUpperCase()}
                  </span>
                  <div>
                    <h2>{student ? "Student account" : "Staff account"}</h2>
                    <p>{me.actor.email}</p>
                    <p className="help-text">
                      {student
                        ? "University email verified"
                        : "Assigned canteen access"}
                    </p>
                  </div>
                  <ShieldCheck />
                </section>
                {student && (
                  <button
                    className="account-link paper"
                    onClick={() => setTab("credit")}
                  >
                    <Wallet />
                    <span>
                      <strong>Canteen credit</strong>
                      <small>
                        {money(
                          me.credits.reduce(
                            (sum, credit) => sum + credit.available,
                            0,
                          ),
                        )}{" "}
                        across your canteens
                      </small>
                    </span>
                    <ChevronRight />
                  </button>
                )}
                <section className="paper stack">
                  <h2>A little help</h2>
                  <p className="help-text">
                    For pickup help, show your order reference at the serving
                    counter. For payment or credit issues, ask your canteen
                    manager.
                  </p>
                  <p className="help-text">
                    Install MINT from your browser menu: “Add to Home Screen” or
                    “Install app”. Orders and pickup actions need an internet
                    connection.
                  </p>
                  {!student &&
                    me.roles.map((role, index) => (
                      <p key={index}>
                        {role.canteen_name} · {role.station_name || role.role}
                      </p>
                    ))}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void logout()}
                  >
                    <LogOut />
                    Sign out
                  </Button>
                </section>
              </>
            )}
            {tab === "credit" && student && (
              <>
                <Button
                  variant="ghost"
                  className="back-button"
                  onClick={() => setTab("account")}
                >
                  <ChevronLeft />
                  Your account
                </Button>
                <PageHeading
                  eyebrow="FOR YOUR NEXT CAMPUS BREAK"
                  title="Canteen credit"
                  text="Credit stays at the original canteen. It does not return to your bank."
                />
                <div className="credit-grid">
                  {me.credits.map((credit) => (
                    <section className="credit-card" key={credit.canteen_id}>
                      <div>
                        <Wallet />
                        <span>{credit.canteen_name}</span>
                      </div>
                      <strong>{money(credit.available)}</strong>
                      <p>Available for your next order</p>
                      {credit.reserved > 0 && (
                        <small>
                          {money(credit.reserved)} reserved in a checkout
                        </small>
                      )}
                    </section>
                  ))}
                </div>
                {!me.credits.length && (
                  <Empty
                    icon={<Wallet />}
                    title="A fresh start"
                    text="Any eligible cancellation credit will appear here, at its original canteen."
                  />
                )}
                <section className="paper">
                  <h2>Credit activity</h2>
                  {me.ledger.length ? (
                    me.ledger.map((entry, index) => (
                      <div className="ledger-line" key={index}>
                        <span>
                          <strong>{entry.canteen_name}</strong>
                          <small>
                            {entry.reason.replaceAll("_", " ")} ·{" "}
                            {new Date(entry.created_at).toLocaleDateString(
                              "en-IN",
                            )}
                          </small>
                        </span>
                        <strong>{money(entry.amount)}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="help-text">No credit activity yet.</p>
                  )}
                </section>
              </>
            )}
            {tab === "staff" && !student && (
              <>
                <div className="screen-heading">
                  <h1>Serving</h1>
                </div>
                <div className="field">
                  <label htmlFor="station">Authorized station</label>
                  <select
                    id="station"
                    value={station}
                    onChange={(e) => {
                      stopScan();
                      setStation(e.target.value);
                      setResolved([]);
                      setStaffSelected([]);
                    }}
                  >
                    {stationOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {
                          catalogue.canteens.find((c) => c.id === s.canteen_id)
                            ?.name
                        }{" "}
                        · {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="segmented workspace-tabs">
                  <Button
                    variant={staffView === "scan" ? "default" : "ghost"}
                    onClick={() => setStaffView("scan")}
                  >
                    <ScanLine />
                    Scan pickup
                  </Button>
                  <Button
                    variant={staffView === "queue" ? "default" : "ghost"}
                    onClick={() => setStaffView("queue")}
                  >
                    <Clock />
                    Queue
                  </Button>
                </div>{" "}
                <div className="staff-workspace">
                  <div
                    className="paper space-y-4"
                    hidden={staffView !== "scan"}
                  >
                    <h3 className="text-xl font-bold">Look up a pickup</h3>
                    <p className="text-xs text-muted-foreground">
                      Scanning looks up portions. It never confirms arrival or
                      handover.
                    </p>
                    <video
                      ref={video}
                      playsInline
                      muted
                      className={scanning ? "w-full rounded-lg" : "hidden"}
                    />
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={!online || busy}
                      onClick={() => (scanning ? stopScan() : void scan())}
                    >
                      <ScanLine size={18} />
                      {scanning ? "Stop camera" : "Scan collection QR"}
                    </Button>
                    <div className="field">
                      <label htmlFor="token">Collection pass</label>
                      <Input
                        id="token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      className="w-full"
                      disabled={busy || !online || !token || !station}
                      onClick={() =>
                        void run(async () => {
                          const r = await api<{
                            units: Unit[];
                            message: string;
                          }>("staff/resolve", { stationId: station, token });
                          setResolved(r.units);
                          setStaffSelected([]);
                          setMessage(r.message);
                        })
                      }
                    >
                      Resolve pass
                    </Button>
                    <details>
                      <summary className="text-sm cursor-pointer">
                        Use order reference instead
                      </summary>
                      <div className="space-y-3 mt-3">
                        <label className="field">
                          Order reference
                          <Input
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                          />
                        </label>
                        <label className="field">
                          Expected collector email
                          <Input
                            type="email"
                            value={collector}
                            onChange={(e) => setCollector(e.target.value)}
                          />
                        </label>
                        <Button
                          variant="outline"
                          disabled={busy || !online || !reference || !collector}
                          onClick={() =>
                            void run(async () => {
                              const r = await api<{
                                units: Unit[];
                                message: string;
                              }>("staff/resolve", {
                                stationId: station,
                                reference,
                                collector,
                              });
                              setResolved(r.units);
                              setStaffSelected([]);
                              setMessage(r.message);
                            })
                          }
                        >
                          Look up reference
                        </Button>
                      </div>
                    </details>
                    {resolved.length > 0 && (
                      <>
                        <div className="divider" />
                        <p className="text-sm font-bold">
                          {resolved[0].collector_name} · {resolved[0].reference}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Check collector identity. Select only portions
                          physically handed over.
                        </p>
                        {resolved.map((u) => (
                          <label
                            key={u.id}
                            className="flex gap-3 items-start border p-3 rounded-lg"
                          >
                            <input
                              type="checkbox"
                              checked={staffSelected.includes(u.id)}
                              disabled={
                                !u.arrived_at ||
                                !(
                                  u.state === "ready" ||
                                  (u.mode === "ready" && u.state === "pending")
                                )
                              }
                              onChange={(e) => {
                                setStaffSelected((v) =>
                                  e.target.checked
                                    ? [...v, u.id]
                                    : v.filter((id) => id !== u.id),
                                );
                                handoverKey.current = "";
                              }}
                            />
                            <span className="text-sm">
                              <strong>{u.name} × 1</strong>
                              <span className="block text-xs mt-1">
                                {u.state} ·{" "}
                                {u.arrived_at
                                  ? "Arrived"
                                  : "App check-in required"}{" "}
                                · {u.token}
                              </span>
                            </span>
                          </label>
                        ))}
                        <Button
                          className="w-full"
                          disabled={!staffSelected.length || busy || !online}
                          onClick={() =>
                            void run(async () => {
                              handoverKey.current ||= crypto.randomUUID();
                              await api("staff/handover", {
                                stationId: station,
                                portions: resolved
                                  .filter((u) => staffSelected.includes(u.id))
                                  .map((u) => ({
                                    id: u.id,
                                    version: u.version,
                                  })),
                                key: handoverKey.current,
                              });
                              setResolved((v) =>
                                v.filter((u) => !staffSelected.includes(u.id)),
                              );
                              setStaffSelected([]);
                              handoverKey.current = "";
                            }, "Handover confirmed. Do not give these portions to another collector.")
                          }
                        >
                          Handed over: {staffSelected.length} portions
                          <Check size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          className="w-full"
                          onClick={() => {
                            setResolved([]);
                            setToken("");
                            setStaffSelected([]);
                          }}
                        >
                          Next pickup
                        </Button>
                      </>
                    )}
                  </div>
                  <section
                    className="paper space-y-4"
                    hidden={staffView !== "queue"}
                  >
                    <div>
                      <h3 className="text-xl font-bold">Station worklist</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Persistent portion tokens · refreshes every five seconds
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["pending", "preparing", "ready", "collected"].map(
                        (t) => (
                          <Button
                            size="sm"
                            key={t}
                            variant={queueTab === t ? "default" : "outline"}
                            onClick={() => setQueueTab(t)}
                          >
                            {t === "pending"
                              ? "Awaiting prep"
                              : t === "collected"
                                ? "Recent handovers"
                                : t === "ready"
                                  ? "Ready"
                                  : "Preparing"}{" "}
                            (
                            {
                              work.filter((u) =>
                                t === "ready"
                                  ? u.state === "ready" ||
                                    (u.mode === "ready" &&
                                      u.state === "pending")
                                  : u.state === t,
                              ).length
                            }
                            )
                          </Button>
                        ),
                      )}
                    </div>
                    {!queued.length && (
                      <p className="text-sm text-muted-foreground py-4">
                        Nothing in this worklist right now.
                      </p>
                    )}
                    {queued.map((u) => (
                      <div
                        key={u.id}
                        className="border rounded-lg p-3 space-y-2"
                      >
                        <div className="flex justify-between gap-2">
                          <strong>{u.name} × 1</strong>
                          <Badge variant="outline">{u.token}</Badge>
                        </div>
                        <p className="text-xs">
                          {u.collector_name} · {u.reference} · arrived{" "}
                          {time(u.arrived_at)}
                        </p>
                        {u.overdue ? (
                          <p className="text-xs error">
                            Collection overdue — manager review. No automatic
                            forfeiture.
                          </p>
                        ) : u.mode === "made" &&
                          ["pending", "preparing"].includes(u.state) ? (
                          <Button
                            size="sm"
                            disabled={busy || !online}
                            onClick={() =>
                              void run(
                                () =>
                                  api("staff/preparation", {
                                    id: u.id,
                                    action:
                                      u.state === "pending" ? "start" : "ready",
                                  }),
                                u.state === "pending"
                                  ? "Preparation started."
                                  : "Food is ready. The collection deadline started.",
                              )
                            }
                          >
                            {u.state === "pending"
                              ? "Start preparation"
                              : "Mark ready"}
                          </Button>
                        ) : (
                          u.state !== "collected" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !online}
                              onClick={() => {
                                setStaffView("scan");
                                setResolved([u]);
                                setStaffSelected([]);
                              }}
                            >
                              Inspect for handover
                            </Button>
                          )
                        )}
                      </div>
                    ))}
                  </section>
                </div>
              </>
            )}
            {tab === "manager" && !student && (
              <>
                <PageHeading
                  eyebrow="ONLINE ORDER AVAILABILITY"
                  title="Available stock"
                  text="Set how many portions are available for new online orders."
                />
                {canteenSelect("manager")}
                {canManage ? (
                  <section className="stack">
                    <p className="help-text">
                      Existing reservations stay protected. Enter the portions
                      available for new online orders.
                    </p>
                    {menus.length === 0 && (
                      <Empty
                        icon={<Utensils />}
                        title="No menu items yet"
                        text="Your configured menu will appear here."
                      />
                    )}
                    {menus.map((item) => (
                      <StockEditor
                        key={`${canteen}:${item.id}`}
                        item={item}
                        disabled={disabled}
                        run={run}
                        save={(quantity, expectedAvailable) =>
                          api(`manager/${canteen}`, {
                            action: "stock",
                            itemId: item.id,
                            quantity,
                            expectedAvailable,
                            reason:
                              "Manager updated availability for online orders",
                          })
                        }
                      />
                    ))}
                  </section>
                ) : (
                  <Empty
                    icon={<ShieldCheck />}
                    title="Manager access required"
                    text="Only the manager assigned to this canteen can update availability."
                  />
                )}
              </>
            )}
            {student && tab === "menu" && cartCount > 0 && (
              <div className="cart-dock">
                <Button onClick={() => setTab("cart")}>
                  <ShoppingBag />
                  <span>
                    {cartCount} {cartCount === 1 ? "item" : "items"} · View cart
                  </span>
                  <strong>{money(total)}</strong>
                  <ArrowRight />
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
function StockEditor({
  item,
  disabled,
  run,
  save,
}: {
  item: Item;
  disabled: boolean;
  run: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  save: (quantity: number, expectedAvailable: number) => Promise<unknown>;
}) {
  const [quantity, setQuantity] = useState<string | null>(null);
  const [expected, setExpected] = useState<number | null>(null);
  const changed = quantity !== null && Number(quantity) !== item.available;
  const stale = expected !== null && expected !== item.available;
  return (
    <form
      className="paper stock-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (stale || !changed || quantity === null || expected === null) return;
        void run(async () => {
          await save(Number(quantity), expected);
          setQuantity(null);
          setExpected(null);
        }, `${item.name} availability updated.`);
      }}
    >
      <div className="stock-item-heading">
        <div>
          <h2>{item.name}</h2>
          <p className="help-text">
            {item.station_name} · {money(item.price)}
          </p>
        </div>
        <Badge variant="outline">{item.available} available</Badge>
      </div>
      <div className="stock-item-controls">
        <label className="field">
          Available portions for {item.name}
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            step={1}
            required
            disabled={disabled}
            value={quantity ?? item.available}
            onChange={(event) => {
              setQuantity(event.target.value);
              setExpected((value) => value ?? item.available);
            }}
          />
        </label>
        {stale ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              setExpected(item.available);
            }}
          >
            Review latest stock
          </Button>
        ) : (
          <Button
            disabled={disabled || !changed}
            aria-label={`Save ${item.name} availability`}
          >
            Save
          </Button>
        )}
      </div>
      {stale && (
        <p className="help-text" role="status">
          Availability changed to {item.available}. Review it before saving your
          quantity.
        </p>
      )}
    </form>
  );
}
function PageHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {text && <p className="screen-subtitle">{text}</p>}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </section>
  );
}
function BreakIllustration() {
  return (
    <svg viewBox="0 0 300 220" fill="none" aria-hidden="true">
      <ellipse cx="151" cy="177" rx="113" ry="19" fill="#284e3b" opacity=".1" />
      <path
        d="M86 85c-13-17 14-23 1-40M108 82c-13-17 14-23 1-40"
        stroke="#53735c"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M49 98h105l-8 55c-5 34-84 34-89 0z"
        fill="#faf3dc"
        stroke="#294d3a"
        strokeWidth="3"
      />
      <path
        d="M153 108h16c24 0 24 36 0 36h-21"
        stroke="#294d3a"
        strokeWidth="5"
      />
      <ellipse
        cx="101"
        cy="99"
        rx="52"
        ry="9"
        fill="#c99563"
        stroke="#294d3a"
        strokeWidth="3"
      />
      <ellipse
        cx="213"
        cy="159"
        rx="59"
        ry="30"
        fill="#f7f3e3"
        stroke="#294d3a"
        strokeWidth="3"
      />
      <ellipse
        cx="213"
        cy="159"
        rx="44"
        ry="20"
        stroke="#b5bea2"
        strokeWidth="2"
      />
      <path
        d="M180 156c3-32 55-40 69-9l-27 29z"
        fill="#e3a956"
        stroke="#294d3a"
        strokeWidth="3"
      />
      <path
        d="m184 155 36 12 23-21M195 148l28 10"
        stroke="#b57636"
        strokeWidth="2"
      />
      <path
        d="m231 91 5-12m7 14 9-6m-21 14 12 2"
        stroke="#294d3a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M52 182c-15 0-25-13-23-23 13 0 23 9 23 23Zm0 0c0-20 8-29 21-31 3 16-5 28-21 31Z"
        fill="#53735c"
      />
      <path d="m160 55 4-12 4 12 12 4-12 4-4 12-4-12-12-4z" fill="#e0a759" />
      <path
        d="m99 129 6 6 13-16"
        stroke="#294d3a"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function FoodIllustration({ name }: { name: string }) {
  const drink = /juice|tea|coffee|drink|milk|lassi/i.test(name);
  return (
    <svg viewBox="0 0 240 140" aria-hidden="true" fill="none">
      <ellipse
        cx="120"
        cy="119"
        rx={drink ? 45 : 79}
        ry="9"
        fill="#3e4830"
        opacity=".1"
      />
      {drink ? (
        <>
          <path
            d="M87 30h67l-8 78c-2 16-48 16-50 0z"
            fill="#fffaf0"
            stroke="#66563b"
            strokeWidth="2"
          />
          <path d="m92 48 6 58c2 9 42 9 44 0l6-58z" fill="#dfa55b" />
          <ellipse cx="120" cy="49" rx="27" ry="5" fill="#edc989" />
          <path
            d="m133 70 12-55 16-9"
            stroke="#507151"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M89 35c-9-2-10-14-3-21 7-7 20-4 24 4z"
            fill="#e5b653"
            stroke="#f8edd7"
            strokeWidth="3"
          />
          <path
            d="m85 23 11 1m-5-8 5 8-10 3"
            stroke="#fff5d9"
            strokeWidth="2"
          />
        </>
      ) : (
        <>
          <ellipse
            cx="120"
            cy="90"
            rx="82"
            ry="31"
            fill="#fffaf0"
            stroke="#c2b99c"
            strokeWidth="2"
          />
          <ellipse
            cx="120"
            cy="90"
            rx="65"
            ry="23"
            stroke="#e3dbc8"
            strokeWidth="2"
          />
          {/dosa|parotta|roti/i.test(name) ? (
            <>
              <path
                d="m70 82 73-44c17-8 44 21 31 33l-66 39c-19 8-48-17-38-28Z"
                fill="#dca758"
                stroke="#aa743d"
                strokeWidth="2"
              />
              <path
                d="m84 79 67-37m-55 47 67-39m-55 48 61-38"
                stroke="#b77e3c"
                strokeWidth="2"
                opacity=".6"
              />
            </>
          ) : /idli/i.test(name) ? (
            <>
              <ellipse
                cx="98"
                cy="70"
                rx="26"
                ry="17"
                fill="#f1eddf"
                stroke="#d9d0b6"
              />
              <ellipse
                cx="138"
                cy="75"
                rx="27"
                ry="18"
                fill="#f8f5e9"
                stroke="#d9d0b6"
              />
              <ellipse
                cx="111"
                cy="94"
                rx="27"
                ry="17"
                fill="#fffdf2"
                stroke="#d9d0b6"
              />
            </>
          ) : (
            <>
              <path
                d="M66 88c2-43 96-50 109 0-18 27-88 27-109 0"
                fill="#e0b76b"
                stroke="#ba9252"
                strokeWidth="2"
              />
              <path
                d="m84 76 7 3m10-10 7 3m10 11 7-3m14-10 7 2m-53 15 8 2m19 0 6 3m12-4 7-1"
                stroke="#f7e4b0"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="m101 78 4-6m34 12 4-6m-23 24 4-6"
                stroke="#66844c"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
          <ellipse
            cx="173"
            cy="99"
            rx="16"
            ry="10"
            fill="#c98048"
            stroke="#fff7e6"
            strokeWidth="4"
          />
          <path d="M62 102c3-12 13-17 23-13-1 11-11 17-23 13" fill="#6d8b50" />
        </>
      )}
    </svg>
  );
}
