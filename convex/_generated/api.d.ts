/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as coachSettings from "../coachSettings.js";
import type * as dashboardAuth from "../dashboardAuth.js";
import type * as dashboardFeed from "../dashboardFeed.js";
import type * as generateWeeklyReview from "../generateWeeklyReview.js";
import type * as ingest from "../ingest.js";
import type * as snapshots from "../snapshots.js";
import type * as trades from "../trades.js";
import type * as weeklyReviews from "../weeklyReviews.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  coachSettings: typeof coachSettings;
  dashboardAuth: typeof dashboardAuth;
  dashboardFeed: typeof dashboardFeed;
  generateWeeklyReview: typeof generateWeeklyReview;
  ingest: typeof ingest;
  snapshots: typeof snapshots;
  trades: typeof trades;
  weeklyReviews: typeof weeklyReviews;
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
