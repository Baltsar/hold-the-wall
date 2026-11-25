// Lists the models VULTR_INFERENCE_KEY can use, and asks the chosen one for a test answer.
import { askModel, listModels, parseAnswer } from "../src/agent/inference.ts";

const models = await listModels();
console.log(models.join("\n"));
if (process.env.VULTR_MODEL) {
  const text = await askModel([
    { role: "system", content: 'Answer with exactly one JSON object: {"category": "filesystem", "command": "<shell command>"}' },
    { role: "user", content: "List the files in /tmp." },
  ]);
  console.log(`\n${process.env.VULTR_MODEL} answered:\n${text}\nparsed: ${JSON.stringify(parseAnswer(text))}`);
}
