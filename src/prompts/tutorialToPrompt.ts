// tutorial-to-prompt 模板：将教程文章转换为可执行的提示词
export const TUTORIAL_TO_PROMPT = `You will be given a tutorial-style article (either a link or full text). Your task is to:

1. Read and understand all the tutorial steps
2. Transform these steps into ONE clear, executable prompt that allows an AI to follow and complete the tutorial
3. Merge related steps together while keeping the logic and context coherent
4. Preserve the tutorial's main goal and deliverables

Requirements:
- Extract only the actionable steps, remove explanatory text
- Use concise, direct, and actionable language
- Avoid phrases like "read the article" or "refer to the tutorial"
- Generate instructions that an AI can directly execute
- Output ONLY the final prompt text, no headers, no explanations

Your output should be the complete, ready-to-use prompt that encapsulates the entire tutorial process. The prompt should be clear enough that when copied into ChatGPT or Claude, it will produce results equal to or better than following the original tutorial manually.

Example output format:
"Act as a [role]. I want you to [main objective]. Please [step 1], then [step 2], and finally [step 3]. Make sure to [important considerations]. Provide the output as [desired format]."

Now convert the following tutorial into an executable prompt:`;

export default TUTORIAL_TO_PROMPT;
