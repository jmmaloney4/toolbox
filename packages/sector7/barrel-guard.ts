// @ts-expect-error LiteLLM lives on the ./litellm subpath, not the root barrel
import { litellm } from "./index.ts";

void litellm;
