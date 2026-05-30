const port = process.env.PORT ?? "3000";
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const username = process.env.DEV_ADMIN_USERNAME ?? "admin";
const password = process.env.INITIAL_ADMIN_PASSWORD ?? "admin1234";
const runId = `wf-${Date.now()}`;

const results = [];
let cookie = "";
let tempItemId = null;
let tempWarehouseId = null;
let transferredStoreItemId = null;
let tempOrderId = null;
let tempRouteSheetId = null;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function request(method, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  if (options.json !== undefined) headers.set("content-type", "application/json");

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
  });
}

async function expect(name, method, path, options = {}) {
  const expected = options.expected ?? [200];
  try {
    const res = await request(method, path, options);
    const ok = expected.includes(res.status);
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");
    record(name, ok, `${method} ${path} -> ${res.status}`);
    if (!ok) {
      console.log(typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body));
    }
    return { res, body, ok };
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
    return { res: null, body: null, ok: false };
  }
}

async function cleanup() {
  if (tempRouteSheetId) {
    // No delete endpoint exists for route sheets; leave this as a documented workflow gap.
  }
  if (tempOrderId) {
    await request("DELETE", `/api/orders/${tempOrderId}`).catch(() => {});
  }
  if (transferredStoreItemId) {
    await request("DELETE", `/api/items/${transferredStoreItemId}`).catch(() => {});
  }
  if (tempItemId) {
    await request("DELETE", `/api/items/${tempItemId}`).catch(() => {});
  }
  if (tempWarehouseId) {
    await request("DELETE", `/api/warehouse/${tempWarehouseId}`).catch(() => {});
  }
}

try {
  await expect("frontend serves app", "GET", "/", { expected: [200] });
  await expect("API health", "GET", "/api/healthz", { expected: [200] });

  const login = await expect("login", "POST", "/api/auth/login", {
    json: { username, password },
    expected: [200],
  });
  cookie = login.res?.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) record("login cookie", false, "missing set-cookie");
  else record("login cookie", true, "auth cookie received");

  await expect("current user", "GET", "/api/auth/me", { expected: [200] });

  const pages = [
    "/",
    "/inventory",
    "/restock",
    "/history",
    "/voice-check",
    "/orders",
    "/route-sheets",
    "/import",
    "/scan",
    "/warehouse",
    "/warehouse/voice",
    "/warehouse/purchases",
    "/admin/users",
    "/settings",
  ];
  for (const page of pages) {
    await expect(`page ${page}`, "GET", page, { expected: [200] });
  }

  const reads = [
    ["/api/ai/status", "AI status"],
    ["/api/locations", "locations list"],
    ["/api/dashboard/summary", "dashboard summary"],
    ["/api/dashboard/voice", "voice dashboard"],
    ["/api/items", "items list"],
    ["/api/history", "history list"],
    ["/api/restock", "restock list"],
    ["/api/scan/log", "scan log"],
    ["/api/orders", "orders list"],
    ["/api/route-sheets", "route sheets list"],
    ["/api/warehouse/dashboard", "warehouse dashboard"],
    ["/api/warehouse", "warehouse list"],
    ["/api/warehouse/purchases", "warehouse purchases"],
    ["/api/users", "users list"],
    ["/api/permissions", "permissions matrix"],
  ];
  for (const [path, name] of reads) {
    await expect(name, "GET", path, { expected: [200, 304] });
  }

  const items = await expect("load items for workflow seed", "GET", "/api/items", { expected: [200] });
  const seedItem = Array.isArray(items.body) ? items.body[0] : null;
  const location = seedItem?.location ?? "Route 3";

  const createItem = await expect("create store item", "POST", "/api/items", {
    expected: [201],
    json: {
      name: `Workflow Test Store Item ${runId}`,
      category: "Workflow Test",
      quantity: 4,
      parLevel: 10,
      location,
      barcode: `WFSTORE${runId}`,
    },
  });
  tempItemId = createItem.body?.id ?? null;
  if (tempItemId) {
    await expect("get created store item", "GET", `/api/items/${tempItemId}`, { expected: [200] });
    await expect("patch store item", "PATCH", `/api/items/${tempItemId}`, {
      expected: [200],
      json: { quantity: 5, parLevel: 11 },
    });
    await expect("adjust store item", "POST", `/api/items/${tempItemId}/adjust`, {
      expected: [200],
      json: { quantity: 3, adjustmentType: "workflow_test", verified: true },
    });
    await expect("verify store item", "POST", `/api/items/${tempItemId}/verify`, { expected: [204] });
    await expect("barcode lookup", "GET", `/api/items/barcode/WFSTORE${runId}`, { expected: [200] });
  }

  const createWarehouse = await expect("create warehouse item", "POST", "/api/warehouse", {
    expected: [201],
    json: {
      name: `Workflow Test Warehouse Item ${runId}`,
      barcode: `WFWH${runId}`,
      category: "Workflow Test",
      quantity: 20,
      minPar: 5,
      maxPar: 30,
      reorderPoint: 8,
      caseCost: 24,
      unitsPerCase: 12,
    },
  });
  tempWarehouseId = createWarehouse.body?.id ?? null;
  if (tempWarehouseId) {
    await expect("get warehouse item detail", "GET", `/api/warehouse/${tempWarehouseId}`, { expected: [200] });
    await expect("update warehouse item", "PUT", `/api/warehouse/${tempWarehouseId}`, {
      expected: [200],
      json: { quantity: 21, reorderPoint: 9 },
    });
    await expect("receive warehouse purchase", "POST", `/api/warehouse/${tempWarehouseId}/receive`, {
      expected: [200],
      json: {
        vendor: "Workflow Vendor",
        caseCost: 24,
        casesReceived: 1,
        unitsPerCase: 12,
        purchaseDate: "2026-05-29",
        notes: "workflow test",
      },
    });
    const transfer = await expect("transfer warehouse to store", "POST", `/api/warehouse/${tempWarehouseId}/transfer`, {
      expected: [200],
      json: {
        storeLocation: location,
        unitsTransferred: 1,
        createStoreItem: true,
        parLevel: 5,
        notes: "workflow test",
      },
    });
    transferredStoreItemId = transfer.body?.transfer?.storeItemId ?? null;
  }

  const order = await expect("create pick/order list", "POST", "/api/orders", {
    expected: [201],
    json: { location, notes: "workflow test" },
  });
  tempOrderId = order.body?.id ?? null;
  if (tempOrderId) {
    await expect("get order detail", "GET", `/api/orders/${tempOrderId}`, { expected: [200] });
    await expect("update order status", "PATCH", `/api/orders/${tempOrderId}`, {
      expected: [200],
      json: { status: "sent", notes: "workflow test updated" },
    });
  }

  const routeSheet = await expect("create route sheet", "POST", "/api/route-sheets", {
    expected: [201],
    json: {
      employee: "Workflow Tester",
      routeDate: "2026-05-29",
      van: "Test Van",
      day: "Friday",
      routeName: `Workflow Route ${runId}`,
      status: "draft",
      notes: "workflow test",
      stops: [
        {
          routeOrder: 1,
          locationName: location,
          machineClean: "ok",
          machineWorking: "ok",
          paymentSystem: "ok",
          items: [
            {
              productName: "Workflow Test Product",
              parLevel: 5,
              restockQty: 1,
              notes: "workflow test",
            },
          ],
        },
      ],
    },
  });
  tempRouteSheetId = routeSheet.body?.id ?? null;
  if (tempRouteSheetId) {
    await expect("get route sheet detail", "GET", `/api/route-sheets/${tempRouteSheetId}`, { expected: [200] });
  }

  const csv = "Name,Category,Quantity,Par Level,Location,Barcode\nWorkflow CSV Item,Workflow Test,1,2," +
    `${location},WFCSV${runId}\n`;
  const form = new FormData();
  form.set("file", new Blob([csv], { type: "text/csv" }), "workflow.csv");
  form.set("location", location);
  await expect("store CSV import preview", "POST", "/api/import/preview", {
    expected: [200],
    body: form,
  });

  await expect("warehouse export csv", "GET", "/api/warehouse/export/csv", { expected: [200] });
  await expect("warehouse reorder csv", "GET", "/api/warehouse/reorder/csv", { expected: [200] });

  await expect("AI command graceful response", "POST", "/api/command", {
    expected: [200],
    json: { text: "set workflow test item to five" },
  });
  await expect("voice parse missing AI handled", "POST", "/api/voice/parse", {
    expected: [200, 502],
    json: { transcript: "Workflow test item count five", items: [], mode: "custom" },
  });
} finally {
  await cleanup();
}

const failed = results.filter((result) => !result.ok);
console.log("");
console.log(`Workflow tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("Failures:");
  for (const failure of failed) {
    console.log(`- ${failure.name}: ${failure.detail}`);
  }
  process.exit(1);
}
