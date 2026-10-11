import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";

export default defineConfig([
  globalIgnores(["**/.next/**", "**/.open-next/**", "**/.astro/**", "**/dist/**", "**/.wrangler/**", "tmp/**", "out/**", "build/**", "coverage/**", "worker-configuration.d.ts", "workers/router/worker-configuration.d.ts"]),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: { "no-irregular-whitespace": ["error", { skipStrings: true, skipJSXText: true }] },
  },
  {
    files: ["**/*.tsx"],
    ...react.configs.flat.recommended,
    plugins: { react, "react-hooks": hooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      ...hooks.configs.recommended.rules,
    },
  },
  { files: ["tests/**/*.ts"], rules: { "require-yield": "off" } },
]);
