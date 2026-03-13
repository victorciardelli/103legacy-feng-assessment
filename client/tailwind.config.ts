import type { Config } from "tailwindcss";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#1a1a2e", light: "#2d2d4e" } },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], serif: ["Playfair Display", "Georgia", "serif"] },
    },
  },
  plugins: [],
} satisfies Config;
