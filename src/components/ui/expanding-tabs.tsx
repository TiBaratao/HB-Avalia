"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type ExpandingTab<T extends string> = {
  id: T;
  label: string;
  description: string;
  count?: string;
  icon: ReactNode;
};

type ExpandingTabsProps<T extends string> = {
  tabs: ExpandingTab<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  ariaLabel: string;
};

const spring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 30,
  mass: 0.7,
};

export default function ExpandingTabs<T extends string>({ tabs, activeTab, onChange, ariaLabel }: ExpandingTabsProps<T>) {
  const reduceMotion = useReducedMotion();

  function selectTab(index: number) {
    const nextIndex = (index + tabs.length) % tabs.length;
    onChange(tabs[nextIndex].id);
    document.getElementById(`expanding-tab-${tabs[nextIndex].id}`)?.focus();
  }

  return (
    <motion.div
      layout
      transition={reduceMotion ? { duration: 0 } : spring}
      role="tablist"
      aria-label={ariaLabel}
      className="expanding-tabs"
    >
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            layout
            type="button"
            role="tab"
            id={`expanding-tab-${tab.id}`}
            aria-selected={isActive}
            aria-label={`${tab.label}${tab.count ? `, ${tab.count}` : ""}`}
            aria-controls="configuration-panel"
            aria-current={isActive ? "step" : undefined}
            tabIndex={isActive ? 0 : -1}
            title={`${tab.label}${tab.count ? ` · ${tab.count}` : ""}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                selectTab(index + 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                selectTab(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                selectTab(0);
              } else if (event.key === "End") {
                event.preventDefault();
                selectTab(tabs.length - 1);
              }
            }}
            whileHover={!reduceMotion && !isActive ? { scale: 1.045 } : undefined}
            whileTap={!reduceMotion ? { scale: 0.96 } : undefined}
            transition={reduceMotion ? { duration: 0 } : spring}
            className={`expanding-tab${isActive ? " active" : ""}`}
          >
            <motion.span
              animate={{ scale: isActive ? 1.03 : 1, opacity: isActive ? 1 : 0.76 }}
              transition={reduceMotion ? { duration: 0 } : spring}
              className="expanding-tab-icon"
              aria-hidden="true"
            >
              {tab.icon}
            </motion.span>
            <AnimatePresence initial={false}>
              {isActive && (
                <motion.span
                  key="tab-label"
                  initial={reduceMotion ? false : { opacity: 0, x: -7 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, x: -7 }}
                  transition={reduceMotion ? { duration: 0 } : spring}
                  className="expanding-tab-label"
                >
                  <b>{tab.label}</b>
                  <small>{tab.count ? `${tab.description} · ${tab.count}` : tab.description}</small>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
