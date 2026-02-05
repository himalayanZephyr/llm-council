import { LLMCouncil } from "../src/index.js";

const query = "What are the pros and cons of TypeScript over javascript?";

const council = new LLMCouncil({
  provider: "openrouter",
  apiKey: "<openrouter-api-key>",
  models: [
    "deepseek/deepseek-r1-0528:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
  ],
  chairmanModel: "google/gemma-3-27b-it:free",
  verbose: true,
});

console.log(`\nQuery: ${query}\n`);
console.log("Running council (this may take a minute or two)...\n");

const result = await council.run(query);
console.log(JSON.stringify(result, null, 2));
