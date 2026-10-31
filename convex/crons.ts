import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("drain task queue", { seconds: 5 }, internal.sim.sweep, {});
export default crons;
