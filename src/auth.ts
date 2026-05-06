import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { tryGetDefaultTenantId } from "@/db/queries";
import { appUsers } from "@/db/schema";

type OfflineUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor" | "limpieza" | "mantenimiento";
  tenantId: string;
};

const offlineUsers: OfflineUser[] = [
  { id: "offline-admin", name: "Mora Admin", email: "admin@demo.local", role: "admin", tenantId: "offline-tenant" },
  { id: "offline-super", name: "Leo Supervisor", email: "supervisor@demo.local", role: "supervisor", tenantId: "offline-tenant" },
  { id: "offline-clean", name: "Equipo Limpieza A", email: "limpieza@demo.local", role: "limpieza", tenantId: "offline-tenant" },
  { id: "offline-tech", name: "Rafa Mantenimiento", email: "mantenimiento@demo.local", role: "mantenimiento", tenantId: "offline-tenant" },
];

function logAuthWarning(code: string, error?: unknown) {
  const base = `[auth][credentials] ${code}`;
  if (error instanceof Error) {
    console.warn(base, { name: error.name, message: error.message });
    return;
  }
  console.warn(base);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
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
        if (process.env.DEMO_LOGIN_ENABLED !== "true") return null;

        const email = String(credentials.email);
        const password = String(credentials.password);
        const expectedPassword = process.env.DEMO_LOGIN_PASSWORD;
        if (!expectedPassword || password !== expectedPassword) return null;

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
            })
            .from(appUsers)
            .where(and(eq(appUsers.tenantId, tenantId), eq(appUsers.email, email), eq(appUsers.active, true)))
            .limit(1);

          if (!user) return null;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
          };
        } catch (error) {
          logAuthWarning("db_auth_unavailable", error);
          const offlineEnabled = process.env.DEMO_LOGIN_OFFLINE_ENABLED !== "false";
          if (!offlineEnabled) return null;

          const offlineUser = offlineUsers.find((user) => user.email === email);
          if (!offlineUser) return null;

          return offlineUser;
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
