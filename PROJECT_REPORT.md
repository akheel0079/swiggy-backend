# Swiggy Backend Clone — Project Report

**Live URL:** `<paste your Render/Railway URL here>`
**GitHub:** `<paste your repo URL here>`

## Admin credentials (for reviewers)
| Field | Value |
|---|---|
| Email | `admin@swiggy.com` |
| Password | `Admin@12345` |

(Created automatically at startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars, or via `npm run seed`.)
Login: `POST /api/auth/login` → use returned `token` as `Authorization: Bearer <token>`.
Other seeded accounts (password `123456`): rahul@test.com (user), amit@pizza.com (restaurant), partner1@test.com (delivery).

## Features & endpoints
1. **Fraud detection** — `POST /api/orders/create`, `POST /api/orders/cancel/:orderId`, `POST /api/orders/refund/:orderId`. Rules: rapid orders, repeated cancellations, coupon abuse, excessive refunds, new-account/high-value. Risk score ≥ threshold (50) → order held as "Under Review". Admin: `GET /api/admin/fraud/orders`, `PUT /api/admin/fraud/orders/:orderId` `{action: approve|reject|restrict}`, `GET/PUT /api/admin/fraud/settings`.
2. **Advanced search** — `GET /api/restaurants/search?q=&cuisine=&rating=&minPrice=&maxPrice=&maxDeliveryTime=&veg=&sortBy=`. Trigram-based fuzzy matching in an aggregation pipeline + indexes. Admin: `POST /api/admin/restaurants/create`, `PUT /api/admin/restaurants/update/:restaurantId`.
3. **Surge pricing** — `POST /api/orders/calculate-delivery-fee`; fee stored on order at create. Admin: `GET/PUT /api/admin/surge-settings`.
4. **Smart delivery assignment** — `$geoNear` nearest available partner + workload, auto-reassign on decline. `POST /api/delivery/set-status`, `POST /api/delivery/orders/:id/accept|decline`, `GET /api/orders/:orderId`.
5. **Real-time status** — `PUT /api/orders/update-status/:orderId`, Socket.IO (auth `{token}`; events `order:status`, `notification`, `fraud:flagged`; emit `order:subscribe`), `GET /api/notifications`.
6. **Recommendations** — profile updated on every order; `GET /api/restaurants/recommendations/:userId` (aggregation-based scoring).

## Deploy
1. Create a free MongoDB Atlas cluster, copy the connection string.
2. Push this folder to GitHub.
3. On Render: New Web Service → repo → build `npm install`, start `npm start`. Env vars: `MONGO_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
4. Run `npm run seed` once (Render shell, or locally with Atlas `MONGO_URL`).
5. Check `/health`, then `npm run test:e2e` with `BASE=<your url>`.

## Fixes to the original code
Self-assigned admin role on register, owners self-approving restaurants, `isBlocked`/`isblocked` mismatch, variable shadowing crashes in restaurant controller, order routes locking out restaurants, missing cart-item delete route, `start` script using nodemon.
