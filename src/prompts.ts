import type { Stage1Entry, Stage2Ranking } from './types.js';

export function buildRankingPrompt(
  query: string,
  responses: { label: string; text: string }[],
): string {
  const responsesBlock = responses
    .map((r) => `${r.label}:\n${r.text}`)
    .join('\n\n');

  return `You are evaluating different responses to the following question:

Question: ${query}

Here are the responses from different models (anonymized):

${responsesBlock}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format:

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:`;
}

export function buildChairmanPrompt(
  query: string,
  stage1: Stage1Entry[],
  stage2: Stage2Ranking[],
): string {
  const responsesBlock = stage1
    .map((r) => `Model: ${r.model}\nResponse: ${r.response}`)
    .join('\n\n');

  const rankingsBlock = stage2
    .map((r) => `Model: ${r.model}\nRanking: ${r.evaluation}`)
    .join('\n\n');

  return `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: ${query}

STAGE 1 - Individual Responses:
${responsesBlock}

STAGE 2 - Peer Rankings:
${rankingsBlock}

Your task is to synthesize all of this information into a single, comprehensive, accurate answer to the original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

IMPORTANT: Respond with the answer DIRECTLY. Do NOT include any preamble, introduction, or meta-commentary about being a chairman, synthesizing responses, or the council process. Just provide the final answer as if you were answering the question yourself.`;
}
