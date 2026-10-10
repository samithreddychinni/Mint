"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt({ enabled }: { enabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const update = () => {
      const active =
        standalone.matches ||
        !!(navigator as Navigator & { standalone?: boolean }).standalone;
      setInstalled(active);
      if (active) dialog.current?.close();
    };
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const installed = () => {
      setInstalled(true);
      setPrompt(null);
      dialog.current?.close();
    };
    const timer = window.setTimeout(() => {
      update();
      setIos(
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      );
    }, 0);
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    standalone.addEventListener("change", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
      standalone.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled || installed) return;
    let timer: number;
    const show = () => {
      try {
        if (localStorage.getItem("mint-install-dismissed")) return;
      } catch {
        /* Storage can be unavailable in private browsing. */
      }
      dialog.current?.showModal();
    };
    const reset = () => {
      clearTimeout(timer);
      timer = window.setTimeout(show, 8000);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [enabled, installed]);

  const dismiss = () => {
    try {
      localStorage.setItem("mint-install-dismissed", "1");
    } catch {
      /* The app remains usable without storage. */
    }
    dialog.current?.close();
  };
  if (installed) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Install MINT"
        onClick={() => dialog.current?.showModal()}
      >
        <Download />
      </Button>
      <dialog
        ref={dialog}
        className="install-dialog"
        aria-labelledby="install-title"
        aria-describedby="install-description"
        onCancel={dismiss}
      >
        <button
          className="install-close"
          aria-label="Close install prompt"
          onClick={dismiss}
        >
          <X size={20} />
        </button>
        <span className="install-icon">
          <Download size={27} />
        </span>

        <h2 id="install-title">Add MINT to your home screen</h2>
        <p id="install-description">
          Open your menu and pickup passes in one tap.
        </p>
        {prompt ? (
          <Button
            className="primary-action"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await prompt.prompt();
                const choice = await prompt.userChoice;
                setPrompt(null);
                if (choice.outcome === "accepted") dismiss();
              } catch {
                setPrompt(null);
                setError(
                  "Use your browser menu to add MINT to your home screen.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Opening install…" : "Add to home screen"}
            <Download size={18} />
          </Button>
        ) : (
          <div className="install-instructions">
            {ios ? (
              <>
                <Share size={20} />
                <p>
                  Tap <strong>Share</strong> in Safari, then{" "}
                  <strong>Add to Home Screen</strong>.
                </p>
              </>
            ) : (
              <>
                <Download size={20} />
                <p>
                  Open your browser menu and choose <strong>Install app</strong>{" "}
                  or <strong>Add to Home Screen</strong>. If unavailable, open
                  MINT in Chrome, Edge, or Safari.
                </p>
              </>
            )}
          </div>
        )}
        {error && (
          <p role="status" className="error">
            {error}
          </p>
        )}
        <Button variant="ghost" className="w-full" onClick={dismiss}>
          Keep using the browser
        </Button>
      </dialog>
    </>
  );
}
