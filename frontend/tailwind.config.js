/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#0b1424", 900: "#0f1b2d", 800: "#16243a", 700: "#1f3150", 600: "#2b3f63" },
        brand: {
          50: "#eff5ff", 100: "#dbe8fe", 200: "#bfd6fe", 300: "#93bbfd", 400: "#609afa",
          500: "#3b7bf6", 600: "#2563eb", 700: "#1d4fd8", 800: "#1e40af", 900: "#1e3a8a",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(15, 27, 45, 0.06), 0 1px 3px rgba(15, 27, 45, 0.04)" },
    },
  },
  plugins: [],
};
