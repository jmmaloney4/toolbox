import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the absolute path to a script shipped with this package */
export function getScriptPath(scriptName: string): string {
	return path.join(__dirname, scriptName);
}
