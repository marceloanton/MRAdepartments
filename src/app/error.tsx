"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f4] p-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6">
        <p className="text-sm text-red-700">Error de carga. Reintentar.</p>
        <Button className="mt-4" onClick={reset}>
          Reintentar
        </Button>
      </div>
    </main>
  );
}

