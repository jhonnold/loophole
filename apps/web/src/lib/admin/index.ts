import { createApiClient } from "@loophole/api-client";
import { createHealth } from "./health.ts";

export {
  type AdminHealth,
  elapsedText,
  failureText,
  queueText,
  stockText,
} from "./health.ts";

/** The admins' health report. */
export const health = createHealth(createApiClient());
