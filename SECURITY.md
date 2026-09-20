# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
**Security → Report a vulnerability** form for this repository so the report,
logs, and proof of concept remain private. Include the affected Taskira version,
deployment mode (Docker/Podman, local/LDAP, local/S3), reproduction steps, and
the security impact. Remove real customer data and credentials.

The maintainers will acknowledge the report, validate it, and coordinate a fix
and release notes through the private advisory. Response or remediation times
are not contractual unless separately agreed with the customer.

## Supported releases

On-prem installations must upgrade sequentially through published releases.
Security fixes are supplied as a new offline release artifact; the application
does not contact an update service or download code by itself.

## Scope and disclosure

Reports about authentication, authorization, audit integrity, attachment
handling, backup confidentiality, and the offline supply chain are in scope.
Do not perform denial-of-service testing against systems you do not own. Public
disclosure should wait until customers have had a reasonable opportunity to
install the fixed release.
