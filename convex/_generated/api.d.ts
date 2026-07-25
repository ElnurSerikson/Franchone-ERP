/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTP from "../ResendOTP.js";
import type * as activity from "../activity.js";
import type * as auth from "../auth.js";
import type * as campaigns from "../campaigns.js";
import type * as crons from "../crons.js";
import type * as departments from "../departments.js";
import type * as emails from "../emails.js";
import type * as employees from "../employees.js";
import type * as http from "../http.js";
import type * as kpiMath from "../kpiMath.js";
import type * as lib from "../lib.js";
import type * as payroll from "../payroll.js";
import type * as permModel from "../permModel.js";
import type * as permissions from "../permissions.js";
import type * as positions from "../positions.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as setup from "../setup.js";
import type * as smm from "../smm.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTP: typeof ResendOTP;
  activity: typeof activity;
  auth: typeof auth;
  campaigns: typeof campaigns;
  crons: typeof crons;
  departments: typeof departments;
  emails: typeof emails;
  employees: typeof employees;
  http: typeof http;
  kpiMath: typeof kpiMath;
  lib: typeof lib;
  payroll: typeof payroll;
  permModel: typeof permModel;
  permissions: typeof permissions;
  positions: typeof positions;
  reports: typeof reports;
  sales: typeof sales;
  seed: typeof seed;
  settings: typeof settings;
  setup: typeof setup;
  smm: typeof smm;
  tasks: typeof tasks;
  users: typeof users;
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
