import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sourceDir = "scripts";
const outputDir = join("dist", "scripts");

mkdirSync(outputDir, { recursive: true });

for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
	if (!entry.isFile() || !entry.name.endsWith(".sh")) {
		continue;
	}

	copyFileSync(join(sourceDir, entry.name), join(outputDir, entry.name));
}
