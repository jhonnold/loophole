import { createApiClient } from "@loophole/api-client";
import { createAuth } from "./auth.ts";

export { type AuthResult, type AuthState, tokenFromHash, type User } from "./auth.ts";

/** The app's one auth store. The root layout refreshes it when the app starts. */
export const auth = createAuth(createApiClient());
