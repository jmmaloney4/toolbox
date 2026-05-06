import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sourceDir = "scripts";
const outputDir = join("dist", "scripts");

mkdirSync(outputDir, { recursive: true });

for (const file of readdirSync(sourceDir)) {
	if (!file.endsWith(".sh")) {
		continue;
	}

	copyFileSync(join(sourceDir, file), join(outputDir, file));
}
