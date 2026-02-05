import { LLMCouncil } from "../src/index.js";

const query = "Can you give example of declarating merging in Typescript ?";

const council = new LLMCouncil({
  provider: "ollama",
  models: ["qwen2.5-coder:3b", "deepseek-coder:6.7b", "starcoder:1b"],
  chairmanModel: "mistral:7b",
  timeout: 300_000, // 5 minutes — local models need more time for large prompts
  verbose: true,
});

console.log(`\nQuery: ${query}\n`);
console.log("Running council (this may take a minute or two)...\n");

const result = await council.run(query);
console.log(JSON.stringify(result, null, 2));
