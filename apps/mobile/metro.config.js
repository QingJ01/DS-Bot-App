const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
// The SDK is a local file dependency shared with the host's protocol tests.
config.watchFolders = [path.resolve(__dirname, "../../packages/mobile-sdk"), path.resolve(__dirname, "../../ds-bot/src/shared")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
