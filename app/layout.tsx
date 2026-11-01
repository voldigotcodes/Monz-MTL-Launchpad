import "./globals.css";

import Link from "next/link";
import { Providers } from "./providers";

export const metadata = {
  title: "Monz MTL Launchpad",
  description: "Browser-based launcher UI for Meta campaign automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <aside className="sidebar">
              <div className="brand">
                <span className="dot" />
                <div>
                  <h1>Launchpad</h1>
                  <p>Web UI • backend-driven</p>
                </div>
              </div>
              <nav className="nav">
                <Link href="/launch">Launch</Link>
                <Link href="/bulk-launch">Bulk Launch</Link>
                <Link href="/presets">Presets</Link>
                <Link href="/settings">Settings</Link>
              </nav>
            </aside>
            <main className="main">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

