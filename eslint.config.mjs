import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Allow leading-underscore params for stub/simulated integration
      // functions that intentionally ignore their (would-be-real) inputs.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // app.js is the cPanel/Passenger production entry point — it must stay
    // plain CommonJS since Passenger runs it directly with `node app.js`,
    // with no bundler/TS step in front of it, and the package has no
    // "type": "module". require() here is intentional, not a style slip.
    files: ["app.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Isolated local demo tool - its own package.json/CommonJS Node
    // service, not part of this app's TS/lint surface. See its README.
    "tools/whatsapp-demo-bridge/**",
  ]),
]);

export default eslintConfig;
