import type { Metadata } from "next";
import "./globals.css";
import "./live.css";
import "./checklists.css";
import "./expanding-design.css";
import "./brand-palette.css";
import "./filters.css";
import { ThemeProvider } from "../components/ThemeProvider";
import Script from "next/script";

export const metadata: Metadata = {
  title: "avalia · Desempenho e liderança",
  description: "Avaliações de desempenho simples, claras e contínuas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Script id="initialize-theme" strategy="beforeInteractive">
          {`document.documentElement.dataset.theme = localStorage.getItem("hb-avalia-theme") === "dark" ? "dark" : "light";`}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
