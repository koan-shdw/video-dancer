# MODELARK SPEND (list 46), spec of 2026-10-01

His words (09-29): "see if we can have modelark credit displayed liek fal" · "add to list for later".
Asked 10-01 whether a second BytePlus key may show this month's spend: "2. yes", then GO. Then a
balance call turned up after all (below); his GO 10-02: the chip shows what is left, like fal,
with this month's spend in its tooltip, and the spend on the chip when BytePlus refuses the balance.

## What BytePlus offers (read 10-01)

- The ModelArk key only runs models. Money sits behind BytePlus's own OpenAPI, which takes an
  Access Key (an ID and a secret): BytePlus Console → your name → IAM → Key management → Create
  access key. The secret shows once. Two keys per user at most.
  (docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey)
- Signing (docs.byteplus.com/en/docs/byteplus-platform/reference-how-to-calculate-a-signature):
  HMAC-SHA256; `X-Date` as `YYYYMMDDTHHMMSSZ`; canonical request = method, URI, sorted query,
  canonical headers, signed headers, hex SHA-256 of the body; scope `date/region/service/request`;
  key chain kSecret (the secret itself) → date → region → service → "request";
  `Authorization: HMAC-SHA256 Credential=AK/scope, SignedHeaders=…, Signature=…`. The page has no
  worked example, nor do BytePlus's SDK tests.
- The bill: `ListBillOverviewByProd`, Version `2022-01-01`, service `billing`
  (docs.byteplus.com/en/docs/byteplus-platform/ListBillOverviewByProd). `BillPeriod` (YYYY-MM) and
  `Limit` (1-300) required; `BillCategoryParent` (consume, refund, transfer) optional. Each row is
  one product: `Product`, `PayableAmount` ("the amount payable"), `Currency`.
- The address is not on the docs pages. BytePlus's own Node SDK (byteplus-nodejs-sdk-v2) says it:
  billing is a global service, `billing.byteplusapi.com`, region `ap-southeast-1` (its default), a
  POST with a JSON body, `Action` and `Version` in the query, and its signer signs `host`, `x-date`
  and `x-content-sha256` (never content-type).
- The balance: `QueryBalanceAcct` (billing, 2022-01-01), in BytePlus's own SDKs and not on the
  docs site. Read 10-02 in all three (Node, Go and Python v2), which agree: a POST to the same
  address with no parameters (an empty JSON body), answering `AccountID` (a number) and, as text,
  `AvailableBalance`, `CashBalance`, `CreditLimit`, `FreezeAmount`, `ArrearsBalance`. No currency
  field: the chip takes the bill's, else USD (BytePlus bills in USD).

## In the app

- Settings → api suppliers → the ModelArk row: two masked boxes under the ModelArk key, "BytePlus
  Access Key ID" and "BytePlus Secret Access Key", and "get an access key ↗" (BytePlus's steps).
  Stored like every key (encrypted at rest, masked to the renderer).
- Save checks a changed pair first with the same two reads (free); either one answering = the key
  works. Refused, or only one box filled: the pair is not saved, its row says why in BytePlus's
  words, the rest of the card is. Both boxes emptied = removed. A box left alone holds the mask;
  main swaps the stored key in.
- The header's ARK chip, with the pair saved, reads both at once:
  - `ARK $x` = `AvailableBalance`, what is left, like fal's chip. Its tooltip names it (BytePlus's
    available balance), then cash, and credit limit, frozen and owed when there are any, then
    this month's spend: the sum of the month's consumption rows (`PayableAmount`, "this month" by
    the PC's calendar), product by product.
  - BytePlus refuses the balance: `ARK $x this month`, the spend, and the tooltip says why there is
    no balance. It refuses the bill: the balance, and the tooltip says why the spend is missing.
  - Both refused: `ARK ⚠` in red with BytePlus's words. Another currency is named (`ARK 12.00
    SGD`). Click reads again; so does closing Settings. Without the pair: `ARK ↗`, the console
    link, as before.
- `src/main/byteplus.ts` signs and reads; IPC `ark:spend`, `ark:spendCheck`; `ui/ArkChip.tsx`.

## Proven / open

- PROVEN with stand-ins: `scripts/test-ark-spend.cjs` (a stand-in BytePlus re-derives every
  signature from the docs page and refuses a changed body, query or method; the balance and its
  parts, sums, currency, empty month, one call refused, both refused, no line, replies with
  nothing in them) and `scripts/test-ark-spend-browser.cjs` (the boxes, the check, the chip in
  every case).
- OPEN: that BytePlus's real server takes the signature, that it answers the balance call for his
  key (the call is not on their docs pages), and the product name ModelArk carries on the bill.
  His first save of a real pair answers the first two: the row says "key works ✓ · the ARK chip
  shows what is left", "… this month's spend (BytePlus gave no balance)", or BytePlus's refusal.
