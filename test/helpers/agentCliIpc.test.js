const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { registerAgentCliIpc } = require("../../src/helpers/agentCliIpc");

function ipcEvent(id) {
  const sender = new EventEmitter();
  sender.id = id;
  return { sender };
}

test("registers only process, selected availability, and cancellation channels", async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const calls = [];
  const runner = {
    async process(payload) {
      calls.push(["process", payload]);
      return { requestId: payload.requestId, text: "clean" };
    },
    async checkAvailability(payload) {
      calls.push(["availability", payload]);
      return { available: true, adapter: payload.adapter };
    },
    cancel(requestId) {
      calls.push(["cancel", requestId]);
      return true;
    },
  };

  registerAgentCliIpc(ipcMain, runner);
  assert.deepEqual([...handlers.keys()].sort(), [
    "agent-cli-cancel",
    "agent-cli-check-availability",
    "agent-cli-process",
  ]);
  assert.deepEqual(
    await handlers.get("agent-cli-process")(ipcEvent(1), {
      requestId: "r1",
      adapter: "claude-cli",
    }),
    { success: true, requestId: "r1", text: "clean" }
  );
  assert.deepEqual(
    await handlers.get("agent-cli-check-availability")(ipcEvent(1), { adapter: "devin-cli" }),
    { available: true, adapter: "devin-cli" }
  );
  assert.deepEqual(await handlers.get("agent-cli-cancel")(ipcEvent(1), "r1"), {
    cancelled: false,
  });
  assert.equal(calls.length, 2);
});

test("returns structured process errors without leaking stderr or prompts", async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  registerAgentCliIpc(ipcMain, {
    async process() {
      throw Object.assign(new Error("safe message"), { code: "AUTH_FAILED" });
    },
    checkAvailability() {},
    cancel() {},
  });
  assert.deepEqual(await handlers.get("agent-cli-process")(ipcEvent(2), { requestId: "r2" }), {
    success: false,
    requestId: "r2",
    code: "AUTH_FAILED",
    error: "safe message",
  });
});

test("only the owning renderer can cancel an active request", async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const cancellations = [];
  let complete;
  registerAgentCliIpc(ipcMain, {
    process: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    checkAvailability() {},
    cancel(requestId) {
      cancellations.push(requestId);
      return true;
    },
  });

  const owner = ipcEvent(10);
  const foreign = ipcEvent(11);
  const pending = handlers.get("agent-cli-process")(owner, { requestId: "owned" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(await handlers.get("agent-cli-cancel")(foreign, "owned"), {
    cancelled: false,
  });
  assert.deepEqual(await handlers.get("agent-cli-cancel")(owner, "owned"), {
    cancelled: true,
  });
  assert.deepEqual(
    await handlers.get("agent-cli-process")(foreign, { requestId: "owned" }),
    {
      success: false,
      requestId: "owned",
      code: "DUPLICATE_REQUEST",
      error: "Request ID is already active",
    }
  );

  complete({ requestId: "owned", text: "clean" });
  await pending;
  assert.deepEqual(cancellations, ["owned"]);
});

test("destroying a renderer cancels each request it owns", async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const cancellations = [];
  let complete;
  registerAgentCliIpc(ipcMain, {
    process: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    checkAvailability() {},
    cancel(requestId) {
      cancellations.push(requestId);
      return true;
    },
  });

  const event = ipcEvent(12);
  const pending = handlers.get("agent-cli-process")(event, { requestId: "orphan" });
  await new Promise((resolve) => setImmediate(resolve));
  event.sender.emit("destroyed");
  assert.deepEqual(cancellations, ["orphan"]);
  complete({ requestId: "orphan", text: "clean" });
  await pending;
});
