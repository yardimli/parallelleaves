const typography = require('@tailwindcss/typography');
const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['selector', '[data-theme="dark"]'],
	
	content: [
		'./public/**/*.html',
		'./src/js/**/*.js',
		'./src/js/novel-planner/**/*.js',
	],
	
	theme: {
		extend: {
			fontFamily: {
				sans: ['Figtree', ...defaultTheme.fontFamily.sans],
			},
		},
	},
	
	plugins: [
		typography,
		require('daisyui')
	],
	
	daisyui: {
		themes: [
			"light", // You can keep other themes like light
			{
				dark: {
					// Import the default dark theme
					...require("daisyui/src/theming/themes")["[data-theme=dark]"],
					
					// Override the base-100 color (the main background)
					"base-100": "#191919", // Your new, custom dark background color
					"base-200": "#1e1e1e", // A slightly lighter background for cards, modals, etc.
					
					// You can also override other colors for full control
					// "base-200": "#2d3748", // A slightly lighter background
					// "primary": "#6366f1",   // A custom primary color for dark mode
					// "base-content": "#f8f8f8", // Text color on base-100
				},
			},
			// ADDED SECTION START: New paper theme definition
			{
				paper: {
					...require("daisyui/src/theming/themes")["[data-theme=light]"],
					"base-100": "#f3f0e9", // A warm, off-white paper color
					"base-200": "#e9e5dc", // For cards, slightly darker paper
					"base-300": "#dcd7cd", // For borders, etc.
					"base-content": "#3f3931", // Dark brown text for better readability
					"primary": "#a67b5b",
					"secondary": "#c8a98f",
					"accent": "#8c6f58",
				},
			},
			// ADDED SECTION END
		],
		darkTheme: "dark",
		base: true, // applies background color and foreground color for root element by default
		styled: true, // include daisyUI colors and design decisions for all components
		utils: true, // adds responsive and modifier utility classes
		logs: true, // Shows info about daisyUI version and used config in the console when building your CSS
	},
};
