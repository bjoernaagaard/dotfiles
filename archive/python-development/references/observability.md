# Observability

Instrument service boundaries so operators can explain latency, traffic, failures, and resource pressure without deploying new code.

## Logs

Use structured events with stable names and fields. Bind request, trace, or job context through `contextvars` where concurrency requires it, and clear context at the end of the operation. Choose JSON for machine ingestion and a readable renderer for local development when useful. Integrate structlog with standard logging in production if libraries emit standard records.

Log expected user outcomes at an appropriate level; reserve error levels for events needing investigation. Exclude secrets, credentials, authorization headers, and unnecessary personal data. Bound arbitrary values and sanitize exception context.

## Metrics

Measure request/job counts, duration distributions, errors, and saturation. Metric label values must come from bounded sets; put user IDs, URLs with IDs, and request IDs in logs or traces instead. Define service-level indicators before alerts. Alerts should describe an actionable user or system symptom.

## Traces

Propagate standard trace context across supported protocols. Correlation IDs may supplement traces but aren't a substitute for trace/span identity. Add spans around meaningful boundaries rather than every function.

Test that required events and metrics are emitted, secrets are absent, context doesn't leak between requests, and instrumentation preserves application behavior. Instrument retries, queue state, and timeouts at their owning layer to avoid duplicate telemetry.
