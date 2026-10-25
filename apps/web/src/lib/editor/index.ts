import { createApiClient } from "@loophole/api-client";
import { createSubmissions } from "./submit.ts";

/** The app's submissions client. */
export const submissions = createSubmissions(createApiClient());
