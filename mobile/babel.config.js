module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [
    [
      "module:react-native-dotenv",
      {
        moduleName: "@env",
        path: ".env",
        safe: false,
        allowUndefined: true,
      },
    ],
    // Code-scanner barcode capture does not need frame-processor worklets.
    // Keeping the worklets babel plugin breaks the iOS bundle (missing
    // @babel/plugin-proposal-optional-chaining inside vision-camera sources).
  ],
};
