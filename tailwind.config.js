/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./services/**/*.{js,ts,jsx,tsx}", // Just in case
        "./agent/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                mono: ['"JetBrains Mono"', 'monospace'],
            },
            colors: {
                slate: {
                    850: '#151e2e',
                    950: '#020617',
                },
                neon: {
                    blue: '#00f3ff',
                    green: '#0aff00',
                    red: '#ff003c',
                    purple: '#bc13fe',
                }
            },
            animation: {
                'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow': 'glow 2s ease-in-out infinite alternate',
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 5px #00f3ff' },
                    '100%': { boxShadow: '0 0 20px #00f3ff, 0 0 10px #bc13fe' },
                }
            }
        },
    },
    plugins: [],
}
