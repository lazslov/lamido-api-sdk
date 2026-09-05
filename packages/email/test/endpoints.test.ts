import { collectAllCursor, idempotencyKey } from "@lazslov/api-core";
import { describe, expect, it } from "vitest";
import { EmailApiError } from "../src/errors.js";
import {
  emailClient,
  fetchStub,
  jsonResponse,
  message,
  problemResponse,
  sendBody,
  testApiKey,
  testBaseUrl,
} from "./stubs/fetch.js";

const key = idempotencyKey("order-2026-0001");

describe("sendMessage", () => {
  it("posts the body with the idempotency key as a header", async () => {
    const stub = fetchStub([jsonResponse(message(), 202)]);
    await emailClient(stub).sendMessage(sendBody(), key);

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/messages`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.lastHeaders()["idempotency-key"]).toBe("order-2026-0001");
    expect(stub.lastHeaders().authorization).toBe(`Bearer ${testApiKey}`);
    expect(stub.lastBody()).toEqual({
      template: { key: "order.confirmation" },
      to: "guest@example.com",
      variables: { orderNumber: "A-2291" },
    });
  });

  it("reports replayed: false on a 202 and true on a 200", async () => {
    // 202, never 201: the message is queued, not sent. A replay of that 202 is a 200.
    const queued = fetchStub([jsonResponse(message(), 202)]);
    const first = await emailClient(queued).sendMessage(sendBody(), key);
    expect(first.replayed).toBe(false);
    expect(first.message.status).toBe("queued");

    const replayed = fetchStub([jsonResponse(message(), 200, { "idempotent-replay": "true" })]);
    expect((await emailClient(replayed).sendMessage(sendBody(), key)).replayed).toBe(true);
  });

  it("reads the header too, so a proxy that rewrites the status cannot hide a replay", async () => {
    const stub = fetchStub([jsonResponse(message(), 202, { "idempotent-replay": "true" })]);
    expect((await emailClient(stub).sendMessage(sendBody(), key)).replayed).toBe(true);
  });

  it("carries a replay's current status through, which can be failed", async () => {
    // A replay returns the first send as it is NOW. `replayed: true` is not "it went fine".
    const stub = fetchStub([
      jsonResponse(message({ status: "failed", error_code: "provider_rejected" }), 200),
    ]);
    const result = await emailClient(stub).sendMessage(sendBody(), key);
    expect(result.replayed).toBe(true);
    expect(result.message.status).toBe("failed");
  });

  it("sends the body exactly as given: no defaults, no reordering, no tidying", async () => {
    // The service rejects unknown fields rather than stripping them, hashes the body with sorted
    // object keys for the idempotency check, and keeps ARRAY ORDER SIGNIFICANT. A helpful default
    // or tidy-up here would either hide a typo or turn a replay into a mismatch.
    const stub = fetchStub([jsonResponse(message(), 202)]);
    await emailClient(stub).sendMessage(
      {
        ...sendBody(),
        variables: { items: ["c", "a", "b"], nested: [{ n: 2 }, { n: 1 }] },
      },
      key,
    );

    expect(stub.lastBody()).not.toHaveProperty("stream");
    expect(stub.lastBody()).not.toHaveProperty("attachments");
    expect(stub.lastBodyText()).toContain('"items":["c","a","b"]');
    expect(stub.lastBodyText()).toContain('"nested":[{"n":2},{"n":1}]');
  });

  it("passes a caller's init through, and sets no fetch mode", async () => {
    const controller = new AbortController();
    const stub = fetchStub([jsonResponse(message(), 202)]);
    await emailClient(stub).sendMessage(sendBody(), key, { init: { signal: controller.signal } });

    expect(stub.calls.at(-1)?.init.signal).toBe(controller.signal);
    expect(stub.calls.at(-1)?.init.mode).toBeUndefined();
  });

  it("surfaces a suppression as a non-retryable 409 with its code and advice", async () => {
    const stub = fetchStub([problemResponse(409, "conflict", { code: "recipient_suppressed" })]);
    await expect(emailClient(stub).sendMessage(sendBody(), key)).rejects.toMatchObject({
      code: "recipient_suppressed",
      retryable: false,
    });
  });

  it("surfaces the in-flight lease as the one retryable 409", async () => {
    const stub = fetchStub([problemResponse(409, "conflict", { code: "idempotency_in_flight" })]);
    await expect(emailClient(stub).sendMessage(sendBody(), key)).rejects.toMatchObject({
      code: "idempotency_in_flight",
      retryable: true,
    });
  });
});

describe("getMessage", () => {
  it("reads one message with its timeline", async () => {
    const events = [
      { type: "sending", at: "2026-08-09T09:14:04.100Z", source: "system", reason: null },
      { type: "sent", at: "2026-08-09T09:14:05.882Z", source: "system", reason: null },
    ];
    const stub = fetchStub([jsonResponse(message({ status: "sent", events }))]);
    const result = await emailClient(stub).getMessage("0194c7a1");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/messages/0194c7a1`);
    expect(result.status).toBe("sent");
    expect(result.events).toHaveLength(2);
  });

  it("encodes the id into the path", async () => {
    const stub = fetchStub([jsonResponse(message())]);
    await emailClient(stub).getMessage("a/b c");
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/messages/a%2Fb%20c`);
  });

  it("throws on a 404 rather than answering null, and names the wrong-tenant possibility", async () => {
    // A message that belongs to another tenant is a 404, never a 403.
    const stub = fetchStub([problemResponse(404, "not-found")]);
    const caught = await emailClient(stub)
      .getMessage("0194c7a1")
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(EmailApiError);
    expect((caught as EmailApiError).status).toBe(404);
    expect((caught as EmailApiError).message).toMatch(/different tenant/);
    expect((caught as EmailApiError).message).toMatch(/EMAIL_SERVICE_API_KEY/);
  });
});

describe("listMessages", () => {
  it("sends no query when nothing was asked for, keeping the service's own defaults", async () => {
    const stub = fetchStub([jsonResponse({ data: [], next_cursor: null })]);
    await emailClient(stub).listMessages();
    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/messages`);
  });

  it("passes every filter through under the service's own names", async () => {
    const stub = fetchStub([jsonResponse({ data: [], next_cursor: null })]);
    await emailClient(stub).listMessages({
      status: "failed",
      stream: "transactional",
      template_key: "order.confirmation",
      to: "guest@example.com",
      from: "2026-08-01T00:00:00Z",
      until: "2026-08-02T00:00:00Z",
      limit: 50,
      cursor: "eyJjIjoi",
    });
    expect(stub.lastUrl()).toBe(
      `${testBaseUrl}/v1/messages?status=failed&stream=transactional&template_key=order.confirmation` +
        "&to=guest%40example.com&from=2026-08-01T00%3A00%3A00Z&until=2026-08-02T00%3A00%3A00Z" +
        "&limit=50&cursor=eyJjIjoi",
    );
  });

  it("returns items and nextCursor, and declares no total", async () => {
    const stub = fetchStub([
      jsonResponse({ data: [message(), message({ public_id: "second" })], next_cursor: "abc" }),
    ]);
    const page = await emailClient(stub).listMessages({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("abc");
    expect(page).not.toHaveProperty("total");
  });

  it("passes a cursor back verbatim, so collectAllCursor walks it", async () => {
    const stub = fetchStub([
      jsonResponse({ data: [message()], next_cursor: "page-2=" }),
      jsonResponse({ data: [message({ public_id: "second" })], next_cursor: null }),
    ]);
    const client = emailClient(stub);
    const all = await collectAllCursor((params) => client.listMessages(params));

    expect(all).toHaveLength(2);
    expect(stub.calls[1]?.url).toBe(`${testBaseUrl}/v1/messages?limit=50&cursor=page-2%3D`);
  });
});

describe("cancelMessage", () => {
  it("posts to the cancel path with no body", async () => {
    const stub = fetchStub([jsonResponse(message({ status: "canceled" }))]);
    const result = await emailClient(stub).cancelMessage("0194c7a1");

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/messages/0194c7a1/cancel`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.calls.at(-1)?.init.body).toBeUndefined();
    expect(stub.lastHeaders()).not.toHaveProperty("content-type");
    expect(result.status).toBe("canceled");
  });

  it("surfaces a 422 as not retryable, with the not-queued advice", async () => {
    // Cancelling a message that has left `queued` — including one already canceled — is a 422,
    // never a silent 200, and no retry can bring it back.
    const stub = fetchStub([
      problemResponse(422, "conflict", {
        detail: "Message is canceled",
        instance: "/v1/messages/0194c7a1/cancel",
      }),
    ]);
    await expect(emailClient(stub).cancelMessage("0194c7a1")).rejects.toMatchObject({
      status: 422,
      retryable: false,
      advice: expect.stringMatching(/Only a queued message/),
    });
  });
});

describe("startGoogleOauth", () => {
  it("posts the two fields and returns the consent URL", async () => {
    const answer = {
      authorize_url: "https://accounts.example.com/o/oauth2/v2/auth?state=x",
      expires_at: "2026-09-04T11:32:00.000Z",
    };
    const stub = fetchStub([jsonResponse(answer)]);
    const result = await emailClient(stub).startGoogleOauth({
      config_id: "primary_mailbox",
      return_url: `${testBaseUrl}/connected`,
    });

    expect(stub.lastUrl()).toBe(`${testBaseUrl}/v1/oauth/google/start`);
    expect(stub.calls.at(-1)?.init.method).toBe("POST");
    expect(stub.lastHeaders()).not.toHaveProperty("idempotency-key");
    expect(stub.lastBody()).toEqual({
      config_id: "primary_mailbox",
      return_url: `${testBaseUrl}/connected`,
    });
    expect(result).toEqual(answer);
  });
});
