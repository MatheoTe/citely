# Security and Data Retention Policy

This policy describes how Kestrel Labs protects customer data in Kestrel Relay and how long each kind of data is kept. It is reviewed every year by the Security Engineering team and approved by the CTO.

> Kestrel Labs is a fictional company. This document is part of the Citely sample corpus.

## Encryption

All customer data is encrypted in transit with TLS 1.2 or newer; TLS 1.0 and 1.1 are rejected. Data at rest is encrypted with AES-256. Encryption keys are managed in a hardware-backed key management service, and data encryption keys are rotated every 90 days.

Webhook signing secrets are stored encrypted and are only ever displayed once, at creation time. Support staff cannot read signing secrets or API keys.

## Data retention

Retention periods depend on the type of data and on the customer's plan.

| Data | Starter | Growth | Scale |
| --- | --- | --- | --- |
| Event payloads | 7 days | 30 days | 90 days |
| Delivery attempt logs | 30 days | 90 days | 400 days |
| Audit log | 1 year | 1 year | 7 years |

Dead-lettered events are kept for 14 days on every plan. When a workspace is deleted, its event payloads and delivery logs are purged within 30 days, and backups containing them expire within a further 35 days. Audit logs are kept for the full retention period even after a workspace is deleted, because they are needed for compliance.

Customers can request early deletion of specific events through the API. Early deletion is irreversible.

## Access control

Production access requires single sign-on with a hardware security key. Engineers receive production access just in time, for a maximum of 4 hours, and every session is recorded. Access requests are approved by a second engineer.

Access reviews happen every quarter. Accounts that have been inactive for 45 days are disabled automatically.

## Compliance

Kestrel Relay holds a SOC 2 Type II report, renewed every year, and is GDPR compliant. A data processing agreement is available to all customers. EU customers can pin their data to the EU region, in which case event payloads never leave the Frankfurt and Dublin data centres.

## Vulnerability disclosure

Security researchers can report vulnerabilities to security@kestrel.example. We acknowledge reports within 2 business days and aim to fix critical vulnerabilities within 7 days.

Kestrel runs a private bug bounty programme. Rewards range from 100 US dollars for low-severity issues up to 5,000 US dollars for critical issues such as remote code execution or cross-workspace data access. Testing must not affect other customers, and denial-of-service testing is out of scope.

## Incident response

Security incidents are handled by an on-call security engineer. If customer data is affected, impacted customers are notified within 72 hours of confirmation, in line with GDPR. Every security incident ends with a written postmortem shared with affected customers on request.
