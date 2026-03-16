"use client";

import { Info } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!visible || !iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });
  }, [visible]);

  return (
    <>
      <span
        ref={iconRef}
        className="inline-flex shrink-0 cursor-help"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        <Info className="size-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" />
      </span>

      {visible && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[9999] w-60 rounded-lg border bg-popover text-popover-foreground px-3 py-2.5 text-xs leading-relaxed shadow-lg pointer-events-none"
            style={{ top: coords.top, left: coords.left, transform: "translateX(-50%)" }}
          >
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-border" />
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[-1px] border-4 border-transparent border-b-popover" />
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
