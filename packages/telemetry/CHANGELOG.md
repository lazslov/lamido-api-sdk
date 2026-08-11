# @lamido/telemetry

## 0.1.0

Initial release: the OB-1…OB-15 mechanics. The canonical log envelope (`time`, `service`,
`env`, `level`, `message`, emit-time redaction deny-list), the batched lossy sink with the
Grafana Loki adapter, `alert()` with the Telegram channel and the `alert: true` log
backstop, and the request middleware (`request_id` binding, `http.request` summary,
scheduled flush).
