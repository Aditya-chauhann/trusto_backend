# Smart UPI Selection — Frontend Integration Guide

**Area:** User panel → Withdraw → UPI tab
**Scope:** Adds a per-user **Smart UPI Selection** toggle. When ON, the user no
longer has to pick which saved UPI receives a withdrawal — the backend
automatically chooses one at random from the user's **active + approved** UPIs.
**Backend status:** ✅ Implemented and live. This doc is the contract for the frontend.

> Prerequisite context: this builds on the existing UPI feature, where each saved
> UPI has `isActive` (user toggle) and `approvalStatus` (`approved` / `pending` /
> `rejected`). Smart selection only ever picks from UPIs that are **active AND
> approved**.

---

## 1. What's new

- A **per-user boolean setting**: `smartUpiSelectionEnabled` (default `false`).
- Two endpoints to read and set it.
- Changed behavior of **UPI withdrawal creation**:

  - **Smart ON + no UPI specified** → backend randomly picks an active+approved UPI.
  - **Any UPI explicitly specified** → that UPI is always used (manual overrides smart).
  - **Smart OFF + no UPI specified** → request is rejected (must pick a UPI).

The chosen UPI is stored on the withdrawal and shown in history/receipts **like a
normal withdrawal** — nothing is hidden from the user.

---

## 2. API changes

All endpoints require the standard user auth header:

```
Authorization: Bearer <user JWT>
```

### 2.1 Read the toggle state

```
GET /user/upi-accounts/smart-selection
```

**Response (200):**
```json
{ "enabled": false }
```

Use this on load of the Withdraw/UPI screen to render the toggle's initial state.

### 2.2 Set the toggle

```
PATCH /user/upi-accounts/smart-selection
Content-Type: application/json

{ "enabled": true }
```

- Body: `{ "enabled": true }` to turn on, `{ "enabled": false }` to turn off.
- **Response (200):** the new state, e.g. `{ "enabled": true }`.

> Enabling is allowed even if the user currently has zero active UPIs. The
> "no active UPI" check happens at withdrawal time (see §4), not when toggling.

---

## 3. Withdrawal flow changes

Endpoint is unchanged:

```
POST /user/withdrawals
```

For `method: "upi"`, the two UPI fields are **both now optional**:

| Field | Type | Notes |
|---|---|---|
| `upiAccountId` | string (Mongo id) | A saved UPI's `id`. Optional. |
| `upiId` | string | An inline UPI handle like `name@bank`. Optional; format-validated when present. |

Resolution order the backend applies:

1. **`upiAccountId` provided** → uses that saved UPI (must be approved + active).
2. **else `upiId` provided** → uses that inline handle.
3. **else (neither provided):**
   - if `smartUpiSelectionEnabled` is **true** → backend picks a random
     active+approved UPI.
   - if **false** → `400` error (must specify a UPI).

### Behavior matrix

| Smart toggle | Request sends a UPI? | Result |
|---|---|---|
| ON | No `upiAccountId`/`upiId` | Random active+approved UPI is chosen ✅ |
| ON | Sends `upiAccountId` or `upiId` | That exact UPI is used (manual wins) ✅ |
| OFF | No UPI | **400** — must select a UPI |
| OFF | Sends a UPI | That UPI is used (unchanged behavior) ✅ |

---

## 4. Errors the frontend must handle

Returned as `400 Bad Request` with a `message` string. Body shape:

```json
{
  "statusCode": 400,
  "message": "Select a UPI ID for this withdrawal or enable Smart UPI Selection",
  "error": "Bad Request"
}
```

| Situation | HTTP | `message` |
|---|---|---|
| Smart OFF and no UPI specified | 400 | `Select a UPI ID for this withdrawal or enable Smart UPI Selection` |
| Smart ON but user has **no active approved UPIs** | 400 | `You have no active approved UPI IDs available for Smart Selection. Add or activate one.` |
| Explicit `upiAccountId` that is inactive | 400 | `This UPI ID is inactive. Activate it before withdrawing.` |
| Explicit `upiAccountId` still pending approval | 400 | `This UPI ID is not yet approved and cannot be used` |
| Invalid inline `upiId` format | 400 | `upiId must be a valid UPI handle (e.g. name@bank)` |

---

## 5. Suggested UI behavior

On the Withdraw → UPI screen:

1. On load, call `GET /user/upi-accounts/smart-selection` and render the toggle.
2. When the user flips it:
   - Optimistically update the switch.
   - Call `PATCH /user/upi-accounts/smart-selection` with the new value.
   - On error, revert and show the message.
3. **When Smart is ON:**
   - Hide (or disable) the manual UPI picker.
   - Submit the withdrawal with **no** `upiAccountId` and **no** `upiId`.
   - Optionally show a hint: "A UPI will be selected automatically."
   - Guard: if the user has no active+approved UPIs, prompt them to add/activate
     one before withdrawing (you can pre-check by filtering the
     `GET /user/upi-accounts` list for `isActive === true && approvalStatus === "approved"`).
4. **When Smart is OFF:**
   - Show the manual UPI picker as today; require a selection before submit.

> The withdrawal receipt/history will show the actual UPI that was used (even when
> auto-selected), so no special "hidden UPI" handling is needed.

---

## 6. Quick reference

| Action | Method | Path | Body | Response |
|---|---|---|---|---|
| Read smart toggle | GET | `/user/upi-accounts/smart-selection` | — | `{ "enabled": boolean }` |
| Set smart toggle | PATCH | `/user/upi-accounts/smart-selection` | `{ "enabled": boolean }` | `{ "enabled": boolean }` |
| Create UPI withdrawal (smart on) | POST | `/user/withdrawals` | `{ "method": "upi", "amount": ..., "pin": "......" }` (no UPI fields) | created withdrawal |
| Create UPI withdrawal (manual) | POST | `/user/withdrawals` | `{ "method": "upi", "upiAccountId": "...", ... }` | created withdrawal |

Default for new/existing users: **Smart Selection is OFF** until turned on.

---

## 7. Parallel Smart payouts (full-balance re-arm)

When Smart auto-liquidation is enabled, the backend arms **one reservation** for
the user's **entire available balance** (INR ceiling). On each match:

1. The matched amount locks as `awaiting_payment`
2. The reservation moves to `matched`
3. A **new full-balance reservation** is armed for the remainder immediately —
   the user does **not** need to confirm an earlier payout first

This supports large LP offers (e.g. INR equivalent of 5000 USD) against a single
ceiling, while still allowing parallel in-flight payouts after partial matches.

### Confirm received

After a UPI payout is marked `paid`, the user has a 10-minute window to confirm
or dispute. Confirm is persisted server-side:

```
POST /user/withdrawals/:id/confirm-received
Authorization: Bearer <user JWT>
```

Response: updated withdrawal with `userConfirmedAt` set.

### Balance fields (`GET /user`)

| Field | Meaning |
|---|---|
| `balances.available` | Deposits minus locked withdrawals and held reservation |
| `balances.reserved` | USD value of the single `held` Smart reservation |
| `balances.totalWithdrawals` | Locked amount (includes smart `awaiting_payment`) |
