import { afterEach, describe, expect, test } from "bun:test";
import { OpenCodeClient } from "../../src/client/OpenCodeClient";

type FetchCall = {
  method: string;
  url: string;
};

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenCodeClient.closeSession", () => {
  test("aborts then deletes session when both requests succeed", async () => {
    const client = new OpenCodeClient("http://127.0.0.1:14096", "http://127.0.0.1:14096", "/tmp");
    const sessionId = "session-1";
    const calls: FetchCall[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = getUrl(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });

      if (url.endsWith(`/session/${sessionId}/abort`) && method === "POST") {
        return jsonResponse(true);
      }
      if (url.endsWith(`/session/${sessionId}`) && method === "DELETE") {
        return jsonResponse(true);
      }

      return jsonResponse({ message: "not found" }, 404);
    }) as typeof fetch;

    const closed = await client.closeSession(sessionId);

    expect(closed).toBe(true);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /session/session-1/abort",
      "DELETE /session/session-1",
    ]);
  });

  test("still deletes session when abort request fails", async () => {
    const client = new OpenCodeClient("http://127.0.0.1:14096", "http://127.0.0.1:14096", "/tmp");
    const sessionId = "session-2";
    const calls: FetchCall[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = getUrl(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });

      if (url.endsWith(`/session/${sessionId}/abort`) && method === "POST") {
        return jsonResponse({ message: "abort failed" }, 500);
      }
      if (url.endsWith(`/session/${sessionId}`) && method === "DELETE") {
        return jsonResponse(true);
      }

      return jsonResponse({ message: "not found" }, 404);
    }) as typeof fetch;

    const closed = await client.closeSession(sessionId);

    expect(closed).toBe(true);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /session/session-2/abort",
      "DELETE /session/session-2",
    ]);
  });

  test("returns false when delete request fails", async () => {
    const client = new OpenCodeClient("http://127.0.0.1:14096", "http://127.0.0.1:14096", "/tmp");
    const sessionId = "session-3";
    const calls: FetchCall[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = getUrl(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });

      if (url.endsWith(`/session/${sessionId}/abort`) && method === "POST") {
        return jsonResponse(true);
      }
      if (url.endsWith(`/session/${sessionId}`) && method === "DELETE") {
        return jsonResponse({ message: "delete failed" }, 500);
      }

      return jsonResponse({ message: "not found" }, 404);
    }) as typeof fetch;

    const closed = await client.closeSession(sessionId);

    expect(closed).toBe(false);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /session/session-3/abort",
      "DELETE /session/session-3",
    ]);
  });
});
