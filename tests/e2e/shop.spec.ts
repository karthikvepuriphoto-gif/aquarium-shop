import { expect, test, type Page } from "@playwright/test";

async function layout(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const taps = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".btn, .nav-btn, .icon-btn, .chip, .seg button, .stepper button")];
    return nodes
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
          w: rect.width,
          h: rect.height,
          hidden: style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0,
        };
      })
      .filter((tap) => !tap.hidden);
  });
  for (const tap of taps) {
    expect(tap.h, tap.label).toBeGreaterThanOrEqual(44);
    expect(tap.w, tap.label).toBeGreaterThanOrEqual(44);
  }
}

test("demo shop: setup, stock, mixed GST bill, cancel, reports", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const shots = process.env.SHOTS === "1" && info.project.name === "phone";
  async function shot(name: string) {
    if (!shots) return;
    await page.screenshot({ path: `test-results/shots/${name}.png` });
  }
  async function settle(text: string) {
    const toast = page.getByText(text);
    if (await toast.count()) await toast.first().waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
  }

  await page.goto("/aquarium-shop/?demo=1#/setup");
  await expect(page.getByRole("heading", { name: "Set up your shop" })).toBeVisible();
  await shot("setup");
  await layout(page);

  await page.getByLabel("Shop name").fill("Rohit Aquarium");
  await page.getByLabel("Shop phone").fill("9848012345");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("GST registration").selectOption("REGULAR");
  await page.getByLabel("GSTIN").fill("36AAPFU0939F1ZW");
  await page.getByRole("checkbox", { name: /Add 8 sample items/ }).check();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Demo on this device")).toBeVisible();
  await settle("Shop is ready.");
  await shot("home");
  await layout(page);

  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
  await shot("items");
  await layout(page);

  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item name").fill("Nano sponge");
  await page.getByLabel("Selling price").fill("118");
  await page.getByLabel("Cost price").fill("40");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByText("Nano sponge")).toBeVisible();

  await page.getByRole("button", { name: "Stock in", exact: true }).click();
  const item = page.getByLabel("Item");
  const guppyLabel = (await item.locator("option").allTextContents()).find((text) => text.includes("Guppy"));
  await item.selectOption({ label: guppyLabel || "Guppy (pair)" });
  await page.getByLabel("Quantity").fill("6");
  await page.getByLabel("Cost per piece").fill("12");
  await page.getByRole("textbox", { name: "Supplier", exact: true }).fill("Howrah wholesaler");
  await page.getByRole("button", { name: "Save stock in" }).click();
  await expect(page.getByText("Stock added.")).toBeVisible();

  const nanoLabel = (await item.locator("option").allTextContents()).find((text) => text.includes("Nano sponge"));
  await item.selectOption({ label: nanoLabel || "Nano sponge" });
  await page.getByLabel("Quantity").fill("4");
  await page.getByLabel("Cost per piece").fill("40");
  await page.getByRole("button", { name: "Save stock in" }).click();

  await page.getByRole("button", { name: "New sale" }).first().click();
  await expect(page.getByRole("heading", { name: "New sale" })).toBeVisible();
  await settle("Stock added.");
  await page.getByRole("button", { name: "Add Guppy (pair)" }).click();
  await page.getByRole("button", { name: "Add Nano sponge" }).click();
  await shot("new-sale");
  await layout(page);
  await page.getByRole("button", { name: "Review bill" }).click();
  await expect(page.getByText("Invoice-cum-Bill of Supply")).toBeVisible();
  await page.getByRole("button", { name: /Save bill/ }).click();

  await expect(page.getByText("RA/")).toBeVisible();
  await expect(page.getByText("CGST")).toBeVisible();
  await expect(page.getByText("Invoice-cum-Bill of Supply")).toBeVisible();
  await shot("invoice");
  await layout(page);

  await page.getByRole("button", { name: "Cancel bill" }).click();
  await page.getByLabel("Reason for cancelling").fill("Test cancel");
  await page.getByRole("button", { name: "Cancel this bill" }).click();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("+ 1 cancelled")).toBeVisible();
  await settle("Bill cancelled.");
  await shot("reports");
  await layout(page);

  const noisy = errors.filter((line) => !/favicon|Download the React DevTools|vite/i.test(line));
  expect(noisy).toEqual([]);
});
