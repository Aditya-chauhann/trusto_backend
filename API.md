# TronPay — API Reference

This document lists **every backend API**, with the **request payload** and **expected response body** for each endpoint. Shapes below are extracted directly from the NestJS controllers and services (`src/modules/**`), so they reflect what the backend actually accepts and returns.

## Conventions

- **Base URL:** all paths are relative to the backend root. The frontend configures it in `src/lib/api-base.ts` via `VITE_API_BASE_URL`, default `https://tronpay-backend-cdvb.onrender.com`. The backend uses **no global route prefix** (there is no `setGlobalPrefix`).
- **Auth:** endpoints marked 🔒 require header `Authorization: Bearer <token>`. The token is the `accessToken` returned by login/register. Endpoints marked 🌐 are public.
- **Content-Type:** every request with a JSON body sends `Content-Type: application/json`.
- **Status codes:** NestJS returns **201 Created** for `@Post` handlers by default (unless a route sets `@HttpCode`), **200 OK** for `@Get`/`@Patch`/`@Put`, and **204 No Content** for the `@Delete` routes that declare it. These are noted per endpoint.
- **Error shape:** on any non-2xx the body is `{ "statusCode": <n>, "message": <string | string[]>, "errorCode"?: <string>, "attemptsRemaining"?: <number> }`. `message` may be a string or an array of validation strings. `errorCode` is a machine-readable code for handled cases (e.g. `WITHDRAWAL_PIN_INVALID`).
- **List envelopes:** most admin list endpoints return `{ items: [...], total, page, limit }`. **Exceptions that return a bare JSON array:** `/agents` returns `{ items }`; `/admin/deposits`, `/user/deposits`, `/user/transactions`, `/user/tickets`, `/user/withdrawal-disputes`, `/admin/roles`, `/admin/user-tags`, and tag-history all return **bare arrays**.
- **`id` vs `_id`:** the backend serializes entity ids as `id` (string). The frontend tolerates either.
- **`feePercent`** everywhere is a **decimal fraction** in `[0, 1)` (e.g. `0.015` = 1.5%).

> **⚠️ Corrections vs. the old frontend-derived draft** (see the flags section at the bottom for detail):
> - `POST /webhook/simulate/{walletAddress}` **does not exist** in this backend — deposits are ingested over a socket.io feed, not an HTTP webhook.
> - `PATCH /user/bank-accounts/{id}` and `PATCH /user/upi-accounts/{id}` (bare edit) **do not exist** — only the `/default` (and UPI `/active`) sub-routes.
> - `POST /admin/auth/login` expects `{ email, password }`, **not** `{ username, password }`.
> - User moderation is **separate routes** (`/block`, `/unblock`, `/freeze`, …), not a single `{action}` param.

---

# 1. Authentication

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 1.1 | POST | `/auth/login` | 🌐 | Customer login (email or phone) |
| 1.2 | POST | `/auth/register` | 🌐 | Register new customer |
| 1.3 | GET | `/agents` | 🌐 | List agents (registration dropdown) |
| 1.4 | POST | `/admin/auth/login` | 🌐 | Staff / admin login |
| 1.5 | POST | `/admin/auth/change-password` | 🔒 | Forced/first-time admin password change |
| 1.6 | POST | `/auth/2fa/send` | 🔒 | Send 2FA OTP |
| 1.7 | POST | `/auth/2fa/verify` | 🔒 | Verify 2FA OTP |
| 1.8 | GET | `/auth/me` | 🔒 | Current authenticated principal |
| 1.9 | POST | `/auth/login/totp` | 🌐 | Complete login with Google Authenticator code |
| 1.10 | GET | `/auth/totp/status` | 🔒 | TOTP enabled state |
| 1.11 | POST | `/auth/totp/setup` | 🔒 | Start Google Authenticator setup (QR) |
| 1.12 | POST | `/auth/totp/enable` | 🔒 | Confirm and enable TOTP |
| 1.13 | POST | `/auth/totp/disable` | 🔒 | Disable TOTP |

### 1.1 · POST `/auth/login` 🌐 → **201**
Customer-only login. If `identifier` starts with `+` it is treated as a phone; otherwise it is lowercased and matched as a user email. **Staff accounts must use `POST /admin/auth/login`** (frontend: `/auth/admin/login`).

**Request**
```json
{ "identifier": "ravi@example.com", "password": "Secret123" }
```

**Response (user)**
```json
{
  "accountType": "user",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "665f0011223344556677aabb",
    "name": "Ravi Kumar",
    "email": "ravi@example.com",
    "walletAddress": "TJmJ8s...9xQ",
    "referralCode": "RAVI7K2P",
    "role": "user",
    "assignedAgent": null
  }
}
```

**Response (TOTP required — user with Google Authenticator enabled)**
```json
{
  "accountType": "user",
  "requiresTotp": true,
  "loginChallenge": "eyJhbGci...",
  "user": {
    "id": "665f0011223344556677aabb",
    "email": "ravi@example.com",
    "name": "Ravi Kumar"
  }
}
```
Complete sign-in with `POST /auth/login/totp`.

**Errors:** `401` `"Invalid credentials"`; `403` `{ errorCode: "ACCOUNT_BLOCKED", message, reason }` (blocked user); `403` `{ errorCode: "STAFF_USE_ADMIN_LOGIN", message }` when a staff email is used on this endpoint.

### 1.2 · POST `/auth/register` 🌐 → **201**
`phone` must be Indian E.164 (`+91[6-9]XXXXXXXXX`); `password` ≥ 8; `assignedAgentId` optional.

**Request**
```json
{
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "password": "Secret123",
  "confirmPassword": "Secret123",
  "assignedAgentId": "665f1a2b3c4d5e6f70819203"
}
```

**Response**
```json
{
  "accessToken": "eyJhbGci...",
  "user": {
    "id": "665f0011223344556677aabb",
    "name": "Ravi Kumar",
    "email": "ravi@example.com",
    "walletAddress": "TJmJ8s...9xQ",
    "referralCode": "RAVI7K2P",
    "role": "user",
    "assignedAgent": { "id": "665f1a2b3c4d5e6f70819203", "fullName": "Agent Neha", "email": "neha.agent@tronpay.com" }
  }
}
```
`assignedAgent` is `null` when none was selected. Register does **not** return `accountType`.

**Errors:** `400` `"password and confirmPassword do not match"`; `409` `"Email already registered"` / `"Phone number already registered"`; `400` `"Selected agent is not available"`.

### 1.3 · GET `/agents` 🌐 → **200**
Active, non-superadmin staff, sorted by `fullName`.

**Request:** none.

**Response**
```json
{
  "items": [
    { "id": "665f1a2b3c4d5e6f70819203", "fullName": "Agent Neha", "agentCode": "AG-0007", "role": "Support Agent" },
    { "id": "665f1a2b3c4d5e6f70819204", "fullName": "Agent Rohit", "agentCode": null, "role": null }
  ]
}
```

### 1.4 · POST `/admin/auth/login` 🌐 → **201**
Staff / admin login by **email or username** (frontend route: `/auth/admin/login`; legacy `/auth/staff-login` redirects there). Updates `lastLoginAt` for staff. When `mustChangePassword` is `true`, the frontend shows a blocking password-change modal before other admin actions. Legacy **customer super-admin** accounts (`User` with `role: superadmin`) may also sign in here with their email.

**Request**
```json
{ "email": "neha.agent@tronpay.com", "password": "Secret123" }
```
`email` accepts a staff email, staff username, or super-admin customer email.

**Response**
```json
{
  "accessToken": "eyJhbGci...",
  "staff": {
    "id": "665f1a2b3c4d5e6f70819203",
    "username": "neha.agent",
    "email": "neha.agent@tronpay.com",
    "fullName": "Agent Neha",
    "isSuperAdmin": false,
    "mustChangePassword": false,
    "role": { "id": "665faa11bb22cc33dd44ee55", "name": "Support Agent", "permissions": ["users", "tickets"] },
    "permissions": ["users", "tickets"]
  }
}
```
For a super admin: `role` is `null` and `permissions` is `["*"]`.

**Response (TOTP required)**
```json
{
  "requiresTotp": true,
  "loginChallenge": "eyJhbGci...",
  "staff": {
    "id": "665f1a2b3c4d5e6f70819203",
    "email": "neha.agent@tronpay.com",
    "username": "neha.agent",
    "fullName": "Agent Neha"
  }
}
```
Complete sign-in with `POST /auth/login/totp`.

**Errors:** `401` `"Invalid credentials"`; `403` `{ errorCode: "STAFF_INACTIVE" }`.

### 1.5 · POST `/admin/auth/change-password` 🔒 → **201**
Staff-only. `newPassword` ≥ 8, must differ from current.

**Request**
```json
{ "currentPassword": "Secret123", "newPassword": "NewSecret456" }
```

**Response**
```json
{ "ok": true }
```
Sets `mustChangePassword=false`.

**Errors:** `403` `"Only staff accounts can use this endpoint"`; `401` `"Current password is incorrect"`; `400` `"New password must be different from the current password"`.

### 1.6 · POST `/auth/2fa/send` 🔒 → **201**
Sends a 6-digit OTP (10-min TTL). All fields optional; `phone` required only when the channel resolves to phone and none is on file.

**Request**
```json
{ "channel": "phone", "phone": "+14155551234" }
```
Email variant: `{ "channel": "email" }` or `{}`.

**Response**
```json
{
  "otpId": "665fbb00cc11dd22ee33ff44",
  "channel": "phone",
  "contact": "+14155551234",
  "expiresAt": "2026-07-10T12:34:56.000Z"
}
```

**Errors:** `409` `"Phone number already in use"`; `400` invalid/missing phone; `429` `"Too many OTP requests..."` (max 3 / channel / 10 min).

### 1.7 · POST `/auth/2fa/verify` 🔒 → **201**
`code` is 4–8 digits (max 5 attempts per code).

**Request**
```json
{ "otpId": "665fbb00cc11dd22ee33ff44", "code": "483920" }
```

**Response**
```json
{
  "twoFactorVerified": true,
  "twoFactorMethod": "phone",
  "emailVerified": false,
  "phoneVerified": true,
  "email": "ravi@example.com",
  "phone": "+14155551234"
}
```

**Errors (400):** `"OTP challenge not found or expired"`, `"OTP already used"`, `"OTP expired"`, `"Too many failed attempts on this code. Request a new one."`, `"Incorrect code"`.

### 1.9 · POST `/auth/login/totp` 🌐 → **201**
Complete login after password when `requiresTotp` was returned. `loginChallenge` expires in 5 minutes.

**Request**
```json
{ "loginChallenge": "eyJhbGci...", "code": "483920" }
```

**Response:** same shape as a successful `POST /auth/login` (`accessToken` + `user` or `staff`).

**Errors:** `401` `"Login challenge expired or invalid"`; `400` `"Incorrect authenticator code"`; `429` too many failed attempts (15 min lockout after 5 failures).

### 1.10 · GET `/auth/totp/status` 🔒 → **200**
**Response**
```json
{ "totpEnabled": true, "totpEnabledAt": "2026-07-10T12:00:00.000Z" }
```

### 1.11 · POST `/auth/totp/setup` 🔒 → **201**
Start Google Authenticator enrollment. Returns a one-time secret and QR code.

**Response**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauthUrl": "otpauth://totp/TrustO:ravi@example.com?secret=...",
  "qrDataUrl": "data:image/png;base64,..."
}
```

**Errors:** `409` when TOTP is already enabled.

### 1.12 · POST `/auth/totp/enable` 🔒 → **201**
**Request**
```json
{ "secret": "JBSWY3DPEHPK3PXP", "code": "483920" }
```

**Response:** same as `GET /auth/totp/status`.

### 1.13 · POST `/auth/totp/disable` 🔒 → **201**
**Request**
```json
{ "password": "Secret123", "code": "483920" }
```

**Response:** same as `GET /auth/totp/status` with `totpEnabled: false`.

**Errors:** `401` `"Incorrect password"`; `400` `"Incorrect authenticator code"`.

### 1.8 · GET `/auth/me` 🔒 → **200**
Returns the decoded principal (shape differs by type).

**Request:** none.

**Response (user)**
```json
{
  "id": "665f0011223344556677aabb",
  "type": "user",
  "permissions": [],
  "isSuperAdmin": false,
  "mustChangePassword": false,
  "email": "ravi@example.com",
  "name": "Ravi Kumar",
  "walletAddress": "TJmJ8s...9xQ",
  "referralCode": "RAVI7K2P",
  "role": "user",
  "isBlocked": false,
  "isFrozen": false,
  "assignedAgent": null
}
```

**Response (staff)**
```json
{
  "id": "665f1a2b3c4d5e6f70819203",
  "type": "staff",
  "permissions": ["users", "tickets"],
  "isSuperAdmin": false,
  "mustChangePassword": false,
  "email": "neha.agent@tronpay.com",
  "username": "neha.agent",
  "name": "Agent Neha",
  "roleId": "665faa11bb22cc33dd44ee55",
  "roleName": "Support Agent",
  "team": "support"
}
```

---

# 2. User — Profile & Account

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 2.1 | GET | `/user` | 🔒 | Profile, balances, wallet, 2FA state |
| 2.2 | PATCH | `/user` | 🔒 | Update profile / change password |

### 2.1 · GET `/user` 🔒 → **200**

**Request:** none.

**Response**
```json
{
  "profile": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "name": "Ravi Kumar",
    "email": "ravi@example.com",
    "phone": "+919876543210",
    "emailVerified": true,
    "phoneVerified": false,
    "referralCode": "A1B2C3D4",
    "role": "user",
    "createdAt": "2026-05-01T09:30:00.000Z"
  },
  "walletAddress": "TXYZ1234567890abcdefGHIJKLmnopqrstu",
  "twoFactorVerified": false,
  "twoFactorMethod": null,
  "isBlocked": false,
  "isFrozen": false,
  "smartUpiSelectionEnabled": false,
  "qrImageDataUrl": "data:image/png;base64,iVBORw0KGgo...",
  "balances": {
    "totalDeposits": "1500.00",
    "totalWithdrawals": "300.00",
    "available": "1200.00",
    "referralEarnings": "0.00",
    "currency": "USDT",
    "reserved": "0.00",
    "smartEnabled": false,
    "exchangeRate": 82.5
  }
}
```
`qrImageDataUrl` is `null` when no QR is stored. When smart UPI is on, `reserved` equals `available` and `smartEnabled` is `true`.

**Errors:** `404` `"User not found"`.

### 2.2 · PATCH `/user` 🔒 → **200**
Only changed fields sent; at least one of `name`/`email`/`phone`/`newPassword` required. Changing password requires `currentPassword`.

**Request**
```json
{
  "name": "Ravi Kumar",
  "email": "ravi.new@example.com",
  "phone": "+919876543210",
  "currentPassword": "OldPassw0rd",
  "newPassword": "NewPassw0rd123"
}
```

**Response**
```json
{
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "name": "Ravi Kumar",
  "email": "ravi.new@example.com",
  "phone": "+919876543210",
  "walletAddress": "TXYZ...rstu",
  "referralCode": "A1B2C3D4",
  "role": "user",
  "emailVerified": false,
  "phoneVerified": false,
  "twoFactorVerified": false,
  "twoFactorMethod": null
}
```
Changing `email` resets `emailVerified`; changing `phone` resets `phoneVerified`.

**Errors:** `400` `"No fields to update"` / `"currentPassword is required to change password"`; `401` `"Current password is incorrect"`; `409` `"Email already in use"` / `"Phone number already in use"`.

---

# 3. User — Transactions & Deposits

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 3.1 | GET | `/user/transactions?limit={n}` | 🔒 | Unified deposit+withdrawal history |
| 3.2 | GET | `/user/deposits?limit={n}` | 🔒 | Deposit list |

### 3.1 · GET `/user/transactions?limit={n}` 🔒 → **200**
`limit` default 50, clamped 1–200. Returns a **bare array**, newest first.

**Request:** none.

**Response**
```json
[
  {
    "id": "6700aa11bb22cc33dd44ee55",
    "type": "withdrawal",
    "amount": 100,
    "currency": "USDT",
    "status": "pending",
    "inrAmount": null,
    "walletAddress": null,
    "transactionId": null,
    "txHash": null,
    "destination": null,
    "timestamp": "2026-07-09T12:00:00.000Z",
    "createdAt": "2026-07-09T12:00:00.000Z"
  },
  {
    "id": "665fabcdef0123456789abcd",
    "type": "deposit",
    "amount": 500,
    "currency": "USDT",
    "status": "completed",
    "inrAmount": null,
    "walletAddress": "TXYZ...rstu",
    "transactionId": "0xtxhash-deposit-001",
    "txHash": null,
    "destination": null,
    "timestamp": "2026-07-08T10:15:00.000Z",
    "createdAt": "2026-07-08T10:15:00.000Z"
  }
]
```
Deposits always carry `status: "completed"`; withdrawals carry the real status (`pending`/`processing`/`paid`/`failed`/`reserved`).

### 3.2 · GET `/user/deposits?limit={n}` 🔒 → **200**
`limit` default 50, clamped 1–200. **Bare array**, newest first.

**Request:** none.

**Response**
```json
[
  {
    "id": "665fabcdef0123456789abcd",
    "transactionId": "0xtxhash-deposit-001",
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "walletAddress": "TXYZ...rstu",
    "amount": 500,
    "currency": "USDT",
    "timestamp": "2026-07-08T10:15:00.000Z",
    "createdAt": "2026-07-08T10:15:00.000Z"
  }
]
```
`userId`/`timestamp` may be `null`.

> **Note:** there is **no** `POST /webhook/simulate/{walletAddress}` endpoint. Deposits arrive via an upstream socket.io feed (`deposit-ingest.service.ts`, event `new_transaction`), not an HTTP webhook.

---

# 4. User — Withdrawals

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 4.1 | POST | `/user/withdrawals` | 🔒 | Submit a withdrawal |

### 4.1 · POST `/user/withdrawals` 🔒 → **201**
`pin` is exactly 6 digits; `amount` ≥ **50 USDT**. Fields vary by `method` (`bank` | `upi` | `crypto`).


**Request (bank — inline or saved account)**
```json
{ "pin": "123456", "amount": 100, "method": "bank", "accountNumber": "1234567890", "ifscCode": "HDFC0001234", "notes": "monthly payout" }
```
```json
{ "pin": "123456", "amount": 100, "method": "bank", "bankAccountId": "665fbank000000000000aaaa" }
```

**Request (upi — inline / saved / smart auto-pick)**
```json
{ "pin": "123456", "amount": 100, "method": "upi", "upiId": "ravi@okhdfcbank" }
```
`upiAccountId` may be sent instead; if neither is sent and Smart UPI Selection is enabled, the backend auto-picks an active approved UPI.

**Request (crypto)**
```json
{ "pin": "123456", "amount": 100, "method": "crypto", "network": "TRON", "destinationAddress": "TXYZ...rstu" }
```

**Response** (INR fields are `null` for crypto)
```json
{
  "id": "6700aa11bb22cc33dd44ee55",
  "userId": "665f1a2b3c4d5e6f7a8b9c0d",
  "method": "bank",
  "amount": 100,
  "feeRate": 0.015,
  "fxRate": 82.5,
  "feeUsdt": 1.5,
  "netUsdt": 98.5,
  "grossInr": 8250,
  "feeInr": 123.75,
  "netInr": 8126.25,
  "accountNumber": "1234567890",
  "ifscCode": "HDFC0001234",
  "upiId": null,
  "network": null,
  "destinationAddress": null,
  "status": "pending",
  "txHash": null,
  "utr": null,
  "notes": "monthly payout",
  "processedBy": null,
  "processedAt": null,
  "decisionReason": null,
  "disputeRaised": false,
  "paymentProofUrl": null,
  "blurredProofUrl": null,
  "paidInr": null,
  "differenceInr": null,
  "balanceAdjustmentUsd": 0,
  "isSmart": false,
  "disputeWindowExpiresAt": null,
  "createdAt": "2026-07-09T12:00:00.000Z",
  "updatedAt": "2026-07-09T12:00:00.000Z"
}
```

**Errors:** `400` `{ errorCode: "WITHDRAWAL_PIN_INVALID", attemptsRemaining }`; `400` `{ errorCode: "WITHDRAWAL_PIN_NOT_SET" }`; `403` `{ errorCode: "WITHDRAWAL_PIN_LOCKED" }`; `403` `{ errorCode: "WITHDRAWALS_DISABLED" }` / `"ACCOUNT_BLOCKED"` / `"ACCOUNT_FROZEN"`; `400` `"Minimum withdrawal is 50 USDT"` / `"Insufficient balance. Available: X.XX USDT"`.

---

# 5. User — Bank Accounts

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 5.1 | GET | `/user/bank-accounts` | 🔒 | List saved bank accounts |
| 5.2 | POST | `/user/bank-accounts` | 🔒 | Add a bank account |
| 5.3 | DELETE | `/user/bank-accounts/{id}` | 🔒 | Delete a bank account |
| 5.4 | PATCH | `/user/bank-accounts/{id}/default` | 🔒 | Set default bank account |
| 5.5 | GET | `/user/bank-accounts/pending-approvals` | 🔒 | Shared-account requests awaiting my decision |
| 5.6 | POST | `/user/bank-accounts/pending-approvals/{id}/{action}` | 🔒 | Approve/reject a shared-account request |

The **bank account object** used throughout:
```json
{
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "userId": "665f0011223344556677889a",
  "accountHolderName": "Ravi Kumar",
  "accountNumber": "123456789012",
  "ifscCode": "HDFC0001234",
  "bankName": "HDFC Bank",
  "isDefault": true,
  "approvalStatus": "approved",
  "approvalRequiredFrom": null,
  "isDeleted": false,
  "deletedAt": null,
  "createdAt": "2026-07-10T09:15:00.000Z",
  "updatedAt": "2026-07-10T09:15:00.000Z"
}
```
`approvalStatus` ∈ `approved` | `pending` | `rejected`.

### 5.1 · GET `/user/bank-accounts` 🔒 → **200**
**Request:** none. **Response:** array of bank account objects (default-first, `[]` if none).

### 5.2 · POST `/user/bank-accounts` 🔒 → **201**
`accountNumber` matches `^[0-9]{6,20}$`; `ifscCode` matches `^[A-Z]{4}0[A-Z0-9]{6}$` (uppercased server-side).

**Request**
```json
{ "accountHolderName": "Ravi Kumar", "accountNumber": "123456789012", "ifscCode": "HDFC0001234", "bankName": "HDFC Bank", "isDefault": true }
```

**Response:** a single bank account object. If the same account is already owned by another user, the returned object is `approvalStatus: "pending"` with `approvalRequiredFrom` set, and the caller is frozen pending owner approval.

**Errors:** `409` `"This bank account is already saved"` (+ pending variant).

### 5.3 · DELETE `/user/bank-accounts/{id}` 🔒 → **204**
No body, empty response. Soft-delete; next-newest becomes default if needed.
**Errors:** `400` `"Invalid bankAccountId"`; `404` `"Bank account not found"`.

### 5.4 · PATCH `/user/bank-accounts/{id}/default` 🔒 → **200**
No body. **Response:** the updated account (`isDefault: true`). Requires an approved account.
**Errors:** `404` `"Bank account not found"`; `400` `"This bank account is not yet approved and cannot be used"`.

### 5.5 · GET `/user/bank-accounts/pending-approvals` 🔒 → **200**
**Response:** array of bank account objects (each `approvalStatus: "pending"`) plus a `requester` block:
```json
[
  {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "userId": "665faabbccddeeff00112233",
    "accountHolderName": "Ravi Kumar",
    "accountNumber": "123456789012",
    "ifscCode": "HDFC0001234",
    "bankName": "HDFC Bank",
    "isDefault": false,
    "approvalStatus": "pending",
    "approvalRequiredFrom": "665f0011223344556677889a",
    "createdAt": "2026-07-10T09:15:00.000Z",
    "updatedAt": "2026-07-10T09:15:00.000Z",
    "requester": { "id": "665faabbccddeeff00112233", "name": "Some User", "email": "user@example.com" }
  }
]
```

### 5.6 · POST `/user/bank-accounts/pending-approvals/{id}/{action}` 🔒 → **201**
`{action}` ∈ `approve` | `reject`. No body. **Response:** the bank account object now `approvalStatus: "approved"` (unfreezes requester) or `"rejected"`.
**Errors:** `404` `"Approval request not found"`; `403` `"You are not authorized to approve this bank account"`; `400` `"This request has already been processed"`.

---

# 6. User — UPI Accounts

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 6.1 | GET | `/user/upi-accounts` | 🔒 | List saved UPI IDs |
| 6.2 | POST | `/user/upi-accounts` | 🔒 | Add a UPI ID |
| 6.3 | DELETE | `/user/upi-accounts/{id}` | 🔒 | Delete a UPI ID |
| 6.4 | PATCH | `/user/upi-accounts/{id}/default` | 🔒 | Set default UPI |
| 6.5 | PATCH | `/user/upi-accounts/{id}/active` | 🔒 | Activate/deactivate a UPI |
| 6.6 | GET | `/user/upi-accounts/smart-selection` | 🔒 | Read smart-selection toggle |
| 6.7 | PATCH | `/user/upi-accounts/smart-selection` | 🔒 | Set smart-selection toggle |
| 6.8 | GET | `/user/upi-accounts/pending-approvals` | 🔒 | Shared-UPI requests awaiting my decision |
| 6.9 | POST | `/user/upi-accounts/pending-approvals/{id}/{action}` | 🔒 | Approve/reject a shared-UPI request |

The **UPI account object**:
```json
{
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "userId": "665f0011223344556677889a",
  "upiId": "ravi@hdfcbank",
  "accountHolderName": "Ravi Kumar",
  "isDefault": true,
  "isActive": true,
  "approvalStatus": "approved",
  "approvalRequiredFrom": null,
  "isDeleted": false,
  "deletedAt": null,
  "createdAt": "2026-07-10T09:15:00.000Z",
  "updatedAt": "2026-07-10T09:15:00.000Z"
}
```

### 6.1 · GET `/user/upi-accounts` 🔒 → **200**
**Response:** array of UPI objects (default-first, `[]` if none).

### 6.2 · POST `/user/upi-accounts` 🔒 → **201**
`upiId` matches `^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$` (lowercased server-side).

**Request**
```json
{ "upiId": "ravi@hdfcbank", "accountHolderName": "Ravi Kumar", "isDefault": true }
```
**Response:** a UPI object. Duplicate-owned-by-another-user → `approvalStatus: "pending"` and caller frozen.
**Errors:** `409` `"This UPI ID is already saved"` (+ pending variant).

### 6.3 · DELETE `/user/upi-accounts/{id}` 🔒 → **204**
No body, empty response. **Errors:** `400` `"Invalid upiAccountId"`; `404` `"UPI ID not found"`.

### 6.4 · PATCH `/user/upi-accounts/{id}/default` 🔒 → **200**
No body. **Response:** UPI object with `isDefault: true`, `isActive: true`. Requires approved.

### 6.5 · PATCH `/user/upi-accounts/{id}/active` 🔒 → **200**
**Request**
```json
{ "isActive": false }
```
**Response:** the updated UPI object. Cannot deactivate the default.
**Errors:** `400` `"Set another UPI as your default before deactivating this one"` / `"This UPI ID is not yet approved and cannot be used"`.

### 6.6 · GET `/user/upi-accounts/smart-selection` 🔒 → **200**
**Response:** `{ "enabled": false }`.

### 6.7 · PATCH `/user/upi-accounts/smart-selection` 🔒 → **200**
**Request:** `{ "enabled": true }` → **Response:** `{ "enabled": true }`. Also arms/disarms auto-liquidation.

### 6.8 · GET `/user/upi-accounts/pending-approvals` 🔒 → **200**
**Response:** array of UPI objects (`approvalStatus: "pending"`) each with a `requester` block (same shape as 5.5).

### 6.9 · POST `/user/upi-accounts/pending-approvals/{id}/{action}` 🔒 → **201**
`{action}` ∈ `approve` | `reject`. No body. **Response:** the UPI object now `approved` (unfreezes requester) or `rejected`.

---

# 7. User — Withdrawal PIN

All 🔒. The **PIN status object** returned by status/set/change/reset-confirm:
```json
{ "isSet": true, "isLocked": false, "setAt": "2026-07-10T09:15:00.000Z", "failedAttempts": 0 }
```

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 7.1 | GET | `/user/withdrawal-pin/status` | Read PIN status |
| 7.2 | POST | `/user/withdrawal-pin/set` | Set up PIN |
| 7.3 | POST | `/user/withdrawal-pin/change` | Change PIN |
| 7.4 | POST | `/user/withdrawal-pin/reset/request` | Send reset OTP |
| 7.5 | POST | `/user/withdrawal-pin/reset/confirm` | Confirm reset |

### 7.1 · GET `/user/withdrawal-pin/status` → **200**
**Request:** none. **Response:** PIN status object (`isSet: false`, `setAt: null` when unset).

### 7.2 · POST `/user/withdrawal-pin/set` → **201**
`pin`/`confirmPin` exactly 6 digits.
**Request:** `{ "pin": "123456", "confirmPin": "123456" }`
**Response:** PIN status object (`isSet: true`).
**Errors:** `400` `"pin and confirmPin do not match"`; `400` `{ errorCode: "WITHDRAWAL_PIN_ALREADY_SET" }`.

### 7.3 · POST `/user/withdrawal-pin/change` → **201**
**Request**
```json
{ "currentPin": "123456", "newPin": "654321", "confirmNewPin": "654321" }
```
**Response:** PIN status object.
**Errors:** `400` `"newPin and confirmNewPin do not match"` / `"newPin must be different from currentPin"`; `400` `{ errorCode: "WITHDRAWAL_PIN_NOT_SET" }`; `403` `{ errorCode: "WITHDRAWAL_PIN_LOCKED" }`; `400` `{ errorCode: "WITHDRAWAL_PIN_INVALID" }`.

### 7.4 · POST `/user/withdrawal-pin/reset/request` → **201**
No body. Sends a 6-digit OTP (10-min TTL) via the user's notification channel.
**Response:** `{ "expiresAt": "2026-07-10T09:25:00.000Z" }`.

### 7.5 · POST `/user/withdrawal-pin/reset/confirm` → **201**
**Request**
```json
{ "otp": "482913", "newPin": "654321", "confirmNewPin": "654321" }
```
**Response:** PIN status object (`isLocked: false`, `failedAttempts: 0`).
**Errors:** `400` `{ errorCode: "PIN_RESET_OTP_EXPIRED" }` / `"PIN_RESET_OTP_EXHAUSTED"` / `"PIN_RESET_OTP_INVALID"`.

---

# 8. User — Support Tickets & Disputes

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 8.1 | POST | `/user/tickets` | 🔒 | Raise a ticket |
| 8.2 | GET | `/user/tickets?limit={n}` | 🔒 | List own tickets |
| 8.3 | GET | `/user/tickets/{id}` | 🔒 | Fetch one ticket |
| 8.4 | POST | `/user/withdrawal-disputes` | 🔒 | Raise a withdrawal dispute |
| 8.5 | GET | `/user/withdrawal-disputes?limit={n}` | 🔒 | List own disputes |
| 8.6 | GET | `/user/withdrawal-disputes/{id}` | 🔒 | Fetch one dispute |

### 8.1 · POST `/user/tickets` 🔒 → **201**
`title` 3–140, `description` 10–4000. Team forced to `support`.
**Request**
```json
{ "title": "Deposit not credited", "description": "I sent 50 USDT two hours ago and my balance hasn't updated yet." }
```
**Response**
```json
{
  "id": "665f1a2b3c4d5e6f7a8b9c0d",
  "userId": "664e0f1a2b3c4d5e6f7a8b9c",
  "createdByType": "user",
  "title": "Deposit not credited",
  "description": "I sent 50 USDT two hours ago and my balance hasn't updated yet.",
  "team": "support",
  "assignmentStatus": "unassigned",
  "assignee": null,
  "assignedAt": null,
  "resolutionStatus": "pending",
  "resolvedAt": null,
  "resolvedBy": null,
  "createdAt": "2026-07-10T09:15:00.000Z",
  "updatedAt": "2026-07-10T09:15:00.000Z"
}
```

### 8.2 · GET `/user/tickets?limit={n}` 🔒 → **200**
`limit` default 50, clamped 1–100. **Bare array** of ticket objects (newest first). Assigned tickets populate `assignee: { id, fullName, email }` and `resolved*` fields.

### 8.3 · GET `/user/tickets/{id}` 🔒 → **200**
**Response:** a single ticket object. **Errors:** `400` `"Invalid ticket id"`; `404` `"Ticket not found"`.

### 8.4 · POST `/user/withdrawal-disputes` 🔒 → **201**
For a UPI withdrawal, within 10 min of approval. `reason` ∈ `not_received` (default) | `wrong_amount` | `other`; `description` 10–4000. `title`/amounts are snapshotted server-side.
**Request**
```json
{ "withdrawalId": "6650a1b2c3d4e5f6a7b8c9d0", "reason": "not_received", "description": "The withdrawal shows approved but nothing has arrived in my bank account." }
```
**Response**
```json
{
  "id": "667a1b2c3d4e5f6a7b8c9d0e",
  "userId": "664e0f1a2b3c4d5e6f7a8b9c",
  "withdrawalId": "6650a1b2c3d4e5f6a7b8c9d0",
  "reason": "not_received",
  "title": "UPI withdrawal not received (₹4050)",
  "description": "The withdrawal shows approved but nothing has arrived in my bank account.",
  "amountUsdt": 50,
  "netInr": 4050,
  "upiId": "user@okhdfcbank",
  "utr": "123456789012",
  "team": "support",
  "assignmentStatus": "unassigned",
  "assignee": null,
  "assignedAt": null,
  "resolutionStatus": "pending",
  "resolvedAt": null,
  "resolvedBy": null,
  "resolutionNotes": null,
  "createdAt": "2026-07-10T10:00:00.000Z",
  "updatedAt": "2026-07-10T10:00:00.000Z"
}
```
**Errors:** `400` `"Disputes can only be raised for UPI withdrawals"`; `400` `{ errorCode: "WITHDRAWAL_NOT_APPROVED" }`; `400` `{ errorCode: "DISPUTE_WINDOW_CLOSED" }`; `409` `"A dispute has already been raised for this withdrawal"`.

### 8.5 · GET `/user/withdrawal-disputes?limit={n}` 🔒 → **200**
`limit` default 50, clamped 1–100. **Bare array** of dispute objects.

### 8.6 · GET `/user/withdrawal-disputes/{id}` 🔒 → **200**
**Response:** a single dispute object. **Errors:** `400` `"Invalid dispute id"`; `404` `"Dispute not found"`.

---

# 9. User — Notifications, Tags & Pricing

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 9.1 | GET | `/user/notification-preference` | 🔒 | Read notification channel |
| 9.2 | PATCH | `/user/notification-preference` | 🔒 | Set notification channel |
| 9.3 | GET | `/user/me/tag` | 🔒 | Current tier tag |
| 9.4 | GET | `/pricing/me` | 🔒 | Effective pricing for this user |

### 9.1 · GET `/user/notification-preference` 🔒 → **200**
**Response:** `{ "channel": "sms" }` (default `sms`). `channel` ∈ `sms` | `email`.

### 9.2 · PATCH `/user/notification-preference` 🔒 → **200**
**Request:** `{ "channel": "email" }` → **Response:** `{ "channel": "email" }`.
**Errors:** `400` `channel must be either "sms" or "email"`.

### 9.3 · GET `/user/me/tag` 🔒 → **200**
**Response (with tag)**
```json
{
  "userId": "664e0f1a2b3c4d5e6f7a8b9c",
  "tag": { "id": "6612a1b2c3d4e5f6a7b8c9d0", "name": "Gold", "rank": 3, "thresholdAmount": 100000, "thresholdPeriod": "month", "color": "#FFD700", "benefitInr": 500, "isActive": true },
  "assignedAt": "2026-07-01T00:00:00.000Z",
  "source": "auto"
}
```
No tag → `{ "userId": "...", "tag": null, "assignedAt": null, "source": null }`. `source` ∈ `auto` | `manual` | `null`.

### 9.4 · GET `/pricing/me` 🔒 → **200**
**Response**
```json
{ "usdtPrice": 1, "inrPrice": 82.5, "feePercent": 0.015, "hasOverride": false }
```
`hasOverride` is true when a per-user override is applied. `feePercent` is a decimal.

---

# 10. Admin — Dashboard & Users

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 10.1 | GET | `/admin/users?page=&limit=` | 🔒 | List users (paginated) |
| 10.2 | GET | `/admin/users/{userId}` | 🔒 | Fetch one user |
| 10.3 | POST | `/admin/users/{userId}/{action}` | 🔒 | Block/freeze/watch a user |
| 10.4 | GET | `/admin/deposits` | 🔒 | List all deposits |
| 10.5 | GET | `/admin/withdrawals?page=&limit=&userId=` | 🔒 | List withdrawals (paginated) |

### 10.1 · GET `/admin/users` 🔒 → **200**
Query: `page` (1), `limit` (25, clamped 1–100), plus optional `search`, `role`, `blocked`, `frozen`, `onWatch`.

**Response**
```json
{
  "items": [
    {
      "id": "6650a1f2c3d4e5f6a7b8c9d0",
      "name": "Ravi Kumar",
      "email": "ravi@example.com",
      "role": "user",
      "isBlocked": false, "blockedAt": null, "blockedBy": null, "blockedReason": null,
      "isFrozen": false, "frozenAt": null, "frozenBy": null, "frozenReason": null,
      "isOnWatch": false, "watchedAt": null, "watchedBy": null, "watchedReason": null,
      "walletAddress": "TXyz...abc",
      "referralCode": "RAVI123",
      "phone": "+919876543210",
      "emailVerified": true,
      "phoneVerified": false,
      "createdAt": "2026-06-01T10:15:00.000Z"
    }
  ],
  "total": 137,
  "page": 1,
  "limit": 25
}
```

### 10.2 · GET `/admin/users/{userId}` 🔒 → **200**
**Response:** same as a 10.1 item **plus** `assignedAgent`:
```json
{
  "id": "6650a1f2c3d4e5f6a7b8c9d0",
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "role": "user",
  "isBlocked": false, "blockedAt": null, "blockedBy": null, "blockedReason": null,
  "isFrozen": false, "frozenAt": null, "frozenBy": null, "frozenReason": null,
  "isOnWatch": false, "watchedAt": null, "watchedBy": null, "watchedReason": null,
  "walletAddress": "TXyz...abc",
  "referralCode": "RAVI123",
  "phone": "+919876543210",
  "emailVerified": true,
  "phoneVerified": false,
  "createdAt": "2026-06-01T10:15:00.000Z",
  "assignedAgent": { "id": "6650b0000000000000000001", "fullName": "Agent Smith", "email": "agent@tronpay.io" }
}
```
**Errors:** `400` `"Invalid user id"`; `404` `"User not found"`.

### 10.3 · POST `/admin/users/{userId}/{action}` 🔒 → **201**
`{action}` are **separate routes**: `block` | `unblock` | `freeze` | `unfreeze` | `watch` | `unwatch` (`watch`/`unwatch` super-admin only). `block`/`freeze`/`watch` accept an optional reason; the `un*` routes take no body.

**Request** (block/freeze/watch — optional)
```json
{ "reason": "Suspicious multi-account activity" }
```

**Response** (the 17-field moderation result)
```json
{
  "id": "6650a1f2c3d4e5f6a7b8c9d0",
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "role": "user",
  "isBlocked": true,
  "blockedAt": "2026-07-10T09:00:00.000Z",
  "blockedBy": "6650b0000000000000000009",
  "blockedReason": "Suspicious multi-account activity",
  "isFrozen": false, "frozenAt": null, "frozenBy": null, "frozenReason": null,
  "isOnWatch": false, "watchedAt": null, "watchedBy": null, "watchedReason": null
}
```
**Errors:** `400` `"Cannot moderate yourself"` / `"Cannot block a super admin"`; `403` non-super-admin calling `watch`/`unwatch`; `404` `"User not found"`.

### 10.4 · GET `/admin/deposits` 🔒 → **200**
No query params are read. Returns a **bare array** (every deposit, newest first), each item a deposit object plus `visibleToUser`:
```json
[
  {
    "id": "6651aaa0000000000000000a",
    "transactionId": "TXN-0xabc123",
    "userId": "6650a1f2c3d4e5f6a7b8c9d0",
    "walletAddress": "TXyz...abc",
    "amount": 250.5,
    "currency": "USDT",
    "timestamp": "2026-07-09T14:00:00.000Z",
    "createdAt": "2026-07-09T14:00:05.000Z",
    "visibleToUser": true
  }
]
```
`userId` is `null` when the wallet matched no user.

### 10.5 · GET `/admin/withdrawals` 🔒 → **200**
Query: `page` (1), `limit` (25, clamped 1–200), optional `userId`, `status` (`pending`|`processing`|`paid`|`failed`), `method` (`bank`|`upi`|`crypto`).

**Response**
```json
{
  "items": [
    {
      "id": "6652bbb0000000000000000b",
      "userId": "6650a1f2c3d4e5f6a7b8c9d0",
      "method": "upi",
      "amount": 100,
      "feeRate": 0.03,
      "fxRate": 91.5,
      "feeUsdt": 3,
      "netUsdt": 97,
      "grossInr": 9150,
      "feeInr": 274.5,
      "netInr": 8875.5,
      "accountNumber": null,
      "ifscCode": null,
      "upiId": "ravi@okaxis",
      "network": null,
      "destinationAddress": null,
      "status": "pending",
      "txHash": null,
      "utr": null,
      "notes": null,
      "processedBy": null,
      "processedAt": null,
      "decisionReason": null,
      "disputeRaised": false,
      "paymentProofUrl": null,
      "blurredProofUrl": null,
      "paidInr": null,
      "differenceInr": null,
      "balanceAdjustmentUsd": 0,
      "isSmart": false,
      "disputeWindowExpiresAt": null,
      "createdAt": "2026-07-09T12:00:00.000Z",
      "updatedAt": "2026-07-09T12:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 25
}
```

---

# 11. Admin — Withdrawals Actions

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 11.1 | POST | `/admin/withdrawals/{id}/approve` | 🔒 | Approve a withdrawal |
| 11.2 | POST | `/admin/withdrawals/{id}/reject` | 🔒 | Reject a withdrawal |

### 11.1 · POST `/admin/withdrawals/{id}/approve` 🔒 → **201**
`reason` required (3–500). `utr` required for bank/upi (regex `^[A-Z0-9]{8,25}$`); `txHash` required for crypto.
**Request**
```json
{ "reason": "Verified and paid via bank transfer", "utr": "AXIS12345678" }
```
**Response:** the updated withdrawal object (`status: "paid"`, populated `processedBy`, `processedAt`, `decisionReason`, `utr`/`txHash`, and `disputeWindowExpiresAt` for paid non-smart UPI).

### 11.2 · POST `/admin/withdrawals/{id}/reject` 🔒 → **201**
**Request:** `{ "reason": "Bank details do not match KYC" }`
**Response:** the updated withdrawal object (`status: "failed"`, populated `processedBy`/`processedAt`/`decisionReason`).

**Errors (both):** `400` `"Invalid withdrawalId"` / `"Withdrawal is already <status> and cannot be changed"` / `"UTR is required..."` / `"txHash is required..."`; `404` `"Withdrawal not found"`.

---

# 12. Admin — Deposits page

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 12.1 | GET | `/admin/deposits` | 🔒 | All deposits (see 10.4 — bare array) |
| 12.2 | GET | `/admin/users?page=&limit=` | 🔒 | Map userId → name/email/phone (see 10.1) |

These reuse 10.4 and 10.1 respectively.

---

# 13. Admin — Alerts

Super-admin only.

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 13.1 | GET | `/admin/alerts?page=&limit=&resolved=&severity=` | 🔒 | List alerts |
| 13.2 | POST | `/admin/alerts/{id}/resolve` | 🔒 | Resolve an alert |

### 13.1 · GET `/admin/alerts` 🔒 → **200**
Query: `page` (1), `limit` (25), optional `resolved` (`true|false`), `severity` (`low|medium|high|critical`), `type` (`bank_account_reuse|bank_account_shared|upi_account_shared`).

**Response** (note extra `unresolvedCount`)
```json
{
  "items": [
    {
      "id": "6653ccc0000000000000000c",
      "type": "bank_account_reuse",
      "severity": "high",
      "title": "Bank account reused across accounts",
      "message": "Account XXXX1234 was submitted by a second user",
      "primaryUserId": "6650a1f2c3d4e5f6a7b8c9d0",
      "secondaryUserId": "6650a1f2c3d4e5f6a7b8c9e1",
      "metadata": { "submitted": { "accountNumber": "1234567890", "ifscCode": "HDFC0001234" } },
      "isResolved": false,
      "resolvedAt": null,
      "resolvedBy": null,
      "resolutionNotes": "",
      "resolution": null,
      "createdAt": "2026-07-08T11:00:00.000Z",
      "updatedAt": "2026-07-08T11:00:00.000Z"
    }
  ],
  "total": 5,
  "unresolvedCount": 3,
  "page": 1,
  "limit": 25
}
```

### 13.2 · POST `/admin/alerts/{id}/resolve` 🔒 → **201**
`action` required (`cleared` = false alarm, unfreezes/restores; `confirmed` = fraud). `notes` optional (≤500).
**Request**
```json
{ "action": "cleared", "notes": "Verified false alarm, same person" }
```
**Response:** the updated alert (`isResolved: true`, `resolution: "cleared"`, `resolvedAt`/`resolvedBy`/`resolutionNotes` set).
**Errors:** `404` `"Alert not found"`; `400` `"Alert is already resolved"`.

---

# 14. Admin — Roles, Staff & Permissions

Super-admin only.

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 14.1 | GET | `/admin/permissions` | 🔒 | Permission catalog |
| 14.2 | GET | `/admin/roles` | 🔒 | List roles |
| 14.3 | POST | `/admin/roles` | 🔒 | Create role |
| 14.4 | PATCH | `/admin/roles/{id}` | 🔒 | Update role |
| 14.5 | DELETE | `/admin/roles/{id}` | 🔒 | Delete role |
| 14.6 | GET | `/admin/staff?page=&limit=` | 🔒 | List staff |
| 14.7 | POST | `/admin/staff` | 🔒 | Create staff |
| 14.8 | PATCH | `/admin/staff/{id}` | 🔒 | Update staff |
| 14.9 | POST | `/admin/staff/{id}/{action}` | 🔒 | Activate/deactivate staff |
| 14.10 | DELETE | `/admin/staff/{id}` | 🔒 | Delete staff |
| 14.11 | POST | `/admin/staff/{id}/reset-password` | 🔒 | Reset staff password |

### 14.1 · GET `/admin/permissions` → **200**
**Response**
```json
{
  "items": [
    { "key": "dashboard", "label": "Dashboard", "description": "Overview & KPIs" },
    { "key": "users", "label": "Users", "description": "User list, KYC, tags" },
    { "key": "tickets", "label": "Tickets", "description": "View and resolve support tickets" }
  ]
}
```
Valid keys: `dashboard, users, tags, deposits, withdrawals, wallets, roles, settings, tickets, export`.

### 14.2 · GET `/admin/roles` → **200**
**Bare array** of role objects:
```json
[
  {
    "id": "665f1a2b3c4d5e6f70112233",
    "name": "Support Agent",
    "description": "Handles support tickets",
    "permissions": ["dashboard", "tickets", "users"],
    "isActive": true,
    "team": "support",
    "memberCount": 4,
    "createdBy": "665f0000000000000000aaaa",
    "createdAt": "2026-06-01T10:00:00.000Z",
    "updatedAt": "2026-06-10T09:30:00.000Z"
  }
]
```
`team` ∈ `support` | `tech` | `null`.

### 14.3 · POST `/admin/roles` → **201**
**Request**
```json
{ "name": "Support Agent", "description": "Handles support tickets", "permissions": ["dashboard", "tickets", "users"], "isActive": true, "team": "support" }
```
**Response:** a single role object (`memberCount: 0`).
**Errors:** `400` unrecognized permission (body includes `invalidPermissions` + `validPermissions`); `409` duplicate name.

### 14.4 · PATCH `/admin/roles/{id}` → **200**
All fields optional (≥1 required); `team` may be `null`.
**Request:** `{ "name": "Senior Support", "permissions": ["dashboard", "tickets"], "isActive": false, "team": "tech" }`
**Response:** the updated role object. **Errors:** `404` not found; `409` duplicate name.

### 14.5 · DELETE `/admin/roles/{id}` → **204**
No body, empty response. **Errors:** `409` `"Cannot delete role while N staff user(s) are assigned..."`.

### 14.6 · GET `/admin/staff` → **200**
Query: `page` (1), `limit` (25, max 100), optional `search`, `roleId`, `active`. Super-admins excluded.
**Response**
```json
{
  "items": [
    {
      "id": "665f2222000000000000bbbb",
      "username": "jdoe",
      "email": "jdoe@example.com",
      "fullName": "Jane Doe",
      "agentCode": "AGT-7K9Q2",
      "isActive": true,
      "isSuperAdmin": false,
      "mustChangePassword": true,
      "role": { "id": "665f1a2b3c4d5e6f70112233", "name": "Support Agent" },
      "lastLoginAt": null,
      "createdAt": "2026-07-01T12:00:00.000Z",
      "updatedAt": "2026-07-01T12:00:00.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 25
}
```

### 14.7 · POST `/admin/staff` → **201**
`username` 3–40 (`[a-zA-Z0-9._-]`), `password` 8–128; all fields required.
**Request**
```json
{ "username": "jdoe", "email": "jdoe@example.com", "password": "S3curePass!", "fullName": "Jane Doe", "roleId": "665f1a2b3c4d5e6f70112233" }
```
**Response:** the staff object (server generates `agentCode`; `mustChangePassword: true`).
**Errors:** `404` role not found; `400` role inactive; `409` username/email exists.

### 14.8 · PATCH `/admin/staff/{id}` → **200**
All optional (≥1 of `fullName`, `email`, `roleId`, `isActive`).
**Request:** `{ "fullName": "Jane D.", "roleId": "665f...", "isActive": false }`
**Response:** the updated staff object. **Errors:** `400` super-admin target; `409` email in use.

### 14.9 · POST `/admin/staff/{id}/{action}` → **201**
`{action}` ∈ `activate` | `deactivate`. No body. **Response:** the staff object with updated `isActive`.
**Errors:** `400` `"super admin cannot be deactivated"`.

### 14.10 · DELETE `/admin/staff/{id}` → **204**
No body, empty response. Un-assigns the agent from users first. **Errors:** `400` super-admin/self target.

### 14.11 · POST `/admin/staff/{id}/reset-password` → **201**
**Request:** `{ "newPassword": "NewS3cure!" }` (8–128)
**Response:** `{ "ok": true }` (sets `mustChangePassword: true`).

---

# 15. Admin — User Tags (tiers)

`RequirePermissions('users')`.

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 15.1 | GET | `/admin/user-tags` | 🔒 | List tier tags |
| 15.2 | POST | `/admin/user-tags` | 🔒 | Create tag |
| 15.3 | PATCH | `/admin/user-tags/{id}` | 🔒 | Update tag |
| 15.4 | POST | `/admin/user-tags/{id}/{action}` | 🔒 | Enable/disable tag |
| 15.5 | DELETE | `/admin/user-tags/{id}` | 🔒 | Delete tag |
| 15.6 | GET | `/admin/users/{userId}/tag` | 🔒 | User's current tag |
| 15.7 | POST | `/admin/users/{userId}/tag` | 🔒 | Apply/replace user's tag |
| 15.8 | DELETE | `/admin/users/{userId}/tag` | 🔒 | Remove user's tag |
| 15.9 | GET | `/admin/users/{userId}/tag-history` | 🔒 | Tag change audit log |

The **tag object**:
```json
{
  "id": "665faaa0000000000000cccc",
  "name": "Gold",
  "rank": 2,
  "thresholdAmount": 5000,
  "thresholdPeriod": "month",
  "isActive": true,
  "color": "#FFD700",
  "benefitInr": 0,
  "isDefault": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```
`thresholdPeriod` ∈ `day` | `week` | `month`.

### 15.1 · GET `/admin/user-tags` → **200**
**Bare array** of tag objects sorted by `rank` ascending.

### 15.2 · POST `/admin/user-tags` → **201**
**Request**
```json
{ "name": "Platinum", "rank": 4, "thresholdAmount": 20000, "thresholdPeriod": "month", "isActive": true, "color": "#E5E4E2", "benefitInr": 500 }
```
**Response:** a tag object. **Errors:** `409` duplicate name/rank; `400` threshold ordering violation.

### 15.3 · PATCH `/admin/user-tags/{id}` → **200**
All fields optional.
**Request:** `{ "name": "Platinum+", "rank": 5, "isActive": false, "benefitInr": 750 }`
**Response:** the updated tag object. **Errors:** `400` renaming a default tag; `409` name/rank conflict.

### 15.4 · POST `/admin/user-tags/{id}/{action}` → **201**
`{action}` ∈ `enable` | `disable`. No body. **Response:** the tag object with updated `isActive`.

### 15.5 · DELETE `/admin/user-tags/{id}` → **204**
No body, empty response. **Errors:** `400` cannot delete a default tag.

The **tag-assignment object** (15.6–15.8):
```json
{
  "userId": "665fuser000000000000dddd",
  "tag": { "id": "665faaa0000000000000cccc", "name": "Gold", "rank": 2 },
  "assignedAt": "2026-07-05T08:00:00.000Z",
  "assignedBy": "665fstaff00000000000eeee",
  "source": "manual"
}
```

### 15.6 · GET `/admin/users/{userId}/tag` → **200**
**Response:** tag-assignment object (no tag → `tag/assignedAt/assignedBy/source` all `null`).

### 15.7 · POST `/admin/users/{userId}/tag` → **201**
**Request:** `{ "tagId": "665faaa0000000000000cccc", "reason": "VIP upgrade" }` (`reason` optional ≤500)
**Response:** tag-assignment object (`source: "manual"`). **Errors:** `400` inactive tag; `404` user/tag not found.

### 15.8 · DELETE `/admin/users/{userId}/tag` → **200**
**Request (optional):** `{ "reason": "Downgrade" }`
**Response:** tag-assignment object with `tag: null`. **Errors:** `400` user has no tag.

### 15.9 · GET `/admin/users/{userId}/tag-history` → **200**
**Bare array** (newest first):
```json
[
  {
    "id": "665fhist0000000000000fff0",
    "userId": "665fuser000000000000dddd",
    "fromTagId": "665faaa0000000000000cccc",
    "toTagId": null,
    "source": "manual",
    "actorId": "665fstaff00000000000eeee",
    "reason": "Downgrade",
    "createdAt": "2026-07-06T09:00:00.000Z"
  }
]
```

---

# 16. Admin — Assigned Agent & Pricing

Assigned-agent: `RequirePermissions('users')`. Pricing: `RequirePermissions('settings')`. `feePercent` is a decimal in `[0, 1)`.

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 16.1 | PATCH | `/admin/users/{userId}/assigned-agent` | 🔒 | Assign/unassign an agent |
| 16.2 | GET | `/admin/pricing` | 🔒 | Global pricing |
| 16.3 | PATCH | `/admin/pricing` | 🔒 | Update global pricing |
| 16.4 | GET | `/admin/users/{userId}/pricing` | 🔒 | Per-user pricing override |
| 16.5 | PUT | `/admin/users/{userId}/pricing` | 🔒 | Set per-user override |
| 16.6 | DELETE | `/admin/users/{userId}/pricing` | 🔒 | Clear per-user override |
| 16.7 | GET | `/admin/pricing/overrides?page=&limit=` | 🔒 | List all overrides |
| 16.8 | GET | `/admin/pricing/history?scope=&page=&limit=` | 🔒 | Pricing history |
| 16.9 | GET | `/admin/users/{userId}/pricing/history?page=&limit=` | 🔒 | Per-user pricing history |

### 16.1 · PATCH `/admin/users/{userId}/assigned-agent` → **200**
**Request:** `{ "agentId": "665f2222000000000000bbbb" }` (or `null` to unassign)
**Response:** the moderation result **plus** `assignedAgent`:
```json
{
  "id": "665fuser000000000000dddd",
  "name": "John User",
  "email": "john@example.com",
  "role": "user",
  "isBlocked": false, "blockedAt": null, "blockedBy": null, "blockedReason": null,
  "isFrozen": false, "frozenAt": null, "frozenBy": null, "frozenReason": null,
  "isOnWatch": false, "watchedAt": null, "watchedBy": null, "watchedReason": null,
  "assignedAgent": { "id": "665f2222000000000000bbbb", "fullName": "Jane Doe", "email": "jdoe@example.com" }
}
```
`agentId: null` → `assignedAgent: null`. **Errors:** `400` agent not available; `404` user not found.

### 16.2 · GET `/admin/pricing` → **200**
**Response**
```json
{ "usdtPrice": 1, "inrPrice": 82.5, "feePercent": 0.015, "updatedAt": "2026-07-01T00:00:00.000Z", "updatedBy": "665fstaff00000000000eeee", "updatedByType": "staff" }
```
`updatedByType` ∈ `user` | `staff` | `null`.

### 16.3 · PATCH `/admin/pricing` → **200**
All fields optional (≥1 required).
**Request:** `{ "usdtPrice": 1, "inrPrice": 83.2, "feePercent": 0.02 }`
**Response:** the global pricing object (as 16.2). **Errors:** `400` non-positive price / `feePercent` outside `[0,1)`.

### 16.4 · GET `/admin/users/{userId}/pricing` → **200**
**Response**
```json
{
  "userId": "665fuser000000000000dddd",
  "override": { "usdtPrice": null, "inrPrice": 80, "feePercent": null },
  "effective": { "usdtPrice": 1, "inrPrice": 80, "feePercent": 0.015 },
  "updatedAt": "2026-07-05T00:00:00.000Z",
  "setBy": "665fstaff00000000000eeee",
  "setByType": "staff"
}
```
No override → `override: null`, `effective` mirrors global, `updatedAt/setBy/setByType: null`.

### 16.5 · PUT `/admin/users/{userId}/pricing` → **200**
Each field optional, a number or `null` (null clears that field); ≥1 key required.
**Request:** `{ "inrPrice": 80, "feePercent": 0.01, "usdtPrice": null }`
**Response:** the user-pricing object (as 16.4). If all fields become null the override is deleted (`override: null`).

### 16.6 · DELETE `/admin/users/{userId}/pricing` → **200**
No body. **Response:** the user-pricing object with `override: null`.

### 16.7 · GET `/admin/pricing/overrides` → **200**
Query: `page` (1), `limit` (25, max 100).
**Response:** `{ "items": [ /* user-pricing objects */ ], "total": 3, "page": 1, "limit": 25 }`.

### 16.8 / 16.9 · Pricing history → **200**
16.8 accepts `scope` (`global`|`user`) and `userId`; 16.9 forces `scope=user` from the path.
**Response**
```json
{
  "items": [
    {
      "id": "665fph000000000000000001",
      "scope": "user",
      "action": "update",
      "userId": "665fuser000000000000dddd",
      "changes": [ { "field": "inrPrice", "oldValue": null, "newValue": 80 } ],
      "changedBy": "665fstaff00000000000eeee",
      "changedByType": "staff",
      "at": "2026-07-05T00:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 25
}
```
`action` ∈ `update` | `clear`; `field` ∈ `usdtPrice` | `inrPrice` | `feePercent`.

---

# 17. Admin — Support Tickets & Disputes

`RequirePermissions('tickets')`. Non-super-admins are scoped to their team.

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 17.1 | GET | `/admin/tickets?[filters]` | 🔒 | List ticket queue |
| 17.2 | POST | `/admin/tickets` | 🔒 | Create a ticket |
| 17.3 | GET | `/admin/tickets/{id}` | 🔒 | Fetch one ticket |
| 17.4 | POST | `/admin/tickets/{id}/assign-to-me` | 🔒 | Claim a ticket |
| 17.5 | POST | `/admin/tickets/{id}/transfer` | 🔒 | Transfer to other team |
| 17.6 | POST | `/admin/tickets/{id}/resolve` | 🔒 | Resolve a ticket |
| 17.7 | GET | `/admin/withdrawal-disputes?[filters]` | 🔒 | List dispute queue |
| 17.8 | GET | `/admin/withdrawal-disputes/{id}` | 🔒 | Fetch one dispute |
| 17.9 | POST | `/admin/withdrawal-disputes/{id}/assign-to-me` | 🔒 | Claim a dispute |
| 17.10 | POST | `/admin/withdrawal-disputes/{id}/transfer` | 🔒 | Transfer to other team |
| 17.11 | POST | `/admin/withdrawal-disputes/{id}/resolve` | 🔒 | Resolve a dispute |

List filters (17.1 / 17.7): `page`, `limit`, `team` (`support|tech`), `assignmentStatus` (`unassigned|assigned`), `resolutionStatus` (`pending|resolved`), `assigneeId`, `userId`. Ticket and dispute entity shapes are the same as §8.

### 17.1 · GET `/admin/tickets` → **200**
**Response:** `{ "items": [ /* ticket objects */ ], "total": 8, "page": 1, "limit": 25 }`.

### 17.2 · POST `/admin/tickets` → **201**
`title` 3–140, `description` 10–4000, `team` required.
**Request:** `{ "title": "Investigate gateway timeout", "description": "Users report timeouts on deposit flow.", "team": "tech" }`
**Response:** a ticket object (`createdByType: "staff"`, `assignmentStatus: "unassigned"`).

### 17.3 · GET `/admin/tickets/{id}` → **200**
**Response:** a ticket object. **Errors:** `403` other team; `404` not found.

### 17.4 · POST `/admin/tickets/{id}/assign-to-me` → **201**
No body. **Response:** ticket object (`assignmentStatus: "assigned"`, `assignee` = caller, `assignedAt` set).
**Errors:** `403` not your team; `400` resolved/already assigned.

### 17.5 · POST `/admin/tickets/{id}/transfer` → **201**
**Request:** `{ "team": "tech" }`
**Response:** ticket object (team changed, reset to `unassigned`, assignee cleared).

### 17.6 · POST `/admin/tickets/{id}/resolve` → **201**
No body. **Response:** ticket object (`resolutionStatus: "resolved"`, `resolvedAt`/`resolvedBy` set). Notifies the user if user-created.
**Errors:** `400` already resolved / not assigned; `403` not the assignee.

### 17.7 · GET `/admin/withdrawal-disputes` → **200**
**Response:** `{ "items": [ /* dispute objects (see §8.4) */ ], "total": 2, "page": 1, "limit": 25 }`.

### 17.8 · GET `/admin/withdrawal-disputes/{id}` → **200**
**Response:** a dispute object. **Errors:** `403` other team; `404` not found.

### 17.9 · POST `/admin/withdrawal-disputes/{id}/assign-to-me` → **201**
No body. **Response:** dispute object (assigned).

### 17.10 · POST `/admin/withdrawal-disputes/{id}/transfer` → **201**
**Request:** `{ "team": "tech" }` → **Response:** dispute object (team changed, unassigned).

### 17.11 · POST `/admin/withdrawal-disputes/{id}/resolve` → **201**
**Request (optional):** `{ "resolutionNotes": "Bank confirmed credit; UTR verified." }` (≤2000)
**Response:** dispute object (`resolutionStatus: "resolved"`, notes saved, user notified).

---

# 18. Admin — Reports (XLSX export)

Super-admin only. Each endpoint streams an `.xlsx` file (not JSON).

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 18.1 | GET | `/admin/reports/{path}[?filters]` | 🔒 | Download an `.xlsx` report |

- **Response:** an `.xlsx` blob. Status **200**, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<base>-YYYY-MM-DD.xlsx"`.
- **`{path}`** is a fixed set of 10 report names (unknown paths → 404):

| Path | Key query params |
|---|---|
| `registered-customers` | `from, to, tagId, blocked, agentId` |
| `deposits` | `from, to, userId` |
| `withdrawals` | `from, to, status, userId, processedBy` |
| `customer-ledger` | `userId` (required), `from, to` |
| `customer-balances` | `tagId` |
| `users-by-tag` | `tags` (required, comma-separated names) |
| `active-customers` | `days` (default 10) |
| `inactive-customers` | `period` (day/week/month), `count` (default 30) |
| `pending-withdrawals` | — |
| `tickets` | `from, to, team, resolutionStatus, assigneeId` |

**Errors (400):** invalid date, invalid Mongo id, `withdrawals` invalid `status`, `customer-ledger` missing/unknown `userId`, `users-by-tag` missing/unknown `tags`, non-positive `days`/`count`, bad `period`.

---

# 19. Real-time (Socket.io)

Socket connects to the **same base URL** as the REST API.

- **Shared app socket** (`src/lib/socket.ts`): `io(BASE, { auth: { token } })` — JWT passed in the handshake as `handshake.auth.token`; rebuilt on token change, torn down on logout. Server→client event: **`withdrawal:payment_initiated`** (per-user; opens the withdrawal-dispute modal).
- **Deposit ingest** (`src/modules/deposits/deposit-ingest.service.ts`): the backend is itself a socket.io **client** to an upstream feed (`DEPOSIT_INGEST_WS_URL`), listening for **`new_transaction`** and calling `DepositsService.recordIngested(...)`. Ingest payload:
  ```json
  { "walletAddress": "TXYZ...rstu", "amount": 500, "transactionId": "0xtxhash-deposit-001", "timestamp": "2026-07-08T10:15:00.000Z", "currency": "USDT" }
  ```
- **Page-local sockets** (UserDashboard, UserDeposit): `io(BASE, { transports: ["websocket","polling"], reconnection: true })` — currently connect **without** the JWT. Business event **`new_transaction`**:
  - payload read by frontend: `amount` (ignored if ≤ 10), `id`, `transactionId`, `userId`, `walletAddress`|`address`, `currency` (default `"TRX"`), `timestamp`, `createdAt`.

---

## ⚠️ Flags for the backend team

1. **`POST /webhook/simulate/{walletAddress}` does not exist** in this backend. If the frontend calls it, it will 404. Deposits are ingested via the socket.io feed above.
2. **`PATCH /user/bank-accounts/{id}` and `PATCH /user/upi-accounts/{id}` (bare edit) do not exist** — only `/default` (and UPI `/active`). A bare PATCH resolves to 404.
3. **`POST /admin/auth/login` expects `{ email, password }`**, not `{ username, password }`.
4. **`GET /admin/deposits` ignores `userId`/`limit`** and returns a **bare array** (with a `visibleToUser` flag). Every other admin list uses `{ items, total, page, limit }`.
5. **`GET /admin/alerts`** adds an extra `unresolvedCount` field to the list envelope.
6. **User moderation is separate routes** (`/block`, `/unblock`, `/freeze`, `/unfreeze`, `/watch`, `/unwatch`), not one `{action}` param; `watch`/`unwatch` are super-admin only.
7. **All `@Post` actions return 201** (NestJS default), including `assign-to-me`, `transfer`, `resolve`, `activate`/`deactivate`, `enable`/`disable`. `@Delete` routes return 204.
8. **`feePercent` is a decimal** in `[0, 1)` (0.015 = 1.5%) everywhere in pricing.
9. **Page-local sockets** connect **without** the JWT handshake token, unlike the shared socket — decide whether `new_transaction` should be authenticated/scoped per-user.
10. **Error responses** are `{ statusCode, message: string | string[], errorCode?, attemptsRemaining? }`.
