import { test, expect } from "@playwright/test";
import { patient, approval, rejection, reply } from "../fixtures";
// Network mocks are exclusively in tests. Production always calls Gemini.
test("full day, rejected review, retry, restore, checkout, next day", async ({
  page,
}, info) => {
  let reviewCount = 0,
    conversationCount = 0;
  await page.route(
    "https://generativelanguage.googleapis.com/**",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET")
        return route.fulfill({
          json: {
            models: [
              {
                name: "models/gemini-3.5-flash-lite",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          },
        });
      const body = req.postDataJSON();
      let result: unknown;
      if (body.system_instruction.includes("TASK patient generation")) {
        const c = JSON.parse(body.input);
        result = {
          patients: Array.from({ length: c.newCount }, (_, i) => ({
            core: { ...patient.core, name: `مريض اختباري ${i + 1}` },
            state: patient.state,
            plan: {
              goals: ["الفهم"],
              requiredItems: ["خطة مشتركة"],
              opening: "أشعر بضغط العمل.",
            },
          })),
        };
      } else if (
        body.system_instruction.includes("TASK patient conversation")
      ) {
        conversationCount++;
        if (conversationCount === 1)
          return route.fulfill({
            status: 503,
            json: { error: { message: "TEST ONLY: temporary outage" } },
          });
        const c = JSON.parse(body.input);
        result = {
          ...reply,
          optionalNouraAlert: {
            id: "plan",
            reason: "توضيح الخطة",
            text: "يمكنك الاستفسار عن الخطوة التالية.",
          },
          patientReply:
            "أوافق على مناقشة الخطوة التالية. " +
            c.session.messages.at(-1).text.slice(0, 20),
        };
      } else if (body.system_instruction.includes("TASK session review")) {
        const c = JSON.parse(body.input);
        result =
          ++reviewCount === 1
            ? rejection
            : {
                ...approval,
                evidence: [
                  {
                    messageId: c.session.messages
                      .filter((m: { role: string }) => m.role === "doctor")
                      .at(-1).id,
                    finding: "خطة واضحة",
                  },
                ],
              };
      } else if (body.system_instruction.includes("TASK Noura assistance"))
        result = { reply: "اختبار: اتفق مع المريض على خطوة واضحة." };
      else if (body.system_instruction.includes("TASK follow-up evolution"))
        result = {
          state: patient.state,
          plan: {
            goals: ["متابعة"],
            requiredItems: ["خطة"],
            opening: "عدت لنتابع ما ناقشناه.",
          },
          evolutionSummary: "متابعة الخطة السابقة",
        };
      else result = { reply: "OK" };
      await route.fulfill({
        json: {
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify(result) }],
            },
          ],
        },
      });
    },
  );
  await page.goto("/");
  await page.getByRole("heading", { name: "محاكي الطبيب النفسي" }).waitFor();
  await page.screenshot({ path: `test-results/${info.project.name}-menu.png` });
  await page.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await page.locator("input[type=password]").fill("TEST-ONLY-NOT-A-REAL-KEY");
  await page
    .getByRole("button", { name: "اختبار الاتصال", exact: true })
    .click();
  await expect(
    page.getByText("نجح الاتصال وتحقق دعم الرد المنظم."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "إغلاق / Close", exact: true })
    .click();
  await page.getByRole("button", { name: "لعبة جديدة", exact: true }).click();
  const device = page.getByRole("button", { name: "جهاز البصمة", exact: true });
  await device.waitFor();
  await page.getByRole("button", { name: "الباب إلى الممر" }).click();
  await expect(
    page.getByText("يجب أن تسجل حضورك أولًا على جهاز البصمة."),
  ).toBeVisible();
  await device.click();
  await expect(page.locator(".device-screen")).toHaveText("تم التسجيل");
  await device.click();
  await expect(page.locator(".clock span")).toHaveText("10:00");
  await page.screenshot({
    path: `test-results/${info.project.name}-attendance.png`,
  });
  const image = await page.locator(".scene-image").boundingBox(),
    screen = await page.locator(".device-screen").boundingBox();
  expect(Math.abs(screen!.x - (image!.x + image!.width * 0.483))).toBeLessThan(
    2,
  );
  await page.getByRole("button", { name: "الباب إلى الممر" }).click();
  await page.getByRole("button", { name: "فتح باب العيادة النفسية" }).waitFor();
  await page.screenshot({
    path: `test-results/${info.project.name}-corridor.png`,
  });
  await page
    .getByRole("button", { name: "العيادة النفسية", exact: true })
    .click();
  await page.getByRole("button", { name: "التحدث إلى المريض" }).waitFor();
  await page.screenshot({
    path: `test-results/${info.project.name}-clinic.png`,
  });
  await page.getByRole("button", { name: "التحدث إلى المريض" }).click();
  const time = await page.locator(".clock span").textContent();
  const msg = "أود فهم ما تشعر به. ".repeat(35);
  await page.getByRole("textbox", { name: "رسالتك" }).fill(msg);
  await page.getByRole("button", { name: "إرسال", exact: true }).click();
  await page.getByRole("button", { name: "إعادة محاولة الرسالة" }).waitFor();
  await expect(page.locator(".clock span")).toHaveText(time!);
  await page.getByRole("button", { name: "إعادة محاولة الرسالة" }).click();
  await expect(
    page.getByRole("button", { name: "إعادة محاولة الرسالة" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "إنهاء الجلسة", exact: true }).click();
  await expect(page.locator(".review-feedback")).toContainText(
    "اتفق على الخطوة القادمة",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-chat.png` });
  await page.getByRole("button", { name: "سؤال نوره" }).click();
  await page.getByRole("textbox", { name: "رسالتك" }).fill("ما الذي أغفلته؟");
  await page.getByRole("button", { name: "إرسال", exact: true }).click();
  await expect(
    page.getByText("اختبار: اتفق مع المريض على خطوة واضحة."),
  ).toBeVisible();
  await page.getByRole("button", { name: "العودة إلى المريض" }).click();
  await page.getByRole("button", { name: "تصغير المحادثة" }).click();
  await page.reload();
  await page.getByRole("button", { name: /متابعة اللعب/ }).click();
  await page.getByRole("button", { name: "التحدث إلى المريض" }).click();
  await expect(page.locator(".bubble.doctor")).toContainText(msg.trim());
  await expect(page.locator(".review-feedback")).toContainText(
    "اتفق على الخطوة القادمة",
  );
  // Re-enter ephemeral key after reload, without persisting it.
  await page.getByRole("button", { name: "تصغير المحادثة" }).click();
  await page.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await page.locator("input[type=password]").fill("TEST-ONLY-NOT-A-REAL-KEY");
  await page
    .getByRole("button", { name: "إغلاق / Close", exact: true })
    .click();
  for (let i = 0; i < 5; i++) {
    const chair = page.getByRole("button", { name: "التحدث إلى المريض" });
    if (!(await chair.count())) break;
    await chair.click();
    await page
      .getByRole("textbox", { name: "رسالتك" })
      .fill("نتفق على خطوة مناسبة ومتابعة. أشكرك على الحديث.");
    await page.getByRole("button", { name: "إرسال", exact: true }).click();
    await expect(page.locator(".waiting")).toHaveCount(0);
    await page
      .getByRole("button", { name: "إنهاء الجلسة", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "التحدث إلى المريض" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "استكمال أعمال اليوم حتى موعد الخروج" })
    .click();
  await expect(page.locator(".clock span")).toHaveText("18:00");
  await page
    .getByRole("button", { name: "العودة إلى الممر", exact: true })
    .click();
  await page
    .getByRole("button", { name: "العودة إلى البصمة", exact: true })
    .click();
  await device.click();
  await expect(page.locator(".device-screen")).toHaveText("تم الخروج");
  await page.screenshot({
    path: `test-results/${info.project.name}-checkout.png`,
  });
  await page.getByRole("button", { name: "بدء اليوم التالي" }).click();
  await expect(page.locator(".clock span")).toHaveText("10:00");
  await expect(page.locator(".clock small")).toHaveText("اليوم 2");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("English interface, keyboard navigation, independent career and invalid import", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page
    .getByRole("button", { name: "Attendance device", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".device-screen")).toHaveText("Checked in");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":900}'),
    });
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("dialog").locator(".modal-head button").click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.getByRole("button", { name: "Create new career" }).click();
  await expect(page.locator(".device-screen")).toHaveText("Welcome");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Careers", exact: true }).click();
  await expect(page.locator(".career-row")).toHaveCount(2);
});
