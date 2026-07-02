import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import { auth } from "@/auth";
import UploadForm from "@/components/admin/UploadForm";

export const metadata: Metadata = {
  title: "Upload — Energy Trade Inspection",
};

export default async function AdminUploadPage() {
  const session = await auth();

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const isAdmin = !!(
    session?.user?.email && adminEmails.includes(session.user.email)
  );

  if (!isAdmin) {
    return (
      <>
        <Header />
        <div
          style={{
            maxWidth: "var(--max-width)",
            margin: "0 auto",
            padding: "var(--space-12) var(--space-4)",
          }}
        >
          <div
            role="alert"
            style={{
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              padding: "var(--space-12)",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                fontSize: "20px",
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: "var(--space-3)",
              }}
            >
              Access denied
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              You do not have permission to access this page. Contact the
              platform administrator.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <UploadForm />
    </>
  );
}
