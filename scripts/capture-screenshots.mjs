import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const outDir = path.resolve("public", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const loginEmail = process.env.DEMO_ADMIN_EMAIL ?? "admin@demo.local";
const loginPassword = process.env.DEMO_LOGIN_PASSWORD ?? "changeme";

async function ensureLoggedIn(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const emailInput = page.locator('input[name="email"]');
  if ((await emailInput.count()) === 0) return;
  await emailInput.fill(loginEmail);
  await page.locator('input[name="password"]').fill(loginPassword);
  await page.locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")').first().click();
  await page.waitForLoadState("networkidle");
}

async function clickTab(page, label) {
  const variants = {
    Operacion: [/Operaci/i, /Operacion/i],
    Riesgo: [/Riesgo/i],
    SLA: [/SLA/i, /Tiempo/i],
    Reservas: [/Reserva/i],
    Kanban: [/Kanban/i],
  };
  const patterns = variants[label] ?? [new RegExp(label, "i")];
  for (const pattern of patterns) {
    const tab = page.getByRole("tab", { name: pattern }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click({ force: true });
      await page.waitForTimeout(600);
      return;
    }
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true });
      await page.waitForTimeout(600);
      return;
    }
  }
  throw new Error(`No se encontró tab/botón para ${label}`);
}

async function captureDesktop() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await ensureLoggedIn(page);

  await clickTab(page, "Operacion");
  await page.screenshot({ path: path.join(outDir, "dashboard-operacion.png"), fullPage: true });

  await clickTab(page, "Riesgo");
  await page.screenshot({ path: path.join(outDir, "riesgo-checkin.png"), fullPage: true });

  await clickTab(page, "SLA");
  await page.screenshot({ path: path.join(outDir, "sla-board.png"), fullPage: true });

  await clickTab(page, "Reservas");
  await page.screenshot({ path: path.join(outDir, "reservas-calendario.png"), fullPage: true });

  await clickTab(page, "Ayuda");
  await page.screenshot({ path: path.join(outDir, "desktop-ayuda.png"), fullPage: true });

  await clickTab(page, "Departamentos");
  await page.screenshot({ path: path.join(outDir, "desktop-departamentos.png"), fullPage: true });

  await clickTab(page, "Operacion");
  await page.screenshot({ path: path.join(outDir, "desktop-secciones-categorias.png"), fullPage: true });

  await browser.close();
}

async function captureMobileKanban() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const page = await context.newPage();
  await ensureLoggedIn(page);
  await clickTab(page, "Kanban");
  await page.screenshot({ path: path.join(outDir, "kanban-mobile.png"), fullPage: true });

  await clickTab(page, "Operacion");
  await page.screenshot({ path: path.join(outDir, "mobile-operacion.png"), fullPage: true });

  await clickTab(page, "Riesgo");
  await page.screenshot({ path: path.join(outDir, "mobile-riesgo.png"), fullPage: true });

  await clickTab(page, "Reservas");
  await page.screenshot({ path: path.join(outDir, "mobile-reservas.png"), fullPage: true });

  await clickTab(page, "Ayuda");
  await page.screenshot({ path: path.join(outDir, "mobile-ayuda.png"), fullPage: true });
  await browser.close();
}

await captureDesktop();
await captureMobileKanban();
console.log("Screenshots generated in public/screenshots");
