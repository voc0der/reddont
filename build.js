import { execSync } from "bun";

try {
	// Precompile Pug templates in the `src` directory to the `dist` directory
	execSync("pug src -o dist");
	console.log("Pug templates compiled successfully.");
} catch (error) {
	console.error("Failed to compile Pug templates:", error);
}
