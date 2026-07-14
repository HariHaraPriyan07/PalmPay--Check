import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { MlDevTools } from "@/components/MlDevTools";

export const metadata: Metadata = {
  title: "CIT Palm Attendance — CSE",
  description:
    "Palm-biometric daily attendance for Chennai Institute of Technology, CSE department.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body antialiased">
        <AuthProvider>
          {children}
          <MlDevTools />
        </AuthProvider>
      </body>
    </html>
  );
}
