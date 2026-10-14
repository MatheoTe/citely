# Kestrel Relay API Reference

Kestrel Relay is a webhook delivery platform. Producers publish events to Relay, and Relay delivers them to subscriber endpoints with retries, signatures and an audit trail. This reference covers version 3 of the public REST API, served from `https://api.kestrel.example/v3`.

> Kestrel Labs is a fictional company. This document is part of the Citevia sample corpus.

## Authentication

Every request must carry an API key in the `Authorization` header using the Bearer scheme. Live keys start with the prefix `kr_live_` and test keys start with `kr_test_`. Test keys can only publish to sandbox endpoints and never trigger real deliveries.

Keys are scoped to a single workspace. A key can be restricted to read-only access when it is created; read-only keys receive error `KR-1003` when they call a write endpoint. Keys can be rotated from the dashboard at any time, and the previous key stays valid for a grace period of 24 hours so that deployments can roll over without downtime.

Never embed a live key in a mobile app or a browser bundle. If a key leaks, revoke it immediately from **Settings → API keys**; revocation propagates to every edge region in under 60 seconds.

## Rate limits

The API enforces a limit of 600 requests per minute per workspace, with a burst allowance of 100 requests. Limits are tracked with a sliding window, not a fixed calendar minute.

When a client exceeds the limit, Relay answers with HTTP status `429 Too Many Requests` and error code `KR-1029`. The response includes a `Retry-After` header with the number of seconds to wait before retrying. Clients should honour that header instead of retrying immediately; aggressive retry loops can extend the throttling window.

Every response includes three headers that describe the current budget: `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. Customers on the Scale plan can request a higher limit through their account manager.

## Pagination

List endpoints use cursor-based pagination. A response contains a `data` array and a `next_cursor` string. Pass that value back as the `cursor` query parameter to fetch the following page. When `next_cursor` is `null` there are no more results.

The default page size is 50 items and the maximum is 200, set through the `limit` query parameter. Cursors expire after 15 minutes. Offset-based pagination is not supported because it produces duplicates when new events arrive during a scan.

## Publishing events

Send a `POST /v3/events` request with a JSON body that contains `type`, `payload` and an optional `idempotency_key`. The payload must be valid JSON and no larger than 256 KB. Larger payloads are rejected with error `KR-1013`.

If two requests share the same idempotency key within 24 hours, Relay stores the event only once and returns the original event identifier to the second caller. Idempotency keys are unique per workspace and may be up to 255 characters long.

## Delivery and retries

Relay considers a delivery successful when the subscriber endpoint answers with any 2xx status code within 15 seconds. Any other status, a timeout or a connection error counts as a failed attempt.

Failed deliveries are retried with exponential backoff. The retry schedule is 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours and 24 hours after the previous attempt. A delivery is attempted at most 8 times in total; after the eighth failure the event moves to the dead-letter queue, where it is kept for 14 days and can be replayed manually from the dashboard or through `POST /v3/deliveries/{id}/replay`.

If an endpoint fails continuously for 72 hours, Relay automatically disables the subscription and emails the workspace owners. Re-enabling the subscription does not replay the events that were skipped while it was disabled.

## Webhook signatures

Every delivery carries a `Kestrel-Signature` header so receivers can verify that the request came from Relay. The signature is an HMAC-SHA256 of the timestamp and the raw request body, computed with the subscription's signing secret and encoded as hexadecimal.

The header looks like `t=1717000000,v1=5257a869…`. Receivers should reject any request whose timestamp is more than 5 minutes away from their own clock to prevent replay attacks. Signing secrets can be rolled; during a roll Relay sends two `v1` signatures, one for each secret, for 48 hours.

## Error codes

All errors share the same JSON envelope with `code`, `message` and `request_id` fields. Include the `request_id` when you contact support.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| KR-1001 | 401 | Missing or malformed API key |
| KR-1003 | 403 | Read-only key used on a write endpoint |
| KR-1013 | 413 | Event payload larger than 256 KB |
| KR-1022 | 422 | Payload is not valid JSON |
| KR-1029 | 429 | Rate limit exceeded |
| KR-4291 | 409 | Idempotency key reused with a different payload |
| KR-5000 | 500 | Internal error, safe to retry |

## Versioning and deprecation

Breaking changes ship only in a new major version. A major version is supported for at least 18 months after its successor is released. Version 2 of the API reaches end of life on 30 June 2026. Deprecated endpoints return a `Sunset` header with the retirement date.
