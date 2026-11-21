/** What each decision on an exception is called, on the list, the sheet and the record. */
export const DECISION_LABEL: Record<string, string> = {
  RELEASE_ANYWAY: "Release anyway",
  KEEP_ON_HOLD: "Keep on hold",
  REJECT: "Reject",
  POST_COUNT: "Post the count",
  DISCARD_COUNT: "Discard the count",
  ACCEPT_VARIANCE: "Accept the variance",
  RECOUNT: "Send back to recount",
  CONTINUE: "Continue",
  STOP: "Stop",
  REDUCE_LOAD: "Reduce the load",
  ACCEPT_SHORTAGE: "Accept the shortage",
  CLAIM: "Claim it back",
  WRITE_OFF: "Write it off",
};
