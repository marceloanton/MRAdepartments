import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { tryGetDefaultTenantId } from "@/db/queries";
import { appUsers } from "@/db/schema";
import { verifyPassword } from "@/lib/password";

function logAuthWarning(code: string, error?: unknown) {
  const base = `[auth][credentials] ${code}`;
  if (error instanceof Error) {
    console.warn(base, { name: error.name, message: error.message });
    return;
  }
  console.warn(base);
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  const head = name.slice(0, 2);
  return `${head}***@${domain}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Prevent hard-fail on platforms where AUTH_SECRET was not configured yet.
  // Keep AUTH_SECRET/NEXTAUTH_SECRET as primary values.
  secret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "mranalytics-v1-fallback-secret-change-in-production",
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      name: "Demo interno",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const email = String(credentials.email).trim().toLowerCase();
        const password = String(credentials.password);

        try {
          const db = getDb();
          const tenantId = await tryGetDefaultTenantId();
          if (!tenantId) {
            logAuthWarning("default_tenant_missing");
            return null;
          }

          const [user] = await db
            .select({
              id: appUsers.id,
              tenantId: appUsers.tenantId,
              name: appUsers.name,
              email: appUsers.email,
              role: appUsers.role,
              passwordHash: appUsers.passwordHash,
            })
            .from(appUsers)
            .where(and(eq(appUsers.tenantId, tenantId), eq(appUsers.email, email), eq(appUsers.active, true)))
            .limit(1);

          if (!user) {
            logAuthWarning("user_not_found", new Error(maskEmail(email)));
            return null;
          }
          if (!user.passwordHash) {
            logAuthWarning("password_hash_missing");
            return null;
          }
          if (!verifyPassword(password, user.passwordHash)) {
            logAuthWarning("password_mismatch", new Error(maskEmail(email)));
            return null;
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
          };
        } catch (error) {
          logAuthWarning("db_auth_unavailable", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.tenantId = (user as { tenantId?: string }).tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string; tenantId?: string }).id = token.id as string;
        (session.user as { id?: string; role?: string; tenantId?: string }).role = token.role as string;
        (session.user as { id?: string; role?: string; tenantId?: string }).tenantId = token.tenantId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
});
