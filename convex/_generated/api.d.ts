/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as dashboard from "../dashboard.js";
import type * as fleet from "../fleet.js";
import type * as http from "../http.js";
import type * as imessage from "../imessage.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_plan from "../lib/plan.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_warehouse from "../lib/warehouse.js";
import type * as lib_webhook from "../lib/webhook.js";
import type * as profileScrape from "../profileScrape.js";
import type * as router from "../router.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  dashboard: typeof dashboard;
  fleet: typeof fleet;
  http: typeof http;
  imessage: typeof imessage;
  "lib/limits": typeof lib_limits;
  "lib/plan": typeof lib_plan;
  "lib/pricing": typeof lib_pricing;
  "lib/profile": typeof lib_profile;
  "lib/warehouse": typeof lib_warehouse;
  "lib/webhook": typeof lib_webhook;
  profileScrape: typeof profileScrape;
  router: typeof router;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
