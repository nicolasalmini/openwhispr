function registerAgentCliIpc(ipcMain, runner) {
  const owners = new Map();
  const senderRequests = new Map();

  const trackRequest = (sender, requestId) => {
    const senderId = sender.id;
    let requests = senderRequests.get(senderId);
    if (!requests) {
      requests = new Set();
      senderRequests.set(senderId, requests);
      sender.once("destroyed", () => {
        for (const ownedRequestId of requests) runner.cancel(ownedRequestId);
        senderRequests.delete(senderId);
      });
    }
    requests.add(requestId);
    owners.set(requestId, senderId);
  };

  const untrackRequest = (senderId, requestId) => {
    if (owners.get(requestId) === senderId) owners.delete(requestId);
    const requests = senderRequests.get(senderId);
    requests?.delete(requestId);
  };

  ipcMain.handle("agent-cli-process", async (event, payload) => {
    const requestId = payload?.requestId;
    const senderId = event.sender.id;
    if (typeof requestId !== "string" || !requestId.trim()) {
      return {
        success: false,
        requestId,
        code: "INVALID_REQUEST",
        error: "A request ID is required",
      };
    }
    if (owners.has(requestId)) {
      return {
        success: false,
        requestId,
        code: "DUPLICATE_REQUEST",
        error: "Request ID is already active",
      };
    }

    trackRequest(event.sender, requestId);
    try {
      const result = await runner.process(payload);
      return { success: true, requestId: result.requestId, text: result.text };
    } catch (error) {
      return {
        success: false,
        requestId,
        code: error?.code || "UNKNOWN",
        error: error?.message || "Agent CLI request failed",
      };
    } finally {
      untrackRequest(senderId, requestId);
    }
  });
  ipcMain.handle("agent-cli-check-availability", (_event, payload) =>
    runner.checkAvailability(payload)
  );
  ipcMain.handle("agent-cli-cancel", (event, requestId) => {
    if (owners.get(requestId) !== event.sender.id) return { cancelled: false };
    return { cancelled: runner.cancel(requestId) };
  });
}

module.exports = { registerAgentCliIpc };
