import { test, expect } from "@playwright/test";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
test("actual captured Razorpay test order requires student check-in and commits one scoped handover", async ({
  browser,
}) => {
  test.skip(
    !existsSync(".local/test-payment-end-to-end.json"),
    "Run the explicitly authorized payment integration check first.",
  );
  const record = JSON.parse(
    readFileSync(".local/test-payment-end-to-end.json", "utf8"),
  );
  const accounts = JSON.parse(
    readFileSync(".local/demo-accounts.json", "utf8"),
  );
  const studentContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 0.01, longitude: 0.01, accuracy: 5 },
  });
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const student = await studentContext.newPage(),
    staff = await staffContext.newPage();
  try {
    for (const [page, email] of [
      [student, "second@demo.mint.invalid"],
      [staff, "main.station2@staff.demo.invalid"],
    ] as const) {
      await page.goto("/");
      await page.getByRole("button", { name: "Staff sign in" }).click();
      await page.getByLabel("Staff account email").fill(email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(accounts[email].password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Sign out" }),
      ).toBeVisible();
    }
    const before = await student.evaluate(
      async (id) => await (await fetch("/api/orders/" + id)).json(),
      record.orderId,
    );
    expect(before.order.state).toBe("confirmed");
    test.skip(
      before.units.every((u: { state: string }) => u.state === "collected"),
      "This provider test order was already collected; create a fresh test payment to rerun.",
    );
    await student.getByRole("link", { name: "Orders", exact: true }).click();
    await student
      .getByRole("button")
      .filter({ hasText: before.order.reference })
      .click();
    await student
      .getByRole("button", { name: "Check in through my app" })
      .click();
    await expect(
      student.getByText("Check-in accepted for your assigned portions."),
    ).toBeVisible();
    const passes = await student.evaluate(
      async (id) =>
        await (
          await fetch("/api/orders/" + id + "/passes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).json(),
      record.orderId,
    );
    await staff.getByRole("link", { name: "Serving", exact: true }).click();
    await staff
      .getByLabel("Collection pass", { exact: true })
      .fill(passes[0].token);
    await staff
      .getByRole("button", { name: "Resolve pass", exact: true })
      .click();
    await staff.locator("input[type=checkbox]").first().check();
    await staff
      .getByRole("button", { name: "Handed over: 1 portions" })
      .click();
    await expect(
      staff.getByText(
        "Handover committed. Do not hand over those portions again.",
      ),
    ).toBeVisible();
    const result = await student.evaluate(
      async (id) => await (await fetch("/api/orders/" + id)).json(),
      record.orderId,
    );
    expect(
      result.units.every((u: { state: string }) => u.state === "collected"),
    ).toBeTruthy();
    writeFileSync(
      ".local/paid-pickup-check.json",
      JSON.stringify({
        orderId: record.orderId,
        actualCapturedTestPayment: true,
        studentAppCheckIn: true,
        scopedPartialHandover: true,
        checkedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
  } finally {
    await studentContext.close();
    await staffContext.close();
  }
});
