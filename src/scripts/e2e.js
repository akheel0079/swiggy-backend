// Smoke test against a running server: BASE=http://localhost:5000 npm run test:e2e
const BASE = process.env.BASE || "http://localhost:5000";
const call = async (m, p, body, token) => {
  const r = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { s: r.status, ...(await r.json()) };
};
const login = async (email, password = "123456") => (await call("POST", "/api/auth/login", { email, password })).token;
(async () => {
  const ok = (n, c) => console.log(c ? "PASS" : "FAIL", n);
  const admin = await login(process.env.ADMIN_EMAIL || "admin@swiggy.com", process.env.ADMIN_PASSWORD || "Admin@12345");
  const user = await login("rahul@test.com");
  ok("login", admin && user);
  const s = await call("GET", "/api/restaurants/search?q=pizzza&rating=4");
  ok("fuzzy search (needs real MongoDB: $facet)", s.data?.[0]?.name === "Pizza Palace");
  const rid = (await call("GET", "/api/restaurants?limit=50")).data.find((r) => r.name === "Pizza Palace")._id;
  const menu = await call("GET", `/api/menu/${rid}`);
  await call("DELETE", "/api/cart", null, user);
  await call("POST", "/api/cart", { menuItemId: menu.data[0]._id, quantity: 2 }, user);
  const fee = await call("POST", "/api/orders/calculate-delivery-fee", { latitude: 12.97, longitude: 77.6 }, user);
  ok("delivery fee", fee.data?.deliveryFee > 0);
  const o = await call("POST", "/api/orders/create", { deliveryAddress: "MG Road", latitude: 12.97, longitude: 77.6 }, user);
  ok("create order", o.s === 201);
  ok("partner assigned", !!o.data?.deliveryPartner);
  const id = o.data._id;
  const upd = await call("PUT", `/api/orders/update-status/${id}`, { status: "Restaurant Accepted" }, admin);
  ok("status update", upd.success);
  const uid = JSON.parse(Buffer.from(user.split(".")[1], "base64url")).id;
  ok("recommendations", (await call("GET", `/api/restaurants/recommendations/${uid}`, null, user)).data?.length > 0);
  let flagged = 0;
  for (let i = 0; i < 6; i++) {
    await call("POST", "/api/cart", { menuItemId: menu.data[0]._id, quantity: 1 }, user);
    const r = await call("POST", "/api/orders/create", { deliveryAddress: "MG Road", couponCode: "MEGA60" }, user);
    if (r.risk?.flagged) flagged++;
  }
  ok("fraud flagging", flagged > 0);
  const f = await call("GET", "/api/admin/fraud/orders", null, admin);
  ok("admin fraud list", f.data?.length > 0);
  ok("surge settings", (await call("GET", "/api/admin/surge-settings", null, admin)).success);
})();
