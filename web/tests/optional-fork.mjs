if (process.env.SWORN_TEST_RPC) await import("./fork.mjs");
else
  console.log(
    "Fork rehearsal skipped: set SWORN_TEST_RPC and install Anvil to include it.",
  );
