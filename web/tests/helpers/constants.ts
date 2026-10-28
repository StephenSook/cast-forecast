import { YOUCAM_BASE } from "@/server/youcam";
import { jsonReply } from "./fakeFetch";

// Placeholder values for tests only. No real key or secret appears in any test.
// The gitleaks:allow marks are for these two hand-checked placeholders and nothing else.
export const KEY = "test-key-0123456789"; // gitleaks:allow
export const SECRET = "test-secret-0123456789abcdef0123456789abcdef"; // gitleaks:allow
export const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

export const CREDIT = `GET ${YOUCAM_BASE}/s2s/v1.0/client/credit`;
export const REGISTER = `POST ${YOUCAM_BASE}/s2s/v2.0/file`;
export const PUT = "PUT https://s3.example/put";
export const RUN_VTO = `POST ${YOUCAM_BASE}/s2s/v2.0/task/makeup-vto`;
export const POLL_VTO = `GET ${YOUCAM_BASE}/s2s/v2.0/task/makeup-vto/t1`;
export const RUN_TONE = `POST ${YOUCAM_BASE}/s2s/v2.0/task/skin-tone-analysis`;
export const POLL_TONE = `GET ${YOUCAM_BASE}/s2s/v2.0/task/skin-tone-analysis/t2`;

/** A 200 file registration whose single presigned request PUTs to https://s3.example/put. */
export function registerReply(fileId: string): Response {
  return jsonReply(200, {
    data: {
      files: [
        {
          file_id: fileId,
          requests: [
            { url: "https://s3.example/put", method: "PUT", headers: { "Content-Type": "image/jpeg", "x-amz-test": "1" } },
          ],
        },
      ],
    },
  });
}

/** The `name=value` part of a Set-Cookie value, as a browser would send it back. */
export function cookieHeaderFrom(setCookie: string): string {
  return setCookie.split(";")[0];
}
