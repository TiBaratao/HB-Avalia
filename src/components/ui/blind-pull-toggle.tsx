"use client";

import { useCallback, useRef, useState } from "react";
import { motion, stagger, useAnimate, useReducedMotion } from "framer-motion";
import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "../ThemeProvider";

const SLATS = 6;
const CONTROL_SIZE = 40;
const SPRING = { type: "spring" as const, stiffness: 300, damping: 18 };

export default function BlindPullToggle() {
  const { theme, toggleTheme } = useTheme();
  const [animating, setAnimating] = useState(false);
  const animatingRef = useRef(false);
  const [scope, animate] = useAnimate();
  const prefersReducedMotion = useReducedMotion();
  const isDark = theme === "dark";
  const Icon = isDark ? Sun : Moon;
  const nextTheme = isDark ? "claro" : "noturno";
  const iconSize = 20;
  const radius = 12;
  const cordRestHeight = 7;
  const dotSize = 7;

  const handleToggle = useCallback(async () => {
    if (animatingRef.current) return;

    animatingRef.current = true;
    setAnimating(true);
    try {
      if (prefersReducedMotion) {
        toggleTheme();
        return;
      }

      await animate(".blind-pull-cord", { height: 20 }, { duration: 0.1, ease: [0.4, 0, 1, 1] });
      void animate(".blind-pull-cord", { height: cordRestHeight }, SPRING);
      await animate(".blind-pull-slat", { scaleY: 0 }, { delay: stagger(0.035), duration: 0.1, ease: "easeIn" });
      toggleTheme();
      await animate(".blind-pull-slat", { scaleY: 1 }, { delay: stagger(0.035), duration: 0.13, ease: "easeOut" });
    } finally {
      animatingRef.current = false;
      setAnimating(false);
    }
  }, [animate, cordRestHeight, prefersReducedMotion, toggleTheme]);

  return (
    <div ref={scope} className="blind-pull-toggle">
      <motion.button
        className="blind-pull-button"
        type="button"
        aria-label={`Ativar modo ${nextTheme}`}
        aria-pressed={isDark}
        title={`Ativar modo ${nextTheme}`}
        disabled={animating}
        onClick={() => void handleToggle()}
        whileHover={prefersReducedMotion ? undefined : { scale: 1.06 }}
        whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        style={{ width: CONTROL_SIZE, height: CONTROL_SIZE, borderRadius: radius }}
      >
        <span className="blind-pull-slat-window" aria-hidden="true">
          {Array.from({ length: SLATS }, (_, index) => {
            const top = Math.round((index / SLATS) * CONTROL_SIZE);
            const nextTop = index === SLATS - 1
              ? CONTROL_SIZE
              : Math.round(((index + 1) / SLATS) * CONTROL_SIZE);

            return (
              <span
                key={index}
                className="blind-pull-slat"
                style={{ top, height: nextTop - top }}
              >
                <span
                  className="blind-pull-slat-face"
                  style={{ top: -top, left: 0, right: "auto", bottom: "auto" }}
                >
                  <Icon size={iconSize} weight="regular" />
                </span>
              </span>
            );
          })}
        </span>
      </motion.button>
      <span
        className="blind-pull-cord blind-pull-cord-line"
        aria-hidden="true"
        style={{ height: cordRestHeight }}
      />
      <span className="blind-pull-dot" aria-hidden="true" style={{ width: dotSize, height: dotSize }} />
    </div>
  );
}
