import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Comparador Paraná",
    template: "%s · Comparador Paraná",
  },
  description:
    "Compará propiedades en Paraná: venta y alquiler, múltiples fuentes, filtros por tipo, moneda y precio.",
  applicationName: "Comparador Paraná",
  keywords: ["Paraná", "propiedades", "inmobiliarias", "alquiler", "venta", "comparador"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
