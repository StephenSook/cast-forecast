import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { mapYouCamError } from "@/server/errors";
import { stripMetadata } from "@/server/jpeg";
import { makeupVtoPayload } from "@/server/payload";
import { TASK_ID_RE, YouCamError, createYouCam } from "@/server/youcam";

/**
 * HUMAN STEP (Task 5 carry 5), run by hand only: `pnpm test:live:task` with YOUCAM_API_KEY set. Not part of pnpm test,
 * pnpm test:live or CI. It starts ONE real makeup-vto task, so it can spend up to 1 unit (YouCam charges a task that
 * succeeds). The default photo is a test fixture with no face, so the task is expected to end in a face verdict;
 * CF_LIVE_SELFIE=<path to a JPEG> uses your own photo instead (metadata stripped first, as the upload route does).
 * It proves a real task id passes TASK_ID_RE and works in the poll path. Neither the key nor the id is ever printed:
 * every assertion is on a boolean or a YouCam error code.
 */
test("a real YouCam task id matches TASK_ID_RE and polls to a verdict", async () => {
  const key = process.env.YOUCAM_API_KEY ?? "";
  expect(key.length, "YOUCAM_API_KEY is unset; this test fails, never skips").toBeGreaterThanOrEqual(16);
  const photo = stripMetadata(readFileSync(process.env.CF_LIVE_SELFIE ?? "tests/fixtures/plain-640x480.jpg"));
  expect(photo !== null, "the photo is not a JPEG the upload route would accept").toBe(true);
  const yc = createYouCam({ key });

  const codeOf = (e: unknown) => (e instanceof YouCamError ? e.code : "not_a_youcam_error");
  let fileId = "";
  let uploadCode = "ok";
  try {
    fileId = await yc.upload(photo as Uint8Array, "selfie.jpg");
  } catch (e) {
    uploadCode = codeOf(e);
  }
  expect(uploadCode, "the upload failed").toBe("ok");

  // run() refuses any id outside TASK_ID_RE with bad_shape, so bad_shape here means a real id did not match.
  let taskId = "";
  let startCode = "ok";
  try {
    taskId = await yc.run("task/makeup-vto", makeupVtoPayload(fileId, "#FFFFFF", 49));
  } catch (e) {
    startCode = codeOf(e);
  }
  expect(startCode, "the task start failed (bad_shape: the id did not match TASK_ID_RE)").toBe("ok");
  expect(TASK_ID_RE.test(taskId), "the task id does not match TASK_ID_RE (the id is not printed)").toBe(true);

  let verdict = "success";
  try {
    await yc.poll("task/makeup-vto", taskId);
  } catch (e) {
    verdict = codeOf(e);
  }
  // Success, or a documented photo verdict (the 422 family, e.g. no face): a timeout or bad_task_id fails.
  const accepted = verdict === "success" || mapYouCamError(new YouCamError("x", verdict)).status === 422;
  expect(accepted, `the task ended with ${verdict}`).toBe(true);
});
