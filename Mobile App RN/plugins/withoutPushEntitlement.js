const { withEntitlementsPlist } = require("@expo/config-plugins");

// expo-notifications automatic autolinked config plugin always adds the
// aps-environment entitlement (Push Notifications capability), even though
// this app only ever calls scheduleNotificationAsync() for local, on-device
// deadline reminders and never registers for a remote push token. That
// entitlement is also what blocks archiving under a free Apple Developer
// Personal Team ("Personal development teams ... do not support the Push
// Notifications capability"), so strip it back out after other plugins run.
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });
};
