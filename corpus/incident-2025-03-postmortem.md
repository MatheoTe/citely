# Postmortem: Delayed Webhook Deliveries on 14 March 2025

**Status:** Final · **Severity:** SEV-2 · **Authors:** Platform Reliability team

> Kestrel Labs is a fictional company. This document is part of the Citely sample corpus.

## Summary

On 14 March 2025, between 09:12 and 09:59 UTC, Kestrel Relay delayed webhook deliveries for 47 minutes. During that window roughly 18% of deliveries in the EU region were queued but not dispatched. No events were lost: every delayed event was delivered once the queue recovered, and the longest individual delay was 52 minutes.

The API kept accepting new events throughout the incident, so producers saw no errors. Subscribers saw a gap followed by a burst of deliveries.

## Impact

- 2.3 million deliveries were delayed by more than 5 minutes.
- 412 workspaces were affected, all of them served from the EU region.
- 37 customers opened support tickets.
- Customers on the Scale plan received an SLA credit, because monthly availability in the EU region fell to 99.89%, below the 99.95% commitment.

## Root cause

Deliveries are dispatched by workers that read from Heron, our internal message broker. The TLS certificate that Heron presents to the dispatch workers expired at 09:12 UTC. Workers rejected the expired certificate, as designed, and stopped consuming from the EU partitions.

The certificate had been issued manually in 2024, outside the automated renewal system that manages every other internal certificate. Because it was not in the inventory, no expiry alert fired. The US region was unaffected because its broker had already been migrated to automatically renewed certificates.

## Detection

The first alert fired at 09:21 UTC, nine minutes after the start of the incident, when the dispatch lag monitor crossed its 5-minute threshold. The on-call engineer acknowledged the page at 09:24 UTC. The delay between the start of the incident and the first alert was longer than our 5-minute detection target, because the lag monitor only evaluates once per minute and requires five consecutive breaches.

## Resolution

The on-call engineer identified the expired certificate at 09:41 UTC by reading the worker logs. A new certificate was issued through the automated renewal system and deployed to Heron at 09:55 UTC. Workers reconnected automatically and the backlog drained by 09:59 UTC.

## What went well

- No data was lost; the queue absorbed every event.
- The workers failed closed instead of accepting an expired certificate.
- Status page updates went out every 15 minutes, as required by our incident policy.

## What went wrong

- One certificate lived outside the automated renewal system, and nobody knew.
- Detection took nine minutes instead of five.
- The runbook for dispatch lag did not mention certificate expiry as a possible cause, so diagnosis took 17 minutes.

## Action items

| Action | Owner | Due date |
| --- | --- | --- |
| Move every Heron certificate to the automated renewal system | Platform Reliability | 31 March 2025 |
| Add an alert 21 days before any certificate expires, inventoried or not, by scanning live endpoints | Security Engineering | 15 April 2025 |
| Reduce the dispatch lag alert to two consecutive breaches | Platform Reliability | 21 March 2025 |
| Add certificate expiry to the dispatch lag runbook | On-call guild | 21 March 2025 |
| Run a game day that simulates broker certificate expiry | Platform Reliability | Q2 2025 |

All action items were completed by 30 May 2025.
