import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});

const page = await browser.newPage();
page.on("console", (msg) => console.log(`browser:${msg.type()}:${msg.text()}`));

await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle0" });

const fileInput = await page.$('input[type="file"]');
await fileInput.uploadFile(
  "C:\\Users\\araya\\Desktop\\作業フォルダ\\Codex\\purrboard-mvp\\test-assets\\red.svg",
  "C:\\Users\\araya\\Desktop\\作業フォルダ\\Codex\\purrboard-mvp\\test-assets\\blue.svg"
);

await page.waitForFunction(() => document.querySelectorAll("[data-image-id]").length === 2);

const getImageRect = async (index = 0) =>
  page.$$eval("[data-image-id]", (nodes, targetIndex) => {
    const el = nodes[targetIndex];
    const style = window.getComputedStyle(el);
    return {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
  }, index);

const boardRect = await page.$eval(".bg-board", (el) => {
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y };
});

const clickImage = async (index = 0, modifiers = []) => {
  const rect = await page.$$eval("[data-image-id]", (nodes, payload) => {
    const { targetIndex, modifierKeys } = payload;
    const node = nodes[targetIndex];
    const box = node?.getBoundingClientRect();
    if (!box) return null;
    const clientX = box.x + box.width / 2;
    const clientY = box.y + box.height / 2;
    const init = {
      bubbles: true,
      clientX,
      clientY,
      shiftKey: modifierKeys.includes("Shift"),
      ctrlKey: modifierKeys.includes("Control"),
      metaKey: modifierKeys.includes("Meta"),
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
    };
    node.dispatchEvent(new PointerEvent("pointerdown", init));
    node.dispatchEvent(new PointerEvent("pointerup", init));
    return { x: clientX, y: clientY };
  }, { targetIndex: index, modifierKeys: modifiers });

  if (!rect) {
    throw new Error(`missing image at index ${index}`);
  }
};

const dragHandle = async (handle, deltaX, deltaY) => {
  await page.$$eval("[data-image-id]", async (nodes, payload) => {
    const { handleKey, moveX, moveY } = payload;
    const handleNode = nodes[0]?.querySelector(`[data-resize-handle="${handleKey}"]`);
    const rect = handleNode?.getBoundingClientRect();
    if (!rect || !handleNode) {
      throw new Error(`missing resize handle ${handleKey}`);
    }

    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    const init = {
      bubbles: true,
      clientX: startX,
      clientY: startY,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
    };

    handleNode.dispatchEvent(new PointerEvent("pointerdown", init));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        ...init,
        clientX: startX + moveX,
        clientY: startY + moveY,
      })
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        ...init,
        clientX: startX + moveX,
        clientY: startY + moveY,
      })
    );

    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }, { handleKey: handle, moveX: deltaX, moveY: deltaY });
};

await clickImage(0);
await page.waitForFunction(
  () => Boolean(document.querySelector("[data-image-id] [data-resize-handle='se']"))
);

const beforeResize = await getImageRect(0);

await dragHandle("se", 40, 26);
const afterSouthEast = await getImageRect(0);

await dragHandle("nw", -30, -20);
const afterNorthWest = await getImageRect(0);

await dragHandle("ne", 24, -18);
const afterNorthEast = await getImageRect(0);

await dragHandle("sw", -24, 18);
const afterSouthWest = await getImageRect(0);

await clickImage(0);
await clickImage(1, ["Shift"]);

await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("グループ化"));
  button?.click();
});

await page.waitForFunction(() => Boolean(document.querySelector("[data-group-id]")));

const groupBeforeMove = await page.$$eval("div", (nodes) => {
  const parent = nodes.find((node) => node.dataset.groupId);
  if (!parent) return null;
  const style = window.getComputedStyle(parent);
  return {
    left: Number.parseFloat(style.left),
    top: Number.parseFloat(style.top),
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
});

await page.$$eval("[data-group-id]", async (nodes) => {
  const group = nodes[0];
  if (!group) {
    throw new Error("missing group");
  }

  const rect = group.getBoundingClientRect();
  const startX = rect.x + rect.width / 2;
  const startY = rect.y + rect.height / 2;
  const init = {
    bubbles: true,
    clientX: startX,
    clientY: startY,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
  };

  group.dispatchEvent(new PointerEvent("pointerdown", init));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      ...init,
      clientX: startX + 60,
      clientY: startY + 30,
    })
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      ...init,
      clientX: startX + 60,
      clientY: startY + 30,
    })
  );

  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
});

const groupAfterMove = await page.$$eval("[data-group-id]", (nodes) => {
  const parent = nodes[0];
  if (!parent) return null;
  const style = window.getComputedStyle(parent);
  return {
    left: Number.parseFloat(style.left),
    top: Number.parseFloat(style.top),
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
});

const imagesAfterGroupMove = await page.$$eval("[data-image-id]", (nodes) =>
  nodes.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
    };
  })
);

console.log(
  JSON.stringify(
    {
      boardRect,
      resize: {
        beforeResize,
        afterSouthEast,
        afterNorthWest,
        afterNorthEast,
        afterSouthWest,
      },
      grouping: {
        groupBeforeMove,
        groupAfterMove,
        imagesAfterGroupMove,
      },
    },
    null,
    2
  )
);

await browser.close();
