const config = require("./config")

/** Display metadata for the dashboard's client-context header - purely
 * presentational, never used for retrieval/routing logic (that's config.client
 * + demo-knowledge/<client>/ + the catalog module). Add an entry here when
 * onboarding a future client workspace onto this same bridge. */
const PROFILES = {
  meriteshop: { workspace: "MeriteShop", brand: "Merit Cables", assistantName: "Pluggy" },
  easylife: { workspace: "EasyLife (internal)", brand: "EasyLife", assistantName: "EasyLife AI Assistant" },
}

function getActiveClientProfile() {
  return PROFILES[config.client] || { workspace: config.client, brand: config.client, assistantName: "Assistant" }
}

module.exports = { getActiveClientProfile }
