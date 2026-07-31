import type { ReactNode } from "react";

export const metadata = {
  title: "@lazslov/content — next-site smoke test",
  description: "An App Router site reading through cache mode A.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
