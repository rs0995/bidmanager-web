const { contextBridge } = require("electron");

// Minimal on purpose — BidManagerControl.jsx doesn't currently call any
// desktop-bridge APIs (its "Browse" folder-picker button is already a no-op
// placeholder). Kept for parity with the main app's window.bidmanagerDesktop
// and as a hook point if the console ever needs a native API later.
const backendArg = process.argv.find((arg) => arg.startsWith("--bidmanager-backend-url="));
const localApiBase = backendArg ? backendArg.slice("--bidmanager-backend-url=".length) : "";

contextBridge.exposeInMainWorld("bidmanagerDesktop", {
  platform: process.platform,
  localApiBase,
});
