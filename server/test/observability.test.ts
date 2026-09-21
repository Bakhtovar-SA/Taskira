import { afterAll, describe, expect, it } from "vitest";
import { getApp, stopApp } from "./helpers.js";

describe("operational observability", () => {
  afterAll(stopApp);

  it("separates liveness from readiness and returns request ids", async () => {
    const app = await getApp();
    const requestId = "support-case-42";
    const live = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": requestId } });
    expect(live.statusCode).toBe(200);
    expect(live.headers["x-request-id"]).toBe(requestId);
    expect(live.json()).toMatchObject({ ok: true });

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.headers["x-request-id"]).toBeTruthy();
    expect(ready.json()).toMatchObject({
      ok: true,
      checks: { db: true, migrations: true, storage: true },
    });
    // индексы поиска на месте — предупреждений нет
    expect(ready.json().warnings).toBeUndefined();
  });

  it("exports Prometheus metrics using route templates", async () => {
    const app = await getApp();
    await app.inject({ method: "GET", url: "/health" });
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("taskira_http_requests_total");
    expect(response.body).toContain('route="/health"');
    expect(response.body).toContain("taskira_http_request_duration_seconds_bucket");
    expect(response.body).toContain("taskira_ws_connections 0");
    expect(response.body).toContain('taskira_background_queue_size{queue="email_notifications"}');
    expect(response.body).toContain("taskira_ldap_resync_duration_seconds");
    expect(response.body).toContain("taskira_s3_errors_total");
  });
});
