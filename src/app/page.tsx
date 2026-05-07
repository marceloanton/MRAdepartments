import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";
import { OperationsDashboard } from "@/components/operations-dashboard";
import { getAppData } from "@/db/queries";
import { LoginSubmitButton } from "@/components/login-submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email o clave incorrectos.",
  invalid_config: "Error de configuracion de acceso.",
  missing_fields: "Completa email y clave.",
  unknown: "No se pudo iniciar sesion. Reintenta.",
};

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const session = await auth();
  if (!session?.user) return <LoginScreen params={params} />;
  const role = (session.user as { role?: string }).role;
  const validRoles = new Set(["admin", "supervisor", "limpieza", "mantenimiento"]);
  if (!role || !validRoles.has(role)) {
    return <ForbiddenScreen />;
  }

  const initialData = await getAppData({
    actorRole: role,
    actorUserId: (session.user as { id?: string }).id ?? null,
  });
  const sessionUser = {
    id: (session.user as { id?: string }).id ?? "",
    name: session.user.name ?? "Operador",
    role,
  };

  return <OperationsDashboard initialData={initialData} sessionUser={sessionUser} />;
}

function ForbiddenScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f4] p-4">
      <Card className="w-full max-w-md border-[#d8ded6] shadow-none">
        <CardHeader>
          <CardTitle>Acceso denegado</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#55645d]">
            Tu usuario no tiene un rol operativo habilitado para esta aplicacion.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function decodeLoginError(params: Record<string, string | string[] | undefined>): string | null {
  const raw = params.error;
  const code = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  if (!code) return null;
  return LOGIN_ERROR_MESSAGES[code] ?? LOGIN_ERROR_MESSAGES.unknown;
}

function LoginScreen({ params }: { params: Record<string, string | string[] | undefined> }) {
  const loginError = decodeLoginError(params);

  async function loginAction(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    if (!email || !password) {
      redirect("/?error=missing_fields");
    }

    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: "/",
      });
    } catch (err) {
      if (isRedirectError(err)) throw err;
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      const errorCode = message.includes("configuration") ? "invalid_config" : "invalid_credentials";
      redirect(`/?error=${errorCode}`);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f4] p-4">
      <Card className="w-full max-w-md border-[#d8ded6] shadow-none">
        <CardHeader>
          <CardTitle>Ingreso operativo</CardTitle>
        </CardHeader>
        <CardContent>
          {loginError ? (
            <Alert className="mb-3 border-red-200 bg-red-50 text-red-900" role="alert" aria-live="polite">
              <AlertTitle>No se pudo ingresar</AlertTitle>
              <AlertDescription>{loginError}</AlertDescription>
            </Alert>
          ) : null}
          <form action={loginAction} className="grid gap-3">
            <label htmlFor="login-email" className="text-sm text-[#55645d]">Email</label>
            <Input id="login-email" name="email" type="email" placeholder="admin@tu-dominio.com" required />
            <label htmlFor="login-password" className="text-sm text-[#55645d]">Password</label>
            <Input id="login-password" name="password" type="password" placeholder="Password" required />
            <LoginSubmitButton />
          </form>
          <p className="mt-3 text-xs text-[#55645d]">
            Si no tenés acceso, pedí alta a un administrador.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
