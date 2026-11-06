"use client";

import type { ReactNode } from "react";

type ConfigTab<T extends string> = {
  id: T;
  label: string;
  description: string;
  count?: string;
  icon: ReactNode;
};

type ConfigTabsProps<T extends string> = {
  tabs: ConfigTab<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  ariaLabel: string;
};

/**
 * Abas da Configuração. Todas mostram nome e contagem o tempo todo.
 * Mantém os mesmos ids e a mesma navegação por teclado das abas anteriores
 * (setas, Home e End), para o painel `configuration-panel` continuar ligado a elas.
 */
export default function ConfigTabs<T extends string>({ tabs, activeTab, onChange, ariaLabel }: ConfigTabsProps<T>) {
  function selectTab(index: number) {
    const nextIndex = (index + tabs.length) % tabs.length;
    onChange(tabs[nextIndex].id);
    document.getElementById(`expanding-tab-${tabs[nextIndex].id}`)?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="config-tabs">
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`expanding-tab-${tab.id}`}
            aria-selected={isActive}
            aria-label={`${tab.label}${tab.count ? `, ${tab.count}` : ""}`}
            aria-controls="configuration-panel"
            tabIndex={isActive ? 0 : -1}
            title={`${tab.label}${tab.count ? ` · ${tab.count}` : ` · ${tab.description}`}`}
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
            className={`config-tab${isActive ? " active" : ""}`}
          >
            <span className="config-tab-icon" aria-hidden="true">{tab.icon}</span>
            <span className="config-tab-text">
              <b>{tab.label}</b>
              <small>{tab.count ?? tab.description}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
