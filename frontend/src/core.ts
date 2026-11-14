/**
 * The frontend imports the project's single crypto core (`src-core/`) —
 * the exact module the node test suite exercises — so the browser demo runs
 * the same QoreSeal / QoreSign / ML-DSA code that is tested, never a copy.
 */
export * from "../../src-core/index";
